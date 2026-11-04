import { signatureMessageHtml, signaturePayloadInput } from '../../shared/signature';
import { simpleParser, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import type { MailMessage, SendDraft } from '../../shared/contracts';
import { MAX_MIME } from '../core/validation';
import { MailError } from '../core/errors';

export function ensureMimeSize(size: number) {
  if (size > MAX_MIME)
    throw new MailError('TOO_LARGE', 413, 'Thư vượt giới hạn 10 MiB của webmail.');
}
export async function parseMessage(raw: Buffer): Promise<ParsedMail> {
  ensureMimeSize(raw.length);
  return simpleParser(raw, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    maxHtmlLengthToParse: MAX_MIME,
  });
}

export function messageBody(
  parsed: ParsedMail,
): Pick<MailMessage, 'text' | 'html' | 'attachments' | 'messageId' | 'cc'> {
  return {
    text: parsed.text || '',
    cc: (Array.isArray(parsed.cc) ? parsed.cc : parsed.cc ? [parsed.cc] : []).flatMap((group) =>
      group.value.map((value) => ({ address: value.address || '', name: value.name || '' })),
    ),
    ...(parsed.html ? { html: parsed.html } : {}),
    messageId: parsed.messageId,
    attachments: parsed.attachments.map((file, id) => ({
      id,
      name: file.filename || `attachment-${id + 1}`,
      type: file.contentType,
      size: file.size,
    })),
  };
}

export async function composeMessage(
  email: string,
  draft: SendDraft,
  messageId: string,
): Promise<Buffer> {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'windows',
  });
  const info = await composer.sendMail({
    from: { address: email, name: draft.displayName || '' },
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    text: draft.text,
    ...(draft.signature
      ? {
          html: signatureMessageHtml(
            draft.text,
            signaturePayloadInput(draft.signature),
            email,
            draft.displayName || '',
          ),
        }
      : {}),
    messageId,
    inReplyTo: draft.inReplyTo,
    references: draft.inReplyTo,
    attachments: draft.attachments.map((file) => ({
      filename: file.name,
      content: Buffer.from(file.content, 'base64'),
      contentType: file.type,
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const raw = info.message as Buffer;
  ensureMimeSize(raw.length);
  return raw;
}
