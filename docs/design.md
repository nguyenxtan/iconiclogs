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

Bản nháp, chữ ký và danh bạ mã hóa trong PersonalState theo mailbox, tồn tại
qua tải lại trang/đăng nhập. Bản nháp là dữ liệu ICONIC Mail, chưa đồng bộ thư
mục Drafts của Viettel. Sidebar chỉ lưu lựa chọn thu gọn trong trình duyệt.
Calendar, SSO, AI, bộ lọc chạy ở máy chủ và trả lời khi vắng mặt để sau;
cần xác minh API/quyền phía Viettel trước khi tích hợp.

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

## Mail mở rộng — 04/11/2026

Chủ dự án yêu cầu triển khai các thao tác hằng ngày cùng backup. Login đổi sang
ảnh cảng toàn màn hình, blur 4px và lớp phủ 15%; form kính trắng có viền/bóng tạo
chiều sâu, responsive và focus rõ. Không thêm ảnh AI hoặc thư viện mới.

Mail có tìm kiếm/từ khóa/người gửi/ngày/chưa đọc/sao/file, thư mục thực, tạo thư
mục, chọn nhiều, gắn sao và chuyển thư (Thùng rác là MOVE, không xóa vĩnh viễn).
MOVE chỉ chạy khi server hỗ trợ thao tác an toàn; UIDVALIDITY và UID được xác minh.
Soạn thư thêm reply-all, forward kèm file, Bcc, tên hiển thị/tên gửi đúng tài khoản,
chữ ký và gợi ý danh bạ. Inbox làm mới mỗi 60 giây khi tab đang hiển thị; quota
chỉ hiện khi Viettel cung cấp. Bộ lọc đính kèm giới hạn 5.000 ứng viên và báo lỗi
thu hẹp tìm kiếm nếu vượt, không trả kết quả thiếu âm thầm.

PersonalState lưu draft theo revision, tối đa 20 bản / 50 MiB, chunks mã hóa AES-GCM
trong transaction SQLite. Bản nháp cho phép người nhận nhập dở; send vẫn kiểm tra
chặt. Trước SMTP phải lưu deliveryKey và guard unknown; khi kết quả không rõ hoặc
partial, guard tồn tại qua mở lại bản nháp. Chỉ kết quả sent mới xóa bản nháp.

BackupCoordinator giữ trạng thái/chỉ mục mã hóa; MIME nguyên gốc mã hóa trong R2
riêng tư `iconiclogs-mail-backups`. BACKUP_KEY riêng SESSION_KEY, không nằm trong
Git. Capture theo từng bước có thể tiếp tục; giữ ngày nhận/flags/file, kiểm tra
SHA-256 và UIDVALIDITY. Thư >10 MiB khiến lượt partial, không được báo hoàn tất.
Sao lưu hằng ngày chỉ bật bằng thao tác rõ ràng của từng chủ hộp thư; lúc đó mới
lưu credential mã hóa độc lập với phiên 30 phút. Tắt thu hồi credential, giữ lịch sử.

Catalog lọc theo ngày Việt Nam; tải EML và khôi phục thêm bản sao vào thư mục đã
chọn sau xác nhận. Ledger request và content/target ghi trước APPEND; mất phản hồi
hiển thị uncertain và không tự nhập lại. Không xóa nguồn/retention purge. Đây là
bản sao ở Cloudflare, chưa có bản dự phòng ở nhà cung cấp độc lập hoặc snapshot
mail-server. Mọi cloud/SMTP thật phải được kiểm chứng riêng với chủ hộp thư.

Claude review read-only một lượt: đã sửa lỗi phân loại trước APPEND, sửa lại object
R2 hỏng từ MIME gốc, seen UID index và batch tối đa 5 thư/2 MiB (một thư lớn riêng
đến 10 MiB), retry có backoff tối đa 5 lần, bỏ Deleted/Draft/Recent khi restore.
Mật khẩu bị từ chối tạm dừng lịch và hiện thao tác cập nhật quyền; xóa tài khoản
khỏi allowlist thu hồi quyền sao lưu tự động. Bản nháp lost-response được đối
chiếu nội dung ở revision kế tiếp, không ghi đè thay đổi của tab khác. Catalog
giữ flags ở lần capture đầu; restore cùng nội dung/đích được chống lặp và chưa có
thao tác ép tạo bản mới sau khi người dùng xóa bản đã restore.

## Login theo mẫu và chữ ký — 04/11/2026

Chủ dự án cung cấp ảnh tham chiếu: cảng hoàng hôn rõ nét toàn màn hình, khẩu hiệu
hai dòng ở trái, box ivory bên phải với logo gốc bên trong, ICONIC Mail, nút xem
mật khẩu, hỗ trợ đăng nhập/cấu hình và copyright trong box. Đã thay ảnh ban ngày
bằng `login-port-sunset.webp`, tạo bằng imagegen theo bố cục/tông màu tham chiếu
(chỉ ảnh nền, không sinh logo/chữ/UI); bỏ hai ảnh login cũ không còn dùng.

Chữ ký có mẫu công ty, văn bản riêng và tắt; mặc định mẫu công ty khi chưa có
cài đặt hay chữ ký cũ. Nội dung liên hệ lấy từ company.ts; tên/chức danh do người
dùng chỉnh, email lấy từ tài khoản đã xác thực. Preview dùng cùng renderer với
MIME gửi ra. Payload chỉ có chức danh/vị trí đoạn văn bản, không nhận HTML tùy ý;
server xác minh đúng block rồi tạo HTML table với mọi trường cá nhân/body được
escape và multipart text/plain dự phòng. Sửa chữ ký hay lịch sử trích dẫn mơ hồ
thì gửi plain text, không định dạng nhầm chữ ký cũ trong chuỗi forward/reply.

Review chéo kiểm tra ảnh desktop/mobile và code; UI test bổ sung toàn bộ thao tác
thư, bộ lọc, soạn/trả lời/chuyển tiếp/file, draft qua hết phiên/đăng nhập và chữ ký.
Chủ dự án cho phép thử với Gmail cá nhân được chỉ định; chỉ dùng thư/file tổng hợp có mã
ICONIC-QA, không đưa thư khách hàng sang Gmail. Nghiệm thu thật được ghi riêng,
không coi kiểm thử UI bằng fixture là bằng chứng delivery Viettel.
