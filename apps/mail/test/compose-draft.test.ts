// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MailMessage, SendDraft } from '../src/shared/contracts';
import {
  initialComposeDraft,
  forwardAttachments,
  contactSuggestions,
} from '../src/ui/composeDraft';

const original: MailMessage = {
  id: '12',
  from: { name: 'An', address: 'an@example.com' },
  to: [
    { name: 'Me', address: 'ME@example.com' },
    { name: 'B', address: 'b@example.com' },
  ],
  cc: [
    { name: 'An again', address: 'AN@example.com' },
    { name: 'C', address: 'c@example.com' },
    { name: 'B again', address: 'B@example.com' },
  ],
  subject: 'Booking',
  date: '2026-11-04T02:00:00Z',
  text: 'Line one\n\nLine three',
  unread: false,
  hasAttachments: false,
  attachments: [],
  messageId: '<original@example.com>',
};
describe('daily compose initialization', () => {
  it('reply-all excludes self and duplicates while preserving original context separately', () => {
    const draft = initialComposeDraft({
      reply: original,
      mode: 'replyAll',
      email: 'me@example.com',
      preferences: { displayName: 'My Name', signature: 'Regards\nMe', contacts: [] },
    });
    expect(draft.to).toEqual(['an@example.com', 'b@example.com']);
    expect(draft.cc).toEqual(['c@example.com']);
    expect(draft.inReplyTo).toBe('<original@example.com>');
    expect(draft.text).toBe('\n\n-- \nRegards\nMe');
    expect(draft.quote?.text).toBe('Line one\n\nLine three');
    expect(draft.quote?.from).toEqual(original.from);
    expect(draft.displayName).toBe('My Name');
  });
  it('replying to own sent mail targets other original recipients and never self', () => {
    const draft = initialComposeDraft({
      reply: { ...original, from: { name: 'Me', address: 'ME@example.com' } },
      email: 'me@example.com',
    });
    expect(draft.to).toEqual(['b@example.com']);
    expect(draft.cc).toEqual([]);
  });
  it('forward starts with no recipients/thread reference and includes original headers and text', () => {
    const draft = initialComposeDraft({
      reply: original,
      mode: 'forward',
      email: 'me@example.com',
    });
    expect(draft.to).toEqual([]);
    expect(draft.cc).toEqual([]);
    expect(draft.inReplyTo).toBeUndefined();
    expect(draft.subject).toBe('Fwd: Booking');
    expect(draft.quote).toMatchObject({
      kind: 'forward',
      from: original.from,
      to: original.to,
      subject: 'Booking',
      text: 'Line one\n\nLine three',
    });
    expect(draft.text).not.toContain('Line one');
  });
  it('HTML-only quotes retain readable text without script/style or fetching remote images', () => {
    const draft = initialComposeDraft({
      reply: {
        ...original,
        text: '',
        html: '<style>secret-style</style><p>Hello &amp; welcome</p><script>secret-script</script><p>Next<br>line</p><img src="https://invalid.example/tracker">',
      },
      email: 'me@example.com',
    });
    expect(draft.quote?.text).toContain('Hello & welcome');
    expect(draft.quote?.text).toContain('Next\nline');
    expect(draft.quote?.text).not.toContain('secret-');
    expect(draft.quote?.text).not.toContain('tracker');
    expect(draft.text).not.toContain('> Hello');
  });
  it('contact completion preserves earlier manually entered recipients', () => {
    expect(
      contactSuggestions('first@example.com, an', [{ name: 'An', address: 'an@example.com' }]),
    ).toEqual([{ name: 'An', value: 'first@example.com, an@example.com' }]);
  });
});
describe('forward attachment safety', () => {
  it('rejects oversized metadata before downloading any original file', async () => {
    let downloads = 0;
    await expect(
      forwardAttachments(
        {
          ...original,
          attachments: [
            { id: 1, name: 'large.zip', type: 'application/zip', size: 8 * 1024 * 1024 },
          ],
        },
        async () => {
          downloads++;
          return new Blob([]);
        },
      ),
    ).rejects.toThrow('7 MB');
    expect(downloads).toBe(0);
  });
  it('rejects actual oversized content even if metadata understated the size', async () => {
    await expect(
      forwardAttachments(
        {
          ...original,
          attachments: [{ id: 1, name: 'large.zip', type: 'application/zip', size: 1 }],
        },
        async () => new Blob([new Uint8Array(7 * 1024 * 1024 + 1)]),
      ),
    ).rejects.toThrow('7 MB');
  });
  it('never returns a partial set if an original attachment cannot be fetched', async () => {
    const message = {
      ...original,
      attachments: [
        { id: 1, name: 'a.txt', type: 'text/plain', size: 2 },
        { id: 2, name: 'b.txt', type: 'text/plain', size: 2 },
      ],
    };
    await expect(
      forwardAttachments(message, async (id) => {
        if (id === 2) throw Error('offline');
        return new Blob(['ok']);
      }),
    ).rejects.toThrow('offline');
    const files = await forwardAttachments(
      { ...message, attachments: message.attachments.slice(0, 1) },
      async () => new Blob(['ok']),
    );
    expect(files).toEqual([{ name: 'a.txt', type: 'text/plain', content: 'b2s=' }]);
  });
});
it('seeds one company signature before quotes and tracks it when typing before the block', async () => {
  const { currentDraftSignature } = await import('../src/ui/composeDraft');
  const draft = initialComposeDraft({
    reply: original,
    mode: 'reply',
    email: 'owner@iconiclogs.com',
    preferences: { displayName: 'An', signature: '', contacts: [] },
  });
  expect(draft.signature).toEqual({ jobTitle: '', offset: 2 });
  expect(draft.text).toContain('ICONIC Logistics');
  expect(draft.quote?.text).toBe(original.text);
  expect(draft.text).not.toContain('> Line one');
  expect(currentDraftSignature(draft, 'Hello\n' + draft.text, 'owner@iconiclogs.com')).toEqual({
    jobTitle: '',
    offset: 8,
  });
  expect(
    currentDraftSignature(
      draft,
      draft.text.replace('ICONIC Logistics', 'Edited company'),
      'owner@iconiclogs.com',
    ),
  ).toBeUndefined();
  expect(
    initialComposeDraft({
      email: 'owner@iconiclogs.com',
      preferences: {
        displayName: 'An',
        signature: 'saved',
        contacts: [],
        signatureSettings: { mode: 'off', jobTitle: '' },
      },
    }).text,
  ).toBe('');
});

