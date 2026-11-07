import type {
  Folder,
  MailFolder,
  MailQuota,
  MessageAction,
  MessageFilter,
  MailMessage,
  MessagePage,
  SendDraft,
  SendResult,
} from '../../shared/contracts';
import { isAuthError, unauthorized } from './errors';

export async function authenticatedCall<T>(
  operation: () => Promise<T>,
  revoke: () => Promise<void>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isAuthError(error)) {
      await revoke();
      throw unauthorized();
    }
    throw error;
  }
}

export interface MailAttachment {
  content: Uint8Array;
  name: string;
  type: string;
}
export interface MailProvider {
  authenticate(): Promise<void>;
  folders(): Promise<MailFolder[]>;
  createFolder(name: string): Promise<void>;
  list(folder: Folder, page: number, filter?: MessageFilter): Promise<MessagePage>;
  action(folder: Folder, action: MessageAction): Promise<void>;
  quota(): Promise<MailQuota | null>;
  raw(folder: Folder, id: string): Promise<MailAttachment>;
  read(folder: Folder, id: string): Promise<MailMessage>;
  attachment(folder: Folder, id: string, attachmentId: number): Promise<MailAttachment>;
  send(draft: SendDraft, messageId: string): Promise<SendResult>;
}
