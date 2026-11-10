import { describe, expect, it } from 'vitest';
import type { BackupItem } from '../../shared/backup';
import {
  backupDateRange,
  filterBackupItems,
  freezeRestore,
  recoverRestore,
  nextRestoreAttempt,
  updateRestoreAttempt,
} from '../backupState';
const item = (id: string, internalDate: string): BackupItem => ({
  id,
  internalDate,
  folder: 'INBOX',
  uid: 1,
  uidValidity: '1',
  flags: [],
  size: 12,
  sha256: 'digest',
  capturedAt: '2026-11-04T00:00:00.000Z',
});
describe('backup selection safety', () => {
  it('uses inclusive Vietnam calendar dates from internalDate rather than capture time', () => {
    const items = [
      item('before', '2026-11-03T16:59:59Z'),
      item('start', '2026-11-03T17:00:00Z'),
      item('end', '2026-11-04T16:59:59Z'),
      item('after', '2026-11-04T17:00:00Z'),
    ];
    expect(filterBackupItems(items, '2026-11-04', '2026-11-04').map((row) => row.id)).toEqual([
      'start',
      'end',
    ]);
  });
  it('refuses impossible or reversed date bounds instead of broadening the restore range', () => {
    for (const [from, to] of [
      ['2026-02-31', ''],
      ['2026-11-05', '2026-11-04'],
      ['2026-1-1', ''],
    ])
      expect(backupDateRange(from!, to!)).toBeTruthy();
    expect(backupDateRange('', '2026-11-04')).toBeNull();
    expect(
      filterBackupItems([item('x', '2026-11-04T00:00:00Z')], '2026-11-05', '2026-11-04'),
    ).toEqual([]);
  });
  it('freezes exact IDs, target and per-item request IDs before a restore starts', () => {
    const selected = new Set(['a', 'b']);
    let sequence = 0;
    const batch = freezeRestore(
      [item('a', '2026-01-01'), item('b', '2026-01-02')],
      selected,
      'archive',
      () => `request-${++sequence}`,
    );
    selected.clear();
    expect(batch.target).toBe('archive');
    expect(batch.items).toEqual([
      { id: 'a', requestId: 'request-1', state: 'pending' },
      { id: 'b', requestId: 'request-2', state: 'pending' },
    ]);
    expect(Object.isFrozen(batch.items)).toBe(true);
  });
  it('never schedules restored, uncertain or interrupted attempts again', () => {
    const batch = freezeRestore(
      [item('a', '2026-01-01'), item('b', '2026-01-02')],
      new Set(['a', 'b']),
      'inbox',
      () => crypto.randomUUID(),
    );
    const sending = updateRestoreAttempt(batch, 'a', 'sending');
    const recovered = recoverRestore(sending);
    expect(recovered.items[0]!.state).toBe('uncertain');
    expect(nextRestoreAttempt(recovered)?.id).toBe('b');
    const finished = updateRestoreAttempt(recovered, 'b', 'restored');
    expect(nextRestoreAttempt(finished)).toBeNull();
    expect(finished.items[0]!.requestId).toBe(batch.items[0]!.requestId);
  });
});

it('does not let a late response overwrite progress made after reopening the panel', async () => {
  const { mergeRestoreJournal } = await import('../backupState');
  const batch = freezeRestore(
    [item('a', '2026-01-01'), item('b', '2026-01-02')],
    new Set(['a', 'b']),
    'inbox',
    (() => {
      let n = 0;
      return () => `r${++n}`;
    })(),
  );
  const latest = updateRestoreAttempt(
    updateRestoreAttempt(batch, 'a', 'uncertain'),
    'b',
    'sending',
  );
  const late = updateRestoreAttempt(batch, 'a', 'restored');
  const merged = mergeRestoreJournal([latest], [late]);
  expect(merged[0]!.items.map((attempt) => attempt.state)).toEqual(['restored', 'sending']);
  expect(nextRestoreAttempt(merged[0]!)).toBeNull();
});

it('classifies only explicit pre-append rejection as retryable and preserves its per-item error', async () => {
  const { restoreFailure, restoreLockedIds, mergeRestoreJournal, readRestoreJournal } =
    await import('../backupState');
  const { MailApiError } = await import('../api');
  expect(restoreFailure(new MailApiError(409, 'BACKUP_RESTORE_FAILED', 'Chưa ghi thư.'))).toEqual({
    state: 'failed',
    error: 'Chưa ghi thư.',
  });
  expect(
    restoreFailure(new MailApiError(502, 'BACKUP_RESTORE_FAILED', 'Chưa ghi thư.')).state,
  ).toBe('failed');
  for (const error of [
    new MailApiError(409, 'OTHER', 'Unknown'),
    { code: 'BACKUP_RESTORE_FAILED' },
    Error('network lost'),
  ])
    expect(restoreFailure(error).state).toBe('uncertain');
  const original = freezeRestore([item('a', '2026-01-01')], new Set(['a']), 'inbox', () =>
    crypto.randomUUID(),
  );
  const failed = updateRestoreAttempt(original, 'a', 'failed', 'Chưa ghi thư.');
  expect(nextRestoreAttempt(failed)).toBeNull();
  expect(restoreLockedIds([failed]).has('a')).toBe(false);
  const next = freezeRestore([item('a', '2026-01-01')], new Set(['a']), 'inbox', () =>
    crypto.randomUUID(),
  );
  expect(next.items[0]!.requestId).not.toBe(failed.items[0]!.requestId);
  expect(readRestoreJournal(JSON.stringify([failed]))[0]!.items[0]).toMatchObject({
    state: 'failed',
    error: 'Chưa ghi thư.',
  });
  for (const state of ['uncertain', 'restored'] as const) {
    const protectedBatch = updateRestoreAttempt(original, 'a', state);
    expect(mergeRestoreJournal([protectedBatch], [failed])[0]!.items[0]!.state).toBe(state);
    expect(restoreLockedIds([failed, protectedBatch]).has('a')).toBe(true);
  }
});
