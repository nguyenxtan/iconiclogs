import type { BackupItem } from '../shared/backup';
import type { Folder } from '../shared/contracts';
import { errorMessage, MailApiError } from './api';

export type RestoreAttemptState = 'pending' | 'sending' | 'failed' | 'restored' | 'uncertain';
export interface RestoreAttempt {
  readonly id: string;
  readonly requestId: string;
  readonly state: RestoreAttemptState;
  readonly error?: string;
}
export interface RestoreBatch {
  readonly target: Folder;
  readonly items: readonly RestoreAttempt[];
}
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function backupDateRange(from: string, to: string): string | null {
  if ((from && !validDay(from)) || (to && !validDay(to)))
    return 'Nhập ngày hợp lệ theo định dạng ngày/tháng/năm.';
  if (from && to && from > to) return 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.';
  return null;
}
export function vietnamDay(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return '';
  const parts = dayFormatter.formatToParts(new Date(value));
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join('-');
}
export function filterBackupItems(
  items: readonly BackupItem[],
  from: string,
  to: string,
): BackupItem[] {
  if (backupDateRange(from, to)) return [];
  return items.filter((item) => {
    const day = vietnamDay(item.internalDate);
    return !!day && (!from || day >= from) && (!to || day <= to);
  });
}
export function freezeRestore(
  items: readonly BackupItem[],
  selected: ReadonlySet<string>,
  target: Folder,
  requestId: () => string = () => crypto.randomUUID(),
): RestoreBatch {
  return Object.freeze({
    target,
    items: Object.freeze(
      items
        .filter((item) => selected.has(item.id))
        .map((item) =>
          Object.freeze({ id: item.id, requestId: requestId(), state: 'pending' as const }),
        ),
    ),
  });
}
export function updateRestoreAttempt(
  batch: RestoreBatch,
  id: string,
  state: RestoreAttemptState,
  error?: string,
): RestoreBatch {
  return Object.freeze({
    ...batch,
    items: Object.freeze(
      batch.items.map((item) => (item.id === id ? Object.freeze({ ...item, state, error }) : item)),
    ),
  });
}
export function recoverRestore(batch: RestoreBatch): RestoreBatch {
  return {
    ...batch,
    items: batch.items.map((item) =>
      item.state === 'sending' ? { ...item, state: 'uncertain' } : item,
    ),
  };
}
export function nextRestoreAttempt(batch: RestoreBatch): RestoreAttempt | null {
  return batch.items.find((item) => item.state === 'pending') ?? null;
}
export function readRestoreJournal(value: string | null, recover = true): RestoreBatch[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 1000 ||
    !parsed.every(
      (batch) =>
        (batch &&
          typeof batch.target === 'string' &&
          ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'].includes(batch.target)) ||
        (batch && typeof batch.target === 'string' && batch.target.startsWith('folder:')),
    )
  )
    throw Error('Invalid restore journal');
  return parsed.map((batch) => {
    if (
      !Array.isArray(batch.items) ||
      batch.items.length > 10000 ||
      !batch.items.every((item: unknown) => {
        if (!item || typeof item !== 'object') return false;
        const attempt = item as Record<string, unknown>;
        return (
          typeof attempt.id === 'string' &&
          typeof attempt.requestId === 'string' &&
          ['pending', 'sending', 'failed', 'restored', 'uncertain'].includes(
            attempt.state as string,
          ) &&
          (attempt.error === undefined || typeof attempt.error === 'string')
        );
      })
    )
      throw Error('Invalid restore journal');
    return recover ? recoverRestore(batch as RestoreBatch) : (batch as RestoreBatch);
  });
}

export function mergeRestoreJournal(
  existing: readonly RestoreBatch[],
  incoming: readonly RestoreBatch[],
): RestoreBatch[] {
  const rank: Record<RestoreAttemptState, number> = {
    pending: 0,
    sending: 1,
    failed: 2,
    uncertain: 3,
    restored: 4,
  };
  const result = [...existing];
  for (const batch of incoming) {
    const index = result.findIndex(
      (current) =>
        current.target === batch.target &&
        current.items.length === batch.items.length &&
        current.items.every((item, i) => item.requestId === batch.items[i]?.requestId),
    );
    if (index < 0) {
      result.push(batch);
      continue;
    }
    const previous = result[index]!;
    result[index] = {
      ...batch,
      items: batch.items.map((item, i) =>
        rank[previous.items[i]!.state] > rank[item.state] ? previous.items[i]! : item,
      ),
    };
  }
  return result;
}

export function restoreFailure(error: unknown): { state: 'failed' | 'uncertain'; error: string } {
  return {
    state:
      error instanceof MailApiError && error.code === 'BACKUP_RESTORE_FAILED'
        ? 'failed'
        : 'uncertain',
    error: errorMessage(error),
  };
}
export function restoreLockedIds(journal: readonly RestoreBatch[]): Set<string> {
  return new Set(
    journal.flatMap((batch) =>
      batch.items
        .filter((item) => ['sending', 'restored', 'uncertain'].includes(item.state))
        .map((item) => item.id),
    ),
  );
}
