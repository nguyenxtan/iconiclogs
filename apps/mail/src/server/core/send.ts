import type { SendResult } from '../../shared/contracts';
import { MailError } from './errors';

export interface SendRecord {
  fingerprint: string;
  startedAt: number;
  result?: SendResult;
}
export interface SendStore {
  get(key: string): Promise<SendRecord | undefined>;
  claim(key: string, record: SendRecord): Promise<boolean>;
  put(key: string, record: SendRecord): Promise<void>;
}
const unknown: SendResult = {
  status: 'unknown',
  sentCopy: 'unconfirmed',
  accepted: [],
  rejected: [],
};

export async function sendOnce(
  store: SendStore,
  key: string,
  fingerprint: string,
  deliver: () => Promise<SendResult>,
): Promise<SendResult> {
  const record: SendRecord = { fingerprint, startedAt: Date.now() };
  const claimed = await store.claim(key, record);
  if (!claimed) {
    const previous = await store.get(key);
    if (!previous || previous.fingerprint !== fingerprint)
      throw new MailError('SEND_CONFLICT', 409, 'Yêu cầu gửi đã được dùng cho một nội dung khác.');
    return previous.result ?? unknown;
  }
  let result: SendResult;
  try {
    result = await deliver();
  } catch {
    result = unknown;
  }
  await store.put(key, { ...record, result });
  return result;
}
