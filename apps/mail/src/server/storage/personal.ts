import { signatureSettingsInput } from '../../shared/signature';
import type { DraftSummary, MailPreferences, SavedDraft, SendDraft } from '../../shared/contracts';
import { invalid, MailError } from '../core/errors';
import { sendInput, validEmail } from '../core/validation';

export interface PersonalStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}
interface DraftEntry extends DraftSummary {
  chunks: number;
  bytes: number;
}
const encoder = new TextEncoder();
const emptyPreferences = (): MailPreferences => ({ displayName: '', signature: '', contacts: [] });
export function draftId(value: string) {
  if (!/^[a-f0-9-]{36}$/i.test(value)) throw invalid();
  return value;
}
export function preferencesInput(input: unknown): MailPreferences {
  const value = input as MailPreferences;
  if (
    !value ||
    typeof value.displayName !== 'string' ||
    value.displayName.length > 100 ||
    /[\x00-\x1f]/.test(value.displayName) ||
    typeof value.signature !== 'string' ||
    value.signature.length > 4000 ||
    !Array.isArray(value.contacts) ||
    value.contacts.length > 200
  )
    throw invalid();
  let signatureSettings: MailPreferences['signatureSettings'];
  if (value.signatureSettings !== undefined) {
    try {
      signatureSettings = signatureSettingsInput(value.signatureSettings);
    } catch {
      throw invalid();
    }
  }
  return {
    ...(signatureSettings ? { signatureSettings } : {}),
    displayName: value.displayName.trim(),
    signature: value.signature,
    contacts: value.contacts.map((contact) => {
      if (
        !contact ||
        typeof contact.name !== 'string' ||
        contact.name.length > 100 ||
        /[\x00-\x1f]/.test(contact.name) ||
        !validEmail(contact.address)
      )
        throw invalid();
      return { name: contact.name.trim(), address: contact.address.toLowerCase() };
    }),
  };
}
function incompleteDraft(input: SendDraft): SendDraft {
  if (!input || typeof input !== 'object') throw invalid();
  const groups = [input.to, input.cc, input.bcc ?? []];
  if (
    groups.some(
      (group) =>
        !Array.isArray(group) ||
        group.length > 20 ||
        group.some(
          (value) => typeof value !== 'string' || value.length > 254 || /[\r\n\x00]/.test(value),
        ),
    ) ||
    groups.reduce((n, group) => n + group.length, 0) > 20
  )
    throw invalid();
  // Incomplete recipient text is allowed in a draft. MIME and size rules still apply.
  const validated = sendInput({ ...input, to: ['draft@example.test'], cc: [], bcc: [] });
  if (input.deliveryGuard !== undefined && !['unknown', 'partial'].includes(input.deliveryGuard))
    throw invalid();
  if (input.deliveryKey !== undefined && !/^[A-Za-z0-9_-]{16,80}$/.test(input.deliveryKey))
    throw invalid();
  return {
    ...validated,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc ?? [],
    ...(input.deliveryGuard ? { deliveryGuard: input.deliveryGuard } : {}),
    ...(input.deliveryKey ? { deliveryKey: input.deliveryKey } : {}),
  };
}

