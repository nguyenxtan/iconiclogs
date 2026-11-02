import { test, expect } from '@playwright/test';
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
  await expect(page.getByRole('status')).toContainText('Không có email nào được gửi ra ngoài');
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
  await expect(page.getByRole('status')).toContainText('Chưa xác định kết quả gửi');
  await expect(page.getByRole('button', { name: 'Kết quả chưa xác định' })).toBeDisabled();
  await expect(page.locator('#draft-to')).toBeDisabled();
  expect(sends).toBe(1);
});
