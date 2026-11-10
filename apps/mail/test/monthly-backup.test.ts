import { expect, it, vi } from 'vitest';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { zipEntry, zipDirectory, zipEnd, monthOf, archivePath } from '../src/server/backup/zip';
it('builds actual Deflate ZIP records with safe deterministic paths and Vietnam months', () => {
  const raw = new TextEncoder().encode('private MIME '.repeat(200));
  const path = archivePath('../Hộp thư/../../evil\\x', 'a'.repeat(64));
  expect(path.split('/')).not.toContain('..');
  expect(path).not.toContain('\\');
  const entry = zipEntry(path, raw, 0);
  expect(entry.bytes.length).toBeLessThan(raw.length);
  expect(inflateRawSync(entry.bytes.slice(entry.record.dataOffset))).toEqual(Buffer.from(raw));
  expect(zipDirectory(entry.record).length).toBeGreaterThan(46);
  expect(zipEnd(1, 100, 100).length).toBe(22);
  expect(monthOf('2026-01-31T16:59:59Z')).toBe('2026-01');
  expect(monthOf('2026-01-31T17:00:00Z')).toBe('2026-02');
});

import { BackupService, type BackupSource } from '../src/server/backup/service';
import { MemoryBucket, finishCapture } from './backup-memory';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupKey, digest, seal } from '../src/server/backup/crypto';
const credentials = { email: 'monthly@example.test', password: 'synthetic' };
function monthlyFixture(large = false) {
  const bucket = new MemoryBucket(),
    rows = new Map<string, unknown>();
  let lostPublication = false,
    appendCount = 0;
  const messages = [
    {
      uid: 1,
      internalDate: '2026-01-31T16:59:59Z',
      flags: ['\\Seen'],
      raw: new TextEncoder().encode('Subject: café\r\n\r\nTiếng Việt ☕'.repeat(50)),
    },
    {
      uid: 2,
      internalDate: '2026-01-31T17:00:00Z',
      flags: ['\\Flagged'],
      raw: large
        ? new Uint8Array(randomBytes(7 * 1024 * 1024))
        : new TextEncoder().encode('MIME attachment\r\n\x00\xff'),
    },
  ];
  const source: BackupSource = {
    quota: async () => ({ used: 80, limit: 100 }),
    snapshot: async () => [
      { path: '../Hộp thư/../../evil\\name', uidValidity: '17', upperUid: messages.length },
    ],
    batch: async (_folder, cursor) => ({
      cursor: messages.length,
      messages: messages.filter((message) => message.uid > cursor),
    }),
    append: async (_folder, raw, flags, date) => {
      appendCount++;
      expect(
        messages.some(
          (message) =>
            Buffer.from(raw).equals(Buffer.from(message.raw)) &&
            message.internalDate === date &&
            JSON.stringify(message.flags) === JSON.stringify(flags),
        ),
      ).toBe(true);
      throw Error('uncertain reply');
    },
  };
  const store = {
    get: async <T>(name: string) => structuredClone(rows.get(name)) as T | undefined,
    put: async (name: string, value: unknown) => {
      if (value instanceof Uint8Array) expect(value.length).toBeLessThanOrEqual(128 * 1024);
      rows.set(name, structuredClone(value));
      if (lostPublication && name.startsWith('month:')) {
        lostPublication = false;
        throw Error('lost publication response');
      }
    },
    delete: async (name: string) => rows.delete(name),
    list: async <T>({
      prefix,
      startAfter,
      limit,
    }: {
      prefix: string;
      startAfter?: string;
      limit?: number;
    }) =>
      new Map(
        [...rows]
          .filter(([name]) => name.startsWith(prefix) && (!startAfter || name > startAfter))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit),
      ) as Map<string, T>,
    setAlarm: async () => {},
    deleteAlarm: async () => {},
  };
  const secret = Buffer.alloc(32, 7).toString('base64');
  const reopen = () => new BackupService(store, bucket, secret, () => source);
  return {
    service: reopen(),
    reopen,
    bucket,
    store,
    rows,
    messages,
    secret,
    appendCount: () => appendCount,
    losePublication: () => {
      lostPublication = true;
    },
  };
}
async function drainMonth(f: ReturnType<typeof monthlyFixture>, month: string) {
  let status = await f.reopen().packMonth(credentials.email, month);
  for (let i = 0; i < 200 && status.state !== 'ready'; i++)
    status = await f.reopen().packMonthStep(credentials.email, month);
  expect(status.state, status.error).toBe('ready');
  return status;
}
async function zipBytes(service: BackupService, month: string) {
  return new Uint8Array(
    await new Response((await service.downloadMonth(credentials.email, month)).body).arrayBuffer(),
  );
}
it('publishes independently readable compressed monthly ZIPs, exact MIME and manifest, then retires staging', async () => {
  const f = monthlyFixture();
  await f.service.start(credentials);
  await finishCapture(f.service, credentials);
  const months = await f.service.months(credentials.email);
  expect(months.map((month) => [month.month, month.count, month.state])).toEqual([
    ['2026-02', 1, 'ready'],
    ['2026-01', 1, 'ready'],
  ]);
  expect(await f.service.catalog(credentials.email, '2026-01')).toHaveLength(1);
  expect([...f.bucket.blobs.keys()].every((key) => key.endsWith('.zip.enc'))).toBe(true);
  const temporary = mkdtempSync(join(tmpdir(), 'monthly-zip-'));
  try {
    for (const month of months) {
      const bytes = await zipBytes(f.service, month.month);
      const path = join(temporary, month.month + '.zip');
      writeFileSync(path, bytes);
      const report = JSON.parse(
        execFileSync(
          'python3',
          [
            '-c',
            `import zipfile,json,hashlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 m=json.loads(z.read('manifest.json'))
 for i in m['messages']:
  assert hashlib.sha256(z.read(i['path'])).hexdigest()==i['sha256']
  assert z.getinfo(i['path']).compress_type==8
  assert '..' not in i['path'].split('/')
 print(json.dumps(m))`,
            path,
          ],
          { encoding: 'utf8' },
        ),
      );
      expect(report.month).toBe(month.month);
      expect(report.mailbox).toBe(credentials.email);
      expect(report.messages[0].folder).toContain('Hộp thư');
      const item = (await f.service.catalog(credentials.email, month.month))[0]!;
      expect((await f.reopen().download(credentials.email, item.id)).content).toEqual(
        f.messages.find((message) => message.uid === item.uid)!.raw,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  const item = (await f.service.catalog(credentials.email))[0]!;
  expect((await f.service.restore(credentials, item.id, 'INBOX', 'one')).state).toBe('uncertain');
  expect((await f.reopen().restore(credentials, item.id, 'inbox', 'two')).state).toBe('uncertain');
  expect(f.appendCount()).toBe(1);
  await expect(f.service.downloadMonth('other@example.test', '2026-01')).rejects.toMatchObject({
    code: 'BACKUP_SCOPE',
  });
  await expect(f.service.packMonth(credentials.email, '2026-13')).rejects.toMatchObject({
    code: 'BACKUP_REQUEST',
  });
});
it('resumes beyond multipart boundaries after lost upload, completion, and publication replies', async () => {
  const f = monthlyFixture(true);
  await f.service.start(credentials);
  await f.service.step(credentials);
  await f.reopen().packMonthStep(credentials.email, '2026-02');
  f.bucket.fault = 'upload';
  let status = await f.reopen().packMonthStep(credentials.email, '2026-02');
  expect(status.state).toBe('error');
  const originalCandidate = [...f.bucket.uploads.values()][0]!.key;
  f.bucket.fault = 'complete';
  f.losePublication();
  status = await drainMonth(f, '2026-02');
  expect(status.archive!.zipBytes).toBeGreaterThan(6 * 1024 * 1024);
  expect(originalCandidate).toContain(status.archive!.id);
  const before = status.archive!.id;
  expect((await f.reopen().packMonth(credentials.email, '2026-02')).archive!.id).toBe(before);
  const item = (await f.service.catalog(credentials.email, '2026-02'))[0]!;
  expect(
    Buffer.from((await f.reopen().download(credentials.email, item.id)).content).equals(
      Buffer.from(f.messages[1]!.raw),
    ),
  ).toBe(true);
  expect((await zipBytes(f.service, '2026-02')).slice(0, 4)).toEqual(
    new Uint8Array([80, 75, 3, 4]),
  );
  const archiveKey = [...f.bucket.blobs.keys()].find((key) => key.endsWith('.zip.enc'))!;
  const encrypted = f.bucket.blobs.get(archiveKey)!;
  encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 1;
  await expect(zipBytes(f.reopen(), '2026-02')).rejects.toThrow();
  await expect(f.reopen().download(credentials.email, item.id)).rejects.toMatchObject({
    code: 'BACKUP_CORRUPT',
  });
  await expect(f.reopen().restore(credentials, item.id, 'INBOX', 'bad')).rejects.toThrow();
  expect(f.appendCount()).toBe(0);
}, 30000);
it('keeps the published archive readable while late mail marks the month stale and rebuilds immutably', async () => {
  const f = monthlyFixture();
  await f.service.start(credentials);
  await finishCapture(f.service, credentials);
  const old = await zipBytes(f.service, '2026-02');
  const oldId = (await f.service.months(credentials.email))[0]!.archive!.id;
  f.messages.push({ ...f.messages[1]!, uid: 3, raw: new TextEncoder().encode('late mail') });
  await f.service.start(credentials);
  await f.service.step(credentials);
  expect((await f.service.months(credentials.email))[0]!.state).toBe('packing');
  expect(await zipBytes(f.service, '2026-02')).toEqual(old);
  await drainMonth(f, '2026-02');
  expect((await f.service.months(credentials.email))[0]!.archive!.id).not.toBe(oldId);
  expect(await f.service.catalog(credentials.email, '2026-02')).toHaveLength(2);
  expect([...f.bucket.blobs.keys()].some((key) => key.includes(oldId))).toBe(true);
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 25 * 3600000);
    await f.reopen().months(credentials.email);
    expect([...f.bucket.blobs.keys()].some((key) => key.includes(oldId))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
it('migrates a preexisting encrypted per-message backup without needing provider credentials', async () => {
  const f = monthlyFixture();
  const raw = f.messages[0]!.raw;
  const scope = await digest(new TextEncoder().encode(credentials.email));
  const key = await backupKey(f.secret);
  const item = {
    id: 'b'.repeat(64),
    folder: 'Legacy',
    uid: 3,
    uidValidity: 'old',
    internalDate: '2025-11-01T00:00:00Z',
    flags: [],
    size: raw.length,
    sha256: await digest(raw),
    capturedAt: '2025-11-01T00:00:00Z',
  };
  await f.store.put('scope', scope);
  await f.store.put(
    'item:' + item.id,
    await seal(new TextEncoder().encode(JSON.stringify(item)), key, `${scope}:item:${item.id}`),
  );
  await f.bucket.put(`${scope}/${item.id}`, await seal(raw, key, `${scope}:mime:${item.id}`));
  expect((await f.service.months(credentials.email))[0]!.state).toBe('pending');
  await drainMonth(f, '2025-11');
  expect(f.bucket.blobs.has(`${scope}/${item.id}`)).toBe(false);
  expect((await f.reopen().download(credentials.email, item.id)).content).toEqual(raw);
});
it('bounds monthly snapshot preparation to at most 32 rows per durable step', async () => {
  const f = monthlyFixture();
  for (let uid = 3; uid <= 40; uid++) f.messages.push({ ...f.messages[1]!, uid });
  let writes = 0;
  const put = f.store.put;
  f.store.put = async (name, value) => {
    if (name.startsWith('zip-entry:')) writes++;
    return put(name, value);
  };
  await f.service.start(credentials);
  await f.service.step(credentials);
  expect(writes).toBeLessThanOrEqual(32);
});
it('packs 120 small messages in bounded batches without catalog scans on status or packing steps', async () => {
  const f = monthlyFixture();
  f.messages[0]!.internalDate = f.messages[1]!.internalDate;
  for (let uid = 3; uid <= 120; uid++) f.messages.push({ ...f.messages[1]!, uid });
  await f.service.start(credentials);
  await f.service.step(credentials);
  let catalogScans = 0;
  const list = f.store.list;
  f.store.list = async (options) => {
    if (options.prefix === 'item:') catalogScans++;
    return list(options);
  };
  let status = (await f.reopen().months(credentials.email))[0]!;
  let steps = 0;
  while (status.state !== 'ready' && steps < 100) {
    status = await f.reopen().packMonthStep(credentials.email, '2026-02');
    steps++;
  }
  expect(status.state, status.error).toBe('ready');
  expect(status.count).toBe(120);
  expect(steps).toBeLessThan(60);
  expect(catalogScans).toBe(0);
  expect([...f.bucket.blobs.keys()].every((key) => key.endsWith('.zip.enc'))).toBe(true);
});
it('never publishes or removes originals when a completed multipart archive fails verification', async () => {
  const f = monthlyFixture();
  await f.service.start(credentials);
  await f.service.step(credentials);
  let archiveKey: string | undefined;
  for (let i = 0; i < 20; i++) {
    await f.reopen().packMonthStep(credentials.email, '2026-02');
    archiveKey = [...f.bucket.blobs.keys()].find((key) => key.endsWith('.zip.enc'));
    if (archiveKey) break;
  }
  expect(archiveKey).toBeDefined();
  const bytes = f.bucket.blobs.get(archiveKey!)!;
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  const failed = await f.reopen().packMonthStep(credentials.email, '2026-02');
  expect(failed.state).toBe('error');
  expect(failed.archive).toBeUndefined();
  const item = (await f.service.catalog(credentials.email, '2026-02'))[0]!;
  expect([...f.bucket.blobs.keys()].some((key) => key.endsWith('/' + item.id))).toBe(true);
  expect((await f.reopen().download(credentials.email, item.id)).content).toEqual(
    f.messages[1]!.raw,
  );
  await expect(f.service.downloadMonth(credentials.email, '2026-02')).rejects.toMatchObject({
    code: 'BACKUP_NOT_FOUND',
  });
  const recovered = await drainMonth(f, '2026-02');
  expect(recovered.archive).toBeDefined();
});
it('reports explicit ZIP32 limits without emitting truncated offsets', () => {
  expect(() => zipEnd(65535, 10, 10)).toThrow('giới hạn');
  expect(() => zipEnd(1, 10, 0x100000000)).toThrow('4 GiB');
});

it('checks published ZIP metadata with R2 HEAD without reading archive bytes', async () => {
  const f = monthlyFixture();
  await f.service.start(credentials);
  await finishCapture(f.service, credentials);
  const get = vi.spyOn(f.bucket, 'get');
  const metadata = await f.reopen().describeMonth(credentials.email, '2026-02');
  expect(metadata.name).toBe('ICONIC-Mail-monthly-2026-02.zip');
  expect(metadata.type).toBe('application/zip');
  expect(metadata.size).toBeGreaterThan(0);
  expect(get).not.toHaveBeenCalled();
  const key = [...f.bucket.blobs.keys()].find((key) => key.includes('/2026/02/'))!;
  f.bucket.blobs.delete(key);
  await expect(f.reopen().describeMonth(credentials.email, '2026-02')).rejects.toMatchObject({
    code: 'BACKUP_CORRUPT',
  });
});

it('restarts an expired unpublished multipart candidate from retained originals while keeping the active ZIP readable', async () => {
  const f = monthlyFixture();
  await f.service.start(credentials);
  await finishCapture(f.service, credentials);
  const old = await zipBytes(f.service, '2026-02');
  const oldId = (await f.service.months(credentials.email))[0]!.archive!.id;
  f.messages.push({
    ...f.messages[1]!,
    uid: 3,
    raw: new TextEncoder().encode('late synthetic mail'),
  });
  await f.service.start(credentials);
  await f.service.step(credentials);
  for (
    let i = 0;
    i < 10 &&
    (!f.bucket.uploads.size || ![...f.bucket.blobs.keys()].some((key) => key.includes('.carry-')));
    i++
  )
    await f.reopen().packMonthStep(credentials.email, '2026-02');
  const expired = [...f.bucket.uploads.values()][0]!;
  expect(expired).toBeDefined();
  expect([...f.bucket.blobs.keys()].some((key) => key.startsWith(expired.key + '.carry-'))).toBe(
    true,
  );
  f.bucket.uploads.clear(); // R2 lifecycle abort after seven paused days.
  let status = await f.reopen().packMonthStep(credentials.email, '2026-02');
  for (let i = 0; i < 10 && status.state !== 'error'; i++)
    status = await f.reopen().packMonthStep(credentials.email, '2026-02');
  expect(status.state).toBe('error');
  expect(status.archive!.id).toBe(oldId);
  expect(await zipBytes(f.reopen(), '2026-02')).toEqual(old);
  status = await f.reopen().packMonthStep(credentials.email, '2026-02');
  expect(status.state).toBe('packing');
  expect(status.archive!.id).toBe(oldId);
  expect(await zipBytes(f.reopen(), '2026-02')).toEqual(old);
  status = await drainMonth(f, '2026-02');
  expect(status.archive!.id).not.toBe(oldId);
  expect(expired.key).not.toContain(status.archive!.id);
  const items = await f.service.catalog(credentials.email, '2026-02');
  expect(items).toHaveLength(2);
  for (const item of items)
    expect((await f.reopen().download(credentials.email, item.id)).content).toEqual(
      f.messages.find((message) => message.uid === item.uid)!.raw,
    );
});
