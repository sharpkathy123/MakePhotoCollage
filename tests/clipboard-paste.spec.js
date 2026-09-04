const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, mockClipboardImage } = require('./helpers');

test.describe('Paste from clipboard', () => {
  test('tapping Paste loads a photo from the clipboard the same way Choose Files does', async ({ page }) => {
    await page.goto('/index.html');
    await mockClipboardImage(page, FIXTURES.redLandscape);

    await page.click('#pasteBtn');
    await page.waitForFunction(() => typeof rawImages !== 'undefined' && rawImages.length === 1);

    expect(await page.evaluate(() => rawImages.length)).toBe(1);
    await expect(page.locator('#saveBtn')).toBeEnabled();
  });

  test('pasting appends to an already-loaded collage instead of replacing it', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);
    await mockClipboardImage(page, FIXTURES.redLandscape);

    await page.click('#pasteBtn');
    await page.waitForFunction(() => rawImages.length === 2);

    expect(await page.evaluate(() => rawImages.length)).toBe(2);
  });

  test('pasting with no image on the clipboard alerts and loads nothing', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      // navigator.clipboard is a getter-only accessor with no setter --
      // defineProperty is required to actually replace it (see
      // mockClipboardImage in helpers.js).
      Object.defineProperty(navigator, 'clipboard', {
        value: { read: async () => [{ types: ['text/plain'], getType: async () => new Blob(['hi'], { type: 'text/plain' }) }] },
        configurable: true,
      });
    });

    let alertMessage = null;
    page.on('dialog', async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });

    await page.click('#pasteBtn');
    await page.waitForTimeout(100);

    expect(alertMessage).toContain('No photo found');
    expect(await page.evaluate(() => rawImages.length)).toBe(0);
  });

  test('a clipboard read failure (e.g. permission denied) alerts instead of throwing', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { read: async () => { throw new Error('NotAllowedError'); } },
        configurable: true,
      });
    });

    let alertMessage = null;
    page.on('dialog', async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });

    await page.click('#pasteBtn');
    await page.waitForTimeout(100);

    expect(alertMessage).toContain('Could not read the clipboard');
  });

  test('an unsupported clipboard API alerts rather than erroring silently', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });

    let alertMessage = null;
    page.on('dialog', async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });

    await page.click('#pasteBtn');
    await page.waitForTimeout(100);

    expect(alertMessage).toContain("doesn't support pasting");
  });

  // Regression coverage: a labeled button here (rather than the same
  // compact icon style as the Google Photos/info buttons) previously
  // caused an unrelated toolbar to wrap and push the canvas out of reach
  // (see the rotation lock toggle) -- guard the Paste button the same way.
  test('the Paste button is a small icon matching the Google Photos/info buttons, not a labeled button', async ({ page }) => {
    await page.goto('/index.html');

    const btn = page.locator('#pasteBtn');
    await expect(btn).toHaveClass(/info-toggle-btn/);
    const box = await btn.boundingBox();
    expect(box.width).toBeLessThanOrEqual(48);
  });
});
