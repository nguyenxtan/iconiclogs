import { MailError } from '../core/errors';
const encoder = new TextEncoder();
export function backupError(code: string, message: string, status = 409) {
  return new MailError(code, status, message);
}
export async function backupKey(secret: string) {
  try {
    const bytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
    if (bytes.length !== 32) throw Error();
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw backupError('BACKUP_UNAVAILABLE', 'Chưa cấu hình khóa và kho sao lưu riêng tư.', 503);
  }
}
export async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function seal(bytes: Uint8Array, key: CryptoKey, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    key,
    bytes as BufferSource,
  );
  const result = new Uint8Array(13 + ciphertext.byteLength);
  result[0] = 1;
  result.set(iv, 1);
  result.set(new Uint8Array(ciphertext), 13);
  return result;
}
export async function open(bytes: Uint8Array, key: CryptoKey, context: string) {
  try {
    if (bytes.length < 30 || bytes[0] !== 1) throw Error();
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(1, 13), additionalData: encoder.encode(context) },
        key,
        bytes.slice(13),
      ),
    );
  } catch {
    throw backupError('BACKUP_CORRUPT', 'Bản sao lưu không xác minh được tính toàn vẹn.', 502);
  }
}
