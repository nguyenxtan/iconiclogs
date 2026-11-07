import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { personalFixture } from './mail-fixture';
import type {
  Folder,
  MailFolder,
  MailMessage,
  MessageAction,
  SendDraft,
} from '../apps/mail/src/shared/contracts';

// All traffic is intercepted synthetic data. No real mailbox, recipient or user browser is used.
const url = process.env.MAIL_TEST_URL ?? 'http://127.0.0.1:6070';
const email = 'cs@iconiclogs.com';
const file = Buffer.from('Synthetic manifest\nContainer TEST-0001\n');
const subject = 'Booking thử nghiệm – kiểm tra quy trình vận hành xuất khẩu Hải Phòng đi Singapore';
function original(id = '7.1'): MailMessage {
  return {
    id,
    from: { name: 'Nguyễn An – bộ phận điều phối vận tải quốc tế', address: 'an@example.test' },
    to: [
      { name: 'CS', address: email },
      { name: 'Bình', address: 'binh@example.test' },
      { name: 'An', address: 'AN@example.test' },
    ],
    cc: [
      { name: 'Bình', address: 'binh@example.test' },
      { name: 'Châu', address: 'chau@example.test' },
      { name: 'CS', address: email },
    ],
    subject,
    date: '2026-11-04T03:30:00Z',
    unread: true,
    starred: false,
    hasAttachments: true,
    text: 'Xin xác nhận lịch tàu.\nVui lòng kiểm tra manifest đính kèm.\nTrân trọng,\nAn',
    html: '',
    attachments: [{ id: 0, name: 'manifest-synthetic.txt', type: 'text/plain', size: file.length }],
    messageId: '<synthetic-original@example.test>',
  };
}
async function fixture(page: Page) {
  const personal = await personalFixture(page);
  let expired = false;
  let loggedOut = false;
  const folders: MailFolder[] = [
    { id: 'inbox', name: 'Hộp thư đến', role: 'inbox' },
    { id: 'sent', name: 'Đã gửi', role: 'sent' },
    { id: 'trash', name: 'Thùng rác', role: 'trash' },
    { id: 'archive', name: 'Lưu trữ', role: 'archive' },
  ];
  const boxes = new Map<Folder, MailMessage[]>([
    [
      'inbox',
      [
        original(),
        {
          ...original('7.2'),
          subject: 'Thông báo lịch nghỉ',
          from: { name: 'Bộ phận nhân sự', address: 'hr@example.test' },
          date: '2026-10-01T03:30:00Z',
          attachments: [],
          hasAttachments: false,
          unread: false,
        },
      ],
    ],
    ['sent', []],
    ['trash', []],
    ['archive', []],
  ]);
  const actions: Array<MessageAction & { folder: Folder }> = [];
  const searches: URLSearchParams[] = [];
  const sends: SendDraft[] = [];
  const session = () => ({ email, csrfToken: 'synthetic-csrf', expiresAt: Date.now() + 600000 });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      address = new URL(request.url()),
      path = address.pathname;
    if (path.startsWith('/api/drafts') || path === '/api/preferences' || path === '/api/quota')
      return route.fallback();
    if (path === '/api/login') {
      expired = false;
      loggedOut = false;
      return route.fulfill({ json: session() });
    }
    if (path === '/api/logout') {
      loggedOut = true;
      return route.fulfill({ status: 204 });
    }
    if (expired || loggedOut)
      return route.fulfill({
        status: 401,
        json: { error: { code: 'SESSION_EXPIRED', message: 'Phiên thử nghiệm đã hết hạn.' } },
      });
    if (path === '/api/session') return route.fulfill({ json: session() });
    if (path === '/api/folders') {
      if (request.method() === 'POST') {
        const name = request.postDataJSON().name;
        const id = `folder:${encodeURIComponent(name)}` as Folder;
        folders.push({ id, name });
        boxes.set(id, []);
      }
      return route.fulfill({ json: folders });
    }
    if (path === '/api/messages/actions') {
      const action = request.postDataJSON() as MessageAction & { folder: Folder };
      actions.push(action);
      expect(request.headers()['x-csrf-token']).toBe('synthetic-csrf');
      const source = boxes.get(action.folder)!;
      for (const item of source.filter((item) => action.ids.includes(item.id))) {
        if (action.action === 'move') {
          boxes.set(action.destination!, [...(boxes.get(action.destination!) ?? []), item]);
        }
        if (action.action === 'read') item.unread = false;
        if (action.action === 'unread') item.unread = true;
        if (action.action === 'star') item.starred = true;
        if (action.action === 'unstar') item.starred = false;
      }
      if (action.action === 'move')
        boxes.set(
          action.folder,
          source.filter((item) => !action.ids.includes(item.id)),
        );
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/messages') {
      searches.push(address.searchParams);
      let messages = boxes.get(address.searchParams.get('folder') as Folder) ?? [];
      const get = (key: string) => address.searchParams.get(key);
      if (get('query'))
        messages = messages.filter((item) =>
          item.subject.toLowerCase().includes(get('query')!.toLowerCase()),
        );
      if (get('from'))
        messages = messages.filter((item) => item.from.address.includes(get('from')!));
      if (get('after'))
        messages = messages.filter((item) => item.date.slice(0, 10) >= get('after')!);
      if (get('before'))
        messages = messages.filter((item) => item.date.slice(0, 10) < get('before')!);
      if (get('unread')) messages = messages.filter((item) => item.unread);
      if (get('starred')) messages = messages.filter((item) => item.starred);
      if (get('attachments')) messages = messages.filter((item) => item.hasAttachments);
      return route.fulfill({ json: { messages, total: messages.length, nextPage: null } });
    }
    if (path.match(/\/attachments\/0$/))
      return route.fulfill({ contentType: 'text/plain', body: file });
    if (path.endsWith('/raw'))
      return route.fulfill({
        contentType: 'message/rfc822',
        body: 'Subject: synthetic\r\n\r\nSynthetic MIME',
      });
    if (path.startsWith('/api/messages/')) {
      const id = decodeURIComponent(path.split('/')[3]!);
      const item = (boxes.get(address.searchParams.get('folder') as Folder) ?? []).find(
        (item) => item.id === id,
      );
      if (item) {
        item.unread = false;
        return route.fulfill({ json: item });
      }
      return route.fulfill({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'Synthetic missing message' } },
      });
    }
    if (path === '/api/send') {
      sends.push(request.postDataJSON());
      return route.fulfill({
        json: { status: 'sent', sentCopy: 'saved', accepted: sends.at(-1)!.to, rejected: [] },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: 'MISSING_SYNTHETIC_ROUTE', message: path } },
    });
  });
  await page.goto(url);
  await expect(page.locator('.mail-row')).toHaveCount(2);
  return {
    ...personal,
    actions,
    searches,
    sends,
    boxes,
    expire: () => {
      expired = true;
    },
  };
}
async function open(page: Page) {
  await page.locator('.message-row').filter({ hasText: 'Booking thử nghiệm' }).click();
  await expect(page.locator('.mail-subject h2')).toHaveText(subject);
}
async function login(page: Page) {
  await page.getByLabel('Email công ty', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('synthetic-password-only');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('.mail-shell')).toBeVisible();
}
async function closeCompose(page: Page) {
  await page.getByRole('button', { name: 'Lưu và đóng cửa sổ soạn thư' }).click();
  await expect(page.locator('.composer')).not.toBeVisible();
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + '.png');
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('read state, selected bulk actions, Trash move and restore use the visible message IDs', async ({
  page,
}) => {
  const f = await fixture(page);
  await open(page);
  await expect(page.locator('.mail-row').first()).not.toHaveClass(/unread/);
  await page.getByRole('button', { name: 'Đánh dấu chưa đọc', exact: true }).click();
  await expect(page.locator('.mail-row').first()).toHaveClass(/unread/);
  await page.getByRole('button', { name: 'Đánh dấu đã đọc', exact: true }).click();
  await expect(page.locator('.mail-row').first()).not.toHaveClass(/unread/);
  await page.getByRole('checkbox', { name: 'Chọn tất cả thư trên trang' }).check();
  await page.getByRole('combobox', { name: 'Thao tác với thư đã chọn' }).selectOption('unread');
  await expect(page.locator('.mail-row.unread')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Chọn tất cả thư trên trang' }).check();
  await page.getByRole('combobox', { name: 'Chuyển thư đã chọn tới' }).selectOption('trash');
  await expect(page.locator('.mail-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Thùng rác', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(2);
  await open(page);
  await page.getByRole('button', { name: 'Khôi phục về Hộp thư đến' }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Hộp thư đến', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  expect(f.actions.map((value) => value.action)).toEqual([
    'unread',
    'read',
    'unread',
    'move',
    'move',
  ]);
  expect(f.actions[3]).toMatchObject({ ids: ['7.1', '7.2'], destination: 'trash' });
  expect(f.actions[4]).toMatchObject({ ids: ['7.1'], folder: 'trash', destination: 'inbox' });
});

test('custom folder creation supports cancel and creates a selectable destination', async ({
  page,
}) => {
  const f = await fixture(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Tạo thư mục', exact: true }).click();
  expect(f.boxes.size).toBe(4);
  page.once('dialog', (dialog) => dialog.accept('Hồ sơ xuất khẩu 2026'));
  await page.getByRole('button', { name: 'Tạo thư mục', exact: true }).click();
  await page.getByRole('button', { name: 'Hồ sơ xuất khẩu 2026', exact: true }).click();
  await expect(page.locator('.list-heading h1')).toContainText('Hồ sơ xuất khẩu 2026');
  expect(f.searches.at(-1)!.get('folder')).toBe(
    'folder:H%E1%BB%93%20s%C6%A1%20xu%E1%BA%A5t%20kh%E1%BA%A9u%202026',
  );
});

test('advanced sender/date filters combine with quick filters and clear without stale query text', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByRole('button', { name: 'Bộ lọc', exact: true }).click();
  await page.getByLabel('Người gửi', { exact: true }).fill('an@example.test');
  await page.getByLabel('Từ ngày', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Trước ngày', { exact: true }).fill('2026-11-05');
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Lọc thư', exact: true }).selectOption('attachments');
  await expect.poll(() => f.searches.at(-1)!.get('attachments')).toBe('true');
  expect(Object.fromEntries(f.searches.at(-1)!)).toMatchObject({
    from: 'an@example.test',
    after: '2026-11-01',
    before: '2026-11-05',
    attachments: 'true',
  });
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(2);
  await expect(page.getByLabel('Người gửi', { exact: true })).toHaveValue('');
});

test('reply-all keeps structured original context through draft reload and send', async ({
  page,
}) => {
  const f = await fixture(page);
  await open(page);
  await page.getByRole('button', { name: 'Trả lời tất cả', exact: true }).click();
  await expect(page.locator('#draft-to')).toHaveValue('an@example.test, binh@example.test');
  await expect(page.getByLabel('Cc', { exact: true })).toHaveValue('chau@example.test');
  await expect(page.getByRole('textbox', { name: 'Tiêu đề thư', exact: true })).toHaveValue(
    'Re: ' + subject,
  );
  await expect(page.getByRole('textbox', { name: 'Nội dung thư', exact: true })).not.toHaveValue(
    /Xin xác nhận lịch tàu/,
  );
  await page.locator('.composer-original summary').click();
  await expect(page.locator('.composer-original-body')).toHaveText(original().text);
  await expect(page.locator('.composer-original-body')).not.toHaveText(/^> /);
  await expect(page.locator('.composer-original dl')).toContainText(original().from.address);
  await expect(page.locator('.composer-original dl')).toContainText(subject);
  await expect(page.locator('.composer-original dl')).toContainText('chau@example.test');
  await expect(page.getByRole('textbox', { name: 'Nội dung thư', exact: true })).not.toHaveValue(
    /^> /m,
  );
  await closeCompose(page);
  await page.reload();
  await page.getByRole('button', { name: 'Bản nháp', exact: true }).click();
  await page.locator('.draft-card').click();
  await expect(page.locator('#draft-to')).toHaveValue('an@example.test, binh@example.test');
  await page.locator('.composer-original summary').click();
  await expect(page.locator('.composer-original-body')).toHaveText(original().text);
  await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]!.quote).toMatchObject({
    kind: 'reply',
    subject,
    from: original().from,
    text: original().text,
  });
  expect(f.sends[0]!.text).not.toContain('Xin xác nhận lịch tàu');
  expect(f.sends[0]!.inReplyTo).toBe('<synthetic-original@example.test>');
  expect(f.sends[0]!.to).toEqual(['an@example.test', 'binh@example.test']);
  expect(f.sends[0]!.cc).toEqual(['chau@example.test']);
});

test('forward preserves original attachment bytes and Bcc through the visible send flow', async ({
  page,
}) => {
  const f = await fixture(page);
  await open(page);
  await page.getByRole('button', { name: 'Chuyển tiếp', exact: true }).click();
  await expect(page.locator('.composer')).toContainText('manifest-synthetic.txt');
  await expect(page.locator('#draft-to')).toHaveValue('');
  await page.locator('#draft-to').fill('recipient@example.test');
  await page.getByRole('button', { name: 'Thêm người nhận Bcc', exact: true }).click();
  await page.getByLabel('Bcc', { exact: true }).fill('hidden@example.test');
  await expect(page.getByRole('textbox', { name: 'Nội dung thư', exact: true })).not.toHaveValue(
    /Thư được chuyển tiếp/,
  );
  await page.locator('.composer-original summary').click();
  await expect(page.locator('.composer-original-body')).toHaveText(original().text);
  await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]).toMatchObject({
    to: ['recipient@example.test'],
    bcc: ['hidden@example.test'],
    subject: 'Fwd: ' + subject,
    quote: { kind: 'forward', text: original().text, subject },
  });
  expect(Buffer.from(f.sends[0]!.attachments[0]!.content, 'base64')).toEqual(file);
  await expect(page.locator('.composer')).toContainText('Đã gửi');
  expect(f.drafts.size).toBe(0);
});

