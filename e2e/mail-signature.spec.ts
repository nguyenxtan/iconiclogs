import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { MailPreferences, SendDraft } from '../apps/mail/src/shared/contracts';
import { personalFixture } from './mail-fixture';

// Synthetic API only. No real provider, user account, or outbound email is used.
const mailUrl = process.env.MAIL_TEST_URL ?? 'http://127.0.0.1:6070';
async function signatureFixture(page: Page) {
  const personal = await personalFixture(page);
  let preferences: MailPreferences = { displayName: '', signature: '', contacts: [] };
  const sends: SendDraft[] = [];
  await page.route('**/api/preferences', async (route) => {
    if (route.request().method() === 'POST') preferences = route.request().postDataJSON();
    await route.fulfill({ json: preferences });
  });
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        email: 'synthetic@iconiclogs.com',
        csrfToken: 'synthetic-csrf',
        expiresAt: Date.now() + 600000,
      },
    }),
  );
  await page.route('**/api/messages?*', (route) =>
    route.fulfill({ json: { messages: [], total: 0, nextPage: null } }),
  );
  await page.route('**/api/backups', (route) =>
    route.fulfill({ json: { enabled: false, run: null } }),
  );
  await page.route('**/api/backups/catalog', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/send', (route) => {
    const value = route.request().postDataJSON();
    sends.push(value);
    return route.fulfill({
      json: { status: 'sent', sentCopy: 'saved', accepted: value.to, rejected: [] },
    });
  });
  await page.goto(mailUrl);
  return {
    personal,
    sends,
    get preferences() {
      return preferences;
    },
  };
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Cài đặt và sao lưu', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Cài đặt hộp thư' })).toBeVisible();
}

test('synthetic company signature: defaults, editable presets, exact preview and one formatted send block', async ({
  page,
}) => {
  const fixture = await signatureFixture(page);
  await settings(page);
  await expect(page.getByRole('radio', { name: 'Mẫu công ty', exact: false })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Xem trước chữ ký công ty' })).toContainText(
    'synthetic@iconiclogs.com',
  );
  await expect(page.getByRole('region', { name: 'Xem trước chữ ký công ty' })).toContainText(
    '0839 037 568',
  );
  await page.getByLabel('Tên hiển thị', { exact: true }).fill('Nguyễn An');
  await page.getByLabel('Chức danh', { exact: false }).fill('Operations');
  await expect(page.locator('.signature-preview-paper')).toContainText('Nguyễn An');
  await expect(page.locator('.signature-preview-paper')).toContainText('Operations');
  await page
    .getByRole('textbox', { name: 'Chữ ký', exact: true })
    .fill('Regards,\nCustom preserved');
  await expect(page.getByRole('radio', { name: 'Văn bản riêng', exact: false })).toBeChecked();
  await page.getByRole('radio', { name: 'Mẫu công ty', exact: false }).check();
  await expect(page.getByRole('textbox', { name: 'Chữ ký', exact: true })).toHaveValue(
    'Regards,\nCustom preserved',
  );
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByText('Đã lưu cài đặt cho tài khoản của bạn.')).toBeVisible();
  expect(fixture.preferences.signatureSettings).toEqual({
    mode: 'company',
    jobTitle: 'Operations',
  });
  await page.locator('.signature-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/iconic-company-signature-desktop.png' });
  await page.getByRole('button', { name: 'Đóng cài đặt', exact: true }).click();
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  const body = page.getByRole('textbox', { name: 'Nội dung thư', exact: true });
  const initial = await body.inputValue();
  expect(initial.match(/ICONIC Logistics/g)).toHaveLength(1);
  await expect(page.locator('.composer-signature-preview')).toContainText('Nguyễn An');
  await page.getByLabel('Đến', { exact: true }).fill('recipient@example.test');
  await page
    .getByRole('textbox', { name: 'Tiêu đề thư', exact: true })
    .fill('Synthetic signature only');
  await body.fill('Hello <img src=x>\n' + initial);
  await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hoàn tất', exact: true })).toBeVisible();
  expect(fixture.sends).toHaveLength(1);
  expect(fixture.sends[0]!.signature).toEqual({
    jobTitle: 'Operations',
    offset: 'Hello <img src=x>\n'.length + 2,
  });
  expect(fixture.sends[0]!.text.match(/ICONIC Logistics/g)).toHaveLength(1);
});

test('synthetic signature: mobile accessibility, off preset and edited block plaintext fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await signatureFixture(page);
  await settings(page);
  await page.getByLabel('Tên hiển thị', { exact: true }).fill('Nguyễn An');
  await page.getByLabel('Chức danh', { exact: false }).fill('Operations');
  const dialog = page.getByRole('dialog', { name: 'Cài đặt hộp thư' });
  expect(
    await dialog.evaluate(
      (el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.locator('.signature-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/iconic-company-signature-mobile.png' });
  await page.getByRole('radio', { name: 'Không dùng', exact: false }).check();
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByText('Đã lưu cài đặt cho tài khoản của bạn.')).toBeVisible();
  await page.getByRole('button', { name: 'Đóng cài đặt', exact: true }).click();
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Nội dung thư', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Lưu và đóng cửa sổ soạn thư', exact: true }).click();
  await settings(page);
  await page.getByRole('radio', { name: 'Mẫu công ty', exact: false }).check();
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await expect(page.getByText('Đã lưu cài đặt cho tài khoản của bạn.')).toBeVisible();
  await page.getByRole('button', { name: 'Đóng cài đặt', exact: true }).click();
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  await page.getByLabel('Đến', { exact: true }).fill('recipient@example.test');
  await page
    .getByRole('textbox', { name: 'Tiêu đề thư', exact: true })
    .fill('Synthetic edited signature');
  await page
    .getByRole('textbox', { name: 'Nội dung thư', exact: true })
    .fill('Edited signature body');
  await expect(page.locator('.composer-signature-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hoàn tất', exact: true })).toBeVisible();
  expect(fixture.sends[0]!.signature).toBeUndefined();
});
