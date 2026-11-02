export class MailError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class ProviderAuthError extends Error {
  constructor() {
    super('MAIL_AUTH_REJECTED');
  }
}
export class SendPreparationError extends MailError {
  constructor() {
    super(
      'SEND_NOT_STARTED',
      409,
      'Thư chưa được gửi. Không thể chuẩn bị thư hoặc mở thư mục Đã gửi. Vui lòng kiểm tra rồi thử lại.',
    );
  }
}
export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    authenticationFailed?: boolean;
    code?: string;
    serverResponseCode?: string;
    message?: string;
  };
  return (
    value.authenticationFailed === true ||
    value.code === 'EAUTH' ||
    value.serverResponseCode === 'AUTHENTICATIONFAILED' ||
    value.message === 'MAIL_AUTH_REJECTED'
  );
}
export const invalid = () =>
  new MailError('INVALID_INPUT', 400, 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.');
export const unauthorized = () =>
  new MailError('SESSION_EXPIRED', 401, 'Phiên đã hết hạn. Vui lòng đăng nhập lại.');
export const unavailable = () =>
  new MailError(
    'UNAVAILABLE',
    503,
    'Webmail chưa sẵn sàng hoặc chưa được bật. Vui lòng liên hệ người quản trị.',
  );