test('closing an existing server draft saves edits; discard can cancel then permanently removes only that draft', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Tiêu đề thư' }).fill('Server draft to discard');
  await page
    .getByRole('textbox', { name: 'Nội dung thư', exact: true })
    .fill('Private synthetic draft');
  await closeCompose(page);
  expect(f.drafts.size).toBe(1);
  await page.getByRole('button', { name: 'Bản nháp', exact: true }).click();
  await page.locator('.draft-card').click();
  await page.getByRole('textbox', { name: 'Tiêu đề thư' }).fill('Updated existing draft');
  await closeCompose(page);
  await page.locator('.draft-card').filter({ hasText: 'Updated existing draft' }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Bỏ bản nháp', exact: true }).click();
  await expect(page.locator('.composer')).toBeVisible();
  expect(f.drafts.size).toBe(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Bỏ bản nháp', exact: true }).click();
  await expect(page.locator('.composer')).not.toBeVisible();
  await expect(page.locator('.draft-card')).toHaveCount(0);
  expect(f.drafts.size).toBe(0);
});

test('server draft remains available after expiry, login, logout and another login', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Tiêu đề thư' }).fill('Survive session changes');
  await page
    .getByRole('textbox', { name: 'Nội dung thư', exact: true })
    .fill('Persisted synthetic text');
  await closeCompose(page);
  f.expire();
  await page.getByRole('button', { name: 'Làm mới hộp thư', exact: true }).click();
  await expect(page.getByLabel('Email công ty', { exact: true })).toBeVisible();
  expect(f.drafts.size).toBe(1);
  await login(page);
  await page.getByRole('button', { name: 'Bản nháp', exact: true }).click();
  await page.locator('.draft-card').filter({ hasText: 'Survive session changes' }).click();
  await expect(page.getByRole('textbox', { name: 'Nội dung thư', exact: true })).toHaveValue(
    'Persisted synthetic text',
  );
  await closeCompose(page);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).first().click();
  await expect(page.getByLabel('Email công ty', { exact: true })).toBeVisible();
  await login(page);
  await page.getByRole('button', { name: 'Bản nháp', exact: true }).click();
  await page.locator('.draft-card').click();
  await expect(page.getByRole('textbox', { name: 'Nội dung thư', exact: true })).toHaveValue(
    'Persisted synthetic text',
  );
  expect(f.drafts.size).toBe(1);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  test(`workspace, advanced filters and reader accessible at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await fixture(page);
    for (const surface of ['workspace', 'filters', 'reader', 'compose-quote']) {
      if (surface === 'filters')
        await page.getByRole('button', { name: 'Bộ lọc', exact: true }).click();
      if (surface === 'reader') {
        await open(page);
        expect(
          await page
            .locator('.mail-sender')
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
      if (surface === 'compose-quote') {
        await page.getByRole('button', { name: 'Trả lời tất cả', exact: true }).click();
        await page.locator('.composer-original summary').click();
        await page.locator('.composer-original').scrollIntoViewIfNeeded();
        expect(
          await page.getByRole('button', { name: 'Gửi thư', exact: true }).evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight;
          }),
        ).toBe(true);
        expect(
          await page
            .locator('.composer')
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
      await screenshot(page, info, `${viewport.width}-${surface}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect
        .soft(
          (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
            .violations,
        )
        .toEqual([]);
    }
  });

