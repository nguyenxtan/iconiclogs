# ICONIC Logs

Website công ty và webmail nội bộ, cùng bộ nhận diện ICONIC. Hai ứng dụng build
độc lập cho Cloudflare; không có Forwarding, Platform hay AI trong repo này.

## Chạy local

Yêu cầu Node.js 22.12+ và pnpm 12.16.1.

```sh
pnpm install --frozen-lockfile
pnpm dev:web
```

Website: `http://127.0.0.1:4321`. Menu dẫn đến trang giới thiệu, dịch vụ và năm
trang dịch vụ chi tiết, liên hệ và brochure Việt/Anh.

Mail cần hai terminal:

```sh
pnpm --filter @iconic/mail exec vite build
pnpm --filter @iconic/mail dev:api
```

```sh
pnpm dev:mail
```

Mail: `http://127.0.0.1:6070`; API Worker local ở `6071`. Nút **Xem bản mẫu** chỉ
có trong dev, dùng dữ liệu giả và không gửi thư ra ngoài. Bản production không
có demo. Mặc định Mail thật tắt; không có mật khẩu mặc định.

## Kiểm tra

```sh
pnpm check
pnpm test
pnpm build
pnpm --filter @iconic/mail test:runtime
pnpm exec playwright install chromium
pnpm test:e2e
pnpm format:check
```

Build Mail gồm Wrangler **dry-run**, không upload/deploy. Runtime test chạy
SQLite Durable Objects local, kiểm tra phiên mã hóa, alarm xóa credential,
đăng xuất và rate limit. E2E kiểm tra website và luồng Mail với dữ liệu giả.

## Cloudflare và mail thật

- `apps/web`: Astro HTML tĩnh, Workers Static Assets, cấu hình `wrangler.jsonc`.
- `apps/mail`: React/Vite và Hono Worker cùng origin; IMAP/SMTP qua Viettel.
  `SessionVault` giữ credential mã hóa trong phiên 30 phút; `MailboxCoordinator`
  lưu trạng thái chống gửi trùng. Hộp thư chính thức vẫn ở Viettel.
  Mail cần Workers Paid; cấu hình giới hạn CPU 30 giây/request. Chưa provision
  hoặc mua gói trong công việc này; CPU/bộ nhớ với MIME lớn cần đo trên cloud.
- `packages/brand`: logo, mark, font và token dùng chung.

Trước khi bật Mail, operator xác nhận host Viettel, tài khoản được phép,
thư mục Sent và hành vi tự lưu Sent. Tham khảo `.dev.vars.example` cho local;
production cấu hình secrets riêng trên Cloudflare. `SESSION_KEY` phải là 32 byte
ngẫu nhiên dạng Base64, không dùng key test. Không ghi credentials vào Git.

Không có route/domain production được gắn sẵn. Tên Worker mới không trùng bản
cũ. Deploy, DNS và việc bật `MAIL_ENABLED` là giai đoạn sau: phải xác nhận
IMAP/SMTP/TLS từ cloud, nhận/gửi thật, bản Sent, file đính kèm và quyền hộp thư.
Đặc biệt kiểm tra cách `mail.iconiclogs.com` đang phục vụ native mail client
trước khi dùng làm web hostname. Không trỏ MX vào webmail Worker.

**Trạng thái:** code local và cấu hình build; chưa có nghiệm thu gửi/nhận thật
cho bản mới và chưa deploy. Thiết kế, phạm vi và nguồn tài sản ở [docs/design.md](docs/design.md).
