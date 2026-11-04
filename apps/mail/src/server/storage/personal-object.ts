import { sha256 } from '../core/session';
import { MailError } from '../core/errors';
import { captureRpc, type RpcResult } from '../core/rpc';
import { DurableObject } from 'cloudflare:workers';
import { PersonalData, type PersonalStorage } from './personal';
import type { MailPreferences, SendDraft } from '../../shared/contracts';
interface PersonalEnv {
  SESSION_KEY?: string;
}
export class PersonalState extends DurableObject<PersonalEnv> {
  private async run<T>(
    email: string,
    operation: (data: PersonalData) => Promise<T>,
  ): Promise<RpcResult<T>> {
    // A transaction publishes chunks and their index atomically; concurrent tabs use revisions.
    return captureRpc(async () => {
      const normalized = email.trim().toLowerCase();
      const scope = await sha256(normalized);
      if (this.ctx.id.name && this.ctx.id.name !== scope)
        throw new MailError('MAILBOX_SCOPE', 403, 'Không có quyền truy cập dữ liệu hộp thư.');
      return this.ctx.storage.transaction(async (txn) => {
        const existing = await txn.get<string>('scope');
        if (existing && existing !== scope)
          throw new MailError('MAILBOX_SCOPE', 403, 'Không có quyền truy cập dữ liệu hộp thư.');
        if (!existing) await txn.put('scope', scope);
        return operation(
          new PersonalData(txn as PersonalStorage, this.env.SESSION_KEY || '', normalized),
        );
      });
    });
  }
  preferences(email: string) {
    return this.run(email, (data) => data.preferences());
  }
  savePreferences(email: string, value: MailPreferences) {
    return this.run(email, (data) => data.savePreferences(value));
  }
  drafts(email: string) {
    return this.run(email, (data) => data.drafts());
  }
  draft(email: string, id: string) {
    return this.run(email, (data) => data.draft(id));
  }
  saveDraft(email: string, id: string, draft: SendDraft, revision: number) {
    return this.run(email, (data) => data.saveDraft(id, draft, revision));
  }
  removeDraft(email: string, id: string, revision: number) {
    return this.run(email, (data) => data.removeDraft(id, revision));
  }
}