test('synthetic mobile quote disclosure preserves literal content and explicit removal survives reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page);
  const text =
    'Original line\n> Literal prefix from the original\n<script>plain original text</script>';
  await page.route('**/api/messages/7.1?*', (route) =>
    route.fulfill({ json: { ...original(), text } }),
  );
  await open(page);
  await page.getByRole('button', { name: 'Trả lời thư', exact: true }).click();
  await expect(page.locator('.composer-original-body')).not.toBeVisible();
  await page.locator('.composer-original summary').click();
  await expect(page.locator('.composer-original-body')).toHaveText(text);
  expect(await page.locator('.composer-original-body script').count()).toBe(0);
  expect(
    await page
      .locator('.composer')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  const serverOriginal = structuredClone(f.boxes.get('inbox'));
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Bỏ nội dung thư trước', exact: true }).click();
  await expect(page.locator('.composer-original-body')).toHaveText(text);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Bỏ nội dung thư trước', exact: true }).click();
  expect(f.actions).toEqual([]);
  expect(f.boxes.get('inbox')).toEqual(serverOriginal);
  await expect(page.locator('.composer-original')).toHaveCount(0);
  await closeCompose(page);
  await page.reload();
  await page.getByRole('button', { name: 'Bản nháp', exact: true }).click();
  await page.locator('.draft-card').click();
  await expect(page.locator('.composer-original')).toHaveCount(0);
  await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
  await expect.poll(() => f.sends.length).toBe(1);
  expect(f.sends[0]!.quote).toBeUndefined();
  expect(f.sends[0]!.text).not.toContain('Original line');
});

