// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
const attachment = (id: number, contentId: string, size = png.length) => ({
  id,
  contentId,
  size,
  name: `${id}.png`,
  type: 'image/png',
});

it('chooses only referenced, unambiguous, bounded Content-IDs without loading remote HTML resources', async () => {
  const { inlineImageCandidates } = await import('../inlineImages');
  const files = [
    attachment(0, 'logo@example.com'),
    attachment(1, 'duplicate'),
    attachment(2, 'duplicate'),
    attachment(3, 'unused'),
    attachment(4, 'huge', 3 * 1024 * 1024 + 1),
  ];
  expect(
    inlineImageCandidates(
      '<img src="cid:logo%40example.com"><img src="cid:duplicate"><img src="cid:huge"><img src="https://tracker.test/pixel"><iframe src="https://tracker.test/frame"></iframe>',
      files,
    ),
  ).toEqual([files[0]]);
});

it('limits automatic image downloads by count and total decoded bytes', async () => {
  const { inlineImageCandidates } = await import('../inlineImages');
  const files = Array.from({ length: 15 }, (_, i) => attachment(i, `image-${i}`, 2 * 1024 * 1024));
  const html = files.map((file) => `<img src="cid:${file.contentId}">`).join('');
  expect(inlineImageCandidates(html, files)).toHaveLength(4);
  expect(
    inlineImageCandidates(
      html,
      files.map((file) => ({ ...file, size: 1 })),
    ),
  ).toHaveLength(10);
  expect(
    inlineImageCandidates(
      html,
      files.map((file) => ({ ...file, sizeKnown: false })),
    ),
  ).toHaveLength(0);
});

it('sniffs raster bytes, ignores the download MIME declaration, and rejects SVG or decompression-sized canvases', async () => {
  const { loadInlineImages } = await import('../inlineImages');
  const valid = await loadInlineImages(
    [attachment(0, 'logo')],
    async () => new Blob([png], { type: 'application/octet-stream' }),
  );
  expect(valid.get('logo')).toMatch(/^data:image\/png;base64,/);
  const spoof = await loadInlineImages(
    [attachment(0, 'logo')],
    async () => new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }),
  );
  expect(spoof.size).toBe(0);
  const hugeCanvas = png.slice();
  new DataView(hugeCanvas.buffer).setUint32(16, 100000);
  expect(
    (await loadInlineImages([attachment(0, 'logo')], async () => new Blob([hugeCanvas]))).size,
  ).toBe(0);
});

it('does not publish or continue a cancelled image load and leaves other images usable on one failure', async () => {
  const { loadInlineImages } = await import('../inlineImages');
  const controller = new AbortController();
  const download = vi.fn(async () => {
    controller.abort();
    return new Blob([png]);
  });
  expect(
    (
      await loadInlineImages(
        [attachment(0, 'one'), attachment(1, 'two')],
        download,
        controller.signal,
      )
    ).size,
  ).toBe(0);
  expect(download).toHaveBeenCalledOnce();
  const images = await loadInlineImages(
    [attachment(0, 'one'), attachment(1, 'two')],
    async (id) => {
      if (id === 0) throw Error('temporary download failure');
      return new Blob([png]);
    },
  );
  expect([...images.keys()]).toEqual(['two']);
});
