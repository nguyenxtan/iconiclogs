import type {
  Folder,
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
  messages(folder: Folder, page: number): Promise<MessagePage>;
  message(folder: Folder, id: string): Promise<MailMessage>;
  attachment(folder: Folder, id: string, attachmentId: number): Promise<Blob>;
  send(draft: SendDraft, csrf: string, key: string): Promise<SendResult>;
  logout(csrf: string): Promise<void>;
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
export const liveApi: MailApi = {
  session: () => request('/session'),
  login: (email, password) =>
    request('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  messages: (folder, page) => request(`/messages?folder=${folder}&page=${page}`),
  message: (folder, id) => request(`/messages/${encodeURIComponent(id)}?folder=${folder}`),
  attachment: async (folder, id, attachmentId) => {
    const response = await fetch(
      `/api/messages/${encodeURIComponent(id)}/attachments/${attachmentId}?folder=${folder}`,
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
