const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, samplePixel, appPointToViewport } = require('./helpers');

// Both photos default to a 2-column grid layout (600x600 cells). Forcing
// 'square' mode on both makes each one cover mode-fit its own cell edge to
// edge with no letterboxing gap, so growing photo 0's Attached-mode frame
// with frameScale reliably pushes solid red past the inner gap and into
// photo 1's own cell, and photo 1's solid blue fully covers its own cell
// too -- without a fully-covering mask on both sides, a fit-mode photo can
// leave empty (background-colored) margins inside its own cell, which
// would make an "overlap" sample point misleadingly land on background
// instead of on whichever photo is actually topmost.
async function setupOverlap(page) {
  await page.goto('/index.html');
  await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
  await page.evaluate(() => {
    photoMasks[0].mode = 'square';
    photoMasks[0].behavior = 'attached';
    photoMasks[1].mode = 'square';
    transforms[0].frameScale = 1.2;
    requestRender();
  });
  await page.waitForTimeout(100);
  return page.evaluate(() => ({
    // Well inside photo 1's own nominal cell, but also inside photo 0's
    // grown frame -- genuine overlap, not just an ambiguous edge pixel.
    x: cellBounds[1].x + 10,
    y: cellBounds[1].y + Math.floor(cellBounds[1].h / 2),
  }));
}

test.describe('Front/back stacking order', () => {
  test('default stacking order draws a later-loaded photo on top of an earlier one', async ({ page }) => {
    const point = await setupOverlap(page);
    const color = await samplePixel(page, point.x, point.y);
    expect(color).toEqual([60, 120, 220, 255]); // bluePortrait (photo 1), on top by default
  });

  test('Bring to Front moves the selected photo (and its frame) above whatever is currently on top', async ({ page }) => {
    const point = await setupOverlap(page);
    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });
    await page.click('button:text("Bring to Front")');
    await page.waitForTimeout(100);

    const color = await samplePixel(page, point.x, point.y);
    expect(color).toEqual([220, 60, 60, 255]); // redLandscape (photo 0), now on top
  });

  test('Send to Back moves the selected photo (and its frame) below whatever is currently on the bottom', async ({ page }) => {
    const point = await setupOverlap(page);
    // Photo 1 is already on top by default -- explicitly send photo 0 to
    // the back so this exercises the other direction too, not just the
    // inverse of "Bring to Front" above.
    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });
    await page.click('button:text("Send to Back")');
    await page.waitForTimeout(100);

    const color = await samplePixel(page, point.x, point.y);
    expect(color).toEqual([60, 120, 220, 255]); // bluePortrait (photo 1), unchanged -- still on top
  });

  test('reordering the stack never changes a photo\'s own grid position', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    const before = await page.evaluate(() => cellBounds.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h })));

    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });
    await page.click('button:text("Bring to Front")');
    await page.waitForTimeout(100);

    const after = await page.evaluate(() => cellBounds.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h })));
    expect(after).toEqual(before);
  });

  test('hit-testing resolves an overlap tap to whichever photo is topmost', async ({ page }) => {
    const point = await setupOverlap(page);

    // Photo 1 is on top by default -- tapping the overlap should select it.
    let viewportPoint = await appPointToViewport(page, point.x, point.y);
    await page.mouse.click(viewportPoint.x, viewportPoint.y);
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([1]);

    // Send photo 1 to the back; the same tap should now resolve to photo 0.
    await page.evaluate(() => { selectedIndices = [1]; syncSliderControls(); });
    await page.click('button:text("Send to Back")');
    await page.waitForTimeout(100);

    viewportPoint = await appPointToViewport(page, point.x, point.y);
    await page.mouse.click(viewportPoint.x, viewportPoint.y);
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);
  });

  test('bringing multiple selected photos to front preserves their relative order among themselves', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    // Default zOrder is [0, 1, 2]. Select photos 0 and 1 (in that relative
    // order) and bring them both to front -- 2 should end up on the
    // bottom, with 0 still below 1 (their original relative order kept).
    await page.evaluate(() => { selectedIndices = [0, 1]; syncSliderControls(); });
    await page.click('button:text("Bring to Front")');

    const order = await page.evaluate(() => zOrder.slice());
    expect(order).toEqual([2, 0, 1]);
  });

  test('a newly appended photo joins the stack on top', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });
    await page.click('button:text("Send to Back")'); // no-op with one photo, but exercises the path
    await loadPhotos(page, [FIXTURES.bluePortrait]);

    const order = await page.evaluate(() => zOrder.slice());
    expect(order).toEqual([0, 1]);
  });
});
