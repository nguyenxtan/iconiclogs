import { afterEach, expect, it, vi } from 'vitest';
import { BackupService, type BackupSource } from '../src/server/backup/service';
import { MailError, ProviderAuthError } from '../src/server/core/errors';
import type { MailQuota } from '../src/shared/contracts';
import { MemoryBucket } from './backup-memory';

const credentials = { email: 'threshold@example.test', password: 'synthetic' };
const hour = 3600000;
function fixture(initial: MailQuota | null = { used: 400000, limit: 500000 }) {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 6));
  const rows = new Map<string, unknown>(),
    bucket = new MemoryBucket();
  let alarm: number | null = null,
    quota = initial,
    error: Error | undefined,
    revoked = false;
  let snapshots = 0,
    batches = 0,
    checks = 0;
  let dailyWrites = 0,
    fault: { at: number; after: boolean } | undefined;
  const source: BackupSource = {
    quota: async () => {
      checks++;
      if (error) throw error;
      return quota;
    },
    snapshot: async () => {
      snapshots++;
      return [{ path: 'INBOX', uidValidity: '1', upperUid: 1 }];
    },
    batch: async (_folder, cursor) => {
      batches++;
      return {
        cursor: 1,
        messages: cursor
          ? []
          : [
              {
                uid: 1,
                flags: [],
                internalDate: '2026-11-01T00:00:00Z',
                raw: new TextEncoder().encode('Subject: synthetic\r\n\r\nquota backup'),
              },
            ],
      };
    },
    append: async () => true,
  };
  const store = {
    get: async <T>(key: string) => structuredClone(rows.get(key)) as T | undefined,
    put: async (key: string, value: unknown) => {
      const fail = key === 'daily' && ++dailyWrites === fault?.at ? fault : undefined;
      if (fail) fault = undefined;
      if (fail && !fail.after) throw Error('interrupted daily write');
      rows.set(key, structuredClone(value));
      if (fail?.after) throw Error('lost daily write reply');
    },
    delete: async (key: string) => rows.delete(key),
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
          .filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit),
      ) as Map<string, T>,
    setAlarm: async (value: number) => {
      alarm = value;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
    getAlarm: async () => alarm,
  };
  const reopen = () =>
    new BackupService(store, bucket, Buffer.alloc(32, 7).toString('base64'), () => {
      if (revoked) throw new MailError('BACKUP_REVOKED', 403, 'revoked');
      return source;
    });
  return {
    reopen,
    source,
    rows,
    bucket,
    counts: () => ({ snapshots, batches, checks }),
    alarm: () => alarm,
    setQuota: (value: MailQuota | null) => {
      quota = value;
    },
    failQuota: (value: Error | undefined) => {
      error = value;
    },
    revoke: () => {
      revoked = true;
    },
    failWrite: (at: number, after: boolean) => {
      fault = { at, after };
    },
    failNextWrite: () => {
      fault = { at: dailyWrites + 1, after: true };
    },
    fire: async () => {
      expect(alarm).not.toBeNull();
      vi.setSystemTime(alarm!);
      alarm = null;
      await reopen().alarm();
    },
  };
}
async function finish(f: ReturnType<typeof fixture>) {
  for (let i = 0; i < 100; i++) {
    const status = await f.reopen().status(credentials.email);
    if (status.run?.state !== 'running') return status;
    await f.fire();
  }
  throw Error('automatic capture did not finish');
}
afterEach(() => vi.useRealTimers());

it('preserves completed automatic cooldown when stored access is disabled and enabled again', async () => {
  const f = fixture();
  await f.reopen().configure(credentials, true);
  await f.fire();
  const terminal = await finish(f);
  await f.reopen().configure(credentials, false);
  expect(f.rows.has('daily')).toBe(false);
  await f.reopen().configure(credentials, true);
  await f.fire();
  expect(f.counts().snapshots).toBe(1);
  expect((await f.reopen().status(credentials.email)).automation?.nextBackupAt).toBe(
    terminal.automation?.nextBackupAt,
  );
});

it('discards an obsolete automatic retry when a replacement manual run is below quota', async () => {
  const f = fixture();
  f.source.batch = async () => {
    throw Error('temporary');
  };
  await f.reopen().configure(credentials, true);
  await f.fire();
  await f.reopen().start(credentials);
  f.setQuota({ used: 1, limit: 100 });
  await f.fire();
  expect(f.counts().checks).toBe(2);
  expect(f.alarm()).toBe(Date.now() + hour);
  await f.fire();
  expect(f.counts().checks).toBe(3);
  expect(f.alarm()).toBe(Date.now() + hour);
});

