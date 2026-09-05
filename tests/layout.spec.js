const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, clickOption } = require('./helpers');

test.describe('Layout & cell sizing', () => {
  test('grid layout keeps every cell a uniform 600x600 square, even with mixed aspect ratios', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare, FIXTURES.yellowSquare]);

    const layout = await page.evaluate(() => layoutType);
    expect(layout).toBe('grid'); // 4 photos auto-picks grid, not the 3/5-photo horizontal special case

    const bounds = await page.evaluate(() => cellBounds.map((b) => ({ w: b.w, h: b.h })));
    for (const b of bounds) {
      expect(b.w).toBe(600);
      expect(b.h).toBe(600);
    }
  });

  test('horizontal strip layout sizes each cell to its own photo aspect ratio when unmasked', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await clickOption(page, '#layoutTypeGroup', 'horizontal');
    // layoutType itself flips synchronously on click, but the actual
    // re-render (and cellBounds with it) is requestAnimationFrame-deferred
    // -- waiting on layoutType alone raced ahead of it under heavier
    // parallel load. Wait for cellBounds to actually reflect the new
    // layout (no longer the old grid's uniform 600x600) instead.
    await page.waitForFunction(() => layoutType === 'horizontal' && cellBounds[0] && cellBounds[0].w !== 600);

    const bounds = await page.evaluate(() => cellBounds.map((b) => ({ w: b.w, h: b.h })));
    // redLandscape is 300x180 (aspect 5:3) -> width = round(600 * 5/3) = 1000, height = 600
    expect(bounds[0]).toEqual({ w: 1000, h: 600 });
    // bluePortrait is 180x300 (aspect 3:5) -> width = round(600 * 3/5) = 360, height = 600
    expect(bounds[1]).toEqual({ w: 360, h: 600 });
  });

  test('a photo masked to square/circle always gets a fixed 600x600 cell in horizontal layout, regardless of its own aspect ratio', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await clickOption(page, '#layoutTypeGroup', 'horizontal');
    await page.evaluate(() => {
      photoMasks[0].mode = 'circle';
      photoMasks[1].mode = 'none';
      requestRender();
    });
    await page.waitForTimeout(100);

    const bounds = await page.evaluate(() => cellBounds.map((b) => ({ w: b.w, h: b.h })));
    expect(bounds[0]).toEqual({ w: 600, h: 600 }); // circle-masked: fixed square cell
    expect(bounds[1]).toEqual({ w: 360, h: 600 }); // unmasked: aspect-fit cell (its own portrait ratio)
  });

  test('changing the column count updates activeCols and re-renders', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare, FIXTURES.yellowSquare]);
    await page.selectOption('#gridCols', '4');
    await page.waitForFunction(() => activeCols === 4);

    const cols = await page.evaluate(() => activeCols);
    expect(cols).toBe(4);
  });

  // Regression test: an Attached-mode photo's x/y is a raw pixel nudge
  // relative to its own cell. Grid, Horizontal Strip, and Vertical Feed
  // place cells completely differently, so a nudge that looked right in
  // one arrangement lands somewhere arbitrary (visibly misaligned) in
  // another. Switching layout now resets that offset instead of carrying
  // over a nudge that no longer corresponds to anything.
  test('switching layout type resets Attached-mode photo position offsets', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.evaluate(() => {
      photoMasks[0].behavior = 'attached';
      transforms[0].x = 40;
      transforms[0].y = -60;
      // A Fixed-mode photo's panX/panY should NOT be touched by this --
      // panning is relative to the photo's own content, not cell layout,
      // so it stays meaningful across a layout change.
      photoMasks[1].behavior = 'fixed';
      transforms[1].panX = 25;
      transforms[1].panY = 15;
    });

    await clickOption(page, '#layoutTypeGroup', 'vertical');
    await page.waitForFunction(() => layoutType === 'vertical');

    const after = await page.evaluate(() => ({
      t0: { ...transforms[0] },
      t1: { ...transforms[1] },
    }));
    expect(after.t0.x).toBe(0);
    expect(after.t0.y).toBe(0);
    expect(after.t1.panX).toBe(25);
    expect(after.t1.panY).toBe(15);
  });
});
