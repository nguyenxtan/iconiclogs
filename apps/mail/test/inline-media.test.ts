import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rasterInfo, safeRasterDataUrl, contentIdFromSource } from '../src/shared/inlineMedia';

it('recognizes the actual company PNG and supported GIF raster headers', () => {
  expect(rasterInfo(readFileSync('apps/mail/public/brand/iconic-logo.png'))).toEqual({
    type: 'image/png',
    width: 500,
    height: 500,
  });
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  expect(rasterInfo(gif)).toEqual({ type: 'image/gif', width: 1, height: 1 });
  expect(rasterInfo(readFileSync('apps/web/public/visuals/photographic/port.webp'))?.type).toBe(
    'image/webp',
  );
});

it('rejects unsafe or implausible canvases before the browser decodes them', () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  gif.writeUInt16LE(65535, 6);
  expect(rasterInfo(gif)).toBeUndefined();
  expect(rasterInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeUndefined();
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  webp.write('VP8X', 12);
  webp[24] = 0xff;
  webp[25] = 0xff;
  webp[27] = 0xff;
  webp[28] = 0xff;
  expect(rasterInfo(webp)).toBeUndefined();
});

it('requires a canonical matching raster MIME type and safely decodes CID URLs exactly once', () => {
  const png = readFileSync('apps/mail/public/brand/iconic-logo.png');
  expect(safeRasterDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`)).toBe(false);
  expect(contentIdFromSource('cid:logo%2540example')).toBe('logo%40example');
  expect(contentIdFromSource('cid:logo%0Aexample')).toBeUndefined();
  expect(contentIdFromSource('cid:invalid%')).toBeUndefined();
  expect(contentIdFromSource('https://example.test/image')).toBeUndefined();
});