test('short mobile advanced filters leave a reachable message row and scroll within their own panel', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await fixture(page);
  await page.getByRole('button', { name: 'Bộ lọc', exact: true }).click();
  await screenshot(page, info, '390x600-expanded-filters');
  expect(
    await page.locator('.message-items').evaluate((element) => element.clientHeight),
  ).toBeGreaterThanOrEqual(80);
  expect(
    await page
      .locator('.mail-search')
      .evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  await page.getByLabel('Người gửi', { exact: true }).fill('an@example.test');
  await page.getByLabel('Trước ngày', { exact: true }).fill('2026-11-05');
  await expect(page.locator('.mail-row')).toHaveCount(1);
  const first = page.locator('.message-row').first();
  await first.scrollIntoViewIfNeeded();
  expect(
    await first.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return (
        box.top >= 0 && box.bottom <= innerHeight && (hit === element || element.contains(hit))
      );
    }),
  ).toBe(true);
  expect(
    await page
      .locator('.row-star')
      .first()
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === element || element.contains(hit);
      }),
  ).toBe(true);
  await screenshot(page, info, '390x600-applied-filters');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await first.click();
  await expect(page.locator('.mail-subject h2')).toHaveText(subject);
});

test('18 MiB attachment survives visible draft reload and send while the next byte is refused', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByRole('button', { name: 'Soạn thư', exact: true }).first().click();
  await page.locator('#draft-to').fill('recipient@example.test');
  await page
    .getByRole('textbox', { name: 'Tiêu đề thư', exact: true })
    .fill('Synthetic large attachment');
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'too-large.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(18 * 1024 * 1024 + 1),
    });
  await expect(page.locator('.composer .notice.error')).toContainText('18 MiB');
  await expect(page.locator('.draft-files')).toHaveCount(0);
  const bytes = Buffer.alloc(18 * 1024 * 1024, 71);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'boundary.bin', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('.draft-files')).toContainText('boundary.bin');
  await closeCompose(page);
  await page.reload();
  await page.getByRole('button', { name: 'Bản nháp', exact: true }).click();
  await page.locator('.draft-card').click();
  await expect(page.locator('.draft-files')).toContainText('boundary.bin');
  await page.getByRole('button', { name: 'Gửi thư', exact: true }).click();
  await expect.poll(() => f.sends.length).toBe(1);
  expect(Buffer.from(f.sends[0]!.attachments[0]!.content, 'base64').equals(bytes)).toBe(true);
});
