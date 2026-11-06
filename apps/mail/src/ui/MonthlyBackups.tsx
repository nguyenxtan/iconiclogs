import { useEffect, useRef, useState } from 'react';
import type { BackupMonth } from '../shared/backup';
import type { MailApi } from './api';
import { errorMessage } from './api';
import { formatSize } from './Reader';
import './monthly-backups.css';

export const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const updatedLabel = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));

interface Props {
  api: MailApi;
  csrf: string;
  revision: number;
  locked: boolean;
  selectedMonth: string;
  onSelect(month: string): void;
  onBusy(busy: boolean): void;
  onPacked(): void;
  onError(error: unknown): void;
}

/** Month packages are the primary backup view; message-level restore is a detail of a month. */
export function MonthlyBackups(props: Props) {
  const { api, csrf, revision, locked, selectedMonth } = props;
  const [months, setMonths] = useState<BackupMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState('');
  const [paused, setPaused] = useState(false);
  const [downloading, setDownloading] = useState('');
  const checkingDownload = useRef(false);
  const alive = useRef(true),
    working = useRef(false),
    pause = useRef(false),
    generation = useRef(0);
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    alive.current = true;
    const ticket = ++generation.current;
    setLoading(true);
    setError(null);
    void api
      .backupMonths()
      .then((value) => {
        if (alive.current && ticket === generation.current) setMonths(value);
      })
      .catch((reason) => {
        if (alive.current && ticket === generation.current) {
          setError(errorMessage(reason));
          callbacks.current.onError(reason);
        }
      })
      .finally(() => {
        if (alive.current && ticket === generation.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      pause.current = true;
    };
  }, [api, revision]);

  function update(value: BackupMonth) {
    if (alive.current)
      setMonths((previous) =>
        previous.map((month) => (month.month === value.month ? value : month)),
      );
  }
  async function pack(chosen: BackupMonth[]) {
    if (working.current || checkingDownload.current || locked) return;
    working.current = true;
    pause.current = false;
    ++generation.current;
    setLoading(false);
    setError(null);
    setPaused(false);
    callbacks.current.onBusy(true);
    let refreshCatalog = false;
    try {
      for (const item of chosen) {
        if (!alive.current || pause.current) break;
        setActive(item.month);
        let value =
          item.state === 'packing'
            ? await api.backupPackMonthStep(item.month, csrf)
            : await api.backupPackMonth(item.month, csrf);
        update(value);
        while (alive.current && !pause.current && value.state === 'packing') {
          value = await api.backupPackMonthStep(item.month, csrf);
          update(value);
        }
        if (value.state === 'error')
          throw Error(value.error || 'Gói tháng chưa hoàn tất. Hãy thử tiếp tục.');
      }
      if (alive.current) setPaused(pause.current);
      refreshCatalog = true;
    } catch (reason) {
      if (alive.current) {
        setError(errorMessage(reason));
        callbacks.current.onError(reason);
      }
    } finally {
      working.current = false;
      if (alive.current) {
        setActive('');
        callbacks.current.onBusy(false);
        if (refreshCatalog) callbacks.current.onPacked();
      }
    }
  }
  async function download(month: BackupMonth) {
    if (working.current || checkingDownload.current || locked || !month.archive) return;
    checkingDownload.current = true;
    setDownloading(month.month);
    setError(null);
    try {
      await api.checkBackupMonthDownload(month.month);
      if (!alive.current) return;
      window.location.assign(api.backupMonthDownloadUrl(month.month));
    } catch (reason) {
      if (alive.current) {
        setError(errorMessage(reason));
        callbacks.current.onError(reason);
      }
    } finally {
      checkingDownload.current = false;
      if (alive.current) setDownloading('');
    }
  }
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))].sort().reverse();
  const needsPacking = months.filter((month) => month.state !== 'ready');
  const busy = locked || !!active || !!downloading;
  return (
    <section className="backup-months" aria-labelledby="backup-months-title">
      <div className="backup-months-heading">
        <div>
          <h4 id="backup-months-title">Bản sao theo tháng</h4>
          <p>Mỗi hộp thư / năm / tháng có một gói ZIP, giữ thư gốc và tệp đính kèm.</p>
        </div>
        {!!needsPacking.length && (
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading}
            onClick={() => void pack(needsPacking)}
          >
            Nén các tháng đã sao lưu
          </button>
        )}
      </div>
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {loading ? (
        <p role="status">Đang đọc các tháng đã sao lưu…</p>
      ) : !months.length && !error ? (
        <p className="settings-empty">
          Chưa có gói tháng. Bắt đầu sao lưu để lưu thư vào kho riêng tư.
        </p>
      ) : null}
      {!!active && (
        <div className="backup-month-progress" role="status">
          <span>Đang nén tháng {monthLabel(active)}…</span>
          <button
            type="button"
            className="button subtle"
            onClick={() => {
              pause.current = true;
              setPaused(true);
            }}
            disabled={paused}
          >
            {paused ? 'Đang dừng sau bước này…' : 'Dừng sau bước này'}
          </button>
        </div>
      )}
      {paused && !active && !!needsPacking.length && (
        <p role="status">Đã tạm dừng. Các gói chưa xong có thể tiếp tục từ danh sách bên dưới.</p>
      )}
      {years.map((year) => (
        <section className="backup-year" aria-label={`Bản sao năm ${year}`} key={year}>
          <h5>{year}</h5>
          <div className="backup-month-grid">
            {months
              .filter((month) => month.month.startsWith(year + '-'))
              .sort((a, b) => b.month.localeCompare(a.month))
              .map((month) => {
                const label = monthLabel(month.month),
                  archive = month.archive;
                const action =
                  month.state === 'packing'
                    ? 'Tiếp tục nén'
                    : month.state === 'stale'
                      ? 'Cập nhật gói'
                      : month.state === 'error'
                        ? 'Thử nén lại'
                        : 'Nén';
                return (
                  <article
                    key={month.month}
                    className={`backup-month-card${selectedMonth === month.month ? ' selected' : ''}`}
                  >
                    <div className="backup-month-title">
                      <h6>{label}</h6>
                      <span className={`backup-badge${month.state === 'ready' ? ' active' : ''}`}>
                        {month.state === 'ready'
                          ? 'Đã nén'
                          : month.state === 'stale'
                            ? 'Có thư mới'
                            : month.state === 'packing'
                              ? 'Đang nén'
                              : month.state === 'error'
                                ? 'Cần thử lại'
                                : 'Chờ nén'}
                      </span>
                    </div>
                    <p>
                      {month.count.toLocaleString('vi-VN')} thư đã sao lưu ·{' '}
                      {formatSize(month.rawBytes)}
                    </p>
                    {archive ? (
                      <div className="backup-month-meta">
                        <strong>
                          Đã nén {archive.count.toLocaleString('vi-VN')} thư · ZIP{' '}
                          {formatSize(archive.zipBytes)}
                        </strong>
                        <span>Cập nhật {updatedLabel(archive.updatedAt)}</span>
                        {month.state !== 'ready' && (
                          <span>
                            Gói tải về hiện có {archive.count} thư. Cập nhật gói để lấy dữ liệu mới
                            nhất.
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="settings-help">Thư hiện có đang chờ gom thành gói ZIP.</p>
                    )}
                    {month.progress && month.state === 'packing' && (
                      <p role="status">
                        Tiến độ: {month.progress.processed.toLocaleString('vi-VN')} /{' '}
                        {month.progress.total.toLocaleString('vi-VN')} thư
                      </p>
                    )}
                    {month.error && <p className="settings-error">{month.error}</p>}
                    <div className="backup-month-actions">
                      {month.state !== 'ready' && (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          aria-label={`${action} tháng ${label}`}
                          onClick={() => void pack([month])}
                        >
                          {action}
                        </button>
                      )}
                      {archive && (
                        <a
                          className={`button secondary${busy ? ' disabled' : ''}`}
                          aria-disabled={busy || undefined}
                          tabIndex={busy ? -1 : 0}
                          href={busy ? undefined : api.backupMonthDownloadUrl(month.month)}
                          onClick={(event) => {
                            event.preventDefault();
                            void download(month);
                          }}
                          aria-label={`Tải ZIP tháng ${label}`}
                        >
                          {downloading === month.month ? 'Đang kiểm tra…' : 'Tải ZIP'}
                        </a>
                      )}
                      <button
                        type="button"
                        className="button subtle"
                        disabled={busy}
                        aria-label={`Xem tháng ${label}`}
                        aria-expanded={selectedMonth === month.month}
                        onClick={() => callbacks.current.onSelect(month.month)}
                      >
                        Xem / khôi phục
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      ))}
      {!!months.length && (
        <p className="settings-help">
          Tháng tính theo ngày nhận thư ở Việt Nam. Gói ZIP gồm các thư đã sao lưu; hãy kiểm tra
          trạng thái lượt sao lưu bên dưới để biết còn thư chưa lưu.
        </p>
      )}
    </section>
  );
}
