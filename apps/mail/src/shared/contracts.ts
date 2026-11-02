export interface MailAddress {
  name: string;
  address: string;
}
export type Folder = 'inbox' | 'sent';
export interface AttachmentInfo {
  id: number;
  name: string;
  type: string;
  size: number;
}
export interface MessageSummary {
  id: string;
  from: MailAddress;
  to: MailAddress[];
  subject: string;
  date: string;
  unread: boolean;
  hasAttachments: boolean;
}
export interface MailMessage extends MessageSummary {
  text: string;
  html?: string;
  attachments: AttachmentInfo[];
  messageId?: string;
}
export interface MessagePage {
  messages: MessageSummary[];
  nextPage: number | null;
  total: number;
}
export interface SessionInfo {
  email: string;
  expiresAt: number;
  csrfToken: string;
}
export interface DraftAttachment {
  name: string;
  type: string;
  content: string;
}
export interface SendDraft {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  attachments: DraftAttachment[];
  inReplyTo?: string;
}
export interface SendResult {
  status: 'sent' | 'partial' | 'unknown' | 'failed';
  sentCopy: 'saved' | 'unconfirmed' | 'not-applicable';
  accepted: string[];
  rejected: string[];
}
export interface ApiError {
  error: { code: string; message: string };
}
