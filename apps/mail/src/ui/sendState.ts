import type { SendResult } from '../shared/contracts';
export type SendState = 'idle' | 'sending' | 'unknown' | 'failed' | 'delivered';
export function canSend(state: SendState): boolean {
  return state === 'idle' || state === 'failed';
}
export function outcomeNotice(result: SendResult): {
  state: SendState;
  tone: 'success' | 'warning' | 'error';
  message: string;
} {
  if (result.status === 'unknown')
    return {
      state: 'unknown',
      tone: 'warning',
      message:
        'Chưa xác định kết quả gửi. Thư có thể đã được chấp nhận. Đã khóa gửi lại để tránh trùng lặp; hãy kiểm tra với người nhận hoặc quản trị viên.',
    };
  if (result.status === 'failed')
    return {
      state: 'failed',
      tone: 'error',
      message: 'Thư chưa được chấp nhận. Kiểm tra địa chỉ người nhận và thử gửi lại.',
    };
  if (result.status === 'partial')
    return {
      state: 'delivered',
      tone: 'warning',
      message: `Thư đã được chấp nhận cho ${result.accepted.length} người nhận. Không thể gửi đến: ${result.rejected.join(', ')}. Không gửi lại toàn bộ thư để tránh trùng lặp.${result.sentCopy === 'unconfirmed' ? ' Bản trong Đã gửi chưa được xác nhận.' : ''}`,
    };
  if (result.sentCopy === 'unconfirmed')
    return {
      state: 'delivered',
      tone: 'warning',
      message:
        'Máy chủ đã chấp nhận thư, nhưng bản trong Đã gửi chưa được xác nhận. Vui lòng không gửi lại thư này.',
    };
  if (result.sentCopy === 'provider-managed')
    return {
      state: 'delivered',
      tone: 'success',
      message:
        'Máy chủ đã chấp nhận thư. Bản Đã gửi do nhà cung cấp quản lý; webmail chưa xác nhận bản sao.',
    };
  return {
    state: 'delivered',
    tone: 'success',
    message: 'Máy chủ đã chấp nhận thư. Bản sao đã được lưu trong Đã gửi.',
  };
}
