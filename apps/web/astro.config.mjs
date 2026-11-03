import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://iconiclogs.com',
  output: 'static',
  // Cloudflare's CSP permits only same-origin stylesheets, including small bundles.
  build: { inlineStylesheets: 'never' },
});
