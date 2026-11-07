import { unauthorized, unavailable } from './errors';

export const SESSION_TTL = 30 * 60 * 1000;
export interface Credentials {
  email: string;
  password: string;
}
export interface SessionRecord {
  email: string;
  ciphertext: string;
  iv: string;
  expiresAt: number;
  csrfToken: string;
}
const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));

async function encryptionKey(secret: string) {
  try {
    const key = bytes(secret);
    if (key.length !== 32) throw Error('invalid key');
    return await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw unavailable();
  }
}

export async function lockSession(
  credentials: Credentials,
  secret: string,
  id: string,
  now = Date.now(),
): Promise<SessionRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) },
    await encryptionKey(secret),
    new TextEncoder().encode(credentials.password),
  );
  return {
    email: credentials.email,
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
    expiresAt: now + SESSION_TTL,
    csrfToken: crypto.randomUUID(),
  };
}

export async function unlockSession(
  record: SessionRecord,
  secret: string,
  id: string,
  now = Date.now(),
): Promise<Credentials> {
  if (now >= record.expiresAt) throw unauthorized();
  const password = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes(record.iv), additionalData: new TextEncoder().encode(id) },
    await encryptionKey(secret),
    bytes(record.ciphertext),
  );
  return { email: record.email, password: new TextDecoder().decode(password) };
}

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
