import type { MailQuota } from './contracts';

export function quotaPressure(quota: MailQuota | null) {
  const valid = (value: { used: number; limit: number }) =>
    Number.isSafeInteger(value.used) &&
    Number.isSafeInteger(value.limit) &&
    value.used >= 0 &&
    value.limit > 0;
  if (!quota || !valid(quota)) return null;
  const roots = quota.roots;
  if (roots && (!roots.length || roots.length > 64 || roots.some((root) => !valid(root))))
    return null;
  return (roots ?? [quota]).reduce((highest, root) =>
    BigInt(root.used) * BigInt(highest.limit) > BigInt(highest.used) * BigInt(root.limit)
      ? root
      : highest,
  );
}

export const quotaLabel = (name: string) =>
  name === 'Mailbox'
    ? 'Hộp thư'
    : name === 'cPanel Account'
      ? 'Gói mail dùng chung'
      : 'Hạn mức Viettel';
