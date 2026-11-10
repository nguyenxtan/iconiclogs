import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Folder,
  MailMessage,
  MessagePage,
  SessionInfo,
  MailFolder,
  MessageFilter,
  MessageAction,
  MailQuota,
  MailPreferences,
  DraftSummary,
  SavedDraft,
} from '../shared/contracts';
import { errorMessage, liveApi, MailApiError, type MailApi } from './api';
import { Composer } from './Composer';
import { createDemoApi } from './demo';
import { Icon } from './Icon';
import { Login } from './Login';
import { Logo } from './Logo';
import { folderLabel, MessageList } from './MessageList';
import { Reader } from './Reader';
import { SettingsPanel } from './SettingsPanel';
import { QuotaReadings } from './QuotaReadings';
import './mail-features.css';

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
  const [composer, setComposer] = useState<{
    reply: MailMessage | null;
    mode?: 'reply' | 'replyAll' | 'forward';
    saved?: SavedDraft;
  } | null>(null);
  const [folders, setFolders] = useState<MailFolder[]>([
    { id: 'inbox', name: 'Hộp thư đến', role: 'inbox' },
    { id: 'sent', name: 'Đã gửi', role: 'sent' },
  ]);
  const [filter, setFilter] = useState<MessageFilter>({});
  const [checked, setChecked] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [preferences, setPreferences] = useState<MailPreferences>({
    displayName: '',
    signature: '',
    contacts: [],
  });
  const [quota, setQuota] = useState<MailQuota | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftView, setDraftView] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setDrafts([]);
    setSettingsOpen(false);
    setDraftView(false);
    setFilter({});
    setChecked([]);
    setQuota(null);
    setPreferences({ displayName: '', signature: '', contacts: [] });
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
    if (!session || draftView) return;
    let active = true;
    setListBusy(true);
    setListError('');
    api
      .messages(folder, page, filter)
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
  }, [api, session, folder, page, refresh, checkExpired, filter, draftView]);
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
  const refreshDrafts = useCallback(async () => {
    if (!session) return;
    try {
      setDrafts(await api.drafts());
    } catch (error) {
      if (!checkExpired(error)) setNotification(errorMessage(error));
    }
  }, [api, session, checkExpired]);
  const refreshFolders = useCallback(async () => {
    if (!session) return;
    try {
      setFolders(await api.folders());
    } catch (error) {
      if (!checkExpired(error)) setNotification(errorMessage(error));
    }
  }, [api, session, checkExpired]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const load = async () => {
      const results = await Promise.allSettled([
        api.folders(),
        api.preferences(),
        api.drafts(),
        api.quota(),
      ]);
      if (!active) return;
      const [folderResult, prefsResult, draftsResult, quotaResult] = results;
      if (folderResult.status === 'fulfilled') setFolders(folderResult.value);
      if (prefsResult.status === 'fulfilled') setPreferences(prefsResult.value);
      if (draftsResult.status === 'fulfilled') setDrafts(draftsResult.value);
      if (quotaResult.status === 'fulfilled') setQuota(quotaResult.value);
      for (const result of results)
        if (result.status === 'rejected' && checkExpired(result.reason)) return;
      if (prefsResult.status === 'rejected' || draftsResult.status === 'rejected')
        setNotification('Chưa tải được cài đặt hoặc bản nháp. Hãy kết nối lại rồi tải lại trang.');
    };
    void load();
    return () => {
      active = false;
    };
  }, [api, session, checkExpired]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setRefresh((value) => value + 1);
        void refreshFolders();
      }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [session, refreshFolders]);
  async function act(action: MessageAction) {
    if (!session || actionBusy) return;
    setActionBusy(true);
    try {
      await api.action(folder, action, session.csrfToken);
      setChecked([]);
      if (action.action === 'move') {
        setSelected(null);
        setMessage(null);
      } else if (message && action.ids.includes(message.id)) {
        setMessage({
          ...message,
          ...(action.action === 'read'
            ? { unread: false }
            : action.action === 'unread'
              ? { unread: true }
              : action.action === 'star'
                ? { starred: true }
                : { starred: false }),
        });
      }
      setRefresh((value) => value + 1);
      void refreshFolders();
    } catch (error) {
      if (!checkExpired(error)) setNotification(errorMessage(error));
    } finally {
      setActionBusy(false);
    }
  }
  async function openDraft(id: string) {
    setDraftBusy(true);
    try {
      setComposer({ reply: null, saved: await api.draft(id) });
    } catch (error) {
      if (!checkExpired(error)) setNotification(errorMessage(error));
    } finally {
      setDraftBusy(false);
    }
  }
  async function createFolder() {
    if (!session) return;
    const name = window.prompt('Tên thư mục mới');
    if (!name?.trim()) return;
    try {
      await api.createFolder(name.trim(), session.csrfToken);
      await refreshFolders();
    } catch (error) {
      if (!checkExpired(error)) setNotification(errorMessage(error));
    }
  }
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
    setDraftView(false);
    setFilter({});
    setChecked([]);
    if (next === folder) {
      setRefresh((value) => value + 1);
      return;
    }
    setFolder(next);
    setPage(1);
    setData(null);
    setSelected(null);
    setMessage(null);
    setNotification('');
  }
  function changePage(next: number) {
    setChecked([]);
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
          {folders.map((item) => (
            <button
              className={`folder-button ${!draftView && folder === item.id ? 'active' : ''}`}
              key={item.id}
              onClick={() => changeFolder(item.id)}
              aria-current={!draftView && folder === item.id ? 'page' : undefined}
              aria-label={item.role ? folderLabel(item.id) : item.name}
              title={item.role ? folderLabel(item.id) : item.name}
            >
              <Icon
                name={
                  item.role === 'inbox'
                    ? 'inbox'
                    : item.role === 'sent'
                      ? 'sent'
                      : item.role === 'trash'
                        ? 'trash'
                        : item.role === 'archive'
                          ? 'archive'
                          : 'folder'
                }
                size={19}
              />
              <span>{item.role ? folderLabel(item.id) : item.name}</span>
              {!!item.unread && <span className="folder-count">{item.unread}</span>}
            </button>
          ))}
          <button
            className={`folder-button ${draftView ? 'active' : ''}`}
            onClick={() => {
              setDraftView(true);
              setSelected(null);
              void refreshDrafts();
            }}
            title="Bản nháp"
            aria-label="Bản nháp"
          >
            <Icon name="draft" size={19} />
            <span>Bản nháp</span>
            {!!drafts.length && <span className="folder-count">{drafts.length}</span>}
          </button>
          <button
            className="folder-button"
            onClick={() => void createFolder()}
            title="Tạo thư mục"
            aria-label="Tạo thư mục"
          >
            <Icon name="plus" size={19} />
            <span>Tạo thư mục</span>
          </button>
          <button
            className="folder-button"
            onClick={() => setSettingsOpen(true)}
            title="Cài đặt và sao lưu"
            aria-label="Cài đặt và sao lưu"
          >
            <Icon name="settings" size={19} />
            <span>Cài đặt & sao lưu</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          {quota && quota.limit > 0 && (
            <div className="mail-quota">
              <QuotaReadings quota={quota} progress />
            </div>
          )}
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
            Mail <span className="breadcrumb-slash">/</span>{' '}
            <strong>{draftView ? 'Bản nháp' : folderLabel(folder)}</strong>
          </span>
          <div>
            <span className="connection-dot" />
            {demo ? 'Không gian bản mẫu' : session.email}
          </div>
        </header>
        <div className="mobile-mail-navigation">
          <select
            aria-label="Thư mục hiện tại"
            value={draftView ? 'personal-drafts' : folder}
            onChange={(event) => {
              if (event.target.value === 'personal-drafts') {
                setDraftView(true);
                setSelected(null);
                void refreshDrafts();
              } else changeFolder(event.target.value as Folder);
            }}
          >
            {folders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.role ? folderLabel(item.id) : item.name}
              </option>
            ))}
            <option value="personal-drafts">Bản nháp ({drafts.length})</option>
          </select>
          <button
            className="icon-button"
            aria-label="Cài đặt và sao lưu"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </button>
        </div>
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
        {draftView ? (
          <section className="personal-drafts" aria-label="Bản nháp">
            <header>
              <div>
                <h1>
                  Bản nháp <span>{drafts.length}</span>
                </h1>
                <p>Được tự lưu trong ICONIC Mail, mở lại sau khi đăng nhập.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => void refreshDrafts()}
                aria-label="Làm mới bản nháp"
              >
                <Icon name="refresh" />
              </button>
            </header>
            {draftBusy && <p role="status">Đang mở bản nháp…</p>}
            {drafts.length ? (
              drafts.map((draft) => (
                <button
                  className="draft-card"
                  key={draft.id}
                  onClick={() => void openDraft(draft.id)}
                  disabled={draftBusy}
                >
                  <Icon name="draft" />
                  <span>
                    <strong>{draft.subject || '(Chưa có tiêu đề)'}</strong>
                    <small>{draft.to.join(', ') || 'Chưa có người nhận'}</small>
                  </span>
                  <time>{new Date(draft.updatedAt).toLocaleString('vi-VN')}</time>
                  <Icon name="chevron" size={16} />
                </button>
              ))
            ) : (
              <div className="pane-state">
                <Icon name="draft" size={32} />
                <h2>Chưa có bản nháp</h2>
                <p>Nội dung đang soạn sẽ được tự lưu tại đây.</p>
              </div>
            )}
          </section>
        ) : (
          <div className="workspace-panes">
            <MessageList
              key={folder}
              filter={filter}
              onFilter={(value) => {
                setFilter(value);
                setPage(1);
                setChecked([]);
                setData(null);
              }}
              checked={checked}
              onCheck={setChecked}
              onAction={(action) => void act(action)}
              folders={folders}
              actionBusy={actionBusy}
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
              onReply={(reply) => setComposer({ reply, mode: 'reply' })}
              onReplyAll={(reply) => setComposer({ reply, mode: 'replyAll' })}
              onForward={(reply) => setComposer({ reply, mode: 'forward' })}
              onAction={(action) => void act(action)}
              actionBusy={actionBusy}
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
        )}
      </div>
      <button
        className="mobile-compose button primary"
        onClick={() => setComposer({ reply: null })}
        aria-label="Soạn thư"
      >
        <Icon name="plus" size={24} />
      </button>
      {settingsOpen && (
        <SettingsPanel
          api={api}
          session={session}
          preferences={preferences}
          folders={folders}
          onSaved={setPreferences}
          onClose={() => setSettingsOpen(false)}
          onError={(error) => {
            if (!checkExpired(error)) setNotification(errorMessage(error));
          }}
        />
      )}
      {composer && (
        <Composer
          key={composer.saved?.id ?? `${composer.reply?.id ?? 'new'}:${composer.mode ?? 'new'}`}
          mode={composer.mode}
          saved={composer.saved}
          sourceFolder={folder}
          preferences={preferences}
          onDraftChanged={() => void refreshDrafts()}
          session={session}
          api={api}
          demo={demo}
          reply={composer.reply}
          onClose={() => {
            setComposer(null);
            void refreshDrafts();
          }}
          onSent={() => {
            setRefresh((value) => value + 1);
            void refreshDrafts();
            void refreshFolders();
          }}
          onExpired={expire}
        />
      )}
    </main>
  );
}
