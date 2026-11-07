import { expect, it } from 'vitest';
import { quotedMessageInput, quotedPlainText, quotedHtml } from '../src/shared/quoted';
const quote = {
  kind: 'reply' as const,
  from: { name: 'Sender <img src=x>', address: 'sender@example.com' },
  to: [{ name: 'Owner', address: 'owner@iconiclogs.com' }],
  cc: [{ name: 'Copy', address: 'copy@example.com' }],
  date: '2026-11-04T02:00:00.000Z',
  subject: 'Original <script>x</script>',
  text: 'Hello <img src=x>\n> literal original line\nNext & last',
};
it('preserves original metadata and literal greater-than lines without generating quote prefixes', () => {
  expect(quotedMessageInput(quote)).toEqual(quote);
  const plain = quotedPlainText(quote);
  expect(plain).toContain('Từ: Sender <img src=x> <sender@example.com>');
  expect(plain).toContain('Cc: Copy <copy@example.com>');
  expect(plain).toContain('\n\nHello <img src=x>\n> literal original line\nNext & last');
  expect(plain).not.toContain('\n> Hello');
  const html = quotedHtml(quote);
  expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  expect(html).toContain('&lt;img src=x&gt;');
  expect(html).toContain('&gt; literal original line');
  expect(html).not.toMatch(/<img|<script/);
});
it('bounds quote bytes and metadata and rejects arbitrary HTML payloads', () => {
  for (const value of [
    { ...quote, text: 'é'.repeat(65537) },
    { ...quote, subject: 'x'.repeat(1001) },
    { ...quote, from: { name: 'Bad\nFrom', address: 'sender@example.com' } },
    { ...quote, date: 'bad date' },
    { ...quote, html: '<img src=x>' },
    { ...quote, to: Array(101).fill(quote.to[0]) },
  ])
    expect(() => quotedMessageInput(value)).toThrow();
});
