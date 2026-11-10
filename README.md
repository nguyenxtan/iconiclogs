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

URL production: Web tại `https://iconiclogs.com`, Mail tại
`https://mail.iconiclogs.com`. IMAP/SMTP dùng trực tiếp `hl-mail29.viettelidc.com.vn`;
MX vẫn ở Viettel. Hướng dẫn Outlook và Apple Mail (Mac/iPhone/iPad) có ngay trên
màn hình đăng nhập → Hướng dẫn cài đặt: IMAP 993, SMTP 465, SSL/TLS và xác thực
bằng địa chỉ email đầy đủ cùng mật khẩu Viettel. `webmail.iconiclogs.com` giữ lối
vào giao diện Viettel. Công ty xác nhận hiện chỉ dùng webmail.
Gửi/nhận thật, bản Sent và file đính kèm cần kiểm thử bằng tài khoản của chủ hộp thư.

## Trạng thái Cloudflare — 07/11/2026

Website: **https://iconiclogs.com**. Đã kiểm tra
các trang, favicon, 404, CSP và điều hướng mobile trên Cloudflare.

Mail: **https://mail.iconiclogs.com**. `MAIL_ENABLED=true`,
cho phép 7 hộp thư `admin`, `business`, `cs`, `customer`, `director`, `document`
và `info` tại `@iconiclogs.com` đăng nhập bằng mật khẩu Viettel hiện có.
`fwd@iconiclogs.com` là group do Viettel phân phối thư, không có
đăng nhập riêng trong webmail. Mật khẩu chỉ được nhập trên trang đăng nhập,
không lưu trong cấu hình deploy hoặc Git.

Cloudflare đã xác minh TLS và lời chào IMAP 993/SMTP 465 đến `hl-mail29.viettelidc.com.vn`,
cùng khả năng tạo/đọc MIME trong Worker. Secret `SESSION_KEY` đã cấu hình. Sent đang dùng IMAP APPEND, tự tìm thư mục `\\Sent`;
cần xác nhận hành vi tự lưu của Viettel khi kiểm thử gửi thật. Đã xác minh đăng nhập và đọc Inbox thật bằng cs@iconiclogs.com ngày 04/11.
Đã kiểm thử vòng gửi/nhận, Sent, file và restore trên tài khoản CS với chủ hộp
thư. Các tài khoản khác cần chủ tài khoản kiểm tra thông tin đăng nhập riêng.

`iconiclogs-web` và `iconiclogs-mail` phục vụ hai tên miền chính. Worker web cũ được giữ để rollback.
`www` giữ chuyển hướng 308 sang tên miền chính; MX không đổi. Thiết kế và nguồn tài sản ở [docs/design.md](docs/design.md).

Nghiệm thu CS ngày 10/11: quota hộp thư 500 MiB được tách riêng, sao lưu hoàn tất,
tải ZIP tháng qua UI và khôi phục thư thử có tệp 18 MiB khớp mã băm gốc.
Đã kiểm chứng Gmail → FWD → CS → Gmail, chữ ký công ty và trích dẫn sạch;
Gmail xác nhận SPF/DKIM/DMARC đều pass. Thư thử lớn ngày 07/11 đã được SMTP chấp nhận
và lưu Sent nhưng chưa thấy ở Gmail, cần báo cáo giao thư Viettel để xác định.
Đăng nhập production của Info/Document và phân phối tới các thành viên FWD khác cần kiểm tra riêng.

## Mail mở rộng

Tìm kiếm/lọc, thư mục, thao tác nhiều thư, sao, Thùng rác, reply-all, forward,
Bcc, chữ ký/danh bạ và bản nháp tự lưu. `PersonalState` giữ dữ liệu cá nhân mã hóa,
`BackupCoordinator` quản lý sao lưu và restore; migration v2 thêm hai DO này.
Backup cần private R2 binding `BACKUP_BUCKET` và secret `BACKUP_KEY` (32 byte Base64,
khác SESSION_KEY). Sao lưu tự động theo ngưỡng 80% chỉ bật qua Cài đặt → Sao lưu của từng tài khoản.
Kiểm tra quota Viettel mỗi giờ, bắt đầu capture khi hộp thư hoặc gói dùng chung đạt 80%; nếu vẫn trên
ngưỡng, các lượt cập nhật cách nhau tối thiểu 24 giờ. Quota thiếu/lỗi không tự
khởi động capture. Tắt tự động thu hồi credential đã lưu; lịch sử giữ nguyên. Khôi phục thêm bản sao,
không xóa nguồn. Giới hạn thư MIME 25 MiB, tổng tệp đính kèm khi soạn 18 MiB; trường hợp lỗi/quá lớn hiển thị rõ.

Viettel trả nhiều quota root: Mailbox 500 MiB và cPanel Account 5 GiB. Bản vá
ImapFlow được ghim trong `patches/`, giữ tài nguyên riêng cho từng root; giao diện
hiển thị hai phạm vi và ngưỡng dùng tỷ lệ cao nhất. Số liệu cũ bị gộp được bỏ để đọc lại,
giữ nguyên opt-in, checkpoint và cooldown.

Kho chính là ZIP nén theo hộp thư/năm/tháng (ngày nhận UTC+7), mã hóa trên R2;
tải ZIP chuẩn hoặc khôi phục từng thư/cả tháng. Đóng gói và xác minh có checkpoint,
không gom cả tháng vào RAM; bản cũ được giữ trong lúc cập nhật. Gói tháng chỉ gồm
thư đã capture, không thay thế cảnh báo lượt partial/lỗi. ZIP32 giới hạn dưới
4 GiB và dưới 65.534 thư/gói; vượt giới hạn được báo lỗi và giữ bản gốc.

Review Claude đã chỉ ra lỗi preflight restore, sửa object backup hỏng và retry;
đã bổ sung kiểm thử hồi quy. Sao lưu không tải lại MIME từ Viettel nếu UID cùng
UIDVALIDITY đã có bản R2 xác minh được. Lỗi xác thực tạm dừng lịch; đăng nhập bằng
mật khẩu mới và chọn cập nhật quyền sao lưu để tiếp tục. Restore uncertain cần
đối chiếu thủ công; hiện chưa có chức năng ép khôi phục lại cùng nội dung/đích.