it('does not transfer a pending automatic intent to a different newer manual run', async () => {
  const f = fixture();
  await f.reopen().configure(credentials, true);
  f.failWrite(2, true);
  await expect(f.fire()).rejects.toThrow();
  f.setQuota({ used: 1, limit: 100 });
  await f.reopen().start(credentials);
  const manualId = (await f.reopen().status(credentials.email)).run!.id;
  await f.fire();
  expect((await f.reopen().status(credentials.email)).run!.id).toBe(manualId);
  expect(f.counts().batches).toBe(0);
  expect(f.alarm()).toBe(Date.now() + hour);
});

it('resumes a later qualifying intent despite the previous completed run remaining in history', async () => {
  const f = fixture();
  await f.reopen().configure(credentials, true);
  await f.fire();
  const complete = await finish(f);
  vi.setSystemTime(complete.automation!.nextBackupAt!);
  // Configure writes1, first automatic run writes2..; fail the next daily write after it commits.
  const put = f.source.quota;
  f.source.quota = async () => {
    f.failNextWrite();
    return put();
  };
  await expect(f.reopen().alarm()).rejects.toThrow();
  f.source.quota = put;
  await f.fire();
  expect((await finish(f)).run?.state).toBe('complete');
  expect(f.counts().snapshots).toBe(2);
});

it('does not adopt a previously failed manual run that the user has since resumed', async () => {
  const f = fixture();
  let attempts = 0;
  f.source.snapshot = async () => [{ path: 'INBOX', uidValidity: '1', upperUid: 2 }];
  f.source.batch = async () => {
    if (!attempts++) throw Error('temporary');
    return { cursor: 1, messages: [] };
  };
  await f.reopen().start(credentials);
  await f.reopen().step(credentials);
  await f.reopen().configure(credentials, true);
  f.failWrite(2, true);
  await expect(f.fire()).rejects.toThrow();
  await f.reopen().step(credentials);
  expect(attempts).toBe(2);
  f.setQuota({ used: 1, limit: 100 });
  await f.fire();
  expect(attempts).toBe(2);
  expect(f.alarm()).toBe(Date.now() + hour);
});

it('checks promptly after opt-in and waits an hour below 80%, even if UI rounding says 80', async () => {
  const f = fixture({ used: 399999, limit: 500000 }),
    now = Date.now();
  await f.reopen().configure(credentials, true);
  expect(f.alarm()).toBe(now + 1000);
  await f.fire();
  expect(f.counts()).toEqual({ snapshots: 0, batches: 0, checks: 1 });
  expect(await f.reopen().status(credentials.email)).toMatchObject({
    enabled: true,
    run: null,
    automation: { thresholdPercent: 80, state: 'below', quota: { used: 399999, limit: 500000 } },
  });
  expect(f.alarm()).toBe(Date.now() + hour);
  f.setQuota({ used: 400000, limit: 500000 });
  await f.fire();
  expect(f.counts().snapshots).toBe(1);
  expect((await finish(f)).run?.state).toBe('complete');
  expect((await f.reopen().months(credentials.email))[0]).toMatchObject({
    month: '2026-11',
    count: 1,
    state: 'ready',
  });
});

for (const used of [400000, 500000])
  it(`starts and publishes a monthly archive at ${used}/500000 bytes`, async () => {
    const f = fixture({ used, limit: 500000 });
    await f.reopen().configure(credentials, true);
    await f.fire();
    expect(f.counts().snapshots).toBe(1);
    f.setQuota({ used: 1, limit: 500000 });
    expect((await finish(f)).run?.state).toBe('complete');
    expect(f.counts().checks).toBe(1);
    expect((await f.reopen().months(credentials.email))[0]?.state).toBe('ready');
  });

for (const quota of [
  null,
  { used: 90, limit: 0 },
  { used: -1, limit: 100 },
  { used: NaN, limit: 100 },
])
  it(`does not capture when provider quota is unavailable or invalid: ${JSON.stringify(quota)}`, async () => {
    const f = fixture(quota);
    await f.reopen().configure(credentials, true);
    await f.fire();
    expect(f.counts()).toEqual({ snapshots: 0, batches: 0, checks: 1 });
    expect((await f.reopen().status(credentials.email)).automation?.state).toBe('unavailable');
    expect(f.alarm()).toBe(Date.now() + hour);
  });

