import { describe, expect, it } from 'vitest';
import { loginInput, sendInput, messageKey } from '../src/server/core/validation';

const draft = {
  to: ['hello@example.com'],
  cc: [],
  subject: 'Chào',
  text: 'Nội dung',
  attachments: [],
};
describe('mail input boundary', () => {
  it('normalizes allowed corporate identity and refuses another domain', () => {
    expect(
      loginInput({ email: ' User@iconiclogs.com ', password: 'private' }, ['user@iconiclogs.com'])
        .email,
    ).toBe('user@iconiclogs.com');
    expect(() =>
      loginInput({ email: 'user@example.com', password: 'private' }, ['user@iconiclogs.com']),
    ).toThrow();
  });
  it('rejects header injection, invalid arrays and reply header injection', () => {
    expect(() =>
      sendInput({ ...draft, to: ['victim@example.com\r\nBcc: other@example.com'] }),
    ).toThrow();
    expect(() => sendInput({ ...draft, to: 'hello@example.com' })).toThrow();
    expect(() =>
      sendInput({ ...draft, inReplyTo: '<ok@example.com>\r\nBcc: leak@example.com' }),
    ).toThrow();
  });
  it('rejects oversized bodies and malformed attachments', () => {
    expect(() => sendInput({ ...draft, text: 'x'.repeat(131073) })).toThrow();
    expect(() =>
      sendInput({
        ...draft,
        attachments: [{ name: '../file', type: 'text/plain', content: '$$' }],
      }),
    ).toThrow();
  });
  it('requires a stable numeric UIDVALIDITY and UID', () => {
    expect(messageKey('123.42')).toEqual({ validity: '123', uid: 42 });
    for (const id of ['123.0', 'INBOX:42', '1.1 OR ALL', '0.2'])
      expect(() => messageKey(id)).toThrow();
  });
});
