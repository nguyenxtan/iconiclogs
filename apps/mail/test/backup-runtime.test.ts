import { expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

it('runs encrypted capture, R2 integrity, daily revoke and RPC scope checks in native Workers DOs', async () => {
  const root = resolve('apps/mail');
  const temporary = mkdtempSync(join(tmpdir(), 'iconic-backup-runtime-'));
  let runtime: Miniflare | undefined;
  try {
    const config = join(temporary, 'wrangler.json');
    writeFileSync(
      config,
      JSON.stringify({
        name: 'backup-native-test',
        main: join(root, 'test/backup-runtime-worker.ts'),
        compatibility_date: '2026-11-01',
        compatibility_flags: ['nodejs_compat'],
        durable_objects: {
          bindings: [
            { name: 'FIXTURE', class_name: 'NativeBackup' },
            { name: 'BACKUPS', class_name: 'BackupCoordinator' },
          ],
        },
        migrations: [{ tag: 'v1', new_sqlite_classes: ['NativeBackup', 'BackupCoordinator'] }],
        r2_buckets: [{ binding: 'BACKUP_BUCKET', bucket_name: 'private-synthetic' }],
      }),
    );
    execFileSync(
      join(root, 'node_modules/.bin/wrangler'),
      ['deploy', '--dry-run', '--config', config, '--outdir', join(temporary, 'bundle')],
      { stdio: 'pipe', timeout: 30000 },
    );
    runtime = new Miniflare({
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            name: 'backup-native-test',
            compatibilityDate: '2026-11-01',
            compatibilityFlags: ['nodejs_compat'],
            manifest: {
              mainModule: 'backup-runtime-worker.js',
              modules: {
                'backup-runtime-worker.js': {
                  type: 'esm',
                  contents: readFileSync(
                    join(temporary, 'bundle/backup-runtime-worker.js'),
                    'utf8',
                  ),
                },
              },
            },
            env: {
              BACKUP_KEY: { type: 'text', value: Buffer.alloc(32, 19).toString('base64') },
              MAIL_HOST: { type: 'text', value: 'mail.example.test' },
              SENT_MODE: { type: 'text', value: 'append' },
              BACKUP_BUCKET: { type: 'r2', name: 'private-synthetic' },
              FIXTURE: {
                type: 'durable-object',
                worker: 'backup-native-test',
                exportName: 'NativeBackup',
              },
              BACKUPS: {
                type: 'durable-object',
                worker: 'backup-native-test',
                exportName: 'BackupCoordinator',
              },
            },
            exports: {
              NativeBackup: { type: 'durable-object', storage: 'sqlite' },
              BackupCoordinator: { type: 'durable-object', storage: 'sqlite' },
            },
          },
          dev: { rootPath: temporary },
        },
      ],
    });
    const call = async (path: string) => {
      const response = await runtime!.dispatchFetch('http://test.local/' + path);
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json() as Promise<any>;
    };
    expect(await call('expired-resume')).toEqual({
      expiredFailure: true,
      state: 'ready',
      restarted: true,
      intact: true,
    });
    expect((await call('scope')).error.code).toBe('BACKUP_SCOPE');
    expect((await call('revoked')).error.code).toBe('BACKUP_REVOKED');
    const large = await call('large');
    expect(large.run.state).toBe('complete');
    expect(large.nativeBoundary.sizes).toContain(10 * 1024 * 1024);
    expect(large.nativeBoundary.maximumCarry).toBeGreaterThan(6 * 1024 * 1024 - 128 * 1024);
    expect(large.nativeBoundary.maximumCarry).toBeLessThanOrEqual(6 * 1024 * 1024 + 29);
    expect((await call('capture')).run.state).toBe('complete');
    expect((await call('catalog')).length).toBe(1);
    expect((await call('months'))[0].state).toBe('ready');
    expect((await call('monthly-head')).type).toBe('application/zip');
    expect(
      new Uint8Array(
        await (await runtime.dispatchFetch('http://test.local/monthly-download')).arrayBuffer(),
      ).slice(0, 4),
    ).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(await (await runtime.dispatchFetch('http://test.local/download')).text()).toContain(
      'Original MIME',
    );
    expect((await call('enable')).enabled).toBe(true);
    expect(await call('private')).toBe(true);
    expect((await call('disable')).enabled).toBe(false);
    expect((await call('catalog')).length).toBe(1);
    expect((await call('restore')).state).toBe('restored');
    expect((await call('restore')).state).toBe('restored');
    expect(await call('tamper')).toBe(true);
  } finally {
    await runtime?.dispose();
    rmSync(temporary, { recursive: true, force: true });
  }
}, 60000);
