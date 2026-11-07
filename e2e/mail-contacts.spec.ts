import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { personalFixture } from './mail-fixture';

// Synthetic fixtures only. No live mailbox, user browser, or outbound email is used.
const url = process.env.MAIL_TEST_URL ?? 'http://127.0.0.1:6070';
async function contactFixture(page: Page) {
  await personalFixture(page);
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        email: 'synthetic@iconiclogs.com',
        csrfToken: 'synthetic',
        expiresAt: Date.now() + 600000,
      },
    }),
  );
  await page.route('**/api/preferences', (route) =>
    route.fulfill({
      json: {
        displayName: 'Synthetic',
        signature: 'Synthetic signature',
        contacts: [{ name: 'Nguyễn Tân', address: 'tan.fixture@example.test' }],
      },
    }),
  );
  await page.route('**/api/messages?*', (route) =>
    route.fulfill({ json: { messages: [], total: 0, nextPage: null } }),
  );
  const sendRequests: unknown[] = [];
  await page.route('**/api/send', (route) => {
    sendRequests.push(route.request().postDataJSON());
    return route.fulfill({
      json: { status: 'failed', sentCopy: 'not-applicable', accepted: [], rejected: [] },
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  return { sendRequests };
}
async function disableNativeDatalist(page: Page) {
  await page.evaluate(() =>
    document.querySelectorAll('input[list]').forEach((input) => input.removeAttribute('list')),
  );
}

test('saved contacts remain pickable for To/Cc/Bcc without native datalist and stay locked during send', async ({
  page,
}) => {
  await contactFixture(page);
  await page.getByLabel('Đến', { exact: true }).fill('first@example.test, tan');
  await disableNativeDatalist(page);
  await page
    .getByRole('combobox', { name: 'Chọn liên hệ cho Đến', exact: true })
    .selectOption('first@example.test, tan.fixture@example.test');
  await expect(page.getByLabel('Đến', { exact: true })).toHaveValue(
    'first@example.test, tan.fixture@example.test',
  );
  await page.getByRole('button', { name: 'Thêm người nhận Cc', exact: true }).click();
  await page.getByLabel('Cc', { exact: true }).fill('copy@example.test; tan');
  await disableNativeDatalist(page);
  await page
    .getByRole('combobox', { name: 'Chọn liên hệ cho Cc', exact: true })
    .selectOption('copy@example.test; tan.fixture@example.test');
  await expect(page.getByLabel('Cc', { exact: true })).toHaveValue(
    'copy@example.test; tan.fixture@example.test',
  );
  await page.getByRole('button', { name: 'Thêm người nhận Bcc', exact: true }).click();
  await page.getByLabel('Bcc', { exact: true }).fill('blind@example.test, tan');
  await disableNativeDatalist(page);
  await page
    .getByRole('combobox', { name: 'Chọn liên hệ cho Bcc', exact: true })
    .selectOption('blind@example.test, tan.fixture@example.test');
  await expect(page.getByLabel('Bcc', { exact: true })).toHaveValue(
    'blind@example.test, tan.fixture@example.test',
  );
  await page
    .getByRole('textbox', { name: 'Tiêu đề thư', exact: true })
    .fill('Synthetic picker lock');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/send', async (route) => {
    requests++;
    await held;
    await route.fulfill({
      json: {
        status: 'failed',
        sentCopy: 'not-applicable',
        accepted: [],
        rejected: ['recipient@example.test'],
      },
    });
  });
  try {
    await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    for (const field of ['Đến', 'Cc', 'Bcc'])
      await expect(
        page.getByRole('combobox', { name: `Chọn liên hệ cho ${field}`, exact: true }),
      ).toBeDisabled();
  } finally {
    release();
  }
});

test('contact picker remains accessible and fits 320px and 390px composer layouts', async ({
  page,
}) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await contactFixture(page);
    await disableNativeDatalist(page);
    await page
      .getByRole('combobox', { name: 'Chọn liên hệ cho Đến', exact: true })
      .selectOption('tan.fixture@example.test');
    await expect(page.getByLabel('Đến', { exact: true })).toHaveValue('tan.fixture@example.test');
    expect(
      await page
        .locator('.composer')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page
        .locator('.recipient-field')
        .first()
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
  }
});

test('keyboard contact selection and Escape never submit or close the composer', async ({
  page,
}) => {
  const fixture = await contactFixture(page);
  await disableNativeDatalist(page);
  await page
    .getByRole('textbox', { name: 'Tiêu đề thư', exact: true })
    .fill('Synthetic keyboard selection');
  const picker = page.getByRole('combobox', { name: 'Chọn liên hệ cho Đến', exact: true });
  await picker.focus();
  // Native popup selection is unavailable to keyboard automation in headless macOS.
  await picker.selectOption('tan.fixture@example.test');
  await expect(picker).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Đến', { exact: true })).toHaveValue('tan.fixture@example.test');
  await page.keyboard.press('Escape');
  await expect(page.locator('.composer')).toBeVisible();
  expect(fixture.sendRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
  await expect.poll(() => fixture.sendRequests.length).toBe(1);
});
