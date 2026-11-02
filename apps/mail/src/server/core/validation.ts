import type { SendDraft } from '../../shared/contracts';
import { invalid, MailError } from './errors';

export const MAX_MIME = 10 * 1024 * 1024;
const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
export const validEmail = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  !/[\s\r\n]/.test(value) &&
  emailPattern.test(value);
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

function recipients(input: unknown, required = false): string[] {
  if (!Array.isArray(input) || input.length > 20 || (required && !input.length)) throw invalid();
  if (!input.every(validEmail)) throw invalid();
  return [...new Set(input.map((value: string) => value.toLowerCase()))];
}

export function sendInput(input: unknown): SendDraft {
  const body = object(input);
  const to = recipients(body.to, true),
    cc = recipients(body.cc ?? []);
  if (
    to.length + cc.length > 20 ||
    typeof body.subject !== 'string' ||
    body.subject.length > 200 ||
    /[\r\n\x00]/.test(body.subject) ||
    typeof body.text !== 'string' ||
    body.text.length > 131072
  )
    throw invalid();
  if (
    body.inReplyTo !== undefined &&
    (typeof body.inReplyTo !== 'string' || !/^<[^<>\s]{1,250}>$/.test(body.inReplyTo))
  )
    throw invalid();
  if (!Array.isArray(body.attachments) || body.attachments.length > 10) throw invalid();
  let size = 0;
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
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)
    )
      throw invalid();
    size += file.content.length;
    return { name: file.name, type: file.type, content: file.content };
  });
  if (size + new TextEncoder().encode(body.text).length > MAX_MIME - 65536)
    throw new MailError('TOO_LARGE', 413, 'Tổng dung lượng thư tối đa 10 MiB, gồm mã hóa file.');
  return {
    to,
    cc,
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
