const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, samplePixel, cellCenter } = require('./helpers');

test.describe('Per-photo masks', () => {
  test('mask shape, behavior, and radius are independent per photo', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);

    await page.evaluate(() => {
      photoMasks[0].mode = 'circle';
      photoMasks[1].mode = 'rounded';
      photoMasks[1].radius = 45;
      photoMasks[2].mode = 'none';
      requestRender();
    });
    await page.waitForTimeout(100);

    const masks = await page.evaluate(() => photoMasks.map((m) => ({ mode: m.mode, radius: m.radius })));
    expect(masks[0].mode).toBe('circle');
    expect(masks[1].mode).toBe('rounded');
    expect(masks[1].radius).toBe(45);
    expect(masks[2].mode).toBe('none');
  });

  // Regression test for a bug where a Square-masked photo rendered larger
  // than its cell (bled into neighboring cells / the background), because
  // the clip shape was sized to the oversized "cover"-scaled image instead
  // of the cell itself. Circle masks happened to avoid this by luck (their
  // radius formula takes the smaller of the two oversized dimensions,
  // which for a square cell coincidentally equals the cell size).
  test('square mask crops exactly to its cell — does not bleed into neighboring cells', async ({ page }) => {
    await page.goto('/index.html');
    // A non-square source image is essential to reproduce this: cover-mode
    // scaling only overshoots the cell in an axis where the source aspect
    // ratio doesn't already match the (square) cell.
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare, FIXTURES.yellowSquare]);
    await page.click('button:text("Deselect All")'); // avoid the selection outline overlapping the edge samples below
    await page.evaluate(() => {
      photoMasks[0].mode = 'square';
      requestRender();
    });
    await page.waitForTimeout(100);

    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));
    // Sample just outside the masked cell's own bounds, right and below —
    // should be plain background, never photo content.
    const right = await samplePixel(page, bounds.x + bounds.w + 4, bounds.y + Math.floor(bounds.h / 2));
    const below = await samplePixel(page, bounds.x + Math.floor(bounds.w / 2), bounds.y + bounds.h + 4);
    expect(right).toEqual([255, 255, 255, 255]);
    expect(below).toEqual([255, 255, 255, 255]);

    // And confirm the cell interior legitimately has photo content (a
    // sanity check that this isn't trivially passing because nothing
    // rendered at all).
    const inside = await samplePixel(page, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    expect(inside).toEqual([220, 60, 60, 255]);
  });

  test('circle mask also crops exactly to its cell (regression guard alongside the square-mask fix)', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.click('button:text("Deselect All")'); // avoid the selection outline overlapping the edge samples below
    await page.evaluate(() => {
      photoMasks[0].mode = 'circle';
      requestRender();
    });
    await page.waitForTimeout(100);

    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));
    const corner = await samplePixel(page, bounds.x + 5, bounds.y + 5); // circle doesn't reach the square cell's corners
    expect(corner).toEqual([255, 255, 255, 255]);
    const right = await samplePixel(page, bounds.x + bounds.w + 4, bounds.y + Math.floor(bounds.h / 2));
    expect(right).toEqual([255, 255, 255, 255]);
  });

  test('corner radius only applies to, and is only shown as enabled for, the "rounded" mask', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.waitForTimeout(50);

    await page.selectOption('#maskMode', 'circle');
    await expect(page.locator('#radiusGroup')).toHaveClass(/disabled/);

    await page.selectOption('#maskMode', 'rounded');
    await expect(page.locator('#radiusGroup')).not.toHaveClass(/disabled/);
  });

  test('mask controls reflect the currently-selected photo\'s own state, not a shared global value', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    await page.evaluate(() => {
      selectedIndices = [0];
      photoMasks[0].mode = 'circle';
      selectedIndices = [1];
      photoMasks[1].mode = 'rounded';
    });

    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });
    await expect(page.locator('#maskMode')).toHaveValue('circle');

    await page.evaluate(() => { selectedIndices = [1]; syncSliderControls(); });
    await expect(page.locator('#maskMode')).toHaveValue('rounded');
  });

  // Regression test: applying a mask shape to a multi-selection with mixed
  // current shapes used to silently no-op for some photos in the selection.
  // The dropdown displayed the *first* selected photo's current mode, so if
  // the user picked that same mode (wanting it applied to the whole
  // selection), the browser's native <select> never fired a `change` event
  // at all -- its value hadn't actually changed -- leaving every other
  // photo in the selection stuck on its old mode.
  test('applying a mask shape to a mixed-mode multi-selection updates every selected photo, even when the picked value matches the primary photo\'s current mode', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    await page.evaluate(() => {
      photoMasks[0].mode = 'ellipse';
      photoMasks[1].mode = 'circle';
      selectedIndices = [0, 1];
      syncSliderControls();
    });

    // Mixed selection: the dropdown must not silently claim one specific
    // shape (masking the fact that photo 1 differs).
    await expect(page.locator('#maskMode')).toHaveValue('__mixed__');

    // Pick "Ellipse" -- already photo 0's mode, but not photo 1's.
    await page.selectOption('#maskMode', 'ellipse');

    const modes = await page.evaluate(() => photoMasks.map((m) => m.mode));
    expect(modes[0]).toBe('ellipse');
    expect(modes[1]).toBe('ellipse');
  });

  // Same underlying bug class applies to the Mask Pan Behavior dropdown.
  test('applying a pan behavior to a mixed-behavior multi-selection updates every selected photo', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    await page.evaluate(() => {
      photoMasks[0].behavior = 'fixed';
      photoMasks[1].behavior = 'attached';
      selectedIndices = [0, 1];
      syncSliderControls();
    });

    await expect(page.locator('#maskBehavior')).toHaveValue('__mixed__');

    await page.selectOption('#maskBehavior', 'fixed');

    const behaviors = await page.evaluate(() => photoMasks.map((m) => m.behavior));
    expect(behaviors[0]).toBe('fixed');
    expect(behaviors[1]).toBe('fixed');
  });
});
