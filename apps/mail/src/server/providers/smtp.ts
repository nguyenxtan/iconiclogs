import nodemailer from 'nodemailer';
import { connect } from 'node:tls';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Credentials } from '../core/session';
import type { ProviderConfig } from '../config';
import type { SendDraft, SendResult } from '../../shared/contracts';
import { composeMessage } from './mime';
import { isAuthError, ProviderAuthError } from '../core/errors';

export async function deliverMessage(
  credentials: Credentials,
  config: ProviderConfig,
  draft: SendDraft,
  messageId: string,
  append?: (raw: Buffer) => Promise<void>,
  preparedRaw?: Buffer,
): Promise<SendResult> {
  const raw = preparedRaw ?? (await composeMessage(credentials.email, draft, messageId));
  const transport = nodemailer.createTransport({
    host: config.host,
    port: 465,
    secure: true,
    auth: { user: credentials.email, pass: credentials.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: config.host },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    // Explicit TLS socket avoids DNS assumptions in libraries on Workers.
    getSocket(_options, callback) {
      const socket = connect({
        host: config.host,
        port: 465,
        servername: config.host,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      });
      let handedOff = false;
      socket.setTimeout(10000);
      socket.once('timeout', () => socket.destroy(Error('SMTP timeout')));
      socket.once('error', (error) => {
        if (!handedOff) {
          handedOff = true;
          callback(error, undefined as never);
        }
      });
      socket.once('secureConnect', () => {
        if (!handedOff) {
          handedOff = true;
          socket.setTimeout(20000);
          callback(null, { connection: socket, secured: true });
        }
      });
    },
  } as SMTPTransport.Options);
  let info: SMTPTransport.SentMessageInfo;
  try {
    info = await transport.sendMail({
      envelope: { from: credentials.email, to: [...draft.to, ...draft.cc] },
      raw,
    });
  } catch (error) {
    if (isAuthError(error)) throw new ProviderAuthError();
    const code = (error as { responseCode?: number }).responseCode;
    const definite = typeof code === 'number' && code >= 400 && code < 600;
    return {
      status: definite ? 'failed' : 'unknown',
      sentCopy: 'not-applicable',
      accepted: [],
      rejected: definite ? [...draft.to, ...draft.cc] : [],
    };
  } finally {
    transport.close();
  }
  const accepted = (info.accepted || []).map(String),
    rejected = (info.rejected || []).map(String);
  if (!accepted.length) return { status: 'failed', sentCopy: 'not-applicable', accepted, rejected };
  let sentCopy: SendResult['sentCopy'] = append ? 'saved' : 'provider-managed';
  if (append) {
    try {
      await append(raw);
    } catch {
      sentCopy = 'unconfirmed';
    }
  }
  return { status: rejected.length ? 'partial' : 'sent', sentCopy, accepted, rejected };
}
