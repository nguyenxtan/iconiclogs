// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MailMessage } from '../src/shared/contracts';
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
  it('reply-all excludes self and duplicates across To and Cc while quoting every original line', () => {
    const draft = initialComposeDraft({
      reply: original,
      mode: 'replyAll',
      email: 'me@example.com',
      preferences: { displayName: 'My Name', signature: 'Regards\nMe', contacts: [] },
    });
    expect(draft.to).toEqual(['an@example.com', 'b@example.com']);
    expect(draft.cc).toEqual(['c@example.com']);
    expect(draft.inReplyTo).toBe('<original@example.com>');
    expect(draft.text).toContain('> Line one\n> \n> Line three');
    expect(draft.text.indexOf('Regards\nMe')).toBeLessThan(draft.text.indexOf('> Line one'));
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
    expect(draft.text).toContain('Từ: An <an@example.com>');
    expect(draft.text).toContain('Tiêu đề: Booking');
    expect(draft.text).toContain('Line one\n\nLine three');
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
    expect(draft.text).toContain('> Hello & welcome');
    expect(draft.text).toContain('> Next\n> line');
    expect(draft.text).not.toContain('secret-');
    expect(draft.text).not.toContain('tracker');
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
