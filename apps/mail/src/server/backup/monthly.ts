import { inflateRawSync } from 'node:zlib';
import type { BackupItem, BackupMonth } from '../../shared/backup';
import { backupError, digest, open, seal } from './crypto';
import {
  archivePath,
  boundedZip,
  crc32,
  monthOf,
  validMonth,
  zipDescriptor,
  zipDirectory,
  zipEnd,
  zipEntry,
  zipHeader,
  type ZipRecord,
} from './zip';

export const ARCHIVE_CHUNK = 6 * 1024 * 1024;
const OVERHEAD = 29;
const encoder = new TextEncoder();
export interface ArchiveBucket {
  put(key: string, bytes: Uint8Array): Promise<unknown>;
  get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head?(key: string): Promise<{ size: number } | null>;
  delete?(key: string): Promise<unknown>;
  createMultipartUpload?(key: string): Promise<{ uploadId: string }>;
  resumeMultipartUpload?(
    key: string,
    uploadId: string,
  ): {
    uploadPart(
      partNumber: number,
      value: Uint8Array,
    ): Promise<{ partNumber: number; etag: string }>;
    complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>;
  };
}
interface Access {
  scope: string;
  email: string;
  key: CryptoKey;
  bucket: ArchiveBucket;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<unknown>;
  list<T>(
    prefix: string,
    startAfter?: string,
    limit?: number,
  ): Promise<{ name: string; value: T }[]>;
  content(id: string): Promise<{ item: BackupItem; raw: Uint8Array }>;
}
interface Archive {
  id: string;
  month: string;
  key: string;
  count: number;
  rawBytes: number;
  zipBytes: number;
  fingerprint: string;
  updatedAt: string;
  revision: number;
}
interface Job extends Archive {
  uploadId?: string;
  phase:
    | 'snapshot'
    | 'entries'
    | 'verify-chunks'
    | 'manifest'
    | 'directory'
    | 'finish'
    | 'verify'
    | 'publish'
    | 'cleanup'
    | 'tidy'
    | 'done';
  previous?: Archive;
  retiredAt?: number;
  cursor?: string;
  index: number;
  offset: number;
  parts: number;
  carry?: string;
  generation: number;
  directoryOffset?: number;
  manifest?: ZipRecord;
  error?: string;
  errorCode?: string;
}
interface Entry {
  item: BackupItem;
  record?: ZipRecord;
}
interface Reference {
  archive: Archive;
  record: ZipRecord;
}
export class MonthlyArchive {
  private chunkCache?: { id: string; index: number; bytes: Uint8Array };
  private obsoleteCarries = new Set<string>();
  constructor(private access: Access) {}
  private jobKey(month: string) {
    return `month-job:${validMonth(month)}`;
  }
  private entryKey(id: string, index: number) {
    return `zip-entry:${id}:${index}`;
  }
  private partKey(id: string, part: number) {
    return `zip-part:${id}:${part}`;
  }
  private context(archive: Archive, part: number) {
    return `${this.access.scope}:zip:${archive.id}:${part}`;
  }
  private async stats(month: string) {
    return (
      (await this.access.get<{ count: number; rawBytes: number; revision: number }>(
        `month-stat:${month}`,
      )) ?? { count: 0, rawBytes: 0, revision: 0 }
    );
  }
  private publicArchive(archive: Archive): NonNullable<BackupMonth['archive']> {
    return {
      id: archive.id,
      name: `ICONIC-Mail-${
        this.access.email
          .split('@')[0]!
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 64) || 'mailbox'
      }-${archive.month}.zip`,
      count: archive.count,
      rawBytes: archive.rawBytes,
      zipBytes: archive.zipBytes,
      updatedAt: archive.updatedAt,
    };
  }
  async status(month: string): Promise<BackupMonth> {
    validMonth(month);
    const stats = await this.stats(month),
      archive = await this.access.get<Archive>(`month:${month}`),
      job = await this.access.get<Job>(this.jobKey(month));
    const fresh = archive?.revision === stats.revision;
    return {
      month,
      count: stats.count,
      rawBytes: stats.rawBytes,
      state: job?.error
        ? 'error'
        : job && job.phase !== 'done'
          ? 'packing'
          : fresh
            ? 'ready'
            : archive
              ? 'stale'
              : 'pending',
      ...(job && job.phase !== 'done'
        ? {
            progress: {
              processed:
                job.phase === 'snapshot' ? 0 : job.phase === 'entries' ? job.index : job.count,
              total: job.count,
            },
          }
        : {}),
      ...(archive ? { archive: this.publicArchive(archive) } : {}),
      ...(job?.error ? { error: job.error } : {}),
    };
  }
  async months() {
    const months = await this.access.list('month-stat:');
    return Promise.all(
      months.reverse().map((row) => this.status(row.name.slice('month-stat:'.length))),
    );
  }
  async start(month: string) {
    validMonth(month);
    const existing = await this.access.get<Job>(this.jobKey(month));
    if (existing && existing.phase !== 'done') {
      const active = await this.access.get<Archive>(`month:${month}`);
      const unpublished = active?.id !== existing.id;
      const rebuildCorrupt =
        unpublished &&
        existing.errorCode === 'BACKUP_CORRUPT' &&
        ['verify-chunks', 'verify', 'publish'].includes(existing.phase);
      const rebuildExpired =
        unpublished &&
        existing.errorCode === 'BACKUP_UPLOAD_EXPIRED' &&
        ['entries', 'manifest', 'directory', 'finish'].includes(existing.phase);
      if (!rebuildCorrupt && !rebuildExpired) {
        if (existing.error) {
          delete existing.error;
          delete existing.errorCode;
          await this.access.put(this.jobKey(month), existing);
        }
        return this.status(month);
      }
      // Corrupt or lifecycle-aborted unpublished candidates cannot improve by retrying the
      // same upload. Originals/references remain intact until a replacement is published.
      if (active?.id !== existing.id) {
        const deleteAfter = Date.now() + 24 * 3600000;
        await this.access.put(`retired:${String(deleteAfter).padStart(16, '0')}:${existing.id}`, {
          archive: this.archive(existing),
          deleteAfter,
          index: 0,
          generations: existing.generation,
          parts: existing.parts,
        });
      }
    }
    const current = await this.status(month);
    if (current.state === 'ready') return current;
    if (!current.count)
      throw backupError('BACKUP_NOT_FOUND', 'Tháng này chưa có thư sao lưu.', 404);
    if (!this.access.bucket.createMultipartUpload || !this.access.bucket.resumeMultipartUpload)
      throw backupError('BACKUP_UNAVAILABLE', 'Kho sao lưu chưa hỗ trợ gói ZIP.', 503);
    const stats = await this.stats(month);
    if (stats.count >= 65534)
      throw backupError(
        'BACKUP_LIMIT',
        'Gói ZIP vượt giới hạn số thư. Bản gốc vẫn được giữ nguyên.',
        409,
      );
    const id = crypto.randomUUID();
    const job: Job = {
      id,
      month,
      key: `${this.access.scope}/${month.replace('-', '/')}/${id}.zip.enc`,
      count: stats.count,
      rawBytes: current.rawBytes,
      zipBytes: 0,
      fingerprint: String(stats.revision),
      updatedAt: new Date().toISOString(),
      previous: await this.access.get<Archive>(`month:${month}`),
      revision: stats.revision,
      phase: 'snapshot',
      index: 0,
      offset: 0,
      parts: 0,
      generation: 0,
    };
    await this.access.put(this.jobKey(month), job);
    return this.status(month);
  }
  private async carry(job: Job) {
    if (!job.carry) return new Uint8Array();
    const blob = await this.access.bucket.get(job.carry);
    if (!blob) throw backupError('BACKUP_CORRUPT', 'Không đọc được tiến độ gói ZIP.', 502);
    return open(
      new Uint8Array(await blob.arrayBuffer()),
      this.access.key,
      `${this.access.scope}:carry:${job.carry}`,
    );
  }
  private async append(job: Job, addition: Uint8Array) {
    boundedZip(job.offset + addition.length);
    const carry = await this.carry(job),
      bytes = new Uint8Array(carry.length + addition.length);
    bytes.set(carry);
    bytes.set(addition, carry.length);
    let cursor = 0;
    while (bytes.length - cursor >= ARCHIVE_CHUNK) {
      const part = job.parts + 1;
      const encrypted = await seal(
        bytes.slice(cursor, cursor + ARCHIVE_CHUNK),
        this.access.key,
        this.context(job, part),
      );
      const result = await this.access.bucket.resumeMultipartUpload!(
        job.key,
        job.uploadId!,
      ).uploadPart(part, encrypted);
      await this.access.put(this.partKey(job.id, part), result);
      job.parts = part;
      cursor += ARCHIVE_CHUNK;
    }
    const next = bytes.slice(cursor);
    if (job.carry) this.obsoleteCarries.add(job.carry);
    job.generation++;
    if (next.length) {
      job.carry = `${job.key}.carry-${job.generation}`;
      await this.access.bucket.put(
        job.carry,
        await seal(next, this.access.key, `${this.access.scope}:carry:${job.carry}`),
      );
    } else delete job.carry;
    job.offset += addition.length;
  }
  private async readRange(archive: Archive, offset: number, length: number) {
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > archive.zipBytes
    )
      throw backupError('BACKUP_CORRUPT', 'Vị trí nội dung gói ZIP không hợp lệ.', 502);
    const result = new Uint8Array(length);
    let done = 0;
    while (done < length) {
      const position = offset + done,
        index = Math.floor(position / ARCHIVE_CHUNK),
        start = position % ARCHIVE_CHUNK;
      const clearLength = Math.min(ARCHIVE_CHUNK, archive.zipBytes - index * ARCHIVE_CHUNK);
      let raw =
        this.chunkCache?.id === archive.id && this.chunkCache.index === index
          ? this.chunkCache.bytes
          : undefined;
      if (!raw) {
        const object = await this.access.bucket.get(archive.key, {
          range: { offset: index * (ARCHIVE_CHUNK + OVERHEAD), length: clearLength + OVERHEAD },
        });
        if (!object) throw backupError('BACKUP_CORRUPT', 'Không tìm thấy gói ZIP.', 502);
        const encrypted = new Uint8Array(await object.arrayBuffer());
        if (encrypted.length !== clearLength + OVERHEAD)
          throw backupError('BACKUP_CORRUPT', 'Gói ZIP có kích thước không hợp lệ.', 502);
        raw = await open(encrypted, this.access.key, this.context(archive, index + 1));
        this.chunkCache = { id: archive.id, index, bytes: raw };
      }
      const take = Math.min(length - done, raw.length - start);
      result.set(raw.subarray(start, start + take), done);
      done += take;
    }
    return result;
  }
  private async readEntry(archive: Archive, entry: Entry) {
    const record = entry.record!;
    if (record.size !== entry.item.size || record.method !== 8 || record.packed > 11 * 1024 * 1024)
      throw backupError('BACKUP_CORRUPT', 'Thông tin gói ZIP không hợp lệ.', 502);
    let raw: Uint8Array;
    try {
      raw = new Uint8Array(
        inflateRawSync(await this.readRange(archive, record.dataOffset, record.packed), {
          maxOutputLength: 10 * 1024 * 1024,
        }),
      );
    } catch {
      throw backupError('BACKUP_CORRUPT', 'Không giải nén được nội dung sao lưu.', 502);
    }
    if (raw.length !== entry.item.size || (await digest(raw)) !== entry.item.sha256)
      throw backupError('BACKUP_CORRUPT', 'Bản sao lưu không xác minh được tính toàn vẹn.', 502);
    return raw;
  }
  async archivedContent(item: BackupItem) {
    const reference = await this.access.get<Reference>(`archive-ref:${item.id}`);
    if (!reference) return undefined;
    return this.readEntry(reference.archive, { item, record: reference.record });
  }
  async step(month: string) {
    validMonth(month);
    let job = await this.access.get<Job>(this.jobKey(month));
    if (!job || job.phase === 'done' || job.errorCode === 'BACKUP_UPLOAD_EXPIRED')
      return this.start(month);
    const previousCarry = job.carry;
    delete job.error;
    delete job.errorCode;
    try {
      if (!job.uploadId && job.phase !== 'snapshot') {
        job.uploadId = (await this.access.bucket.createMultipartUpload!(job.key)).uploadId;
        await this.access.put(this.jobKey(month), job);
      }
      if (job.phase === 'snapshot') {
        const stats = await this.stats(month);
        if (stats.count >= 65534)
          throw backupError(
            'BACKUP_LIMIT',
            'Gói ZIP vượt giới hạn số thư. Bản gốc vẫn được giữ nguyên.',
            409,
          );
        if (job.revision !== stats.revision) {
          job.fingerprint = String(stats.revision);
          job.index = 0;
          delete job.cursor;
          job.count = stats.count;
          job.rawBytes = stats.rawBytes;
          job.revision = stats.revision;
        }
        const entries = await this.access.list<BackupItem>(`month-item:${month}:`, job.cursor, 32);
        for (const row of entries) {
          await this.access.put(this.entryKey(job.id, job.index), { item: row.value });
          job.index++;
          job.cursor = row.name;
        }
        if (job.index === job.count) {
          job.phase = 'entries';
          job.index = 0;
          delete job.cursor;
        }
      } else if (job.phase === 'entries') {
        let processed = 0,
          rawBytes = 0,
          pendingBytes = 0;
        const fragments: Uint8Array[] = [];
        while (job.index < job.count && processed < 8 && rawBytes < 2 * 1024 * 1024) {
          const entry = (await this.access.get<Entry>(this.entryKey(job.id, job.index)))!;
          const { raw } = await this.access.content(entry.item.id);
          const encoded = zipEntry(
            archivePath(entry.item.folder, entry.item.id),
            raw,
            job.offset + pendingBytes,
          );
          fragments.push(encoded.bytes);
          pendingBytes += encoded.bytes.length;
          entry.record = encoded.record;
          await this.access.put(this.entryKey(job.id, job.index), entry);
          job.index++;
          processed++;
          rawBytes += raw.length;
        }
        const combined = new Uint8Array(pendingBytes);
        let position = 0;
        for (const bytes of fragments) {
          combined.set(bytes, position);
          position += bytes.length;
        }
        await this.append(job, combined);
        if (job.index === job.count) {
          job.phase = 'manifest';
          job.index = 0;
          job.manifest = {
            path: 'manifest.json',
            offset: job.offset,
            dataOffset: job.offset + 43,
            size: 0,
            packed: 0,
            crc: 0,
            method: 0,
            descriptor: true,
          };
          await this.append(job, zipHeader(job.manifest));
          const prefix = encoder.encode(
            `{"version":1,"mailbox":${JSON.stringify(this.access.email)},"scope":"${this.access.scope}","month":"${month}","messages":[`,
          );
          await this.appendManifest(job, prefix);
        }
      } else if (job.phase === 'manifest') {
        const fragments: string[] = [];
        const end = Math.min(job.index + 32, job.count);
        for (; job.index < end; job.index++) {
          const entry = (await this.access.get<Entry>(this.entryKey(job.id, job.index)))!;
          fragments.push(
            (job.index ? ',' : '') + JSON.stringify({ ...entry.item, path: entry.record!.path }),
          );
        }
        await this.appendManifest(job, encoder.encode(fragments.join('')));
        if (job.index === job.count) {
          await this.appendManifest(job, encoder.encode(']}'));
          await this.append(job, zipDescriptor(job.manifest!));
          job.phase = 'directory';
          job.index = 0;
          job.directoryOffset = job.offset;
        }
      } else if (job.phase === 'directory') {
        const directories: Uint8Array[] = [];
        const end = Math.min(job.index + 32, job.count);
        for (; job.index < end; job.index++) {
          const entry = (await this.access.get<Entry>(this.entryKey(job.id, job.index)))!;
          directories.push(zipDirectory(entry.record!));
        }
        const combined = new Uint8Array(directories.reduce((sum, bytes) => sum + bytes.length, 0));
        let position = 0;
        for (const bytes of directories) {
          combined.set(bytes, position);
          position += bytes.length;
        }
        await this.append(job, combined);
        if (job.index === job.count) {
          await this.append(job, zipDirectory(job.manifest!));
          await this.append(
            job,
            zipEnd(job.count + 1, job.offset - job.directoryOffset!, job.directoryOffset!),
          );
          const remaining = await this.carry(job);
          if (remaining.length) {
            const part = job.parts + 1;
            const result = await this.access.bucket.resumeMultipartUpload!(
              job.key,
              job.uploadId!,
            ).uploadPart(part, await seal(remaining, this.access.key, this.context(job, part)));
            await this.access.put(this.partKey(job.id, part), result);
            job.parts = part;
          }
          job.zipBytes = job.offset;
          job.phase = 'finish';
          job.index = 0;
        }
      } else if (job.phase === 'finish') {
        // Completion may have succeeded before a lost response. The immutable key is unique to this job.
        if (!(await this.access.bucket.get(job.key, { range: { offset: 0, length: 1 } }))) {
          const parts = [];
          for (let i = 1; i <= job.parts; i++)
            parts.push(
              (await this.access.get<{ partNumber: number; etag: string }>(
                this.partKey(job.id, i),
              ))!,
            );
          await this.access.bucket.resumeMultipartUpload!(job.key, job.uploadId!).complete(parts);
        }
        job.phase = 'verify-chunks';
        job.index = 0;
      } else if (job.phase === 'verify-chunks') {
        const offset = job.index * ARCHIVE_CHUNK;
        await this.readRange(job, offset, Math.min(ARCHIVE_CHUNK, job.zipBytes - offset));
        job.index++;
        if (job.index === Math.ceil(job.zipBytes / ARCHIVE_CHUNK)) {
          job.phase = 'verify';
          job.index = 0;
        }
      } else if (job.phase === 'verify') {
        let processed = 0,
          rawBytes = 0;
        while (job.index < job.count && processed < 8 && rawBytes < 2 * 1024 * 1024) {
          const entry = (await this.access.get<Entry>(this.entryKey(job.id, job.index)))!;
          await this.readEntry(job, entry);
          job.index++;
          processed++;
          rawBytes += entry.item.size;
        }
        if (job.index === job.count) {
          job.phase = 'publish';
          job.index = 0;
        }
      } else if (job.phase === 'publish') {
        // Verify the final authenticated chunk (directory and EOCD) too before switching the active pointer.
        await this.readRange(
          job,
          Math.max(0, job.zipBytes - ARCHIVE_CHUNK),
          Math.min(ARCHIVE_CHUNK, job.zipBytes),
        );
        await this.access.put(`month:${month}`, this.archive(job));
        job.phase = 'cleanup';
        job.index = 0;
      } else if (job.phase === 'cleanup') {
        const end = Math.min(job.index + 32, job.count);
        for (; job.index < end; job.index++) {
          const entry = (await this.access.get<Entry>(this.entryKey(job.id, job.index)))!;
          // Reference publication precedes deletion. Both are idempotent after a lost reply.
          await this.access.put(`archive-ref:${entry.item.id}`, {
            archive: this.archive(job),
            record: entry.record,
          });
          await this.access.bucket.delete?.(`${this.access.scope}/${entry.item.id}`);
        }
        if (job.index === job.count) {
          if (job.previous) {
            job.retiredAt ??= Date.now();
            const deleteAfter = job.retiredAt + 24 * 3600000;
            await this.access.put(
              `retired:${String(deleteAfter).padStart(16, '0')}:${job.previous.id}`,
              { archive: job.previous, deleteAfter, index: 0 },
            );
          }
          job.phase = 'tidy';
          job.index = 1;
        }
      } else if (job.phase === 'tidy') {
        // Sweep deterministic carry names, including abandoned writes from interrupted steps.
        const end = Math.min(job.index + 32, job.generation + 1);
        for (; job.index < end; job.index++)
          await this.access.bucket.delete?.(`${job.key}.carry-${job.index}`);
        if (job.index > job.generation) job.phase = 'done';
      }
      await this.access.put(this.jobKey(month), job);
      if (previousCarry) this.obsoleteCarries.add(previousCarry);
      for (const name of this.obsoleteCarries)
        if (name !== job.carry) await this.access.bucket.delete?.(name);
      this.obsoleteCarries.clear();
      if (job.phase === 'done' && job.carry) await this.access.bucket.delete?.(job.carry);
    } catch (error) {
      // Reload the durable checkpoint: mutated local cursors must never be saved after a failed operation.
      job = (await this.access.get<Job>(this.jobKey(month)))!;
      // Native R2 reports lifecycle-aborted uploads as error 10024 (no code property).
      // Match only this definite absence; transient/lost replies retain their checkpoint.
      const expired =
        error instanceof Error && /multipart upload does not exist.*\(10024\)/i.test(error.message);
      job.errorCode = expired
        ? 'BACKUP_UPLOAD_EXPIRED'
        : error instanceof Error && 'code' in error
          ? String(error.code)
          : undefined;
      job.error = expired
        ? 'Phiên tải gói ZIP đã hết hạn. Tiếp tục để tạo lại từ bản gốc được giữ an toàn.'
        : error instanceof Error && 'code' in error && error.code === 'BACKUP_LIMIT'
          ? error.message
          : 'Không tạo hoặc xác minh được gói ZIP. Bản gốc vẫn được giữ để thử lại.';
      await this.access.put(this.jobKey(month), job);
    }
    return this.status(month);
  }
  private archive(job: Job): Archive {
    return {
      id: job.id,
      month: job.month,
      key: job.key,
      count: job.count,
      rawBytes: job.rawBytes,
      zipBytes: job.zipBytes,
      fingerprint: job.fingerprint,
      updatedAt: job.updatedAt,
      revision: job.revision,
    };
  }
  private async appendManifest(job: Job, bytes: Uint8Array) {
    await this.append(job, bytes);
    const manifest = job.manifest!;
    manifest.crc = crc32(bytes, manifest.crc);
    manifest.size += bytes.length;
    manifest.packed += bytes.length;
  }
  async maintain() {
    const rows = await this.access.list<{
      archive: Archive;
      deleteAfter: number;
      index: number;
      generations?: number;
      parts?: number;
    }>('retired:', undefined, 1);
    for (const { name, value } of rows) {
      if (Date.now() < value.deleteAfter) {
        return;
      }
      const active = await this.access.get<Archive>(`month:${value.archive.month}`);
      const job = await this.access.get<Job>(this.jobKey(value.archive.month));
      if (
        active?.id === value.archive.id ||
        (job?.phase !== 'done' && job?.id === value.archive.id)
      )
        return;
      // This ledger exists only after every item reference switched. Grace protects in-flight streams.
      await this.access.bucket.delete?.(value.archive.key);
      const parts = value.parts ?? Math.ceil(value.archive.zipBytes / ARCHIVE_CHUNK);
      const total = value.archive.count + parts + (value.generations ?? 0);
      const end = Math.min(value.index + 32, total);
      for (; value.index < end; value.index++) {
        if (value.index < value.archive.count)
          await this.access.remove(this.entryKey(value.archive.id, value.index));
        else if (value.index < value.archive.count + parts)
          await this.access.remove(
            this.partKey(value.archive.id, value.index - value.archive.count + 1),
          );
        else
          await this.access.bucket.delete?.(
            `${value.archive.key}.carry-${value.index - value.archive.count - parts + 1}`,
          );
      }
      if (value.index === total) await this.access.remove(name);
      else await this.access.put(name, value);
    }
  }
  async describe(month: string) {
    validMonth(month);
    const archive = await this.access.get<Archive>(`month:${month}`);
    if (!archive)
      throw backupError('BACKUP_NOT_FOUND', 'Chưa có gói ZIP hoàn tất cho tháng này.', 404);
    if (!this.access.bucket.head)
      throw backupError('BACKUP_UNAVAILABLE', 'Kho sao lưu chưa hỗ trợ kiểm tra gói ZIP.', 503);
    const object = await this.access.bucket.head(archive.key);
    if (
      !object ||
      object.size !== archive.zipBytes + Math.ceil(archive.zipBytes / ARCHIVE_CHUNK) * OVERHEAD
    )
      throw backupError('BACKUP_CORRUPT', 'Không đọc được gói ZIP đã công bố.', 502);
    return {
      name: this.publicArchive(archive).name,
      type: 'application/zip',
      size: archive.zipBytes,
    };
  }
  async download(month: string) {
    validMonth(month);
    const archive = await this.access.get<Archive>(`month:${month}`);
    if (!archive)
      throw backupError('BACKUP_NOT_FOUND', 'Chưa có gói ZIP hoàn tất cho tháng này.', 404);
    let offset = 0;
    let first: Uint8Array<ArrayBuffer> | undefined = await this.readRange(
      archive,
      0,
      Math.min(ARCHIVE_CHUNK, archive.zipBytes),
    );
    const read = (start: number, length: number) => this.readRange(archive, start, length);
    const body = new ReadableStream<Uint8Array>({
      type: 'bytes',
      async pull(controller) {
        try {
          if (offset === archive.zipBytes) {
            controller.close();
            return;
          }
          const bytes =
            first ?? (await read(offset, Math.min(ARCHIVE_CHUNK, archive.zipBytes - offset)));
          first = undefined;
          offset += bytes.length;
          controller.enqueue(bytes);
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return {
      body,
      name: this.publicArchive(archive).name,
      type: 'application/zip',
      size: archive.zipBytes,
    };
  }
}
