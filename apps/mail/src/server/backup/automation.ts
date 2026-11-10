import type { Credentials } from '../core/session';
import type { MailQuota } from '../../shared/contracts';
import type { BackupAutomation } from '../../shared/backup';
import { quotaPressure } from '../../shared/quota';

export const quotaInterval = 60 * 60 * 1000;
export const captureInterval = 24 * quotaInterval;

// The persisted "daily" key is retained for existing encrypted opt-ins.
export interface AutomaticBackup {
  quotaVersion?: 1;
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
  const pressure = quotaPressure(quota);
  const valid = !!pressure;
  // Compare original bytes, never a rounded display percentage.
  const above = !!pressure && BigInt(pressure.used) * 100n >= BigInt(pressure.limit) * 80n;
  saved.quotaVersion = 1;
  saved.automation = {
    thresholdPercent: 80,
    checkedAt: now,
    state: !valid ? 'unavailable' : above ? 'above' : 'below',
    ...(valid ? { quota: quota! } : {}),
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
  saved.nextRunAt = now + (saved.automation?.state === 'pending' ? 1000 : quotaInterval);
  saved.automation = { ...saved.automation!, nextBackupAt: now + captureInterval };
}
