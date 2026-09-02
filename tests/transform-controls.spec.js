const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Scale / rotation / reset', () => {
  test('the Scale and Rotation sliders update the selected photo\'s transform (Attached mode, the default)', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await page.fill('#modScale', '2');
    await page.dispatchEvent('#modScale', 'input');
    await page.fill('#modRotate', '45');
    await page.dispatchEvent('#modRotate', 'input');
    await page.waitForTimeout(100);

    // Attached mode (the default for a freshly loaded photo, so the frame
    // and photo move together) routes both to the frame's own fields --
    // frameScale and rot -- leaving the Fixed-mode content-only fields
    // (scale/panRot) untouched. See pan-behavior.spec for the fuller
    // Fixed-vs-Attached routing and rendered-pixel coverage.
    const t = await page.evaluate(() => ({ scale: transforms[0].scale, frameScale: transforms[0].frameScale, rot: transforms[0].rot, panRot: transforms[0].panRot }));
    expect(t.frameScale).toBe(2);
    expect(t.rot).toBe(45);
    expect(t.scale).toBe(1);
    expect(t.panRot).toBe(0);
  });

  test('applying scale/rotation to a multi-selection updates every selected photo', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    await page.click('button:text("Select All")');

    await page.fill('#modScale', '1.8');
    await page.dispatchEvent('#modScale', 'input');
    await page.waitForTimeout(100);

    // Attached is the default behavior, so the Scale slider routes to
    // frameScale for every selected photo (see getGestureScale/setGestureScale).
    const scales = await page.evaluate(() => transforms.map((t) => t.frameScale));
    expect(scales).toEqual([1.8, 1.8, 1.8]);
  });

  test('Reset Photo restores scale, rotation, position, and pan to defaults', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await page.evaluate(() => {
      transforms[0] = { scale: 2.5, rot: 90, x: 40, y: -20, panX: 15, panY: 30, frameScale: 1.8, panRot: -45 };
      syncSliderControls();
    });

    await page.click('button:text("Reset Photo")');
    await page.waitForTimeout(50);

    const t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t).toEqual({ scale: 1, rot: 0, x: 0, y: 0, panX: 0, panY: 0, frameScale: 1, panRot: 0 });
  });
});
