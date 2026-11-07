import type { Page } from '@playwright/test';
import type { SavedDraft, MailPreferences } from '../apps/mail/src/shared/contracts';
export async function personalFixture(page: Page) {
  const drafts = new Map<string, SavedDraft>();
  let preferences: MailPreferences = {
    displayName: 'ICONIC CS',
    signature: 'ICONIC Logistics\nCustomer Service',
    contacts: [{ name: 'Documents', address: 'document@iconiclogs.com' }],
  };
  await page.route('**/api/folders', (r) =>
    r.fulfill({
      json: [
        { id: 'inbox', name: 'Hộp thư đến', role: 'inbox' },
        { id: 'sent', name: 'Đã gửi', role: 'sent' },
      ],
    }),
  );
  await page.route('**/api/quota', (r) =>
    r.fulfill({ json: { used: 250 * 1048576, limit: 500 * 1048576 } }),
  );
  await page.route('**/api/preferences', async (r) => {
    if (r.request().method() === 'POST') preferences = r.request().postDataJSON();
    await r.fulfill({ json: preferences });
  });
  await page.route('**/api/drafts', (r) =>
    r.fulfill({
      json: [...drafts.values()].map(({ id, revision, updatedAt, draft }) => ({
        id,
        revision,
        updatedAt,
        subject: draft.subject,
        to: draft.to,
      })),
    }),
  );
  await page.route('**/api/drafts/*', async (r) => {
    const id = new URL(r.request().url()).pathname.split('/').at(-1)!;
    if (r.request().method() === 'POST') {
      const { draft, revision } = r.request().postDataJSON();
      if ((drafts.get(id)?.revision ?? 0) !== revision)
        return r.fulfill({
          status: 409,
          json: { error: { code: 'DRAFT_CONFLICT', message: 'Draft conflict' } },
        });
      const value = { id, draft, revision: revision + 1, updatedAt: Date.now() };
      drafts.set(id, value);
      return r.fulfill({ json: value });
    }
    if (r.request().method() === 'DELETE') {
      drafts.delete(id);
      return r.fulfill({ json: { ok: true } });
    }
    const value = drafts.get(id);
    return r.fulfill({
      status: value ? 200 : 404,
      json: value ?? { error: { code: 'DRAFT_MISSING', message: 'No draft' } },
    });
  });
  return { drafts };
}
