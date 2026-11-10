import { expect, it, vi } from 'vitest';
import { composeMessage, ensureMimeSize, parseMessage } from '../src/server/providers/mime';
import { sendInput } from '../src/server/core/validation';
import { createApp, type MailServices } from '../src/server/http/api';

const maximum = 18 * 1024 * 1024;
const draft = (size: number) => ({
  to: ['recipient@example.test'],
  cc: [],
  subject: 'Synthetic boundary',
  text: 'Body',
  attachments: [
    {
      name: 'boundary.bin',
      type: 'application/octet-stream',
      content: Buffer.alloc(size, 71).toString('base64'),
    },
  ],
});
it('accepts the exact 25 MiB MIME boundary and refuses the next byte', () => {
  expect(() => ensureMimeSize(25 * 1024 * 1024)).not.toThrow();
  expect(() => ensureMimeSize(25 * 1024 * 1024 + 1)).toThrow();
});
it('roundtrips 18 MiB binary content through validation, MIME encoding and parsing', async () => {
  const input = sendInput(draft(maximum));
  const raw = await composeMessage('cs@iconiclogs.com', input, '<large@example.test>');
  expect(raw.length).toBeGreaterThan(10 * 1024 * 1024);
  expect(raw.length).toBeLessThanOrEqual(25 * 1024 * 1024);
  const parsed = await parseMessage(raw);
  expect(parsed.attachments[0]!.content.length).toBe(maximum);
  expect(parsed.attachments[0]!.content[maximum - 1]).toBe(71);
}, 15000);
it('rejects decoded attachment totals above 18 MiB before MIME composition', () => {
  expect(() => sendInput(draft(maximum + 1))).toThrow('18 MiB');
});
it('refuses actual encoded MIME overflow even for a caller bypassing input validation', async () => {
  await expect(
    composeMessage('cs@iconiclogs.com', draft(19 * 1024 * 1024), '<overflow@example.test>'),
  ).rejects.toMatchObject({ code: 'TOO_LARGE', status: 413 });
});
it('accepts the same large JSON body for sending and saving a draft', async () => {
  const session = {
    email: 'cs@iconiclogs.com',
    expiresAt: Date.now() + 60000,
    csrfToken: 'csrf-test',
  };
  const services = {
    session: async () => session,
    send: vi.fn(async () => ({ state: 'delivered' })),
    saveDraft: vi.fn(async (_session, id, draft, revision) => ({
      id,
      draft: { ...draft, attachments: [] },
      revision: revision + 1,
      updatedAt: Date.now(),
    })),
  } as unknown as MailServices;
  const app = createApp(services);
  const headers = {
    Cookie: `__Host-iconic_session=${'a'.repeat(64)}`,
    Origin: 'https://mail.example.test',
    'X-CSRF-Token': session.csrfToken,
    'Content-Type': 'application/json',
    'Idempotency-Key': 'large-boundary-test',
  };
  const value = draft(maximum);
  for (const [path, body] of [
    ['/api/send', value],
    ['/api/drafts/12345678-1234-4123-a123-123456789012', { draft: value, revision: 0 }],
  ] as const) {
    const response = await app.request('https://mail.example.test' + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
  }
  // The shared bound also limits chunked requests without trusting Content-Length.
  const response = await app.request('https://mail.example.test/api/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(draft(20 * 1024 * 1024)),
  });
  expect(response.status).toBe(413);
}, 15000);
