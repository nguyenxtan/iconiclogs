import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from 'imapflow';
import type { ParsedMail } from 'mailparser';
import type {
  Folder,
  MessagePage,
  MessageSummary,
  MailMessage,
  SendDraft,
} from '../../shared/contracts';
import type { MailProvider } from '../core/provider';
import type { Credentials } from '../core/session';
import type { ProviderConfig } from '../config';
import { MailError } from '../core/errors';
import { MAX_MIME, messageKey } from '../core/validation';
import { composeMessage, ensureMimeSize, messageBody, parseMessage } from './mime';
import { deliverMessage } from './smtp';
import { attachmentParts, type AttachmentPart } from './parts';

const address = (value?: MessageAddressObject) => ({
  name: value?.name || '',
  address: value?.address || '',
});
function summary(row: FetchMessageObject, validity: string): MessageSummary {
  const date = new Date(row.internalDate || row.envelope?.date || 0);
  return {
    id: `${validity}.${row.uid}`,
    from: address(row.envelope?.from?.[0]),
    to: (row.envelope?.to || []).map(address),
    subject: row.envelope?.subject || '(Không có tiêu đề)',
    date: Number.isFinite(date.getTime()) ? date.toISOString() : '',
    unread: !row.flags?.has('\\Seen'),
    hasAttachments: hasAttachment(row.bodyStructure),
  };
}
function hasAttachment(node: FetchMessageObject['bodyStructure']): boolean {
  return (
    !!node &&
    (node.disposition?.toLowerCase() === 'attachment' ||
      !!node.dispositionParameters?.filename ||
      (node.childNodes || []).some(hasAttachment))
  );
}

export class ViettelProvider implements MailProvider {
  constructor(
    private credentials: Credentials,
    private config: ProviderConfig,
  ) {}