export class PersonalData {
  constructor(
    private storage: PersonalStorage,
    private secret: string,
    private scope: string,
  ) {}
  private async key() {
    const bytes = Uint8Array.from(atob(this.secret), (char) => char.charCodeAt(0));
    if (bytes.length !== 32)
      throw new MailError('CONFIGURATION', 503, 'Chưa cấu hình lưu dữ liệu mail.');
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  private async seal(value: unknown, path: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(`${this.scope}:${path}`) },
        await this.key(),
        encoder.encode(JSON.stringify(value)),
      ),
    );
    const result = new Uint8Array(iv.length + encrypted.length);
    result.set(iv);
    result.set(encrypted, iv.length);
    return result;
  }
  private async open<T>(bytes: Uint8Array, path: string): Promise<T> {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.slice(0, 12),
        additionalData: encoder.encode(`${this.scope}:${path}`),
      },
      await this.key(),
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  }
  async preferences(): Promise<MailPreferences> {
    const bytes = await this.storage.get<Uint8Array>('preferences');
    return bytes ? this.open(bytes, 'preferences') : emptyPreferences();
  }
  async savePreferences(input: unknown) {
    const value = preferencesInput(input);
    await this.storage.put('preferences', await this.seal(value, 'preferences'));
    return value;
  }
  private async entries(): Promise<DraftEntry[]> {
    const bytes = await this.storage.get<Uint8Array>('draft-index');
    return bytes ? this.open(bytes, 'draft-index') : [];
  }
  async drafts(): Promise<DraftSummary[]> {
    return (await this.entries())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ chunks: _chunks, bytes: _bytes, ...entry }) => entry);
  }
  async draft(id: string): Promise<SavedDraft> {
    draftId(id);
    const entry = (await this.entries()).find((item) => item.id === id);
    if (!entry) throw new MailError('DRAFT_MISSING', 404, 'Không còn bản nháp này.');
    const bytes = new Uint8Array(entry.bytes);
    let offset = 0;
    for (let index = 0; index < entry.chunks; index++) {
      const chunk = await this.storage.get<Uint8Array>(`draft:${id}:${index}`);
      if (!chunk) throw new MailError('DRAFT_MISSING', 409, 'Không thể đọc đủ bản nháp.');
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return this.open(bytes, `draft:${id}`);
  }
  async saveDraft(id: string, input: SendDraft, revision: number): Promise<SavedDraft> {
    draftId(id);
    if (!Number.isSafeInteger(revision) || revision < 0) throw invalid();
    const entries = await this.entries();
    const previous = entries.find((entry) => entry.id === id);
    const draft = incompleteDraft(input);
    if (previous?.revision === revision + 1) {
      const stored = await this.draft(id);
      if (JSON.stringify(stored.draft) === JSON.stringify(draft)) return stored;
    }
    if ((previous?.revision ?? 0) !== revision)
      throw new MailError(
        'DRAFT_CONFLICT',
        409,
        'Bản nháp đã thay đổi ở nơi khác. Hãy mở lại bản mới nhất.',
      );
    if (!previous && entries.length >= 20)
      throw new MailError('DRAFT_LIMIT', 409, 'Tối đa 20 bản nháp. Hãy xóa bản không cần dùng.');
    const result = { id, draft, revision: revision + 1, updatedAt: Date.now() };
    const encrypted = await this.seal(result, `draft:${id}`);
    if (
      entries.reduce((n, entry) => n + (entry.id === id ? 0 : entry.bytes), 0) + encrypted.length >
      50 * 1024 * 1024
    )
      throw new MailError(
        'DRAFT_LIMIT',
        413,
        'Tổng bản nháp vượt 50 MiB. Hãy xóa bớt tệp hoặc bản nháp cũ.',
      );
    const chunks = Math.ceil(encrypted.length / 120000);
    for (let index = 0; index < chunks; index++)
      await this.storage.put(
        `draft:${id}:${index}`,
        encrypted.slice(index * 120000, (index + 1) * 120000),
      );
    for (let index = chunks; index < (previous?.chunks ?? 0); index++)
      await this.storage.delete(`draft:${id}:${index}`);
    const entry: DraftEntry = {
      id,
      subject: draft.subject,
      to: draft.to,
      updatedAt: result.updatedAt,
      revision: result.revision,
      chunks,
      bytes: encrypted.length,
    };
    await this.storage.put(
      'draft-index',
      await this.seal([...entries.filter((item) => item.id !== id), entry], 'draft-index'),
    );
    return result;
  }
  async removeDraft(id: string, revision: number) {
    draftId(id);
    const entries = await this.entries();
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    if (entry.revision !== revision)
      throw new MailError(
        'DRAFT_CONFLICT',
        409,
        'Bản nháp đã thay đổi ở nơi khác. Hãy mở lại bản mới nhất.',
      );
    await this.storage.put(
      'draft-index',
      await this.seal(
        entries.filter((item) => item.id !== id),
        'draft-index',
      ),
    );
    for (let index = 0; index < entry.chunks; index++)
      await this.storage.delete(`draft:${id}:${index}`);
  }
}
