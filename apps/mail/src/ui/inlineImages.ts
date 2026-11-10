import type { AttachmentInfo } from '../shared/contracts';
import {
  contentIdFromSource,
  normalizeContentId,
  rasterInfo,
  INLINE_IMAGE_BYTES,
  INLINE_TOTAL_BYTES,
  INLINE_IMAGE_COUNT,
  INLINE_TOTAL_PIXELS,
} from '../shared/inlineMedia';

export function inlineImageCandidates(
  html: string,
  attachments: AttachmentInfo[],
): AttachmentInfo[] {
  // Template contents are inert; inspecting the original must not load its remote resources.
  const template = document.createElement('template');
  template.innerHTML = html;
  const byId = new Map<string, AttachmentInfo | null>();
  for (const file of attachments) {
    const id = normalizeContentId(file.contentId);
    if (id) byId.set(id, byId.has(id) ? null : file);
  }
  const selected: AttachmentInfo[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const image of template.content.querySelectorAll('img[src]')) {
    const id = contentIdFromSource(image.getAttribute('src') || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const file = byId.get(id);
    if (
      !file ||
      file.sizeKnown === false ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > INLINE_IMAGE_BYTES ||
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type.toLowerCase()) ||
      total + file.size > INLINE_TOTAL_BYTES ||
      selected.length >= INLINE_IMAGE_COUNT
    )
      continue;
    selected.push(file);
    total += file.size;
  }
  return selected;
}

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(Error('Image could not be read'));
    reader.onabort = () => reject(Error('Image read cancelled'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function loadInlineImages(
  candidates: AttachmentInfo[],
  download: (id: number) => Promise<Blob>,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  let total = 0,
    pixels = 0;
  for (const file of candidates.slice(0, INLINE_IMAGE_COUNT)) {
    if (signal?.aborted) return new Map();
    try {
      const blob = await download(file.id);
      if (signal?.aborted) return new Map();
      if (blob.size < 1 || blob.size > INLINE_IMAGE_BYTES || total + blob.size > INLINE_TOTAL_BYTES)
        continue;
      const bytes = await bytesOf(blob);
      if (signal?.aborted) return new Map();
      const info = rasterInfo(bytes),
        id = normalizeContentId(file.contentId);
      if (!info || !id || pixels + info.width * info.height > INLINE_TOTAL_PIXELS) continue;
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      images.set(id, `data:${info.type};base64,${btoa(binary)}`);
      total += bytes.length;
      pixels += info.width * info.height;
    } catch {
      // The original text and normal attachment download stay available on partial failure.
    }
  }
  return images;
}