function legacyQuote(draft: SendDraft): SendDraft {
  const { quote, ...legacy } = draft;
  if (!quote) return legacy;
  legacy.text +=
    quote.kind === 'forward'
      ? `\n\n---------- Thư được chuyển tiếp ----------\nTừ: old@example.com\n\n${quote.text}`
      : `\n\nVào 04/11/2026, old@example.com đã viết:\n${quote.text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')}`;
  return legacy;
}

it('never promotes an old forwarded signature when the current company block was removed', async () => {
  const { companySignature } = await import('../src/shared/signature');
  const { currentDraftSignature } = await import('../src/ui/composeDraft');
  const email = 'owner@iconiclogs.com',
    name = 'An';
  const block = companySignature(email, name, '').text;
  const initial = legacyQuote(
    initialComposeDraft({
      reply: { ...original, from: { name, address: email }, text: 'Old body\n\n' + block },
      mode: 'forward',
      email,
      preferences: { displayName: name, signature: '', contacts: [] },
    }),
  );
  expect(currentDraftSignature(initial, initial.text.replace(block, ''), email)).toBeUndefined();
  // An identical signature in the untouched original must not disable the new current block.
  expect(currentDraftSignature(initial, 'Hello\n' + initial.text, email)).toEqual({
    jobTitle: '',
    offset: 8,
  });
  expect(
    currentDraftSignature(
      initial,
      initial.text
        .replace(block, '')
        .replace('---------- Thư được chuyển tiếp ----------', 'Edited original divider'),
      email,
    ),
  ).toBeUndefined();
});
it('bounds current signature matching before a reply header even if quoted text is unquoted by editing', async () => {
  const { companySignature } = await import('../src/shared/signature');
  const { currentDraftSignature } = await import('../src/ui/composeDraft');
  const email = 'owner@iconiclogs.com';
  const block = companySignature(email, 'An', '').text;
  const initial = legacyQuote(
    initialComposeDraft({
      reply: { ...original, text: 'Original\n\n' + block },
      mode: 'reply',
      email,
      preferences: { displayName: 'An', signature: '', contacts: [] },
    }),
  );
  const removed = initial.text.replace(block, '').replace(/^> ?/gm, '');
  expect(currentDraftSignature(initial, removed, email)).toBeUndefined();
});

