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
