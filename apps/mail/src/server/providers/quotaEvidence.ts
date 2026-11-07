// Temporary, bounded quota-only diagnostic. No general protocol log is retained.
export function quotaEvidenceLogger(password: string) {
  const lines: string[] = [];
  let truncated = false;
  const ignore = (..._args: unknown[]) => {};
  return {
    logger: {
      trace: ignore,
      info: ignore,
      warn: ignore,
      error: ignore,
      fatal: ignore,
      debug(entry: unknown) {
        if (!entry || typeof entry !== 'object') return;
        const value = entry as { src?: string; msg?: string };
        if (
          value.src !== 's' ||
          typeof value.msg !== 'string' ||
          !/^\* (?:QUOTA|QUOTAROOT) /i.test(value.msg)
        )
          return;
        if (lines.length >= 16 || value.msg.length > 2048 || /[\r\n]/.test(value.msg)) {
          truncated = true;
          return;
        }
        let safe = password ? value.msg.split(password).join('[redacted]') : value.msg;
        safe = safe.replace(/[^\s"<>]+@[^\s"<>]+/g, '[mailbox]');
        lines.push(safe);
      },
    },
    snapshot: () => ({ lines: [...lines], truncated }),
  };
}