it('falls back when an edited outer forward divider leaves a nested divider after an old signature', async () => {
  const { companySignature } = await import('../src/shared/signature');
  const { currentDraftSignature } = await import('../src/ui/composeDraft');
  const email = 'owner@iconiclogs.com',
    displayName = 'An';
  const block = companySignature(email, displayName, '').text;
  const initial = legacyQuote(
    initialComposeDraft({
      reply: {
        ...original,
        text: 'Old body\n\n' + block + '\n\n---------- Thư được chuyển tiếp ----------\nOlder body',
      },
      mode: 'forward',
      email,
      preferences: { displayName, signature: '', contacts: [] },
    }),
  );
  const edited = initial.text
    .replace(block, '')
    .replace('---------- Thư được chuyển tiếp ----------', '[original message]');
  expect(currentDraftSignature(initial, edited, email)).toBeUndefined();
});
it('requires the exact original quoted tail once at the end before formatting the current signature', async () => {
  const { currentDraftSignature } = await import('../src/ui/composeDraft');
  const email = 'owner@iconiclogs.com';
  const initial = legacyQuote(
    initialComposeDraft({
      reply: original,
      mode: 'forward',
      email,
      preferences: { displayName: 'An', signature: '', contacts: [] },
    }),
  );
  const tail = initial.text.slice(
    initial.text.indexOf('\n---------- Thư được chuyển tiếp ----------\n'),
  );
  for (const edited of [
    initial.text + '\nAfter original',
    initial.text + tail,
    initial.text.replace('Line one', 'Changed original line'),
  ])
    expect(currentDraftSignature(initial, edited, email)).toBeUndefined();
  expect(currentDraftSignature(initial, 'Before signature\n' + initial.text, email)).toEqual({
    jobTitle: '',
    offset: 19,
  });
});

it('keeps literal original greater-than prefixes only in the separate structured quote', () => {
  const draft = initialComposeDraft({
    reply: { ...original, text: 'Ordinary line\n> Existing literal prefix' },
    email: 'owner@iconiclogs.com',
  });
  expect(draft.text).not.toContain('Ordinary line');
  expect(draft.quote?.text).toBe('Ordinary line\n> Existing literal prefix');
});
it('downloads attachments with unknown decoded metadata and enforces their actual bytes', async () => {
  const message = {
    ...original,
    attachments: [
      { id: 0, name: 'unknown.txt', type: 'text/plain', size: 8 * 1024 * 1024, sizeKnown: false },
    ],
  };
  let downloads = 0;
  const files = await forwardAttachments(message, async () => {
    downloads++;
    return new Blob(['x'.repeat(119)]);
  });
  expect(downloads).toBe(1);
  expect(Buffer.from(files[0]!.content, 'base64').length).toBe(119);
  await expect(
    forwardAttachments(message, async () => new Blob([new Uint8Array(7 * 1024 * 1024 + 1)])),
  ).rejects.toThrow('7 MB');
});
