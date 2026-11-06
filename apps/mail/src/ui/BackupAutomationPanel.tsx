import { useEffect, useState } from 'react';
import type { BackupStatus } from '../shared/backup';
import { Icon } from './Icon';
import { formatSize } from './Reader';

const time = (value: number) =>
  new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(value);
const explanations = {
  pending: 'Đang chờ kiểm tra dung lượng từ Viettel.',
  below: 'Chưa đạt ngưỡng 80%. Hệ thống chờ và kiểm tra lại theo lịch.',
  above: 'Đã đạt ngưỡng 80%. Lượt sao lưu sẽ tiếp tục theo trạng thái bên dưới.',
  unavailable:
    'Chưa đọc được dung lượng hợp lệ từ Viettel; hệ thống không tự đoán và chưa khởi động lượt sao lưu mới.',
  error: 'Không kiểm tra được dung lượng. Hệ thống chưa khởi động lượt sao lưu mới.',
};

export function BackupAutomationPanel({
  status,
  operation,
  onConfigure,
}: {
  status: BackupStatus;
  operation: string;
  onConfigure(enabled: boolean): void;
}) {
  const [optIn, setOptIn] = useState(false);
  useEffect(() => {
    if (status.enabled) setOptIn(false);
  }, [status.enabled]);
  const monitor = status.automation;
  const quota = monitor?.quota;
  const percent = quota ? Math.floor((quota.used / quota.limit) * 1000) / 10 : null;
  return (
    <div className="backup-policy">
      <div className="backup-policy-label">
        <Icon name="lock" size={21} />
        <div>
          <h4>Sao lưu tự động · ngưỡng 80%</h4>
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
        Kiểm tra mỗi giờ. Chỉ tự bắt đầu sao lưu khi hộp thư dùng từ 80% dung lượng. Nếu vẫn trên
        ngưỡng, các lượt cập nhật cách nhau tối thiểu 24 giờ. Thư ở Viettel được giữ nguyên.
      </p>
      {status.enabled && !status.suspended && (
        <div className="backup-monitor" role="status">
          <p>{explanations[monitor?.state ?? 'pending']}</p>
          {quota && percent !== null && (
            <p>
              <strong>Dung lượng đã kiểm tra:</strong> {formatSize(quota.used)} /{' '}
              {formatSize(quota.limit)} · {percent.toLocaleString('vi-VN')}%
            </p>
          )}
          {monitor?.checkedAt && (
            <p>
              <strong>Kiểm tra gần nhất:</strong> {time(monitor.checkedAt)}
            </p>
          )}
          {status.nextRunAt && status.run?.state !== 'running' && (
            <p>
              <strong>Lần kiểm tra tiếp theo:</strong> {time(status.nextRunAt)}
            </p>
          )}
          {monitor?.state === 'above' &&
            monitor.nextBackupAt &&
            status.run?.state !== 'running' && (
              <p>
                <strong>Lượt cập nhật sớm nhất:</strong> {time(monitor.nextBackupAt)}
              </p>
            )}
        </div>
      )}
      <p>
        Để chạy khi bạn không đăng nhập, hệ thống giữ thông tin truy cập hộp thư dưới dạng mã hóa.
        Khi tắt, quyền truy cập đã lưu được thu hồi; các bản sao hiện có vẫn được giữ.
      </p>
      {status.suspended ? (
        <div className="backup-optin">
          <p>
            Mật khẩu hoặc quyền truy cập Viettel đã thay đổi. Sau khi đăng nhập bằng mật khẩu mới,
            cập nhật quyền sao lưu để tiếp tục.
          </p>
          <button
            type="button"
            className="button primary"
            disabled={!!operation}
            onClick={() => onConfigure(true)}
          >
            Cập nhật quyền sao lưu
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!!operation}
            onClick={() => onConfigure(false)}
          >
            Tắt sao lưu tự động
          </button>
        </div>
      ) : status.enabled ? (
        <button
          type="button"
          className="button secondary"
          disabled={!!operation}
          onClick={() => onConfigure(false)}
        >
          {operation === 'configure' ? 'Đang cập nhật…' : 'Tắt sao lưu tự động'}
        </button>
      ) : optIn ? (
        <div className="backup-optin">
          <p>
            Bạn đồng ý lưu quyền truy cập đã mã hóa để kiểm tra dung lượng và tự động sao lưu khi
            đạt 80%?
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="button primary"
              disabled={!!operation}
              onClick={() => onConfigure(true)}
            >
              Bật sao lưu tự động
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
          Thiết lập sao lưu tự động
        </button>
      )}
    </div>
  );
}
