import {
  ImapFlow,
  type FetchMessageObject,
  type ListResponse,
  type SearchObject,
  type MessageAddressObject,
} from 'imapflow';
import type { ParsedMail } from 'mailparser';
import type {
  Folder,
  MailFolder,
  MailQuota,
  MessageAction,
  MessageFilter,
  MessagePage,
  MessageSummary,
  MailMessage,
  SendDraft,
} from '../../shared/contracts';
import type { MailProvider } from '../core/provider';
import type { Credentials } from '../core/session';
import type { ProviderConfig } from '../config';
import { MailError, isAuthError, invalid, loginFailure } from '../core/errors';
import {
  MAX_MIME,
  actionInput,
  filterInput,
  folderInput,
  folderName,
  messageKey,
} from '../core/validation';
import { composeMessage, ensureMimeSize, messageBody, parseMessage } from './mime';
import { deliverMessage } from './smtp';
import { attachmentParts, decodedAttachmentParts, type AttachmentPart } from './parts';

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
    starred: !!row.flags?.has('\\Flagged'),
    hasAttachments: hasAttachment(row.bodyStructure),
  };
}
function hasAttachment(node: FetchMessageObject['bodyStructure']): boolean {
  return (
    !!node &&
    (node.disposition?.toLowerCase() === 'attachment' ||
      !!node.dispositionParameters?.filename ||
      !!node.parameters?.name ||
      (!!node.type &&
        !node.type.toLowerCase().startsWith('multipart/') &&
        !['text/plain', 'text/html'].includes(node.type.toLowerCase())) ||
      (node.childNodes || []).some(hasAttachment))
  );
}

export class ViettelProvider implements MailProvider {
  constructor(
    private credentials: Credentials,
    private config: ProviderConfig,
  ) {}

