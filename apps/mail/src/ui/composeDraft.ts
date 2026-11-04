import {
  companySignature,
  effectiveSignatureSettings,
  type CompanySignaturePayload,
} from '../shared/signature';
import type { MailAddress, MailMessage, MailPreferences, SendDraft } from '../shared/contracts';

export type ComposeMode = 'reply' | 'replyAll' | 'forward';
export const MAX_COMPOSE_BYTES = 7 * 1024 * 1024;

export function splitRecipients(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
function addressLabel(value: MailAddress): string {
  return value.name ? `${value.name} <${value.address}>` : value.address;
}
function originalText(message: MailMessage): string {
  if (message.text) return message.text.replace(/\r\n?/g, '\n');
  if (!message.html || typeof DOMParser === 'undefined') return '';
  // A detached document never renders or loads the original message's remote resources.
  const doc = new DOMParser().parseFromString(message.html, 'text/html');
  doc
    .querySelectorAll('script,style,template,noscript,iframe,object')
    .forEach((node) => node.remove());
  doc.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,blockquote').forEach((node) => node.append('\n'));
  return (doc.body.textContent ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export function initialComposeDraft({
  reply,
  mode = 'reply',
  email,
  preferences,
}: {
  reply?: MailMessage | null;
  mode?: ComposeMode;
  email: string;
  preferences?: MailPreferences;
}): SendDraft {
  const settings = effectiveSignatureSettings(preferences ?? { signature: '' });
  const branded =
    settings.mode === 'company'
      ? companySignature(email, preferences?.displayName ?? '', settings.jobTitle)
      : undefined;
  const draft: SendDraft = {
    to: [],
    cc: [],
    subject: '',
    text: branded
      ? `\n\n${branded.text}`
      : settings.mode === 'custom' && preferences?.signature
        ? `\n\n-- \n${preferences.signature}`
        : '',
    ...(branded ? { signature: { jobTitle: settings.jobTitle, offset: 2 } } : {}),
    attachments: [],
    displayName: preferences?.displayName ?? '',
  };
  if (!reply) return draft;
  const body = originalText(reply);
  const date = new Date(reply.date);
  const when = Number.isNaN(date.getTime()) ? reply.date : date.toLocaleString('vi-VN');
  if (mode === 'forward') {
    draft.subject = /^fw(?:d)?:/i.test(reply.subject) ? reply.subject : `Fwd: ${reply.subject}`;
    draft.text += `\n\n---------- Thư được chuyển tiếp ----------\nTừ: ${addressLabel(reply.from)}\nNgày: ${when}\nTiêu đề: ${reply.subject}\nĐến: ${reply.to.map(addressLabel).join(', ')}${reply.cc?.length ? `\nCc: ${reply.cc.map(addressLabel).join(', ')}` : ''}\n\n${body}`;
    return draft;
  }
  const seen = new Set([email.trim().toLowerCase()]);
  const unique = (addresses: MailAddress[]) =>
    addresses.flatMap(({ address }) => {
      const normalized = address.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) return [];
      seen.add(normalized);
      return [address.trim()];
    });
  const own = reply.from.address.toLowerCase() === email.toLowerCase();
  draft.to = unique(
    own ? reply.to : mode === 'replyAll' ? [reply.from, ...reply.to] : [reply.from],
  );
  draft.cc = mode === 'replyAll' ? unique(reply.cc ?? []) : [];
  draft.subject = /^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`;
  draft.text += `\n\nVào ${when}, ${addressLabel(reply.from)} đã viết:\n${body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}`;
  if (reply.messageId) draft.inReplyTo = reply.messageId;
  return draft;
}
export function contactSuggestions(
  value: string,
  contacts: MailAddress[],
): Array<{ name: string; value: string }> {
  const last = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'), value.lastIndexOf('\n'));
  const prefix = last < 0 ? '' : `${value.slice(0, last + 1).trimEnd()} `;
  const query = value
    .slice(last + 1)
    .trim()
    .toLowerCase();
  return contacts
    .filter((contact) => `${contact.name} ${contact.address}`.toLowerCase().includes(query))
    .slice(0, 30)
    .map((contact) => ({ name: contact.name, value: prefix + contact.address }));
}
export function readComposeFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(Error('Không thể đọc tệp.'));
    reader.onabort = () => reject(Error('Đã dừng đọc tệp.'));
    reader.readAsDataURL(file);
  });
}
export function attachmentBytes(attachments: SendDraft['attachments']): number {
  return attachments.reduce(
    (total, file) =>
      total +
      Math.floor((file.content.length * 3) / 4) -
      (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0),
    0,
  );
}
export async function forwardAttachments(
  message: MailMessage,
  download: (id: number) => Promise<Blob>,
): Promise<SendDraft['attachments']> {
  if (message.attachments.reduce((sum, file) => sum + file.size, 0) > MAX_COMPOSE_BYTES) {
    throw Error('Tổng tệp gốc vượt giới hạn 7 MB.');
  }
  const files: SendDraft['attachments'] = [];
  let bytes = 0;
  for (const attachment of message.attachments) {
    const blob = await download(attachment.id);
    bytes += blob.size;
    if (bytes > MAX_COMPOSE_BYTES) throw Error('Tổng tệp gốc vượt giới hạn 7 MB.');
    files.push({
      name: attachment.name,
      type: attachment.type || blob.type || 'application/octet-stream',
      content: await readComposeFile(blob),
    });
  }
  return files;
}

function signatureQuoteBoundary(
  text: string,
): { kind: 'forward' | 'reply'; offset: number } | undefined {
  const forward = text.indexOf('\n---------- Thư được chuyển tiếp ----------\n');
  const reply = /\nVào [\s\S]*? đã viết:\n/.exec(text);
  if (forward >= 0 && (!reply || forward <= reply.index))
    return { kind: 'forward', offset: forward };
  return reply ? { kind: 'reply', offset: reply.index } : undefined;
}

export function currentDraftSignature(
  initial: SendDraft,
  text: string,
  email: string,
): CompanySignaturePayload | undefined {
  if (!initial.signature) return undefined;
  const expected = companySignature(
    email,
    initial.displayName ?? '',
    initial.signature.jobTitle,
  ).text;
  const originalBoundary = signatureQuoteBoundary(initial.text);
  let authored = text;
  if (originalBoundary) {
    const originalTail = initial.text.slice(originalBoundary.offset);
    const tailOffset = text.length - originalTail.length;
    // Only an unchanged, unique original suffix establishes a safe authoring boundary.
    // Editing or appending to quoted history deliberately falls back to plain text.
    if (tailOffset < 0 || !text.endsWith(originalTail) || text.indexOf(originalTail) !== tailOffset)
      return undefined;
    authored = text.slice(0, tailOffset);
  }
  const offset = authored.indexOf(expected);
  // Match only the authoring region: forwarded originals may contain an identical old signature.
  if (
    offset < 0 ||
    (offset > 0 && text[offset - 1] !== '\n') ||
    authored.indexOf(expected, offset + 1) !== -1
  )
    return undefined;
  return { jobTitle: initial.signature.jobTitle, offset };
}
