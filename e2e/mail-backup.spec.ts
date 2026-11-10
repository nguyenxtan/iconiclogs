import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { BackupAutomation } from '../apps/mail/src/shared/backup';

// Synthetic fixtures only: these tests never contact a mail provider or restore real mail.
const mailUrl = process.env.MAIL_TEST_URL ?? 'http://127.0.0.1:6070';
async function syntheticBackup(page: Page, automation?: BackupAutomation) {
  let enabled = !!automation;
  let steps = 0;
  let configured: boolean[] = [];
  const restores: { id: string; folder: string; requestId: string }[] = [];
  let run: Record<string, unknown> | null = null;
  const dates = [
    '2026-11-03T16:59:59Z',
    '2026-11-03T17:00:00Z',
    '2026-11-04T16:59:59Z',
    '2026-11-04T17:00:00Z',
  ];
  const subjects = [
    'Trước khoảng ngày',
    'Hồ sơ xuất khẩu thử nghiệm',
    'Lịch tàu thử nghiệm',
    'Sau khoảng ngày',
  ];
  const catalog = dates.map((internalDate, index) => ({
    id: String(index + 1).repeat(64),
    subject: subjects[index],
    from: 'synthetic@example.test',
    folder: 'INBOX',
    uid: index + 1,
    uidValidity: '1',
    internalDate,
    capturedAt: '2026-11-05T00:00:00Z',
    flags: [],
    size: 12,
    sha256: 'synthetic',
  }));
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let json: unknown;
    switch (path) {
      case '/api/session':
        json = {
          email: 'synthetic@iconiclogs.com',
          csrfToken: 'synthetic-csrf',
          expiresAt: Date.now() + 600000,
        };
        break;
      case '/api/folders':
        json = [
          { id: 'inbox', name: 'Hộp thư đến', role: 'inbox' },
          { id: 'archive', name: 'Lưu trữ', role: 'archive' },
        ];
        break;
      case '/api/preferences':
        json = { displayName: 'Tài khoản thử nghiệm', signature: '', contacts: [] };
        break;
      case '/api/quota':
        json = automation?.quota ?? null;
        break;
      case '/api/drafts':
        json = [];
        break;
      case '/api/messages':
        json = { messages: [], total: 0, nextPage: null };
        break;
      case '/api/backups':
        json = {
          enabled,
          run,
          ...(enabled ? { automation, nextRunAt: Date.now() + 3600000 } : {}),
        };
        break;
      case '/api/backups/catalog':
        json = catalog;
        break;
      case '/api/backups/months':
        json = [{ month: '2026-11', count: catalog.length, rawBytes: 48, state: 'pending' }];
        break;
      case '/api/backups/configure':
        enabled = request.postDataJSON().enabled;
        configured.push(enabled);
        json = {
          enabled,
          run,
          ...(enabled
            ? {
                automation: automation ?? { thresholdPercent: 80, state: 'pending' },
                nextRunAt: Date.now() + 1000,
              }
            : {}),
        };
        break;
      case '/api/backups/start':
        run = {
          id: 'synthetic-run',
          state: 'running',
          captured: 0,
          errors: [],
          startedAt: '2026-11-04T00:00:00Z',
        };
        json = {
          enabled,
          run,
          ...(enabled ? { automation, nextRunAt: Date.now() + 3600000 } : {}),
        };
        break;
      case '/api/backups/step':
        steps++;
        run = {
          ...run,
          state: steps >= 2 ? 'complete' : 'running',
          captured: steps,
          ...(steps >= 2 ? { finishedAt: '2026-11-04T00:01:00Z' } : {}),
        };
        json = {
          enabled,
          run,
          ...(enabled ? { automation, nextRunAt: Date.now() + 3600000 } : {}),
        };
        break;
      case '/api/backups/restore': {
        const body = request.postDataJSON();
        restores.push(body);
        if (restores.length === 1) {
          await route.fulfill({
            status: 502,
            json: {
              error: {
                code: 'BACKUP_RESTORE_FAILED',
                message: 'Thử nghiệm: thư chưa được ghi, có thể thử lại.',
              },
            },
          });
          return;
        }
        json = {
          state: restores.length === 2 ? 'restored' : 'uncertain',
          id: body.id,
          targetFolder: body.folder,
        };
        break;
      }
      default:
        await route.fulfill({
          status: 404,
          json: {
            error: {
              code: 'SYNTHETIC_ROUTE_MISSING',
              message: `Synthetic fixture missing: ${path}`,
            },
          },
        });
        return;
    }
    await route.fulfill({ json });
  });
  await page.goto(mailUrl);
  await page.getByRole('button', { name: 'Cài đặt và sao lưu' }).first().click();
  await page.getByRole('tab', { name: 'Sao lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Xem tháng 11/2026', exact: true }).click();
  return {
    catalog,
    restores,
    configured,
    get steps() {
      return steps;
    },
  };
}

