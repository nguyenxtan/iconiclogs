import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import type {
  Folder,
  MailMessage,
  MailPreferences,
  SavedDraft,
  SendDraft,
  SessionInfo,
} from '../shared/contracts';
import { errorMessage, MailApiError, type MailApi } from './api';
import { Icon } from './Icon';
import { formatSize } from './Reader';
import { canSend, outcomeNotice, type SendState } from './sendState';
import {
  attachmentBytes,
  contactSuggestions,
  forwardAttachments,
  initialComposeDraft,
  MAX_COMPOSE_BYTES,
  readComposeFile,
  splitRecipients,
  type ComposeMode,
} from './composeDraft';
import { DraftAutosave, type DraftSaveStatus } from './draftAutosave';
import { sendDraftSafely } from './composeDelivery';
import './composer-extra.css';

export function Composer({
  session,
  api,
  reply,
  demo,
  mode = 'reply',
  sourceFolder = 'inbox',
  saved,
  preferences,
  onClose,
  onSent,
  onExpired,
  onDraftChanged,
}: {
  session: SessionInfo;
  api: MailApi;
  reply: MailMessage | null;
  demo: boolean;
  mode?: ComposeMode;
  sourceFolder?: Folder;
  saved?: SavedDraft;
  preferences?: MailPreferences;
  onClose(): void;
  onSent(): void;
  onExpired(): void;
  onDraftChanged?(): void;
}) {
  const [initial] = useState(
    () => saved?.draft ?? initialComposeDraft({ reply, mode, email: session.email, preferences }),
  );
  const [to, setTo] = useState(initial.to.join(', '));
  const [cc, setCc] = useState(initial.cc.join(', '));
  const [bcc, setBcc] = useState((initial.bcc ?? []).join(', '));
  const [showCc, setShowCc] = useState(!!initial.cc.length);
  const [showBcc, setShowBcc] = useState(!!initial.bcc?.length);
  const [subject, setSubject] = useState(initial.subject);
  const [text, setText] = useState(initial.text);
  const [attachments, setAttachments] = useState(initial.attachments);
  const [touched, setTouched] = useState(false);
  const [picking, setPicking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [state, setState] = useState<SendState>(initial.deliveryGuard ? 'unknown' : 'idle');
  const [notice, setNotice] = useState<{ tone: string; message: string } | null>(
    initial.deliveryGuard
      ? {
          tone: 'warning',
          message:
            initial.deliveryGuard === 'partial'
              ? 'Thư này đã được gửi một phần. Bản nháp được giữ để đối chiếu; đã khóa gửi lại toàn bộ thư để tránh trùng lặp.'
              : 'Bản nháp này đã có lần gửi chưa xác định kết quả. Đã khóa gửi lại để tránh trùng lặp; hãy kiểm tra với người nhận hoặc quản trị viên.',
        }
      : null,
  );
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>(saved ? 'saved' : 'idle');
  const [saveError, setSaveError] = useState('');
  const [forwardState, setForwardState] = useState<
    'none' | 'loading' | 'ready' | 'error' | 'skipped'
  >(mode === 'forward' && reply?.attachments.length && !saved ? 'loading' : 'none');
  const [forwardError, setForwardError] = useState('');
  const [forwardAttempt, setForwardAttempt] = useState(0);
  const key = useRef<string | null>(initial.deliveryKey ?? null);
  const delivery = useRef<Pick<SendDraft, 'deliveryGuard' | 'deliveryKey'>>({
    deliveryGuard: initial.deliveryGuard,
    deliveryKey: initial.deliveryKey,
  });
  const submitting = useRef(false);
  const processingFiles = useRef(false);
  const finishing = useRef(false);
  const disposed = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onDraftChanged });
  callbacks.current = { onDraftChanged };
  const contactsId = useId();
  const active = touched || !!reply || !!saved;
  const [autosave] = useState(
    () =>
      new DraftAutosave(
        saved?.id ?? crypto.randomUUID(),
        saved,
        async (id, value, revision) => {
          const result = await api.saveDraft(id, value, revision, session.csrfToken);
          callbacks.current.onDraftChanged?.();
          return result;
        },
        (status, error) => {
          if (disposed.current) return;
          setSaveStatus(status);
          if (status === 'error') setSaveError(draftSaveError(error));
          else setSaveError('');
        },
      ),
  );
  const formDraft = useMemo<SendDraft>(
    () => ({
      to: splitRecipients(to),
      cc: splitRecipients(cc),
      bcc: splitRecipients(bcc),
      subject,
      text,
      attachments,
      displayName: initial.displayName ?? preferences?.displayName ?? '',
      ...(initial.inReplyTo ? { inReplyTo: initial.inReplyTo } : {}),
    }),
    [to, cc, bcc, subject, text, attachments, initial, preferences?.displayName],
  );
  const locked = closing || state === 'sending' || state === 'unknown' || state === 'delivered';
  const loadingFiles = picking || forwardState === 'loading';
  const forwardBlocked = forwardState === 'loading' || forwardState === 'error';
  const snapshot = () => ({ ...formDraft, ...delivery.current });

  useEffect(() => {
    disposed.current = false;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      disposed.current = true;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (!active || finishing.current || forwardBlocked) return;
    autosave.update({ ...formDraft, ...delivery.current });
    const timer = window.setTimeout(() => {
      void autosave.flush().catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
  }, [formDraft, active, autosave, forwardBlocked]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (autosave.pending || submitting.current || processingFiles.current || forwardBlocked) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [autosave, forwardState]);
  useEffect(() => {
    if (mode !== 'forward' || !reply?.attachments.length || saved) return;
    let cancelled = false;
    setForwardState('loading');
    setForwardError('');
    void forwardAttachments(reply, (id) => api.attachment(sourceFolder, reply.id, id))
      .then((files) => {
        if (cancelled) return;
        setAttachments((current) => [...current, ...files]);
        setTouched(true);
        setForwardState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setForwardState('error');
        setForwardError(error instanceof Error ? error.message : 'Không thể tải tệp gốc.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, mode, reply, saved, sourceFolder, forwardAttempt]);

  const edited = () => {
    setTouched(true);
    key.current = null;
    delivery.current = {};
    if (state === 'failed') {
      setState('idle');
      setNotice(null);
    }
  };
  async function persist(value: SendDraft) {
    delivery.current = { deliveryGuard: value.deliveryGuard, deliveryKey: value.deliveryKey };
    autosave.update(value);
    await autosave.flush();
  }
  async function close() {
    if (submitting.current || processingFiles.current || forwardBlocked || picking || closing)
      return;
    if (state === 'delivered' || !active) {
      onClose();
      return;
    }
    setClosing(true);
    try {
      await persist(snapshot());
      onClose();
    } catch {
      /* The visible save error keeps the editor open and its contents intact. */
    } finally {
      if (!disposed.current) setClosing(false);
    }
  }
  async function discard() {
    if (submitting.current || loadingFiles || closing) return;
    if (!window.confirm('Bỏ bản nháp này? Nội dung và tệp đính kèm của bản nháp sẽ bị xóa.'))
      return;
    setClosing(true);
    try {
      if (active) {
        await persist(snapshot());
        if (autosave.saved)
          await api.removeDraft(autosave.saved.id, autosave.saved.revision, session.csrfToken);
      }
      finishing.current = true;
      onDraftChanged?.();
      onClose();
    } catch (error) {
      setSaveStatus('error');
      setSaveError(`Chưa thể bỏ bản nháp. ${draftSaveError(error)}`);
    } finally {
      if (!disposed.current) setClosing(false);
    }
  }
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length || processingFiles.current || locked || forwardState === 'loading') return;
    if (
      attachmentBytes(attachments) + files.reduce((sum, file) => sum + file.size, 0) >
      MAX_COMPOSE_BYTES
    ) {
      setNotice({
        tone: 'error',
        message: 'Tổng tệp đính kèm tối đa 7 MB. Không có tệp nào được thêm.',
      });
      return;
    }
    processingFiles.current = true;
    setPicking(true);
    try {
      const added = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || 'application/octet-stream',
          content: await readComposeFile(file),
        })),
      );
      if (!disposed.current) {
        edited();
        setAttachments((current) => [...current, ...added]);
      }
    } catch {
      setNotice({ tone: 'error', message: 'Không thể đọc tệp. Vui lòng chọn lại.' });
    } finally {
      processingFiles.current = false;
      if (!disposed.current) setPicking(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      submitting.current ||
      processingFiles.current ||
      forwardBlocked ||
      closing ||
      !canSend(state)
    )
      return;
    const value = formDraft;
    if (
      !value.to.length ||
      [...value.to, ...value.cc, ...(value.bcc ?? [])].some(
        (email) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email),
      )
    ) {
      setNotice({ tone: 'error', message: 'Nhập địa chỉ email hợp lệ, ngăn cách bằng dấu phẩy.' });
      return;
    }
    if (!subject.trim() && !window.confirm('Gửi thư không có tiêu đề?')) return;
    submitting.current = true;
    setState('sending');
    setNotice(null);
    key.current ??= crypto.randomUUID();
    const outcome = await sendDraftSafely(value, key.current, {
      persist,
      send: (payload, deliveryKey) => api.send(payload, session.csrfToken, deliveryKey),
      remove: async () => {
        await autosave.flush();
        if (autosave.saved)
          await api.removeDraft(autosave.saved.id, autosave.saved.revision, session.csrfToken);
      },
    });
    if (disposed.current) {
      submitting.current = false;
      return;
    }
    if (outcome.state === 'blocked') {
      delivery.current = {};
      key.current = null;
      setState('failed');
      setNotice({
        tone: 'error',
        message: 'Chưa gửi thư vì bản nháp chưa được lưu an toàn. Hãy thử lưu lại rồi gửi.',
      });
    } else if (outcome.state === 'unknown' || outcome.state === 'partial') {
      setState('unknown');
      setNotice(
        outcome.result
          ? outcomeNotice(outcome.result)
          : {
              tone: 'warning',
              message:
                'Chưa xác định kết quả gửi. Đã giữ bản nháp và khóa gửi lại để tránh trùng lặp; hãy kiểm tra với người nhận hoặc quản trị viên.',
            },
      );
      if (outcome.state === 'partial') onSent();
    } else if (outcome.state === 'sent') {
      finishing.current = true;
      setState('delivered');
      setNotice(
        outcome.maintenanceError
          ? {
              tone: 'warning',
              message:
                'Máy chủ đã chấp nhận thư. Chưa xóa được bản nháp; bản nháp đã khóa gửi lại để tránh trùng lặp.',
            }
          : outcomeNotice(outcome.result!),
      );
      onSent();
    } else {
      key.current = null;
      setState('failed');
      setNotice(
        outcome.result
          ? outcomeNotice(outcome.result)
          : { tone: 'error', message: errorMessage(outcome.error) },
      );
      if (outcome.error instanceof MailApiError && outcome.error.status === 401) onExpired();
    }
    if (outcome.maintenanceError && outcome.state !== 'sent') {
      setSaveStatus('error');
      setSaveError(draftSaveError(outcome.maintenanceError));
    }
    submitting.current = false;
  }
  const saveLabel =
    forwardState === 'error'
      ? 'Chưa lưu: cần xử lý tệp gốc'
      : forwardState === 'loading'
        ? 'Đang tải tệp trước khi lưu…'
        : closing
          ? 'Đang hoàn tất…'
          : saveStatus === 'saved'
            ? 'Đã lưu bản nháp'
            : saveStatus === 'saving'
              ? 'Đang lưu bản nháp…'
              : saveStatus === 'pending'
                ? 'Chờ lưu bản nháp…'
                : saveStatus === 'error'
                  ? 'Chưa lưu được bản nháp'
                  : 'Bản nháp tự động lưu';
  const heading = saved
    ? 'Bản nháp'
    : !reply
      ? 'Soạn thư'
      : mode === 'forward'
        ? 'Chuyển tiếp thư'
        : mode === 'replyAll'
          ? 'Trả lời tất cả'
          : 'Trả lời thư';
  const datalist = (field: 'to' | 'cc' | 'bcc', value: string) => (
    <datalist id={`${contactsId}-${field}`}>
      {contactSuggestions(value, preferences?.contacts ?? []).map((contact, index) => (
        <option key={`${contact.value}-${index}`} value={contact.value}>
          {contact.name}
        </option>
      ))}
    </datalist>
  );
  return (
    <div
      className="composer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void close();
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
            void close();
          }
          if (event.key === 'Tab') {
            const items = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
              ) ?? [],
            ).filter((item) => !item.hidden && item.getClientRects().length > 0);
            const first = items[0],
              last = items[items.length - 1];
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
            <h2 id="composer-title">{heading}</h2>
          </div>
          <button
            className="icon-button"
            onClick={() => void close()}
            disabled={state === 'sending' || closing || loadingFiles || forwardBlocked}
            aria-label="Lưu và đóng cửa sổ soạn thư"
          >
            <Icon name="close" />
          </button>
        </header>
        <form onSubmit={send} className="composer-form">
          <div className="composer-from">
            Từ{' '}
            <strong>
              {formDraft.displayName
                ? `${formDraft.displayName} <${session.email}>`
                : session.email}
            </strong>
            {demo && <span className="sample-chip">BẢN MẪU</span>}
          </div>
          <div className="recipient-field">
            <label htmlFor="draft-to">Đến</label>
            <input
              id="draft-to"
              value={to}
              required
              disabled={locked}
              list={`${contactsId}-to`}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => {
                edited();
                setTo(event.target.value);
              }}
              placeholder="nguoinhan@congty.com"
            />
            {!showCc && (
              <button
                type="button"
                disabled={locked}
                onClick={() => setShowCc(true)}
                aria-label="Thêm người nhận Cc"
              >
                Cc
              </button>
            )}
            {!showBcc && (
              <button
                type="button"
                disabled={locked}
                onClick={() => setShowBcc(true)}
                aria-label="Thêm người nhận Bcc"
              >
                Bcc
              </button>
            )}
            {datalist('to', to)}
          </div>
          {showCc && (
            <div className="recipient-field">
              <label htmlFor="draft-cc">Cc</label>
              <input
                id="draft-cc"
                value={cc}
                disabled={locked}
                list={`${contactsId}-cc`}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => {
                  edited();
                  setCc(event.target.value);
                }}
                placeholder="Các địa chỉ cách nhau bằng dấu phẩy"
              />
              {datalist('cc', cc)}
            </div>
          )}
          {showBcc && (
            <div className="recipient-field">
              <label htmlFor="draft-bcc">Bcc</label>
              <input
                id="draft-bcc"
                value={bcc}
                disabled={locked}
                list={`${contactsId}-bcc`}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => {
                  edited();
                  setBcc(event.target.value);
                }}
                placeholder="Người nhận ẩn với các người nhận khác"
              />
              {datalist('bcc', bcc)}
            </div>
          )}
          <input
            aria-label="Tiêu đề thư"
            className="composer-subject"
            placeholder="Tiêu đề thư"
            maxLength={200}
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
          {forwardState !== 'none' && (
            <div
              className={`composer-forward-info ${forwardState === 'error' ? 'has-error' : ''}`}
              role="status"
            >
              <span>
                {forwardState === 'loading'
                  ? 'Đang tải tệp đính kèm gốc…'
                  : forwardState === 'error'
                    ? `Chưa thêm được tệp gốc: ${forwardError}`
                    : forwardState === 'skipped'
                      ? 'Tệp đính kèm gốc không được thêm vào thư này.'
                      : `Đã tải ${reply?.attachments.length ?? 0} tệp gốc. Kiểm tra danh sách bên dưới trước khi gửi.`}
              </span>
              {forwardState === 'error' && (
                <div>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setForwardAttempt((value) => value + 1)}
                    disabled={locked}
                  >
                    Thử tải lại
                  </button>
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() => setForwardState('skipped')}
                    disabled={locked}
                  >
                    Tiếp tục không kèm tệp gốc
                  </button>
                </div>
              )}
            </div>
          )}
          {!!attachments.length && (
            <div className="draft-files">
              {attachments.map((file, index) => (
                <div key={`${index}-${file.name}`}>
                  <Icon name="attachment" size={14} />
                  <span>
                    {file.name} <small>{formatSize(attachmentBytes([file]))}</small>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={locked || loadingFiles}
                    onClick={() => {
                      edited();
                      setAttachments((files) => files.filter((_, i) => i !== index));
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
          {saveError && (
            <div className="notice error composer-save-error" role="alert">
              <Icon name="info" size={18} />
              <span>{saveError} Nội dung vẫn được giữ trong cửa sổ này.</span>
              <button
                type="button"
                disabled={state === 'sending' || closing}
                onClick={() => {
                  void persist(snapshot()).catch(() => {});
                }}
              >
                Thử lưu lại
              </button>
            </div>
          )}
          <footer className="composer-footer">
            <div>
              {state === 'delivered' ? (
                <button type="button" className="button primary" onClick={onClose}>
                  Hoàn tất <Icon name="check" size={17} />
                </button>
              ) : (
                <button
                  className="button primary"
                  type="submit"
                  disabled={!canSend(state) || loadingFiles || forwardBlocked || closing}
                >
                  {state === 'sending'
                    ? 'Đang gửi…'
                    : state === 'unknown'
                      ? delivery.current.deliveryGuard === 'partial'
                        ? 'Đã gửi một phần'
                        : 'Kết quả chưa xác định'
                      : demo
                        ? 'Mô phỏng gửi'
                        : 'Gửi thư'}
                  <Icon name="sent" size={17} />
                </button>
              )}
              <button
                className="icon-button"
                type="button"
                disabled={locked || loadingFiles}
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
                disabled={locked || loadingFiles}
              />
            </div>
            <div className="composer-draft-actions">
              <span role="status">
                {picking
                  ? 'Đang đọc tệp…'
                  : state === 'delivered'
                    ? 'Thư đã được chấp nhận'
                    : saveLabel}
              </span>
              {state !== 'delivered' && (
                <button
                  type="button"
                  className="composer-discard"
                  onClick={() => void discard()}
                  disabled={state === 'sending' || loadingFiles || closing}
                >
                  Bỏ bản nháp
                </button>
              )}
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
function draftSaveError(error: unknown): string {
  if (error instanceof MailApiError && error.status === 409)
    return 'Bản nháp đã thay đổi ở nơi khác. Chưa ghi đè phiên bản mới trên máy chủ.';
  if (error instanceof MailApiError && error.status === 401)
    return 'Phiên làm việc đã hết hạn; chưa thể lưu bản nháp lên máy chủ.';
  return 'Chưa thể lưu bản nháp lên máy chủ. Kiểm tra kết nối rồi thử lại.';
}
