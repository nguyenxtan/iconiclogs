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
có demo. Cấu hình local mẫu giữ Mail thật tắt; không có mật khẩu mặc định.

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

Khi cấu hình Mail, xác nhận host Viettel, tài khoản được phép,
thư mục Sent và hành vi tự lưu Sent. Tham khảo `.dev.vars.example` cho local;
production cấu hình secrets riêng trên Cloudflare. `SESSION_KEY` phải là 32 byte
ngẫu nhiên dạng Base64, không dùng key test. Không ghi credentials vào Git.

Mail dùng URL Workers riêng. `mail.iconiclogs.com` vẫn trỏ tới Viettel để
phục vụ các ứng dụng mail hiện có; không trỏ hostname này hay MX vào Worker.
Gửi/nhận thật, bản Sent và file đính kèm cần kiểm thử bằng tài khoản của chủ hộp thư.

## Trạng thái Cloudflare — 03/11/2026

Website xem trước: **https://iconiclogs-web.tan-nx2377.workers.dev**. Đã kiểm tra
các trang, favicon, 404, CSP và điều hướng mobile trên Cloudflare.

Mail: **https://iconiclogs-mail.tan-nx2377.workers.dev**. `MAIL_ENABLED=true`,
cho phép 7 hộp thư `admin`, `business`, `cs`, `customer`, `director`, `document`
và `info` tại `@iconiclogs.com` đăng nhập bằng mật khẩu Viettel hiện có.
`fwd@iconiclogs.com` là group do Viettel phân phối thư, không có
đăng nhập riêng trong webmail. Mật khẩu chỉ được nhập trên trang đăng nhập,
không lưu trong cấu hình deploy hoặc Git.

Cloudflare đã xác minh TLS và lời chào IMAP 993/SMTP 465 đến `mail.iconiclogs.com`,
cùng khả năng tạo/đọc MIME trong Worker. Hai Durable Object bindings và secret
`SESSION_KEY` đã cấu hình. Sent đang dùng IMAP APPEND, tự tìm thư mục `\\Sent`;
cần xác nhận hành vi tự lưu của Viettel khi kiểm thử gửi thật. Chưa nghiệm thu
đăng nhập, gửi/nhận, Sent và file đính kèm bằng hộp thư thật.

`iconiclogs-web` và `iconiclogs-mail` là hai Worker mới. Website/mail cũ và DNS/MX
chưa thay đổi. Thiết kế và nguồn tài sản ở [docs/design.md](docs/design.md).