test('synthetic backup API: explicit 80% monitor consent, revoke, capture steps and safe restore retry', async ({
  page,
}) => {
  const fixture = await syntheticBackup(page);
  await page.getByRole('button', { name: 'Thiết lập sao lưu tự động' }).click();
  expect(fixture.configured).toEqual([]);
  await page.getByRole('button', { name: 'Bật sao lưu tự động', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tắt sao lưu tự động' })).toBeVisible();
  expect(fixture.configured).toEqual([true]);
  await page.getByRole('button', { name: 'Tắt sao lưu tự động' }).click();
  await expect(page.getByRole('button', { name: 'Thiết lập sao lưu tự động' })).toBeVisible();
  expect(fixture.configured).toEqual([true, false]);
  await page.getByRole('button', { name: 'Sao lưu ngay', exact: true }).click();
  await expect(page.getByText('Hoàn tất', { exact: true })).toBeVisible();
  expect(fixture.steps).toBe(2);
  await page.getByLabel('Từ ngày nhận').fill('2026-11-04');
  await page.getByLabel('Đến hết ngày').fill('2026-11-04');
  await expect(page.locator('.backup-items li')).toHaveCount(2);
  await expect(page.getByText('Trước khoảng ngày', { exact: true })).toHaveCount(0);
  const first = page.getByRole('checkbox', {
    name: 'Chọn Hồ sơ xuất khẩu thử nghiệm',
    exact: true,
  });
  await first.check();
  await page.getByLabel('Khôi phục vào thư mục đang có').selectOption('archive');
  await page.getByRole('button', { name: 'Khôi phục 1 thư đã chọn', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận khôi phục 1 thư', exact: true }).click();
  await expect(page.locator('.backup-items')).toContainText('Chưa ghi thư, có thể chọn để thử lại');
  await expect(page.locator('.backup-items')).toContainText('Thử nghiệm: thư chưa được ghi');
  expect(fixture.restores).toHaveLength(1);
  await expect(first).toBeEnabled();
  await first.check();
  await page.getByRole('button', { name: 'Khôi phục 1 thư đã chọn', exact: true }).click();
  expect(fixture.restores).toHaveLength(1);
  await page.getByRole('button', { name: 'Xác nhận khôi phục 1 thư', exact: true }).click();
  await expect(first).toBeDisabled();
  expect(fixture.restores).toHaveLength(2);
  expect(fixture.restores[1]!.id).toBe(fixture.restores[0]!.id);
  expect(fixture.restores[1]!.requestId).not.toBe(fixture.restores[0]!.requestId);
  expect(fixture.restores.every((value) => value.folder === 'archive')).toBe(true);
  const second = page.getByRole('checkbox', { name: 'Chọn Lịch tàu thử nghiệm', exact: true });
  await second.check();
  await page.getByRole('button', { name: 'Khôi phục 1 thư đã chọn', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận khôi phục 1 thư', exact: true }).click();
  await expect(second).toBeDisabled();
  await expect(
    page.getByText('1 thư đã khôi phục · 1 thư chưa xác định', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Đóng cài đặt', exact: true }).click();
  await page.getByRole('button', { name: 'Cài đặt và sao lưu' }).first().click();
  await page.getByRole('tab', { name: 'Sao lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Xem tháng 11/2026', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Chọn Lịch tàu thử nghiệm', exact: true }),
  ).toBeDisabled();
  expect(fixture.restores).toHaveLength(3);
});

test('synthetic backup API: mobile dialog has accessible controls and no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await syntheticBackup(page);
  const dialog = page.getByRole('dialog', { name: 'Cài đặt hộp thư' });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth &&
        element.getBoundingClientRect().right <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('suspended daily backup shows a refresh action instead of an active schedule', async ({
  page,
}) => {
  await syntheticBackup(page);
  await page.route('**/api/backups', (route) =>
    route.fulfill({ json: { enabled: true, suspended: true, run: null } }),
  );
  let refresh = false;
  await page.route('**/api/backups/configure', (route) => {
    refresh = route.request().postDataJSON().enabled === true;
    return route.fulfill({ json: { enabled: true, nextRunAt: Date.now() + 86400000, run: null } });
  });
  await page.goto(mailUrl);
  await page.getByRole('button', { name: 'Cài đặt và sao lưu', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Sao lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Xem tháng 11/2026', exact: true }).click();
  await expect(page.locator('.backup-policy .backup-badge')).toHaveText('Tạm dừng');
  await expect(page.getByText('Lần kiểm tra tiếp theo:', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cập nhật quyền sao lưu', exact: true }).click();
  expect(refresh).toBe(true);
  await expect(page.locator('.backup-policy .backup-badge')).toHaveText('Đang bật');
});

test('in-flight restore waits for its response without reporting permanent uncertainty', async ({
  page,
}) => {
  await syntheticBackup(page);
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/api/backups/restore', async (route) => {
    requested = true;
    const body = route.request().postDataJSON();
    await response;
    await route.fulfill({ json: { state: 'restored', id: body.id, targetFolder: body.folder } });
  });
  try {
    const item = page.getByRole('checkbox', {
      name: 'Chọn Hồ sơ xuất khẩu thử nghiệm',
      exact: true,
    });
    await item.check();
    await page.getByRole('button', { name: 'Khôi phục 1 thư đã chọn', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận khôi phục 1 thư', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(
      page.getByText('0 thư đã khôi phục · 1 thư đang khôi phục', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Các thư chưa xác định đã bị khóa gửi lại. Kiểm tra thư mục đích với quản trị viên.',
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(item).toBeDisabled();
    await expect(
      page.locator('.backup-items li').filter({ hasText: 'Hồ sơ xuất khẩu thử nghiệm' }),
    ).toContainText('Đang khôi phục');
    expect(
      await page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem('iconic-mail-restore-v1:synthetic@iconiclogs.com')!)[0]
            .items[0].state,
      ),
    ).toBe('sending');
    release();
    await expect(page.getByText('1 thư đã khôi phục', { exact: true })).toBeVisible();
    await expect(item).toBeDisabled();
    await expect(
      page.getByText('0 thư đã khôi phục · 1 thư đang khôi phục', { exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test('reopened interrupted restore remains uncertain and locked instead of looking active', async ({
  page,
}) => {
  await syntheticBackup(page);
  await page.evaluate(() =>
    sessionStorage.setItem(
      'iconic-mail-restore-v1:synthetic@iconiclogs.com',
      JSON.stringify([
        {
          target: 'inbox',
          items: [
            {
              id: '2'.repeat(64),
              requestId: '11111111-1111-4111-a111-111111111111',
              state: 'sending',
            },
          ],
        },
      ]),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Cài đặt và sao lưu', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Sao lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Xem tháng 11/2026', exact: true }).click();
  await expect(
    page.getByText('0 thư đã khôi phục · 1 thư chưa xác định', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Chọn Hồ sơ xuất khẩu thử nghiệm', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      'Các thư chưa xác định đã bị khóa gửi lại. Kiểm tra thư mục đích với quản trị viên.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('mailbox and shared package quota keep distinct labels at desktop and mobile sizes', async ({
  page,
}) => {
  await syntheticBackup(page, {
    thresholdPercent: 80,
    state: 'above',
    checkedAt: Date.now(),
    quota: {
      used: 100 * 1048576,
      limit: 500 * 1048576,
      roots: [
        { name: 'cPanel Account', used: 4096 * 1048576, limit: 5120 * 1048576 },
        { name: 'Mailbox', used: 100 * 1048576, limit: 500 * 1048576 },
      ],
    },
  });
  const policy = page.locator('.backup-policy');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 1440) {
      await expect(
        page.getByRole('progressbar', { name: 'Dung lượng hộp thư', exact: true }),
      ).toHaveAttribute('max', String(500 * 1048576));
      await expect(
        page.getByRole('progressbar', { name: 'Dung lượng gói mail dùng chung', exact: true }),
      ).toHaveAttribute('max', String(5120 * 1048576));
    }
    await expect(policy).toContainText('Hộp thư: 100 MiB / 500 MiB · 20%');
    await expect(policy.locator('.quota-reading').first()).toContainText('Hộp thư:');
    await expect(policy).toContainText('Gói mail dùng chung: 4096 MiB / 5120 MiB · 80%');
    await expect(policy).toContainText('Đã đạt ngưỡng 80%');
    expect(await policy.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await policy.screenshot({ path: `/tmp/iconic-quota-roots-${width}.png` });
  }
});

for (const sample of [
  { state: 'below' as const, used: 399999, text: 'Chưa đạt ngưỡng 80%' },
  { state: 'above' as const, used: 400000, text: 'Đã đạt ngưỡng 80%' },
  { state: 'unavailable' as const, text: 'Chưa đọc được dung lượng hợp lệ từ Viettel' },
  {
    state: 'error' as const,
    text: 'Không kiểm tra được dung lượng. Hệ thống chưa khởi động lượt sao lưu mới.',
  },
]) {
  test(`automatic backup UI explains ${sample.state} quota and keeps manual capture available`, async ({
    page,
  }) => {
    await syntheticBackup(page, {
      thresholdPercent: 80,
      state: sample.state,
      checkedAt: Date.now(),
      ...(sample.used !== undefined ? { quota: { used: sample.used, limit: 500000 } } : {}),
      nextBackupAt: Date.now() + 86400000,
    });
    const policy = page.locator('.backup-policy');
    await expect(policy).toContainText(sample.text);
    await expect(policy).toContainText('Kiểm tra mỗi giờ');
    await expect(policy.getByText('Lần kiểm tra tiếp theo:', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sao lưu ngay', exact: true })).toBeEnabled();
    if (sample.state === 'below') await expect(policy).toContainText('79,9%');
    if (sample.state === 'above') await expect(policy).toContainText('Lượt cập nhật sớm nhất:');
    if (sample.state === 'unavailable') await expect(policy).toContainText('không tự đoán');
    if (sample.state === 'below')
      await policy.screenshot({ path: '/tmp/iconic-quota-policy-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await policy.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    if (sample.state === 'below')
      await policy.screenshot({ path: '/tmp/iconic-quota-policy-mobile.png' });
  });
}

test('enabling the monitor refreshes its initial quota result without reloading settings', async ({
  page,
}) => {
  await syntheticBackup(page);
  await page.route('**/api/backups', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        run: null,
        nextRunAt: Date.now() + 3600000,
        automation: {
          thresholdPercent: 80,
          state: 'below',
          checkedAt: Date.now(),
          quota: { used: 200, limit: 500 },
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Thiết lập sao lưu tự động', exact: true }).click();
  await page.getByRole('button', { name: 'Bật sao lưu tự động', exact: true }).click();
  await expect(page.locator('.backup-policy')).toContainText('40%');
  await expect(page.locator('.backup-policy')).toContainText('Chưa đạt ngưỡng 80%');
});

test('automatic completion refreshes monthly ZIP cards and the open restore catalog', async ({
  page,
}) => {
  const fixture = await syntheticBackup(page);
  let completed = false;
  const added = { ...fixture.catalog[0], id: 'e'.repeat(64), subject: 'Thư mới từ lịch tự động' };
  await page.route('**/api/backups', (route) => {
    completed = true;
    return route.fulfill({
      json: {
        enabled: true,
        run: {
          id: 'automatic-new',
          state: 'complete',
          captured: 5,
          errors: [],
          startedAt: '2026-11-06T00:00:00Z',
        },
        automation: { thresholdPercent: 80, state: 'above', quota: { used: 80, limit: 100 } },
      },
    });
  });
  await page.route('**/api/backups/months', (route) =>
    route.fulfill({
      json: [
        {
          month: '2026-11',
          count: completed ? 5 : 4,
          rawBytes: 60,
          state: 'ready',
          archive: {
            id: 'new-zip',
            name: 'November.zip',
            count: completed ? 5 : 4,
            rawBytes: 60,
            zipBytes: 40,
            updatedAt: '2026-11-06T00:00:00Z',
          },
        },
      ],
    }),
  );
  await page.route('**/api/backups/catalog?*', (route) =>
    route.fulfill({ json: completed ? [...fixture.catalog, added] : fixture.catalog }),
  );
  await page.getByRole('button', { name: 'Thiết lập sao lưu tự động', exact: true }).click();
  await page.getByRole('button', { name: 'Bật sao lưu tự động', exact: true }).click();
  await expect(page.getByText('Hoàn tất', { exact: true })).toBeVisible();
  await expect(page.locator('.backup-months')).toContainText('Đã nén 5 thư');
  await expect(
    page.getByRole('checkbox', { name: 'Chọn Thư mới từ lịch tự động', exact: true }),
  ).toBeVisible();
});
