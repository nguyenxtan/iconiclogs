import { useCallback, useEffect, useRef, useState } from 'react';
import type { Folder, MailMessage, MessagePage, SessionInfo } from '../shared/contracts';
import { errorMessage, liveApi, MailApiError, type MailApi } from './api';
import { Composer } from './Composer';
import { createDemoApi } from './demo';
import { Icon } from './Icon';
import { Login } from './Login';
import { Logo } from './Logo';
import { folderLabel, MessageList } from './MessageList';
import { Reader } from './Reader';

export function App() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('iconic.mail.sidebar.collapsed') === 'true';
    } catch {
      return false;
    }
  });
  function toggleSidebar() {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem('iconic.mail.sidebar.collapsed', String(next));
      } catch {
        /* Preference storage is optional. */
      }
      return next;
    });
  }
  const [api, setApi] = useState<MailApi>(liveApi);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [demo, setDemo] = useState(false);
  const [booting, setBooting] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [folder, setFolder] = useState<Folder>('inbox');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MessagePage | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [readerBusy, setReaderBusy] = useState(false);
  const [readerError, setReaderError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [readRefresh, setReadRefresh] = useState(0);
  const [composer, setComposer] = useState<{ reply: MailMessage | null } | null>(null);
  const [notification, setNotification] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutPending = useRef(false);
  const clearSession = useCallback((reason: string) => {
    setSession(null);
    setData(null);
    setMessage(null);
    setSelected(null);
    setComposer(null);
    setNotification('');
    setLoginError(reason);
    setApi(liveApi);
    setDemo(false);
    setFolder('inbox');
    setPage(1);
    setListError('');
    setReaderError('');
    setListBusy(false);
    setReaderBusy(false);
  }, []);
  const expire = useCallback(
    () => clearSession('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.'),
    [clearSession],
  );
  const checkExpired = useCallback(
    (error: unknown) => {
      if (error instanceof MailApiError && error.status === 401) {
        expire();
        return true;
      }
      return false;
    },
    [expire],
  );
  useEffect(() => {
    let active = true;
    liveApi
      .session()
      .then((value) => {
        if (active) setSession(value);
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof MailApiError && error.status === 401))
          setLoginError(errorMessage(error));
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timeout = window.setTimeout(expire, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [session, expire]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setListBusy(true);
    setListError('');
    api
      .messages(folder, page)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error: unknown) => {
        if (active && !checkExpired(error)) setListError(errorMessage(error));
      })
      .finally(() => {
        if (active) setListBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, session, folder, page, refresh, checkExpired]);
  useEffect(() => {
    if (!session || !selected) {
      setReaderBusy(false);
      setReaderError('');
      return;
    }
    let active = true;
    setReaderBusy(true);
    setReaderError('');
    setMessage(null);
    api
      .message(folder, selected)
      .then((value) => {
        if (active) {
          setMessage(value);
          setData(
            (current) =>
              current && {
                ...current,
                messages: current.messages.map((item) =>
                  item.id === selected ? { ...item, unread: false } : item,
                ),
              },
          );
        }
      })
      .catch((error: unknown) => {
        if (active && !checkExpired(error)) setReaderError(errorMessage(error));
      })
      .finally(() => {
        if (active) setReaderBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, session, folder, selected, readRefresh, checkExpired]);
  async function login(email: string, password: string) {
    setLoginBusy(true);
    setLoginError('');
    try {
      setSession(await liveApi.login(email, password));
    } catch (error) {
      setLoginError(errorMessage(error));
    } finally {
      setLoginBusy(false);
    }
  }
  async function enterDemo() {
    const preview = createDemoApi();
    setApi(preview);
    setDemo(true);
    setSession(await preview.session());
    setLoginError('');
  }
  async function logout() {
    if (!session || logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    let failure = '';
    try {
      await api.logout(session.csrfToken);
    } catch {
      failure =
        'Đã xóa dữ liệu trong tab, nhưng chưa thể xác nhận kết thúc phiên trên máy chủ. Hãy kết nối lại và đăng xuất để thu hồi phiên.';
    } finally {
      clearSession(failure);
      setLoggingOut(false);
      logoutPending.current = false;
    }
  }
  function changeFolder(next: Folder) {
    if (next === folder) return;
    setFolder(next);
    setPage(1);
    setData(null);
    setSelected(null);
    setMessage(null);
    setNotification('');
  }
  function changePage(next: number) {
    setPage(next);
    setData(null);
    setSelected(null);
    setMessage(null);
  }
  if (booting)
    return (
      <main className="boot-screen">
        <Logo />
        <span className="spinner" />
        <p>Đang mở không gian làm việc…</p>
      </main>
    );
  if (!session)
    return (
      <Login
        busy={loginBusy}
        error={loginError}
        onLogin={login}
        onDemo={import.meta.env.DEV ? enterDemo : undefined}
      />
    );
  return (
    <main
      className={`mail-shell ${selected ? 'has-selection' : ''} ${demo ? 'is-demo' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}
    >
      {demo && (
        <div className="demo-banner">
          <Icon name="info" size={15} />
          <span>
            <strong>Bản mẫu giao diện.</strong> Dữ liệu minh họa, không kết nối hộp thư thật. Gửi
            thư chỉ là mô phỏng.
          </span>
          <button onClick={logout}>Thoát bản mẫu</button>
        </div>
      )}
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <a className="sidebar-logo" href="https://iconiclogs.com" aria-label="Website ICONIC">
            <Logo />
            <Logo markOnly />
          </a>
          <button
            className="icon-button sidebar-toggle"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-controls="mail-folder-navigation"
            aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
            title={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} size={17} />
          </button>
        </div>
        <div className="mail-product-label">
          <span /> WORKSPACE / MAIL
        </div>
        <button
          className="button primary compose-button"
          aria-label="Soạn thư"
          title="Soạn thư"
          onClick={() => setComposer({ reply: null })}
        >
          <Icon name="plus" size={20} />
          <span>Soạn thư</span>
        </button>
        <div className="sidebar-section-title">HỘP THƯ CỦA BẠN</div>
        <nav id="mail-folder-navigation" aria-label="Thư mục">
          {(['inbox', 'sent'] as const).map((item) => (
            <button
              className={`folder-button ${folder === item ? 'active' : ''}`}
              key={item}
              onClick={() => changeFolder(item)}
              aria-current={folder === item ? 'page' : undefined}
              aria-label={folderLabel(item)}
              title={folderLabel(item)}
            >
              <Icon name={item} size={19} />
              <span>{folderLabel(item)}</span>
              {folder === item && data && <span className="folder-count">{data.total}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="decorative-line" />
            <p>
              Kết nối bằng
              <br />
              <em>sự tận tâm.</em>
            </p>
          </div>
          <div className="account">
            <span className="account-avatar">{session.email.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>Hộp thư ICONIC</strong>
              <span title={session.email}>{session.email}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Đăng xuất"
              title="Đăng xuất"
              onClick={logout}
              disabled={loggingOut}
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="mobile-header">
        <a className="mobile-brand" href="https://iconiclogs.com" aria-label="Website ICONIC">
          <Logo />
          <span className="brand-mail-label">MAIL</span>
        </a>
        <button
          className="icon-button"
          aria-label="Đăng xuất"
          onClick={logout}
          disabled={loggingOut}
        >
          <Icon name="logout" size={18} />
        </button>
      </div>
      <div className="workspace">
        <header className="workspace-header">
          <span>
            Mail <span className="breadcrumb-slash">/</span> <strong>{folderLabel(folder)}</strong>
          </span>
          <div>
            <span className="connection-dot" />
            {demo ? 'Không gian bản mẫu' : session.email}
          </div>
        </header>
        {notification && (
          <div className="notice error workspace-notice" role="alert">
            <span>{notification}</span>
            <button
              className="icon-button"
              onClick={() => setNotification('')}
              aria-label="Đóng thông báo"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        <div className="workspace-panes">
          <MessageList
            folder={folder}
            data={data}
            page={page}
            busy={listBusy}
            error={listError}
            selected={selected}
            onSelect={setSelected}
            onPage={changePage}
            onRefresh={() => setRefresh((value) => value + 1)}
          />
          <Reader
            message={message}
            busy={readerBusy}
            error={readerError}
            folder={folder}
            api={api}
            onReply={(reply) => setComposer({ reply })}
            onBack={() => {
              setSelected(null);
              setMessage(null);
            }}
            onError={(error) => {
              if (!checkExpired(error)) setNotification(errorMessage(error));
            }}
            onRetry={() => setReadRefresh((value) => value + 1)}
          />
        </div>
        <footer className="workspace-footer">
          <span>ICONIC LOGISTICS</span>
          <span>Mỗi thông điệp, một kết nối.</span>
        </footer>
      </div>
      <button
        className="mobile-compose button primary"
        onClick={() => setComposer({ reply: null })}
        aria-label="Soạn thư"
      >
        <Icon name="plus" size={24} />
      </button>
      {composer && (
        <Composer
          session={session}
          api={api}
          demo={demo}
          reply={composer.reply}
          onClose={() => setComposer(null)}
          onSent={() => setRefresh((value) => value + 1)}
          onExpired={expire}
        />
      )}
    </main>
  );
}
