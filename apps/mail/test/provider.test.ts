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

function fixture(client: Record<string, unknown>) {
  vi.spyOn(ViettelProvider.prototype, 'connection').mockImplementation(async (operation) =>
    operation(client as unknown as ImapFlow),
  );
  return new ViettelProvider(
    { email: 'fixture@iconiclogs.com', password: 'synthetic' },
    { host: 'mail.example.test', sentMode: 'append' },
  );
}
const boxes = [
  { path: 'INBOX', name: 'Inbox', flags: new Set(), specialUse: '\\Inbox' },
  { path: 'INBOX.Sent Items', name: 'Sent Items', flags: new Set(), specialUse: '\\Sent' },
  { path: 'Projects/2026', name: '2026', flags: new Set() },
];
it('discovers special-use folders and lists encoded custom folders without creating folders', async () => {
  const provider = fixture({ list: async () => boxes });
  expect(
    await provider.folderPath({ list: async () => boxes } as unknown as ImapFlow, 'sent'),
  ).toBe('INBOX.Sent Items');
  expect(await provider.folders()).toEqual([
    { id: 'inbox', name: 'Inbox', role: 'inbox' },
    { id: 'sent', name: 'Sent Items', role: 'sent' },
    { id: 'folder:Projects%2F2026', name: '2026' },
  ]);
  await expect(provider.createFolder('bad\r\nfolder')).rejects.toMatchObject({ status: 400 });
});
it('filters attachment candidates before pagination and returns the exact filtered total', async () => {
  const provider = fixture({
    mailbox: { uidValidity: 123n, exists: 4 },
    getMailboxLock: async () => ({ release() {} }),
    search: async (query: Record<string, unknown>) => {
      expect(query).toMatchObject({
        text: 'invoice',
        seen: false,
        flagged: true,
        from: 'vendor@example.com',
        since: new Date('2026-01-01'),
      });
      return [1, 2, 3, 4];
    },
    fetchAll: async (range: string) =>
      [1, 2, 3, 4]
        .filter((uid) => range.split(',').includes(String(uid)))
        .map((uid) => ({
          uid,
          flags: new Set(['\\Flagged']),
          bodyStructure: uid % 2 === 0 ? { disposition: 'attachment' } : { type: 'text/plain' },
        })),
  });
  const result = await provider.list('inbox', 1, {
    query: 'invoice',
    unread: true,
    starred: true,
    attachments: true,
    from: 'vendor@example.com',
    after: '2026-01-01',
  });
  expect(result.total).toBe(2);
  expect(result.messages.map((m) => m.id)).toEqual(['123.4', '123.2']);
  expect(result.messages.every((m) => m.starred)).toBe(true);
});
it('refuses an attachment query beyond its scan bound rather than truncating results', async () => {
  const provider = fixture({
    mailbox: { uidValidity: 123n, exists: 5001 },
    getMailboxLock: async () => ({ release() {} }),
    search: async () => Array.from({ length: 5001 }, (_, i) => i + 1),
  });
  await expect(provider.list('inbox', 1, { attachments: true })).rejects.toMatchObject({
    code: 'FILTER_TOO_BROAD',
  });
});
it('checks UIDVALIDITY and all existing UIDs before bulk mutation or raw download', async () => {
  const mutate = vi.fn();
  const download = vi.fn();
  const provider = fixture({
    mailbox: { uidValidity: 124n },
    getMailboxLock: async () => ({ release() {} }),
    messageFlagsAdd: mutate,
    download,
  });
  await expect(provider.action('inbox', { ids: ['123.42'], action: 'star' })).rejects.toMatchObject(
    { code: 'MAILBOX_CHANGED' },
  );
  await expect(provider.raw('inbox', '123.42')).rejects.toMatchObject({ code: 'MAILBOX_CHANGED' });
  expect(mutate).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
});
it('moves to an explicitly requested recoverable Trash without retrying uncertain writes', async () => {
  const move = vi.fn().mockRejectedValue(Error('connection lost'));
  const create = vi.fn().mockResolvedValue({ path: 'Trash' });
  const provider = fixture({
    capabilities: new Map([['MOVE', true]]),
    mailbox: { uidValidity: 123n },
    list: async () => boxes,
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () => [{ uid: 42 }],
    mailboxCreate: create,
    messageMove: move,
  });
  await expect(
    provider.action('inbox', { ids: ['123.42'], action: 'move', destination: 'trash' }),
  ).rejects.toMatchObject({ code: 'ACTION_UNCONFIRMED' });
  expect(create).toHaveBeenCalledOnce();
  expect(move).toHaveBeenCalledExactlyOnceWith('42', 'Trash', { uid: true });
});
it('downloads original raw MIME as eml and reports byte quota only when supported', async () => {
  const provider = fixture({
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release() {} }),
    fetchOne: async () => ({ uid: 42, size: 11 }),
    download: async () => ({
      meta: { expectedSize: 11 },
      content: Readable.from([Buffer.from('Subject: x\r\n')]),
    }),
    getQuota: async () => ({
      quotaRoots: [{ quotaRoot: 'Mailbox', storage: { usage: 12, limit: 100 } }],
    }),
  });
  const raw = await provider.raw('inbox', '123.42');
  expect(Buffer.from(raw.content).toString()).toBe('Subject: x\r\n');
  expect(raw.type).toBe('message/rfc822');
  expect(raw.name).toMatch(/\.eml$/);
  expect(await provider.quota()).toMatchObject({ used: 12, limit: 100 });
});
it('uses the mailbox cap and retains shared account pressure separately', async () => {
  const quotaRoots = [
    { quotaRoot: 'Mailbox', storage: { usage: 287345 * 1024, limit: 512000 * 1024 } },
    { quotaRoot: 'cPanel Account', storage: { usage: 4500000 * 1024, limit: 5242880 * 1024 } },
  ];
  for (const roots of [quotaRoots, [...quotaRoots].reverse()]) {
    expect(await fixture({ getQuota: async () => ({ quotaRoots: roots }) }).quota()).toEqual({
      used: 287345 * 1024,
      limit: 524288000,
      roots: roots.map(({ quotaRoot: name, storage }) => ({
        name,
        used: storage.usage,
        limit: storage.limit,
      })),
    });
  }
});
for (const quota of [
  { storage: { usage: 1808752 * 1024, limit: 5368709120 } },
  { quotaRoots: [] },
  {
    quotaRoots: [
      { quotaRoot: 'Mailbox' },
      { quotaRoot: 'Account', storage: { usage: 1, limit: 100 } },
    ],
  },
  { quotaRoots: [{ quotaRoot: 'Mailbox', storage: { usage: -1, limit: 100 } }] },
  { quotaRoots: [{ quotaRoot: 'Mailbox', storage: { usage: 1, limit: 0 } }] },
  {
    quotaRoots: [
      { quotaRoot: 'Mailbox', storage: { usage: 1, limit: Number.MAX_SAFE_INTEGER + 1 } },
    ],
  },
])
  it('fails closed on missing root evidence or invalid STORAGE', async () => {
    expect(await fixture({ getQuota: async () => quota }).quota()).toBeNull();
  });
