# ICONIC Logs — thiết kế website và Mail V1

Trạng thái: bản thiết kế để chủ dự án duyệt, chưa triển khai sản phẩm.
Ngày: 02/11/2026.

## Mục tiêu và quyết định đã có

Xây lại trong `code/iconic`, repo public `nguyenxtan/iconiclogs`. Chỉ phục vụ
website giới thiệu ICONIC và email nội bộ mang thương hiệu ICONIC. Forwarding
được loại khỏi phạm vi mới. Làm local trước, deploy sau; không thay đổi hệ thống
đang chạy trong giai đoạn này. Repo cũ chỉ đọc chọn lọc, không clone toàn bộ.

Chủ dự án chọn diện mạo A: sáng, tinh tế; nền trắng ngà, chữ rõ, đỏ ICONIC làm
điểm nhấn. Yêu cầu clean code và kiến trúc vừa với nhu cầu gửi/nhận mail.

## Các phương án đã xem xét

- A: phong cách editorial sáng, khoảng trắng rộng, hình logistics có chọn lọc;
  phù hợp cả website thương hiệu và công cụ đọc mail. Chủ dự án đã chọn A.
- B: nền tối, chữ lớn, phong cách công nghiệp; nổi bật cho landing nhưng cần
  điều chỉnh đáng kể để đọc mail lâu. Không chọn cho V1.

Về kỹ thuật, khuyến nghị xây ứng dụng mới và lấy có chọn lọc tài sản/ý tưởng
đã kiểm chứng. Chép toàn bộ hệ thống cũ mang theo thử nghiệm và phần ngoài phạm
vi; viết lại cả giao thức email thì không cần thiết. Dùng thư viện IMAP/SMTP.
Các lựa chọn kỹ thuật dưới đây là đề xuất của người triển khai để duyệt cùng
tài liệu, không phải quyết định mà chủ dự án đã xác nhận riêng.

## Nhận diện và giao diện

Giữ logo ICONIC gốc, dùng PNG hiện có khi chưa có vector thật. Không tự vẽ lại
logo. Các file SVG cũ được Claude báo là PNG nhúng, không coi là vector nguồn.

Màu kế thừa từ `packages/ui-brand/tokens.css` của repo cũ:

| Vai trò | Màu |
| --- | --- |
| Đỏ thương hiệu / hành động chính | `#801C18` |
| Hover thương hiệu | `#5E120F` |
| Chữ chính | `#201D1A` |
| Chữ phụ | `#665F58` |
| Nền trang | `#FAF7F1` |
| Bề mặt nội dung | `#FFFFFF` |
| Đồng trang trí | `#B47750` |

Màu đồng dùng cho đường nét/trang trí, không mặc định dùng cho chữ nhỏ. Kiểm
tra tương phản của chữ, control và focus ở từng cách kết hợp màu thực tế.
Đề xuất Be Vietnam Pro cho UI và nội dung; Source Serif 4 dùng tiết chế cho
tiêu đề landing. Font có fallback hệ thống và được lưu kèm giấy phép khi đưa
vào repo. Mail dùng sans-serif dễ đọc, tránh kiểu chữ trang trí trong thư.

Nhịp khoảng cách cơ sở 4px, góc bo nhỏ, đường phân cách nhẹ. Ưu tiên bố cục,
typography và hình ảnh thay vì hiệu ứng. Hỗ trợ bàn phím, focus rõ, reduced
motion, màn hình nhỏ và thông báo trạng thái dễ hiểu.

### Landing page

Một trang chủ tiếng Việt với các phần: header và điều hướng; hero giới thiệu
ICONIC và nút liên hệ; giới thiệu công ty; dịch vụ; cách phối hợp; mạng lưới
hoặc phạm vi phục vụ nếu có nguồn xác thực; brochure nếu tài liệu còn đúng;
liên hệ và footer. Có liên kết vào Mail dành cho nhân viên.

Tận dụng thông tin công ty/dịch vụ/liên hệ từ source cũ sau khi kiểm tra. Không
đưa tính năng Forwarding, lời hứa về Platform/AI hoặc số liệu chưa xác nhận lên
website. Dùng ảnh cũ phù hợp hoặc tài sản đã rõ quyền sử dụng. Các địa chỉ liên
hệ và tài liệu brochure phải được rà lại trước deploy.

Nội dung chính render thành HTML tĩnh; có title, description, canonical,
Open Graph, sitemap, robots và bố cục mobile. V1 dùng liên kết email/điện thoại
cho liên hệ, chưa thêm form gửi thư công khai. Các trang con và bản tiếng Anh
là phần mở rộng sau, không phải điều kiện để ra mắt trang chủ.

### Mail

Đăng nhập có logo và phong cách cùng website; màn hình desktop có danh sách
thư mục, danh sách thư và vùng đọc. Mobile chuyển từng màn hình có nút quay
lại rõ ràng. Composer hiển thị người nhận, tiêu đề, nội dung và file đính kèm.