  async connection<T>(operation: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: this.config.host,
      port: 993,
      secure: true,
      auth: { user: this.credentials.email, pass: this.credentials.password },
      logger: false,
      emitLogs: false,
      disableAutoIdle: true,
      doSTARTTLS: false,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: this.config.host },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      maxLiteralSize: MAX_MIME,
      maxIdleTime: 0,
    });
    // A hard deadline closes the socket, rather than merely abandoning the Promise.
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        client.close();
        reject(
          new MailError(
            'PROVIDER_TIMEOUT',
            504,
            'Kết nối mail quá thời gian. Vui lòng thử lại sau.',
          ),
        );
      }, 25000);
    });
    try {
      return await Promise.race([
        (async () => {
          await client.connect();
          return operation(client);
        })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer!);
      // No long-lived sockets or background provider work across Worker requests.
      client.close();
    }
  }

  async authenticate() {
    await this.connection(async () => undefined);
  }

  async folderPath(client: ImapFlow, folder: Folder): Promise<string> {
    if (folder === 'inbox') return 'INBOX';
    const boxes = (await client.list()).filter((box) => !box.flags.has('\\Noselect'));
    const matches = boxes.filter((box) =>
      this.config.sentFolder ? box.path === this.config.sentFolder : box.specialUse === '\\Sent',
    );
    if (matches.length !== 1)
      throw new MailError(
        'SENT_FOLDER',
        409,
        'Chưa xác định được thư mục Đã gửi. Liên hệ người quản trị.',
      );
    return matches[0]!.path;
  }

  async list(folder: Folder, page: number): Promise<MessagePage> {
    return this.connection(async (client) => {
      const path = await this.folderPath(client, folder);
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        if (!client.mailbox) throw new MailError('MAILBOX', 502, 'Không mở được hộp thư.');
        const total = client.mailbox.exists,
          end = total - (page - 1) * 25;
        if (end <= 0) return { messages: [], nextPage: null, total };
        const start = Math.max(1, end - 24);
        const rows = await client.fetchAll(`${start}:${end}`, {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          bodyStructure: true,
        });
        return {
          messages: rows
            .reverse()
            .map((row) => summary(row, String(client.mailbox && client.mailbox.uidValidity))),
          nextPage: start > 1 ? page + 1 : null,
          total,
        };
      } finally {
        lock.release();
      }
    });
  }

  private async source(
    folder: Folder,
    id: string,
    markSeen: boolean,
  ): Promise<{ parsed: ParsedMail; item: MessageSummary; parts: AttachmentPart[] }> {
    const key = messageKey(id);
    return this.connection(async (client) => {
      const lock = await client.getMailboxLock(await this.folderPath(client, folder), {
        readOnly: !markSeen,
      });
      try {
        if (!client.mailbox || String(client.mailbox.uidValidity) !== key.validity)
          throw new MailError(
            'MAILBOX_CHANGED',
            409,
            'Hộp thư đã thay đổi. Vui lòng tải lại danh sách.',
          );
        const row = await client.fetchOne(
          String(key.uid),
          {
            uid: true,
            envelope: true,
            flags: true,
            internalDate: true,
            size: true,
            bodyStructure: true,
          },
          { uid: true },
        );
        if (!row) throw new MailError('NOT_FOUND', 404, 'Không tìm thấy thư.');
        ensureMimeSize(row.size || 0);
        const { meta, content } = await client.download(String(key.uid), undefined, {
          uid: true,
          maxBytes: MAX_MIME + 1,
        });
        if (!content || !meta)
          throw new MailError('NOT_FOUND', 404, 'Không đọc được nội dung thư.');
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          ensureMimeSize(meta.expectedSize || 0);
          for await (const chunk of content) {
            size += chunk.length;
            ensureMimeSize(size);
            chunks.push(Buffer.from(chunk));
          }
        } finally {
          content.destroy();
        }
        const parsed = await parseMessage(Buffer.concat(chunks));
        if (markSeen) await client.messageFlagsAdd(String(key.uid), ['\\Seen'], { uid: true });
        return {
          parsed,
          parts: attachmentParts(row.bodyStructure),
          item: {
            ...summary(row, key.validity),
            unread: markSeen ? false : !row.flags?.has('\\Seen'),
          },
        };
      } finally {
        lock.release();
      }
    });
  }

  async read(folder: Folder, id: string): Promise<MailMessage> {
    const { item, parsed, parts } = await this.source(folder, id, true);
    return {
      ...item,
      ...messageBody(parsed),
      attachments: parts.map(({ part: _part, ...file }) => file),
    };
  }

  async attachment(folder: Folder, id: string, attachmentId: number) {
    const key = messageKey(id);
    return this.connection(async (client) => {
      const lock = await client.getMailboxLock(await this.folderPath(client, folder), {
        readOnly: true,
      });
      try {
        if (!client.mailbox || String(client.mailbox.uidValidity) !== key.validity)
          throw new MailError(
            'MAILBOX_CHANGED',
            409,
            'Hộp thư đã thay đổi. Vui lòng tải lại danh sách.',
          );
        const row = await client.fetchOne(String(key.uid), { bodyStructure: true }, { uid: true });
        const file = row && attachmentParts(row.bodyStructure)[attachmentId];
        if (!file) throw new MailError('NOT_FOUND', 404, 'Không tìm thấy file.');
        ensureMimeSize(file.size);
        const { meta, content } = await client.download(String(key.uid), file.part, {
          uid: true,
          maxBytes: MAX_MIME + 1,
        });
        if (!content || !meta) throw new MailError('NOT_FOUND', 404, 'Không tải được file.');
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          ensureMimeSize(meta.expectedSize || 0);
          for await (const chunk of content) {
            size += chunk.length;
            ensureMimeSize(size);
            chunks.push(Buffer.from(chunk));
          }
        } finally {
          content.destroy();
        }
        return { content: new Uint8Array(Buffer.concat(chunks)), name: file.name, type: file.type };
      } finally {
        lock.release();
      }
    });
  }

  async prepareSend(draft: SendDraft, messageId: string, cachedPath?: string) {
    const raw = await composeMessage(this.credentials.email, draft, messageId);
    const path =
      this.config.sentMode === 'append'
        ? (cachedPath ?? (await this.connection((client) => this.folderPath(client, 'sent'))))
        : undefined;
    const append = path
      ? async (mime: Buffer) => {
          await this.connection(async (client) => {
            if (!(await client.append(path, mime, ['\\Seen']))) throw Error('append rejected');
          });
        }
      : undefined;
    return {
      sentPath: path,
      deliver: () => deliverMessage(this.credentials, this.config, draft, messageId, append, raw),
    };
  }

  async send(draft: SendDraft, messageId: string) {
    return (await this.prepareSend(draft, messageId)).deliver();
  }
}
