// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { safeEmailDocument } from '../safeEmail';

function attachForStyleCheck(doc: Document) {
  const stylesheet = document.createElement('style');
  stylesheet.textContent = doc.head.querySelector('style')?.textContent ?? '';
  const host = document.createElement('div');
  host.innerHTML = doc.body.innerHTML;
  document.head.appendChild(stylesheet);
  document.body.appendChild(host);
  return {
    host,
    remove() {
      host.remove();
      stylesheet.remove();
    },
  };
}

it('removes active content and all remote resource requests from HTML email', () => {
  const output = safeEmailDocument(
    '<script>alert(1)</script><img src="https://tracker.test/pixel"><img src="data:image/svg+xml,bad"><a href="javascript:alert(1)">link</a><form action="https://evil.test"><input></form><p style="background:url(https://tracker.test)">Hello</p>',
  );
  const doc = new DOMParser().parseFromString(output, 'text/html');
  expect(doc.querySelector('script, img, form, input')).toBeNull();
  expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
  expect(doc.body.textContent).toContain('Hello');
  expect(
    doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
  ).toContain("default-src 'none'");
  expect(doc.querySelector('[style]')).toBeNull();
});

it('retains bounded company signature and quote presentation without generic layout-table borders', async () => {
  const { companySignature } = await import('../../shared/signature');
  const { quotedHtml } = await import('../../shared/quoted');
  const quote = {
    kind: 'reply' as const,
    from: { name: 'Sender', address: 'sender@example.com' },
    to: [],
    date: '2026-11-04T02:00:00Z',
    subject: 'Original',
    text: 'Original\n> existing prefix',
  };
  const doc = new DOMParser().parseFromString(
    safeEmailDocument(
      companySignature('cs@iconiclogs.com', 'An', 'Operations').html + quotedHtml(quote),
    ),
    'text/html',
  );
  expect(doc.querySelector('table')?.getAttribute('role')).toBe('presentation');
  expect(doc.querySelector('table td')?.getAttribute('style')).toContain(
    'border-left:4px solid #801c18',
  );
  expect(doc.querySelector('table td div')?.getAttribute('style')).toContain('color:#801c18');
  expect(doc.querySelector('blockquote')?.getAttribute('style')).toContain(
    'border-left:3px solid #d2dce2',
  );
  expect(doc.querySelector('blockquote')?.textContent).toContain('> existing prefix');
  expect(doc.body.textContent).toContain('0839 037 568 | iconiclogs.com');
  const rendered = attachForStyleCheck(doc);
  try {
    const cell = rendered.host.querySelector('table td')!;
    expect(getComputedStyle(cell).borderTopWidth).toBe('0px');
    expect(getComputedStyle(cell).borderLeftWidth).toBe('4px');
    expect(getComputedStyle(rendered.host.querySelector('table td div')!).color).toBe(
      'rgb(128, 28, 24)',
    );
  } finally {
    rendered.remove();
  }
});
it('ignores hostile CSS and attributes while preserving readable normal data tables', () => {
  const input =
    '<style>@import "https://evil.test/import";</style><table role="grid" aria-label="fake" data-any="x"><tr><td style="background:url(https://evil.test/x);color:#801c18;position:fixed;top:0;opacity:0;display:none;visibility:hidden;font-size:0;line-height:0;padding:99999px;transform:scale(0);clip-path:inset(100%);width:99999px;">Readable</td></tr></table><p style="color:expression(alert(1));background:u\\72l(https://evil.test/x);font-family:evil;">Text</p><div style="color:#ffffff;background:#ffffff;">Visible</div><a href="https://evil.test" style="color:#801c18">No navigation</a>';
  const doc = new DOMParser().parseFromString(safeEmailDocument(input), 'text/html');
  expect(doc.querySelector('table')?.hasAttribute('role')).toBe(false);
  expect(doc.querySelector('[aria-label],[data-any],[href]')).toBeNull();
  expect(doc.querySelector('td')?.getAttribute('style')).toBe('color:#801c18');
  expect(doc.querySelector('p')?.hasAttribute('style')).toBe(false);
  expect(doc.querySelector('div')?.getAttribute('style')).not.toContain('color:#ffffff');
  expect(doc.body.innerHTML).not.toMatch(
    /https:|@import|expression|url\(|position:|opacity:|display:|visibility:|font-size:0|99999|transform|clip-path|\\/,
  );
  expect(doc.body.textContent).toContain('Readable');
  const rendered = attachForStyleCheck(doc);
  try {
    const cell = rendered.host.querySelector('td')!;
    expect(getComputedStyle(cell).borderTopWidth).toBe('1px');
    expect(getComputedStyle(cell).paddingTop).toBe('6px');
    expect(getComputedStyle(cell).display).not.toBe('none');
  } finally {
    rendered.remove();
  }
});
