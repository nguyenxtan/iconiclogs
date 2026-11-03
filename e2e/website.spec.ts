import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [1440, 390]) {
  test(`website navigation and content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:4325');
    await expect(page.locator('main h1')).toBeVisible();
    const heroImage = page.locator('.photo-hero picture img');
    await expect(heroImage).toBeVisible();
    await expect
      .poll(() => heroImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(await heroImage.evaluate((image) => (image as HTMLImageElement).currentSrc)).toContain(
      width < 700 ? '/port-mobile.webp' : '/port.webp',
    );
    await expect(page.locator('.photo-hero .button-brand')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const path of [
      '/about',
      '/services',
      '/services/sea-freight',
      '/services/air-freight',
      '/services/road-freight',
      '/services/customs',
      '/services/warehousing-distribution',
      '/contact',
      '/brochure',
    ]) {
      const response = await page.goto('http://127.0.0.1:4325' + path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['content-security-policy']).toContain("style-src 'self'");
      await expect(page.locator('.page-heading')).toHaveCSS('position', 'relative');
      await expect(page.locator('.page-heading')).toHaveCSS('overflow', 'hidden');
      await expect(page.locator('style')).toHaveCount(0);
      if (await page.locator('.page-heading-image').count()) {
        await expect(page.locator('.page-heading-image')).toHaveCSS('position', 'absolute');
        const heading = await page.locator('main h1').boundingBox();
        const photo = await page.locator('.page-heading-image').boundingBox();
        expect(heading!.y).toBeGreaterThanOrEqual(photo!.y);
        expect(heading!.y + heading!.height).toBeLessThanOrEqual(photo!.y + photo!.height);
      }
      await expect(page.locator('main h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });
}
test('landing accessibility and downloadable company profile', async ({ page, request }) => {
  await page.goto('http://127.0.0.1:4325');
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(report.violations).toEqual([]);
  for (const lang of ['vi', 'en']) {
    const response = await request.get(
      `http://127.0.0.1:4325/brochures/iconic-logistics-brochure-${lang}.pdf`,
    );
    expect(response.ok()).toBe(true);
    expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
  }
});
