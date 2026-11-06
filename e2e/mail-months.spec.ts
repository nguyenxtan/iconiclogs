import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { BackupMonth } from '../apps/mail/src/shared/backup';
import { personalFixture } from './mail-fixture';

// Synthetic API only; no provider, real mailbox or outbound mail.
const url = process.env.MAIL_TEST_URL ?? 'http://127.0.0.1:6070';
async function monthsFixture(page: Page) {
  await personalFixture(page);
  const months: BackupMonth[] = [
    { month: '2026-11', count: 2, rawBytes: 72, state: 'pending' },
    { month: '2026-10', count: 1, rawBytes: 36, state: 'pending' },
  ];
  const catalog = [
    { id: '1'.repeat(64), subject: 'Thư tháng mười một A', internalDate: '2026-10-31T17:00:00Z' },
    { id: '2'.repeat(64), subject: 'Thư tháng mười một B', internalDate: '2026-11-01T02:00:00Z' },
    { id: '3'.repeat(64), subject: 'Thư tháng mười', internalDate: '2026-10-31T16:59:59Z' },
  ].map((item, index) => ({
    ...item,
    folder: 'INBOX',
    uid: index + 1,
    uidValidity: '1',
    flags: [],
    size: 36,
    sha256: 'a'.repeat(64),
    capturedAt: '2026-11-06T00:00:00Z',
  }));
  const catalogQueries: string[] = [],
    restores: unknown[] = [];
  let steps = 0;
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        email: 'synthetic@iconiclogs.com',
        csrfToken: 'synthetic',
        expiresAt: Date.now() + 600000,
      },
    }),
  );
  await page.route('**/api/messages?*', (route) =>
    route.fulfill({ json: { messages: [], total: 0, nextPage: null } }),
  );
  await page.route('**/api/backups**', async (route) => {
    const request = route.request(),
      parsed = new URL(request.url()),
      path = parsed.pathname;
    if (path === '/api/backups')
      return route.fulfill({
        json: {
          enabled: false,
          run: {
            id: 'partial',
            state: 'partial',
            captured: 3,
            errors: ['Một thư vượt giới hạn và chưa được sao lưu.'],
            startedAt: '2026-11-06T00:00:00Z',
          },
        },
      });
    if (path === '/api/backups/months') return route.fulfill({ json: months });
    if (path === '/api/backups/catalog') {
      const month = parsed.searchParams.get('month') || '';
      catalogQueries.push(month);
      return route.fulfill({
        json:
          month === '2026-11'
            ? catalog.slice(0, 2)
            : month === '2026-10'
              ? catalog.slice(2)
              : catalog,
      });
    }
    if (path === '/api/backups/months/2026-11/pack') {
      months[0] = { ...months[0]!, state: 'packing', progress: { processed: 0, total: 2 } };
      return route.fulfill({ json: months[0] });
    }
    if (path === '/api/backups/months/2026-11/step') {
      steps++;
      months[0] = {
        ...months[0]!,
        state: 'ready',
        progress: undefined,
        archive: {
          id: 'snapshot-1',
          name: 'ICONIC-Mail-synthetic-2026-11.zip',
          count: 2,
          rawBytes: 72,
          zipBytes: 420,
          updatedAt: '2026-11-06T01:00:00Z',
        },
      };
      return route.fulfill({ json: months[0] });
    }
    if (path === '/api/backups/restore') {
      const body = request.postDataJSON();
      restores.push(body);
      return route.fulfill({ json: { state: 'restored', id: body.id, targetFolder: body.folder } });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: 'SYNTHETIC_MISSING', message: path } },
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: 'Cài đặt và sao lưu', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Sao lưu', exact: true }).click();
  return {
    catalogQueries,
    restores,
    months,
    get steps() {
      return steps;
    },
  };
}

