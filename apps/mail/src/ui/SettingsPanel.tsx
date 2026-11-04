import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MailFolder, MailPreferences, SessionInfo } from '../shared/contracts';
import { validEmail } from '../shared/email';
import { errorMessage, type MailApi } from './api';
import { BackupPanel } from './BackupPanel';
import { Icon } from './Icon';
import { SignatureEditor } from './SignatureEditor';
import { signatureSettingsInput } from '../shared/signature';
import './settings.css';

export interface SettingsPanelProps {
  api: MailApi;
  session: SessionInfo;
  preferences: MailPreferences;
  folders: MailFolder[];
  onSaved(value: MailPreferences): void;
  onClose(): void;
  onError(error: unknown): void;
}
const tabs = ['Hồ sơ & chữ ký', 'Danh bạ', 'Sao lưu'] as const;
export function SettingsPanel({
  api,
  session,
  preferences,
  folders,
  onSaved,
  onClose,
  onError,
}: SettingsPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState(0);
  const [value, setValue] = useState<MailPreferences>(() => structuredClone(preferences));
  const [saved, setSaved] = useState(() => JSON.stringify(preferences));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [discard, setDiscard] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const contactPending = editing !== null || !!contactName || !!contactEmail;
  const dirty = JSON.stringify(value) !== saved || contactPending;
  const close = () => {
    if (savingRef.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);
  useEffect(() => {
    if (discard) dialog.current?.querySelector<HTMLButtonElement>('[data-keep-editing]')?.focus();
  }, [discard]);
  function resetContact() {
    setContactName('');
    setContactEmail('');
    setEditing(null);
  }
  function contact(event: FormEvent) {
    event.preventDefault();
    const email = contactEmail.trim().toLowerCase(),
      name = contactName.trim();
    if (!validEmail(email) || name.length > 100 || /[\x00-\x1f\x7f-\x9f]/.test(name)) {
      setNotice({ error: true, text: 'Nhập email hợp lệ và tên không quá 100 ký tự.' });
      return;
    }
    if (
      value.contacts.some(
        (item, index) => index !== editing && item.address.toLowerCase() === email,
      )
    ) {
      setNotice({ error: true, text: 'Địa chỉ này đã có trong danh bạ.' });
      return;
    }
    if (editing === null && value.contacts.length >= 200) {
      setNotice({ error: true, text: 'Danh bạ tối đa 200 liên hệ.' });
      return;
    }
    setValue((previous) => ({
      ...previous,
      contacts:
        editing === null
          ? [...previous.contacts, { name, address: email }]
          : previous.contacts.map((item, index) =>
              index === editing ? { name, address: email } : item,
            ),
    }));
    resetContact();
    setNotice(null);
  }
  async function save() {
    if (savingRef.current) return;
    if (contactPending) {
      setTab(1);
      setNotice({
        error: true,
        text: 'Thêm hoặc cập nhật liên hệ đang nhập trước khi lưu cài đặt.',
      });
      return;
    }
    if (
      value.displayName.length > 100 ||
      /[\x00-\x1f\x7f-\x9f]/.test(value.displayName) ||
      value.signature.length > 4000
    ) {
      setTab(0);
      setNotice({ error: true, text: 'Tên hiển thị tối đa 100 ký tự, chữ ký tối đa 4.000 ký tự.' });
      return;
    }
    try {
      if (value.signatureSettings) signatureSettingsInput(value.signatureSettings);
    } catch {
      setTab(0);
      setNotice({ error: true, text: 'Chức danh tối đa 100 ký tự và không có ký tự điều khiển.' });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const result = await api.savePreferences(value, session.csrfToken);
      setValue(result);
      setSaved(JSON.stringify(result));
      onSaved(result);
      setNotice({ error: false, text: 'Đã lưu cài đặt cho tài khoản của bạn.' });
    } catch (error) {
      setNotice({ error: true, text: errorMessage(error) });
      onError(error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }
      }}
    >
      <div className="settings-layout">
        <header className="settings-heading">
          <div>
            <span className="eyebrow">KHÔNG GIAN CÁ NHÂN</span>
            <h2 id="settings-title">Cài đặt hộp thư</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Đóng cài đặt"
            onClick={close}
            disabled={saving}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-tabs" role="tablist" aria-label="Cài đặt hộp thư">
          {tabs.map((label, index) => (
            <button
              key={label}
              type="button"
              id={`settings-tab-${index}`}
              role="tab"
              aria-selected={tab === index}
              aria-controls={`settings-panel-${index}`}
              tabIndex={tab === index ? 0 : -1}
              onClick={() => setTab(index)}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) %
                          tabs.length;
                  setTab(next);
                  dialog.current
                    ?.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)
                    ?.focus();
                }
              }}
            >
              {label}
              {index === 1 && <span>{value.contacts.length}</span>}
            </button>
          ))}
        </div>
        <div className="settings-scroll">
          {discard && (
            <div className="settings-discard notice warning" role="alert">
              <div>
                <strong>Bạn có thay đổi chưa lưu.</strong>
                <p>Tiếp tục chỉnh sửa hoặc bỏ các thay đổi để đóng cài đặt.</p>
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button secondary"
                  data-keep-editing
                  onClick={() => setDiscard(false)}
                >
                  Tiếp tục chỉnh sửa
                </button>
                <button type="button" className="button danger" onClick={onClose}>
                  Bỏ thay đổi & đóng
                </button>
              </div>
            </div>
          )}
          <section
            id="settings-panel-0"
            role="tabpanel"
            aria-labelledby="settings-tab-0"
            hidden={tab !== 0}
            className="settings-section"
          >
            <div className="settings-section-heading">
              <h3>Danh tính trong mỗi lời nhắn</h3>
              <p>Tên và chữ ký của bạn sẽ được dùng khi soạn thư mới.</p>
            </div>
            <div className="settings-field">
              <label htmlFor="settings-email">Địa chỉ email</label>
              <input id="settings-email" value={session.email} readOnly />
              <small>Địa chỉ gửi luôn là tài khoản đang đăng nhập.</small>
            </div>
            <div className="settings-field">
              <label htmlFor="settings-name">Tên hiển thị</label>
              <input
                id="settings-name"
                value={value.displayName}
                maxLength={100}
                disabled={saving}
                autoComplete="name"
                placeholder="Họ và tên của bạn"
                onChange={(event) => {
                  setValue({ ...value, displayName: event.target.value });
                  setNotice(null);
                }}
              />
            </div>
            <SignatureEditor
              email={session.email}
              value={value}
              disabled={saving}
              onChange={(next) => {
                setValue(next);
                setNotice(null);
              }}
            />
          </section>
          <section
            id="settings-panel-1"
            role="tabpanel"
            aria-labelledby="settings-tab-1"
            hidden={tab !== 1}
            className="settings-section"
          >
            <div className="settings-section-heading">
              <h3>Những kết nối thường ngày</h3>
              <p>Lưu tối đa 200 liên hệ để chọn nhanh khi soạn thư.</p>
            </div>
            <form className="settings-contact-form" onSubmit={contact}>
              <h4>{editing === null ? 'Thêm liên hệ' : 'Chỉnh sửa liên hệ'}</h4>
              <div className="settings-contact-fields">
                <div className="settings-field">
                  <label htmlFor="contact-name">Tên</label>
                  <input
                    id="contact-name"
                    maxLength={100}
                    value={contactName}
                    disabled={saving}
                    onChange={(event) => setContactName(event.target.value)}
                    placeholder="Tên người liên hệ"
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="contact-email">Email</label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    maxLength={254}
                    value={contactEmail}
                    disabled={saving}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="lienhe@congty.com"
                  />
                </div>
              </div>
              <div className="settings-actions">
                <button
                  type="submit"
                  className="button secondary"
                  disabled={saving || (editing === null && value.contacts.length >= 200)}
                >
                  {editing === null ? 'Thêm vào danh bạ' : 'Cập nhật liên hệ'}
                </button>
                {contactPending && (
                  <button
                    type="button"
                    className="button subtle"
                    disabled={saving}
                    onClick={() => {
                      if (window.confirm('Bỏ thông tin liên hệ đang nhập?')) resetContact();
                    }}
                  >
                    Hủy nhập
                  </button>
                )}
              </div>
            </form>
            <ul className="settings-contacts">
              {value.contacts.map((item, index) => (
                <li key={item.address}>
                  <div className="settings-contact-avatar" aria-hidden="true">
                    {(item.name || item.address).slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <strong>{item.name || item.address}</strong>
                    <span>{item.address}</span>
                  </div>
                  <button
                    type="button"
                    className="button subtle"
                    disabled={saving || contactPending}
                    onClick={() => {
                      setEditing(index);
                      setContactName(item.name);
                      setContactEmail(item.address);
                      dialog.current?.querySelector<HTMLInputElement>('#contact-name')?.focus();
                    }}
                    aria-label={`Sửa ${item.name || item.address}`}
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={saving || contactPending}
                    onClick={() => {
                      if (window.confirm(`Xóa ${item.name || item.address} khỏi danh bạ?`))
                        setValue({
                          ...value,
                          contacts: value.contacts.filter((_, i) => i !== index),
                        });
                    }}
                    aria-label={`Xóa ${item.name || item.address}`}
                  >
                    <Icon name="close" size={17} />
                  </button>
                </li>
              ))}
            </ul>
            {!value.contacts.length && (
              <p className="settings-empty">
                Danh bạ của bạn đang trống. Thêm kết nối đầu tiên ở trên.
              </p>
            )}
          </section>
          <section
            id="settings-panel-2"
            role="tabpanel"
            aria-labelledby="settings-tab-2"
            hidden={tab !== 2}
            className="settings-section"
          >
            <BackupPanel api={api} session={session} folders={folders} onError={onError} />
          </section>
        </div>
        <footer className="settings-footer">
          {notice ? (
            <p
              role={notice.error ? 'alert' : 'status'}
              className={notice.error ? 'settings-error' : 'settings-saved'}
            >
              {notice.text}
            </p>
          ) : (
            <p>{dirty ? 'Có thay đổi chưa lưu' : 'Cài đặt riêng cho tài khoản của bạn'}</p>
          )}
          <button
            type="button"
            className="button primary"
            onClick={() => void save()}
            disabled={saving || !dirty}
          >
            {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
