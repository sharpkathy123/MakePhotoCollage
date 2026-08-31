const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Loading photos', () => {
  test('starts with Save disabled and no photo controls visible', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await expect(page.locator('#photoControls')).toBeHidden();
  });

  test('loading files populates rawImages, enables Save, and shows photo controls', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    await expect(page.locator('#saveBtn')).toBeEnabled();
    await expect(page.locator('#photoControls')).toBeVisible();

    const count = await page.evaluate(() => rawImages.length);
    expect(count).toBe(2);
  });

  test('selecting files a second time replaces the previous set (native <input> semantics)', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    expect(await page.evaluate(() => rawImages.length)).toBe(3);

    await loadPhotos(page, [FIXTURES.yellowSquare]);
    expect(await page.evaluate(() => rawImages.length)).toBe(1);
  });

  test('each loaded photo gets its own transform and mask entry', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);

    const { transformsLen, masksLen, firstMask } = await page.evaluate(() => ({
      transformsLen: transforms.length,
      masksLen: photoMasks.length,
      firstMask: { ...photoMasks[0] },
    }));
    expect(transformsLen).toBe(3);
    expect(masksLen).toBe(3);
    // New photos default to no mask / fixed behavior.
    expect(firstMask.mode).toBe('none');
    expect(firstMask.behavior).toBe('fixed');
  });
});
