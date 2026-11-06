import { deflateRawSync } from 'node:zlib';
import { backupError } from './crypto';
const encoder = new TextEncoder();
export const ZIP_LIMIT = 0xffffffff;
export function boundedZip(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= ZIP_LIMIT)
    throw backupError(
      'BACKUP_LIMIT',
      'Gói ZIP vượt giới hạn 4 GiB. Bản gốc vẫn được giữ nguyên.',
      409,
    );
  return value;
}
export function monthOf(date: string) {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) throw backupError('BACKUP_DATE', 'Ngày của thư không hợp lệ.', 409);
  return new Date(time + 7 * 3600000).toISOString().slice(0, 7);
}
export function validMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw backupError('BACKUP_REQUEST', 'Tháng không hợp lệ.', 400);
  return month;
}
export function archivePath(folder: string, id: string) {
  // Encoding a bounded label makes all separators, dot segments and controls harmless.
  const label = Array.from(folder).slice(0, 80).join('');
  return `mail/${encodeURIComponent(label).replace(/\./g, '%2E') || 'folder'}/${id}.eml`;
}
export interface ZipRecord {
  path: string;
  offset: number;
  dataOffset: number;
  size: number;
  packed: number;
  crc: number;
  method: number;
  descriptor?: boolean;
}
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array, previous = 0) {
  let crc = previous ^ -1;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
function header(size: number, magic: number) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, magic, true);
  return { bytes, view };
}
export function zipHeader(record: ZipRecord) {
  const name = encoder.encode(record.path);
  const { bytes, view } = header(30 + name.length, 0x04034b50);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x800 | (record.descriptor ? 8 : 0), true);
  view.setUint16(8, record.method, true);
  view.setUint16(12, 33, true);
  if (!record.descriptor) {
    view.setUint32(14, record.crc, true);
    view.setUint32(18, record.packed, true);
    view.setUint32(22, record.size, true);
  }
  view.setUint16(26, name.length, true);
  bytes.set(name, 30);
  return bytes;
}
export function zipEntry(path: string, raw: Uint8Array, offset: number) {
  const packed = new Uint8Array(deflateRawSync(raw));
  const record: ZipRecord = {
    path,
    offset: boundedZip(offset),
    dataOffset: offset + 30 + encoder.encode(path).length,
    size: raw.length,
    packed: packed.length,
    crc: crc32(raw),
    method: 8,
  };
  const head = zipHeader(record);
  const bytes = new Uint8Array(head.length + packed.length);
  bytes.set(head);
  bytes.set(packed, head.length);
  return { bytes, record };
}
export function zipDescriptor(record: ZipRecord) {
  const { bytes, view } = header(16, 0x08074b50);
  view.setUint32(4, record.crc, true);
  view.setUint32(8, record.packed, true);
  view.setUint32(12, record.size, true);
  return bytes;
}
export function zipDirectory(record: ZipRecord) {
  const name = encoder.encode(record.path);
  const { bytes, view } = header(46 + name.length, 0x02014b50);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x800 | (record.descriptor ? 8 : 0), true);
  view.setUint16(10, record.method, true);
  view.setUint16(14, 33, true);
  view.setUint32(16, record.crc, true);
  view.setUint32(20, record.packed, true);
  view.setUint32(24, record.size, true);
  view.setUint16(28, name.length, true);
  view.setUint32(42, boundedZip(record.offset), true);
  bytes.set(name, 46);
  return bytes;
}
export function zipEnd(count: number, size: number, offset: number) {
  if (count >= 65535)
    throw backupError(
      'BACKUP_LIMIT',
      'Gói ZIP vượt giới hạn số thư. Bản gốc vẫn được giữ nguyên.',
      409,
    );
  const { bytes, view } = header(22, 0x06054b50);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, boundedZip(size), true);
  view.setUint32(16, boundedZip(offset), true);
  return bytes;
}
