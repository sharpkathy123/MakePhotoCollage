const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, pastePhotoInto, pasteTextInto } = require('./helpers');

// navigator.clipboard.read() (the Async Clipboard API) turned out to be
// unreliable for images on iOS Safari in real use -- confirmed live, it
// resolved with no items/types at all for a photo copied straight from the
// Photos app, with no permission prompt and no error to catch. Paste is
// implemented on the classic `paste` event instead (fired by the OS's own
// Paste action on a focused field), which isn't gated by that same
// permission model. Tapping #pasteBtn reveals and focuses #pasteZone;
// these tests dispatch a real `paste` event at it, exactly like a genuine
// OS paste gesture would.
test.describe('Paste from clipboard', () => {
  test('tapping Paste reveals and focuses the paste zone', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('#pasteZone')).toBeHidden();
    await page.click('#pasteBtn');
    await expect(page.locator('#pasteZone')).toBeVisible();
    await expect(page.locator('#pasteZone')).toBeFocused();
  });

  test('pasting an image into the paste zone loads it the same way Choose Files does, and hides the zone again', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('#pasteBtn');

    await pastePhotoInto(page, FIXTURES.redLandscape);
    await page.waitForFunction(() => typeof rawImages !== 'undefined' && rawImages.length === 1);

    expect(await page.evaluate(() => rawImages.length)).toBe(1);
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await expect(page.locator('#pasteZone')).toBeHidden();
  });

  test('pasting appends to an already-loaded collage instead of replacing it', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);
    await page.click('#pasteBtn');

    await pastePhotoInto(page, FIXTURES.redLandscape);
    await page.waitForFunction(() => rawImages.length === 2);

    expect(await page.evaluate(() => rawImages.length)).toBe(2);
  });

  test('pasting non-image content alerts and loads nothing', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('#pasteBtn');

    let alertMessage = null;
    page.on('dialog', async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });

    await pasteTextInto(page, 'hello');
    await page.waitForTimeout(100);

    expect(alertMessage).toContain("didn't include a photo");
    expect(await page.evaluate(() => rawImages.length)).toBe(0);
    await expect(page.locator('#pasteZone')).toBeHidden();
  });

  test('tapping away without pasting dismisses the paste zone', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('#pasteBtn');
    await expect(page.locator('#pasteZone')).toBeVisible();

    await page.click('#imgInput');
    await expect(page.locator('#pasteZone')).toBeHidden();
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
