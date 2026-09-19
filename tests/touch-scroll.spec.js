const { test, expect } = require('@playwright/test');
const { loadSyntheticPhotos, appPointToViewport, cellCenter, oneFingerGesture } = require('./helpers');

// The canvas has touch-action:none so a photo can be dragged freely in any
// direction -- but that also blocks the browser's own scrolling for every
// touch that starts on the canvas, even one that lands on empty space (the
// outer border/background) with no photo underneath. A swipe that starts
// there should still scroll the page, same as it would anywhere else.
test.describe('Touch scrolling through empty canvas space', () => {
  test.use({ viewport: { width: 500, height: 700 } });

  test('a one-finger swipe starting on empty canvas space (no photo underneath) scrolls the page', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 200, height: 200, color: '#dd2222' },
      { type: 'solid', width: 200, height: 200, color: '#2222dd' },
    ]);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Sanity check: (2,2) in app-space is inside the outer border/background
    // margin, not on top of a photo, with the default 24px Outer Spacing.
    expect(await page.evaluate(() => hitTestCell(2, 2))).toBe(-1);

    const start = await appPointToViewport(page, 2, 2);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await oneFingerGesture(page, [
      { x: start.x, y: start.y },
      { x: start.x, y: start.y - 150 },
      { x: start.x, y: start.y - 300 },
    ]);
    await page.waitForTimeout(50);

    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBeGreaterThan(scrollBefore);
  });

  test('a one-finger swipe starting on a photo still drags it instead of scrolling the page', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 200, height: 200, color: '#dd2222' },
      { type: 'solid', width: 200, height: 200, color: '#2222dd' },
    ]);
    await page.click('button:text("Select All")');
    await page.evaluate(() => window.scrollTo(0, 0));

    const center = await cellCenter(page, 0);
    expect(await page.evaluate(({ x, y }) => hitTestCell(x, y), center)).toBe(0);

    const start = await appPointToViewport(page, center.x, center.y);
    // Default behavior is Attached ("Moving Frame"), where a drag moves x/y
    // -- the swipe below is vertical, so only y should move.
    const yBefore = await page.evaluate(() => transforms[0].y);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await oneFingerGesture(page, [
      { x: start.x, y: start.y },
      { x: start.x, y: start.y - 40 },
      { x: start.x, y: start.y - 80 },
    ]);
    await page.waitForTimeout(50);

    const yAfter = await page.evaluate(() => transforms[0].y);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(yAfter).not.toBe(yBefore); // dragging the photo still works
    expect(scrollAfter).toBe(scrollBefore); // and the page did not also scroll
  });
});
