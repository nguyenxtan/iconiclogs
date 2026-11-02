import type { MailMessage, SessionInfo } from '../shared/contracts';
import type { MailApi } from './api';

const address = (name: string, email: string) => ({ name, address: email });
const me = address('Minh Anh', 'minhanh@iconiclogs.com');
const now = Date.now();
const initial: MailMessage[] = [
  {
    id: 'demo-1',
    from: address('Linh Nguyễn', 'linh.nguyen@example.test'),
    to: [me],
    subject: 'Lịch trình lô hàng Hải Phòng — Singapore',
    date: new Date(now - 12 * 60_000).toISOString(),
    unread: true,
    hasAttachments: true,
    text: 'Chào Minh Anh,\n\nMình gửi bạn lịch trình dự kiến cho lô hàng xuất từ Hải Phòng đi Singapore trong tuần này.\n\n• Thời gian đóng hàng: 09:00, thứ Tư\n• Cảng đi: Hải Phòng\n• Cảng đến: Singapore\n\nNhờ bạn kiểm tra lại thông tin và xác nhận giúp mình trước 16:00 hôm nay để đội vận hành hoàn tất kế hoạch.\n\nCảm ơn bạn. Chúc một ngày làm việc hiệu quả!\n\nLinh Nguyễn\nBộ phận Điều phối',
    attachments: [{ id: 1, name: 'Lich-trinh-lo-hang.txt', type: 'text/plain', size: 128 }],
    messageId: '<demo-1@example.test>',
  },
  {
    id: 'demo-2',
    from: address('Đội vận hành', 'operations@example.test'),
    to: [me],
    subject: 'Cập nhật kế hoạch vận chuyển tuần này',
    date: new Date(now - 65 * 60_000).toISOString(),
    unread: true,
    hasAttachments: false,
    text: 'Chào cả nhà,\n\nKế hoạch điều phối tuần này đã được cập nhật. Các nhóm vui lòng kiểm tra lịch nhận hàng và xác nhận thời gian bàn giao.\n\nCảm ơn mọi người,\nĐội vận hành',
    attachments: [],
  },
  {
    id: 'demo-3',
    from: address('Trần Hoàng', 'hoang.tran@example.test'),
    to: [me],
    subject: 'Re: Xác nhận thông tin booking',
    date: new Date(now - 3 * 3_600_000).toISOString(),
    unread: false,
    hasAttachments: false,
    text: 'Chào Minh Anh,\n\nMình đã nhận được xác nhận booking. Các thông tin đã khớp với kế hoạch.\n\nCảm ơn bạn đã hỗ trợ.\nHoàng',
    attachments: [],
  },
  {
    id: 'demo-4',
    from: address('ICONIC Team', 'team@example.test'),
    to: [me],
    subject: 'Một tuần mới, những kết nối mới',
    date: new Date(now - 86_400_000).toISOString(),
    unread: false,
    hasAttachments: false,
    text: 'Chào bạn,\n\nMỗi hành trình bắt đầu từ một kết nối. Chúc đội ngũ một tuần làm việc thuận lợi và nhiều năng lượng.\n\nICONIC Team',
    attachments: [],
  },
  {
    id: 'demo-5',
    from: address('Phương Lê', 'phuong.le@example.test'),
    to: [me],
    subject: 'Thông tin bàn giao hồ sơ lô hàng',
    date: new Date(now - 92_000_000).toISOString(),
    unread: false,
    hasAttachments: false,
    text: 'Chào Minh Anh,\n\nHồ sơ đã được kiểm tra và sẵn sàng bàn giao. Bạn phản hồi giúp mình thời gian nhận phù hợp nhé.\n\nTrân trọng,\nPhương',
    attachments: [],
  },
];
export function createDemoApi(): MailApi {
  const inbox = initial.map((message) => ({ ...message }));
  const sent: MailMessage[] = [];
  const session: SessionInfo = {
    email: me.address,
    csrfToken: 'synthetic-preview',
    expiresAt: Date.now() + 30 * 60_000,
  };
  const deliveries = new Map<string, Awaited<ReturnType<MailApi['send']>>>();
  return {
    session: async () => session,
    login: async () => {
      throw new Error('Demo does not accept credentials');
    },
    messages: async (folder, page) => {
      const data = folder === 'inbox' ? inbox : sent;
      return {
        messages: data.slice((page - 1) * 20, page * 20),
        total: data.length,
        nextPage: data.length > page * 20 ? page + 1 : null,
      };
    },
    message: async (folder, id) => {
      const message = (folder === 'inbox' ? inbox : sent).find((entry) => entry.id === id);
      if (!message) throw new Error('Không có thư mẫu này.');
      message.unread = false;
      return { ...message };
    },
    attachment: async () =>
      new Blob(['BẢN MẪU — Lịch trình minh họa, không phải dữ liệu vận hành.'], {
        type: 'text/plain',
      }),
    send: async (draft, _csrf, key) => {
      const existing = deliveries.get(key);
      if (existing) return existing;
      const result = {
        status: 'sent' as const,
        sentCopy: 'saved' as const,
        accepted: draft.to,
        rejected: [],
      };
      sent.unshift({
        id: `demo-sent-${crypto.randomUUID()}`,
        from: me,
        to: draft.to.map((email) => address('', email)),
        subject: draft.subject,
        date: new Date().toISOString(),
        unread: false,
        hasAttachments: !!draft.attachments.length,
        text: draft.text,
        attachments: draft.attachments.map((file, id) => ({
          id,
          name: file.name,
          type: file.type,
          size: Math.ceil(file.content.length * 0.75),
        })),
      });
      deliveries.set(key, result);
      return result;
    },
    logout: async () => {},
  };
}
