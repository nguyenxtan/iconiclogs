import type { MailAddress, QuotedMessage } from './contracts';
import { escapeSignatureHtml } from './signature';
export const MAX_QUOTED_BYTES = 128 * 1024;
export class QuotedMessageTooLarge extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid quoted message');
  return value as Record<string, unknown>;
}
function header(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f-\x9f]/.test(value))
    throw Error('Invalid quoted header');
  return value;
}
function address(value: unknown): MailAddress {
  const item = object(value);
  if (Object.keys(item).some((key) => !['name', 'address'].includes(key)))
    throw Error('Invalid quoted address');
  return { name: header(item.name, 200), address: header(item.address, 254) };
}
function addresses(value: unknown): MailAddress[] {
  if (!Array.isArray(value) || value.length > 100) throw Error('Invalid quoted recipients');
  return value.map(address);
}
export function quotedMessageInput(input: unknown): QuotedMessage {
  const value = object(input);
  if (
    typeof value.text === 'string' &&
    new TextEncoder().encode(value.text).length > MAX_QUOTED_BYTES
  )
    throw new QuotedMessageTooLarge();
  if (
    !['reply', 'forward'].includes(value.kind as string) ||
    Object.keys(value).some(
      (key) => !['kind', 'from', 'to', 'cc', 'date', 'subject', 'text'].includes(key),
    ) ||
    typeof value.text !== 'string' ||
    new TextEncoder().encode(value.text).length > MAX_QUOTED_BYTES ||
    /\x00/.test(value.text)
  )
    throw Error('Invalid quoted message');
  const date = header(value.date, 64);
  if (date && !Number.isFinite(Date.parse(date))) throw Error('Invalid quoted date');
  return {
    kind: value.kind as QuotedMessage['kind'],
    from: address(value.from),
    to: addresses(value.to),
    ...(value.cc !== undefined ? { cc: addresses(value.cc) } : {}),
    date,
    subject: header(value.subject, 1000),
    text: value.text,
  };
}
export function quotedAddressLabel(value: MailAddress): string {
  return value.name ? `${value.name} <${value.address}>` : value.address;
}
export function quotedDate(value: string): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(value))
    : 'Không có thông tin ngày';
}
function metadata(quote: QuotedMessage): Array<[string, string]> {
  return [
    ['Từ', quotedAddressLabel(quote.from)],
    ['Ngày', quotedDate(quote.date)],
    ['Tiêu đề', quote.subject],
    ['Đến', quote.to.map(quotedAddressLabel).join(', ')],
    ...(quote.cc?.length
      ? [['Cc', quote.cc.map(quotedAddressLabel).join(', ')] as [string, string]]
      : []),
  ];
}
export function quotedPlainText(quote: QuotedMessage): string {
  return `---------- ${quote.kind === 'forward' ? 'Thư được chuyển tiếp' : 'Nội dung thư trước'} ----------\n${metadata(
    quote,
  )
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')}\n\n${quote.text}`;
}
export function quotedHtml(quote: QuotedMessage): string {
  const escape = escapeSignatureHtml;
  return `<blockquote style="margin:28px 0 0;padding:16px 18px;border-left:3px solid #d2dce2;background:#f6f8f9;color:#42515c;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:11px;font-weight:700;color:#52616c;padding-bottom:10px;">${quote.kind === 'forward' ? 'THƯ ĐƯỢC CHUYỂN TIẾP' : 'NỘI DUNG THƯ TRƯỚC'}</div>${metadata(
    quote,
  )
    .map(
      ([label, value]) =>
        `<div style="font-size:12px;line-height:20px;overflow-wrap:anywhere;"><strong>${label}:</strong> ${escape(value)}</div>`,
    )
    .join(
      '',
    )}<div style="font-size:13px;line-height:1.8;padding-top:15px;white-space:pre-wrap;overflow-wrap:anywhere;">${escape(quote.text)}</div></blockquote>`;
}
