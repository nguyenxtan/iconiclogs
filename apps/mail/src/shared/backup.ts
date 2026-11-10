import type { MailQuota } from './contracts';

export interface BackupRun {
  id: string;
  state: 'running' | 'complete' | 'partial' | 'error';
  captured: number;
  errors: string[];
  startedAt: string;
  finishedAt?: string;
}
export interface BackupStatus {
  enabled: boolean;
  suspended?: boolean;
  nextRunAt?: number;
  automation?: BackupAutomation;
  run: BackupRun | null;
}
export interface BackupItem {
  id: string;
  folder: string;
  uid: number;
  uidValidity: string;
  internalDate: string;
  flags: string[];
  size: number;
  sha256: string;
  capturedAt: string;
  subject?: string;
  from?: string;
}
export interface BackupRestore {
  state: 'restored' | 'uncertain';
  id: string;
  targetFolder: string;
}
export interface BackupMonth {
  month: string;
  count: number;
  rawBytes: number;
  state: 'pending' | 'packing' | 'ready' | 'stale' | 'error';
  progress?: { processed: number; total: number };
  archive?: {
    id: string;
    name: string;
    count: number;
    rawBytes: number;
    zipBytes: number;
    updatedAt: string;
  };
  error?: string;
}
export interface BackupAutomation {
  thresholdPercent: 80;
  state: 'pending' | 'below' | 'above' | 'unavailable' | 'error';
  checkedAt?: number;
  quota?: MailQuota;
  nextBackupAt?: number;
}
