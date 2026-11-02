import { DurableObject } from 'cloudflare:workers';
import {
  lockSession,
  unlockSession,
  type Credentials,
  type SessionRecord,
  sha256,
} from '../core/session';
import { sendOnce, type SendRecord, type SendStore } from '../core/send';
import type { SendDraft } from '../../shared/contracts';
import type { Env } from '../worker';
import { configuration } from '../config';
import { ViettelProvider } from '../providers/viettel';

export class SessionVault extends DurableObject<Env> {
  async create(credentials: Credentials, id: string) {
    const record = await lockSession(credentials, this.env.SESSION_KEY || '', id);
    await this.ctx.storage.put('session', record);
    await this.ctx.storage.setAlarm(record.expiresAt);
    return { email: record.email, expiresAt: record.expiresAt, csrfToken: record.csrfToken };
  }
  async info() {
    const record = await this.ctx.storage.get<SessionRecord>('session');
    if (!record || record.expiresAt <= Date.now()) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return { email: record.email, expiresAt: record.expiresAt, csrfToken: record.csrfToken };
  }
  async credentials(id: string) {
    const record = await this.ctx.storage.get<SessionRecord>('session');
    if (!record || record.expiresAt <= Date.now()) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return unlockSession(record, this.env.SESSION_KEY || '', id);
  }
  async revoke() {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  async attempt() {
    return this.ctx.storage.transaction(async (txn) => {
      const now = Date.now();
      const previous = await txn.get<{ until: number; count: number }>('rate');
      const bucket =
        previous && previous.until > now ? previous : { until: now + 15 * 60 * 1000, count: 0 };
      if (bucket.count >= 10) return false;
      bucket.count++;
      await txn.put('rate', bucket);
      await txn.setAlarm(bucket.until);
      return true;
    });
  }
  async alarm() {
    const session = await this.ctx.storage.get<SessionRecord>('session');
    const rate = await this.ctx.storage.get<{ until: number }>('rate');
    const deadline = session?.expiresAt ?? rate?.until;
    if (deadline && deadline > Date.now()) {
      await this.ctx.storage.setAlarm(deadline);
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}

export class MailboxCoordinator extends DurableObject<Env> {
  async send(credentials: Credentials, draft: SendDraft, key: string) {
    const config = configuration(this.env);
    const fingerprint = await sha256(JSON.stringify({ email: credentials.email, draft }));
    const storage = this.ctx.storage;
    const store: SendStore = {
      get: (id) => storage.get<SendRecord>('send:' + id),
      claim: (id, record) =>
        storage.transaction(async (txn) => {
          if (await txn.get('send:' + id)) return false;
          await txn.put('send:' + id, record);
          return true;
        }),
      put: (id, record) => storage.put('send:' + id, record),
    };
    // Keep only delivery status, hashes and recipient addresses. Never persist MIME or credentials here.
    return sendOnce(store, key, fingerprint, () =>
      new ViettelProvider(credentials, config.provider).send(
        draft,
        `<${key}@${credentials.email.split('@')[1]}>`,
      ),
    );
  }
}
