import { createServer, type AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { ImapFlow } from 'imapflow';
import { expect, it } from 'vitest';
import { ViettelProvider } from '../src/server/providers/viettel';

const cjs = createRequire(import.meta.url)('imapflow').ImapFlow as typeof ImapFlow;
it('keeps the CommonJS command export compatible with the other command modules', () => {
  expect(typeof createRequire(import.meta.url)('imapflow/lib/commands/quota.js')).toBe('function');
});

async function query(
  Client: typeof ImapFlow,
  inline: string,
  fallback: Record<string, string> = {},
) {
  const commands: string[] = [];
  const server = createServer((socket) => {
    socket.write('* OK [CAPABILITY IMAP4rev1 QUOTA] synthetic fixture\r\n');
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      for (;;) {
        const end = pending.indexOf('\r\n');
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const [tag, command, ...args] = line.split(' ');
        if (command === 'CAPABILITY')
          socket.write('* CAPABILITY IMAP4rev1 QUOTA\r\n' + tag + ' OK capability\r\n');
        else if (command === 'LOGIN') socket.write(tag + ' OK authenticated\r\n');
        else if (command === 'GETQUOTAROOT') socket.write(inline + tag + ' OK roots\r\n');
        else if (command === 'GETQUOTA') {
          const root = args.join(' ');
          commands.push(root);
          socket.write((fallback[root] ?? '') + tag + ' OK quota\r\n');
        } else if (command === 'LOGOUT') socket.end('* BYE fixture\r\n' + tag + ' OK logout\r\n');
        else socket.write(tag + ' BAD unsupported fixture command\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new Client({
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    secure: false,
    doSTARTTLS: false,
    auth: { user: 'synthetic@example.test', pass: 'synthetic', loginMethod: 'LOGIN' },
    logger: false,
    disableAutoIdle: true,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    const quota = await client.getQuota('INBOX');
    await client.logout();
    return { quota, commands };
  } finally {
    client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (const [mode, Client] of [
  ['esm', ImapFlow],
  ['cjs', cjs],
] as const) {
  it(`${mode}: keeps mailbox and account STORAGE separate regardless of response order`, async () => {
    const mailbox = '* QUOTA Mailbox (STORAGE 409600 512000)\r\n';
    const account = '* QUOTA "cPanel Account" (STORAGE 1808752 5242880)\r\n';
    for (const response of [mailbox + account, account + mailbox]) {
      const { quota, commands } = await query(
        Client,
        '* QUOTAROOT INBOX Mailbox "cPanel Account"\r\n' + response,
      );
      expect(quota).toMatchObject({
        quotaRoots: [
          { quotaRoot: 'Mailbox', storage: { usage: 419430400, limit: 524288000 } },
          { quotaRoot: 'cPanel Account', storage: { usage: 1852162048, limit: 5368709120 } },
        ],
      });
      expect(commands).toEqual([]);
    }
  });

  it(`${mode}: fetches each missing root even when another arrived inline`, async () => {
    const { quota, commands } = await query(
      Client,
      '* QUOTAROOT INBOX Mailbox "cPanel Account"\r\n* QUOTA Mailbox (STORAGE 1 512000)\r\n',
      { '"cPanel Account"': '* QUOTA "cPanel Account" (STORAGE 2 5242880)\r\n' },
    );
    expect(commands).toEqual(['"cPanel Account"']);
    expect(quota).toMatchObject({
      quotaRoots: [
        { quotaRoot: 'Mailbox', storage: { usage: 1024, limit: 524288000 } },
        { quotaRoot: 'cPanel Account', storage: { usage: 2048, limit: 5368709120 } },
      ],
    });
  });

  it(`${mode}: preserves empty and literal roots, including their fallback lookup`, async () => {
    const { quota, commands } = await query(
      Client,
      '* QUOTAROOT INBOX "" {14}\r\ncPanel Account\r\n',
      {
        '""': '* QUOTA "" (STORAGE 3 512000)\r\n',
        '"cPanel Account"': '* QUOTA {14}\r\ncPanel Account (STORAGE 4 5242880)\r\n',
      },
    );
    expect(commands).toEqual(['""', '"cPanel Account"']);
    expect(quota).toMatchObject({
      quotaRoots: [
        { quotaRoot: '', storage: { usage: 3072, limit: 524288000 } },
        { quotaRoot: 'cPanel Account', storage: { usage: 4096, limit: 5368709120 } },
      ],
    });
  });

  for (const invalid of [
    'STORAGE broken broken MESSAGE 2 50',
    'MESSAGE 2 STORAGE 1 2',
    'STORAGE broken 512000 MESSAGE 2 50 __PROTO__ 1 2',
    'STORAGE 1 2 "" 3 4',
  ])
    it(`${mode}: invalidates an entire malformed root: ${invalid}`, async () => {
      const { quota } = await query(
        Client,
        '* QUOTAROOT INBOX Mailbox Account\r\n* QUOTA Mailbox (' +
          invalid +
          ')\r\n* QUOTA Account (STORAGE 4 5242880)\r\n',
      );
      expect(quota).toMatchObject({
        quotaRoots: [
          { quotaRoot: 'Mailbox' },
          { quotaRoot: 'Account', storage: { usage: 4096, limit: 5368709120 } },
        ],
      });
      if (!quota) throw Error('missing response');
      expect(quota.quotaRoots[0]).toEqual({ quotaRoot: 'Mailbox' });
      const provider = new ViettelProvider(
        { email: 'synthetic@example.test', password: 'synthetic' },
        { host: 'example.test', sentMode: 'append' },
      );
      provider.connection = async (operation) =>
        operation({ getQuota: async () => quota } as unknown as ImapFlow);
      expect(await provider.quota()).toBeNull();
    });
}
