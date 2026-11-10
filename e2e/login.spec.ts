import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const loginUrl = process.env.MAIL_LOGIN_TEST_URL ?? 'http://127.0.0.1:6070';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_EXPIRED', message: 'Phiên đã hết hạn.' } },
    }),
  );
  await page.goto(loginUrl);
  await expect(page.getByRole('heading', { name: 'ICONIC Mail', exact: true })).toBeVisible();
});
test('login preserves password behavior and shows busy/error states with an accessible eye toggle', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submitted: unknown;
  await page.route('**/api/login', async (route) => {
    submitted = route.request().postDataJSON();
    await gate;
    await route.fulfill({
      status: 401,
      json: { error: { code: 'LOGIN_FAILED', message: 'Email hoặc mật khẩu chưa chính xác.' } },
    });
  });
  const password = page.getByLabel('Mật khẩu', { exact: true });
  await page.getByLabel('Email công ty', { exact: true }).fill(' user@example.invalid ');
  await password.fill('local-test-only');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đang đăng nhập…', exact: true })).toBeDisabled();
  await expect(password).toHaveValue('');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toBeDisabled();
  expect(submitted).toEqual({ email: 'user@example.invalid', password: 'local-test-only' });
  release();
  await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu chưa chính xác.');
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('support and setup dialogs work with keyboard, contain verified settings and restore focus', async ({
  page,
}) => {
  const support = page.getByRole('button', { name: 'Hỗ trợ đăng nhập', exact: true });
  await support.click();
  const dialog = page.getByRole('dialog', { name: 'Hỗ trợ đăng nhập', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Viettel');
  await expect(dialog.getByRole('link', { name: '0839 037 568' })).toHaveAttribute(
    'href',
    'tel:+84839037568',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(support).toBeFocused();
  const setup = page.getByRole('button', { name: 'Hướng dẫn cài đặt', exact: true });
  await setup.focus();
  await page.keyboard.press('Enter');
  const settings = page.getByRole('dialog', { name: 'Hướng dẫn cài đặt', exact: true });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText('hl-mail29.viettelidc.com.vn');
  await expect(settings).toContainText('Apple Mail trên Mac');
  await expect(settings).toContainText('iPhone / iPad');
  await expect(settings).toContainText('Outlook');
  await expect(settings).toContainText('993');
  await expect(settings).toContainText('465');
  for (const client of ['Outlook', 'Apple Mail trên Mac', 'iPhone / iPad']) {
    await settings.locator('summary').filter({ hasText: client }).click();
    await expect(
      settings.locator('details[open]').filter({ hasText: client }).locator('p'),
    ).toBeVisible();
  }
  const close = settings.getByRole('button', { name: 'Đóng hướng dẫn cài đặt', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await settings.getByRole('button', { name: 'Đã hiểu', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(setup).toBeFocused();
});
test('reference layout stays usable on narrow mobile with help and keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.locator('.login-card .login-brand')).toBeVisible();
  await expect(page.locator('.login-card .login-copyright')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel('Email công ty', { exact: true }).focus();
  expect(
    await page
      .getByLabel('Email công ty', { exact: true })
      .evaluate((node) => getComputedStyle(node).outlineWidth),
  ).toBe('2px');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 400 });
  await page.getByLabel('Mật khẩu', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole('button', { name: 'Hướng dẫn cài đặt', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
