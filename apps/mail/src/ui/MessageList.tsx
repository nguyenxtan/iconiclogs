import type { Folder, MessagePage } from '../shared/contracts';
import { Icon } from './Icon';

export const folderLabel = (folder: Folder) => (folder === 'inbox' ? 'Hộp thư đến' : 'Đã gửi');
export function shortDate(date: string) {
  const value = new Date(date);
  return value.toDateString() === new Date().toDateString()
    ? value.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : value.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
export function MessageList({
  folder,
  data,
  page,
  busy,
  error,
  selected,
  onSelect,
  onPage,
  onRefresh,
}: {
  folder: Folder;
  data: MessagePage | null;
  page: number;
  busy: boolean;
  error: string;
  selected: string | null;
  onSelect(id: string): void;
  onPage(page: number): void;
  onRefresh(): void;
}) {
  return (
    <section className="message-list" aria-label="Danh sách thư" aria-busy={busy}>
      <header className="list-heading">
        <div>
          <h1>
            {folderLabel(folder)}
            <span className="list-total">{data?.total ?? '—'}</span>
          </h1>
        </div>
        <button
          className="icon-button"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Làm mới hộp thư"
        >
          <Icon name="refresh" />
        </button>
      </header>
      <div className="list-subheading">
        <span>{busy ? 'Đang cập nhật…' : `${data?.messages.length ?? 0} thư trên trang này`}</span>
        <span>Mới nhất trước</span>
      </div>
      <div className="message-items">
        {error ? (
          <div className="pane-state">
            <Icon name="info" size={28} />
            <h2>Chưa thể tải hộp thư</h2>
            <p>{error}</p>
            <button className="button secondary" onClick={onRefresh}>
              Thử lại
            </button>
          </div>
        ) : busy && !data ? (
          <div className="loading-list" aria-label="Đang tải thư">
            {[1, 2, 3, 4].map((item) => (
              <div className="skeleton-message" key={item}>
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        ) : data?.messages.length ? (
          data.messages.map((message) => {
            const person = folder === 'sent' ? message.to[0] : message.from;
            return (
              <button
                key={message.id}
                className={`message-row ${selected === message.id ? 'selected' : ''} ${message.unread ? 'unread' : ''}`}
                onClick={() => onSelect(message.id)}
                aria-current={selected === message.id ? 'true' : undefined}
              >
                <div className="row-top">
                  <span className="sender-name">
                    {message.unread && <i className="unread-dot" />}
                    {person?.name || person?.address || 'Không có người nhận'}
                  </span>
                  <time dateTime={message.date}>
                    {message.hasAttachments && <Icon name="attachment" size={13} />}
                    {shortDate(message.date)}
                  </time>
                </div>
                <span className="row-subject">{message.subject || '(Không có tiêu đề)'}</span>
              </button>
            );
          })
        ) : (
          <div className="pane-state">
            <span className="empty-icon">
              <Icon name={folder === 'inbox' ? 'inbox' : 'sent'} size={30} />
            </span>
            <h2>{folder === 'inbox' ? 'Chưa có thư' : 'Chưa có thư đã gửi'}</h2>
            <p>
              {folder === 'inbox'
                ? 'Thư mới sẽ xuất hiện tại đây.'
                : 'Các thư bạn gửi sẽ xuất hiện tại đây.'}
            </p>
          </div>
        )}
      </div>
      <footer className="pagination">
        <span>Trang {page}</span>
        <div>
          <button
            className="icon-button"
            disabled={page <= 1 || busy}
            onClick={() => onPage(page - 1)}
            aria-label="Trang trước"
          >
            <Icon name="chevron" style={{ transform: 'rotate(180deg)' }} size={18} />
          </button>
          <button
            className="icon-button"
            disabled={!data?.nextPage || busy}
            onClick={() => data?.nextPage && onPage(data.nextPage)}
            aria-label="Trang tiếp"
          >
            <Icon name="chevron" size={18} />
          </button>
        </div>
      </footer>
    </section>
  );
}
