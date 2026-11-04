import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';
import './login.css';

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
  async function submit(event: FormEvent) {
    event.preventDefault();
    const secret = password;
    setPassword('');
    await onLogin(email.trim(), secret);
  }
  return (
    <div className="login-page">
      <header className="login-header">
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
        <a className="login-site-link" href="https://iconiclogs.com" aria-label="Về website ICONIC">
          <span>Về website</span>
          <Icon name="chevron" size={16} />
        </a>
      </header>
      <main className="login-main">
        <div className="login-card">
          <section className="login-form-panel" aria-labelledby="login-title">
            <div className="login-content">
              <p className="login-eyebrow">ICONIC MAIL</p>
              <h1 id="login-title">Đăng nhập</h1>
              <p className="login-intro">Truy cập hộp thư công ty của bạn.</p>
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
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Nhập mật khẩu của bạn"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                  />
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
                  {!busy && <Icon name="chevron" size={18} />}
                </button>
              </form>
              <p className="login-security">
                <Icon name="lock" size={14} /> Dành cho nhân sự ICONIC Logistics
              </p>
              {onDemo && (
                <div className="demo-entry">
                  <span>Khám phá giao diện trước khi đăng nhập</span>
                  <button onClick={onDemo} disabled={busy}>
                    Xem bản mẫu <Icon name="chevron" size={14} />
                  </button>
                </div>
              )}
            </div>
          </section>
          <aside className="login-visual" aria-label="ICONIC Logistics">
            <img
              src="/visuals/login-port.webp"
              alt="Minh họa tàu container và hoạt động tại cảng biển"
              width="720"
              height="900"
              fetchPriority="high"
            />
            <div className="login-visual-copy">
              <p>ICONIC LOGISTICS VIỆT NAM</p>
              <h2>
                Kết nối hành trình.
                <br />
                Vững bước giao thương.
              </h2>
            </div>
          </aside>
        </div>
      </main>
      <footer className="login-footer">
        <span>© {new Date().getFullYear()} ICONIC Logistics</span>
      </footer>
    </div>
  );
}
