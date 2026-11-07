import type { MailPreferences } from '../shared/contracts';
import {
  companySignature,
  effectiveSignatureSettings,
  type SignatureSettings,
} from '../shared/signature';
import './signature.css';

export function SignaturePreview({
  email,
  name,
  jobTitle,
  compact = false,
}: {
  email: string;
  name: string;
  jobTitle: string;
  compact?: boolean;
}) {
  let signature: ReturnType<typeof companySignature>;
  try {
    signature = companySignature(email, name, jobTitle);
  } catch {
    return (
      <p className="settings-error" role="alert">
        Kiểm tra tên tài khoản và chức danh trước khi xem chữ ký.
      </p>
    );
  }
  return (
    <div className={`signature-preview${compact ? ' is-compact' : ''}`}>
      <div className="signature-preview-label">
        <span>XEM TRƯỚC · CHỮ KÝ</span>
        <span>ICONIC</span>
      </div>
      <div
        className="signature-preview-paper"
        onClick={(event) => event.preventDefault()}
        role="region"
        aria-label="Xem trước chữ ký công ty"
        dangerouslySetInnerHTML={{ __html: signature.html }}
      />
    </div>
  );
}
export function SignatureEditor({
  value,
  email,
  disabled = false,
  onChange,
}: {
  value: MailPreferences;
  email: string;
  disabled?: boolean;
  onChange(value: MailPreferences): void;
}) {
  const settings = effectiveSignatureSettings(value);
  const select = (mode: SignatureSettings['mode']) =>
    onChange({ ...value, signatureSettings: { ...settings, mode } });
  return (
    <div className="signature-editor">
      <fieldset className="signature-choices" disabled={disabled}>
        <legend>Phong cách chữ ký</legend>
        {(
          [
            ['company', 'Mẫu công ty', 'Nhận diện ICONIC Logistics'],
            ['custom', 'Văn bản riêng', 'Giữ lời chào theo cách của bạn'],
            ['off', 'Không dùng', 'Soạn thư không có chữ ký'],
          ] as const
        ).map(([mode, title, detail]) => (
          <label key={mode} className={settings.mode === mode ? 'is-selected' : ''}>
            <input
              type="radio"
              name="signature-mode"
              value={mode}
              checked={settings.mode === mode}
              onChange={() => select(mode)}
            />
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {settings.mode === 'company' && (
        <>
          <div className="settings-field signature-title-field">
            <label htmlFor="signature-job-title">
              Chức danh <span>(không bắt buộc)</span>
            </label>
            <input
              id="signature-job-title"
              value={settings.jobTitle}
              maxLength={100}
              disabled={disabled}
              placeholder="Nhập chức danh của bạn"
              onChange={(event) =>
                onChange({
                  ...value,
                  signatureSettings: { ...settings, jobTitle: event.target.value },
                })
              }
            />
            <small>
              Tên hiển thị ở trên và email đang đăng nhập sẽ xuất hiện trong mẫu công ty.
            </small>
          </div>
          <SignaturePreview email={email} name={value.displayName} jobTitle={settings.jobTitle} />
          <p className="signature-caption">
            Mẫu này được gửi kèm bản văn bản thuần để người nhận đọc được trong mọi ứng dụng email.
          </p>
        </>
      )}
      <div className="settings-field signature-custom-field">
        <div className="settings-label-row">
          <label htmlFor="settings-signature">Chữ ký</label>
          <small>{value.signature.length.toLocaleString('vi-VN')} / 4.000</small>
        </div>
        <textarea
          id="settings-signature"
          rows={4}
          value={value.signature}
          maxLength={4000}
          disabled={disabled}
          placeholder={'Lời chào hoặc nội dung chữ ký riêng của bạn…'}
          onChange={(event) =>
            onChange({
              ...value,
              signature: event.target.value,
              signatureSettings: { ...settings, mode: 'custom' },
            })
          }
        />
        <small>
          {settings.mode === 'custom'
            ? 'Văn bản riêng được thêm khi bắt đầu soạn thư.'
            : 'Nhập nội dung ở đây để chuyển sang chữ ký văn bản riêng.'}
        </small>
      </div>
      {settings.mode === 'custom' && value.signature && (
        <div className="signature-custom-preview">
          <span className="signature-preview-label">XEM TRƯỚC · VĂN BẢN RIÊNG</span>
          <pre>{value.signature}</pre>
        </div>
      )}
      {settings.mode === 'off' && (
        <p className="signature-caption">
          Nội dung đã lưu vẫn được giữ. Thư mới sẽ không tự thêm chữ ký.
        </p>
      )}
    </div>
  );
}
