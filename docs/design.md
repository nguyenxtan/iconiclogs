# ICONIC Logs — thiết kế và phạm vi V1

Đã được chủ dự án duyệt ngày 02/11/2026. Code local trước, deploy sau.
Địa điểm: `code/iconic`; repo public `nguyenxtan/iconiclogs`.

## Mục tiêu

Website giới thiệu ICONIC đầy đủ thông tin và webmail nội bộ gửi/nhận được.
Forwarding không nằm trong dự án mới. Không mang cấu trúc Platform, AI hoặc
quy trình trial/staging/recovery của repo cũ sang sản phẩm mới.

## Nhận diện

Chủ dự án yêu cầu làm mới sau khi xem hai bản trước. Hướng hiện tại lấy hình ảnh
làm chủ đạo: nền trắng, xám mát `#F3F4F2`, đỏ ICONIC `#801C18`, chữ Be Vietnam
Pro; website không dùng tiêu đề serif hoặc nền beige. Logo và mark gốc giữ nguyên.

Hero là ảnh cảng lớn có lớp phủ và chữ trắng; desktop/mobile có crop riêng.
Dịch vụ dùng lưới ảnh bất đối xứng; hải quan là ô đỏ. Giới thiệu dùng dải đỏ,
quy trình là timeline và liên hệ là khối xám. Trang con có hero ảnh theo dịch vụ,
phạm vi rõ ràng và panel thông tin cần chuẩn bị. Hải quan không dùng ảnh gán ghép.

Claude chỉ tư vấn hướng thiết kế và prompt; người triển khai tự làm code và
ảnh. Bộ bốn ảnh mới tạo bằng imagegen có prompt và đường dẫn ở
`apps/web/src/content/image-prompts.json`. Ảnh WebP được lưu trong
`apps/web/public/visuals/photographic`; ảnh là minh họa, không khẳng định quyền
sở hữu phương tiện hoặc cơ sở của ICONIC.

## Website

Trang chủ; Về ICONIC; tổng quan Dịch vụ; năm trang chi tiết đường biển, hàng
không, đường bộ, hải quan, kho bãi/phân phối; Liên hệ; Brochure Việt/Anh.
Cách phối hợp có phần riêng trên trang chủ. Trang con có breadcrumb, menu,
metadata, canonical, sitemap và bố cục mobile. Nội dung lấy từ source công ty
đã có, không thêm số liệu, đối tác hoặc năng lực chưa được xác nhận.

Liên hệ trực tiếp bằng email và điện thoại; không có form gửi thư giả. Brochure
là PDF gốc từ repo cũ; cần chủ dự án duyệt lại nội dung/tính cập nhật trước deploy.

## Mail

Đăng nhập; Inbox và Sent có phân trang; đọc thư; tải file; soạn/trả lời và đính
kèm; gửi, lưu Sent và đăng xuất. Có loading, empty, lỗi, hết phiên và kết quả
SMTP chưa xác định. Bản mẫu chỉ tồn tại trong dev và được ghi nhãn rõ ràng.
Không có đăng ký công khai hoặc tài khoản/mật khẩu mặc định.

Composer chỉ giữ trong bộ nhớ tab và cảnh báo khi bỏ nội dung; không hứa phục
hồi draft sau reload. Sidebar chỉ lưu lựa chọn thu gọn, không lưu mail/secrets.
Calendar, contacts, SSO, AI, search nâng cao, drafts sync, move/delete và R2
archive/restore để sau.

## Kiến trúc

```text
apps/web                 Astro static → Cloudflare Workers Static Assets
apps/mail/src/ui         React + Vite
apps/mail/src/shared     DTO hợp đồng UI/API
apps/mail/src/server
  http                   Hono: HTTP, origin, CSRF, cookie, body limits
  core                   validation, phiên mã hóa, trạng thái gửi, provider port
  providers              Viettel IMAP/SMTP và MIME qua thư viện
  storage                SessionVault / MailboxCoordinator Durable Objects
packages/brand           logo, mark, font và CSS tokens
```

Hai app deploy riêng; chỉ chia sẻ brand. Cloudflare Workers/SQLite Durable
Objects là runtime cho cả local và production, thay cho Node/SQLite riêng đã
được cân nhắc ban đầu. Hộp thư và MIME chính thức vẫn do Viettel quản lý.
Không tạo một database thứ hai sao chép toàn bộ mailbox.

## Các ranh giới quan trọng

- Provider host/tài khoản được phép cấu hình phía server; không nhận host tùy ý
  từ client. TLS xác minh hostname/chứng chỉ, IMAP 993 và SMTP 465.
- Browser chỉ có opaque SID HttpOnly; production Secure/SameSite Strict.
  Mutation kiểm tra origin và CSRF. Credential AES-GCM ở server, key ngoài Git,
  hết hạn tuyệt đối 30 phút, thu hồi và alarm cleanup; login có rate limit.
- HTML được sanitize và render trong iframe sandbox, ảnh/link ngoài tắt.
  File download yêu cầu phiên và đúng message của mailbox đang đăng nhập.
- Tổng MIME giới hạn 10 MiB; UI hạn chế file ở 7 MiB để chừa encoding.
- Trước SMTP, ghi bền vững idempotency key và fingerprint theo mailbox. Không
  tự gửi lại khi timeout/unknown. SMTP accepted không đồng nghĩa đã đến inbox.
  SMTP và Sent là hai kết quả riêng; Sent lỗi không làm gửi lại email.
