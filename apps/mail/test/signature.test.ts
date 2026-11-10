import { expect, it } from 'vitest';
import {
  companySignature,
  effectiveSignatureSettings,
  signatureSettingsInput,
} from '../src/shared/signature';

it('defaults empty preferences to the company template while preserving existing custom text', () => {
  expect(effectiveSignatureSettings({ signature: '' })).toEqual({ mode: 'company', jobTitle: '' });
  expect(effectiveSignatureSettings({ signature: 'Regards,\nTeam' })).toEqual({
    mode: 'custom',
    jobTitle: '',
  });
  expect(
    effectiveSignatureSettings({
      signature: 'Saved text',
      signatureSettings: { mode: 'off', jobTitle: '' },
    }).mode,
  ).toBe('off');
});
it('renders only verified company contact details and escaped chosen personal fields', () => {
  const result = companySignature(
    'owner@iconiclogs.com',
    'An <img src=x onerror=alert(1)>',
    'CS & Operations',
  );
  expect(result.text).toContain('owner@iconiclogs.com');
  expect(result.text).toContain('0839 037 568');
  expect(result.text).toContain('25/49 Đường 6, Khu phố 26, Phường Hiệp Bình, TP.HCM, Việt Nam');
  expect(result.html).toContain('https://iconiclogs.com');
  expect(result.html).toContain('An &lt;img src=x onerror=alert(1)&gt;');
  expect(result.html).toContain('CS &amp; Operations');
  expect(result.html).not.toMatch(/<img|<script|onerror="/);
  expect(companySignature('owner@iconiclogs.com', '', '').text).toContain(
    'ICONIC Logistics\nowner@iconiclogs.com',
  );
});
it('rejects unknown templates, arbitrary HTML and injected or oversized job titles', () => {
  for (const value of [
    { mode: 'html', jobTitle: '' },
    { mode: 'company', jobTitle: 'X\r\nY' },
    { mode: 'company', jobTitle: 'x'.repeat(101) },
    { mode: 'company', jobTitle: '', html: '<script>x</script>' },
  ])
    expect(() => signatureSettingsInput(value)).toThrow();
});
it('keeps literal contact separator spaces when an email viewer removes all styling', () => {
  expect(companySignature('cs@iconiclogs.com', 'An', '').html).toMatch(/<span[^>]*> \| <\/span>/);
});
