import { DurableObject } from 'cloudflare:workers';
import {
  lockSession,
  unlockSession,
  type Credentials,
  type SessionRecord,
  sha256,
} from '../core/session';
import { prepareAndSend, type SendRecord, type SendStore } from '../core/send';
import type { SendDraft } from '../../shared/contracts';
import type { Env } from '../worker';
import { configuration } from '../config';
import { ViettelProvider } from '../providers/viettel';
import { isAuthError, SendPreparationError, MailError } from '../core/errors';

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
    // Credentials and prepared MIME stay request-local. Only delivery metadata is durable.
    try {
      const result = await prepareAndSend(store, key, fingerprint, async () => {
        const cacheKey = JSON.stringify(config.provider);
        const cached = await storage.get<{ scope: string; path: string; until: number }>(
          'sent-path',
        );
        const path =
          cached?.scope === cacheKey && cached.until > Date.now() ? cached.path : undefined;
        const prepared = await new ViettelProvider(credentials, config.provider).prepareSend(
          draft,
          `<${key}@${credentials.email.split('@')[1]}>`,
          path,
        );
        if (prepared.sentPath)
          await storage.put('sent-path', {
            scope: cacheKey,
            path: prepared.sentPath,
            until: Date.now() + 600000,
          });
        return prepared.deliver;
      });
      if (result.sentCopy === 'unconfirmed') await storage.delete('sent-path');
      return { result };
    } catch (error) {
      // Explicit result discriminants survive DO RPC without exposing provider transcripts.
      if (isAuthError(error)) return { error: 'AUTH' as const };
      if (error instanceof SendPreparationError) return { error: 'PREPARATION' as const };
      if (error instanceof MailError && error.code === 'SEND_CONFLICT')
        return { error: 'CONFLICT' as const };
      throw error;
    }
  }
}
