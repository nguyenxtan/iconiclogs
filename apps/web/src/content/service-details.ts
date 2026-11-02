export interface ServiceDetail {
  headline: string;
  accent: string;
  introduction: string;
  image: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  scope: { title: string; description: string }[];
  prepare: string[];
  note: string;
}

export const serviceDetails: Record<string, ServiceDetail> = {
  'sea-freight': {
    headline: 'Kết nối đường biển.',
    accent: 'Mở rộng giao thương.',
    introduction:
      'Cùng doanh nghiệp xây dựng phương án vận chuyển đường biển từ thông tin hàng hóa, cảng đi – đến và kế hoạch giao nhận. Mỗi chặng được trao đổi trong một lộ trình phối hợp rõ ràng.',
    image: '/visuals/iconic-port-hero-v2.webp',
    imageAlt: 'Minh họa tàu container và khu cảng trong ánh hoàng hôn',
    imageWidth: 1915,
    imageHeight: 821,
    scope: [
      {
        title: 'Làm rõ phương án vận chuyển',
        description:
          'Trao đổi tuyến, số lượng hàng, nhu cầu hàng nguyên container hoặc hàng lẻ và mốc thời gian dự kiến để lựa chọn phương án phù hợp.',
      },
      {
        title: 'Phối hợp chứng từ và giao nhận',
        description:
          'Xác định hồ sơ lô hàng, kế hoạch đóng hàng và các đầu mối tại điểm nhận, cảng đi, cảng đến trong phạm vi đã thống nhất.',
      },
      {
        title: 'Kết nối các chặng liên quan',
        description:
          'Phối hợp vận tải nội địa, thủ tục xuất nhập khẩu và giao hàng khi có nhu cầu kết hợp nhiều dịch vụ.',
      },
    ],
    prepare: [
      'Cảng đi, cảng đến và địa chỉ nhận – giao hàng.',
      'Tên hàng, số kiện, trọng lượng, thể tích và cách đóng gói.',
      'Loại, số lượng container dự kiến hoặc nhu cầu gửi hàng lẻ.',
      'Ngày hàng sẵn sàng, thời điểm cần giao và điều kiện giao hàng đã thỏa thuận.',
      'Invoice, packing list và thông tin về yêu cầu xử lý riêng nếu có.',
    ],
    note: 'Lịch vận chuyển, điều kiện tiếp nhận và các khoản chi phí được xác nhận theo từng lô hàng, tuyến vận chuyển và thời điểm trao đổi.',
  },
  'air-freight': {
    headline: 'Chủ động thời gian.',
    accent: 'Kết nối bằng đường hàng không.',
    introduction:
      'Khi thời gian là một yêu cầu quan trọng, phương án vận chuyển cần bắt đầu từ thông tin chính xác. ICONIC cùng bạn làm rõ hàng hóa, lịch dự kiến và các bước giao nhận bằng đường hàng không.',
    image: '/visuals/iconic-home-air.webp',
    imageAlt: 'Minh họa máy bay và hàng hóa được chuẩn bị tại sân bay',
    imageWidth: 1256,
    imageHeight: 576,
    scope: [
      {
        title: 'Trao đổi tuyến và mốc thời gian',
        description:
          'Xem xét sân bay đi – đến, thời điểm hàng sẵn sàng và yêu cầu giao nhận để phối hợp phương án vận chuyển.',
      },
      {
        title: 'Làm rõ đặc điểm hàng hóa',
        description:
          'Tiếp nhận thông tin về kích thước, trọng lượng, đóng gói và đặc tính hàng để xác nhận điều kiện tiếp nhận phù hợp.',
      },
      {
        title: 'Phối hợp hồ sơ và các đầu mối',
        description:
          'Trao đổi chứng từ lô hàng, điểm nhận – giao và các bước kết nối với thủ tục xuất nhập khẩu theo nhu cầu thực tế.',
      },
    ],
    prepare: [
      'Sân bay hoặc thành phố đi – đến và địa chỉ giao nhận.',
      'Tên hàng, số kiện, trọng lượng và kích thước từng kiện.',
      'Ngày hàng sẵn sàng và thời hạn giao hàng mong muốn.',
      'Thông tin về pin, chất lỏng, hàng dễ vỡ hoặc điều kiện xử lý riêng nếu có.',
      'Invoice, packing list và hồ sơ liên quan đến tính chất hàng hóa.',
    ],
    note: 'Khả năng tiếp nhận từng loại hàng, lịch bay và thời gian vận chuyển cần được xác nhận trước khi triển khai. Vui lòng chia sẻ đầy đủ đặc tính của hàng hóa.',
  },
  'road-freight': {
    headline: 'Liền mạch từng chặng.',
    accent: 'Kết nối trên mỗi cung đường.',
    introduction:
      'Từ điểm lấy hàng đến nơi giao nhận, mỗi chặng đường bộ cần được phối hợp theo điều kiện thực tế. ICONIC cùng bạn làm rõ địa điểm, khối lượng và lịch trình để thống nhất cách thực hiện.',
    image: '/visuals/iconic-services-road.webp',
    imageAlt: 'Minh họa xe tải container trên tuyến đường bộ',
    imageWidth: 818,
    imageHeight: 368,
    scope: [
      {
        title: 'Phối hợp lấy và giao hàng',
        description:
          'Làm rõ địa điểm, khung giờ, người liên hệ và điều kiện tiếp cận tại hai đầu giao nhận.',
      },
      {
        title: 'Trao đổi phương án chuyên chở',
        description:
          'Xem xét loại hàng, số lượng, kích thước và yêu cầu đóng gói để phối hợp phương án vận chuyển phù hợp.',
      },
      {
        title: 'Kết nối với chuỗi logistics',
        description:
          'Phối hợp chặng đường bộ cùng cảng, sân bay, kho hoặc điểm phân phối trong phạm vi dịch vụ đã thống nhất.',
      },
    ],
    prepare: [
      'Địa chỉ lấy hàng, giao hàng và thông tin người phụ trách.',
      'Loại hàng, số kiện, trọng lượng, kích thước và cách đóng gói.',
      'Ngày nhận, ngày giao và các khung giờ cần lưu ý.',
      'Điều kiện đường vào, khu vực dừng xe và yêu cầu bốc xếp.',
      'Chứng từ đi kèm và yêu cầu bàn giao, xác nhận nhận hàng.',
    ],
    note: 'Lộ trình, phương án phương tiện và thời gian thực hiện được trao đổi theo điều kiện giao nhận thực tế. Các yêu cầu bốc xếp hoặc xử lý riêng cần thống nhất trước.',
  },
  customs: {
    headline: 'Rõ hồ sơ.',
    accent: 'Chủ động bước thông quan.',
    introduction:
      'Một bộ hồ sơ đầy đủ là khởi đầu cho việc phối hợp thủ tục xuất nhập khẩu. ICONIC cùng doanh nghiệp làm rõ loại hình, chứng từ và các thông tin cần chuẩn bị cho từng lô hàng.',
    image: '/visuals/iconic-port-hero-v2.webp',
    imageAlt: 'Minh họa bối cảnh vận chuyển hàng hóa xuất nhập khẩu tại cảng biển',
    imageWidth: 1915,
    imageHeight: 821,
    scope: [
      {
        title: 'Rà soát thông tin ban đầu',
        description:
          'Trao đổi tên hàng, bối cảnh giao dịch, loại hình xuất nhập khẩu và tình trạng chứng từ hiện có.',
      },
      {
        title: 'Phối hợp chuẩn bị hồ sơ',
        description:
          'Làm rõ những thông tin cần bổ sung, các đầu mối cung cấp chứng từ và các bước triển khai trong phạm vi đã thống nhất.',
      },
      {
        title: 'Kết nối với kế hoạch giao nhận',
        description:
          'Phối hợp tiến độ hồ sơ cùng lịch vận chuyển, lấy hàng và giao hàng; trao đổi khi có nội dung cần xác nhận.',
      },
    ],
    prepare: [
      'Thông tin doanh nghiệp xuất nhập khẩu và người phụ trách hồ sơ.',
      'Mô tả hàng hóa, công dụng, chất liệu hoặc thông số kỹ thuật liên quan.',
      'Invoice, packing list, hợp đồng và chứng từ vận chuyển hiện có.',
      'Giấy phép, chứng nhận xuất xứ hoặc hồ sơ chuyên ngành nếu có.',
      'Loại hình dự kiến, nơi thực hiện thủ tục và lịch hàng đến – đi.',
    ],
    note: 'Danh mục trên là thông tin để bắt đầu trao đổi. Hồ sơ và yêu cầu thủ tục cụ thể được xác định theo loại hàng, loại hình giao dịch và quy định áp dụng tại thời điểm thực hiện.',
  },
  'warehousing-distribution': {
    headline: 'Sắp xếp hôm nay.',
    accent: 'Sẵn sàng cho chặng tiếp theo.',
    introduction:
      'Nhu cầu lưu kho và phân phối gắn liền với nhịp vận hành của mỗi doanh nghiệp. ICONIC phối hợp làm rõ yêu cầu về hàng hóa, thời gian lưu và các điểm giao để cùng lựa chọn phương án phù hợp.',
    image: '/visuals/iconic-services-road.webp',
    imageAlt: 'Minh họa vận tải đường bộ kết nối các chặng lưu kho và phân phối',
    imageWidth: 818,
    imageHeight: 368,
    scope: [
      {
        title: 'Trao đổi nhu cầu lưu kho',
        description:
          'Làm rõ chủng loại, số lượng, cách đóng gói, thời gian lưu dự kiến và những điều kiện bảo quản cần lưu ý.',
      },
      {
        title: 'Phối hợp nhập – xuất và xử lý hàng',
        description:
          'Thống nhất thông tin bàn giao, yêu cầu sắp xếp, lịch nhập – xuất và phạm vi xử lý hàng hóa trước khi triển khai.',
      },
      {
        title: 'Kết nối điểm phân phối',
        description:
          'Trao đổi danh sách điểm giao, tần suất và yêu cầu nhận hàng để phối hợp với các chặng vận chuyển liên quan.',
      },
    ],
    prepare: [
      'Danh mục hàng hóa, số lượng, kích thước và trọng lượng dự kiến.',
      'Quy cách đóng gói, điều kiện bảo quản và yêu cầu xử lý riêng.',
      'Thời gian lưu, lịch nhập – xuất và nhu cầu phát sinh theo giai đoạn.',
      'Điểm phân phối, tần suất giao và yêu cầu tại nơi nhận.',
      'Cách đối chiếu số lượng, chứng từ và đầu mối phối hợp.',
    ],
    note: 'Địa điểm, sức chứa, điều kiện bảo quản và phạm vi xử lý được xác nhận theo từng nhu cầu. Các điều kiện đặc thù cần được trao đổi trước khi thống nhất phương án.',
  },
};
