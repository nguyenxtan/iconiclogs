// LOCAL TEST ENTRY ONLY. Never referenced by production Wrangler configuration.
import { SessionVault } from '../src/server/storage/objects';
import type { Env } from '../src/server/worker';
import type { SessionRecord } from '../src/server/core/session';

export class TestVault extends SessionVault {
  async expireSoon() {
    const record = await this.ctx.storage.get<SessionRecord>('session');
    if (!record) throw Error('missing fixture');
    record.expiresAt = Date.now() + 100;
    await this.ctx.storage.put('session', record);
    await this.ctx.storage.setAlarm(record.expiresAt);
  }
  async exists() {
    return !!(await this.ctx.storage.get('session'));
  }
}
interface TestEnv extends Omit<Env, 'SESSIONS'> {
  SESSIONS: DurableObjectNamespace<TestVault>;
}
export default {
  async fetch(request: Request, env: TestEnv) {
    const url = new URL(request.url);
    const vault = env.SESSIONS.getByName('native-test-session');
    const action = url.pathname;
    if (action === '/create') {
      const info = await vault.create(
        { email: 'fixture@iconiclogs.com', password: 'synthetic-password-only' },
        'native-test-session',
      );
      return Response.json(info);
    }
    if (action === '/credentials')
      return Response.json(
        (await vault.credentials('native-test-session'))?.password === 'synthetic-password-only',
      );
    if (action === '/expire') {
      await vault.expireSoon();
      return Response.json(true);
    }
    if (action === '/exists') return Response.json(await vault.exists());
    if (action === '/revoke') {
      await vault.revoke();
      return Response.json(await vault.info());
    }
    if (action === '/rate') {
      const rate = env.SESSIONS.getByName('rate-test');
      return Response.json(await rate.attempt());
    }
    return Response.json(await vault.info());
  },
};
