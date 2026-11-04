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

it('keeps Bcc recipients private and uses only the authenticated From address', async () => {
  const raw = await composeMessage(
    'owner@iconiclogs.com',
    {
      to: ['to@example.com'],
      cc: ['copy@example.com'],
      bcc: ['secret@example.com'],
      displayName: 'Nguyễn An',
      subject: 'Private',
      text: 'Body',
      attachments: [],
    },
    '<private@iconiclogs.com>',
  );
  expect(raw.toString()).not.toMatch(/^Bcc:/im);
  expect(raw.toString()).not.toContain('secret@example.com');
  const parsed = await parseMessage(raw);
  expect(parsed.from?.value).toEqual([{ address: 'owner@iconiclogs.com', name: 'Nguyễn An' }]);
  expect(messageBody(parsed).cc).toEqual([{ address: 'copy@example.com', name: '' }]);
});

it('generates a safe company signature alternative at its exact position without duplicating quoted text', async () => {
  const { companySignature } = await import('../src/shared/signature');
  const block = companySignature('owner@iconiclogs.com', 'Nguyễn An', 'Customer Service').text;
  const before = 'Xin chào <img src=x onerror="alert(1)"> & cảm ơn.\n\n';
  const after = '\n\n> Original <script>alert(2)</script>\n> ' + block;
  const draft = {
    to: ['to@example.com'],
    cc: [],
    bcc: ['secret@example.com'],
    displayName: 'Nguyễn An',
    subject: 'Signature',
    text: before + block + after,
    signature: { jobTitle: 'Customer Service', offset: before.length },
    attachments: [],
  };
  const parsed = await parseMessage(
    await composeMessage('owner@iconiclogs.com', draft, '<signature@iconiclogs.com>'),
  );
  expect(parsed.from?.value[0]!.address).toBe('owner@iconiclogs.com');
  expect(parsed.text).toBe(draft.text);
  expect(parsed.html).toContain('<table');
  expect(parsed.html).toContain('color:#801c18');
  expect(parsed.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;');
  expect(parsed.html).toContain('&gt; Original &lt;script&gt;alert(2)&lt;/script&gt;');
  expect(parsed.html).not.toMatch(/<img|<script|secret@example.com/);
  expect((parsed.html as string).match(/<table/g)).toHaveLength(1);
});
it('falls back to the editable plain body when the signature position or authenticated identity differs', async () => {
  const { companySignature } = await import('../src/shared/signature');
  const block = companySignature('other@iconiclogs.com', 'An', '').text;
  const draft = {
    to: ['to@example.com'],
    cc: [],
    displayName: 'An',
    subject: 'Edited',
    text: block,
    signature: { jobTitle: '', offset: 0 },
    attachments: [],
  };
  const parsed = await parseMessage(
    await composeMessage('owner@iconiclogs.com', draft, '<different@iconiclogs.com>'),
  );
  expect(parsed.html).toBe(false);
  expect(parsed.text?.trimEnd()).toBe(block);
  const moved = await parseMessage(
    await composeMessage(
      'other@iconiclogs.com',
      { ...draft, signature: { jobTitle: '', offset: 1 } },
      '<offset@iconiclogs.com>',
    ),
  );
  expect(moved.html).toBe(false);
});
