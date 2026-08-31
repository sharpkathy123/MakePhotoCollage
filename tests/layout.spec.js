const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Layout & cell sizing', () => {
  test('grid layout keeps every cell a uniform 600x600 square, even with mixed aspect ratios', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare, FIXTURES.yellowSquare]);

    const layout = await page.evaluate(() => layoutType.value);
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
    await page.selectOption('#layoutType', 'horizontal');
    await page.waitForFunction(() => layoutType.value === 'horizontal');

    const bounds = await page.evaluate(() => cellBounds.map((b) => ({ w: b.w, h: b.h })));
    // redLandscape is 300x180 (aspect 5:3) -> width = round(600 * 5/3) = 1000, height = 600
    expect(bounds[0]).toEqual({ w: 1000, h: 600 });
    // bluePortrait is 180x300 (aspect 3:5) -> width = round(600 * 3/5) = 360, height = 600
    expect(bounds[1]).toEqual({ w: 360, h: 600 });
  });

  test('a photo masked to square/circle always gets a fixed 600x600 cell in horizontal layout, regardless of its own aspect ratio', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.selectOption('#layoutType', 'horizontal');
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
});