test('monthly archives are primary; opening one month fetches only its messages and restores the selected month safely', async ({
  page,
}) => {
  const fixture = await monthsFixture(page);
  await expect(
    page.getByRole('heading', { name: 'Bản sao theo tháng', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '2026', exact: true })).toBeVisible();
  await expect(page.locator('.backup-items li')).toHaveCount(0);
  expect(fixture.catalogQueries).toEqual([]);
  await page.getByRole('button', { name: 'Xem tháng 11/2026', exact: true }).click();
  await expect(page.locator('.backup-items li')).toHaveCount(2);
  expect(fixture.catalogQueries).toEqual(['2026-11']);
  await expect(page.getByText('Thư tháng mười', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Chọn 2 thư trong khoảng ngày', exact: true }).check();
  await page.getByRole('button', { name: 'Khôi phục 2 thư đã chọn', exact: true }).click();
  expect(fixture.restores).toHaveLength(0);
  await page.getByRole('button', { name: 'Xác nhận khôi phục 2 thư', exact: true }).click();
  await expect(page.getByText('2 thư đã khôi phục', { exact: true })).toBeVisible();
  expect(fixture.restores).toHaveLength(2);
});

test('packing a month exposes its ZIP download and never hides an incomplete capture', async ({
  page,
}) => {
  const fixture = await monthsFixture(page);
  await page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true }).click();
  const download = page.getByRole('link', { name: 'Tải ZIP tháng 11/2026', exact: true });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', '/api/backups/months/2026-11/download');
  expect(fixture.steps).toBe(1);
  await expect(page.getByText('Hoàn tất một phần', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Một thư vượt giới hạn và chưa được sao lưu.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.backup-month-card').filter({ hasText: '11/2026' })).toContainText(
    'Đã nén 2 thư',
  );
  await page
    .getByRole('heading', { name: 'Bản sao theo tháng', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/iconic-monthly-desktop.png' });
});

test('monthly archive cards are accessible at mobile widths and failed packaging remains retryable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await monthsFixture(page);
  await page.route('**/api/backups/months/2026-11/pack', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'BACKUP_PACK',
          message: 'Thử nghiệm: chưa nén được, bản sao hiện có vẫn được giữ.',
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Sao lưu', exact: true })
      .getByText('Thử nghiệm: chưa nén được, bản sao hiện có vẫn được giữ.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true })).toBeEnabled();
  expect(
    await page
      .getByRole('dialog', { name: 'Cài đặt hộp thư' })
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page
    .getByRole('heading', { name: 'Bản sao theo tháng', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/iconic-monthly-mobile.png' });
});

test('a paused month resumes after reload from its server checkpoint', async ({ page }) => {
  const fixture = await monthsFixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/api/backups/months/2026-11/step', async (route) => {
    requested = true;
    await held;
    fixture.months[0] = {
      ...fixture.months[0]!,
      state: 'packing',
      progress: { processed: 1, total: 2 },
    };
    await route.fulfill({ json: fixture.months[0] });
  });
  await page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Dừng sau bước này', exact: true }).click();
  release();
  await expect(
    page.getByRole('button', { name: 'Tiếp tục nén tháng 11/2026', exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Cài đặt và sao lưu', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Sao lưu', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Tiếp tục nén tháng 11/2026', exact: true }),
  ).toBeEnabled();
  await page.unroute('**/api/backups/months/2026-11/step');
  await page.getByRole('button', { name: 'Tiếp tục nén tháng 11/2026', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Tải ZIP tháng 11/2026', exact: true }),
  ).toBeVisible();
});

test('an expired packaging session stops without a subsequent catalog request', async ({
  page,
}) => {
  const fixture = await monthsFixture(page);
  await page.getByRole('button', { name: 'Xem tháng 11/2026', exact: true }).click();
  expect(fixture.catalogQueries).toEqual(['2026-11']);
  await page.route('**/api/backups/months/2026-11/pack', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHORIZED', message: 'Phiên đã hết hạn.' } },
    }),
  );
  await page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  expect(fixture.catalogQueries).toEqual(['2026-11']);
});

test('a failed ZIP download preflight reports the error and never starts the body download', async ({
  page,
}) => {
  await monthsFixture(page);
  await page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true }).click();
  const methods: string[] = [];
  await page.route('**/api/backups/months/2026-11/download', (route) => {
    methods.push(route.request().method());
    return route.fulfill({
      status: 503,
      json: { error: { code: 'BACKUP_UNAVAILABLE', message: 'Unavailable' } },
    });
  });
  await page.getByRole('link', { name: 'Tải ZIP tháng 11/2026', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Sao lưu', exact: true })
      .getByText('Chưa tải được gói ZIP. Vui lòng thử lại.', { exact: true }),
  ).toBeVisible();
  expect(methods).toEqual(['HEAD']);
});

test('an expired ZIP download preflight returns to login without downloading', async ({ page }) => {
  await monthsFixture(page);
  await page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true }).click();
  const methods: string[] = [];
  await page.route('**/api/backups/months/2026-11/download', (route) => {
    methods.push(route.request().method());
    return route.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHORIZED', message: 'Expired' } },
    });
  });
  await page.getByRole('link', { name: 'Tải ZIP tháng 11/2026', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  expect(methods).toEqual(['HEAD']);
});

test('successful metadata preflight downloads ZIP in the current tab without a popup', async ({
  page,
}) => {
  await monthsFixture(page);
  await page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true }).click();
  // Independent Python zipfile fixture; archive format/integrity is tested by the backend suite.
  const zip = Buffer.from(
    'UEsDBBQAAAAIAGVHZl1oCNB1HwAAAB0AAAAQAAAAbWFpbC9JTkJPWC8xLmVtbAsuTcpKTS6xUiiuzCvJSC3JTObl4uXKSM3JyeflAgBQSwMEFAAAAAgAZUdmXWgI0HUfAAAAHQAAABAAAABtYWlsL0lOQk9YLzIuZW1sCy5NykpNLrFSKK7MK8lILclM5uXi5cpIzcnJ5+UCAFBLAwQUAAAACABlR2Zd7MBXfW0AAACTAAAADQAAAG1hbmlmZXN0Lmpzb26rVipLLSrOzM9TslIw1FFQyk3MzEnKrwDylIor80oyUksykx0yk/PzMpNz8tOL9ZLzc5VAyvKBciBFRgZGZrqGhmCx1OLixPTUYqBwdLVSQSJEAchAfU8/J/8IfUO91NwcpVodBayyRhDZ2FoAUEsBAhQDFAAAAAgAZUdmXWgI0HUfAAAAHQAAABAAAAAAAAAAAAAAAIABAAAAAG1haWwvSU5CT1gvMS5lbWxQSwECFAMUAAAACABlR2ZdaAjQdR8AAAAdAAAAEAAAAAAAAAAAAAAAgAFNAAAAbWFpbC9JTkJPWC8yLmVtbFBLAQIUAxQAAAAIAGVHZl3swFd9bQAAAJMAAAANAAAAAAAAAAAAAACAAZoAAABtYW5pZmVzdC5qc29uUEsFBgAAAAADAAMAtwAAADIBAAAAAA==',
    'base64',
  );
  const methods: string[] = [];
  const pattern = '**/api/backups/months/2026-11/download';
  await page.route(pattern, (route) => {
    const method = route.request().method();
    methods.push(method);
    return route.fulfill({
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(zip.length),
        'Content-Disposition': 'attachment; filename="ICONIC-Mail-synthetic-2026-11.zip"',
      },
      body: method === 'HEAD' ? '' : zip,
    });
  });
  const received = page.waitForEvent('download', { timeout: 5000 });
  await page.getByRole('link', { name: 'Tải ZIP tháng 11/2026', exact: true }).click();
  const download = await received;
  expect(download.suggestedFilename()).toBe('ICONIC-Mail-synthetic-2026-11.zip');
  expect(await download.failure()).toBeNull();
  expect(methods).toEqual(['HEAD', 'GET']);
});

test('a non-ZIP metadata response cannot start a monthly archive download', async ({ page }) => {
  await monthsFixture(page);
  await page.getByRole('button', { name: 'Nén tháng 11/2026', exact: true }).click();
  const methods: string[] = [];
  await page.route('**/api/backups/months/2026-11/download', (route) => {
    methods.push(route.request().method());
    return route.fulfill({ json: { error: 'This is not a ZIP' } });
  });
  await page.getByRole('link', { name: 'Tải ZIP tháng 11/2026', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Sao lưu', exact: true })
      .getByText('Chưa tải được gói ZIP. Vui lòng thử lại.', { exact: true }),
  ).toBeVisible();
  expect(methods).toEqual(['HEAD']);
});
