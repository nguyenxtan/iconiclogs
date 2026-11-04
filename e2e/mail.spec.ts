import { test, expect } from '@playwright/test';
import { personalFixture } from './mail-fixture';
import AxeBuilder from '@axe-core/playwright';

test('local demo: read, attachment, reply, send and Sent', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_EXPIRED', message: 'Đăng nhập' } },
    }),
  );
  await page.goto('http://127.0.0.1:6070');
  await page.getByRole('button', { name: 'Xem bản mẫu' }).click();
  await expect(page.getByText('Bản mẫu giao diện.', { exact: false })).toBeVisible();
  await page.getByRole('button').filter({ hasText: 'Lịch trình lô hàng Hải Phòng' }).click();
  await expect(page.locator('.mail-subject h2')).toContainText('Hải Phòng');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Lich-trinh-lo-hang/ }).click();
  expect((await download).suggestedFilename()).toContain('Lich-trinh');
  await page.getByRole('button', { name: 'Trả lời thư', exact: true }).click();
  await expect(page.locator('#draft-to')).toHaveValue('linh.nguyen@example.test');
  await page
    .getByRole('textbox', { name: 'Nội dung thư', exact: true })
    .fill('Đã nhận thông tin. Cảm ơn anh chị.');
  await page.getByRole('button', { name: 'Mô phỏng gửi' }).click();
  await expect(page.locator('.composer .notice[role="status"]')).toContainText(
    'Không có email nào được gửi ra ngoài',
  );
  await page.getByRole('button', { name: 'Hoàn tất' }).click();
  await page.getByRole('button', { name: 'Đã gửi', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText('Re: Lịch trình');
  await page.getByRole('button', { name: 'Thoát bản mẫu' }).click();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeVisible();
});

test('mobile Mail remains usable and login is accessible', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_EXPIRED', message: 'Đăng nhập' } },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:6070');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Xem bản mẫu' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button').filter({ hasText: 'Lịch trình lô hàng Hải Phòng' }).click();
  await expect(page.locator('.mail-subject h2')).toBeVisible();
  await page.getByRole('button', { name: 'Trở lại danh sách thư' }).click();
  await expect(page.locator('.list-heading h1')).toBeVisible();
});

test('sidebar collapses to a brand mark and retains accessible controls', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_EXPIRED', message: 'Đăng nhập' } },
    }),
  );
  await page.goto('http://127.0.0.1:6070');
  await page.getByRole('button', { name: 'Xem bản mẫu' }).click();
  await page.getByRole('button', { name: 'Thu gọn thanh bên' }).click();
  await expect(page.locator('.sidebar .brand-logo-mark img')).toHaveAttribute(
    'src',
    '/brand/mark.svg',
  );
  expect(
    await page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width)),
  ).toBe(76);
  await page.getByRole('button', { name: 'Đã gửi', exact: true }).click();
  await expect(page.locator('.list-heading h1')).toContainText('Đã gửi');
  await page.getByRole('button', { name: 'Mở rộng thanh bên' }).click();
  await expect(page.locator('.sidebar .brand-logo-full')).toBeVisible();
});

test('ambiguous send locks retry and carries CSRF plus one idempotency key', async ({ page }) => {
  const session = {
    email: 'fixture@iconiclogs.com',
    expiresAt: Date.now() + 60000,
    csrfToken: 'fixture-csrf',
  };
  await page.route('**/api/session', (route) => route.fulfill({ json: session }));
  await page.route('**/api/messages?*', (route) =>
    route.fulfill({ json: { messages: [], nextPage: null, total: 0 } }),
  );
  await personalFixture(page);
  let sends = 0;
  await page.route('**/api/send', async (route) => {
    sends++;
    expect(route.request().headers()['x-csrf-token']).toBe(session.csrfToken);
    expect(route.request().headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
    await route.abort('failed');
  });
  await page.goto('http://127.0.0.1:6070');
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  await page.locator('#draft-to').fill('recipient@example.test');
  await page.getByRole('textbox', { name: 'Tiêu đề thư' }).fill('Thư thử bằng fixture');
  await page.getByRole('textbox', { name: 'Nội dung thư', exact: true }).fill('Không gửi ra ngoài');
  await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
  await expect(page.locator('.composer .notice[role="status"]')).toContainText(
    'Chưa xác định kết quả gửi',
  );
  await expect(page.getByRole('button', { name: 'Kết quả chưa xác định' })).toBeDisabled();
  await expect(page.locator('#draft-to')).toBeDisabled();
  expect(sends).toBe(1);
});

test('search, star, bulk move and settings work in the labeled demo', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_EXPIRED', message: 'Đăng nhập' } },
    }),
  );
  await page.goto('http://127.0.0.1:6070');
  await page.getByRole('button', { name: 'Xem bản mẫu' }).click();
  await page.getByRole('textbox', { name: 'Tìm thư', exact: true }).fill('booking');
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('button', { name: /^Gắn sao thư/ }).click();
  await expect(page.getByRole('button', { name: /^Bỏ sao thư/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('checkbox', { name: 'Chọn tất cả thư trên trang' }).check();
  await page.getByRole('combobox', { name: 'Chuyển thư đã chọn tới' }).selectOption('trash');
  await expect(page.locator('.mail-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Thùng rác', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cài đặt và sao lưu', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: 'Tên hiển thị', exact: true })
    .fill('ICONIC Customer Service');
  await page.getByRole('textbox', { name: 'Chữ ký', exact: true }).fill('Regards, ICONIC');
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByText('Đã lưu cài đặt cho tài khoản của bạn.')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('autosaved draft survives reload with signature, Bcc and its attachment', async ({ page }) => {
  const session = {
    email: 'fixture@iconiclogs.com',
    expiresAt: Date.now() + 300000,
    csrfToken: 'fixture-csrf',
  };
  await page.route('**/api/session', (route) => route.fulfill({ json: session }));
  await page.route('**/api/messages?*', (route) =>
    route.fulfill({ json: { messages: [], nextPage: null, total: 0 } }),
  );
  const { drafts } = await personalFixture(page);
  await page.goto('http://127.0.0.1:6070');
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Nội dung thư', exact: true })).toHaveValue(
    /ICONIC Logistics/,
  );
  await page.locator('#draft-to').fill('recipient@example.test');
  await page.getByRole('button', { name: 'Thêm người nhận Bcc', exact: true }).click();
  await page.getByLabel('Bcc', { exact: true }).fill('hidden@example.test');
  await page.getByRole('textbox', { name: 'Tiêu đề thư' }).fill('Draft to resume');
  await page.locator('input[type=file]').setInputFiles({
    name: 'manifest.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Manifest content'),
  });
  await expect
    .poll(() =>
      [...drafts.values()].some(
        (value) =>
          value.draft.subject === 'Draft to resume' && value.draft.attachments.length === 1,
      ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Bản nháp', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Draft to resume' }).click();
  await expect(page.getByLabel('Bcc', { exact: true })).toHaveValue('hidden@example.test');
  await expect(page.locator('.composer')).toContainText('manifest.txt');
  await expect(page.getByRole('textbox', { name: 'Tiêu đề thư' })).toHaveValue('Draft to resume');
});
