import { useEffect, useMemo, useRef, useState } from 'react';
import type { BackupItem, BackupStatus } from '../shared/backup';
import type { Folder, MailFolder, SessionInfo } from '../shared/contracts';
import { errorMessage, type MailApi } from './api';
import {
  backupDateRange,
  filterBackupItems,
  freezeRestore,
  nextRestoreAttempt,
  readRestoreJournal,
  mergeRestoreJournal,
  updateRestoreAttempt,
  restoreFailure,
  restoreLockedIds,
  type RestoreBatch,
} from './backupState';
import { Icon } from './Icon';
import { MonthlyBackups, monthLabel } from './MonthlyBackups';

export interface BackupPanelProps {
  api: MailApi;
  session: SessionInfo;
  folders: MailFolder[];
  onError(error: unknown): void;
}
const formatDate = (value: string | number | undefined) =>
  value !== undefined && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(value))
    : '—';
const runLabels = {
  running: 'Đang sao lưu',
  complete: 'Hoàn tất',
  partial: 'Hoàn tất một phần',
  error: 'Bị gián đoạn',
};
export function BackupPanel({ api, session, folders, onError }: BackupPanelProps) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [catalog, setCatalog] = useState<BackupItem[] | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [archiveRevision, setArchiveRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState('');
  const busy = useRef(false),
    alive = useRef(true),
    pause = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(false);
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<Folder | ''>(folders[0]?.id ?? '');
  const [confirmation, setConfirmation] = useState<RestoreBatch | null>(null);
  const storageKey = `iconic-mail-restore-v1:${session.email.toLowerCase()}`;
  const initial = useRef<{ journal: RestoreBatch[]; blocked: boolean } | null>(null);
  if (!initial.current) {
    try {
      initial.current = {
        journal: readRestoreJournal(sessionStorage.getItem(storageKey)),
        blocked: false,
      };
    } catch {
      initial.current = { journal: [], blocked: true };
    }
  }
  const [journal, setJournal] = useState<RestoreBatch[]>(initial.current.journal);
  const journalRef = useRef(journal);
  const [storageBlocked, setStorageBlocked] = useState(initial.current.blocked);
  const visible = useMemo(() => filterBackupItems(catalog ?? [], from, to), [catalog, from, to]);
  const rangeError = backupDateRange(from, to);
  const attempted = restoreLockedIds(journal);
  const itemErrors = new Map(
    journal.flatMap((batch) => batch.items).map((item) => [item.id, item]),
  );
  const batch = journal.at(-1);
  const pending = !!batch && !!nextRestoreAttempt(batch);
  const locked = !!operation || !!confirmation || pending;
  const selectable = visible.filter((item) => !attempted.has(item.id));
  const report = (error: unknown) => {
    if (alive.current) setNotice(errorMessage(error));
    onError(error);
  };
  function persist(next: RestoreBatch[]): boolean {
    try {
      const merged = mergeRestoreJournal(
        readRestoreJournal(sessionStorage.getItem(storageKey), false),
        next,
      );
      sessionStorage.setItem(storageKey, JSON.stringify(merged));
      journalRef.current = merged;
      if (alive.current) setJournal(merged);
      return true;
    } catch {
      if (alive.current) {
        setStorageBlocked(true);
        setNotice(
          'Không thể lưu sổ theo dõi khôi phục trong tab này. Đã khóa khôi phục để tránh tạo thư trùng lặp.',
        );
      }
      return false;
    }
  }
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setOperation('refresh');
    setNotice(null);
    const results = await Promise.allSettled([
      api.backupStatus(),
      selectedMonth ? api.backupCatalog(selectedMonth) : Promise.resolve(null),
    ] as const);
    if (alive.current) {
      if (results[0].status === 'fulfilled') setStatus(results[0].value);
      else {
        setStatus(null);
        report(results[0].reason);
      }
      if (results[1].status === 'fulfilled') {
        setCatalog(results[1].value);
        setCatalogError(null);
      } else {
        setCatalog(null);
        setCatalogError(errorMessage(results[1].reason));
        onError(results[1].reason);
      }
      setOperation('');
      setLoading(false);
      setArchiveRevision((value) => value + 1);
    }
    busy.current = false;
  }
  useEffect(() => {
    alive.current = true;
    if (!initial.current?.blocked) persist(journalRef.current);
    void refresh();
    return () => {
      alive.current = false;
      pause.current = true;
    };
  }, [api, session.email]);
  async function openMonth(month: string) {
    if (busy.current) return;
    busy.current = true;
    setOperation('catalog');
    setSelectedMonth(month);
    setCatalog(null);
    setCatalogError(null);
    setSelected(new Set());
    setFrom('');
    setTo('');
    try {
      const items = await api.backupCatalog(month);
      if (alive.current) setCatalog(items);
    } catch (error) {
      if (alive.current) setCatalogError(errorMessage(error));
      onError(error);
    } finally {
      busy.current = false;
      if (alive.current) setOperation('');
    }
  }
  async function configure(enabled: boolean) {
    if (busy.current) return;
    busy.current = true;
    setOperation('configure');
    setNotice(null);
    try {
      const result = await api.backupConfigure(enabled, session.csrfToken);
      if (alive.current) {
        setStatus(result);
        setOptIn(false);
      }
    } catch (error) {
      report(error);
    } finally {
      busy.current = false;
      if (alive.current) setOperation('');
    }
  }
  async function capture(resume: boolean) {
    if (busy.current) return;
    busy.current = true;
    pause.current = false;
    setOperation('capture');
    setNotice(null);
    try {
      let result = resume
        ? await api.backupStep(session.csrfToken)
        : await api.backupStart(session.csrfToken);
      if (alive.current) setStatus(result);
      while (alive.current && !pause.current && result.run?.state === 'running') {
        result = await api.backupStep(session.csrfToken);
        if (alive.current) setStatus(result);
      }
      if (alive.current) {
        setArchiveRevision((value) => value + 1);
      }
      if (alive.current && selectedMonth) {
        const items = await api.backupCatalog(selectedMonth);
        if (alive.current) {
          setCatalog(items);
          setCatalogError(null);
        }
      }
    } catch (error) {
      report(error);
    } finally {
      busy.current = false;
      if (alive.current) setOperation('');
    }
  }
  async function restore(prepared: RestoreBatch, resume = false) {
    if (busy.current || storageBlocked) return;
    let index = journalRef.current.length - 1;
    if (!resume) {
      const next = [...journalRef.current, prepared];
      if (!persist(next)) return;
      index = next.length - 1;
    }
    busy.current = true;
    setOperation('restore');
    setConfirmation(null);
    setSelected(new Set());
    setNotice(null);
    pause.current = false;
    try {
      while (alive.current && !pause.current) {
        const current = journalRef.current[index];
        if (!current) break;
        const next = nextRestoreAttempt(current);
        if (!next) break;
        const sending = journalRef.current.map((entry, i) =>
          i === index ? updateRestoreAttempt(entry, next.id, 'sending') : entry,
        );
        if (!persist(sending)) break;
        try {
          const result = await api.backupRestore(
            next.id,
            current.target,
            next.requestId,
            session.csrfToken,
          );
          const updated = journalRef.current.map((entry, i) =>
            i === index
              ? updateRestoreAttempt(
                  entry,
                  next.id,
                  result.state,
                  result.state === 'uncertain'
                    ? 'Chưa xác định kết quả. Đã khóa gửi lại; hãy kiểm tra thư mục đích.'
                    : undefined,
                )
              : entry,
          );
          if (!persist(updated)) break;
          if (result.state === 'uncertain') {
            if (alive.current)
              setNotice(
                'Một thư có kết quả khôi phục chưa xác định. Đã dừng nhóm và khóa gửi lại thư đó; hãy kiểm tra thư mục đích trước khi tiếp tục.',
              );
            break;
          }
        } catch (error) {
          const failure = restoreFailure(error);
          persist(
            journalRef.current.map((entry, i) =>
              i === index
                ? updateRestoreAttempt(entry, next.id, failure.state, failure.error)
                : entry,
            ),
          );
          report(error);
          break;
        }
      }
    } finally {
      busy.current = false;
      if (alive.current) setOperation('');
    }
  }
  async function download(item: BackupItem) {
    try {
      const blob = await api.backupDownload(item.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mail-${item.id.slice(0, 16)}.eml`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      report(error);
    }
  }
  const restored = journal
    .flatMap((entry) => entry.items)
    .filter((item) => item.state === 'restored').length;
  const failed = [...itemErrors.values()].filter((item) => item.state === 'failed').length;
  const sending = journal
    .flatMap((entry) => entry.items)
    .filter((item) => item.state === 'sending').length;
  const uncertain = journal
    .flatMap((entry) => entry.items)
    .filter((item) => item.state === 'uncertain').length;
  return (
    <div className="backup-panel">
      <div className="settings-section-heading backup-title">
        <div>
          <h3>Giữ một bản sao an toàn</h3>
          <p>Gói ZIP theo năm và tháng, riêng tư và được mã hóa khi lưu trên cloud.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Cập nhật trạng thái sao lưu"
          onClick={() => void refresh()}
          disabled={!!operation}
        >
          <Icon name="refresh" size={19} />
        </button>
      </div>
      {notice && (
        <div className="notice error" role="alert">
          <Icon name="info" size={18} />
          <span>{notice}</span>
        </div>
      )}
      {status?.run && status.run.state !== 'complete' && (
        <p className="notice warning" role="status">
          {status.run.state === 'running' ? 'Lượt sao lưu đang chạy' : 'Lượt sao lưu chưa hoàn tất'}
          . Gói tháng chỉ gồm các thư đã lưu.
        </p>
      )}
      {!loading && status && (
        <MonthlyBackups
          api={api}
          csrf={session.csrfToken}
          revision={archiveRevision}
          locked={locked}
          selectedMonth={selectedMonth}
          onSelect={(month) => void openMonth(month)}
          onBusy={(value) => {
            busy.current = value;
            setOperation(value ? 'pack' : '');
          }}
          onPacked={() => {
            if (selectedMonth) void openMonth(selectedMonth);
          }}
          onError={onError}
        />
      )}
      {loading ? (
        <p className="settings-empty" role="status">
          Đang đọc trạng thái sao lưu…
        </p>
      ) : !status ? (
        <div className="notice warning">
          <Icon name="info" size={18} />
          <span>
            Chưa đọc được trạng thái sao lưu. Tính năng có thể chưa khả dụng; hãy cập nhật trạng
            thái trước khi thao tác.
          </span>
        </div>
      ) : (
        <>
          <div className="backup-policy">
            <div className="backup-policy-label">
              <Icon name="lock" size={21} />
              <div>
                <h4>Sao lưu hằng ngày</h4>
                <p>
                  {status.suspended
                    ? 'Tạm dừng · cần cập nhật quyền truy cập'
                    : status.enabled
                      ? 'Đã bật cho tài khoản này'
                      : 'Chưa bật · chỉ chạy khi bạn yêu cầu'}
                </p>
              </div>
              <span className={`backup-badge ${status.enabled ? 'active' : ''}`}>
                {status.suspended ? 'Tạm dừng' : status.enabled ? 'Đang bật' : 'Thủ công'}
              </span>
            </div>
            <p>
              Để chạy khi bạn không đăng nhập, hệ thống giữ thông tin truy cập hộp thư dưới dạng mã
              hóa. Khi tắt, quyền truy cập đã lưu được thu hồi; các bản sao hiện có vẫn được giữ.
            </p>
            {status.nextRunAt && status.enabled && (
              <p>
                <strong>Lượt dự kiến tiếp theo:</strong> {formatDate(status.nextRunAt)}
              </p>
            )}
            {status.suspended && (
              <div className="backup-optin">
                <p>
                  Mật khẩu hoặc quyền truy cập Viettel đã thay đổi. Sau khi đăng nhập bằng mật khẩu
                  mới, cập nhật quyền sao lưu để tiếp tục.
                </p>
                <button
                  type="button"
                  className="button primary"
                  disabled={!!operation}
                  onClick={() => void configure(true)}
                >
                  Cập nhật quyền sao lưu
                </button>
              </div>
            )}
            {status.enabled ? (
              <button
                type="button"
                className="button secondary"
                disabled={!!operation}
                onClick={() => void configure(false)}
              >
                {operation === 'configure' ? 'Đang cập nhật…' : 'Tắt sao lưu hằng ngày'}
              </button>
            ) : optIn ? (
              <div className="backup-optin">
                <p>Bạn đồng ý lưu quyền truy cập đã mã hóa để tự động sao lưu hộp thư mỗi ngày?</p>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={!!operation}
                    onClick={() => void configure(true)}
                  >
                    Bật sao lưu hằng ngày
                  </button>
                  <button
                    type="button"
                    className="button subtle"
                    disabled={!!operation}
                    onClick={() => setOptIn(false)}
                  >
                    Để sau
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="button secondary"
                disabled={!!operation}
                onClick={() => setOptIn(true)}
              >
                Thiết lập sao lưu hằng ngày
              </button>
            )}
          </div>
          <div className="backup-run">
            <div className="backup-run-heading">
              <h4>Lượt sao lưu gần nhất</h4>
              <span className={`backup-badge ${status.run?.state === 'complete' ? 'active' : ''}`}>
                {status.run ? runLabels[status.run.state] : 'Chưa có lượt sao lưu'}
              </span>
            </div>
            {status.run && (
              <>
                <dl className="backup-stats">
                  <div>
                    <dt>Thư đã lưu</dt>
                    <dd>{status.run.captured.toLocaleString('vi-VN')}</dd>
                  </div>
                  <div>
                    <dt>Bắt đầu</dt>
                    <dd>{formatDate(status.run.startedAt)}</dd>
                  </div>
                  <div>
                    <dt>Kết thúc</dt>
                    <dd>{formatDate(status.run.finishedAt)}</dd>
                  </div>
                </dl>
                {status.run.errors.length > 0 && (
                  <div className="notice warning" role="status">
                    <div>
                      <strong>Cần kiểm tra {status.run.errors.length} vấn đề</strong>
                      <ul>
                        {status.run.errors.map((message, index) => (
                          <li key={index}>{message}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="settings-actions">
              <button
                type="button"
                className="button primary"
                disabled={!!operation}
                onClick={() =>
                  void capture(status.run?.state === 'running' || status.run?.state === 'error')
                }
              >
                {operation === 'capture'
                  ? 'Đang sao lưu…'
                  : status.run?.state === 'running' || status.run?.state === 'error'
                    ? 'Tiếp tục lượt sao lưu'
                    : 'Sao lưu ngay'}
              </button>
              {status.run?.state === 'error' && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!operation}
                  onClick={() => void capture(false)}
                >
                  Bắt đầu lượt mới
                </button>
              )}
              {operation === 'capture' && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    pause.current = true;
                  }}
                >
                  Dừng sau bước này
                </button>
              )}
            </div>
            <p className="settings-help">
              Bạn có thể đóng cài đặt. Lượt đang chạy giữ tiến độ; mở lại để tiếp tục các bước còn
              lại.
            </p>
          </div>
        </>
      )}
      {selectedMonth && (
        <div className="backup-catalog-heading backup-month-detail">
          <div>
            <h4>Thư trong tháng {monthLabel(selectedMonth)}</h4>
            <p>
              {catalog
                ? `${catalog.length.toLocaleString('vi-VN')} thư đã sao lưu. Có thể chọn cả tháng hoặc từng thư để khôi phục.`
                : operation === 'catalog'
                  ? 'Đang đọc thư trong tháng…'
                  : 'Danh mục chưa khả dụng'}
            </p>
          </div>
        </div>
      )}
      {catalogError && (
        <div className="notice warning" role="alert">
          {catalogError}
        </div>
      )}
      {storageBlocked && (
        <div className="notice warning" role="alert">
          Không thể đọc hoặc lưu sổ khôi phục trong tab này. Khôi phục đang khóa để tránh tạo bản
          trùng lặp.
        </div>
      )}
      {!!journal.length && (
        <div
          className={`notice ${uncertain || failed ? 'warning' : sending ? '' : 'success'}`}
          role="status"
        >
          <div>
            <strong>
              {restored} thư đã khôi phục{sending ? ` · ${sending} thư đang khôi phục` : ''}
              {uncertain ? ` · ${uncertain} thư chưa xác định` : ''}
              {failed ? ` · ${failed} thư chưa ghi` : ''}
            </strong>
            <p>
              {sending
                ? 'Đang thêm thư vào thư mục đích. Vui lòng chờ kết quả khôi phục.'
                : uncertain
                  ? 'Các thư chưa xác định đã bị khóa gửi lại. Kiểm tra thư mục đích với quản trị viên.'
                  : failed
                    ? 'Các thư chưa ghi có thể được chọn lại để thử khôi phục sau khi bạn xác nhận.'
                    : 'Thư được thêm vào thư mục đích; thư đang có vẫn được giữ.'}
            </p>
            {pending && (
              <>
                <p>
                  Nhóm hiện tại còn {batch!.items.filter((item) => item.state === 'pending').length}{' '}
                  thư chưa gửi đến{' '}
                  {folders.find((folder) => folder.id === batch!.target)?.name ?? batch!.target}.
                </p>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!operation || storageBlocked}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Tiếp tục khôi phục ${batch!.items.filter((item) => item.state === 'pending').length} thư chưa gửi? Các thư chưa xác định sẽ không được gửi lại.`,
                      )
                    )
                      void restore(batch!, true);
                  }}
                >
                  Tiếp tục các thư chưa gửi
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {catalog && (
        <>
          <div className="backup-date-fields">
            <div className="settings-field">
              <label htmlFor="backup-from">Từ ngày nhận</label>
              <input
                id="backup-from"
                type="date"
                value={from}
                disabled={locked}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setSelected(new Set());
                }}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="backup-to">Đến hết ngày</label>
              <input
                id="backup-to"
                type="date"
                value={to}
                disabled={locked}
                onChange={(event) => {
                  setTo(event.target.value);
                  setSelected(new Set());
                }}
              />
            </div>
          </div>
          <p className="settings-help">
            Theo ngày thư được nhận tại Việt Nam (UTC+7), gồm cả hai ngày đầu và cuối.
          </p>
          {rangeError && (
            <p className="settings-error" role="alert">
              {rangeError}
            </p>
          )}
          <div className="backup-selection">
            <label>
              <input
                type="checkbox"
                disabled={locked || !selectable.length || storageBlocked}
                checked={!!selectable.length && selectable.every((item) => selected.has(item.id))}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? new Set(selectable.map((item) => item.id)) : new Set(),
                  )
                }
              />{' '}
              Chọn {selectable.length.toLocaleString('vi-VN')} thư trong khoảng ngày
            </label>
            <span>{selected.size} đã chọn</span>
          </div>
          <ul className="backup-items">
            {visible.map((item) => (
              <li key={item.id}>
                <input
                  type="checkbox"
                  aria-label={`Chọn ${item.subject || '(Không có tiêu đề)'}`}
                  checked={selected.has(item.id)}
                  disabled={locked || attempted.has(item.id) || storageBlocked}
                  onChange={(event) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                />
                <div>
                  <strong>{item.subject || '(Không có tiêu đề)'}</strong>
                  <span>{item.from || 'Không có thông tin người gửi'}</span>
                  <small>
                    {formatDate(item.internalDate)}
                    <span aria-hidden="true"> · </span>
                    {item.folder}
                    {itemErrors.get(item.id)?.state === 'sending'
                      ? ' · Đang khôi phục'
                      : attempted.has(item.id)
                        ? ' · Đã xử lý trong tab này'
                        : ''}
                    {itemErrors.get(item.id)?.state === 'failed'
                      ? ' · Chưa ghi thư, có thể chọn để thử lại'
                      : ''}
                  </small>
                  {itemErrors.get(item.id)?.error && (
                    <small role="status">{itemErrors.get(item.id)!.error}</small>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Tải bản gốc ${item.subject || 'thư'} (.eml)`}
                  onClick={() => void download(item)}
                >
                  <Icon name="download" size={18} />
                </button>
              </li>
            ))}
          </ul>
          {!visible.length && (
            <p className="settings-empty">
              {catalog.length
                ? 'Không có thư trong khoảng ngày này.'
                : 'Chưa có bản sao thư. Bắt đầu một lượt sao lưu ở trên.'}
            </p>
          )}
          <div className="backup-restore-target settings-field">
            <label htmlFor="backup-target">Khôi phục vào thư mục đang có</label>
            <select
              id="backup-target"
              value={target}
              disabled={locked || !folders.length || storageBlocked}
              onChange={(event) => setTarget(event.target.value as Folder)}
            >
              <option value="" disabled>
                Chọn thư mục đích
              </option>
              {folders.map((folder) => (
                <option value={folder.id} key={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            {!folders.length && (
              <small>
                Chưa đọc được danh sách thư mục. Mở lại cài đặt sau khi tải lại hộp thư.
              </small>
            )}
          </div>
          {confirmation ? (
            <div className="backup-confirm" role="group" aria-labelledby="restore-confirm-title">
              <h4 id="restore-confirm-title">
                Thêm {confirmation.items.length.toLocaleString('vi-VN')} thư vào{' '}
                {folders.find((folder) => folder.id === confirmation.target)?.name ??
                  confirmation.target}
                ?
              </h4>
              <p>
                Giữ nguyên thư đang có. Lựa chọn và thư mục đích đã được cố định cho lượt này. Thư
                có kết quả chưa xác định sẽ không tự động gửi lại.
              </p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={!!operation}
                  onClick={() => void restore(confirmation)}
                >
                  Xác nhận khôi phục {confirmation.items.length} thư
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!operation}
                  onClick={() => setConfirmation(null)}
                >
                  Quay lại
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="button secondary"
              disabled={
                locked ||
                !selected.size ||
                !target ||
                !folders.some((folder) => folder.id === target) ||
                !!rangeError ||
                storageBlocked
              }
              onClick={() => setConfirmation(freezeRestore(catalog, selected, target as Folder))}
            >
              Khôi phục {selected.size ? `${selected.size} thư đã chọn` : 'thư đã chọn'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
