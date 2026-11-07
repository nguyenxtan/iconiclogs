import { expect, it } from 'vitest';
import { loginFailure, MailError } from '../src/server/core/errors';

it.each([
  [{ authenticationFailed: true, message: 'private provider transcript' }, 401, 'LOGIN_FAILED'],
  [new MailError('PROVIDER_TIMEOUT', 504, 'Kết nối mail quá thời gian.'), 504, 'PROVIDER_TIMEOUT'],
  [{ code: 'CONNECT_TIMEOUT', message: 'private provider transcript' }, 504, 'PROVIDER_TIMEOUT'],
  [{ code: 'ECONNRESET', message: 'private provider transcript' }, 502, 'PROVIDER_UNAVAILABLE'],
])(
  'distinguishes rejected credentials from provider failures without leaking transcripts',
  (error, status, code) => {
    const failure = loginFailure(error);
    expect(failure).toMatchObject({ status, code });
    expect(failure.message).not.toContain('private provider transcript');
  },
);
