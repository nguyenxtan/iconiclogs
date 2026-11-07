import type { Credentials } from '../core/session';
import { MAX_MIME } from '../core/validation';
import type {
  BackupAutomation,
  BackupItem,
  BackupRestore,
  BackupRun,
  BackupStatus,
} from '../../shared/backup';
import { backupError, backupKey, digest, open, seal } from './crypto';
import { isAuthError, MailError } from '../core/errors';
import { DefiniteRestoreFailure } from './restore';
import { MonthlyArchive, type ArchiveBucket } from './monthly';
import { monthOf, validMonth } from './zip';
import type { MailQuota } from '../../shared/contracts';
import {
  captureInterval,
  quotaInterval,
  recordQuota,
  finishAutomatic,
  type AutomaticBackup,
} from './automation';

export interface BackupFolder {
  path: string;
  uidValidity: string;
  upperUid: number;
}
export interface CaptureMessage {
  uid: number;
  internalDate: string;
  flags: string[];
  raw?: Uint8Array;
  archiveId?: string;
  oversized?: boolean;
  subject?: string;
  from?: string;
}
export type KnownMessage = (folder: BackupFolder, uid: number) => Promise<string | undefined>;
export interface BackupSource {
  quota(): Promise<MailQuota | null>;
  snapshot(): Promise<BackupFolder[]>;
  batch(
    folder: BackupFolder,
    cursor: number,
    known?: KnownMessage,
  ): Promise<{ cursor: number; messages: CaptureMessage[] }>;
  append(folder: string, raw: Uint8Array, flags: string[], date: string): Promise<boolean>;
}
export interface BackupStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list<T>(options: {
    prefix: string;
    startAfter?: string;
    limit?: number;
  }): Promise<Map<string, T>>;
  setAlarm(time: number): Promise<unknown>;
  deleteAlarm(): Promise<unknown>;
  getAlarm?(): Promise<number | null>;
}
export interface BackupBucket extends ArchiveBucket {}

interface RunState {
  run: BackupRun;
  folders: BackupFolder[];
  index: number;
  cursor: number;
  failureKind?: 'transient' | 'auth' | 'revoked';
}
interface RestoreRecord extends BackupRestore {
  fingerprint: string;
  operation?: string;
  state: 'restored' | 'uncertain';
}
const authError =
  'Máy chủ từ chối thông tin đăng nhập sao lưu. Hãy tắt rồi bật lại sao lưu để cập nhật thông tin đăng nhập.';
const revokedError =
  'Tài khoản không còn được phép sao lưu. Thông tin đăng nhập sao lưu đã bị thu hồi.';
const captureError =
  'Không đọc được thư hoặc UIDVALIDITY đã thay đổi. Hãy thử tiếp tục hoặc bắt đầu lại.';
