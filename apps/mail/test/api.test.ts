import { describe, expect, it, vi } from 'vitest';
import { createApp, type MailServices } from '../src/server/http/api';
import type { SessionInfo } from '../src/shared/contracts';

const session: SessionInfo = {
  email: 'user@iconiclogs.com',
  expiresAt: Date.now() + 100000,
  csrfToken: 'csrf-example',
};
function setup() {
  const services = {
    login: vi.fn(async () => ({ id: 'a'.repeat(64), session })),
    session: vi.fn(async () => session),
    logout: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ messages: [], total: 0, nextPage: null })),
    read: vi.fn(),
    attachment: vi.fn(),
    send: vi.fn(),
  } as unknown as MailServices;
  return { app: createApp(services), services };
}
const auth = { Cookie: `__Host-iconic_session=${'a'.repeat(64)}` };
describe('HTTP mail boundary', () => {
  it('requires session for data and suppresses cache', async () => {
    const { app, services } = setup();
    expect((await app.request('https://mail.example.com/api/messages')).status).toBe(401);
    expect(services.list).not.toHaveBeenCalled();
    const res = await app.request('https://mail.example.com/api/messages', { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects cross-origin login and mutations with missing CSRF', async () => {
    const { app, services } = setup();
    expect(
      (
        await app.request('https://mail.example.com/api/login', {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(services.login).not.toHaveBeenCalled();
    expect(
      (
        await app.request('https://mail.example.com/api/logout', {
          method: 'POST',
          headers: { ...auth, Origin: 'https://mail.example.com' },
        })
      ).status,
    ).toBe(403);
    expect(services.logout).not.toHaveBeenCalled();
  });
  it('refuses invalid folder/page before provider calls', async () => {
    const { app, services } = setup();
    for (const query of ['folder=../other', 'page=0', 'page=1e10'])
      expect(
        (await app.request('https://mail.example.com/api/messages?' + query, { headers: auth }))
          .status,
      ).toBe(400);
    expect(services.list).not.toHaveBeenCalled();
  });
  it('sets an opaque secure cookie and never exposes credentials on login', async () => {
    const { app } = setup();
    const res = await app.request('https://mail.example.com/api/login', {
      method: 'POST',
      headers: { Origin: 'https://mail.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: session.email, password: 'do-not-expose' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(res.headers.get('Set-Cookie')).toContain('Secure');
    expect(res.headers.get('Set-Cookie')).not.toContain(session.email);
    expect(await res.text()).not.toContain('do-not-expose');
  });
  it('never reflects provider errors and rejects oversized login bodies', async () => {
    const { app, services } = setup();
    vi.mocked(services.login).mockRejectedValueOnce(Error('AUTH password=secret'));
    const response = await app.request('https://mail.example.com/api/login', {
      method: 'POST',
      headers: { Origin: 'https://mail.example.com', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret');
    const large = await app.request('https://mail.example.com/api/login', {
      method: 'POST',
      headers: { Origin: 'https://mail.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(5000) }),
    });
    expect(large.status).toBe(413);
  });
});

it('guards drafts, settings and backups with the same origin/session/CSRF boundary', async () => {
  const { app } = setup();
  for (const path of [
    '/api/drafts',
    '/api/preferences',
    '/api/backups/start',
    '/api/messages/actions',
  ]) {
    expect(
      (
        await app.request('https://mail.example.com' + path, {
          method: 'POST',
          headers: { ...auth, Origin: 'https://mail.example.com' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('https://mail.example.com' + path, {
          method: 'POST',
          headers: { ...auth, Origin: 'https://evil.example', 'X-CSRF-Token': session.csrfToken },
          body: '{}',
        })
      ).status,
    ).toBe(403);
  }
});
it('serves raw mail as a download only after resolving the authenticated session', async () => {
  const { app, services } = setup();
  Object.assign(services, {
    raw: vi.fn(async () => ({
      name: 'mail.eml',
      type: 'message/rfc822',
      content: new TextEncoder().encode('MIME'),
    })),
  });
  const response = await app.request(
    'https://mail.example.com/api/messages/123.42/raw?folder=inbox',
    { headers: auth },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Disposition')).toContain('attachment');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.text()).toBe('MIME');
});
it('checks monthly ZIP HEAD with auth and metadata only without constructing a download stream', async () => {
  const { app, services } = setup();
  const cancel = vi.fn();
  services.backupDescribeMonth = vi.fn(async () => ({
    name: 'ICONIC-Mail-user-2026-02.zip',
    type: 'application/zip',
    size: 123,
  }));
  services.backupDownloadMonth = vi.fn(async () => ({
    body: new ReadableStream<Uint8Array>({ type: 'bytes', cancel }),
    name: 'ICONIC-Mail-user-2026-02.zip',
    type: 'application/zip',
    size: 123,
  }));
  const path = 'https://mail.example.com/api/backups/months/2026-02/download';
  expect((await app.request(path, { method: 'HEAD' })).status).toBe(401);
  const response = await app.request(path, { method: 'HEAD', headers: auth });
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('application/zip');
  expect(response.headers.get('Content-Length')).toBe('123');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.text()).toBe('');
  expect(services.backupDownloadMonth).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it('keeps temporary quota evidence behind the normal authenticated read boundary', async () => {
  const { app, services } = setup();
  services.quotaEvidence = async () => ({ lines: ['* QUOTA "Mailbox" (STORAGE 4 5)'] });
  const path = 'https://mail.example.com/api/quota/evidence';
  expect((await app.request(path)).status).toBe(401);
  const response = await app.request(path, { headers: auth });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ lines: ['* QUOTA "Mailbox" (STORAGE 4 5)'] });
});
