import { expect, it } from 'vitest';
import { PersonalData, type PersonalStorage } from '../src/server/storage/personal';
import type { SendDraft } from '../src/shared/contracts';
function fixture() {
  const values = new Map<string, unknown>();
  const storage: PersonalStorage = {
    get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: async (key, value) => {
      values.set(key, structuredClone(value));
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
  return { values, storage };
}
const secret = btoa('x'.repeat(32));
const draft: SendDraft = {
  to: ['unfinished@'],
  cc: [],
  subject: '',
  text: 'Private body',
  attachments: [],
};
it('keeps incomplete drafts across sessions encrypted and isolates each mailbox', async () => {
  const { storage, values } = fixture();
  const first = new PersonalData(storage, secret, 'a@iconiclogs.com');
  const saved = await first.saveDraft('12345678-1234-4123-a123-123456789012', draft, 0);
  expect(saved.revision).toBe(1);
  const second = new PersonalData(storage, secret, 'a@iconiclogs.com');
  expect((await second.draft(saved.id)).draft).toMatchObject(draft);
  expect((await second.drafts())[0]?.to).toEqual(['unfinished@']);
  expect(JSON.stringify([...values])).not.toContain('Private body');
  await expect(
    new PersonalData(storage, secret, 'b@iconiclogs.com').draft(saved.id),
  ).rejects.toThrow();
});
it('rejects stale draft writes and deletes without destroying the latest draft', async () => {
  const { storage } = fixture();
  const data = new PersonalData(storage, secret, 'a@iconiclogs.com');
  const saved = await data.saveDraft('12345678-1234-4123-a123-123456789012', draft, 0);
  await data.saveDraft(saved.id, { ...draft, text: 'Latest work' }, 1);
  await expect(data.saveDraft(saved.id, draft, 1)).rejects.toMatchObject({
    code: 'DRAFT_CONFLICT',
  });
  await expect(data.removeDraft(saved.id, 1)).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
  expect((await data.draft(saved.id)).draft.text).toBe('Latest work');
});
it('persists attachments above one storage value limit in encrypted chunks', async () => {
  const { storage, values } = fixture();
  const data = new PersonalData(storage, secret, 'a@iconiclogs.com');
  const file = { name: 'manifest.txt', type: 'text/plain', content: 'YWFh'.repeat(70000) };
  const saved = await data.saveDraft(
    '12345678-1234-4123-a123-123456789012',
    { ...draft, attachments: [file] },
    0,
  );
  expect((await data.draft(saved.id)).draft.attachments[0]).toEqual(file);
  expect(
    [...values.values()]
      .filter((v) => v instanceof Uint8Array)
      .every((v) => (v as Uint8Array).length <= 120000),
  ).toBe(true);
  await data.removeDraft(saved.id, saved.revision);
  expect(await data.drafts()).toEqual([]);
});
it('validates signatures and contacts and restores their saved values', async () => {
  const { storage } = fixture();
  const data = new PersonalData(storage, secret, 'a@iconiclogs.com');
  const prefs = {
    displayName: 'ICONIC CS',
    signature: 'Best regards,\nICONIC',
    contacts: [{ name: 'Docs', address: 'document@iconiclogs.com' }],
  };
  expect(await data.savePreferences(prefs)).toEqual(prefs);
  expect(await data.preferences()).toEqual(prefs);
  await expect(
    data.savePreferences({ ...prefs, displayName: 'Injected\r\nFrom: victim' }),
  ).rejects.toThrow();
});

it('reconciles a lost draft save response only when the next revision has identical content', async () => {
  const { storage } = fixture();
  const data = new PersonalData(storage, secret, 'a@iconiclogs.com');
  const id = '12345678-1234-4123-a123-123456789012';
  const confirmed = await data.saveDraft(id, draft, 0);
  // The first response was lost. Retrying the same request must return the saved revision.
  expect(await data.saveDraft(id, draft, 0)).toEqual(confirmed);
  await expect(
    data.saveDraft(id, { ...draft, text: 'Different tab content' }, 0),
  ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
  expect((await data.draft(id)).draft.text).toBe(draft.text);
});
