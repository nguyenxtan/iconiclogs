import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { MAX_REQUEST_BYTES } from '../../shared/limits';
import { getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
  Folder,
  MailMessage,
  MessagePage,
  SendDraft,
  SendResult,
  SessionInfo,
  MailFolder,
  MessageFilter,
  MessageAction,
  MailQuota,
  MailPreferences,
  DraftSummary,
  SavedDraft,
} from '../../shared/contracts';
import type { BackupStatus, BackupItem, BackupMonth } from '../../shared/backup';
import { draftId, preferencesInput } from '../storage/personal';
import type { MailAttachment } from '../core/provider';
import { invalid, MailError, unauthorized } from '../core/errors';
import { messageKey, sendInput, folderInput, filterInput, actionInput } from '../core/validation';

export interface MailServices {
  login(input: unknown, ip: string): Promise<{ id: string; session: SessionInfo }>;
  session(id: string): Promise<SessionInfo | null>;
  logout(id: string): Promise<void>;
  list(id: string, folder: Folder, page: number, filter?: MessageFilter): Promise<MessagePage>;
  read(id: string, folder: Folder, messageId: string): Promise<MailMessage>;
  attachment(id: string, folder: Folder, messageId: string, part: number): Promise<MailAttachment>;
  send(id: string, draft: SendDraft, key: string): Promise<SendResult>;
  folders(id: string): Promise<MailFolder[]>;
  createFolder(id: string, name: string): Promise<void>;
  action(id: string, folder: Folder, action: MessageAction): Promise<void>;
  quota(id: string): Promise<MailQuota | null>;
  quotaEvidence?(id: string): Promise<unknown>;
  raw(id: string, folder: Folder, messageId: string): Promise<MailAttachment>;
  preferences(id: string): Promise<MailPreferences>;
  savePreferences(id: string, value: MailPreferences): Promise<MailPreferences>;
  drafts(id: string): Promise<DraftSummary[]>;
  draft(id: string, draftId: string): Promise<SavedDraft>;
  saveDraft(id: string, draftId: string, value: SendDraft, revision: number): Promise<SavedDraft>;
  removeDraft(id: string, draftId: string, revision: number): Promise<void>;
  backupStatus(id: string): Promise<BackupStatus>;
  backupConfigure(id: string, enabled: boolean): Promise<BackupStatus>;
  backupStart(id: string): Promise<BackupStatus>;
  backupStep(id: string): Promise<BackupStatus>;
  backupCatalog(id: string, month?: string): Promise<BackupItem[]>;
  backupMonths(id: string): Promise<BackupMonth[]>;
  backupPackMonth(id: string, month: string): Promise<BackupMonth>;
  backupPackMonthStep(id: string, month: string): Promise<BackupMonth>;
  backupDescribeMonth(
    id: string,
    month: string,
  ): Promise<{ name: string; type: string; size: number }>;
  backupDownloadMonth(
    id: string,
    month: string,
  ): Promise<{ body: ReadableStream<Uint8Array>; name: string; type: string; size: number }>;
  backupDownload(id: string, entry: string): Promise<MailAttachment>;
  backupRestore(id: string, entry: string, folder: Folder, requestId: string): Promise<unknown>;
}
const folderValue = (value = 'inbox'): Folder => folderInput(value);
const loopback = (url: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

export function createApp(services: MailServices, development = false) {
  const app = new Hono<{ Variables: { sessionId: string; session: SessionInfo } }>();
  const cookieName = (url: string) =>
    development && loopback(url) ? 'iconic_session' : '__Host-iconic_session';

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = c.req.header('Origin');
      const local =
        development &&
        loopback(c.req.url) &&
        origin &&
        loopback(origin) &&
        [
          'http://127.0.0.1:6070',
          'http://localhost:6070',
          'http://127.0.0.1:6071',
          'http://localhost:6071',
        ].includes(origin);
      if (!origin || (!local && origin !== new URL(c.req.url).origin))
        throw new MailError('ORIGIN', 403, 'Yêu cầu không được phép.');
    }
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'TOO_LARGE', message: 'Dữ liệu vượt giới hạn.' } }, 413),
    }),
  );
  app.use(
    '/api/login',
    bodyLimit({
      maxSize: 2048,
      onError: (c) =>
        c.json({ error: { code: 'TOO_LARGE', message: 'Thông tin đăng nhập quá dài.' } }, 413),
    }),
  );
  app.use(
    '/api/send',
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'TOO_LARGE', message: 'Thư vượt giới hạn dung lượng.' } }, 413),
    }),
  );
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/login' || c.req.path === '/api/health') return next();
    const id = getCookie(c, cookieName(c.req.url));
    if (!id || !/^[a-f0-9]{64}$/.test(id)) throw unauthorized();
    const session = await services.session(id);
    if (!session || session.expiresAt <= Date.now()) throw unauthorized();
    if (
      !['GET', 'HEAD'].includes(c.req.method) &&
      c.req.header('X-CSRF-Token') !== session.csrfToken
    )
      throw new MailError('CSRF', 403, 'Phiên thao tác không hợp lệ. Vui lòng đăng nhập lại.');
    c.set('sessionId', id);
    c.set('session', session);
    await next();
  });

  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.post('/api/login', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw invalid();
    }
    const { id, session } = await services.login(body, c.req.header('CF-Connecting-IP') || 'local');
    setCookie(c, cookieName(c.req.url), id, {
      path: '/',
      httpOnly: true,
      secure: !(development && loopback(c.req.url)),
      sameSite: 'Strict',
      maxAge: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    });
    return c.json(session);
  });
  app.get('/api/session', (c) => c.json(c.get('session')));
  app.post('/api/logout', async (c) => {
    await services.logout(c.get('sessionId'));
    setCookie(c, cookieName(c.req.url), '', {
      path: '/',
      httpOnly: true,
      secure: !(development && loopback(c.req.url)),
      sameSite: 'Strict',
      maxAge: 0,
    });
    return c.json({ ok: true });
  });
  app.get('/api/messages', async (c) => {
    const folder = folderValue(c.req.query('folder'));
    const raw = c.req.query('page') || '1';
    if (!/^[1-9]\d{0,4}$/.test(raw)) throw invalid();
    return c.json(
      await services.list(
        c.get('sessionId'),
        folder,
        Number(raw),
        filterInput({
          ...c.req.query(),
          ...Object.fromEntries(
            ['unread', 'starred', 'attachments']
              .filter((key) => c.req.query(key) !== undefined)
              .map((key) => [
                key,
                c.req.query(key) === 'true'
                  ? true
                  : c.req.query(key) === 'false'
                    ? false
                    : c.req.query(key),
              ]),
          ),
        }),
      ),
    );
  });
  app.get('/api/messages/:id', async (c) => {
    messageKey(c.req.param('id'));
    return c.json(
      await services.read(
        c.get('sessionId'),
        folderValue(c.req.query('folder')),
        c.req.param('id'),
      ),
    );
  });
  app.get('/api/messages/:id/attachments/:part', async (c) => {
    messageKey(c.req.param('id'));
    const part = c.req.param('part');
    if (!/^\d{1,3}$/.test(part)) throw invalid();
    const file = await services.attachment(
      c.get('sessionId'),
      folderValue(c.req.query('folder')),
      c.req.param('id'),
      Number(part),
    );
    c.header(
      'Content-Disposition',
      `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16))}`,
    );
    c.header('Content-Type', 'application/octet-stream');
    return c.body(new Uint8Array(file.content).buffer);
  });
  app.post('/api/send', async (c) => {
    const key = c.req.header('Idempotency-Key');
    if (!key || !/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw invalid();
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw invalid();
    }
    return c.json(await services.send(c.get('sessionId'), sendInput(body), key));
  });

  const json = async (c: {
    req: { json(): Promise<unknown> };
  }): Promise<Record<string, unknown>> => {
    try {
      const value = await c.req.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
      return value as Record<string, unknown>;
    } catch {
      throw invalid();
    }
  };
  app.get('/api/folders', async (c) => c.json(await services.folders(c.get('sessionId'))));
  app.post('/api/folders', async (c) => {
    const value = await json(c);
    if (typeof value.name !== 'string') throw invalid();
    await services.createFolder(c.get('sessionId'), value.name);
    return c.json({ ok: true });
  });
  app.get('/api/quota', async (c) => c.json(await services.quota(c.get('sessionId'))));
  app.get('/api/quota/evidence', async (c) => {
    if (!services.quotaEvidence) throw new MailError('NOT_FOUND', 404, 'Không có trang này.');
    return c.json(await services.quotaEvidence(c.get('sessionId')));
  });
  app.post('/api/messages/actions', async (c) => {
    const value = await json(c);
    await services.action(c.get('sessionId'), folderInput(value.folder), actionInput(value));
    return c.json({ ok: true });
  });
  app.get('/api/messages/:id/raw', async (c) => {
    messageKey(c.req.param('id'));
    const file = await services.raw(
      c.get('sessionId'),
      folderValue(c.req.query('folder')),
      c.req.param('id'),
    );
    c.header('Content-Disposition', 'attachment; filename="message.eml"');
    c.header('Content-Type', 'application/octet-stream');
    return c.body(new Uint8Array(file.content).buffer);
  });
  app.get('/api/preferences', async (c) => c.json(await services.preferences(c.get('sessionId'))));
  app.post('/api/preferences', async (c) =>
    c.json(await services.savePreferences(c.get('sessionId'), preferencesInput(await json(c)))),
  );
  app.get('/api/drafts', async (c) => c.json(await services.drafts(c.get('sessionId'))));
  app.get('/api/drafts/:id', async (c) =>
    c.json(await services.draft(c.get('sessionId'), draftId(c.req.param('id')))),
  );
  app.post('/api/drafts/:id', async (c) => {
    const value = await json(c);
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw invalid();
    return c.json(
      await services.saveDraft(
        c.get('sessionId'),
        draftId(c.req.param('id')),
        value.draft as SendDraft,
        Number(value.revision),
      ),
    );
  });
  app.delete('/api/drafts/:id', async (c) => {
    const value = await json(c);
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw invalid();
    await services.removeDraft(
      c.get('sessionId'),
      draftId(c.req.param('id')),
      Number(value.revision),
    );
    return c.json({ ok: true });
  });
  app.get('/api/backups', async (c) => c.json(await services.backupStatus(c.get('sessionId'))));
  app.post('/api/backups/configure', async (c) => {
    const value = await json(c);
    if (typeof value.enabled !== 'boolean') throw invalid();
    return c.json(await services.backupConfigure(c.get('sessionId'), value.enabled));
  });
  app.post('/api/backups/start', async (c) =>
    c.json(await services.backupStart(c.get('sessionId'))),
  );
  app.post('/api/backups/step', async (c) => c.json(await services.backupStep(c.get('sessionId'))));
  app.get('/api/backups/catalog', async (c) =>
    c.json(await services.backupCatalog(c.get('sessionId'), c.req.query('month'))),
  );
  app.get('/api/backups/months', async (c) =>
    c.json(await services.backupMonths(c.get('sessionId'))),
  );
  app.post('/api/backups/months/:month/pack', async (c) =>
    c.json(await services.backupPackMonth(c.get('sessionId'), c.req.param('month'))),
  );
  app.post('/api/backups/months/:month/step', async (c) =>
    c.json(await services.backupPackMonthStep(c.get('sessionId'), c.req.param('month'))),
  );
  app.get('/api/backups/months/:month/download', async (c) => {
    const head = c.req.method === 'HEAD';
    const file: { name: string; type: string; size: number; body?: ReadableStream<Uint8Array> } =
      head
        ? await services.backupDescribeMonth(c.get('sessionId'), c.req.param('month'))
        : await services.backupDownloadMonth(c.get('sessionId'), c.req.param('month'));
    return new Response(file.body ?? null, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${file.name}"`,
        'Content-Length': String(file.size),
        'Cache-Control': 'private, no-store',
      },
    });
  });
  app.get('/api/backups/:id/download', async (c) => {
    const file = await services.backupDownload(c.get('sessionId'), c.req.param('id'));
    c.header('Content-Disposition', 'attachment; filename="backup.eml"');
    c.header('Content-Type', 'application/octet-stream');
    return c.body(new Uint8Array(file.content).buffer);
  });
  app.post('/api/backups/restore', async (c) => {
    const value = await json(c);
    if (
      typeof value.id !== 'string' ||
      typeof value.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(value.requestId)
    )
      throw invalid();
    return c.json(
      await services.backupRestore(
        c.get('sessionId'),
        value.id,
        folderInput(value.folder),
        value.requestId,
      ),
    );
  });
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy chức năng.' } }, 404),
  );
  app.onError((error, c) => {
    if (error instanceof MailError)
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as ContentfulStatusCode,
      );
    // Never expose protocol transcripts, credentials or provider exception strings.
    return c.json(
      {
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Không thể kết nối hộp thư. Vui lòng kiểm tra tài khoản hoặc thử lại sau.',
        },
      },
      502,
    );
  });
  return app;
}
