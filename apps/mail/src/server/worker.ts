import { PersonalState } from './storage/personal-object';
import { BackupCoordinator, type BackupEnv } from './backup/objects';
import { unwrapRpc } from './core/rpc';
import type { Settings } from './config';
import { configuration } from './config';
import { createApp, type MailServices } from './http/api';
import { loginInput } from './core/validation';
import {
  unauthorized,
  MailError,
  unavailable,
  SendPreparationError,
  loginFailure,
} from './core/errors';
import { sha256 } from './core/session';
import { ViettelProvider } from './providers/viettel';
import { authenticatedCall } from './core/provider';
import { SessionVault, MailboxCoordinator } from './storage/objects';
export { SessionVault, MailboxCoordinator, PersonalState, BackupCoordinator };

export interface Env extends Settings, BackupEnv {
  PERSONAL: DurableObjectNamespace<PersonalState>;
  BACKUPS: DurableObjectNamespace<BackupCoordinator>;
  ASSETS: Fetcher;
  SESSIONS: DurableObjectNamespace<SessionVault>;
  MAILBOXES: DurableObjectNamespace<MailboxCoordinator>;
}

function services(env: Env): MailServices {
  const vault = (id: string) => env.SESSIONS.getByName(id);
  const credentials = async (id: string) => {
    const config = configuration(env);
    const value = await vault(id).credentials(id);
    if (!value) throw unauthorized();
    if (!config.allowed.includes(value.email)) {
      await vault(id).revoke();
      throw unauthorized();
    }
    return value;
  };
  const provider = async (id: string) =>
    new ViettelProvider(await credentials(id), configuration(env).provider);
  function withProvider<T>(id: string, run: (client: ViettelProvider) => Promise<T>): Promise<T> {
    return authenticatedCall(
      async () => run(await provider(id)),
      () => vault(id).revoke(),
    );
  }
  const personal = async (id: string) => {
    const value = await credentials(id);
    return { email: value.email, stub: env.PERSONAL.getByName(await sha256(value.email)) };
  };
  const backup = async (id: string) => {
    const value = await credentials(id);
    return { value, stub: env.BACKUPS.getByName(await sha256(value.email)) };
  };
  return {
    async folders(id) {
      return withProvider(id, (client) => client.folders());
    },
    async createFolder(id, name) {
      return withProvider(id, (client) => client.createFolder(name));
    },
    async action(id, folder, action) {
      return withProvider(id, (client) => client.action(folder, action));
    },
    async quota(id) {
      return withProvider(id, (client) => client.quota());
    },
    async raw(id, folder, messageId) {
      return withProvider(id, (client) => client.raw(folder, messageId));
    },
    async preferences(id) {
      const { email, stub } = await personal(id);
      return unwrapRpc(await stub.preferences(email));
    },
    async savePreferences(id, value) {
      const { email, stub } = await personal(id);
      return unwrapRpc(await stub.savePreferences(email, value));
    },
    async drafts(id) {
      const { email, stub } = await personal(id);
      return unwrapRpc(await stub.drafts(email));
    },
    async draft(id, draftId) {
      const { email, stub } = await personal(id);
      return unwrapRpc(await stub.draft(email, draftId));
    },
    async saveDraft(id, draftId, value, revision) {
      const { email, stub } = await personal(id);
      return unwrapRpc(await stub.saveDraft(email, draftId, value, revision));
    },
    async removeDraft(id, draftId, revision) {
      const { email, stub } = await personal(id);
      return unwrapRpc(await stub.removeDraft(email, draftId, revision));
    },
    async backupStatus(id) {
      const { value, stub } = await backup(id);
      return unwrapRpc(await stub.status(value.email));
    },
    async backupConfigure(id, enabled) {
      const { value, stub } = await backup(id);
      return unwrapRpc(await stub.configure(value, enabled));
    },
    async backupStart(id) {
      const { value, stub } = await backup(id);
      return unwrapRpc(await stub.start(value));
    },
    async backupStep(id) {
      const { value, stub } = await backup(id);
      return unwrapRpc(await stub.step(value));
    },
    async backupCatalog(id) {
      const { value, stub } = await backup(id);
      return unwrapRpc(await stub.catalog(value.email));
    },
    async backupDownload(id, entry) {
      const { value, stub } = await backup(id);
      return unwrapRpc(await stub.download(value.email, entry));
    },
    async backupRestore(id, entry, folder, requestId) {
      const { value, stub } = await backup(id);
      return unwrapRpc(await stub.restore(value, entry, folder, requestId));
    },
    async login(input, ip) {
      console.info('iconic-login-stage', 'rate-ip');
      const config = configuration(env);
      // Consume before validating identity so disallowed accounts cannot bypass the IP limiter.
      if (!(await env.SESSIONS.getByName('rate:' + (await sha256(ip))).attempt()))
        throw new MailError('RATE_LIMIT', 429, 'Đã thử đăng nhập nhiều lần. Vui lòng đợi 15 phút.');
      const value = loginInput(input, config.allowed);
      console.info('iconic-login-stage', 'rate-user');
      if (!(await env.SESSIONS.getByName('account:' + (await sha256(value.email))).attempt()))
        throw new MailError(
          'RATE_LIMIT',
          429,
          'Tài khoản đang tạm giới hạn đăng nhập. Vui lòng thử lại sau.',
        );
      // Validate key before authenticating with the provider.
      try {
        if (atob(config.key).length !== 32) throw Error();
      } catch {
        throw unavailable();
      }
      try {
        console.info('iconic-login-stage', 'provider-start');
        await new ViettelProvider(value, config.provider).authenticate();
        console.info('iconic-login-stage', 'provider-ok');
      } catch (error) {
        console.info('iconic-login-stage', 'provider-error');
        throw loginFailure(error);
      }
      const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      console.info('iconic-login-stage', 'session-start');
      const session = await vault(id).create(value, id);
      console.info('iconic-login-stage', 'complete');
      return { id, session };
    },
    session: (id) => vault(id).info(),
    logout: (id) => vault(id).revoke(),
    list: async (id, folder, page, filter) =>
      withProvider(id, (client) => client.list(folder, page, filter)),
    read: async (id, folder, messageId) =>
      withProvider(id, (client) => client.read(folder, messageId)),
    attachment: async (id, folder, messageId, part) =>
      withProvider(id, (client) => client.attachment(folder, messageId, part)),
    async send(id, draft, key) {
      const value = await credentials(id);
      const outcome = await env.MAILBOXES.getByName(await sha256(value.email)).send(
        value,
        draft,
        key,
      );
      if (outcome.error === 'AUTH') {
        await vault(id).revoke();
        throw unauthorized();
      }
      if (outcome.error === 'PREPARATION') throw new SendPreparationError();
      if (outcome.error === 'CONFLICT')
        throw new MailError('SEND_CONFLICT', 409, 'Yêu cầu gửi đã được dùng cho nội dung khác.');
      return outcome.result!;
    },
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/'))
      return createApp(services(env), env.ENVIRONMENT === 'development').fetch(request, env, ctx);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
