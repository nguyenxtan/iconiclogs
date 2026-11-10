import type { SendDraft, SendResult } from '../shared/contracts';
import { MailApiError } from './api';

export interface ComposeDeliveryOutcome {
  state: 'blocked' | 'failed' | 'unknown' | 'partial' | 'sent';
  result?: SendResult;
  error?: unknown;
  maintenanceError?: unknown;
}
/** Persist a duplicate-send guard before crossing the SMTP boundary, including after reopening. */
export async function sendDraftSafely(
  draft: SendDraft,
  key: string,
  ops: {
    persist(draft: SendDraft): Promise<void>;
    send(draft: SendDraft, key: string): Promise<SendResult>;
    remove(): Promise<void>;
  },
): Promise<ComposeDeliveryOutcome> {
  const { deliveryGuard: _guard, deliveryKey: _key, ...payload } = draft;
  const guarded: SendDraft = { ...payload, deliveryGuard: 'unknown', deliveryKey: key };
  try {
    await ops.persist(guarded);
  } catch (error) {
    return { state: 'blocked', error };
  }
  let result: SendResult;
  try {
    result = await ops.send(payload, key);
  } catch (error) {
    const definite =
      error instanceof MailApiError && error.status < 500 && error.code !== 'SEND_UNKNOWN';
    if (!definite) return { state: 'unknown', error };
    try {
      await ops.persist(payload);
      return { state: 'failed', error };
    } catch (maintenanceError) {
      return { state: 'failed', error, maintenanceError };
    }
  }
  try {
    if (result.status === 'sent') await ops.remove();
    else if (result.status === 'partial')
      await ops.persist({ ...guarded, deliveryGuard: 'partial' });
    else if (result.status === 'failed') await ops.persist(payload);
    return { state: result.status, result };
  } catch (maintenanceError) {
    return { state: result.status, result, maintenanceError };
  }
}
