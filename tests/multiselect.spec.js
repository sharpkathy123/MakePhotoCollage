const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, appPointToViewport, cellCenter } = require('./helpers');

test.describe('Selection', () => {
  test('a plain click selects exactly one photo, replacing any previous selection', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    await page.evaluate(() => { selectedIndices = [0, 1, 2]; });

    const point = await cellCenter(page, 1);
    const viewportPoint = await appPointToViewport(page, point.x, point.y);
    await page.mouse.click(viewportPoint.x, viewportPoint.y);

    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([1]);
  });

  test('Select All / Deselect All work as expected', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);

    await page.click('button:text("Select All")');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0, 1, 2]);

    await page.click('button:text("Deselect All")');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([]);
  });

  test('multi-select mode: clicking adds/removes photos one at a time', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    await page.click('button:text("Deselect All")');
    await page.click('#multiSelectToggleBtn');

    const c0 = await cellCenter(page, 0);
    const c2 = await cellCenter(page, 2);
    const v0 = await appPointToViewport(page, c0.x, c0.y);
    const v2 = await appPointToViewport(page, c2.x, c2.y);

    await page.mouse.click(v0.x, v0.y);
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);

    await page.mouse.click(v2.x, v2.y);
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0, 2]);

    // Clicking an already-selected photo in multi-select mode removes it.
    await page.mouse.click(v0.x, v0.y);
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([2]);
  });

  // Regression test: turning on multi-select mode used to silently keep
  // whatever selection already existed (e.g. from "Select All"). Since a
  // multi-select tap only toggles membership, the very first tap on one of
  // those already-selected photos removed it instead of isolating it, so a
  // bulk edit picked right after landed on every *other* photo -- while the
  // dropdown showed the newly-picked value, making it look like the tapped
  // photo had changed when it hadn't.
  test('turning on multi-select mode clears any existing selection, so tapping one photo isolates just that one', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare, FIXTURES.yellowSquare]);

    await page.click('button:text("Select All")');
    await page.selectOption('#maskMode', 'circle');
    expect(await page.evaluate(() => photoMasks.map((m) => m.mode))).toEqual(['circle', 'circle', 'circle', 'circle']);

    await page.click('#multiSelectToggleBtn');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([]);

    const c0 = await cellCenter(page, 0);
    const v0 = await appPointToViewport(page, c0.x, c0.y);
    await page.mouse.click(v0.x, v0.y);
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);

    await page.selectOption('#maskMode', 'ellipse');
    const modes = await page.evaluate(() => photoMasks.map((m) => m.mode));
    expect(modes).toEqual(['ellipse', 'circle', 'circle', 'circle']);
  });

  test('multi-select toggle button reflects its own state and shows the hint text', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await expect(page.locator('#multiSelectToggleBtn')).not.toHaveClass(/active/);
    await expect(page.locator('#multiSelectHint')).toBeHidden();

    await page.click('#multiSelectToggleBtn');
    await expect(page.locator('#multiSelectToggleBtn')).toHaveClass(/active/);
    await expect(page.locator('#multiSelectHint')).toBeVisible();
  });

  // Regression test: on a real touch device, a quick tap used to fire BOTH
  // our touchstart handler AND a browser-synthesized mousedown shortly after
  // (standard touch/mouse compatibility emulation) since touchstart was a
  // passive listener with no preventDefault(). That ran the multi-select
  // toggle twice, canceling itself out, so tapping appeared to do nothing.
  // This needs a real touch-capable device profile (not a dispatched DOM
  // event) to actually exercise the browser's touch pipeline.
  test.describe('on a real touch device', () => {
    // Only the touch-relevant subset of a device preset (not the full
    // devices['Pixel 7'], whose defaultBrowserType can't be overridden
    // inside a describe block without forcing a separate worker/project).
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

    test('a single tap toggles multi-select exactly once, with no synthetic mousedown', async ({ page }) => {
      await page.goto('/index.html');
      await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
      await page.evaluate(() => {
        window.__mousedownCount = 0;
        document.getElementById('collageCanvas').addEventListener('mousedown', () => { window.__mousedownCount++; });
      });
      await page.click('button:text("Deselect All")');
      await page.click('#multiSelectToggleBtn');

      const c0 = await cellCenter(page, 0);
      const v0 = await appPointToViewport(page, c0.x, c0.y);

      await page.touchscreen.tap(v0.x, v0.y);
      await page.waitForTimeout(200);

      expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);
      expect(await page.evaluate(() => window.__mousedownCount)).toBe(0);

      // A second real tap on the same photo should toggle it back off.
      await page.touchscreen.tap(v0.x, v0.y);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => selectedIndices.slice())).toEqual([]);
    });
  });
});
