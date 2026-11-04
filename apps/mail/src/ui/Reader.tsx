import { useMemo, useState } from 'react';
import type { Folder, MailMessage, MessageAction } from '../shared/contracts';
import type { MailApi } from './api';
import { Icon } from './Icon';
import { safeEmailDocument } from './safeEmail';

export function Reader({
  message,
  busy,
  error,
  folder,
  api,
  onReply,
  onReplyAll,
  onForward,
  onAction,
  actionBusy,
  onBack,
  onError,
  onRetry,
}: {
  message: MailMessage | null;
  busy: boolean;
  error: string;
  folder: Folder;
  api: MailApi;
  onReply(message: MailMessage): void;
  onReplyAll?(message: MailMessage): void;
  onForward?(message: MailMessage): void;
  onAction?(action: MessageAction): void;
  actionBusy?: boolean;
  onBack(): void;
  onError(error: unknown): void;
  onRetry(): void;
}) {
  const html = useMemo(
    () => (message?.html ? safeEmailDocument(message.html) : ''),
    [message?.html],
  );
  const [downloading, setDownloading] = useState<number | null>(null);
  async function download(id: number, name: string) {
    if (!message) return;
    setDownloading(id);
    try {
      const blob = await api.attachment(folder, message.id, id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.rel = 'noopener';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      onError(error);
    } finally {
      setDownloading(null);
    }
  }
  async function rawDownload() {
    if (!message) return;
    try {
      const url = URL.createObjectURL(await api.raw(folder, message.id));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'message.eml';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      onError(error);
    }
  }
  return (
    <section className="reader" aria-label="Nội dung thư" aria-busy={busy}>
      <div className="reader-toolbar">
        <button
          className="icon-button mobile-back"
          onClick={onBack}
          aria-label="Trở lại danh sách thư"
        >
          <Icon name="arrow" />
        </button>
        <span>
          <Icon name="lock" size={13} /> Hộp thư ICONIC
        </span>
        {message && (
          <button className="button subtle" onClick={() => onReply(message)}>
            <Icon name="reply" size={16} />
            Trả lời
          </button>
        )}
      </div>
      {message && (
        <div className="reader-actions" aria-label="Thao tác thư">
          {onReplyAll && (
            <button className="button subtle" onClick={() => onReplyAll(message)}>
              <Icon name="reply" size={15} />
              Trả lời tất cả
            </button>
          )}
          {onForward && (
            <button className="button subtle" onClick={() => onForward(message)}>
              <Icon name="forward" size={15} />
              Chuyển tiếp
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Tải thư gốc EML"
            title="Tải thư gốc EML"
            onClick={() => void rawDownload()}
          >
            <Icon name="download" size={17} />
          </button>
          {onAction && (
            <>
              <button
                className="icon-button"
                disabled={actionBusy}
                aria-label={message.starred ? 'Bỏ sao thư' : 'Gắn sao thư'}
                title={message.starred ? 'Bỏ sao' : 'Gắn sao'}
                aria-pressed={!!message.starred}
                onClick={() =>
                  onAction({ ids: [message.id], action: message.starred ? 'unstar' : 'star' })
                }
              >
                <Icon name="star" size={17} />
              </button>
              <button
                className="button subtle"
                disabled={actionBusy}
                onClick={() =>
                  onAction({ ids: [message.id], action: message.unread ? 'read' : 'unread' })
                }
              >
                {message.unread ? 'Đánh dấu đã đọc' : 'Đánh dấu chưa đọc'}
              </button>
              {folder !== 'archive' && folder !== 'trash' && (
                <button
                  className="icon-button"
                  disabled={actionBusy}
                  aria-label="Lưu trữ thư"
                  title="Lưu trữ thư"
                  onClick={() =>
                    onAction({ ids: [message.id], action: 'move', destination: 'archive' })
                  }
                >
                  <Icon name="archive" size={17} />
                </button>
              )}
              <button
                className="button subtle"
                disabled={actionBusy}
                onClick={() =>
                  onAction({
                    ids: [message.id],
                    action: 'move',
                    destination: folder === 'trash' ? 'inbox' : 'trash',
                  })
                }
              >
                <Icon name={folder === 'trash' ? 'inbox' : 'trash'} size={17} />
                {folder === 'trash' ? 'Khôi phục về Hộp thư đến' : 'Thùng rác'}
              </button>
            </>
          )}
        </div>
      )}
      {busy ? (
        <div className="pane-state">
          <span className="spinner" />
          <p>Đang mở thư…</p>
        </div>
      ) : error ? (
        <div className="pane-state">
          <Icon name="info" size={30} />
          <h2>Chưa thể mở thư</h2>
          <p>{error}</p>
          <button className="button secondary" onClick={onRetry}>
            Thử lại
          </button>
          <button className="button subtle" onClick={onBack}>
            Về danh sách
          </button>
        </div>
      ) : !message ? (
        <div className="reader-welcome">
          <p>Chọn một thư để đọc.</p>
        </div>
      ) : (
        <article className="mail-article">
          <div className="mail-subject">
            <span className="eyebrow">{folder === 'sent' ? 'THƯ ĐÃ GỬI' : 'NỘI DUNG THƯ'}</span>
            <h2>{message.subject || '(Không có tiêu đề)'}</h2>
          </div>
          <div className="mail-sender">
            <span className="avatar">
              {(message.from.name || message.from.address).slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{message.from.name || message.from.address}</strong>
              <span>{message.from.address}</span>
              <span className="mail-recipients">
                Đến: {message.to.map((recipient) => recipient.address).join(', ')}
                {message.cc?.length ? (
                  <span>Cc: {message.cc.map((recipient) => recipient.address).join(', ')}</span>
                ) : null}
              </span>
            </div>
            <time dateTime={message.date}>
              {new Date(message.date).toLocaleString('vi-VN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
          {html ? (
            <>
              <p className="html-note">
                <Icon name="lock" size={13} /> Nội dung được bảo vệ. Ảnh và liên kết ngoài đã tắt.
              </p>
              <iframe
                title="Nội dung HTML của thư"
                className="email-frame"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={html}
              />
            </>
          ) : (
            <div className="mail-text">{message.text || '(Thư không có nội dung văn bản)'}</div>
          )}
          {!!message.attachments.length && (
            <div className="attachments">
              <h3>
                <Icon name="attachment" size={16} /> {message.attachments.length} tệp đính kèm
              </h3>
              {message.attachments.map((attachment) => (
                <button
                  className="attachment-card"
                  key={attachment.id}
                  onClick={() => download(attachment.id, attachment.name)}
                  disabled={downloading !== null}
                >
                  <span className="file-symbol">
                    <Icon name="attachment" size={20} />
                  </span>
                  <span>
                    <strong>{attachment.name}</strong>
                    <small>
                      {downloading === attachment.id ? 'Đang tải…' : formatSize(attachment.size)}
                    </small>
                  </span>
                  <Icon name="download" size={17} />
                </button>
              ))}
            </div>
          )}
          <div className="reply-footer">
            <button className="button secondary" onClick={() => onReply(message)}>
              <Icon name="reply" size={17} />
              Trả lời thư
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
export function formatSize(size: number) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.ceil(size / 1024)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
