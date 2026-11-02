import { describe, expect, it } from 'vitest';
import { sendOnce, type SendRecord, type SendStore } from '../src/server/core/send';
import type { SendResult } from '../src/shared/contracts';

function memoryStore(): SendStore {
  const data = new Map<string, SendRecord>();
  return {
    async get(key) {
      return data.get(key);
    },
    async claim(key, record) {
      if (data.has(key)) return false;
      data.set(key, record);
      return true;
    },
    async put(key, record) {
      data.set(key, record);
    },
  };
}
const success: SendResult = {
  status: 'sent',
  sentCopy: 'saved',
  accepted: ['to@example.com'],
  rejected: [],
};
describe('durable submission boundary', () => {
  it('claims before network and prevents concurrent and repeated delivery', async () => {
    const store = memoryStore();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = sendOnce(store, 'key', 'fingerprint', async () => {
      calls++;
      await gate;
      return success;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      (
        await sendOnce(store, 'key', 'fingerprint', async () => {
          calls++;
          return success;
        })
      ).status,
    ).toBe('unknown');
    release();
    expect(await first).toEqual(success);
    expect(
      await sendOnce(store, 'key', 'fingerprint', async () => {
        calls++;
        return success;
      }),
    ).toEqual(success);
    expect(calls).toBe(1);
  });
  it('does not repeat ambiguous SMTP after restart or permit changed payload', async () => {
    const store = memoryStore();
    let calls = 0;
    const deliver = async (): Promise<SendResult> => {
      calls++;
      throw Error('socket closed after DATA');
    };
    expect((await sendOnce(store, 'key', 'same', deliver)).status).toBe('unknown');
    expect((await sendOnce(store, 'key', 'same', deliver)).status).toBe('unknown');
    await expect(sendOnce(store, 'key', 'changed', deliver)).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('preserves SMTP success when the Sent copy is unconfirmed', async () => {
    const store = memoryStore();
    const result: SendResult = { ...success, sentCopy: 'unconfirmed' };
    expect(await sendOnce(store, 'key', 'same', async () => result)).toEqual(result);
    expect(
      await sendOnce(store, 'key', 'same', async () => {
        throw Error('must not run');
      }),
    ).toEqual(result);
  });
});