it('rejects move without native MOVE so the library cannot use a destructive expunge fallback', async () => {
  const move = vi.fn();
  const create = vi.fn();
  const provider = fixture({
    capabilities: new Map(),
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () => [{ uid: 42 }],
    messageMove: move,
    mailboxCreate: create,
  });
  await expect(
    provider.action('inbox', { ids: ['123.42'], action: 'move', destination: 'trash' }),
  ).rejects.toMatchObject({ code: 'MOVE_UNSUPPORTED' });
  expect(move).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
it('refuses a bulk flag operation when even one selected UID disappeared', async () => {
  const mutate = vi.fn();
  const provider = fixture({
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () => [{ uid: 42 }],
    messageFlagsAdd: mutate,
  });
  await expect(
    provider.action('inbox', { ids: ['123.42', '123.43'], action: 'read' }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(mutate).not.toHaveBeenCalled();
});
it.each([
  ['read', 'add', '\\Seen'],
  ['unread', 'remove', '\\Seen'],
  ['star', 'add', '\\Flagged'],
  ['unstar', 'remove', '\\Flagged'],
] as const)(
  'applies %s to UID ranges after validating mailbox identity',
  async (action, method, flag) => {
    const add = vi.fn().mockResolvedValue(true),
      remove = vi.fn().mockResolvedValue(true);
    const provider = fixture({
      mailbox: { uidValidity: 123n },
      getMailboxLock: async () => ({ release() {} }),
      fetchAll: async () => [{ uid: 42 }, { uid: 43 }],
      messageFlagsAdd: add,
      messageFlagsRemove: remove,
    });
    await provider.action('inbox', { ids: ['123.42', '123.43'], action });
    expect(method === 'add' ? add : remove).toHaveBeenCalledExactlyOnceWith('42,43', [flag], {
      uid: true,
    });
  },
);
it('does not claim reading marked a message seen if the server refused the flag change', async () => {
  const provider = fixture({
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release() {} }),
    fetchOne: async () => ({ uid: 42, size: 11, flags: new Set() }),
    download: async () => ({
      meta: { expectedSize: 11 },
      content: Readable.from([Buffer.from('Subject: x\r\n')]),
    }),
    messageFlagsAdd: async () => false,
  });
  await expect(provider.read('inbox', '123.42')).rejects.toMatchObject({
    code: 'ACTION_UNCONFIRMED',
  });
});
it('returns null when storage quota is unsupported rather than inventing free space', async () => {
  expect(await fixture({ getQuota: async () => false }).quota()).toBeNull();
});
it('creates only the explicit user folder and resolves its encoded identifier', async () => {
  const create = vi.fn().mockResolvedValue({ path: 'Projects/2026', created: true });
  const client = { list: async () => boxes, mailboxCreate: create };
  const provider = fixture(client);
  await provider.createFolder('Projects/2026');
  expect(create).toHaveBeenCalledExactlyOnceWith('Projects/2026');
  expect(await provider.folderPath(client as unknown as ImapFlow, 'folder:Projects%2F2026')).toBe(
    'Projects/2026',
  );
});
it('does not enable a MOVE fallback just because inactive IMAP4rev2 was advertised', async () => {
  const move = vi.fn();
  const provider = fixture({
    capabilities: new Map([
      ['IMAP4rev1', true],
      ['IMAP4rev2', true],
    ]),
    enabled: new Set(),
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () => [{ uid: 42 }],
    messageMove: move,
  });
  await expect(
    provider.action('inbox', { ids: ['123.42'], action: 'move', destination: 'trash' }),
  ).rejects.toMatchObject({ code: 'MOVE_UNSUPPORTED' });
  expect(move).not.toHaveBeenCalled();
});
it('reports the downloaded decoded byte count rather than base64 BODYSTRUCTURE octets', async () => {
  const bytes = Buffer.from('x'.repeat(119));
  const raw = Buffer.from(
    `MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="test"\r\n\r\n--test\r\nContent-Type: text/plain\r\n\r\nHello\r\n--test\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="fixture.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n${bytes.toString('base64')}\r\n--test--\r\n`,
  );
  const provider = fixture({
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release() {} }),
    fetchOne: async () => ({
      uid: 42,
      size: raw.length,
      flags: new Set(),
      bodyStructure: {
        type: 'multipart/mixed',
        childNodes: [
          { type: 'text/plain', part: '1', size: 5 },
          {
            type: 'text/plain',
            part: '2',
            size: 164,
            disposition: 'attachment',
            dispositionParameters: { filename: 'fixture.txt' },
          },
        ],
      },
    }),
    download: async () => ({ meta: { expectedSize: raw.length }, content: Readable.from([raw]) }),
    messageFlagsAdd: async () => true,
  });
  expect((await provider.read('inbox', '123.42')).attachments[0]).toMatchObject({
    id: 0,
    name: 'fixture.txt',
    size: 119,
  });
});
it('keeps the readable body when a downloadable attachment part has no safe decoded metadata match', async () => {
  const raw = Buffer.from(
    'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="test"\r\n\r\n--test\r\nContent-Type: text/plain\r\n\r\nReadable body\r\n--test\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="fixture.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAQID\r\n--test--\r\n',
  );
  const provider = fixture({
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release() {} }),
    fetchOne: async () => ({
      uid: 42,
      size: raw.length,
      flags: new Set(),
      bodyStructure: {
        type: 'multipart/mixed',
        childNodes: [
          { type: 'text/plain', part: '1', size: 13 },
          {
            type: 'application/octet-stream',
            part: '9',
            size: 4,
            disposition: 'attachment',
            dispositionParameters: { filename: 'fixture.bin' },
          },
        ],
      },
    }),
    download: async () => ({ meta: { expectedSize: raw.length }, content: Readable.from([raw]) }),
    messageFlagsAdd: async () => true,
  });
  const message = await provider.read('inbox', '123.42');
  expect(message.text.trim()).toBe('Readable body');
  expect(message.attachments[0]).toMatchObject({ id: 0, name: 'fixture.bin', sizeKnown: false });
});