// INBOX is the only IMAP mailbox name whose case-insensitivity is guaranteed.
function restoreTarget(folder: string) {
  let path = folder;
  if (folder.startsWith('folder:')) {
    try {
      path = decodeURIComponent(folder.slice(7));
    } catch {
      throw backupError('BACKUP_REQUEST', 'Thư mục khôi phục không hợp lệ.', 400);
    }
  }
  if (path.toLowerCase() === 'inbox') return 'path:INBOX';
  if (
    !folder.startsWith('folder:') &&
    ['sent', 'drafts', 'trash', 'junk', 'archive'].includes(folder)
  )
    return 'role:' + folder;
  return 'path:' + path;
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder();

/** Mailbox-specific service. All persisted content and metadata use authenticated encryption. */
export class BackupService {
  private scope = '';
  private email = '';
  private key?: CryptoKey;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private store: BackupStore,
    private bucket: BackupBucket | undefined,
    private secret: string,
    private source: (credentials: Credentials) => BackupSource,
    private expectedScope?: string,
  ) {}

  private async identity(email: string) {
    if (!this.bucket)
      throw backupError('BACKUP_UNAVAILABLE', 'Chưa cấu hình kho sao lưu riêng tư.', 503);
    this.key ??= await backupKey(this.secret);
    const scope = await digest(encoder.encode(email.trim().toLowerCase()));
    if (this.expectedScope && scope !== this.expectedScope)
      throw backupError('BACKUP_SCOPE', 'Không có quyền truy cập bản sao lưu.', 403);
    const existing = await this.store.get<string>('scope');
    if (existing && existing !== scope)
      throw backupError('BACKUP_SCOPE', 'Không có quyền truy cập bản sao lưu.', 403);
    if (!existing) await this.store.put('scope', scope);
    this.scope = scope;
    this.email = email.trim().toLowerCase();
  }
  private async get<T>(name: string): Promise<T | undefined> {
    const bytes = await this.store.get<Uint8Array>(name);
    return bytes
      ? (JSON.parse(
          decoder.decode(await open(new Uint8Array(bytes), this.key!, `${this.scope}:${name}`)),
        ) as T)
      : undefined;
  }
  private async put(name: string, value: unknown) {
    const encrypted = await seal(
      encoder.encode(JSON.stringify(value)),
      this.key!,
      `${this.scope}:${name}`,
    );
    if (encrypted.length > 128 * 1024)
      throw backupError(
        'BACKUP_LIMIT',
        'Thông tin sao lưu vượt giới hạn lưu trữ. Bản gốc vẫn được giữ nguyên.',
        409,
      );
    await this.store.put(name, encrypted);
  }
  private async serial<T>(email: string, operation: () => Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      await this.identity(email);
      try {
        await this.ensureIndex();
        await this.monthly().maintain();
        return await operation();
      } finally {
        await this.reconcileAlarm();
      }
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  private async currentStatus(): Promise<BackupStatus> {
    const daily = await this.get<AutomaticBackup>('daily');
    return {
      enabled: !!daily,
      ...(daily?.suspended ? { suspended: true } : {}),
      ...(daily && !daily.suspended ? { nextRunAt: daily.retryAt ?? daily.nextRunAt } : {}),
      ...(daily ? { automation: await this.automaticPolicy(daily) } : {}),
      run: (await this.get<RunState>('run'))?.run ?? null,
    };
  }
  private async automaticPolicy(saved: AutomaticBackup): Promise<BackupAutomation> {
    const history = await this.get<{ nextBackupAt: number }>('automatic-history');
    const nextBackupAt = Math.max(history?.nextBackupAt ?? 0, saved.automation?.nextBackupAt ?? 0);
    return {
      ...(saved.automation ?? { thresholdPercent: 80, state: 'pending' }),
      ...(nextBackupAt ? { nextBackupAt } : {}),
    };
  }
  private async saveAutomatic(saved: AutomaticBackup) {
    saved.automation = await this.automaticPolicy(saved);
    const history = await this.get<{ nextBackupAt: number }>('automatic-history');
    const nextBackupAt = saved.automation.nextBackupAt;
    // Keep non-secret cooldown independently of the revocable credential record.
    if (nextBackupAt && nextBackupAt > (history?.nextBackupAt ?? 0))
      await this.put('automatic-history', { nextBackupAt });
    await this.put('daily', saved);
  }
  status(email: string) {
    return this.serial(email, () => this.currentStatus());
  }
  configure(credentials: Credentials, enabled: boolean) {
    return this.serial(credentials.email, async () => {
      if (enabled) {
        this.source(credentials); // Validate provider configuration and current account allowlist before saving credentials.
        const existing = await this.get<AutomaticBackup>('daily');
        const nextRunAt = Date.now() + 1000;
        await this.saveAutomatic({
          credentials,
          nextRunAt,
          automation: existing?.automation ?? { thresholdPercent: 80, state: 'pending' },
          ...(existing?.runId ? { runId: existing.runId } : {}),
          ...(existing?.pendingRunId ? { pendingRunId: existing.pendingRunId } : {}),
          ...(existing?.pendingPreviousRunId
            ? { pendingPreviousRunId: existing.pendingPreviousRunId }
            : {}),
          ...(existing?.runId && (existing.retryAt || existing.suspended)
            ? { retryAt: nextRunAt }
            : {}),
        });
      } else {
        await this.store.delete('daily');
        await this.monthly().maintain();
      }
      return this.currentStatus();
    });
  }
  private async begin(credentials: Credentials, runId?: string) {
    const existing = await this.get<RunState>('run');
    if (existing?.run.state === 'running' || (runId && existing?.run.id === runId))
      return this.currentStatus();
    const run: BackupRun = {
      id: runId ?? crypto.randomUUID(),
      state: 'running',
      captured: 0,
      errors: [],
      startedAt: new Date().toISOString(),
    };
    // Persist the attempt before network work, so an interrupted snapshot is visible and retryable.
    const state: RunState = { run, folders: [], index: 0, cursor: 0 };
    await this.put('run', state);
    try {
      const folders = await this.source(credentials).snapshot();
      if (folders.length > 100) throw Error();
      state.folders = folders;
      if (
        !state.folders.length &&
        !(await this.monthly().months()).some((month) => month.state !== 'ready')
      ) {
        run.state = 'complete';
        run.finishedAt = new Date().toISOString();
      }
    } catch (error) {
      this.fail(state, error);
      run.finishedAt = new Date().toISOString();
    }
    await this.put('run', state);
    return this.currentStatus();
  }
  start(credentials: Credentials) {
    return this.serial(credentials.email, () => this.begin(credentials));
  }
  private fail(state: RunState, error: unknown) {
    state.run.state = 'error';
    state.failureKind = isAuthError(error)
      ? 'auth'
      : error instanceof MailError && error.code === 'BACKUP_REVOKED'
        ? 'revoked'
        : 'transient';
    const message =
      state.failureKind === 'auth'
        ? authError
        : state.failureKind === 'revoked'
          ? revokedError
          : captureError;
    if (state.run.errors.length < 100 && !state.run.errors.includes(message))
      state.run.errors.push(message);
  }
  private async seenKey(folder: BackupFolder, uid: number) {
    return (
      'seen:' +
      (await digest(encoder.encode(JSON.stringify([folder.path, folder.uidValidity, uid]))))
    );
  }
  private async advance(credentials: Credentials) {
    const state = await this.get<RunState>('run');
    if (!state || !['running', 'error'].includes(state.run.state)) return this.currentStatus();
    state.run.state = 'running';
    state.run.errors = state.run.errors.filter(
      (message) => ![captureError, authError, revokedError].includes(message),
    );
    delete state.run.finishedAt;
    delete state.failureKind;
    try {
      const source = this.source(credentials);
      // A discovery failure has no cursor yet; retry it within the same persisted run.
      if (!state.folders.length) {
        const folders = await source.snapshot();
        if (folders.length > 100) throw Error();
        state.folders = folders;
      }
      const folder = state.folders[state.index];
      if (folder) {
        const verified = new Set<string>();
        const archiveReader = this.monthly();
        const known: KnownMessage = async (box, uid) => {
          const seen = await this.get<{ id: string }>(await this.seenKey(box, uid));
          if (!seen) return undefined;
          try {
            const { item } = await this.content(seen.id, archiveReader);
            if (
              item.folder !== box.path ||
              item.uidValidity !== box.uidValidity ||
              item.uid !== uid
            )
              return undefined;
            verified.add(seen.id);
            return seen.id;
          } catch (error) {
            if (
              error instanceof MailError &&
              ['BACKUP_CORRUPT', 'BACKUP_NOT_FOUND'].includes(error.code)
            )
              return undefined;
            throw error;
          }
        };
        const batch = await source.batch(folder, state.cursor, known);
        if (batch.cursor < state.cursor || batch.cursor > folder.upperUid) throw Error();
        let captured = 0;
        for (const message of batch.messages) {
          if (message.archiveId) {
            if (!verified.has(message.archiveId)) throw Error('unverified archive reference');
            captured++;
            continue;
          }
          if (message.oversized || (message.raw?.byteLength ?? 0) > MAX_MIME) {
            if (state.run.errors.length < 100)
              state.run.errors.push(
                `Thư UID ${message.uid} vượt giới hạn 25 MiB và chưa được sao lưu.`,
              );
            continue;
          }
          if (!message.raw) throw Error('missing MIME');
          const sha256 = await digest(message.raw);
          const id = await digest(
            encoder.encode(JSON.stringify([folder.path, folder.uidValidity, message.uid, sha256])),
          );
          const name = 'item:' + id;
          const existing = await this.get<BackupItem>(name);
          if (!existing) {
            await this.bucket!.put(
              `${this.scope}/${id}`,
              await seal(message.raw, this.key!, `${this.scope}:mime:${id}`),
            );
            await this.indexed({
              id,
              folder: folder.path,
              uid: message.uid,
              uidValidity: folder.uidValidity,
              internalDate: message.internalDate,
              flags: message.flags,
              size: message.raw.byteLength,
              sha256,
              capturedAt: new Date().toISOString(),
              ...(message.subject ? { subject: message.subject } : {}),
              ...(message.from ? { from: message.from } : {}),
            } satisfies BackupItem);
          }
          let intact = !existing;
          if (!existing) await this.content(id);
          if (existing)
            try {
              await this.content(id);
              intact = true;
            } catch (error) {
              if (
                !(error instanceof MailError) ||
                !['BACKUP_CORRUPT', 'BACKUP_NOT_FOUND'].includes(error.code)
              )
                throw error;
            }
          if (!intact) {
            const month = monthOf(message.internalDate);
            const revisionKey = `month-stat:${month}`;
            const stats = await this.get<{ count: number; rawBytes: number; revision: number }>(
              revisionKey,
            );
            if (stats) await this.put(revisionKey, { ...stats, revision: stats.revision + 1 });
            // The trusted original MIME can repair a missing or corrupt deterministic object.
            await this.bucket!.put(
              `${this.scope}/${id}`,
              await seal(message.raw, this.key!, `${this.scope}:mime:${id}`),
            );
            await this.content(id);
          }
          await this.indexed((await this.get<BackupItem>(name))!);
          await this.put(await this.seenKey(folder, message.uid), { id });
          captured++;
        }
        state.run.captured += captured;
        state.cursor = batch.cursor;
        if (state.cursor >= folder.upperUid) {
          state.index++;
          state.cursor = 0;
        }
      }
      if (state.index >= state.folders.length) {
        const monthly = this.monthly();
        const pending = (await monthly.months()).find((month) => month.state !== 'ready');
        if (pending) {
          const result =
            pending.state === 'pending' || pending.state === 'stale'
              ? await monthly.start(pending.month)
              : await monthly.step(pending.month);
          if (result.state === 'error') throw Error('monthly packaging interrupted');
        } else state.run.state = state.run.errors.length ? 'partial' : 'complete';
      }
    } catch (error) {
      this.fail(state, error);
    }
    if (state.run.state !== 'running') state.run.finishedAt = new Date().toISOString();
    await this.put('run', state);
    return this.currentStatus();
  }
  step(credentials: Credentials) {
    return this.serial(credentials.email, () => this.advance(credentials));
  }
  private async indexed(item: BackupItem) {
    const month = monthOf(item.internalDate),
      membership = `month-item:${month}:${item.id}`;
    if (await this.get(membership)) return;
    const previous = (await this.get<{ count: number; rawBytes: number; revision: number }>(
      `month-stat:${month}`,
    )) ?? { count: 0, rawBytes: 0, revision: 0 };
    await this.put('index-pending', {
      item,
      month,
      stats: {
        count: previous.count + 1,
        rawBytes: previous.rawBytes + item.size,
        revision: previous.revision + 1,
      },
    });
    await this.replayIndex();
  }
  private async replayIndex() {
    const pending = await this.get<{
      item: BackupItem;
      month: string;
      stats: { count: number; rawBytes: number; revision: number };
    }>('index-pending');
    if (!pending) return;
    // The intent precedes item publication. Replay publishes all metadata even if the
    // provider no longer has the message when a lost write response is retried.
    await this.put(`item:${pending.item.id}`, pending.item);
    await this.put(`month-stat:${pending.month}`, pending.stats);
    await this.put(`month-item:${pending.month}:${pending.item.id}`, pending.item);
    await this.store.delete('index-pending');
  }
  private async ensureIndex() {
    await this.replayIndex();
    if (await this.get('index-ready')) return;
    let cursor = (await this.get<string>('index-cursor')) ?? '';
    // Legacy metadata is indexed once; every 32 rows is a durable restart point.
    // This migration reads no MIME and can resume if the request is interrupted.
    while (true) {
      const rows = await this.store.list<Uint8Array>({
        prefix: 'item:',
        ...(cursor ? { startAfter: cursor } : {}),
        limit: 32,
      });
      for (const name of rows.keys()) {
        await this.indexed((await this.get<BackupItem>(name))!);
        cursor = name;
      }
      if (cursor) await this.put('index-cursor', cursor);
      if (rows.size < 32) break;
    }
    await this.put('index-ready', true);
  }
  private async indexedList<T>(
    prefix: string,
    startAfter?: string,
    limit?: number,
  ): Promise<{ name: string; value: T }[]> {
    const rows = await this.store.list<Uint8Array>({
      prefix,
      ...(startAfter ? { startAfter } : {}),
      ...(limit ? { limit } : {}),
    });
    const result: { name: string; value: T }[] = [];
    for (const name of rows.keys()) result.push({ name, value: (await this.get<T>(name))! });
    return result;
  }
  private async items() {
    const entries = await this.store.list<Uint8Array>({ prefix: 'item:' });
    const items: BackupItem[] = [];
    for (const name of entries.keys()) items.push((await this.get<BackupItem>(name))!);
    return items.sort((a, b) => b.internalDate.localeCompare(a.internalDate));
  }
  private monthly(): MonthlyArchive {
    const monthly: MonthlyArchive = new MonthlyArchive({
      scope: this.scope,
      email: this.email,
      key: this.key!,
      bucket: this.bucket!,
      get: <T>(name: string) => this.get<T>(name),
      put: (name, value) => this.put(name, value),
      remove: (name) => this.store.delete(name),
      list: <T>(prefix: string, startAfter?: string, limit?: number) =>
        this.indexedList<T>(prefix, startAfter, limit),
      content: (id) => this.content(id, monthly),
    });
    return monthly;
  }
  catalog(email: string, month?: string) {
    return this.serial(email, async () => {
      if (month !== undefined) validMonth(month);
      return month === undefined
        ? this.items()
        : (await this.indexedList<BackupItem>(`month-item:${month}:`))
            .map((row) => row.value)
            .sort((a, b) => b.internalDate.localeCompare(a.internalDate));
    });
  }
  months(email: string) {
    return this.serial(email, () => this.monthly().months());
  }
  packMonth(email: string, month: string) {
    return this.serial(email, () => this.monthly().start(month));
  }
  packMonthStep(email: string, month: string) {
    return this.serial(email, () => this.monthly().step(month));
  }
  describeMonth(email: string, month: string) {
    return this.serial(email, () => this.monthly().describe(month));
  }
  downloadMonth(email: string, month: string) {
    return this.serial(email, () => this.monthly().download(month));
  }
  private async content(
    id: string,
    reader?: MonthlyArchive,
  ): Promise<{ item: BackupItem; raw: Uint8Array }> {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw backupError('BACKUP_NOT_FOUND', 'Không tìm thấy bản sao lưu.', 404);
    const item = await this.get<BackupItem>(`item:${id}`);
    if (!item) throw backupError('BACKUP_NOT_FOUND', 'Không tìm thấy bản sao lưu.', 404);
    const object = await this.bucket!.get(`${this.scope}/${id}`);
    if (!object) {
      const raw = await (reader ?? this.monthly()).archivedContent(item);
      if (!raw) throw backupError('BACKUP_CORRUPT', 'Không đọc được nội dung bản sao lưu.', 502);
      return { item, raw };
    }
    const raw = await open(
      new Uint8Array(await object.arrayBuffer()),
      this.key!,
      `${this.scope}:mime:${id}`,
    );
    if (raw.byteLength !== item.size || (await digest(raw)) !== item.sha256)
      throw backupError('BACKUP_CORRUPT', 'Bản sao lưu không xác minh được tính toàn vẹn.', 502);
    return { item, raw };
  }
  download(email: string, id: string) {
    return this.serial(email, async () => {
      const { raw } = await this.content(id);
      return { content: raw, name: `mail-${id.slice(0, 16)}.eml`, type: 'message/rfc822' };
    });
  }
  restore(credentials: Credentials, id: string, targetFolder: string, requestId: string) {
    return this.serial(credentials.email, async (): Promise<BackupRestore> => {
      if (
        !targetFolder ||
        targetFolder.length > 2300 ||
        /[\x00-\x1f\x7f]/.test(targetFolder) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)
      )
        throw backupError('BACKUP_REQUEST', 'Thư mục hoặc mã khôi phục không hợp lệ.', 400);
      const fingerprint = await digest(encoder.encode(JSON.stringify([id, targetFolder])));
      const name = `restore:${requestId}`;
      const previous = await this.get<RestoreRecord>(name);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw backupError('BACKUP_CONFLICT', 'Mã khôi phục đã được dùng cho yêu cầu khác.');
        const operation = previous.operation
          ? await this.get<RestoreRecord>(previous.operation)
          : undefined;
        return {
          state: operation?.state ?? previous.state,
          id: previous.id,
          targetFolder: previous.targetFolder,
        };
      }
      const { item, raw } = await this.content(id);
      const source = this.source(credentials);
      const operation =
        'restore-content:' +
        (await digest(encoder.encode(JSON.stringify([item.sha256, restoreTarget(targetFolder)]))));
      const priorOperation = await this.get<RestoreRecord>(operation);
      const record: RestoreRecord = {
        fingerprint,
        operation,
        id,
        targetFolder,
        state: priorOperation?.state ?? 'uncertain',
      };
      if (priorOperation) {
        // Persist this new request's intent too, so its key cannot later be reused for another target.
        await this.put(name, record);
        return { state: priorOperation.state, id, targetFolder };
      }
      // Both ledgers are durable before APPEND. Content/target survives lost browser request IDs.
      await this.put(operation, record);
      await this.put(name, record);
      try {
        if (await source.append(targetFolder, raw, item.flags, item.internalDate)) {
          record.state = 'restored';
          await this.put(operation, record);
          await this.put(name, record);
        }
      } catch (error) {
        if (error instanceof DefiniteRestoreFailure) {
          // Only the adapter's proof that APPEND was never invoked permits a safe retry.
          await this.store.delete(name);
          await this.store.delete(operation);
          throw backupError(
            'BACKUP_RESTORE_FAILED',
            'Thư chưa được khôi phục. Hãy kiểm tra thư mục và kết nối rồi thử lại.',
            502,
          );
        }
        /* A lost reply after APPEND was invoked must never trigger a second APPEND. */
      }
      return { state: record.state, id, targetFolder };
    });
  }
  private async reconcileAlarm() {
    // Daily work and credential-free retirement share one Durable Object alarm.
    // Recompute durable obligations after every operation; retain an earlier continuation only while work remains.
    const now = Date.now(),
      deadlines: number[] = [];
    const existing = await this.store.getAlarm?.();
    // Polling must not move an already scheduled continuation into the future.
    const continuation = existing && existing > now ? Math.min(existing, now + 5000) : now + 5000;
    const retired = await this.indexedList<{ deleteAfter: number }>('retired:', undefined, 1);
    if (retired[0])
      deadlines.push(
        retired[0].value.deleteAfter > now ? retired[0].value.deleteAfter : continuation,
      );
    const daily = await this.get<AutomaticBackup>('daily');
    if (daily && !daily.suspended) {
      const run = (await this.get<RunState>('run'))?.run;
      const running = !!daily.pendingRunId || (run?.state === 'running' && run.id === daily.runId);
      deadlines.push(running ? continuation : Math.max(now + 1, daily.retryAt ?? daily.nextRunAt));
    }
    if (deadlines.length) await this.store.setAlarm(Math.min(...deadlines));
    else await this.store.deleteAlarm();
  }
  async alarm() {
    // Alarm has no caller credentials; the opt-in record is the sole source of authority.
    const scope = await this.store.get<string>('scope');
    if (!scope || !this.bucket) return;
    this.key ??= await backupKey(this.secret);
    this.scope = scope;
    const daily = await this.get<AutomaticBackup>('daily');
    if (!daily) {
      const work = this.queue.then(async () => {
        try {
          await this.monthly().maintain();
        } finally {
          await this.reconcileAlarm();
        }
      });
      this.queue = work.catch(() => undefined);
      await work;
      return;
    }
    return this.serial(daily.credentials.email, async () => {
      // Re-read after acquiring the queue: disable may have revoked the record meanwhile.
      const saved = await this.get<AutomaticBackup>('daily');
      if (!saved) return;
      if (saved.suspended) {
        return;
      }
      // The source factory validates current allowlist membership before any provider network.
      try {
        this.source(saved.credentials);
      } catch (error) {
        if (error instanceof MailError && error.code === 'BACKUP_REVOKED') {
          const state = await this.get<RunState>('run');
          if (state) {
            this.fail(state, error);
            await this.put('run', state);
          }
          await this.store.delete('daily');
          return;
        }
        throw error;
      }
      let status = await this.currentStatus();
      saved.automation = status.automation;
      // A pending intent can resume only its exact run, never a newer manual replacement.
      if (
        saved.pendingRunId &&
        status.run &&
        status.run.id !== saved.pendingRunId &&
        (status.run.id !== saved.pendingPreviousRunId || status.run.state === 'running')
      ) {
        delete saved.pendingRunId;
        delete saved.pendingPreviousRunId;
        delete saved.runId;
        delete saved.retryAt;
        saved.nextRunAt = Date.now() + quotaInterval;
        await this.saveAutomatic(saved);
        return;
      }
      const due = saved.retryAt ?? saved.nextRunAt;
      const owned = !!saved.runId && saved.runId === status.run?.id;
      const continuing = !!saved.pendingRunId || (owned && status.run?.state === 'running');
      // A manual UI continuation may have completed an owned run between alarms.
      if (owned && ['complete', 'partial'].includes(status.run!.state)) {
        finishAutomatic(saved, Date.now());
        await this.saveAutomatic(saved);
        return;
      }
      const ownedError = owned && status.run?.state === 'error';
      if (!continuing && !(ownedError && !saved.retryAt) && Date.now() < due) return;
      if (!continuing && !ownedError) {
        delete saved.retryAt;
        delete saved.runId;
        let quota: MailQuota | null;
        try {
          quota = await this.source(saved.credentials).quota();
        } catch (error) {
          if (error instanceof MailError && error.code === 'BACKUP_REVOKED') {
            await this.store.delete('daily');
            return;
          }
          saved.automation = {
            thresholdPercent: 80,
            state: 'error',
            checkedAt: Date.now(),
            ...(saved.automation?.nextBackupAt
              ? { nextBackupAt: saved.automation.nextBackupAt }
              : {}),
          };
          if (isAuthError(error)) saved.suspended = true;
          else saved.nextRunAt = Date.now() + quotaInterval;
          await this.saveAutomatic(saved);
          return;
        }
        if (!recordQuota(saved, quota, Date.now())) {
          await this.saveAutomatic(saved);
          return;
        }
        // Qualifying intent is durable before the run/snapshot. Resume it after lost replies.
        saved.pendingRunId = status.run?.state === 'running' ? status.run.id : crypto.randomUUID();
        saved.pendingPreviousRunId = status.run?.id;
        await this.saveAutomatic(saved);
      }
      if (saved.pendingRunId) {
        status = await this.begin(saved.credentials, saved.pendingRunId);
        saved.runId = status.run!.id;
        delete saved.pendingRunId;
        delete saved.pendingPreviousRunId;
        saved.automation!.nextBackupAt = Date.now() + captureInterval;
        await this.saveAutomatic(saved);
      }
      if (saved.retryAt && status.run?.state === 'error')
        status = await this.advance(saved.credentials);
      else if (status.run?.state === 'running') status = await this.advance(saved.credentials);
      delete saved.retryAt;
      if (status.run?.state === 'running') {
        // The shared scheduler derives the continuation deadline from the durable run.
      } else if (status.run?.state === 'error') {
        const state = (await this.get<RunState>('run'))!;
        if (state.failureKind === 'auth') {
          saved.suspended = true;
        } else if (state.failureKind === 'revoked') {
          await this.store.delete('daily');
          return;
        } else if ((saved.retries ?? 0) < 5) {
          saved.retries = (saved.retries ?? 0) + 1;
          saved.retryAt = Date.now() + Math.min(30000 * 2 ** (saved.retries - 1), 10 * 60 * 1000);
        } else {
          if (state.run.errors.length < 100)
            state.run.errors.push(
              'Đã hết lượt tự động thử lại. Có thể tiếp tục thủ công; hệ thống sẽ kiểm tra dung lượng theo lịch.',
            );
          await this.put('run', state);
          saved.retries = 0;
          finishAutomatic(saved, Date.now());
        }
      } else {
        finishAutomatic(saved, Date.now());
      }
      await this.saveAutomatic(saved);
    });
  }
}
