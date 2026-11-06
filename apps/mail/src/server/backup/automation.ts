import type { Credentials } from '../core/session';
import type { MailQuota } from '../../shared/contracts';
import type { BackupAutomation } from '../../shared/backup';

export const quotaInterval = 60 * 60 * 1000;
export const captureInterval = 24 * quotaInterval;

// The persisted "daily" key is retained for existing encrypted opt-ins.
export interface AutomaticBackup {
  credentials: Credentials;
  nextRunAt: number;
  retries?: number;
  retryAt?: number;
  suspended?: boolean;
  automation?: BackupAutomation;
  pendingRunId?: string;
  pendingPreviousRunId?: string;
  runId?: string;
}

export function recordQuota(saved: AutomaticBackup, quota: MailQuota | null, now: number) {
  const valid =
    quota &&
    Number.isSafeInteger(quota.used) &&
    Number.isSafeInteger(quota.limit) &&
    quota.used >= 0 &&
    quota.limit > 0;
  // Compare original bytes, never a rounded display percentage.
  const above = !!valid && BigInt(quota.used) * 100n >= BigInt(quota.limit) * 80n;
  saved.automation = {
    thresholdPercent: 80,
    checkedAt: now,
    state: !valid ? 'unavailable' : above ? 'above' : 'below',
    ...(valid ? { quota } : {}),
    ...(saved.automation?.nextBackupAt ? { nextBackupAt: saved.automation.nextBackupAt } : {}),
  };
  saved.nextRunAt = now + quotaInterval;
  return above && now >= (saved.automation.nextBackupAt ?? 0);
}

export function finishAutomatic(saved: AutomaticBackup, now: number) {
  saved.retries = 0;
  delete saved.retryAt;
  delete saved.runId;
  delete saved.pendingRunId;
  delete saved.pendingPreviousRunId;
  saved.nextRunAt = now + quotaInterval;
  saved.automation = { ...saved.automation!, nextBackupAt: now + captureInterval };
}
