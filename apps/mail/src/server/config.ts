import { unavailable } from './core/errors';
import { validEmail } from './core/validation';

export interface ProviderConfig {
  host: string;
  sentMode: 'append' | 'provider';
  sentFolder?: string;
}
export interface Settings {
  MAIL_ENABLED?: string;
  MAIL_DOMAIN?: string;
  MAIL_HOST?: string;
  MAIL_ALLOWED_USERS?: string;
  SESSION_KEY?: string;
  SENT_MODE?: string;
  MAIL_SENT_FOLDER?: string;
  ENVIRONMENT?: string;
}

export function configuration(env: Settings) {
  const domain = env.MAIL_DOMAIN || 'iconiclogs.com';
  const allowed = (env.MAIL_ALLOWED_USERS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const host = env.MAIL_HOST || '';
  if (
    env.MAIL_ENABLED !== 'true' ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) ||
    host.length > 253 ||
    !host.includes('.') ||
    !env.SESSION_KEY ||
    !allowed.length ||
    !allowed.every((email) => validEmail(email) && email.endsWith('@' + domain)) ||
    !['append', 'provider'].includes(env.SENT_MODE || '')
  )
    throw unavailable();
  if (
    env.MAIL_SENT_FOLDER &&
    (env.MAIL_SENT_FOLDER.length > 200 || /[\x00-\x1f]/.test(env.MAIL_SENT_FOLDER))
  )
    throw unavailable();
  return {
    allowed,
    key: env.SESSION_KEY,
    provider: {
      host,
      sentMode: env.SENT_MODE as 'append' | 'provider',
      sentFolder: env.MAIL_SENT_FOLDER,
    },
  };
}