V1 gồm: đăng nhập hộp thư được phép; Inbox và Sent; phân trang; đọc thư và file
đính kèm; soạn, trả lời và gửi; lưu Sent; đăng xuất. Có trạng thái đang tải,
trống, hết phiên, mất kết nối, gửi lỗi và chưa xác định kết quả gửi.

Composer lưu trong bộ nhớ của tab, không lưu thư/mật khẩu vào localStorage.
Cảnh báo trước khi bỏ nội dung chưa gửi; V1 chưa hứa khôi phục draft khi reload.
Forward, tìm kiếm nâng cao, đồng bộ drafts, move/delete, danh bạ, lịch, IDLE,
SSO, AI và archive/restore R2 để sau. Không tự tạo tài khoản, đăng ký công khai
hoặc suy ra quyền truy cập từ đuôi địa chỉ email.

## Kiến trúc đề xuất

Monorepo pnpm với TypeScript; các ứng dụng build/deploy độc lập:

```text
apps/
  web/                 # Astro, HTML tĩnh; JavaScript chỉ khi cần tương tác
  mail/
    src/ui/            # React + Vite
    src/server/http/   # Hono: route, session, validation, lỗi HTTP
    src/server/core/   # use case và contract nghiệp vụ mail
    src/server/providers/ # adapter Viettel qua IMAP/SMTP
    src/server/storage/   # session và trạng thái gửi bền vững
packages/
  brand/               # logo, màu, typography, icon dùng chung
docs/                  # thiết kế, cách chạy và hướng dẫn vận hành
```

Không tạo framework nội bộ, generic repository hay package dùng chung cho logic
chỉ có một ứng dụng sử dụng. UI không gọi Viettel trực tiếp. Server giữ trách
nhiệm xác thực, quyền hộp thư, validation, phiên và trạng thái gửi. Các interface
nhỏ cho MailProvider, SessionStore và SendStore nhằm kiểm thử và đổi adapter
lưu trữ/runtime khi cần; không xây nhiều implementation cloud trước khi có nhu cầu.

Mail UI và API chạy cùng origin, API ở `/api`. Local chạy server Node cùng
storage SQLite nằm ngoài source control. Database chỉ giữ phiên và trạng thái
gửi; không sao chép toàn bộ hộp thư vào database. Message MIME chính thức vẫn
do Viettel quản lý. Kết nối IMAP/SMTP dùng thư viện duy trì sẵn, không tự triển
khai giao thức hoặc tự hạ tiêu chuẩn TLS để vừa một runtime.

Cloudflare là hướng hosting tiếp nối, chưa phải quyết định rằng mọi backend
phải chạy Workers. Landing tĩnh không phụ thuộc mail runtime. Trước deploy Mail
cần chứng minh IMAP, SMTP và lưu Sent trên runtime cloud thực; nếu Workers
không đáp ứng thì chọn Node runtime phù hợp qua quyết định triển khai riêng.
Không tự mua server hoặc provision Container trong giai đoạn code local.

## Phiên đăng nhập và nội dung thư

- Hộp thư công ty được cấu hình cho phép ở server; không nhận host IMAP/SMTP
  tùy ý từ browser. Không mặc định chỉ một địa chỉ admin được dùng sản phẩm.
- Mật khẩu chỉ được gửi khi đăng nhập; không gửi lại từ UI trong mỗi API call.
  Không trả mật khẩu/token provider xuống browser hoặc ghi log.
- Browser giữ opaque session ID trong HttpOnly cookie; production dùng Secure
  và SameSite phù hợp. Các mutation kiểm tra origin và chống CSRF. Local HTTP
  có chế độ dev rõ ràng, không làm yếu cấu hình production.
- Credentials chỉ giữ mã hóa phía server, đề xuất phiên tuyệt đối 30 phút,
  không tích hợp Platform. Logout/expiry thu hồi quyền ngay; cleanup dữ liệu
  credential hết hạn có lịch và được kiểm thử độc lập với inbound request.
- Key mã hóa nằm ở cấu hình riêng ngoài Git; repo public chỉ có template trống.
  Giới hạn login và số kết nối/request để tránh thử mật khẩu hàng loạt.
- TLS xác minh chứng chỉ/hostname bắt buộc. Endpoint provider phải xác nhận
  từ cấu hình vận hành trước khi dùng thật, không suy từ tên miền web.
- HTML email được sanitize và render trong iframe sandbox; ảnh ngoài mặc định
  tắt. Dùng thư viện được duy trì, không tự viết sanitizer bằng regex.
- File đính kèm chỉ được tải sau kiểm tra phiên và mailbox/message tương ứng;
  filename, MIME, kích thước và header download được xử lý phía server.

## Gửi thư và Sent

