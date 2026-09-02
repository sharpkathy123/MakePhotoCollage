const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, appPointToViewport, cellCenter, clickOption } = require('./helpers');

// Drags the photo at cellBounds[idx]'s center by (dx, dy), in app-space
// pixels, via a real multi-step mouse gesture (not a single teleporting
// click) -- needed to distinguish an actual drag from a plain tap, since
// beginCellInteraction/resolvePendingNarrow decide which one happened by
// how far the pointer actually moved.
async function dragCellBy(page, idx, dx, dy) {
  const start = await cellCenter(page, idx);
  const startViewport = await appPointToViewport(page, start.x, start.y);
  const endViewport = await appPointToViewport(page, start.x + dx, start.y + dy);
  await page.mouse.move(startViewport.x, startViewport.y);
  await page.mouse.down();
  await page.mouse.move(endViewport.x, endViewport.y, { steps: 5 });
  await page.mouse.up();
}

test.describe('Selection', () => {
  test('a freshly loaded collage has nothing selected', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([]);
    await expect(page.locator('#selectedPhotoLabel')).toHaveText('No Photos Selected');
  });

  test('tapping empty canvas space deselects an existing selection', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);

    // The outer margin (default 24px outer spacing) is empty canvas space,
    // never inside any photo cell.
    const emptyPoint = await appPointToViewport(page, 2, 2);
    await page.mouse.click(emptyPoint.x, emptyPoint.y);

    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([]);
  });

  // Regression coverage for "tap outside the collage to deselect" -- the
  // gesture people reach for first, matching how Figma/Keynote/Photoshop's
  // empty canvas backdrop (not their side panels) deselects on click.
  test('tapping outside the whole card deselects; tapping inside a control does not', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);

    // Clicking inside a control (the page title) must not deselect.
    await page.click('h1');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);

    // The page background outside .card -- far from both the card and the
    // fixed Save bar -- deselects.
    const { x, y } = await page.evaluate(() => ({ x: window.innerWidth - 20, y: 40 }));
    await page.mouse.click(x, y);
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([]);
  });

  // The actual bug report: Select All, then drag one of the selected
  // photos, used to collapse the selection down to just that one photo
  // before the drag even started -- losing the group. Matches how
  // Figma/Keynote/PowerPoint handle dragging a member of an existing
  // multi-selection: the whole group moves together.
  test('Select All, then dragging one selected photo moves every selected photo and keeps the selection', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.click('button:text("Select All")');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0, 1]);

    await dragCellBy(page, 0, 60, 45);

    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0, 1]);
    // Attached is the default behavior, so a drag moves x/y for both photos.
    const positions = await page.evaluate(() => transforms.map((t) => ({ x: t.x, y: t.y })));
    expect(positions[0].x).toBeGreaterThan(20);
    expect(positions[0].y).toBeGreaterThan(15);
    expect(positions[1]).toEqual(positions[0]);
  });

  // Companion case: the same starting selection, but a plain tap (no
  // movement) on one of the already-selected photos should still narrow
  // the selection to just that one -- only a real drag preserves the group.
  test('Select All, then a plain tap (no movement) on one selected photo narrows the selection to just that one', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.click('button:text("Select All")');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0, 1]);

    const point = await cellCenter(page, 1);
    const viewportPoint = await appPointToViewport(page, point.x, point.y);
    await page.mouse.click(viewportPoint.x, viewportPoint.y);

    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([1]);
  });

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

  // Regression test: deselectAllPhotos used to set the "No Photos Selected"
  // label directly instead of calling syncSliderControls() the way
  // selectAllPhotos() does -- leaving the Frame Shape/Behavior buttons
  // showing whichever photo was selected before, with no visual sign
  // nothing is selected any more.
  test('Deselect All clears the Frame Shape/Behavior highlighting, not just the selection', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { selectedIndices = [0]; photoMasks[0].mode = 'circle'; syncSliderControls(); });

    expect(await page.locator('#maskModeGroup .option-btn.active').count()).toBe(1);

    await page.click('button:text("Deselect All")');

    expect(await page.locator('#maskModeGroup .option-btn.active').count()).toBe(0);
    await expect(page.locator('#selectedPhotoLabel')).toHaveText('No Photos Selected');
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
    await clickOption(page, '#maskModeGroup', 'circle');
    expect(await page.evaluate(() => photoMasks.map((m) => m.mode))).toEqual(['circle', 'circle', 'circle', 'circle']);

    await page.click('#multiSelectToggleBtn');
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([]);

    const c0 = await cellCenter(page, 0);
    const v0 = await appPointToViewport(page, c0.x, c0.y);
    await page.mouse.click(v0.x, v0.y);
    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);

    await clickOption(page, '#maskModeGroup', 'ellipse');
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
