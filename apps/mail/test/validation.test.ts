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

it('validates folders, constrained filters and bulk UID actions', async () => {
  const { folderInput, filterInput, actionInput } = await import('../src/server/core/validation');
  expect(folderInput('folder:Projects%2F2026')).toBe('folder:Projects%2F2026');
  for (const folder of ['other', 'folder:', 'folder:%0A', 'folder:%GG', 'folder:../x'])
    expect(() => folderInput(folder)).toThrow();
  expect(filterInput({ query: ' invoice ', unread: true, after: '2026-01-01' })).toEqual({
    query: 'invoice',
    unread: true,
    after: '2026-01-01',
  });
  for (const filter of [
    { unread: 'false' },
    { before: '2026-02-31' },
    { query: 'x'.repeat(501) },
    { after: '2026-03-01', before: '2026-01-01' },
  ])
    expect(() => filterInput(filter)).toThrow();
  expect(actionInput({ ids: ['123.42', '123.42'], action: 'move', destination: 'trash' })).toEqual({
    ids: ['123.42'],
    action: 'move',
    destination: 'trash',
  });
  for (const action of [
    { ids: [], action: 'read' },
    { ids: ['123.42'], action: 'delete' },
    { ids: ['123.42'], action: 'move' },
    { ids: ['123.42', '124.1'], action: 'star' },
    { ids: Array.from({ length: 101 }, (_, i) => `123.${i + 1}`), action: 'read' },
  ])
    expect(() => actionInput(action)).toThrow();
});
it('validates Bcc and authenticated-account display labels with combined recipient limits', () => {
  expect(
    sendInput({ ...draft, bcc: ['BCC@EXAMPLE.COM'], displayName: ' Nguyễn An ' }),
  ).toMatchObject({ bcc: ['bcc@example.com'], displayName: 'Nguyễn An' });
  for (const extra of [
    { bcc: ['bad\n@example.com'] },
    { displayName: 'An\r\nFrom: stolen@example.com' },
    { displayName: 'x'.repeat(101) },
    { bcc: Array.from({ length: 20 }, (_, i) => `u${i}@example.com`) },
  ])
    expect(() => sendInput({ ...draft, ...extra })).toThrow();
});

it('validates multi-megabyte file encoding without recursive regex stack use', () => {
  const content = 'YWFh'.repeat(1500000);
  expect(
    sendInput({
      to: ['recipient@example.test'],
      cc: [],
      subject: 'large',
      text: '',
      attachments: [{ name: 'large.txt', type: 'text/plain', content }],
    }).attachments[0]?.content.length,
  ).toBe(6000000);
  for (const content of ['a===', 'ab=c', 'a=bc', 'abc!', 'abc', 'ab\nc']) {
    expect(() =>
      sendInput({
        to: ['recipient@example.test'],
        cc: [],
        subject: '',
        text: '',
        attachments: [{ name: 'a', type: 'text/plain', content }],
      }),
    ).toThrow();
  }
});
it('preserves only validated signature descriptors and refuses client HTML or invalid offsets', () => {
  expect(sendInput({ ...draft, signature: { jobTitle: 'Operations', offset: 0 } })).toMatchObject({
    signature: { jobTitle: 'Operations', offset: 0 },
  });
  for (const signature of [
    { jobTitle: '', offset: -1 },
    { jobTitle: '', offset: 1.5 },
    { jobTitle: '', offset: 131073 },
    { jobTitle: '', offset: 0, html: '<img src=x>' },
    { jobTitle: 'x\nY', offset: 0 },
  ])
    expect(() => sendInput({ ...draft, signature })).toThrow();
});
