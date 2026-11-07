import { describe, expect, it } from 'vitest';
import { canSend, outcomeNotice } from '../sendState';

describe('delivery safeguards', () => {
  it('locks sending after an uncertain delivery, including a double click', () => {
    expect(canSend('sending')).toBe(false);
    expect(canSend('unknown')).toBe(false);
    expect(canSend('delivered')).toBe(false);
    expect(canSend('idle')).toBe(true);
    expect(canSend('failed')).toBe(true);
  });
  it('treats accepted mail with an unconfirmed Sent copy as delivered', () => {
    const notice = outcomeNotice({
      status: 'sent',
      sentCopy: 'unconfirmed',
      accepted: ['team@example.test'],
      rejected: [],
    });
    expect(notice.state).toBe('delivered');
    expect(notice.tone).toBe('warning');
    expect(notice.message).toContain('không gửi lại');
  });
  it('locks partial delivery so accepted recipients cannot receive duplicates', () => {
    expect(
      outcomeNotice({
        status: 'partial',
        sentCopy: 'saved',
        accepted: ['a@example.test'],
        rejected: ['b@example.test'],
      }).state,
    ).toBe('delivered');
  });
});
