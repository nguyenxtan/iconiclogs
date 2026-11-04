import { validEmail } from './email';

export interface SignatureSettings {
  mode: 'company' | 'custom' | 'off';
  jobTitle: string;
}
export interface CompanySignaturePayload {
  jobTitle: string;
  /** UTF-16 position of the exact generated plain-text block in SendDraft.text. */
  offset: number;
}
// Approved public details: apps/web/src/content/company.ts and apps/web/astro.config.mjs.
export const signatureCompany = Object.freeze({
  name: 'ICONIC Logistics',
  phone: '0839 037 568',
  phoneHref: '+84839037568',
  website: 'https://iconiclogs.com',
  websiteLabel: 'iconiclogs.com',
  address: '25/49 Đường 6, Khu phố 26, Phường Hiệp Bình, TP.HCM, Việt Nam',
});
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid signature');
  return input as Record<string, unknown>;
}
function titleInput(input: unknown): string {
  if (typeof input !== 'string' || input.length > 100 || /[\x00-\x1f\x7f-\x9f]/.test(input))
    throw Error('Invalid signature title');
  return input.trim();
}
export function signatureSettingsInput(input: unknown): SignatureSettings {
  const value = record(input);
  if (
    !['company', 'custom', 'off'].includes(value.mode as string) ||
    Object.keys(value).some((key) => !['mode', 'jobTitle'].includes(key))
  )
    throw Error('Invalid signature settings');
  return {
    mode: value.mode as SignatureSettings['mode'],
    jobTitle: titleInput(value.jobTitle ?? ''),
  };
}
export function signaturePayloadInput(input: unknown): CompanySignaturePayload {
  const value = record(input);
  if (
    !Number.isSafeInteger(value.offset) ||
    (value.offset as number) < 0 ||
    (value.offset as number) > 131072 ||
    Object.keys(value).some((key) => !['offset', 'jobTitle'].includes(key))
  )
    throw Error('Invalid signature position');
  return { jobTitle: titleInput(value.jobTitle ?? ''), offset: value.offset as number };
}
export function effectiveSignatureSettings(value: {
  signature: string;
  signatureSettings?: SignatureSettings;
}): SignatureSettings {
  return value.signatureSettings
    ? signatureSettingsInput(value.signatureSettings)
    : { mode: value.signature.trim() ? 'custom' : 'company', jobTitle: '' };
}
export function escapeSignatureHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
export function companySignature(
  email: string,
  name: string,
  jobTitle: string,
): { text: string; html: string } {
  if (!validEmail(email)) throw Error('Invalid signature account');
  const title = titleInput(jobTitle),
    person = name.trim(),
    identity = person || signatureCompany.name;
  const text = [
    '-- ',
    identity,
    ...(title ? [title] : []),
    ...(person ? [signatureCompany.name] : []),
    email,
    `${signatureCompany.phone} | ${signatureCompany.websiteLabel}`,
    signatureCompany.address,
  ].join('\n');
  const escaped = escapeSignatureHtml,
    link = 'color:#4b5963;text-decoration:none;';
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:540px;font-family:Arial,Helvetica,sans-serif;color:#4b5963;text-align:left;"><tbody><tr><td style="border-left:4px solid #801c18;padding:1px 0 1px 18px;word-break:break-word;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:26px;font-weight:700;color:#801c18;">${escaped(identity)}</div>${title ? `<div style="font-size:12px;line-height:20px;color:#52606a;padding-top:2px;">${escaped(title)}</div>` : ''}${person ? `<div style="font-size:11px;line-height:20px;font-weight:700;letter-spacing:1.2px;color:#263238;padding-top:10px;">ICONIC LOGISTICS</div>` : ''}<div style="font-size:12px;line-height:21px;padding-top:${person ? '5' : '10'}px;"><a href="mailto:${encodeURIComponent(email)}" style="${link}">${escaped(email)}</a></div><div style="font-size:12px;line-height:21px;"><a href="tel:${signatureCompany.phoneHref}" style="${link}">${signatureCompany.phone}</a><span style="color:#879199;padding:0 8px;">|</span><a href="${signatureCompany.website}" style="color:#801c18;text-decoration:none;">${signatureCompany.websiteLabel}</a></div><div style="font-size:11px;line-height:18px;color:#52606a;padding-top:8px;max-width:465px;">${signatureCompany.address}</div></td></tr></tbody></table>`;
  return { text, html };
}
export function signatureMessageHtml(
  text: string,
  payload: CompanySignaturePayload,
  email: string,
  name: string,
): string | undefined {
  const signature = companySignature(email, name, payload.jobTitle);
  if (text.slice(payload.offset, payload.offset + signature.text.length) !== signature.text)
    return undefined;
  const body = (value: string) =>
    escapeSignatureHtml(value).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#fff;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#263238;">${body(text.slice(0, payload.offset))}${signature.html}${body(text.slice(payload.offset + signature.text.length))}</div></body></html>`;
}
