import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { MailMessage, SendDraft, SessionInfo } from '../shared/contracts';
import { errorMessage, MailApiError, type MailApi } from './api';
import { Icon } from './Icon';
import { formatSize } from './Reader';
import { canSend, outcomeNotice, type SendState } from './sendState';

export function Composer({
  session,
  api,
  reply,
  demo,
  onClose,
  onSent,
  onExpired,
}: {
  session: SessionInfo;
  api: MailApi;
  reply: MailMessage | null;
  demo: boolean;
  onClose(): void;
  onSent(): void;
  onExpired(): void;
}) {
  const [to, setTo] = useState(
    reply
      ? reply.from.address.toLowerCase() === session.email.toLowerCase()
        ? reply.to.map((recipient) => recipient.address).join(', ')
        : reply.from.address
      : '',
  );
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(
    reply ? (/^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`) : '',
  );
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<SendDraft['attachments']>([]);
  const [picking, setPicking] = useState(false);
  const [state, setState] = useState<SendState>('idle');
  const [notice, setNotice] = useState<{ tone: string; message: string } | null>(null);
  const key = useRef<string | null>(null);
  const submitting = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const locked = state === 'sending' || state === 'unknown' || state === 'delivered';
  const dirty = !!(text || to || cc || subject || attachments.length) && state !== 'delivered';
  const close = () => {
    if (state === 'sending') return;
    if (
      !dirty ||
      window.confirm(
        state === 'unknown'
          ? 'Kết quả gửi chưa xác định. Không gửi lại thư này để tránh trùng lặp. Đóng cửa sổ soạn thư?'
          : 'Bỏ nội dung thư chưa gửi? Bản nháp chỉ được giữ trong tab này.',
      )
    )
      onClose();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || state === 'sending') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, state]);
  const edited = () => {
    key.current = null;
    if (state === 'failed') {
      setState('idle');
      setNotice(null);
    }
  };
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    const bytes =
      attachments.reduce((sum, file) => sum + file.content.length * 0.75, 0) +
      files.reduce((sum, file) => sum + file.size, 0);
    if (bytes > 7 * 1024 * 1024) {
      setNotice({
        tone: 'error',
        message:
          'Tổng tệp đính kèm tối đa 7 MB để dành dung lượng cho mã hóa thư. Không có tệp nào được thêm.',
      });
      return;
    }
    setPicking(true);
    try {
      const added = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || 'application/octet-stream',
          content: await readFile(file),
        })),
      );
      edited();
      setAttachments((existing) => [...existing, ...added]);
    } catch {
      setNotice({ tone: 'error', message: 'Không thể đọc tệp. Vui lòng chọn lại.' });
    } finally {
      setPicking(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || picking || !canSend(state)) return;
    const recipients = splitRecipients(to),
      copies = splitRecipients(cc);
    if (
      !recipients.length ||
      [...recipients, ...copies].some((email) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    ) {
      setNotice({ tone: 'error', message: 'Nhập địa chỉ email hợp lệ, ngăn cách bằng dấu phẩy.' });
      return;
    }
    if (!subject.trim() && !window.confirm('Gửi thư không có tiêu đề?')) return;
    submitting.current = true;
    setState('sending');
    setNotice(null);
    key.current ??= crypto.randomUUID();
    try {
      const result = await api.send(
        {
          to: recipients,
          cc: copies,
          subject,
          text,
          attachments,
          ...(reply?.messageId ? { inReplyTo: reply.messageId } : {}),
        },
        session.csrfToken,
        key.current,
      );
      const outcome = outcomeNotice(result);
      setState(outcome.state);
      setNotice(outcome);
      if (outcome.state === 'delivered') onSent();
      if (outcome.state === 'failed') key.current = null;
    } catch (error) {
      if (error instanceof MailApiError && error.status === 401) {
        onExpired();
        return;
      }
      const uncertain =
        !(error instanceof MailApiError) || error.status >= 500 || error.code === 'SEND_UNKNOWN';
      setState(uncertain ? 'unknown' : 'failed');
      setNotice({
        tone: uncertain ? 'warning' : 'error',
        message: uncertain
          ? 'Chưa xác định kết quả gửi. Thư có thể đã được chấp nhận. Đã khóa gửi lại để tránh trùng lặp; hãy kiểm tra với người nhận hoặc quản trị viên.'
          : errorMessage(error),
      });
      if (!uncertain) key.current = null;
    } finally {
      submitting.current = false;
    }
  }
  return (
    <div
      className="composer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key === 'Tab') {
            const items = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
              ) ?? [],
            ).filter((item) => !item.hidden && item.getClientRects().length > 0);
            const first = items?.[0],
              last = items?.[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="composer-heading">
          <div>
            <span className="eyebrow">MỘT KẾT NỐI MỚI</span>
            <h2 id="composer-title">{reply ? 'Trả lời thư' : 'Soạn thư'}</h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            disabled={state === 'sending'}
            aria-label="Đóng cửa sổ soạn thư"
          >
            <Icon name="close" />
          </button>
        </header>
        <form onSubmit={send} className="composer-form">
          <div className="composer-from">
            Từ <strong>{session.email}</strong>
            {demo && <span className="sample-chip">BẢN MẪU</span>}
          </div>
          <div className="recipient-field">
            <label htmlFor="draft-to">Đến</label>
            <input
              id="draft-to"
              value={to}
              required
              disabled={locked}
              onChange={(event) => {
                edited();
                setTo(event.target.value);
              }}
              placeholder="nguoinhan@congty.com"
            />
            <button
              type="button"
              disabled={locked}
              onClick={() => setShowCc(!showCc)}
              aria-expanded={showCc}
            >
              Cc
            </button>
          </div>
          {showCc && (
            <div className="recipient-field">
              <label htmlFor="draft-cc">Cc</label>
              <input
                id="draft-cc"
                value={cc}
                disabled={locked}
                onChange={(event) => {
                  edited();
                  setCc(event.target.value);
                }}
                placeholder="Các địa chỉ cách nhau bằng dấu phẩy"
              />
            </div>
          )}
          <input
            aria-label="Tiêu đề thư"
            className="composer-subject"
            placeholder="Tiêu đề thư"
            maxLength={998}
            value={subject}
            disabled={locked}
            onChange={(event) => {
              edited();
              setSubject(event.target.value);
            }}
          />
          <textarea
            aria-label="Nội dung thư"
            placeholder="Viết lời nhắn của bạn…"
            value={text}
            disabled={locked}
            onChange={(event) => {
              edited();
              setText(event.target.value);
            }}
          />
          {!!attachments.length && (
            <div className="draft-files">
              {attachments.map((file, index) => (
                <div key={`${index}-${file.name}`}>
                  <Icon name="attachment" size={14} />
                  <span>
                    {file.name} <small>{formatSize(file.content.length * 0.75)}</small>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={locked || picking}
                    onClick={() => {
                      edited();
                      setAttachments((files) => files.filter((_, i) => index !== i));
                    }}
                    aria-label={`Bỏ tệp ${file.name}`}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {notice && (
            <div className={`notice ${notice.tone}`} role="status">
              <Icon name={notice.tone === 'success' ? 'check' : 'info'} size={18} />
              <span>
                {demo && state === 'delivered'
                  ? 'Đã mô phỏng gửi thư. Không có email nào được gửi ra ngoài.'
                  : notice.message}
              </span>
            </div>
          )}
          <footer className="composer-footer">
            <div>
              {state === 'delivered' ? (
                <button type="button" className="button primary" onClick={onClose}>
                  Hoàn tất
                  <Icon name="check" size={17} />
                </button>
              ) : (
                <button
                  className="button primary"
                  type="submit"
                  disabled={!canSend(state) || picking}
                >
                  {state === 'sending'
                    ? 'Đang gửi…'
                    : state === 'unknown'
                      ? 'Kết quả chưa xác định'
                      : demo
                        ? 'Mô phỏng gửi'
                        : 'Gửi thư'}
                  <Icon name="sent" size={17} />
                </button>
              )}
              <button
                className="icon-button"
                type="button"
                disabled={locked || picking}
                onClick={() => fileInput.current?.click()}
                aria-label="Thêm tệp đính kèm"
              >
                <Icon name="attachment" />
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={pick}
                disabled={locked || picking}
              />
            </div>
            <span>{picking ? 'Đang đọc tệp…' : 'Bản nháp chỉ giữ trong tab'}</span>
          </footer>
        </form>
      </div>
    </div>
  );
}
function splitRecipients(value: string) {
  return value
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
