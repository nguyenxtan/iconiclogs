export const company = {
  name: 'ICONIC Logistics',
  email: 'info@iconiclogs.com',
  phone: '0839037568',
  phoneDisplay: '0839 037 568',
  address: '25/49 Đường 6, Khu phố 26, Phường Hiệp Bình, TP.HCM, Việt Nam',
  mailUrl: import.meta.env.PUBLIC_MAIL_URL || 'https://mail.iconiclogs.com',
};

export const services = [
  {
    number: '01',
    slug: 'sea-freight',
    title: 'Vận tải đường biển',
    english: 'Sea freight',
    description:
      'Phối hợp vận chuyển hàng nguyên container và hàng lẻ, từ kế hoạch đóng hàng đến kết nối cảng đi, cảng đến.',
    icon: 'ship',
    tags: ['Hàng nguyên container', 'Hàng lẻ'],
  },
  {
    number: '02',
    slug: 'air-freight',
    title: 'Vận tải hàng không',
    english: 'Air freight',
    description:
      'Lựa chọn phương án đường hàng không phù hợp với thời gian, tính chất hàng hóa và yêu cầu giao nhận của từng lô hàng.',
    icon: 'plane',
    tags: ['Hàng xuất nhập khẩu', 'Phối hợp giao nhận'],
  },
  {
    number: '03',
    slug: 'road-freight',
    title: 'Vận tải đường bộ',
    english: 'Road transport',
    description:
      'Kết nối các chặng vận chuyển nội địa, phối hợp lấy hàng và giao hàng theo lịch trình đã thống nhất.',
    icon: 'truck',
    tags: ['Vận chuyển nội địa', 'Kết nối các chặng'],
  },
  {
    number: '04',
    slug: 'customs',
    title: 'Thủ tục hải quan',
    english: 'Customs services',
    description:
      'Hỗ trợ chuẩn bị hồ sơ và phối hợp thực hiện thủ tục hải quan, giúp doanh nghiệp chủ động trong quá trình xuất nhập khẩu.',
    icon: 'document',
    tags: ['Tư vấn chứng từ', 'Hỗ trợ thông quan'],
  },
  {
    number: '05',
    slug: 'warehousing-distribution',
    title: 'Kho bãi & phân phối',
    english: 'Warehousing & distribution',
    description:
      'Phối hợp phương án lưu kho, sắp xếp hàng hóa và phân phối phù hợp với nhu cầu vận hành của doanh nghiệp.',
    icon: 'warehouse',
    tags: ['Phối hợp lưu kho', 'Điều phối giao hàng'],
  },
] as const;

export const process = [
  {
    title: 'Lắng nghe nhu cầu',
    description:
      'Cùng làm rõ hàng hóa, điểm đi – đến, thời gian và những yêu cầu riêng của doanh nghiệp.',
  },
  {
    title: 'Thống nhất phương án',
    description: 'Trao đổi lộ trình, chi phí và trách nhiệm phối hợp trước khi triển khai.',
  },
  {
    title: 'Kết nối thực hiện',
    description: 'Phối hợp các bên liên quan, theo sát chứng từ và cập nhật tiến độ của lô hàng.',
  },
  {
    title: 'Đồng hành đến đích',
    description: 'Tiếp tục phối hợp khi giao nhận và đối chiếu thông tin để hoàn tất hành trình.',
  },
];
