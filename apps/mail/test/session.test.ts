import { expect, it } from 'vitest';
import { lockSession, unlockSession, SESSION_TTL } from '../src/server/core/session';

const key = Buffer.alloc(32, 7).toString('base64'); // synthetic test key
it('encrypts credentials, binds ciphertext to the session and expires absolutely', async () => {
  const record = await lockSession(
    { email: 'user@iconiclogs.com', password: 'never-in-browser' },
    key,
    'opaque-id',
    100,
  );
  expect(JSON.stringify(record)).not.toContain('never-in-browser');
  expect(await unlockSession(record, key, 'opaque-id', 101)).toEqual({
    email: 'user@iconiclogs.com',
    password: 'never-in-browser',
  });
  await expect(unlockSession(record, key, 'another-session', 101)).rejects.toThrow();
  await expect(unlockSession(record, key, 'opaque-id', 100 + SESSION_TTL)).rejects.toThrow();
});
it('refuses missing or malformed encryption keys', async () => {
  await expect(
    lockSession({ email: 'a@iconiclogs.com', password: 'x' }, '', 'id', 0),
  ).rejects.toThrow();
});
