import { useState } from 'react';
import type {
  Folder,
  MailFolder,
  MessageAction,
  MessageFilter,
  MessagePage,
} from '../shared/contracts';
import { Icon } from './Icon';
export const folderLabel = (folder: Folder) =>
  (
    ({
      inbox: 'Hộp thư đến',
      sent: 'Đã gửi',
      drafts: 'Nháp Viettel',
      trash: 'Thùng rác',
      junk: 'Thư rác',
      archive: 'Lưu trữ',
    }) as Record<string, string>
  )[folder] || (folder.startsWith('folder:') ? decodeURIComponent(folder.slice(7)) : folder);
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
  filter = {},
  onFilter,
  checked = [],
  onCheck,
  onAction,
  folders = [],
  actionBusy = false,
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
  filter?: MessageFilter;
  onFilter?(filter: MessageFilter): void;
  checked?: string[];
  onCheck?(ids: string[]): void;
  onAction?(action: MessageAction): void;
  folders?: MailFolder[];
  actionBusy?: boolean;
}) {
  const [query, setQuery] = useState(filter.query ?? '');
  const [advanced, setAdvanced] = useState(false);
  const visibleIds = data?.messages.map((message) => message.id) ?? [];
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
      {onFilter && (
        <div className="mail-search">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onFilter({ ...filter, query: query.trim() || undefined });
            }}
          >
            <label className="search-field">
              <Icon name="search" size={16} />
              <input
                aria-label="Tìm thư"
                placeholder="Tìm trong thư mục này…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="button secondary" type="submit">
              Tìm
            </button>
          </form>
          <div className="quick-filters">
            <select
              aria-label="Lọc thư"
              value={
                filter.unread
                  ? 'unread'
                  : filter.starred
                    ? 'starred'
                    : filter.attachments
                      ? 'attachments'
                      : 'all'
              }
              onChange={(event) =>
                onFilter({
                  ...filter,
                  unread: event.target.value === 'unread' || undefined,
                  starred: event.target.value === 'starred' || undefined,
                  attachments: event.target.value === 'attachments' || undefined,
                })
              }
            >
              <option value="all">Tất cả thư</option>
              <option value="unread">Chưa đọc</option>
              <option value="starred">Có gắn sao</option>
              <option value="attachments">Có đính kèm</option>
            </select>
            <button
              className="button subtle"
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
            >
              Bộ lọc
            </button>
          </div>
          {advanced && (
            <div className="advanced-filters">
              <label>
                Người gửi
                <input
                  value={filter.from ?? ''}
                  onChange={(event) =>
                    onFilter({ ...filter, from: event.target.value || undefined })
                  }
                />
              </label>
              <label>
                Từ ngày
                <input
                  type="date"
                  value={filter.after ?? ''}
                  onChange={(event) =>
                    onFilter({ ...filter, after: event.target.value || undefined })
                  }
                />
              </label>
              <label>
                Trước ngày
                <input
                  type="date"
                  value={filter.before ?? ''}
                  onChange={(event) =>
                    onFilter({ ...filter, before: event.target.value || undefined })
                  }
                />
              </label>
              <button
                className="button subtle"
                onClick={() => {
                  setQuery('');
                  onFilter({});
                }}
              >
                Xóa bộ lọc
              </button>
            </div>
          )}
        </div>
      )}
      <div className="list-subheading">
        <label className="select-page">
          {onCheck && (
            <input
              type="checkbox"
              aria-label="Chọn tất cả thư trên trang"
              checked={!!visibleIds.length && visibleIds.every((id) => checked.includes(id))}
              disabled={!visibleIds.length || busy || actionBusy}
              onChange={(event) => onCheck(event.target.checked ? visibleIds : [])}
            />
          )}
          <span>{busy ? 'Đang cập nhật…' : `${data?.messages.length ?? 0} thư trên trang`}</span>
        </label>
        <span>Mới nhất</span>
      </div>
      {!!checked.length && onAction && (
        <div className="bulk-toolbar" aria-label="Thao tác thư đã chọn">
          <strong>{checked.length} đã chọn</strong>
          <select
            aria-label="Thao tác với thư đã chọn"
            value=""
            disabled={actionBusy}
            onChange={(event) => {
              if (event.target.value)
                onAction({ ids: checked, action: event.target.value as MessageAction['action'] });
            }}
          >
            <option value="">Đánh dấu…</option>
            <option value="read">Đã đọc</option>
            <option value="unread">Chưa đọc</option>
            <option value="star">Gắn sao</option>
            <option value="unstar">Bỏ sao</option>
          </select>
          <select
            aria-label="Chuyển thư đã chọn tới"
            value=""
            disabled={actionBusy}
            onChange={(event) => {
              if (event.target.value)
                onAction({
                  ids: checked,
                  action: 'move',
                  destination: event.target.value as Folder,
                });
            }}
          >
            <option value="">Chuyển tới…</option>
            {[
              ...folders,
              ...(!folders.some((f) => f.id === 'archive')
                ? [{ id: 'archive' as const, name: 'Lưu trữ' }]
                : []),
              ...(!folders.some((f) => f.id === 'trash')
                ? [{ id: 'trash' as const, name: 'Thùng rác' }]
                : []),
            ]
              .filter((f) => f.id !== folder)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </div>
      )}
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
            {[1, 2, 3, 4].map((i) => (
              <div className="skeleton-message" key={i}>
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
              <div
                key={message.id}
                className={`mail-row ${selected === message.id ? 'selected' : ''} ${message.unread ? 'unread' : ''}`}
              >
                {onCheck && (
                  <input
                    className="row-checkbox"
                    type="checkbox"
                    checked={checked.includes(message.id)}
                    disabled={actionBusy}
                    aria-label={`Chọn thư ${message.subject}`}
                    onChange={(event) =>
                      onCheck(
                        event.target.checked
                          ? [...checked, message.id]
                          : checked.filter((id) => id !== message.id),
                      )
                    }
                  />
                )}
                <button
                  className="message-row"
                  onClick={() => onSelect(message.id)}
                  aria-current={selected === message.id ? 'true' : undefined}
                >
                  <span className="row-top">
                    <span className="sender-name">
                      {message.unread && <i className="unread-dot" />}
                      {person?.name || person?.address || 'Không có người nhận'}
                    </span>
                    <time dateTime={message.date}>
                      {message.hasAttachments && <Icon name="attachment" size={13} />}{' '}
                      {shortDate(message.date)}
                    </time>
                  </span>
                  <span className="row-subject">{message.subject || '(Không có tiêu đề)'}</span>
                </button>
                {onAction && (
                  <button
                    className={`icon-button row-star ${message.starred ? 'is-starred' : ''}`}
                    aria-label={`${message.starred ? 'Bỏ sao' : 'Gắn sao'} thư ${message.subject}`}
                    aria-pressed={!!message.starred}
                    disabled={actionBusy}
                    onClick={() =>
                      onAction({ ids: [message.id], action: message.starred ? 'unstar' : 'star' })
                    }
                  >
                    <Icon name="star" size={16} />
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <div className="pane-state">
            <span className="empty-icon">
              <Icon name="inbox" size={30} />
            </span>
            <h2>Không có thư</h2>
            <p>
              {Object.values(filter).some(Boolean)
                ? 'Thử đổi từ khóa hoặc bộ lọc.'
                : 'Thư trong thư mục này sẽ xuất hiện tại đây.'}
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
