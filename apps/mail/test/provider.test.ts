import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { ImapFlow } from 'imapflow';
import { ViettelProvider } from '../src/server/providers/viettel';
import { authenticatedCall } from '../src/server/core/provider';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('preserves authenticated state when a deadline closes a stalled post-auth connection', async () => {
  vi.useFakeTimers();
  vi.spyOn(ImapFlow.prototype, 'connect').mockImplementation(function (this: ImapFlow) {
    this.authenticated = true;
    return new Promise(() => undefined);
  });
  vi.spyOn(ImapFlow.prototype, 'close').mockImplementation(function (this: ImapFlow) {
    this.authenticated = false;
  });
  const report = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const provider = new ViettelProvider(
    { email: 'fixture@iconiclogs.com', password: 'synthetic' },
    { host: 'mail.example.test', sentMode: 'append' },
  );
  const result = expect(provider.authenticate()).rejects.toMatchObject({
    code: 'PROVIDER_TIMEOUT',
    status: 504,
  });
  await vi.advanceTimersByTimeAsync(25000);
  await result;
  expect(report).toHaveBeenCalledWith(
    'mail-imap-error',
    expect.objectContaining({ authenticated: true, code: 'PROVIDER_TIMEOUT', elapsedMs: 25000 }),
  );
});
it('records only safe connection metadata before closing an authenticated failed connection', async () => {
  const failure = Object.assign(new Error('private password and protocol transcript'), {
    code: 'ECONNRESET',
  });
  vi.spyOn(ImapFlow.prototype, 'connect').mockImplementation(async function (this: ImapFlow) {
    this.authenticated = 'fixture@iconiclogs.com';
    throw failure;
  });
  vi.spyOn(ImapFlow.prototype, 'close').mockImplementation(() => undefined);
  const report = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const provider = new ViettelProvider(
    { email: 'fixture@iconiclogs.com', password: 'synthetic-private-password' },
    { host: 'mail.example.test', sentMode: 'append' },
  );
  await expect(provider.authenticate()).rejects.toBe(failure);
  expect(report).toHaveBeenCalledWith(
    'mail-imap-error',
    expect.objectContaining({
      authenticated: true,
      code: 'PROVIDER_UNAVAILABLE',
      elapsedMs: expect.any(Number),
    }),
  );
  const logged = JSON.stringify(report.mock.calls);
  expect(logged).not.toMatch(
    /fixture@|private password|protocol transcript|synthetic-private-password/,
  );
});
it('handles an IMAP socket error during a command and after connection cleanup', async () => {
  vi.spyOn(ImapFlow.prototype, 'connect').mockResolvedValue(undefined);
  const close = vi.spyOn(ImapFlow.prototype, 'close').mockImplementation(() => undefined);
  const provider = new ViettelProvider(
    { email: 'fixture@iconiclogs.com', password: 'synthetic' },
    { host: 'mail.example.test', sentMode: 'append' },
  );
  let started!: (client: ImapFlow) => void;
  const connected = new Promise<ImapFlow>((resolve) => {
    started = resolve;
  });
  let finish!: () => void;
  const command = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = provider.connection(async (client) => {
    started(client);
    return command;
  });
  const client = await connected;
  const failure = new Error('socket disconnected during FETCH');
  try {
    expect(() => client.emit('error', failure)).not.toThrow();
    await expect(result).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
    expect(() => client.emit('error', new Error('late socket error'))).not.toThrow();
  } finally {
    finish();
    await result.catch(() => undefined);
  }
});
it('downloads the selected MIME part instead of parsing the entire message again', async () => {
  const download = vi.fn(async () => ({
    meta: { expectedSize: 5 },
    content: Readable.from([Buffer.from('hello')]),
  }));
  const client = {
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release() {} }),
    fetchOne: async () => ({
      uid: 42,
      bodyStructure: {
        type: 'multipart/mixed',
        childNodes: [
          { part: '1', type: 'text/plain', size: 50 },
          {
            part: '2',
            type: 'application/octet-stream',
            size: 5,
            disposition: 'attachment',
            dispositionParameters: { filename: 'file.txt' },
          },
        ],
      },
    }),
    download,
  };
  vi.spyOn(ViettelProvider.prototype, 'connection').mockImplementation(async (operation) =>
    operation(client as unknown as ImapFlow),
  );
  const provider = new ViettelProvider(
    { email: 'fixture@iconiclogs.com', password: 'synthetic' },
    { host: 'mail.example.test', sentMode: 'append' },
  );
  const file = await provider.attachment('inbox', '123.42', 0);
  expect(new TextDecoder().decode(file.content)).toBe('hello');
  expect(file.name).toBe('file.txt');
  expect(download).toHaveBeenCalledWith('42', '2', expect.objectContaining({ uid: true }));
});
it('revokes credentials on an actual provider auth failure, but not a temporary disconnect', async () => {
  const revoke = vi.fn(async () => undefined);
  await expect(
    authenticatedCall(async () => {
      throw { authenticationFailed: true };
    }, revoke),
  ).rejects.toMatchObject({ status: 401 });
  expect(revoke).toHaveBeenCalledTimes(1);
  await expect(
    authenticatedCall(async () => {
      throw Error('socket timed out');
    }, revoke),
  ).rejects.toThrow('socket timed out');
  expect(revoke).toHaveBeenCalledTimes(1);
});
