import { describe, expect, it } from 'vitest';
import type { SavedDraft, SendDraft, SendResult } from '../src/shared/contracts';
import { DraftAutosave } from '../src/ui/draftAutosave';
import { sendDraftSafely } from '../src/ui/composeDelivery';

const draft: SendDraft = {
  to: ['unfinished@'],
  cc: [],
  subject: '',
  text: 'My latest text',
  attachments: [{ name: 'x.txt', type: 'text/plain', content: 'aGk=' }],
};
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
describe('serialized revision-aware draft saving', () => {
  it('coalesces edits behind one in-flight save and writes the newest content at the next revision', async () => {
    const first = gate();
    const writes: Array<{ revision: number; draft: SendDraft }> = [];
    let stored: SavedDraft | undefined;
    const saver = new DraftAutosave('draft-id', undefined, async (id, value, revision) => {
      writes.push({ revision, draft: value });
      if (writes.length === 1) await first.promise;
      stored = { id, revision: revision + 1, draft: value, updatedAt: 100 };
      return stored;
    });
    saver.update(draft);
    const pending = saver.flush();
    saver.update({ ...draft, text: 'intermediate' });
    saver.update({ ...draft, text: 'newest' });
    const same = saver.flush();
    first.resolve();
    await Promise.all([pending, same]);
    expect(writes.map((w) => ({ revision: w.revision, text: w.draft.text }))).toEqual([
      { revision: 0, text: 'My latest text' },
      { revision: 1, text: 'newest' },
    ]);
    expect(stored?.draft.to).toEqual(['unfinished@']);
    expect(stored?.draft.attachments[0]?.content).toBe('aGk=');
    expect(saver.saved?.revision).toBe(2);
    expect(saver.pending).toBe(false);
  });
  it('keeps failed edits pending and retries against the last confirmed revision without overwriting conflicts', async () => {
    const saved: SavedDraft = { id: 'draft-id', revision: 4, draft, updatedAt: 10 };
    let fail = true;
    const revisions: number[] = [];
    const saver = new DraftAutosave('draft-id', saved, async (id, value, revision) => {
      revisions.push(revision);
      if (fail) throw Error('revision conflict');
      return { id, revision: 5, draft: value, updatedAt: 20 };
    });
    saver.update({ ...draft, text: 'keep this' });
    await expect(saver.flush()).rejects.toThrow('revision conflict');
    expect(saver.pending).toBe(true);
    expect(saver.saved?.revision).toBe(4);
    fail = false;
    await saver.flush();
    expect(revisions).toEqual([4, 4]);
    expect(saver.saved?.draft.text).toBe('keep this');
  });
});
const success: SendResult = {
  status: 'sent',
  sentCopy: 'saved',
  accepted: ['to@example.com'],
  rejected: [],
};
describe('persisted duplicate-send guard', () => {
  it('does not issue SMTP when the guard cannot first be saved', async () => {
    let sent = 0;
    let removed = 0;
    const result = await sendDraftSafely(draft, 'delivery-key', {
      persist: async () => {
        throw Error('offline');
      },
      send: async () => {
        sent++;
        return success;
      },
      remove: async () => {
        removed++;
      },
    });
    expect(result.state).toBe('blocked');
    expect(sent).toBe(0);
    expect(removed).toBe(0);
  });
  it('persists the guard before send, strips private draft metadata from SMTP and deletes only after confirmed sent', async () => {
    const events: string[] = [];
    let smtp: SendDraft | undefined;
    const result = await sendDraftSafely(draft, 'delivery-key', {
      persist: async (value) => {
        expect(value.deliveryGuard).toBe('unknown');
        expect(value.deliveryKey).toBe('delivery-key');
        events.push('saved');
      },
      send: async (value, key) => {
        smtp = value;
        expect(key).toBe('delivery-key');
        events.push('sent');
        return success;
      },
      remove: async () => {
        events.push('removed');
      },
    });
    expect(events).toEqual(['saved', 'sent', 'removed']);
    expect(smtp?.deliveryGuard).toBeUndefined();
    expect(smtp?.deliveryKey).toBeUndefined();
    expect(result.state).toBe('sent');
  });
  it('retains a durable locked draft for ambiguous send and partially rejected recipients', async () => {
    for (const status of ['unknown', 'partial'] as const) {
      const writes: SendDraft[] = [];
      let removed = false;
      const result = await sendDraftSafely(draft, 'delivery-key', {
        persist: async (value) => {
          writes.push(value);
        },
        send: async () => ({ ...success, status, rejected: ['bad@example.com'] }),
        remove: async () => {
          removed = true;
        },
      });
      expect(result.state).toBe(status);
      expect(removed).toBe(false);
      expect(writes.at(-1)?.deliveryGuard).toBe(status);
    }
  });
  it('leaves an ambiguous guard intact after a lost network response and clears it only on definite rejection', async () => {
    const writes: SendDraft[] = [];
    const unknown = await sendDraftSafely(draft, 'key', {
      persist: async (value) => {
        writes.push(value);
      },
      send: async () => {
        throw Error('socket lost');
      },
      remove: async () => {
        throw Error('must not remove');
      },
    });
    expect(unknown.state).toBe('unknown');
    expect(writes.at(-1)?.deliveryGuard).toBe('unknown');
    const failed = await sendDraftSafely(draft, 'key2', {
      persist: async (value) => {
        writes.push(value);
      },
      send: async () => ({ ...success, status: 'failed', accepted: [] }),
      remove: async () => {
        throw Error('must not remove');
      },
    });
    expect(failed.state).toBe('failed');
    expect(writes.at(-1)?.deliveryGuard).toBeUndefined();
  });
});