Mỗi thao tác gửi có idempotency key, gắn với phiên/hộp thư và fingerprint nội
dung. Trước SMTP, lưu bền vững trạng thái gửi; duplicate request không gửi lại.
Message-ID ổn định; số lượng người nhận và kích thước được giới hạn phía server.

Phân biệt SMTP accepted, rejected và unknown. Timeout sau submit không đồng
nghĩa thất bại: không tự retry một thư có thể đã được gửi. UI nói rõ kết quả
chưa xác định và khóa gửi lại tự động. Không hứa exactly-once với SMTP.

SMTP và việc lưu Sent có trạng thái riêng. Khi SMTP thành công nhưng lưu Sent
lỗi, báo thư đã được server chấp nhận nhưng bản Sent chưa hoàn tất, không gửi
lại thư. Adapter phải xác nhận provider có tự lưu Sent hay cần IMAP APPEND để
không nhân đôi. Unknown APPEND chỉ đối soát, không append mù. Việc tiếp tục sau
restart và double-click gửi phải được kiểm thử bằng fault injection.

Đề xuất giới hạn ban đầu tổng thư 10 MiB kể cả MIME encoding, kiểm tra trước
submit; mức thực tế phải điều chỉnh theo giới hạn Viettel/runtime đã xác nhận.
Không có file đính kèm nào bị bỏ âm thầm khi quá giới hạn.

## Tái sử dụng có chọn lọc

Mang sang sau khi kiểm tra nguồn và quyền sử dụng: logo PNG, brand tokens,
icon/hình ảnh thích hợp, nội dung công ty, thông tin liên hệ và brochure.

Tham khảo và port có test: allowlist endpoint/TLS, parser MIME, opaque session,
scoped mailbox/message identity (kể cả UIDVALIDITY), gửi không trùng và phân
biệt SMTP/Sent. Không chép nguyên file Worker hoặc coi local test là bằng chứng
gửi nhận thật. Không mang state, credentials, mật khẩu mẫu hay config cloud cũ.

Không mang Forwarding, Platform, AI, legacy JMAP/Stalwart, R2 backup/archive
hoặc các trial/staging/qualification/recovery ID cũ vào kiến trúc sản phẩm mới.
Giữ nguyên repo và hệ thống cũ; không xóa hoặc thay thế production lúc này.

## Thứ tự triển khai và nghiệm thu

1. Bộ khung tối thiểu, brand assets và landing hoàn chỉnh; preview responsive.
2. Mail UI cùng fixture cục bộ; có thông báo rõ khi dữ liệu là mẫu.
3. Provider adapter và session; kiểm thử IMAP/SMTP với TLS fixture cục bộ.
4. Kiểm thử tích hợp lỗi, giới hạn, isolation, gửi/Sent và logout/expiry.
5. Review giao diện và code; chuẩn bị tài liệu/env mẫu cho deploy sau.
6. Giai đoạn riêng: operator cấu hình credentials, chứng minh cloud runtime,
   gửi nhận thật và chốt DNS trước rollout. Chưa thực hiện trong phạm vi hiện tại.

Local hoàn tất khi build/typecheck qua, các luồng mail cơ bản chạy với fixture,
test quan trọng qua và giao diện được kiểm tra desktop/mobile. Test local cần
chứng minh login sai/TLS lỗi, truy cập khác mailbox, CSRF, HTML độc hại,
session cleanup, giới hạn file, SMTP unknown và SMTP thành công/Sent lỗi.

Chỉ gọi Mail vận hành được sau khi có bằng chứng trên môi trường triển khai:
đăng nhập thật, nhận/đọc một thư đến, gửi thư được hộp nhận xác nhận, đúng một
bản Sent, file đính kèm hai chiều, logout/expiry và phục hồi sau restart. Kiểm
tra runtime dùng tài khoản test do chủ hệ thống cung cấp riêng; không dùng dữ
liệu thật hoặc gửi thư ngoài chỉ vì fixture đã qua.

Trước DNS rollout xác nhận địa chỉ `mail.iconiclogs.com` hiện dùng làm gì và
endpoint ứng dụng native đang sử dụng. Không đổi MX để trỏ vào webmail; Viettel
tiếp tục giữ vai trò máy chủ email. Deploy mới không tự thay thế website/mail cũ.

## Điểm còn mở, không chặn code local

- Logo vector nguồn nếu chủ dự án có; PNG hiện tại đủ để bắt đầu.
- Địa chỉ webmail cuối cùng và runtime cloud: chốt ở giai đoạn triển khai.
- Xác nhận lại thông tin liên hệ, brochure, quyền hình ảnh và giới hạn provider.

Chưa có live SMTP/Sent acceptance cho sản phẩm mới. Bằng chứng đọc thư của repo
cũ là lịch sử hữu ích, không thay thế nghiệm thu bản mới.
