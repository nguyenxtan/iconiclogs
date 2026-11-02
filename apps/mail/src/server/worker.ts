import type { Settings } from './config';
import { configuration } from './config';
import { createApp, type MailServices } from './http/api';
import { loginInput } from './core/validation';
import { unauthorized, MailError, unavailable, SendPreparationError } from './core/errors';
import { sha256 } from './core/session';
import { ViettelProvider } from './providers/viettel';
import { authenticatedCall } from './core/provider';
import { SessionVault, MailboxCoordinator } from './storage/objects';
export { SessionVault, MailboxCoordinator };

export interface Env extends Settings {
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
  return {
    async login(input, ip) {
      const config = configuration(env);
      // Consume before validating identity so disallowed accounts cannot bypass the IP limiter.
      if (!(await env.SESSIONS.getByName('rate:' + (await sha256(ip))).attempt()))
        throw new MailError('RATE_LIMIT', 429, 'Đã thử đăng nhập nhiều lần. Vui lòng đợi 15 phút.');
      const value = loginInput(input, config.allowed);
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
        await new ViettelProvider(value, config.provider).authenticate();
      } catch {
        throw new MailError(
          'LOGIN_FAILED',
          401,
          'Không thể đăng nhập. Kiểm tra tài khoản, mật khẩu hoặc thử lại sau.',
        );
      }
      const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      return { id, session: await vault(id).create(value, id) };
    },
    session: (id) => vault(id).info(),
    logout: (id) => vault(id).revoke(),
    list: async (id, folder, page) => withProvider(id, (client) => client.list(folder, page)),
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
