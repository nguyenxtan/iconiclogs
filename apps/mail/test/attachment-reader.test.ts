import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Reader } from '../src/ui/Reader';
import type { MailMessage } from '../src/shared/contracts';
import type { MailApi } from '../src/ui/api';
const message: MailMessage = {
  id: '1.1',
  from: { name: 'Sender', address: 'sender@example.test' },
  to: [],
  date: '2026-11-04T00:00:00Z',
  subject: 'Fixture',
  text: 'Body',
  unread: false,
  hasAttachments: true,
  attachments: [{ id: 0, name: 'fixture.txt', type: 'text/plain', size: 119 }],
};
const render = (value: MailMessage) =>
  renderToStaticMarkup(
    createElement(Reader, {
      message: value,
      busy: false,
      error: '',
      folder: 'inbox',
      api: {} as MailApi,
      onReply() {},
      onBack() {},
      onError() {},
      onRetry() {},
    }),
  );
it('labels uncertain decoded attachment sizes explicitly rather than showing encoded bytes as exact', () => {
  expect(
    render({
      ...message,
      attachments: [{ ...message.attachments[0]!, size: 164, sizeKnown: false }],
    }),
  ).toContain('Chưa xác định dung lượng');
  expect(render(message)).toContain('119 B');
});
