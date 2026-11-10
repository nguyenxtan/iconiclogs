export const INLINE_IMAGE_BYTES = 3 * 1024 * 1024;
export const INLINE_TOTAL_BYTES = 8 * 1024 * 1024;
export const INLINE_IMAGE_COUNT = 10;
export const INLINE_TOTAL_PIXELS = 32 * 1024 * 1024;

export function normalizeContentId(value: string | undefined): string | undefined {
  const id = value?.trim().replace(/^<([^<>]+)>$/, '$1');
  return id && /^[^\s<>\x00-\x1f\x7f]{1,998}$/.test(id) ? id : undefined;
}

export function contentIdFromSource(source: string): string | undefined {
  if (!/^cid:/i.test(source)) return;
  try {
    return normalizeContentId(decodeURIComponent(source.slice(4)));
  } catch {
    return;
  }
}

export interface RasterInfo {
  type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  width: number;
  height: number;
}

/** Inspect only raster headers; never render or interpret sender-supplied SVG/HTML. */
export function rasterInfo(bytes: Uint8Array): RasterInfo | undefined {
  if (bytes.length < 24 || bytes.length > INLINE_IMAGE_BYTES) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, value: string) =>
    [...value].every((character, i) => bytes[offset + i] === character.charCodeAt(0));
  let type: RasterInfo['type'] | undefined,
    width = 0,
    height = 0;
  if (bytes[0] === 137 && tag(1, 'PNG\r\n\x1a\n') && tag(12, 'IHDR')) {
    type = 'image/png';
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (tag(0, 'GIF87a') || tag(0, 'GIF89a')) {
    type = 'image/gif';
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2, steps = 0; offset + 8 < bytes.length && steps < 4096; steps++) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217 || offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        marker &&
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 8
      ) {
        type = 'image/jpeg';
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (tag(0, 'RIFF') && tag(8, 'WEBP')) {
    const little24 = (offset: number) =>
      bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
    if (tag(12, 'VP8X') && bytes.length >= 30) {
      width = little24(24) + 1;
      height = little24(27) + 1;
      type = 'image/webp';
    } else if (tag(12, 'VP8L') && bytes.length >= 25 && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
      type = 'image/webp';
    } else if (
      tag(12, 'VP8 ') &&
      bytes.length >= 30 &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = view.getUint16(26, true) & 16383;
      height = view.getUint16(28, true) & 16383;
      type = 'image/webp';
    }
  }
  if (
    !type ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 16 * 1024 * 1024
  )
    return;
  return { type, width, height };
}

export function safeRasterDataUrl(value: string): boolean {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2]!.length > Math.ceil(INLINE_IMAGE_BYTES / 3) * 4 || match[2]!.length % 4)
    return false;
  try {
    const bytes = Uint8Array.from(atob(match[2]!), (character) => character.charCodeAt(0));
    return rasterInfo(bytes)?.type === match[1];
  } catch {
    return false;
  }
}
