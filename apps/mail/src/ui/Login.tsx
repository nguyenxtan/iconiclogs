import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';

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
    <main className="login-page">
      <section className="login-story" aria-label="ICONIC Logistics">
        <img
          className="port-image"
          src="/visuals/iconic-port-hero-v2.webp"
          alt="Tàu container và hoạt động tại cảng biển"
        />
        <div className="story-shade" />
      </section>
      <section className="login-panel">
        <div className="login-top">
          <a className="login-brand" href="https://iconiclogs.com" aria-label="Website ICONIC">
            <Logo />
            <span className="brand-mail-label">MAIL</span>
          </a>
          <a href="https://iconiclogs.com">
            Về website <Icon name="chevron" size={14} />
          </a>
        </div>
        <div className="login-form-wrap">
          <div className="login-emblem">
            <Icon name="mail" size={26} />
          </div>
          <span className="eyebrow">KHÔNG GIAN LÀM VIỆC</span>
          <h2>Đăng nhập ICONIC Mail</h2>
          <p className="login-intro">Sử dụng hộp thư công ty của bạn.</p>
          <form onSubmit={submit} className="login-form">
            <label htmlFor="email">Email công ty</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="tenban@iconiclogs.com"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
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
            {error && (
              <div className="notice error" role="alert">
                <Icon name="info" size={18} />
                <span>{error}</span>
              </div>
            )}
            <button className="button primary login-submit" disabled={busy} type="submit">
              {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
              <Icon name="chevron" size={18} />
            </button>
          </form>
          <p className="login-security">
            <Icon name="lock" size={14} /> Dành cho hộp thư nội bộ ICONIC
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
        <footer className="login-footer">
          <span>© {new Date().getFullYear()} ICONIC Logistics</span>
          <a href="https://iconiclogs.com">Website ICONIC</a>
        </footer>
      </section>
    </main>
  );
}