- Trước deploy phải xác nhận Viettel tự lưu Sent hay cần APPEND, tránh bản trùng.

## Tái sử dụng

Repo nguồn: `nguyenxtan/iconic-logistics-platform`, đọc/tải từng file, không clone.
Logo PNG từ `packages/ui-brand/assets`; brand colors từ `tokens.css`; ảnh WebP
và brochure từ `apps/public-web/public`; nội dung công ty/dịch vụ/liên hệ từ
`site-content.ts` và các trang cũ. Ảnh logistics là artwork minh họa do dự án cũ
tạo, không phải bằng chứng ICONIC sở hữu tàu, cảng hay phương tiện.

Mark SVG mô tả các hình khối của logo hiện có để dùng ở kích thước icon; PNG
gốc giữ nguyên. Thư viện font giữ giấy phép trong dependency; không lấy dữ liệu,
credential, cloud state hoặc config vận hành bí mật từ repo cũ.

## Kế hoạch và tiêu chí hoàn tất

1. Workspace/brand và cấu hình Cloudflare; chọn tài sản có nguồn rõ.
2. Website đủ các trang, liên kết, metadata, responsive và nội dung thực.
3. Backend: validation, TLS provider, session, CSRF/rate limit, idempotency/Sent.
4. UI: login/browse/read/compose/reply/file/send/logout, sidebar và sandbox.
5. Typecheck, unit/integration tests, native Worker/DO tests, E2E desktop/mobile,
   accessibility, build dry-run và Claude review; sửa lỗi quan trọng trước bàn giao.

Review tập trung vào file/MIME lớn, HTML độc hại, session expiry/revoke, gửi
đồng thời, SMTP unknown, Sent APPEND lỗi và hoạt động thực của Workers runtime.
Local test không chứng minh SMTP, delivery hoặc quyền mailbox production.

Deploy dùng Worker mới độc lập với hệ thống cũ. Kiểm chứng provider trên cloud
và xác nhận nhận/gửi/file/Sent bằng hộp thư thật. `mail.iconiclogs.com` đang phục vụ
native mail client nên giữ tại Viettel; không thay hostname này hoặc MX sang Worker.

## Review và chỉnh sửa

Claude review read-only ngày 02/11: giao diện đầu chưa đạt; đã chỉ rõ lỗi bố cục,
ảnh viền/chữ cắt, logo khó đọc và copy lặp. Người triển khai tự sửa theo hướng
hero hai cột, ít khẩu hiệu, thang chữ rõ, dịch vụ dạng hàng, footer gọn; không
gọi thêm Claude để sửa hoặc review lại. Chưa có nghiệm thu gu thiết kế từ chủ dự án.

Đã sửa preflight gửi trước claim, trạng thái Sent do provider quản lý không
được coi là đã xác nhận; lỗi auth thu hồi phiên; download theo MIME part; cache
đường dẫn Sent 10 phút và giới hạn CPU Worker. Các điểm chỉ có thể kiểm chứng
trên cloud (TLS/SMTP/Sent thật, CPU/RAM, provider throttle) giữ ở bước deploy.

Các chi tiết chưa mở rộng trong V1: nối toàn bộ References, tên hiển thị From,
link HTML có thể bấm, và chính sách xóa send ledger. Không tự xóa ledger theo
gợi ý 7 ngày vì replay key cũ có thể gửi trùng. Bundle production đã được kiểm
tra không có dữ liệu hay nút demo; import tĩnh hiện được tree-shake.

## Cấu hình Cloudflare — 03/11/2026

Đã đăng nhập qua OAuth và deploy website lên Worker mới `iconiclogs-web`,
có link xem trước `https://iconiclogs-web.tan-nx2377.workers.dev`. Mail ở
`https://iconiclogs-mail.tan-nx2377.workers.dev`, bật cho 7 hộp thư công ty đã xác
nhận trong `MAIL_ALLOWED_USERS`; group `fwd@iconiclogs.com` giữ tại Viettel.
SESSION_KEY sinh ngẫu nhiên, không lưu giá trị trong repo; mật khẩu do người dùng
nhập lúc đăng nhập. Cloudflare đã kiểm tra TLS/lời chào IMAP 993, SMTP 465 và MIME.
Sent mặc định APPEND vào thư mục tự nhận diện; chưa nghiệm thu tài khoản thật,
gửi/nhận, Sent hoặc file đính kèm. Đã sửa lỗi socket IMAP phát sự kiện ngoài Promise
và thêm regression test. Custom domains, DNS/MX và các Worker cũ không thay đổi.

## Mail login — 04/11/2026

Thay màn hình đăng nhập bằng nền xám mát, khung trắng có giới hạn chiều rộng,
form bên trái và ảnh cảng tông mát bên phải. Logo ngang ghép mark gốc với wordmark
gốc; tiêu đề dùng Be Vietnam Pro. Mobile tập trung vào form. Giữ luồng đăng nhập,
autocomplete, trạng thái chờ/lỗi và bản mẫu chỉ trong dev.

Thực hiện trong `Login.tsx` và `login.css`; gỡ các rule login cũ khỏi stylesheet
chung. Tái sử dụng ảnh đã tạo cho website, không thêm dependency. Kiểm tra bố cục
desktop/mobile, khả năng truy cập, submit lỗi/chờ và E2E trước khi deploy Mail.
