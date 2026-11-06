import { describe, expect, it, vi } from 'vitest';
import { MailError, ProviderAuthError } from '../src/server/core/errors';
import { DefiniteRestoreFailure } from '../src/server/backup/restore';
import { BackupService, type BackupSource } from '../src/server/backup/service';

import { MemoryBucket, finishCapture } from './backup-memory';

const credentials = { email: 'user@iconiclogs.com', password: 'secret-password' };
function fixture() {
  const durable = new Map<string, unknown>();
  const alarms: number[] = [];
  const bucket = new MemoryBucket();
  const blobs = bucket.blobs;
  let appendCount = 0;
  let loseResponse = false;
  let oversized = false;
  let revoked = false;
  const source: BackupSource = {
    snapshot: async () => [{ path: 'INBOX', uidValidity: '5', upperUid: 1 }],
    batch: async (folder, cursor) => ({
      cursor: 1,
      messages: cursor
        ? []
        : [
            {
              uid: 1,
              internalDate: '2026-01-01T00:00:00.000Z',
              flags: ['\\Seen'],
              raw: new TextEncoder().encode('Subject: private\r\n\r\nhello'),
              oversized,
            },
          ],
    }),
    append: async () => {
      appendCount++;
      if (loseResponse) throw Error('lost response');
      return true;
    },
  };
  const store = {
    get: async <T>(key: string) => durable.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      durable.set(key, structuredClone(value));
    },
    delete: async (key: string) => durable.delete(key),
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
        [...durable]
          .filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit),
      ) as Map<string, T>,
    setAlarm: async (time: number) => {
      alarms.push(time);
    },
    deleteAlarm: async () => {},
  };
  const key = Buffer.alloc(32, 7).toString('base64');
  const factory = () => {
    if (revoked) throw new MailError('BACKUP_REVOKED', 403, 'revoked');
    return source;
  };
  const service = new BackupService(store, bucket, key, factory);
  return {
    service,
    alarms,
    reopen: () => new BackupService(store, bucket, key, factory),
    revokeAccess: () => {
      revoked = true;
    },
    durable,
    blobs,
    source,
    appendCount: () => appendCount,
    loseResponse: () => {
      loseResponse = true;
    },
    oversized: () => {
      oversized = true;
    },
  };
}
async function captured(f: ReturnType<typeof fixture>) {
  await f.service.start(credentials);
  await finishCapture(f.service, credentials);
  return (await f.service.catalog(credentials.email))[0]!;
}
describe('encrypted mailbox backups', () => {
  it('captures exact MIME privately and isolates every operation by mailbox', async () => {
    const f = fixture(),
      item = await captured(f);
    expect(
      new TextDecoder().decode((await f.service.download(credentials.email, item.id)).content),
    ).toContain('Subject: private');
    const state = JSON.stringify([...f.durable]);
    expect(state).not.toContain('Subject: private');
    expect(state).not.toContain('INBOX');
    expect(state).not.toContain('secret-password');
    expect(new TextDecoder().decode([...f.blobs.values()][0])).not.toContain('Subject: private');
    await expect(f.service.catalog('other@iconiclogs.com')).rejects.toThrow();
    await expect(f.service.download('other@iconiclogs.com', item.id)).rejects.toThrow();
  });
  it('verifies encrypted content before download or restore', async () => {
    const f = fixture(),
      item = await captured(f);
    const bytes = [...f.blobs.values()][0]!;
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await expect(f.service.download(credentials.email, item.id)).rejects.toThrow();
    await expect(f.service.restore(credentials, item.id, 'INBOX', 'restore-1')).rejects.toThrow();
    expect(f.appendCount()).toBe(0);
  });
  it('persists capture progress and deduplicates repeat runs', async () => {
    const f = fixture();
    await captured(f);
    expect((await f.service.status(credentials.email)).run?.state).toBe('complete');
    await captured(f);
    expect((await f.service.catalog(credentials.email)).length).toBe(1);
    expect(f.blobs.size).toBe(1);
  });
  it('reports skipped oversize content as partial instead of complete', async () => {
    const f = fixture();
    f.oversized();
    await captured(f);
    const status = await f.service.status(credentials.email);
    expect(status.run?.state).toBe('partial');
    expect(status.run?.errors.length).toBeGreaterThan(0);
  });
  it('never repeats APPEND after an unknown result and rejects changed request intent', async () => {
    const f = fixture(),
      item = await captured(f);
    f.loseResponse();
    expect((await f.service.restore(credentials, item.id, 'INBOX', 'restore-1')).state).toBe(
      'uncertain',
    );
    expect((await f.service.restore(credentials, item.id, 'INBOX', 'restore-1')).state).toBe(
      'uncertain',
    );
    expect(f.appendCount()).toBe(1);
    await expect(f.service.restore(credentials, item.id, 'Archive', 'restore-1')).rejects.toThrow();
  });
  it('blocks a new request after an uncertain APPEND across coordinator recreation and inbox aliases', async () => {
    const f = fixture(),
      item = await captured(f);
    f.loseResponse();
    expect((await f.service.restore(credentials, item.id, 'inbox', 'first-tab')).state).toBe(
      'uncertain',
    );
    expect(
      (await f.reopen().restore(credentials, item.id, 'folder:INBOX', 'new-device')).state,
    ).toBe('uncertain');
    expect(f.appendCount()).toBe(1);
    await expect(
      f.reopen().restore(credentials, item.id, 'Archive', 'new-device'),
    ).rejects.toMatchObject({ code: 'BACKUP_CONFLICT' });
  });
  it('reuses a confirmed content-target restore for a new request instead of appending again', async () => {
    const f = fixture(),
      item = await captured(f);
    expect((await f.service.restore(credentials, item.id, 'INBOX', 'first-tab')).state).toBe(
      'restored',
    );
    expect((await f.reopen().restore(credentials, item.id, 'inbox', 'new-device')).state).toBe(
      'restored',
    );
    expect(f.appendCount()).toBe(1);
  });
  it('deduplicates identical MIME from different archived source UIDs', async () => {
    const f = fixture();
    f.source.snapshot = async () => [
      { path: 'INBOX', uidValidity: '5', upperUid: 1 },
      { path: 'Archive', uidValidity: '5', upperUid: 1 },
    ];
    await f.service.start(credentials);
    await finishCapture(f.service, credentials);
    await finishCapture(f.service, credentials);
    const items = await f.service.catalog(credentials.email);
    expect(items).toHaveLength(2);
    await f.service.restore(credentials, items[0]!.id, 'inbox', 'source-one');
    await f.reopen().restore(credentials, items[1]!.id, 'inbox', 'source-two');
    expect(f.appendCount()).toBe(1);
  });
  it('makes proven pre-APPEND failure retryable without weakening uncertain delivery', async () => {
    const f = fixture(),
      item = await captured(f);
    let attempts = 0;
    f.source.append = async () => {
      if (!attempts++) throw new DefiniteRestoreFailure();
      return true;
    };
    await expect(
      f.service.restore(credentials, item.id, 'INBOX', 'safe-retry'),
    ).rejects.toMatchObject({ code: 'BACKUP_RESTORE_FAILED' });
    expect((await f.service.restore(credentials, item.id, 'INBOX', 'safe-retry')).state).toBe(
      'restored',
    );
    expect(attempts).toBe(2);
  });
  it('reuses a verified seen UID without redownloading and repairs a corrupt cache miss', async () => {
    const f = fixture();
    let downloads = 0;
    f.source.batch = async (folder, _cursor, known) => {
      const archiveId = await known?.(folder, 1);
      if (archiveId)
        return {
          cursor: 1,
          messages: [{ uid: 1, archiveId, flags: [], internalDate: '2026-01-01T00:00:00.000Z' }],
        };
      downloads++;
      return {
        cursor: 1,
        messages: [
          {
            uid: 1,
            raw: new TextEncoder().encode('immutable MIME'),
            flags: [],
            internalDate: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
    };
    await captured(f);
    await captured(f);
    expect(downloads).toBe(1);
    const corrupted = [...f.blobs.values()][0]!;
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    await captured(f);
    expect(downloads).toBe(2);
    expect((await f.service.status(credentials.email)).run?.state).toBe('complete');
  });
  it('retries the persisted daily cursor with bounded backoff instead of waiting a day', async () => {
    const f = fixture();
    let failures = 0;
    let snapshots = 0;
    f.source.snapshot = async () => {
      snapshots++;
      return [{ path: 'INBOX', uidValidity: '5', upperUid: 1 }];
    };
    f.source.batch = async () => {
      if (failures++ < 1) throw Error('transient');
      return { cursor: 1, messages: [] };
    };
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await f.service.configure(credentials, true);
      vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);
      await f.service.alarm();
      const failed = await f.service.status(credentials.email),
        retryAt = f.alarms.at(-1)!;
      expect(failed.run?.state).toBe('error');
      expect(retryAt - Date.now()).toBe(30000);
      vi.setSystemTime(retryAt);
      await f.reopen().alarm();
      await finishCapture(f.service, credentials);
      expect((await f.service.status(credentials.email)).run?.state).toBe('complete');
      expect(snapshots).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('resumes a persisted cursor after coordinator recreation', async () => {
    const f = fixture();
    f.source.snapshot = async () => [{ path: 'INBOX', uidValidity: '5', upperUid: 2 }];
    f.source.batch = async (_folder, cursor) => ({
      cursor: cursor + 1,
      messages: [
        {
          uid: cursor + 1,
          internalDate: '2026-01-01T00:00:00.000Z',
          flags: [],
          raw: new TextEncoder().encode('mail-' + cursor),
        },
      ],
    });
    await f.service.start(credentials);
    await f.service.step(credentials);
    expect((await f.service.status(credentials.email)).run?.state).toBe('running');
    const reopened = f.reopen();
    await finishCapture(reopened, credentials);
    expect((await reopened.status(credentials.email)).run?.state).toBe('complete');
    expect((await reopened.catalog(credentials.email)).length).toBe(2);
  });
  it('repairs a missing deterministic object using the fetched original MIME', async () => {
    const f = fixture();
    await captured(f);
    f.blobs.clear();
    await f.service.start(credentials);
    await finishCapture(f.service, credentials);
    expect((await f.service.status(credentials.email)).run?.state).toBe('complete');
    const item = (await f.service.catalog(credentials.email))[0]!;
    expect(
      new TextDecoder().decode((await f.service.download(credentials.email, item.id)).content),
    ).toContain('Subject: private');
  });
  it('resumes the same bounded range after a transient capture failure', async () => {
    const f = fixture();
    let attempts = 0;
    f.source.batch = async () => {
      if (!attempts++) throw Error('temporary');
      return { cursor: 1, messages: [] };
    };
    await f.service.start(credentials);
    await finishCapture(f.service, credentials);
    expect((await f.service.status(credentials.email)).run?.state).toBe('error');
    await f.reopen().step(credentials);
    expect((await f.service.status(credentials.email)).run?.state).toBe('complete');
  });
  it('runs daily captures only with saved opt-in credentials and schedules the following day', async () => {
    const f = fixture();
    let snapshots = 0;
    f.source.snapshot = async () => {
      snapshots++;
      return [{ path: 'INBOX', uidValidity: '5', upperUid: 1 }];
    };
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await f.service.alarm();
      expect(snapshots).toBe(0);
      await f.service.configure(credentials, true);
      await f.service.alarm();
      expect(snapshots).toBe(0);
      vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);
      await f.service.alarm();
      for (
        let i = 0;
        i < 30 && (await f.service.status(credentials.email)).run?.state === 'running';
        i++
      )
        await f.reopen().alarm();
      const status = await f.service.status(credentials.email);
      expect(status.run?.state).toBe('complete');
      expect(snapshots).toBe(1);
      expect(status.nextRunAt).toBeGreaterThan(Date.now());
      await f.service.configure(credentials, false);
      vi.setSystemTime(now + 3 * 24 * 60 * 60 * 1000);
      await f.service.alarm();
      expect(snapshots).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('bounds persisted daily retries and reports exhaustion', async () => {
    const f = fixture();
    let attempts = 0;
    f.source.batch = async () => {
      attempts++;
      throw Error('transient');
    };
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await f.service.configure(credentials, true);
      vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);
      const delays: number[] = [];
      for (let i = 0; i < 6; i++) {
        await f.reopen().alarm();
        const retry = f.alarms.at(-1)!;
        delays.push(retry - Date.now());
        vi.setSystemTime(retry);
      }
      expect(attempts).toBe(6);
      expect(delays).toEqual([30000, 60000, 120000, 240000, 480000, 24 * 60 * 60 * 1000]);
      expect((await f.service.status(credentials.email)).run?.errors.join(' ')).toContain(
        'Đã hết lượt',
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it('suspends daily authentication failures until credentials are explicitly refreshed', async () => {
    const f = fixture();
    let attempts = 0;
    f.source.batch = async () => {
      attempts++;
      throw new ProviderAuthError();
    };
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await f.service.configure(credentials, true);
      vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);
      await f.service.alarm();
      const status = await f.service.status(credentials.email);
      expect(status.enabled).toBe(true);
      expect(status.suspended).toBe(true);
      expect(status.nextRunAt).toBeUndefined();
      expect(status.run?.errors.join(' ')).toContain('thông tin đăng nhập');
      await f.reopen().alarm();
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('revokes saved daily credentials when the administrator removes mailbox access', async () => {
    const f = fixture();
    await captured(f);
    await f.service.configure(credentials, true);
    f.revokeAccess();
    await f.reopen().alarm();
    expect(f.durable.has('daily')).toBe(false);
    expect((await f.service.status(credentials.email)).enabled).toBe(false);
    expect((await f.service.status(credentials.email)).run?.errors.join(' ')).toContain('thu hồi');
    await expect(f.service.configure(credentials, true)).rejects.toMatchObject({
      code: 'BACKUP_REVOKED',
    });
  });
  it('requires explicit opt-in and revokes persistent daily credentials', async () => {
    const f = fixture();
    await f.service.start(credentials);
    expect(f.durable.has('daily')).toBe(false);
    await f.service.configure(credentials, true);
    expect(f.durable.has('daily')).toBe(true);
    expect(JSON.stringify([...f.durable])).not.toContain('secret-password');
    await f.service.configure(credentials, false);
    expect(f.durable.has('daily')).toBe(false);
  });
});

it('counts a retried capture batch once after a later object write fails', async () => {
  const f = fixture();
  f.source.snapshot = async () => [{ path: 'INBOX', uidValidity: '5', upperUid: 2 }];
  f.source.batch = async () => ({
    cursor: 2,
    messages: [1, 2].map((uid) => ({
      uid,
      internalDate: '2026-01-01T00:00:00.000Z',
      flags: [],
      raw: new TextEncoder().encode(`Subject: ${uid}\r\n\r\nbody`),
    })),
  });
  const original = f.blobs.set.bind(f.blobs);
  vi.spyOn(f.blobs, 'set')
    .mockImplementationOnce((key, value) => original(key, value))
    .mockImplementationOnce(() => {
      throw Error('second object write interrupted');
    });
  await f.service.start(credentials);
  expect((await finishCapture(f.service, credentials)).run?.state).toBe('error');
  const resumed = await finishCapture(f.service, credentials);
  expect(resumed.run?.state).toBe('complete');
  expect(resumed.run?.captured).toBe(2);
  expect(await f.service.catalog(credentials.email)).toHaveLength(2);
});
