import { createServer, type AddressInfo } from 'node:net';
import { ImapFlow } from 'imapflow';
import { expect, it } from 'vitest';
import { quotaEvidenceLogger } from '../src/server/providers/quotaEvidence';

it('captures only bounded server quota metadata and redacts identities and secrets', () => {
  const trace = quotaEvidenceLogger('private-test-password');
  trace.logger.debug({ src: 'c', msg: 'A LOGIN user private-test-password' });
  trace.logger.debug({ src: 's', msg: '* OK private-test-password' });
  trace.logger.error({ err: Error('private-test-password') });
  trace.logger.debug({ src: 's', msg: '* QUOTA "user@example.test" (STORAGE 4 5)' });
  trace.logger.debug({ src: 's', msg: '* QUOTA "private-test-password" (STORAGE 4 5)' });
  trace.logger.debug({ src: 's', msg: '* QUOTA x\r\nLOGIN private-test-password' });
  expect(trace.snapshot().lines).toHaveLength(2);
  expect(JSON.stringify(trace.snapshot())).not.toMatch(/private-test-password|user@example|LOGIN/);
  for (let i = 0; i < 1000; i++) trace.logger.debug({ src: 's', msg: '* QUOTA x (STORAGE 4 5)' });
  trace.logger.debug({ src: 's', msg: '* QUOTA ' + 'x'.repeat(9000) });
  expect(trace.snapshot().lines.length).toBeLessThanOrEqual(16);
  expect(trace.snapshot().truncated).toBe(true);
});
it('receives QUOTA and QUOTAROOT through the supported ImapFlow logger on a real parser path', async () => {
  const trace = quotaEvidenceLogger('private-test-password');
  const server = createServer((socket) => {
    socket.write('* OK [CAPABILITY IMAP4rev1 QUOTA] synthetic quota fixture\r\n');
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      for (;;) {
        const end = pending.indexOf('\r\n');
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const [tag, command] = line.split(' ');
        if (command === 'CAPABILITY')
          socket.write('* CAPABILITY IMAP4rev1 QUOTA\r\n' + tag + ' OK capability\r\n');
        else if (command === 'LOGIN') socket.write(tag + ' OK authenticated\r\n');
        else if (command === 'GETQUOTAROOT')
          socket.write(
            '* QUOTAROOT INBOX "Mailbox" "Account"\r\n* QUOTA "Mailbox" (STORAGE 409600 512000)\r\n* QUOTA "Account" (STORAGE 1835008 5242880)\r\n' +
              tag +
              ' OK quota\r\n',
          );
        else if (command === 'LOGOUT') socket.end('* BYE fixture\r\n' + tag + ' OK logout\r\n');
        else socket.write(tag + ' BAD unsupported fixture command\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new ImapFlow({
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    secure: false,
    doSTARTTLS: false,
    auth: { user: 'synthetic@example.test', pass: 'private-test-password', loginMethod: 'LOGIN' },
    logger: trace.logger,
    emitLogs: false,
    disableAutoIdle: true,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.getQuota('INBOX');
    expect(trace.snapshot().lines).toHaveLength(3);
    expect(trace.snapshot().lines.join('\n')).toContain('STORAGE 409600 512000');
    expect(trace.snapshot().lines.join('\n')).toContain('STORAGE 1835008 5242880');
    expect(JSON.stringify(trace.snapshot())).not.toMatch(
      /private-test-password|LOGIN|synthetic@example/,
    );
    await client.logout();
  } finally {
    client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);
