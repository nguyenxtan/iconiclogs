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
