export interface MailAddress {
  name: string;
  address: string;
}
export type Folder =
  'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | `folder:${string}`;
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
  starred?: boolean;
  hasAttachments: boolean;
}
export interface MailMessage extends MessageSummary {
  text: string;
  html?: string;
  cc?: MailAddress[];
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
  bcc?: string[];
  displayName?: string;
  deliveryGuard?: 'unknown' | 'partial';
  deliveryKey?: string;
  subject: string;
  text: string;
  attachments: DraftAttachment[];
  inReplyTo?: string;
}
export interface SendResult {
  status: 'sent' | 'partial' | 'unknown' | 'failed';
  sentCopy: 'saved' | 'unconfirmed' | 'provider-managed' | 'not-applicable';
  accepted: string[];
  rejected: string[];
}
export interface ApiError {
  error: { code: string; message: string };
}

export interface MailFolder {
  id: Folder;
  name: string;
  role?: 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive';
  unread?: number;
  total?: number;
}
export interface MessageFilter {
  query?: string;
  unread?: boolean;
  starred?: boolean;
  attachments?: boolean;
  from?: string;
  after?: string;
  before?: string;
}
export interface MessageAction {
  ids: string[];
  action: 'read' | 'unread' | 'star' | 'unstar' | 'move';
  destination?: Folder;
}
export interface MailQuota {
  used: number;
  limit: number;
}
export interface MailPreferences {
  displayName: string;
  signature: string;
  contacts: MailAddress[];
}
export interface SavedDraft {
  id: string;
  revision: number;
  draft: SendDraft;
  updatedAt: number;
}
export interface DraftSummary {
  id: string;
  subject: string;
  to: string[];
  updatedAt: number;
  revision: number;
}
