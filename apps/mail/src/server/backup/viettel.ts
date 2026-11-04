import { ViettelProvider } from '../providers/viettel';
import type { Credentials } from '../core/session';
import type { ProviderConfig } from '../config';
import { folderInput, MAX_MIME } from '../core/validation';
import type { BackupFolder, BackupSource, CaptureMessage, KnownMessage } from './service';
import { backupError } from './crypto';
import { DefiniteRestoreFailure } from './restore';

/** Raw IMAP adapter. No parsing/re-serialization of MIME or attachment bodies. */
export class ViettelBackupSource implements BackupSource {
  private provider: ViettelProvider;
  constructor(credentials: Credentials, config: ProviderConfig) {
    this.provider = new ViettelProvider(credentials, config);
  }
  snapshot() {
    return this.provider.connection(async (client) => {
      const boxes = (await client.list()).filter((box) => !box.flags.has('\\Noselect'));
      if (boxes.length > 100)
        throw backupError(
          'BACKUP_FOLDERS',
          'Hộp thư có quá nhiều thư mục để sao lưu trong một lượt.',
        );
      // Snapshot each folder on its first bounded step, rather than opening all folders here.
      return boxes.map((box) => ({ path: box.path, uidValidity: '', upperUid: -1 }));
    });
  }
  batch(folder: BackupFolder, cursor: number, known?: KnownMessage) {
    return this.provider.connection(async (client) => {
      const lock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        if (!client.mailbox) throw Error('mailbox unavailable');
        if (!folder.uidValidity) {
          folder.uidValidity = String(client.mailbox.uidValidity);
          folder.upperUid = client.mailbox.uidNext - 1;
        }
        if (String(client.mailbox.uidValidity) !== folder.uidValidity)
          throw backupError(
            'BACKUP_MAILBOX_CHANGED',
            'UIDVALIDITY của thư mục đã thay đổi. Hãy bắt đầu lượt sao lưu mới.',
          );
        if (cursor >= folder.upperUid) return { cursor: folder.upperUid, messages: [] };
        // A fixed UID window bounds metadata and one MIME bounds bytes per request.
        const end = Math.min(folder.upperUid, cursor + 50);
        const rows = await client.fetchAll(
          `${cursor + 1}:${end}`,
          { uid: true, flags: true, internalDate: true, size: true, envelope: true },
          { uid: true },
        );
        const messages: CaptureMessage[] = [];
        let bytes = 0,
          lastUid = cursor;
        for (const row of rows.sort((a, b) => a.uid - b.uid)) {
          if (messages.length >= 5) break;
          const archiveId = await known?.(folder, row.uid);
          // Only one large body is allowed; cached messages need no provider body download.
          if (
            !archiveId &&
            messages.length &&
            bytes + (row.size || MAX_MIME) > 2 * 1024 * 1024 &&
            (row.size || 0) <= MAX_MIME
          )
            break;
          const date = row.internalDate ? new Date(row.internalDate) : null;
          if (!date || !Number.isFinite(date.getTime())) throw Error('missing internal date');
          const message: CaptureMessage = {
            uid: row.uid,
            flags: [...(row.flags ?? [])],
            internalDate: date.toISOString(),
            raw: new Uint8Array(),
            subject: row.envelope?.subject,
            from: row.envelope?.from
              ?.map((from) => from.address || '')
              .filter(Boolean)
              .join(', '),
          };
          if (archiveId) {
            message.archiveId = archiveId;
            delete message.raw;
          } else if ((row.size ?? 0) > MAX_MIME) message.oversized = true;
          else {
            const { meta, content } = await client.download(String(row.uid), undefined, {
              uid: true,
              maxBytes: MAX_MIME + 1,
            });
            if (!meta || !content) throw Error('message disappeared');
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
              if ((meta.expectedSize ?? 0) > MAX_MIME) message.oversized = true;
              if (!message.oversized)
                for await (const chunk of content) {
                  size += chunk.length;
                  if (size > MAX_MIME) {
                    message.oversized = true;
                    break;
                  }
                  chunks.push(new Uint8Array(chunk));
                }
            } finally {
              content.destroy();
            }
            if (!message.oversized) {
              // A capped download must never silently become a successful truncated backup.
              if (row.size && size !== row.size) throw Error('incomplete message');
              message.raw = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) {
                message.raw.set(chunk, offset);
                offset += chunk.length;
              }
            }
          }
          messages.push(message);
          lastUid = row.uid;
          bytes += message.raw?.byteLength ?? 0;
          if (bytes >= 2 * 1024 * 1024) break;
        }
        return { cursor: messages.length ? lastUid : end, messages };
      } finally {
        lock.release();
      }
    });
  }
  async append(folder: string, raw: Uint8Array, flags: string[], date: string) {
    let invoked = false,
      cancelled = false;
    try {
      return await this.provider.connection(async (client) => {
        const input =
          ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'].includes(folder) ||
          folder.startsWith('folder:')
            ? folderInput(folder)
            : folderInput('folder:' + encodeURIComponent(folder));
        const path = await this.provider.folderPath(client, input);
        const boxes = await client.list();
        if (!boxes.some((box) => box.path === path && !box.flags.has('\\Noselect')))
          throw Error('target folder unavailable');
        const internalDate = new Date(date);
        if (!Number.isFinite(internalDate.getTime())) throw Error('invalid internal date');
        // A raced connection deadline must prevent a late preflight continuation from appending.
        if (cancelled) throw new DefiniteRestoreFailure();
        invoked = true;
        const result = await client.append(
          path,
          Buffer.from(raw),
          flags.filter(
            (flag) => !['\\recent', '\\deleted', '\\draft'].includes(flag.toLowerCase()),
          ),
          internalDate,
        );
        return !!result;
      });
    } catch (error) {
      cancelled = true;
      if (!invoked) throw new DefiniteRestoreFailure();
      throw error;
    }
  }
}
