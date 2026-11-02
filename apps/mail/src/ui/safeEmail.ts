import DOMPurify from 'dompurify';

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
    ALLOWED_ATTR: ['colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;color:#201d1a;font:14px/1.8 system-ui,sans-serif;overflow-wrap:anywhere}table{max-width:100%;border-collapse:collapse}td,th{padding:6px;border:1px solid #e3ded7}pre{white-space:pre-wrap}blockquote{margin:16px 0;padding-left:16px;border-left:2px solid #e3ded7;color:#665f58}a{color:inherit}h1,h2,h3{line-height:1.4}hr{border:0;border-top:1px solid #e3ded7}</style></head><body>${clean}</body></html>`;
}
