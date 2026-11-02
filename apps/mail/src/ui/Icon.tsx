import type { CSSProperties } from 'react';
const paths = {
  collapse: 'M3 4h18v16H3V4Zm6 0v16m8-12-4 4 4 4',
  expand: 'M3 4h18v16H3V4Zm6 0v16m4-12 4 4-4 4',
  inbox: 'M4 4h16l2 10v6H2v-6L4 4Zm-2 10h6l2 3h4l2-3h6',
  sent: 'm22 2-7 20-4-9-9-4L22 2Zm0 0L11 13',
  compose:
    'M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 3l5 5M9 15l1-5L20 0l5 5L15 15H9Z',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M19 12H5m7-7-7 7 7 7',
  chevron: 'm9 5 7 7-7 7',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2',
  close: 'm6 6 12 12M6 18 18 6',
  attachment: 'm21 11-8 8a6 6 0 0 1-8-8L15 1a4 4 0 0 1 6 6L11 17a2 2 0 0 1-3-3l8-8',
  logout: 'M9 4H4v16h5M10 12h12m-5-5 5 5-5 5',
  lock: 'M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4M12 14v3',
  mail: 'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  check: 'm5 12 4 4L19 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  reply: 'm9 4-7 7 7 7M2 11h12a8 8 0 0 1 8 8',
  info: 'M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
} as const;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
