import { expect, it } from 'vitest';
import { composeMessage, messageBody, parseMessage } from '../src/server/providers/mime';

it('roundtrips Vietnamese body, reply identity and real attachments through MIME', async () => {
  const raw = await composeMessage(
    'user@iconiclogs.com',
    {
      to: ['to@example.com'],
      cc: [],
      subject: 'Hồ sơ lô hàng',
      text: 'Chào anh, đây là hồ sơ.',
      inReplyTo: '<original@example.com>',
      attachments: [
        {
          name: 'ho-so.txt',
          type: 'text/plain',
          content: Buffer.from('dữ liệu').toString('base64'),
        },
      ],
    },
    '<stable@iconiclogs.com>',
  );
  const parsed = await parseMessage(raw),
    body = messageBody(parsed);
  expect(parsed.subject).toBe('Hồ sơ lô hàng');
  expect(body.text.trim()).toBe('Chào anh, đây là hồ sơ.');
  expect(parsed.inReplyTo).toBe('<original@example.com>');
  expect(parsed.messageId).toBe('<stable@iconiclogs.com>');
  expect(parsed.attachments[0]!.content.toString()).toBe('dữ liệu');
  expect(body.attachments[0]!.name).toBe('ho-so.txt');
});
