import DOMPurify from 'dompurify';

// Presentation only: finite values used by our signature/quote, never arbitrary sender CSS.
const inkColors = new Set([
  '#801c18',
  '#4b5963',
  '#52606a',
  '#263238',
  '#879199',
  '#42515c',
  '#52616c',
]);
const paperColors = new Set(['#fff', '#ffffff', '#f6f8f9', '#f4f6f7']);
function pixels(value: string, min: number, max: number): boolean {
  if (value === '0') return min === 0;
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
  return !!match && Number(match[1]) >= min && Number(match[1]) <= max;
}
function spacing(value: string): boolean {
  const parts = value.split(/\s+/);
  return parts.length >= 1 && parts.length <= 4 && parts.every((part) => pixels(part, 0, 32));
}
function safePresentationStyle(style: string): string {
  if (style.length > 2048) return '';
  return style
    .split(';')
    .flatMap((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator < 0) return [];
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration
        .slice(separator + 1)
        .trim()
        .toLowerCase();
      // Reject CSS functions, escaped tokens, comments, imports, priorities and control bytes.
      if (!/^[a-z-]+$/.test(property) || /[\\()@/!<>"'\x00-\x1f\x7f]/.test(value)) return [];
      let safe = false;
      if (property === 'color') safe = inkColors.has(value);
      else if (property === 'background' || property === 'background-color')
        safe = paperColors.has(value);
      else if (property === 'font-family')
        safe = ['arial,helvetica,sans-serif', 'system-ui,sans-serif'].includes(
          value.replace(/\s/g, ''),
        );
      else if (property === 'font-size') safe = pixels(value, 10, 32);
      else if (property === 'font-weight')
        safe = ['400', '500', '600', '700', 'normal', 'bold'].includes(value);
      else if (property === 'line-height')
        safe =
          pixels(value, 14, 48) ||
          (/^\d(?:\.\d+)?$/.test(value) && Number(value) >= 1 && Number(value) <= 2.5);
      else if (property === 'letter-spacing') safe = pixels(value, 0, 2);
      else if (property === 'padding' || property === 'margin') safe = spacing(value);
      else if (
        ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].includes(property)
      )
        safe = pixels(value, 0, 32);
      else if (property === 'width') safe = value === '100%';
      else if (property === 'max-width') safe = pixels(value, 100, 700) || value === '100%';
      else if (property === 'border-collapse') safe = value === 'collapse';
      else if (property === 'text-align') safe = ['left', 'center', 'right'].includes(value);
      else if (property === 'text-decoration') safe = value === 'none';
      else if (property === 'white-space')
        safe = ['normal', 'pre-wrap', 'pre-line'].includes(value);
      else if (property === 'word-break') safe = ['normal', 'break-word'].includes(value);
      else if (property === 'overflow-wrap') safe = ['anywhere', 'break-word'].includes(value);
      else if (property === 'border-left') {
        const match = /^(\d+(?:\.\d+)?)px solid (#[a-f0-9]{6})$/.exec(value);
        safe =
          !!match &&
          Number(match[1]) >= 1 &&
          Number(match[1]) <= 4 &&
          ['#801c18', '#d2dce2'].includes(match[2]!);
      }
      return safe ? [`${property}:${value}`] : [];
    })
    .join(';');
}

/** Mail content never enters the parent DOM; resources and navigation stay disabled. */
export function safeEmailDocument(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'div',
      'span',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'a',
    ],
    ALLOWED_ATTR: ['colspan', 'rowspan', 'style', 'role'],
    RETURN_DOM_FRAGMENT: true,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  for (const element of clean.querySelectorAll('[style]')) {
    const style = safePresentationStyle(element.getAttribute('style') || '');
    if (style) element.setAttribute('style', style);
    else element.removeAttribute('style');
  }
  for (const element of clean.querySelectorAll('[role]')) {
    if (
      element.tagName !== 'TABLE' ||
      element.getAttribute('role')?.trim().toLowerCase() !== 'presentation'
    )
      element.removeAttribute('role');
    else element.setAttribute('role', 'presentation');
  }
  const container = document.createElement('div');
  container.appendChild(clean);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;color:#201d1a;font:14px/1.8 system-ui,sans-serif;overflow-wrap:anywhere}table{max-width:100%;border-collapse:collapse}td,th{padding:6px;border:1px solid #e3ded7}table[role="presentation"]>tbody>tr>td,table[role="presentation"]>thead>tr>th,table[role="presentation"]>tfoot>tr>td{padding:0;border:0}pre{white-space:pre-wrap}blockquote{margin:16px 0;padding-left:16px;border-left:2px solid #e3ded7;color:#665f58}a{color:inherit}h1,h2,h3{line-height:1.4}hr{border:0;border-top:1px solid #e3ded7}</style></head><body>${container.innerHTML}</body></html>`;
}
