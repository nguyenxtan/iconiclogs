// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { safeEmailDocument } from '../safeEmail';

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
