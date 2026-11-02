export class MailError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const invalid = () =>
  new MailError('INVALID_INPUT', 400, 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.');
export const unauthorized = () =>
  new MailError('SESSION_EXPIRED', 401, 'Phiên đã hết hạn. Vui lòng đăng nhập lại.');
export const unavailable = () =>
  new MailError('UNAVAILABLE', 503, 'Mail chưa sẵn sàng. Vui lòng liên hệ người quản trị.');
