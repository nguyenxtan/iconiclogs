import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';
import './login.css';

type LoginHelp = 'support' | 'setup';
export function Login({
  busy,
  error,
  onLogin,
  onDemo,
}: {
  busy: boolean;
  error: string;
  onLogin(email: string, password: string): Promise<void>;
  onDemo?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [help, setHelp] = useState<LoginHelp | null>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const helpTitle = useRef<HTMLHeadingElement>(null);
  const helpTrigger = useRef<HTMLButtonElement | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (!help) return;
    const dialog = helpDialog.current;
    dialog?.showModal();
    helpTitle.current?.focus();
    return () => {
      dialog?.close();
      helpTrigger.current?.focus();
    };
  }, [help]);
  function openHelp(kind: LoginHelp, trigger: HTMLButtonElement) {
    helpTrigger.current = trigger;
    setHelp(kind);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || submitting.current) return;
    submitting.current = true;
    const secret = password;
    setPassword('');
    setShowPassword(false);
    try {
      await onLogin(email.trim(), secret);
    } finally {
      submitting.current = false;
    }
  }
  return (
    <div className="login-page">
      <div className="login-backdrop" aria-hidden="true">
        <img
          src="/visuals/login-port-sunset.webp"
          alt=""
          width="1586"
          height="992"
          fetchPriority="high"
        />
      </div>
      <main className="login-main">
        <div className="login-scene-copy" aria-hidden="true">
          <p>
            Kết nối hành trình.
            <br />
            Vững bước giao thương.
          </p>
        </div>
        <section className="login-card" aria-labelledby="login-title">
          <a
            className="login-brand"
            href="https://iconiclogs.com"
            aria-label="Website ICONIC Logistics"
          >
            <Logo markOnly />
            <span className="login-wordmark" aria-hidden="true">
              <img src="/brand/iconic-logo.png" alt="" width="500" height="500" />
            </span>
          </a>
          <h1 id="login-title">ICONIC Mail</h1>
          <p className="login-intro">Đăng nhập vào hộp thư công ty</p>
          <form
            onSubmit={submit}
            className="login-form"
            aria-busy={busy}
            aria-describedby={error ? 'login-error' : undefined}
          >
            <div className="login-field">
              <label htmlFor="email">Email công ty</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="tenban@iconiclogs.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">Mật khẩu</label>
              <div className="login-password">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={showPassword}
                  aria-controls="password"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={busy}
                >
                  <LoginGlyph name={showPassword ? 'eye-off' : 'eye'} />
                </button>
              </div>
            </div>
            {error && (
              <div className="notice error" id="login-error" role="alert">
                <Icon name="info" size={18} />
                <span>{error}</span>
              </div>
            )}
            <button className="button primary login-submit" disabled={busy} type="submit">
              {busy && <span className="spinner" aria-hidden="true" />}
              <span>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</span>
            </button>
          </form>
          <div className="login-help-links">
            <button type="button" onClick={(event) => openHelp('support', event.currentTarget)}>
              <LoginGlyph name="help" />
              <span>Hỗ trợ đăng nhập</span>
            </button>
            <span className="login-help-divider" aria-hidden="true" />
            <button type="button" onClick={(event) => openHelp('setup', event.currentTarget)}>
              <LoginGlyph name="book" />
              <span>Hướng dẫn cài đặt</span>
            </button>
          </div>
          <p className="login-copyright">© {new Date().getFullYear()} ICONIC Logistics</p>
          {onDemo && (
            <div className="login-demo-entry">
              <button type="button" onClick={onDemo} disabled={busy}>
                Xem bản mẫu <Icon name="chevron" size={14} />
              </button>
            </div>
          )}
        </section>
      </main>
      {help && (
        <dialog
          className="login-help-dialog"
          ref={helpDialog}
          aria-labelledby="login-help-title"
          aria-describedby="login-help-intro"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'),
            );
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === helpTitle.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onCancel={(event) => {
            event.preventDefault();
            setHelp(null);
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
                setHelp(null);
            }
          }}
        >
          <div className="login-help-heading">
            <h2 id="login-help-title" ref={helpTitle} tabIndex={-1}>
              {help === 'support' ? 'Hỗ trợ đăng nhập' : 'Hướng dẫn cài đặt'}
            </h2>
            <button
              type="button"
              className="login-help-close"
              aria-label={help === 'support' ? 'Đóng hỗ trợ đăng nhập' : 'Đóng hướng dẫn cài đặt'}
              onClick={() => setHelp(null)}
            >
              <Icon name="close" size={19} />
            </button>
          </div>
          {help === 'support' ? (
            <>
              <p id="login-help-intro">
                Dùng địa chỉ email công ty đầy đủ và mật khẩu hộp thư Viettel của bạn.
              </p>
              <ul>
                <li>Kiểm tra địa chỉ email, mật khẩu và phím Caps Lock.</li>
                <li>Nếu vừa đổi mật khẩu hộp thư, hãy dùng mật khẩu mới.</li>
                <li>
                  Quên mật khẩu hoặc chưa có tài khoản? Liên hệ người quản trị email của công ty để
                  được hỗ trợ.
                </li>
              </ul>
              <div className="login-help-contact">
                <span>Liên hệ ICONIC Logistics</span>
                <a href="tel:+84839037568">0839 037 568</a>
              </div>
            </>
          ) : (
            <>
              <p id="login-help-intro">
                Thêm hộp thư công ty vào Outlook, Apple Mail hoặc ứng dụng email bằng tài khoản
                IMAP.
              </p>
              <dl className="login-server-settings">
                <div>
                  <dt>Tên người dùng</dt>
                  <dd>Địa chỉ email công ty đầy đủ</dd>
                </div>
                <div>
                  <dt>Mật khẩu</dt>
                  <dd>Mật khẩu hộp thư Viettel</dd>
                </div>
                <div>
                  <dt>Máy chủ thư đến</dt>
                  <dd>
                    hl-mail29.viettelidc.com.vn
                    <br />
                    <span>IMAP · cổng 993 · SSL/TLS</span>
                  </dd>
                </div>
                <div>
                  <dt>Máy chủ thư đi</dt>
                  <dd>
                    hl-mail29.viettelidc.com.vn
                    <br />
                    <span>SMTP · cổng 465 · SSL/TLS</span>
                  </dd>
                </div>
              </dl>
              <details className="login-setup-client">
                <summary>Outlook</summary>
                <p>
                  Thêm tài khoản, chọn thiết lập thủ công và IMAP, rồi nhập thông số máy chủ ở trên.
                </p>
              </details>
              <details className="login-setup-client">
                <summary>Apple Mail trên Mac</summary>
                <p>
                  Trong Mail, chọn Thêm tài khoản → Tài khoản Mail khác. Chọn IMAP và nhập thông số
                  máy chủ ở trên.
                </p>
              </details>
              <details className="login-setup-client">
                <summary>iPhone / iPad</summary>
                <p>
                  Vào Cài đặt → Ứng dụng → Mail → Tài khoản Mail → Thêm tài khoản. Chọn tài khoản
                  khác, thêm tài khoản Mail và chọn IMAP.
                </p>
              </details>
              <p className="login-setup-note">
                Bật xác thực cho máy chủ thư đi và dùng cùng tài khoản, mật khẩu như thư đến.
              </p>
            </>
          )}
          <div className="login-help-footer">
            {help === 'setup' && (
              <button
                type="button"
                className="login-help-switch"
                onClick={() => setHelp('support')}
              >
                Cần hỗ trợ đăng nhập?
              </button>
            )}
            <button type="button" className="button primary" onClick={() => setHelp(null)}>
              Đã hiểu
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
function LoginGlyph({ name }: { name: 'eye' | 'eye-off' | 'help' | 'book' }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'eye' || name === 'eye-off' ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {name === 'eye-off' && <path d="m3 3 18 18" />}
        </>
      ) : name === 'help' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 .4c0 1.7-2.5 2-2.5 3.8M12 16h.01" />
        </>
      ) : (
        <>
          <path d="M12 5C9 3.5 5.5 3.5 2 5v15c3.5-1.5 7-1.5 10 0 3-1.5 6.5-1.5 10 0V5c-3.5-1.5-7-1.5-10 0ZM12 5v15" />
        </>
      )}
    </svg>
  );
}
