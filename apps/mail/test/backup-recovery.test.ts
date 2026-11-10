import { expect, it, vi } from 'vitest';
import { BackupService, type BackupSource } from '../src/server/backup/service';
import { MemoryBucket, finishCapture } from './backup-memory';
import { backupKey, digest, seal } from '../src/server/backup/crypto';
import { MailError, ProviderAuthError } from '../src/server/core/errors';
const credentials = { email: 'review@example.test', password: 'synthetic' };
const day = 24 * 3600000;
function fixture() {
  const rows = new Map<string, unknown>(),
    bucket = new MemoryBucket();
  let alarm: number | null = null,
    absent = false,
    revoked = false,
    providerCalls = 0;
  let fault: { prefix: string; when: 'before' | 'after'; operation: 'put' | 'delete' } | undefined;
  const store = {
    get: async <T>(name: string) => structuredClone(rows.get(name)) as T | undefined,
    put: async (name: string, value: unknown) => {
      const fail = fault?.operation === 'put' && name.startsWith(fault.prefix) ? fault : undefined;
      if (fail) fault = undefined;
      if (fail?.when === 'before') throw Error('interrupted before durable write');
      rows.set(name, structuredClone(value));
      if (fail?.when === 'after') throw Error('lost durable write response');
    },
    delete: async (name: string) => {
      const fail =
        fault?.operation === 'delete' && name.startsWith(fault.prefix) ? fault : undefined;
      if (fail) fault = undefined;
      if (fail?.when === 'before') throw Error('interrupted before durable delete');
      const result = rows.delete(name);
      if (fail?.when === 'after') throw Error('lost durable delete response');
      return result;
    },
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
    setAlarm: async (time: number) => {
      alarm = time;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
    getAlarm: async () => alarm,
  };
  const source: BackupSource = {
    quota: async () => ({ used: 80, limit: 100 }),
    snapshot: async () => {
      providerCalls++;
      return [{ path: 'INBOX', uidValidity: '1', upperUid: 1 }];
    },
    batch: async () => {
      providerCalls++;
      return {
        cursor: 1,
        messages: absent
          ? []
          : [
              {
                uid: 1,
                internalDate: '2026-01-01T00:00:00Z',
                flags: [],
                raw: new TextEncoder().encode('Subject: synthetic\r\n\r\noriginal'),
              },
            ],
      };
    },
    append: async () => true,
  };
  const secret = Buffer.alloc(32, 7).toString('base64');
  const reopen = () =>
    new BackupService(store, bucket, secret, () => {
      if (revoked) throw new MailError('BACKUP_REVOKED', 403, 'revoked');
      return source;
    });
  const put = async (name: string, value: unknown) => {
    const scope = await digest(new TextEncoder().encode(credentials.email));
    const key = await backupKey(secret);
    await store.put(
      name,
      await seal(new TextEncoder().encode(JSON.stringify(value)), key, `${scope}:${name}`),
    );
  };
  const retire = async (deleteAfter: number, count = 0) => {
    const archive = { id: 'old', month: '2026-01', key: 'old.zip.enc', count, zipBytes: 22 };
    await bucket.put(archive.key, new Uint8Array([1, 2, 3]));
    await put(`retired:${String(deleteAfter).padStart(16, '0')}:old`, {
      archive,
      deleteAfter,
      index: 0,
    });
    for (let i = 0; i < count; i++) await put(`zip-entry:old:${i}`, { synthetic: i });
  };
  return {
    rows,
    bucket,
    store,
    source,
    reopen,
    put,
    retire,
    alarm: () => alarm,
    providerCalls: () => providerCalls,
    absent: () => {
      absent = true;
    },
    revoke: () => {
      revoked = true;
    },
    fail: (prefix: string, when: 'before' | 'after', operation: 'put' | 'delete' = 'put') => {
      fault = { prefix, when, operation };
    },
    fire: async () => {
      alarm = null;
      await reopen().alarm();
    },
  };
}
for (const prefix of ['item:', 'month-stat:', 'month-item:', 'index-pending']) {
  for (const when of ['before', 'after'] as const) {
    // Before an intent is saved, no metadata has been published and no recovery claim can be made.
    if (prefix === 'index-pending' && when === 'before') continue;
    it(`recovers captured metadata after ${when} ${prefix} interruption without the provider message`, async () => {
      const f = fixture();
      await f.reopen().start(credentials);
      f.fail(prefix, when);
      expect((await f.reopen().step(credentials)).run?.state).toBe('error');
      f.absent();
      expect((await finishCapture(f.reopen(), credentials)).run?.state).toBe('complete');
      const catalog = await f.reopen().catalog(credentials.email, '2026-01');
      expect(catalog).toHaveLength(1);
      expect((await f.reopen().months(credentials.email))[0]).toMatchObject({
        month: '2026-01',
        count: 1,
        state: 'ready',
      });
      expect(
        new TextDecoder().decode(
          (await f.reopen().download(credentials.email, catalog[0]!.id)).content,
        ),
      ).toContain('original');
    });
  }
}
for (const when of ['before', 'after'] as const)
  it(`replays index intent when its deletion fails ${when} persistence`, async () => {
    const f = fixture();
    await f.reopen().start(credentials);
    f.fail('index-pending', when, 'delete');
    expect((await f.reopen().step(credentials)).run?.state).toBe('error');
    f.absent();
    await finishCapture(f.reopen(), credentials);
    expect((await f.reopen().months(credentials.email))[0]).toMatchObject({
      count: 1,
      state: 'ready',
    });
  });
for (const state of ['suspended', 'revoked', 'disabled', 'auth-failure'] as const)
  it(`preserves retirement alarms with ${state} daily capture`, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 1));
    try {
      const f = fixture();
      await f.reopen().status(credentials.email);
      const deadline = Date.now() + 3600000;
      await f.retire(deadline);
      if (state !== 'disabled')
        await f.put('daily', {
          quotaVersion: 1,
          credentials,
          nextRunAt: state === 'auth-failure' ? Date.now() : Date.now() + day,
          ...(state === 'suspended' ? { suspended: true } : {}),
        });
      if (state === 'revoked') f.revoke();
      if (state === 'auth-failure')
        f.source.batch = async () => {
          throw new ProviderAuthError();
        };
      if (state === 'disabled') await f.reopen().configure(credentials, false);
      else await f.fire();
      expect(f.alarm()).toBe(deadline);
      const before = f.providerCalls();
      vi.setSystemTime(deadline);
      await f.fire();
      expect(f.bucket.blobs.has('old.zip.enc')).toBe(false);
      expect([...f.rows.keys()].some((key) => key.startsWith('retired:'))).toBe(false);
      expect(f.providerCalls()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
it('drains multi-batch retired metadata before a later daily deadline without provider work', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 0, 1));
  try {
    const f = fixture();
    await f.reopen().status(credentials.email);
    const dailyAt = Date.now() + day;
    await f.put('daily', { quotaVersion: 1, credentials, nextRunAt: dailyAt });
    await f.retire(Date.now() - 1, 100);
    await f.fire();
    expect(f.alarm()).toBe(Date.now() + 5000);
    expect([...f.rows.keys()].filter((key) => key.startsWith('zip-entry:old:'))).toHaveLength(68);
    for (let i = 0; i < 4 && [...f.rows.keys()].some((key) => key.startsWith('retired:')); i++) {
      vi.setSystemTime(f.alarm()!);
      await f.fire();
    }
    expect(
      [...f.rows.keys()].some(
        (key) => key.startsWith('retired:') || key.startsWith('zip-entry:old:'),
      ),
    ).toBe(false);
    expect(f.providerCalls()).toBe(0);
    expect(f.alarm()).toBe(dailyAt);
  } finally {
    vi.useRealTimers();
  }
});
for (const kind of ['daily', 'cleanup'] as const)
  it(`does not postpone a ${kind} continuation while status is polled`, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 1));
    try {
      const f = fixture();
      await f.reopen().status(credentials.email);
      if (kind === 'daily') {
        await f.reopen().configure(credentials, true);
        vi.setSystemTime(Date.now() + 1000);
        await f.fire();
      } else {
        await f.retire(Date.now() - 1, 1000);
        await f.fire();
      }
      const deadline = f.alarm();
      expect(deadline).toBe(Date.now() + 5000);
      vi.setSystemTime(Date.now() + 1000);
      await f.reopen().status(credentials.email);
      expect(f.alarm()).toBe(deadline);
    } finally {
      vi.useRealTimers();
    }
  });
