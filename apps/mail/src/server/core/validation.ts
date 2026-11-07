import { quotedMessageInput, QuotedMessageTooLarge } from '../../shared/quoted';
import { signaturePayloadInput } from '../../shared/signature';
import type { Folder, MessageAction, MessageFilter, SendDraft } from '../../shared/contracts';
import { invalid, MailError } from './errors';

import { MAX_MIME_BYTES, MAX_COMPOSE_BYTES } from '../../shared/limits';
export const MAX_MIME = MAX_MIME_BYTES;
import { validEmail } from '../../shared/email';
export { validEmail } from '../../shared/email';
const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  return input as Record<string, unknown>;
};

export function loginInput(input: unknown, allowed: string[]) {
  const body = object(input);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (
    !validEmail(email) ||
    !allowed.includes(email) ||
    typeof body.password !== 'string' ||
    !body.password ||
    body.password.length > 1024
  ) {
    throw new MailError(
      'LOGIN_FAILED',
      401,
      'Không thể đăng nhập. Kiểm tra tài khoản và mật khẩu.',
    );
  }
  return { email, password: body.password };
}

export function validBase64(value: string): boolean {
  if (value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) return false;
  const firstPadding = value.indexOf('=');
  if (firstPadding < 0) return true;
  return (
    (firstPadding === value.length - 1 || firstPadding === value.length - 2) &&
    value
      .slice(firstPadding)
      .split('')
      .every((char) => char === '=')
  );
}

function recipients(input: unknown, required = false): string[] {
  if (!Array.isArray(input) || input.length > 20 || (required && !input.length)) throw invalid();
  if (!input.every(validEmail)) throw invalid();
  return [...new Set(input.map((value: string) => value.toLowerCase()))];
}

export function sendInput(input: unknown): SendDraft {
  const body = object(input);
  const to = recipients(body.to, true),
    cc = recipients(body.cc ?? []),
    bcc = recipients(body.bcc ?? []);
  if (
    to.length + cc.length + bcc.length > 20 ||
    typeof body.subject !== 'string' ||
    body.subject.length > 200 ||
    /[\r\n\x00]/.test(body.subject) ||
    typeof body.text !== 'string' ||
    body.text.length > 131072
  )
    throw invalid();
  if (
    body.displayName !== undefined &&
    (typeof body.displayName !== 'string' ||
      body.displayName.length > 100 ||
      /[\x00-\x1f\x7f-\x9f]/.test(body.displayName))
  )
    throw invalid();
  if (
    body.inReplyTo !== undefined &&
    (typeof body.inReplyTo !== 'string' || !/^<[^<>\s]{1,250}>$/.test(body.inReplyTo))
  )
    throw invalid();
  if (!Array.isArray(body.attachments) || body.attachments.length > 10) throw invalid();
  let size = 0,
    decodedSize = 0;
  const attachments = body.attachments.map((input) => {
    const file = object(input);
    if (
      typeof file.name !== 'string' ||
      !file.name ||
      file.name.length > 180 ||
      /[\x00-\x1f/\\]/.test(file.name) ||
      typeof file.type !== 'string' ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(file.type) ||
      typeof file.content !== 'string' ||
      !validBase64(file.content)
    )
      throw invalid();
    size += file.content.length;
    decodedSize +=
      (file.content.length / 4) * 3 -
      (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0);
    return { name: file.name, type: file.type, content: file.content };
  });
  if (decodedSize > MAX_COMPOSE_BYTES)
    throw new MailError('TOO_LARGE', 413, 'Tổng tệp đính kèm tối đa 18 MiB.');
  let quote: SendDraft['quote'];
  if (body.quote !== undefined) {
    try {
      quote = quotedMessageInput(body.quote);
    } catch (error) {
      if (error instanceof QuotedMessageTooLarge)
        throw new MailError(
          'QUOTE_TOO_LARGE',
          413,
          'Nội dung thư trước vượt giới hạn 128 KiB. Hãy bỏ phần thư trước hoặc giảm nội dung trước khi gửi.',
        );
      throw invalid();
    }
  }
  if (
    size +
      new TextEncoder().encode(body.text).length +
      (quote ? new TextEncoder().encode(JSON.stringify(quote)).length : 0) >
    MAX_MIME - 65536
  )
    throw new MailError('TOO_LARGE', 413, 'Tổng dung lượng thư tối đa 25 MiB, gồm mã hóa file.');
  let signature: SendDraft['signature'];
  if (body.signature !== undefined) {
    try {
      signature = signaturePayloadInput(body.signature);
    } catch {
      throw invalid();
    }
  }
  return {
    to,
    cc,
    ...(signature ? { signature } : {}),
    ...(quote ? { quote } : {}),
    ...(body.bcc !== undefined ? { bcc } : {}),
    ...(body.displayName !== undefined ? { displayName: (body.displayName as string).trim() } : {}),
    subject: body.subject,
    text: body.text,
    attachments,
    ...(body.inReplyTo ? { inReplyTo: body.inReplyTo as string } : {}),
  };
}

export function messageKey(id: string) {
  if (!/^[1-9]\d{0,19}\.[1-9]\d{0,9}$/.test(id)) throw invalid();
  const [validity, uid] = id.split('.');
  const numeric = Number(uid);
  if (numeric > 4294967295) throw invalid();
  return { validity: validity!, uid: numeric };
}

export function folderName(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !input.trim() ||
    input.length > 255 ||
    /[\x00-\x1f\x7f-\x9f]/.test(input) ||
    input.split(/[\\/]/).some((part) => part === '.' || part === '..')
  )
    throw invalid();
  return input;
}
export function folderInput(input: unknown): Folder {
  if (typeof input !== 'string') throw invalid();
  if (['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'].includes(input))
    return input as Folder;
  if (!input.startsWith('folder:')) throw invalid();
  let path: string;
  try {
    path = decodeURIComponent(input.slice(7));
  } catch {
    throw invalid();
  }
  folderName(path);
  if (encodeURIComponent(path) !== input.slice(7)) throw invalid();
  return input as Folder;
}
export function filterInput(input: unknown): MessageFilter {
  const value = object(input ?? {}),
    result: MessageFilter = {};
  for (const key of ['query', 'from'] as const) {
    if (value[key] === undefined) continue;
    if (
      typeof value[key] !== 'string' ||
      value[key].length > (key === 'query' ? 500 : 254) ||
      /[\x00-\x1f\x7f-\x9f]/.test(value[key])
    )
      throw invalid();
    if (value[key].trim()) result[key] = value[key].trim();
  }
  for (const key of ['unread', 'starred', 'attachments'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') throw invalid();
    result[key] = value[key];
  }
  for (const key of ['after', 'before'] as const) {
    if (value[key] === undefined) continue;
    const date = value[key];
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw invalid();
    result[key] = date;
  }
  if (result.after && result.before && result.after >= result.before) throw invalid();
  return result;
}
export function actionInput(input: unknown): MessageAction {
  const value = object(input);
  if (
    !Array.isArray(value.ids) ||
    !value.ids.length ||
    value.ids.length > 100 ||
    !value.ids.every((id) => typeof id === 'string') ||
    !['read', 'unread', 'star', 'unstar', 'move'].includes(value.action as string)
  )
    throw invalid();
  const ids = [...new Set(value.ids as string[])];
  const keys = ids.map(messageKey);
  if (keys.some((key) => key.validity !== keys[0]!.validity)) throw invalid();
  if (value.action === 'move')
    return { ids, action: 'move', destination: folderInput(value.destination) };
  if (value.destination !== undefined) throw invalid();
  return { ids, action: value.action as MessageAction['action'] };
}
