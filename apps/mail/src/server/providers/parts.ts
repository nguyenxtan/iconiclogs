import type { ParsedMail } from 'mailparser';
import type { MessageStructureObject } from 'imapflow';
import type { AttachmentInfo } from '../../shared/contracts';

export interface AttachmentPart extends AttachmentInfo {
  part: string;
}
export function attachmentParts(structure?: MessageStructureObject): AttachmentPart[] {
  const files: AttachmentPart[] = [];
  function visit(node: MessageStructureObject) {
    const type = node.type.toLowerCase();
    if (type.startsWith('multipart/')) {
      node.childNodes?.forEach(visit);
      return;
    }
    const name = node.dispositionParameters?.filename || node.parameters?.name;
    const isFile =
      name ||
      node.disposition?.toLowerCase() === 'attachment' ||
      !['text/plain', 'text/html'].includes(type);
    if (isFile && node.part)
      files.push({
        id: files.length,
        part: node.part,
        name: name || `attachment-${files.length + 1}`,
        type,
        size: node.size || 0,
      });
  }
  if (structure) visit(structure);
  return files;
}

/** BODYSTRUCTURE sizes count transfer-encoded octets, not the bytes returned by download(). */
export function decodedAttachmentParts(
  structure: MessageStructureObject | undefined,
  decoded: ParsedMail['attachments'],
): AttachmentPart[] {
  const parts = attachmentParts(structure);
  const byPart = new Map<string, ParsedMail['attachments'][number] | null>();
  for (const file of decoded) {
    if (file.partId) byPart.set(file.partId, byPart.has(file.partId) ? null : file);
  }
  const root =
    parts.length === 1 &&
    decoded.length === 1 &&
    !decoded[0]!.partId &&
    structure &&
    !structure.type.toLowerCase().startsWith('multipart/')
      ? decoded[0]
      : undefined;
  return parts.map((part) => {
    const file = byPart.get(part.part) ?? root;
    const size = file?.content.byteLength;
    // Unknown metadata must never be presented or used as an exact decoded-size limit.
    return typeof size === 'number' && Number.isSafeInteger(size) && size >= 0
      ? { ...part, size }
      : { ...part, sizeKnown: false };
  });
}
