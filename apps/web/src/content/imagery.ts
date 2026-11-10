export const imagery = {
  port: {
    src: '/visuals/photographic/port.webp',
    width: 1912,
    height: 823,
    alt: 'Minh họa tàu container và hệ thống cần cẩu tại cảng biển',
  },
  air: {
    src: '/visuals/photographic/air.webp',
    width: 1536,
    height: 1024,
    alt: 'Minh họa hoạt động xếp dỡ hàng hóa lên máy bay vận tải',
  },
  road: {
    src: '/visuals/photographic/road.webp',
    width: 1536,
    height: 1024,
    alt: 'Minh họa xe container trên tuyến cao tốc tại Việt Nam',
  },
  warehouse: {
    src: '/visuals/photographic/warehouse.webp',
    width: 1536,
    height: 1024,
    alt: 'Minh họa kho hàng với hệ thống kệ và hoạt động kiểm tra hàng hóa',
  },
} as const;

export type ImageKey = keyof typeof imagery;
export const serviceImages: Record<string, ImageKey | undefined> = {
  'sea-freight': 'port',
  'air-freight': 'air',
  'road-freight': 'road',
  'warehousing-distribution': 'warehouse',
};
