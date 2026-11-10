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
export function loginFailure(error: unknown): MailError {
  if (isAuthError(error))
    return new MailError(
      'LOGIN_FAILED',
      401,
      'Máy chủ Viettel từ chối đăng nhập. Vui lòng kiểm tra tài khoản và mật khẩu.',
    );
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (
    typeof code === 'string' &&
    ['PROVIDER_TIMEOUT', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'ETIMEOUT', 'ETIMEDOUT'].includes(
      code,
    )
  )
    return new MailError(
      'PROVIDER_TIMEOUT',
      504,
      'Kết nối máy chủ thư quá thời gian. Vui lòng thử lại sau.',
    );
  return new MailError(
    'PROVIDER_UNAVAILABLE',
    502,
    'Chưa thể kết nối máy chủ thư. Vui lòng thử lại sau.',
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
