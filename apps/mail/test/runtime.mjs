import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';

const runtime = new Miniflare({
  telemetry: { enabled: false },
  workers: [
    {
      config: {
        name: 'runtime-test',
        compatibilityDate: '2026-11-01',
        compatibilityFlags: ['nodejs_compat'],
        manifest: {
          mainModule: 'runtime-worker.js',
          modules: {
            'runtime-worker.js': {
              type: 'esm',
              contents: readFileSync('dist/runtime/runtime-worker.js', 'utf8'),
            },
          },
        },
        env: {
          SESSION_KEY: { type: 'text', value: Buffer.alloc(32, 11).toString('base64') },
          SESSIONS: { type: 'durable-object', worker: 'runtime-test', exportName: 'TestVault' },
        },
        exports: { TestVault: { type: 'durable-object', storage: 'sqlite' } },
      },
      dev: { rootPath: process.cwd() },
    },
  ],
});
const call = async (path) => {
  const response = await runtime.dispatchFetch('http://test.local/' + path);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
try {
  const session = await call('create');
  assert.equal(session.email, 'fixture@iconiclogs.com');
  assert.equal(JSON.stringify(session).includes('synthetic-password-only'), false);
  assert.equal(await call('credentials'), true);
  await call('expire');
  // Allow the native alarm to run without another credential/info request.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(await call('exists'), false, 'native alarm must delete encrypted credentials');
  await call('create');
  assert.equal(await call('revoke'), null);
  assert.equal(await call('exists'), false);
  for (let attempt = 0; attempt < 10; attempt++) assert.equal(await call('rate'), true);
  assert.equal(await call('rate'), false);
  console.log(
    'Native Workers/SQLite Durable Objects: encrypted session RPC, alarm expiry, revoke and rate limit PASS',
  );
} finally {
  await runtime.dispose();
}
