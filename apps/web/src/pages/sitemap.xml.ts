import type { APIRoute } from 'astro';
import { services } from '../content/company';
const paths = [
  '/',
  '/about',
  '/services',
  ...services.map((service) => `/services/${service.slug}`),
  '/contact',
  '/brochure',
];
export const GET: APIRoute = ({ site }) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${new URL(path, site)}</loc></url>`).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
