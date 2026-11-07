import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { ViettelBackupSource } from '../src/server/backup/viettel';
import { ViettelProvider } from '../src/server/providers/viettel';
const folder = { path: 'INBOX', uidValidity: '8', upperUid: 120 };
function adapter(client: any) {
  vi.spyOn(ViettelProvider.prototype, 'connection').mockImplementation(async (operation) =>
    operation(client),
  );
  return new ViettelBackupSource(
    { email: 'fixture@iconiclogs.com', password: 'synthetic' },
    { host: 'mail.example.test', sentMode: 'provider' },
  );
}
afterEach(() => vi.restoreAllMocks());
it('rejects UIDVALIDITY changes before fetching source bytes', async () => {
  const client = {
    mailbox: { uidValidity: 9n },
    getMailboxLock: vi.fn(async () => ({ release() {} })),
    fetchAll: vi.fn(),
  };
  await expect(adapter(client).batch(folder, 0)).rejects.toMatchObject({
    code: 'BACKUP_MAILBOX_CHANGED',
  });
  expect(client.fetchAll).not.toHaveBeenCalled();
});
it('reads one raw MIME in a bounded UID window using read-only selection', async () => {
  const raw = Buffer.from(
    'Subject: original\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x--',
  );
  const client = {
    mailbox: { uidValidity: 8n },
    getMailboxLock: vi.fn(async () => ({ release() {} })),
    fetchAll: vi.fn(async (_range: string) => [
      {
        uid: 3,
        size: raw.length,
        internalDate: new Date('2026-01-01'),
        flags: new Set(['\\Seen']),
      },
    ]),
    download: vi.fn(async () => ({
      meta: { expectedSize: raw.length },
      content: Readable.from([raw]),
    })),
  };
  const result = await adapter(client).batch(folder, 0);
  expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true });
  expect(client.fetchAll.mock.calls[0]![0]).toBe('1:50');
  expect(result.cursor).toBe(3);
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]!.raw).toEqual(new Uint8Array(raw));
});
it('refuses truncated MIME rather than silently completing a capped download', async () => {
  const client = {
    mailbox: { uidValidity: 8n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () => [{ uid: 1, size: 100, internalDate: new Date() }],
    download: async () => ({
      meta: { expectedSize: 100 },
      content: Readable.from([Buffer.from('truncated')]),
    }),
  };
  await expect(adapter(client).batch(folder, 0)).rejects.toThrow('incomplete');
});
it('records oversize as skipped without downloading a partial source', async () => {
  const client = {
    mailbox: { uidValidity: 8n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () => [{ uid: 1, size: 25 * 1024 * 1024 + 1, internalDate: new Date() }],
    download: vi.fn(),
  };
  expect((await adapter(client).batch(folder, 0)).messages[0]!.oversized).toBe(true);
  expect(client.download).not.toHaveBeenCalled();
});
it('restores exact MIME, original date and legal flags with additive APPEND', async () => {
  const client = {
    list: async () => [{ path: 'Archive', flags: new Set() }],
    append: vi.fn(async () => ({ uid: 42 })),
  };
  const raw = new Uint8Array([0, 1, 2, 255]);
  expect(
    await adapter(client).append(
      'Archive',
      raw,
      ['\\Seen', '\\Flagged', '\\Recent', '\\Deleted', '\\Draft'],
      '2026-01-01T00:00:00.000Z',
    ),
  ).toBe(true);
  expect(client.append).toHaveBeenCalledWith(
    'Archive',
    Buffer.from(raw),
    ['\\Seen', '\\Flagged'],
    new Date('2026-01-01T00:00:00.000Z'),
  );
});
it('resolves API Folder aliases before additive APPEND', async () => {
  const client = {
    list: async () => [{ path: 'INBOX', flags: new Set() }],
    append: vi.fn(async (_path: string) => ({ uid: 1 })),
  };
  expect(
    await adapter(client).append('inbox', new Uint8Array([1]), [], '2026-01-01T00:00:00.000Z'),
  ).toBe(true);
  expect(client.append.mock.calls[0]?.[0]).toBe('INBOX');
});
it('discovers selectable folders without opening every mailbox in one request', async () => {
  const client = {
    list: async () => [
      { path: 'INBOX', flags: new Set() },
      { path: 'Parent', flags: new Set(['\\Noselect']) },
    ],
    status: vi.fn(() => {
      throw Error('must defer folder status');
    }),
  };
  expect(await adapter(client).snapshot()).toEqual([
    { path: 'INBOX', uidValidity: '', upperUid: -1 },
  ]);
  expect(client.status).not.toHaveBeenCalled();
});

it('classifies failed preflight as definitely not appended', async () => {
  const client = { list: async () => [], append: vi.fn() };
  await expect(
    adapter(client).append('INBOX', new Uint8Array([1]), [], '2026-01-01'),
  ).rejects.toMatchObject({ name: 'DefiniteRestoreFailure' });
  expect(client.append).not.toHaveBeenCalled();
});
it('captures up to five small messages within the byte budget', async () => {
  const raw = Buffer.alloc(100);
  const client = {
    mailbox: { uidValidity: 8n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () =>
      Array.from({ length: 8 }, (_, i) => ({ uid: i + 1, size: 100, internalDate: new Date() })),
    download: vi.fn(async () => ({ meta: { expectedSize: 100 }, content: Readable.from([raw]) })),
  };
  const result = await adapter(client).batch(folder, 0);
  expect(result.messages).toHaveLength(5);
  expect(result.cursor).toBe(5);
  expect(client.download).toHaveBeenCalledTimes(5);
});
it('keeps a large message alone and stops small batches at two MiB', async () => {
  const raw = Buffer.alloc(1200000);
  const client = {
    mailbox: { uidValidity: 8n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () =>
      [1, 2, 3].map((uid) => ({ uid, size: raw.length, internalDate: new Date() })),
    download: vi.fn(async () => ({
      meta: { expectedSize: raw.length },
      content: Readable.from([raw]),
    })),
  };
  const result = await adapter(client).batch(folder, 0);
  expect(result.messages).toHaveLength(1);
  expect(client.download).toHaveBeenCalledTimes(1);
});

it('does not classify a failed actual APPEND as a safe preflight failure', async () => {
  const failure = Error('lost APPEND response');
  const client = {
    list: async () => [{ path: 'INBOX', flags: new Set() }],
    append: async () => {
      throw failure;
    },
  };
  await expect(adapter(client).append('inbox', new Uint8Array([1]), [], '2026-01-01')).rejects.toBe(
    failure,
  );
});
it('prevents a late preflight continuation from appending after a raced timeout', async () => {
  let resolveList!: (value: any) => void;
  let work!: Promise<unknown>;
  const client = {
    list: () =>
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    append: vi.fn(),
  };
  vi.spyOn(ViettelProvider.prototype, 'connection').mockImplementation(async (operation) => {
    work = operation(client as any);
    void work.catch(() => undefined);
    await Promise.resolve();
    throw Error('deadline');
  });
  const source = new ViettelBackupSource(
    { email: 'fixture@iconiclogs.com', password: 'synthetic' },
    { host: 'mail.example.test', sentMode: 'provider' },
  );
  await expect(source.append('inbox', new Uint8Array([1]), [], '2026-01-01')).rejects.toMatchObject(
    { name: 'DefiniteRestoreFailure' },
  );
  resolveList([{ path: 'INBOX', flags: new Set() }]);
  await expect(work).rejects.toMatchObject({ name: 'DefiniteRestoreFailure' });
  expect(client.append).not.toHaveBeenCalled();
});
it('skips provider downloads for verified cached UIDs and bounds a standalone large message', async () => {
  const raw = Buffer.alloc(3 * 1024 * 1024);
  const client = {
    mailbox: { uidValidity: 8n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () =>
      [1, 2].map((uid) => ({ uid, size: raw.length, internalDate: new Date() })),
    download: vi.fn(async () => ({
      meta: { expectedSize: raw.length },
      content: Readable.from([raw]),
    })),
  };
  const source = adapter(client);
  const cached = await source.batch(folder, 0, async () => 'verified-archive');
  expect(cached.messages).toHaveLength(2);
  expect(client.download).not.toHaveBeenCalled();
  const fresh = await source.batch(folder, 0);
  expect(fresh.messages).toHaveLength(1);
  expect(fresh.messages[0]?.raw?.length).toBe(3 * 1024 * 1024);
  expect(client.download).toHaveBeenCalledTimes(1);
});

it('captures exact 25 MiB MIME without the old ten MiB truncation', async () => {
  const raw = Buffer.alloc(25 * 1024 * 1024, 71);
  const client = {
    mailbox: { uidValidity: 8n },
    getMailboxLock: async () => ({ release() {} }),
    fetchAll: async () => [{ uid: 1, size: raw.length, internalDate: new Date() }],
    download: async () => ({ meta: { expectedSize: raw.length }, content: Readable.from([raw]) }),
  };
  const message = (await adapter(client).batch(folder, 0)).messages[0]!;
  expect(message.oversized).not.toBe(true);
  expect(message.raw?.byteLength).toBe(raw.length);
  expect(message.raw?.[raw.length - 1]).toBe(71);
});
