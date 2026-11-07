import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { personalFixture } from './mail-fixture';
import type { MailMessage } from '../apps/mail/src/shared/contracts';

const url = process.env.MAIL_TEST_URL ?? 'http://127.0.0.1:6070';
const png = readFileSync('apps/mail/public/brand/iconic-logo.png');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
function message(id: string, second = false): MailMessage {
  return {
    id,
    from: { name: 'Synthetic sender', address: 'sender@example.test' },
    to: [{ name: 'CS', address: 'cs@iconiclogs.com' }],
    subject: second ? 'Second embedded image' : 'First embedded image',
    date: '2026-11-07T00:00:00Z',
    unread: false,
    text: 'Synthetic message text',
    html: `<p>${second ? 'Second' : 'First'} synthetic content</p><img src="cid:logo%40example.test" alt="${second ? 'Second' : 'First'} embedded logo" width="1400" onerror="alert(1)" srcset="https://tracker.invalid/pixel 2x"><img src="https://tracker.invalid/pixel"><img src="data:image/svg+xml,bad">`,
    hasAttachments: true,
    attachments: [
      {
        id: 0,
        name: second ? 'logo.gif' : 'logo.png',
        type: second ? 'image/gif' : 'image/png',
        size: second ? gif.length : png.length,
        contentId: 'logo@example.test',
      },
    ],
  };
}
async function fixture(page: Page, slowFirst = false) {
  await personalFixture(page);
  let release = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const files: string[] = [],
    external: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('tracker.invalid')) external.push(request.url());
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      ['/api/preferences', '/api/quota', '/api/drafts'].includes(path) ||
      path.startsWith('/api/drafts/')
    )
      return route.fallback();
    if (path === '/api/session')
      return route.fulfill({
        json: {
          email: 'cs@iconiclogs.com',
          csrfToken: 'synthetic-csrf',
          expiresAt: Date.now() + 600000,
        },
      });
    if (path === '/api/folders')
      return route.fulfill({ json: [{ id: 'inbox', name: 'Hộp thư đến', role: 'inbox' }] });
    if (path === '/api/messages')
      return route.fulfill({
        json: { messages: [message('17.1'), message('17.2', true)], total: 2, nextPage: null },
      });
    const attachment = /^\/api\/messages\/(17\.[12])\/attachments\/0$/.exec(path);
    if (attachment) {
      files.push(attachment[1]!);
      if (slowFirst && attachment[1] === '17.1') await delayed;
      return route.fulfill({
        contentType: 'application/octet-stream',
        body: attachment[1] === '17.1' ? png : gif,
      });
    }
    if (path === '/api/messages/17.1') return route.fulfill({ json: message('17.1') });
    if (path === '/api/messages/17.2') return route.fulfill({ json: message('17.2', true) });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Synthetic route unavailable' } },
    });
  });
  await page.goto(url);
  return { release, files, external };
}

for (const width of [1440, 390]) {
  test(`renders a real embedded raster safely within the reader at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await fixture(page);
    await page.locator('.message-row').filter({ hasText: 'First embedded image' }).click();
    const frame = page.frameLocator('iframe[title="Nội dung HTML của thư"]');
    const image = frame.getByRole('img', { name: 'First embedded logo' });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBe(500);
    await expect(frame.locator('img')).toHaveCount(1);
    await expect(frame.locator('[onerror],[srcset],script')).toHaveCount(0);
    const bounds = await image.boundingBox(),
      reader = await page.locator('.email-frame').boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(reader!.width + 1);
    expect(state.files).toEqual(['17.1']);
    expect(state.external).toEqual([]);
    await expect(page.locator('.email-frame')).toHaveAttribute('sandbox', '');
    await page.screenshot({ path: testInfo.outputPath(`reader-cid-${width}.png`), fullPage: true });
  });
}

test('a late image response never replaces a different message using the same CID', async ({
  page,
}) => {
  const state = await fixture(page, true);
  await page.locator('.message-row').filter({ hasText: 'First embedded image' }).click();
  await expect.poll(() => state.files).toEqual(['17.1']);
  await page.locator('.message-row').filter({ hasText: 'Second embedded image' }).click();
  const frame = page.frameLocator('iframe[title="Nội dung HTML của thư"]');
  await expect(frame.getByRole('img', { name: 'Second embedded logo' })).toHaveAttribute(
    'src',
    /^data:image\/gif;/,
  );
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/messages/17.1/attachments/0',
  );
  state.release();
  await response;
  await expect(frame.getByRole('img', { name: 'Second embedded logo' })).toHaveAttribute(
    'src',
    /^data:image\/gif;/,
  );
  await expect(frame.locator('img[src^="data:image/png"]')).toHaveCount(0);
  expect(state.external).toEqual([]);
});

test('an expired authenticated embedded-image request returns the user to login', async ({
  page,
}) => {
  await fixture(page);
  await page.route(/\/api\/messages\/17\.1\/attachments\/0(?:\?|$)/, (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_EXPIRED', message: 'Synthetic expired image session' } },
    }),
  );
  const rejected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/messages/17.1/attachments/0' &&
      response.status() === 401,
  );
  await page.locator('.message-row').filter({ hasText: 'First embedded image' }).click();
  await rejected;
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.locator('.email-frame')).toHaveCount(0);
});
