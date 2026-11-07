import type { MailQuota } from '../shared/contracts';
import { quotaLabel } from '../shared/quota';

const mib = (bytes: number) =>
  (bytes / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: 1, useGrouping: false });

export function QuotaReadings({
  quota,
  progress = false,
}: {
  quota: MailQuota;
  progress?: boolean;
}) {
  const roots = [
    ...(quota.roots ?? [{ name: 'Mailbox', used: quota.used, limit: quota.limit }]),
  ].sort((a, b) => Number(b.name === 'Mailbox') - Number(a.name === 'Mailbox'));
  return (
    <>
      {roots.map((root) => {
        const label = quotaLabel(root.name);
        const percent = Math.floor((root.used / root.limit) * 1000) / 10;
        return (
          <div className="quota-reading" key={root.name}>
            <span>
              {label}: {mib(root.used)} MiB / {mib(root.limit)} MiB ·{' '}
              {percent.toLocaleString('vi-VN')}%
            </span>
            {progress && (
              <progress
                aria-label={`Dung lượng ${label.toLocaleLowerCase('vi-VN')}`}
                value={root.used}
                max={root.limit}
              />
            )}
            {progress && percent >= 80 && <strong>{label} gần đầy</strong>}
          </div>
        );
      })}
    </>
  );
}