it('keeps hourly quota checks without repeating a completed snapshot until the cooldown passes', async () => {
  const f = fixture();
  await f.reopen().configure(credentials, true);
  await f.fire();
  const complete = await finish(f),
    finished = Date.now();
  expect(complete.automation?.nextBackupAt).toBe(finished + 24 * hour);
  await f.fire();
  expect(f.counts().checks).toBe(2);
  expect(f.counts().snapshots).toBe(1);
  expect(f.alarm()).toBe(Date.now() + hour);
  vi.setSystemTime(finished + 24 * hour);
  await f.reopen().alarm();
  expect(f.counts().snapshots).toBe(2);
});

it('does not take over an unfinished manual capture below the threshold', async () => {
  const f = fixture({ used: 1, limit: 100 });
  await f.reopen().start(credentials);
  await f.reopen().configure(credentials, true);
  await f.fire();
  expect(f.counts()).toEqual({ snapshots: 1, batches: 0, checks: 1 });
  expect(f.alarm()).toBe(Date.now() + hour);
  await f.reopen().step(credentials);
  expect(f.counts().batches).toBe(1);
});

it('records quota errors without starting capture, and suspends rejected authentication', async () => {
  const f = fixture();
  f.failQuota(Error('temporary'));
  await f.reopen().configure(credentials, true);
  await f.fire();
  expect((await f.reopen().status(credentials.email)).automation?.state).toBe('error');
  expect(f.counts().snapshots).toBe(0);
  f.failQuota(new ProviderAuthError());
  await f.fire();
  expect(await f.reopen().status(credentials.email)).toMatchObject({
    enabled: true,
    suspended: true,
    run: null,
  });
  expect(f.alarm()).toBeNull();
});

it('requires opt-in and removes saved access on disable or allowlist revocation', async () => {
  const f = fixture();
  await f.reopen().alarm();
  expect(f.counts().checks).toBe(0);
  await f.reopen().configure(credentials, true);
  await f.reopen().configure(credentials, false);
  await f.reopen().alarm();
  expect(f.counts().checks).toBe(0);
  expect(f.rows.has('daily')).toBe(false);
  await f.reopen().configure(credentials, true);
  f.revoke();
  await f.fire();
  expect((await f.reopen().status(credentials.email)).enabled).toBe(false);
  expect(f.rows.has('daily')).toBe(false);
  expect(f.counts().checks).toBe(0);
});

for (const [at, after] of [
  [2, true],
  [3, false],
  [3, true],
] as const)
  it(`resumes qualified intent after daily write ${at} interruption (${after}) without a second quota gate`, async () => {
    const f = fixture();
    await f.reopen().configure(credentials, true);
    f.failWrite(at, after);
    await expect(f.fire()).rejects.toThrow();
    f.setQuota({ used: 1, limit: 100 });
    await f.fire();
    expect((await finish(f)).run?.state).toBe('complete');
    expect(f.counts().snapshots).toBe(1);
    expect(f.counts().checks).toBe(1);
  });

it('recovers capture failure handling after losing the outcome record write', async () => {
  const f = fixture();
  let attempts = 0;
  f.source.batch = async () => {
    if (!attempts++) throw Error('temporary');
    return { cursor: 1, messages: [] };
  };
  await f.reopen().configure(credentials, true);
  f.failWrite(4, false);
  await expect(f.fire()).rejects.toThrow();
  await f.fire();
  expect((await f.reopen().status(credentials.email)).run?.state).toBe('error');
  await f.fire();
  expect((await finish(f)).run?.state).toBe('complete');
  expect(attempts).toBe(2);
  expect(f.counts().snapshots).toBe(1);
});

it('refreshes rejected capture credentials without losing its owned checkpoint to cooldown', async () => {
  const f = fixture();
  let attempts = 0;
  f.source.batch = async () => {
    if (!attempts++) throw new ProviderAuthError();
    return { cursor: 1, messages: [] };
  };
  await f.reopen().configure(credentials, true);
  await f.fire();
  expect((await f.reopen().status(credentials.email)).suspended).toBe(true);
  await f.reopen().configure(credentials, true);
  await f.fire();
  expect((await finish(f)).run?.state).toBe('complete');
  expect(attempts).toBe(2);
  expect(f.counts().snapshots).toBe(1);
});
