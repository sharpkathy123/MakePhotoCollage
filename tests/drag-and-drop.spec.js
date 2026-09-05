const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, dropFilesOnPage, dragEnterPage, dragLeavePage } = require('./helpers');

// Native OS drag-and-drop between apps (e.g. dragging out of the Google
// Photos app) only exists on iPad -- iPhone has no cross-app drag at all --
// but this also covers dragging files from a desktop file manager, or from
// the Photos app on iPad. Dropping is handled at the document level so it
// works no matter where on the page the drop lands.
test.describe('Drag and drop', () => {
  test('dropping an image file anywhere on the page loads it the same way Choose Files does', async ({ page }) => {
    await page.goto('/index.html');

    await dropFilesOnPage(page, [FIXTURES.redLandscape]);
    await page.waitForFunction(() => typeof rawImages !== 'undefined' && rawImages.length === 1);

    expect(await page.evaluate(() => rawImages.length)).toBe(1);
    await expect(page.locator('#saveBtn')).toBeEnabled();
  });

  test('dropping multiple files loads all of them at once', async ({ page }) => {
    await page.goto('/index.html');

    await dropFilesOnPage(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    await page.waitForFunction(() => rawImages.length === 3);

    expect(await page.evaluate(() => rawImages.length)).toBe(3);
  });

  test('dropping appends to an already-loaded collage instead of replacing it', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);

    await dropFilesOnPage(page, [FIXTURES.redLandscape]);
    await page.waitForFunction(() => rawImages.length === 2);

    expect(await page.evaluate(() => rawImages.length)).toBe(2);
  });

  test('dragging a file over the page highlights the card, and dragleave clears it', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('.card')).not.toHaveClass(/drag-active/);
    await dragEnterPage(page);
    await expect(page.locator('.card')).toHaveClass(/drag-active/);

    await dragLeavePage(page);
    await expect(page.locator('.card')).not.toHaveClass(/drag-active/);
  });

  test('the highlight clears after a drop', async ({ page }) => {
    await page.goto('/index.html');

    await dragEnterPage(page);
    await expect(page.locator('.card')).toHaveClass(/drag-active/);

    await dropFilesOnPage(page, [FIXTURES.redLandscape]);
    await expect(page.locator('.card')).not.toHaveClass(/drag-active/);
  });
});
