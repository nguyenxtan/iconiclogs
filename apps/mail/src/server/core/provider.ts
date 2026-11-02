import type {
  Folder,
  MailMessage,
  MessagePage,
  SendDraft,
  SendResult,
} from '../../shared/contracts';

export interface MailAttachment {
  content: Uint8Array;
  name: string;
  type: string;
}
export interface MailProvider {
  authenticate(): Promise<void>;
  list(folder: Folder, page: number): Promise<MessagePage>;
  read(folder: Folder, id: string): Promise<MailMessage>;
  attachment(folder: Folder, id: string, attachmentId: number): Promise<MailAttachment>;
  send(draft: SendDraft, messageId: string): Promise<SendResult>;
}
