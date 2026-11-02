import { afterEach, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { deliverMessage } from '../src/server/providers/smtp';

const credentials = { email: 'fixture@iconiclogs.com', password: 'synthetic-only' };
const config = { host: 'mail.example.test', sentMode: 'append' as const };
const draft = {
  to: ['to@example.test'],
  cc: [],
  subject: 'Thử nghiệm',
  text: 'Nội dung',
  attachments: [],
};
const original = nodemailer.createTransport.bind(nodemailer);
afterEach(() => vi.restoreAllMocks());
function smtp(sendMail: ReturnType<typeof vi.fn>) {
  vi.spyOn(nodemailer, 'createTransport').mockImplementation(((
    options: Record<string, unknown>,
  ) => {
    if (options.streamTransport) return original(options);
    return { sendMail, close: vi.fn() };
  }) as typeof nodemailer.createTransport);
}
it('preserves actual SMTP acceptance when Sent APPEND fails', async () => {
  const send = vi.fn().mockResolvedValue({ accepted: draft.to, rejected: [] });
  smtp(send);
  const append = vi.fn().mockRejectedValue(Error('IMAP disconnected'));
  const result = await deliverMessage(credentials, config, draft, '<test@iconiclogs.com>', append);
  expect(result).toMatchObject({ status: 'sent', sentCopy: 'unconfirmed', accepted: draft.to });
  expect(send).toHaveBeenCalledTimes(1);
  expect(append).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0].raw.toString()).toContain('Message-ID: <test@iconiclogs.com>');
});
it('does not append Sent or retry when SMTP outcome is unknown', async () => {
  const send = vi.fn().mockRejectedValue(Error('connection lost'));
  smtp(send);
  const append = vi.fn();
  expect(
    (await deliverMessage(credentials, config, draft, '<test@iconiclogs.com>', append)).status,
  ).toBe('unknown');
  expect(send).toHaveBeenCalledTimes(1);
  expect(append).not.toHaveBeenCalled();
});
it('reports definitive SMTP rejection and partial recipient acceptance separately', async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(Error('rejected'), { responseCode: 550 }))
    .mockResolvedValueOnce({ accepted: ['to@example.test'], rejected: ['bad@example.test'] });
  smtp(send);
  const append = vi.fn();
  expect(
    (await deliverMessage(credentials, config, draft, '<first@iconiclogs.com>', append)).status,
  ).toBe('failed');
  const result = await deliverMessage(
    credentials,
    config,
    { ...draft, cc: ['bad@example.test'] },
    '<second@iconiclogs.com>',
    append,
  );
  expect(result).toMatchObject({
    status: 'partial',
    rejected: ['bad@example.test'],
    sentCopy: 'saved',
  });
  expect(append).toHaveBeenCalledTimes(1);
});
