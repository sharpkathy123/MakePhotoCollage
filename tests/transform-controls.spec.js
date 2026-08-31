const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Scale / rotation / reset', () => {
  test('the Scale and Rotation sliders update the selected photo\'s transform', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await page.fill('#modScale', '2');
    await page.dispatchEvent('#modScale', 'input');
    await page.fill('#modRotate', '45');
    await page.dispatchEvent('#modRotate', 'input');
    await page.waitForTimeout(100);

    const t = await page.evaluate(() => ({ scale: transforms[0].scale, rot: transforms[0].rot }));
    expect(t.scale).toBe(2);
    expect(t.rot).toBe(45);
  });

  test('applying scale/rotation to a multi-selection updates every selected photo', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    await page.click('button:text("Select All")');

    await page.fill('#modScale', '1.8');
    await page.dispatchEvent('#modScale', 'input');
    await page.waitForTimeout(100);

    const scales = await page.evaluate(() => transforms.map((t) => t.scale));
    expect(scales).toEqual([1.8, 1.8, 1.8]);
  });

  test('Reset Photo restores scale, rotation, position, and pan to defaults', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await page.evaluate(() => {
      transforms[0] = { scale: 2.5, rot: 90, x: 40, y: -20, panX: 15, panY: 30 };
      syncSliderControls();
    });

    await page.click('button:text("Reset Photo")');
    await page.waitForTimeout(50);

    const t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t).toEqual({ scale: 1, rot: 0, x: 0, y: 0, panX: 0, panY: 0 });
  });
});
