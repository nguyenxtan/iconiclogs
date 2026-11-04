import type { BackupStatus, BackupItem, BackupRestore } from '../shared/backup';
import type {
  Folder,
  MailFolder,
  MessageFilter,
  MessageAction,
  MailQuota,
  MailPreferences,
  DraftSummary,
  SavedDraft,
  MailMessage,
  MessagePage,
  SendDraft,
  SendResult,
  SessionInfo,
} from '../shared/contracts';

export class MailApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface MailApi {
  session(): Promise<SessionInfo>;
  login(email: string, password: string): Promise<SessionInfo>;
  messages(folder: Folder, page: number, filter?: MessageFilter): Promise<MessagePage>;
  message(folder: Folder, id: string): Promise<MailMessage>;
  attachment(folder: Folder, id: string, attachmentId: number): Promise<Blob>;
  send(draft: SendDraft, csrf: string, key: string): Promise<SendResult>;
  logout(csrf: string): Promise<void>;
  folders(): Promise<MailFolder[]>;
  createFolder(name: string, csrf: string): Promise<void>;
  action(folder: Folder, action: MessageAction, csrf: string): Promise<void>;
  quota(): Promise<MailQuota | null>;
  raw(folder: Folder, id: string): Promise<Blob>;
  preferences(): Promise<MailPreferences>;
  savePreferences(value: MailPreferences, csrf: string): Promise<MailPreferences>;
  drafts(): Promise<DraftSummary[]>;
  draft(id: string): Promise<SavedDraft>;
  saveDraft(id: string, draft: SendDraft, revision: number, csrf: string): Promise<SavedDraft>;
  removeDraft(id: string, revision: number, csrf: string): Promise<void>;
  backupStatus(): Promise<BackupStatus>;
  backupConfigure(enabled: boolean, csrf: string): Promise<BackupStatus>;
  backupStart(csrf: string): Promise<BackupStatus>;
  backupStep(csrf: string): Promise<BackupStatus>;
  backupCatalog(): Promise<BackupItem[]>;
  backupDownload(id: string): Promise<Blob>;
  backupRestore(
    id: string,
    folder: Folder,
    requestId: string,
    csrf: string,
  ): Promise<BackupRestore>;
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(90_000),
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new MailApiError(
      response.status,
      data?.error?.code ?? 'REQUEST_FAILED',
      data?.error?.message ?? 'Không thể kết nối dịch vụ thư. Vui lòng thử lại.',
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
async function download(path: string): Promise<Blob> {
  const response = await fetch('/api' + path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok)
    throw new MailApiError(response.status, 'DOWNLOAD_FAILED', 'Không thể tải bản sao thư.');
  return response.blob();
}
const mutation = (path: string, csrf: string, body?: unknown, method = 'POST') => ({
  path,
  init: {
    method,
    headers: { 'X-CSRF-Token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  },
});
function mutate<T>(path: string, csrf: string, body?: unknown, method = 'POST'): Promise<T> {
  const value = mutation(path, csrf, body, method);
  return request(value.path, value.init);
}
export const liveApi: MailApi = {
  folders: () => request('/folders'),
  createFolder: (name, csrf) => mutate('/folders', csrf, { name }),
  action: (folder, action, csrf) => mutate('/messages/actions', csrf, { folder, ...action }),
  quota: () => request('/quota'),
  raw: (folder, id) =>
    download(`/messages/${encodeURIComponent(id)}/raw?folder=${encodeURIComponent(folder)}`),
  preferences: () => request('/preferences'),
  savePreferences: (value, csrf) => mutate('/preferences', csrf, value),
  drafts: () => request('/drafts'),
  draft: (id) => request('/drafts/' + encodeURIComponent(id)),
  saveDraft: (id, draft, revision, csrf) =>
    mutate('/drafts/' + encodeURIComponent(id), csrf, { draft, revision }),
  removeDraft: (id, revision, csrf) =>
    mutate('/drafts/' + encodeURIComponent(id), csrf, { revision }, 'DELETE'),
  backupStatus: () => request('/backups'),
  backupConfigure: (enabled, csrf) => mutate('/backups/configure', csrf, { enabled }),
  backupStart: (csrf) => mutate('/backups/start', csrf),
  backupStep: (csrf) => mutate('/backups/step', csrf),
  backupCatalog: () => request('/backups/catalog'),
  backupDownload: (id) => download('/backups/' + encodeURIComponent(id) + '/download'),
  backupRestore: (id, folder, requestId, csrf) =>
    mutate('/backups/restore', csrf, { id, folder, requestId }),
  session: () => request('/session'),
  login: (email, password) =>
    request('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  messages: (folder, page, filter = {}) =>
    request(
      '/messages?' +
        new URLSearchParams({
          folder,
          page: String(page),
          ...Object.fromEntries(
            Object.entries(filter)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, String(value)]),
          ),
        }),
    ),
  message: (folder, id) =>
    request(`/messages/${encodeURIComponent(id)}?folder=${encodeURIComponent(folder)}`),
  attachment: async (folder, id, attachmentId) => {
    const response = await fetch(
      `/api/messages/${encodeURIComponent(id)}/attachments/${attachmentId}?folder=${encodeURIComponent(folder)}`,
      { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(90_000) },
    );
    if (!response.ok)
      throw new MailApiError(response.status, 'DOWNLOAD_FAILED', 'Không thể tải tệp đính kèm.');
    return response.blob();
  },
  send: (draft, csrf, key) =>
    request('/send', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': key },
      body: JSON.stringify(draft),
    }),
  logout: (csrf) => request('/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }),
};
export function errorMessage(error: unknown): string {
  return error instanceof MailApiError
    ? error.message
    : 'Mất kết nối với dịch vụ thư. Vui lòng kiểm tra kết nối và thử lại.';
}
