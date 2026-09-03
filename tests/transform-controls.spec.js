const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, cellCenter, pinchGesture } = require('./helpers');

test.describe('Scale / rotation / reset', () => {
  test('pinch-to-zoom and twist-to-rotate update the selected photo\'s transform (Attached mode, the default)', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")'); // nothing is selected by default
    await page.click('#rotationLockBtn'); // rotation is locked by default -- unlock it for this test

    const center = await cellCenter(page, 0);
    await pinchGesture(page, center, { startDist: 100, endDist: 200, startAngle: 0, endAngle: 45 });
    await page.waitForTimeout(100);

    // Attached mode (the default for a freshly loaded photo, so the frame
    // and photo move together) routes both to the frame's own fields --
    // frameScale and rot -- leaving the Fixed-mode content-only fields
    // (scale/panRot) untouched. See pan-behavior.spec for the fuller
    // Fixed-vs-Attached routing and rendered-pixel coverage.
    const t = await page.evaluate(() => ({ scale: transforms[0].scale, frameScale: transforms[0].frameScale, rot: transforms[0].rot, panRot: transforms[0].panRot }));
    expect(t.frameScale).toBeCloseTo(2, 2);
    expect(t.rot).toBeCloseTo(45, 1);
    expect(t.scale).toBe(1);
    expect(t.panRot).toBe(0);
  });

  test('a pinch zoom applies to every selected photo in a multi-selection', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    await page.click('button:text("Select All")');

    const center = await cellCenter(page, 0);
    await pinchGesture(page, center, { startDist: 100, endDist: 180 });
    await page.waitForTimeout(100);

    // Attached is the default behavior, so the pinch routes to frameScale
    // for every selected photo (see getGestureScale/setGestureScale).
    const scales = await page.evaluate(() => transforms.map((t) => t.frameScale));
    scales.forEach((s) => expect(s).toBeCloseTo(1.8, 2));
  });

  // Rotation defaults locked (see layout-reorg.spec's toolbar coverage) --
  // a twist during an ordinary pinch must not rotate anything unless
  // explicitly unlocked first.
  test('a pinch twist does nothing while Rotation Locked is on, but still zooms', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")');
    expect(await page.evaluate(() => rotationLocked)).toBe(true);

    const center = await cellCenter(page, 0);
    await pinchGesture(page, center, { startDist: 100, endDist: 150, startAngle: 0, endAngle: 60 });
    await page.waitForTimeout(100);

    const t = await page.evaluate(() => ({ frameScale: transforms[0].frameScale, rot: transforms[0].rot }));
    expect(t.frameScale).toBeCloseTo(1.5, 2);
    expect(t.rot).toBe(0);
  });

  test('Reset Photo restores scale, rotation, position, and pan to defaults', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await page.evaluate(() => {
      selectedIndices = [0]; // nothing is selected by default; Reset Photo acts on the selection
      transforms[0] = { scale: 2.5, rot: 90, x: 40, y: -20, panX: 15, panY: 30, frameScale: 1.8, panRot: -45 };
      syncSliderControls();
    });

    await page.click('button:text("Reset Photo")');
    await page.waitForTimeout(50);

    const t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t).toEqual({ scale: 1, rot: 0, x: 0, y: 0, panX: 0, panY: 0, frameScale: 1, panRot: 0 });
  });
});

test.describe('Rotation lock toggle', () => {
  // A small icon toggle (matching the Google Photos/info buttons), not a
  // 4th button in the Select Multiple/Select All/Deselect All group -- that
  // group's CSS assumes exactly 3 buttons per row (flex: 1 1 calc(33% -
  // 6px)), and a 4th stretched to fill its own wrapped row, pushing the
  // canvas down far enough to fall below the viewport in real testing.
  test('defaults to locked, and toggles on click', async ({ page }) => {
    await page.goto('/index.html');

    const btn = page.locator('#rotationLockBtn');
    await expect(btn).toHaveText('🔒');
    await expect(btn).toHaveAttribute('title', 'Rotation Locked — tap to unlock');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => rotationLocked)).toBe(true);

    await btn.click();
    await expect(btn).toHaveText('🔓');
    await expect(btn).toHaveAttribute('title', 'Rotation Unlocked — tap to lock');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => rotationLocked)).toBe(false);

    await btn.click();
    await expect(btn).toHaveText('🔒');
    expect(await page.evaluate(() => rotationLocked)).toBe(true);
  });

  // Regression coverage: the icon toggle must not force the selection
  // toolbar row(s) to wrap in a way that pushes the canvas out of easy
  // reach -- see the comment above.
  test('adding the rotation lock toggle does not wrap the Select Multiple/Select All/Deselect All row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/index.html');

    const boxes = await page.locator('.button-group-inline:has(#multiSelectToggleBtn) button').all();
    const ys = [];
    for (const box of boxes) {
      const b = await box.boundingBox();
      ys.push(Math.round(b.y));
    }
    expect(new Set(ys).size).toBe(1); // all three still share one row
  });
});