  async connection<T>(operation: (client: ImapFlow) => Promise<T>): Promise<T> {
    const startedAt = Date.now();
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
    let authenticated = false;
    const captureAuthentication = () => {
      authenticated ||= !!client.authenticated;
    };
    client.on('response', captureAuthentication);
    // Socket errors can arrive outside the command Promise, including while closing.
    const connectionError = new Promise<never>((_, reject) =>
      client.on('error', (error) => {
        captureAuthentication();
        reject(error);
      }),
    );
    // A hard deadline closes the socket, rather than merely abandoning the Promise.
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        captureAuthentication();
        reject(
          new MailError(
            'PROVIDER_TIMEOUT',
            504,
            'Kết nối mail quá thời gian. Vui lòng thử lại sau.',
          ),
        );
        client.close();
      }, 25000);
    });
    try {
      return await Promise.race([
        (async () => {
          await client.connect();
          return operation(client);
        })(),
        timeout,
        connectionError,
      ]);
    } catch (error) {
      console.warn('mail-imap-error', {
        code: loginFailure(error).code,
        authenticated: authenticated || !!client.authenticated,
        usable: client.usable === true,
        elapsedMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      clearTimeout(timer!);
      // No long-lived sockets or background provider work across Worker requests.
      client.close();
    }
  }

  async authenticate() {
    await this.connection(async () => undefined);
  }

  private role(box: ListResponse): MailFolder['role'] {
    if (box.path.toUpperCase() === 'INBOX') return 'inbox';
    if (this.config.sentFolder && box.path === this.config.sentFolder) return 'sent';
    const roles = {
      '\\Sent': 'sent',
      '\\Drafts': 'drafts',
      '\\Trash': 'trash',
      '\\Junk': 'junk',
      '\\Archive': 'archive',
    } as const;
    if (box.specialUse === '\\Sent' && this.config.sentFolder) return undefined;
    return roles[box.specialUse as keyof typeof roles];
  }

  private selectable(boxes: ListResponse[]) {
    return boxes.filter((box) => !box.flags.has('\\Noselect'));
  }

  async folderPath(client: ImapFlow, input: Folder, createForMove = false): Promise<string> {
    const folder = folderInput(input);
    if (folder === 'inbox') return 'INBOX';
    const boxes = this.selectable(await client.list());
    if (folder.startsWith('folder:')) {
      const path = decodeURIComponent(folder.slice(7));
      if (boxes.some((box) => box.path === path)) return path;
      throw new MailError(
        'FOLDER_NOT_FOUND',
        404,
        'Không tìm thấy thư mục. Vui lòng tải lại danh sách.',
      );
    }
    const matches = boxes.filter((box) => this.role(box) === folder);
    if (matches.length === 1) return matches[0]!.path;
    if (!matches.length && createForMove && (folder === 'trash' || folder === 'archive')) {
      const name = folder === 'trash' ? 'Trash' : 'Archive';
      // A conventional folder is reusable even if this server does not advertise SPECIAL-USE.
      const existing = boxes.find((box) => box.path.toLowerCase() === name.toLowerCase());
      if (existing) return existing.path;
      const created = await client.mailboxCreate(name);
      if (!created?.path)
        throw new MailError(
          'FOLDER_CREATE_FAILED',
          502,
          'Chưa xác nhận được việc tạo thư mục. Vui lòng tải lại danh sách.',
        );
      return created.path;
    }
    throw new MailError(
      folder === 'sent' ? 'SENT_FOLDER' : 'FOLDER_NOT_FOUND',
      409,
      'Chưa xác định được thư mục này. Vui lòng tải lại danh sách hoặc liên hệ người quản trị.',
    );
  }

  async folders(): Promise<MailFolder[]> {
    return this.connection(async (client) => {
      const boxes = this.selectable(
        await client.list({ statusQuery: { messages: true, unseen: true } }),
      );
      return boxes.map((box) => {
        const role = this.role(box);
        // Ambiguous roles remain addressable by their exact path.
        const unique = role && boxes.filter((other) => this.role(other) === role).length === 1;
        return {
          id: unique ? role : (`folder:${encodeURIComponent(box.path)}` as Folder),
          name: box.name || box.path,
          ...(unique ? { role } : {}),
          ...(typeof box.status?.unseen === 'number' ? { unread: box.status.unseen } : {}),
          ...(typeof box.status?.messages === 'number' ? { total: box.status.messages } : {}),
        };
      });
    });
  }

  async createFolder(input: string): Promise<void> {
    const name = folderName(input).trim();
    await this.connection(async (client) => {
      if (!(await client.mailboxCreate(name)))
        throw new MailError(
          'FOLDER_CREATE_FAILED',
          502,
          'Chưa xác nhận được việc tạo thư mục. Vui lòng tải lại danh sách.',
        );
    });
  }

  async list(folder: Folder, page: number, input: MessageFilter = {}): Promise<MessagePage> {
    const filter = filterInput(input);
    if (!Number.isSafeInteger(page) || page < 1) throw invalid();
    return this.connection(async (client) => {
      const path = await this.folderPath(client, folder);
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        if (!client.mailbox) throw new MailError('MAILBOX', 502, 'Không mở được hộp thư.');
        const validity = String(client.mailbox.uidValidity);
        const fields = {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          bodyStructure: true,
        };
        if (!Object.keys(filter).length) {
          const total = client.mailbox.exists,
            end = total - (page - 1) * 25;
          if (end <= 0) return { messages: [], nextPage: null, total };
          const start = Math.max(1, end - 24);
          const rows = await client.fetchAll(`${start}:${end}`, fields);
          return {
            messages: rows.reverse().map((row) => summary(row, validity)),
            nextPage: start > 1 ? page + 1 : null,
            total,
          };
        }
        const query: SearchObject = {};
        if (filter.query) query.text = filter.query;
        if (filter.from) query.from = filter.from;
        if (filter.unread !== undefined) query.seen = !filter.unread;
        if (filter.starred !== undefined) query.flagged = filter.starred;
        if (filter.after) query.since = new Date(filter.after);
        if (filter.before) query.before = new Date(filter.before);
        if (!Object.keys(query).length) query.all = true;
        const result = await client.search(query, { uid: true });
        if (!Array.isArray(result))
          throw new MailError('SEARCH_FAILED', 502, 'Không thể tìm kiếm thư. Vui lòng thử lại.');
        let uids = result.sort((a, b) => b - a);
        if (filter.attachments !== undefined) {
          if (uids.length > 5000)
            throw new MailError(
              'FILTER_TOO_BROAD',
              422,
              'Bộ lọc file đính kèm tối đa 5.000 thư. Hãy thu hẹp theo người gửi hoặc ngày.',
            );
          const matching = new Set<number>();
          for (let offset = 0; offset < uids.length; offset += 100) {
            const rows = await client.fetchAll(
              uids.slice(offset, offset + 100).join(','),
              { uid: true, bodyStructure: true },
              { uid: true },
            );
            for (const row of rows)
              if (hasAttachment(row.bodyStructure) === filter.attachments) matching.add(row.uid);
          }
          uids = uids.filter((uid) => matching.has(uid));
        }
        const total = uids.length,
          start = (page - 1) * 25,
          selected = uids.slice(start, start + 25);
        if (!selected.length) return { messages: [], nextPage: null, total };
        const rows = await client.fetchAll(selected.join(','), fields, { uid: true });
        return {
          messages: rows.sort((a, b) => b.uid - a.uid).map((row) => summary(row, validity)),
          total,
          nextPage: start + 25 < total ? page + 1 : null,
        };
      } finally {
        lock.release();
      }
    });
  }

  async action(folder: Folder, input: MessageAction): Promise<void> {
    const action = actionInput(input),
      keys = action.ids.map(messageKey);
    let writeStarted = false;
    try {
      await this.connection(async (client) => {
        const path = await this.folderPath(client, folder);
        const lock = await client.getMailboxLock(path);
        try {
          if (!client.mailbox || String(client.mailbox.uidValidity) !== keys[0]!.validity)
            throw new MailError(
              'MAILBOX_CHANGED',
              409,
              'Hộp thư đã thay đổi. Vui lòng tải lại danh sách.',
            );
          const range = keys.map((key) => key.uid).join(',');
          const rows = await client.fetchAll(range, { uid: true }, { uid: true });
          if (
            rows.length !== keys.length ||
            keys.some((key) => !rows.some((row) => row.uid === key.uid))
          )
            throw new MailError(
              'NOT_FOUND',
              404,
              'Một số thư không còn tồn tại. Vui lòng tải lại danh sách.',
            );
          if (action.action === 'move') {
            if (
              !client.capabilities.has('MOVE') &&
              !client.enabled?.has('IMAP4REV2') &&
              !(client.capabilities.has('IMAP4rev2') && !client.capabilities.has('IMAP4rev1'))
            )
              throw new MailError(
                'MOVE_UNSUPPORTED',
                409,
                'Máy chủ chưa hỗ trợ di chuyển thư an toàn. Liên hệ người quản trị.',
              );
            const destination = await this.folderPath(client, action.destination!, true);
            if (destination === path) return;
            writeStarted = true;
            if (!(await client.messageMove(range, destination, { uid: true })))
              throw Error('move unconfirmed');
          } else {
            const flag =
              action.action === 'read' || action.action === 'unread' ? '\\Seen' : '\\Flagged';
            writeStarted = true;
            const result =
              action.action === 'read' || action.action === 'star'
                ? await client.messageFlagsAdd(range, [flag], { uid: true })
                : await client.messageFlagsRemove(range, [flag], { uid: true });
            if (!result) throw Error('flags unconfirmed');
          }
        } finally {
          lock.release();
        }
      });
    } catch (error) {
      if (!writeStarted || isAuthError(error)) throw error;
      throw new MailError(
        'ACTION_UNCONFIRMED',
        409,
        'Chưa xác nhận được thay đổi. Hãy tải lại danh sách và kiểm tra trước khi thử lại.',
      );
    }
  }

  async quota(): Promise<MailQuota | null> {
    return this.connection(async (client) => {
      const quota = await client.getQuota('INBOX');
      const storage = quota && quota.storage;
      // ImapFlow converts the wire KiB values to bytes.
      if (
        !storage ||
        typeof storage.usage !== 'number' ||
        typeof storage.limit !== 'number' ||
        !Number.isSafeInteger(storage.usage) ||
        !Number.isSafeInteger(storage.limit) ||
        storage.usage < 0 ||
        storage.limit <= 0
      )
        return null;
      return { used: storage.usage, limit: storage.limit };
    });
  }

  async raw(folder: Folder, id: string) {
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
        const row = await client.fetchOne(
          String(key.uid),
          { uid: true, size: true },
          { uid: true },
        );
        if (!row) throw new MailError('NOT_FOUND', 404, 'Không tìm thấy thư.');
        ensureMimeSize(row.size || 0);
        const { meta, content } = await client.download(String(key.uid), undefined, {
          uid: true,
          maxBytes: MAX_MIME + 1,
        });
        if (!meta || !content)
          throw new MailError('NOT_FOUND', 404, 'Không tải được nội dung thư.');
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
        return {
          content: new Uint8Array(Buffer.concat(chunks)),
          name: `message-${key.validity}-${key.uid}.eml`,
          type: 'message/rfc822',
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
        if (markSeen && !(await client.messageFlagsAdd(String(key.uid), ['\\Seen'], { uid: true })))
          throw new MailError(
            'ACTION_UNCONFIRMED',
            409,
            'Chưa xác nhận được trạng thái đã đọc. Hãy tải lại danh sách.',
          );
        return {
          parsed,
          parts: decodedAttachmentParts(row.bodyStructure, parsed.attachments),
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
