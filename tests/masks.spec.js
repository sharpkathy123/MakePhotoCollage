const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, samplePixel, clickOption, getActiveOptionValue, setColorInput } = require('./helpers');

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
    // Canvas Background auto-picks an opaque color on load -- turn it off so
    // this test can isolate mask cropping, not that separate fill.
    await page.evaluate(() => { canvasColorVal = 'none'; });
    await page.evaluate(() => {
      photoMasks[0].mode = 'circle';
      requestRender();
    });
    await page.waitForTimeout(100);

    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));
    // The corner is outside even the circle's own border ring (which hugs
    // the circle shape, not the square cell) -- nothing paints there, so
    // it's fully transparent, not a flat background fill.
    const corner = await samplePixel(page, bounds.x + 5, bounds.y + 5); // circle doesn't reach the square cell's corners
    expect(corner[3]).toBe(0);
    // Just past the circle's own edge, within its (default white) border
    // ring though -- still covered, just by the border instead of content.
    const right = await samplePixel(page, bounds.x + bounds.w + 4, bounds.y + Math.floor(bounds.h / 2));
    expect(right).toEqual([255, 255, 255, 255]);
  });

  test('corner radius only applies to, and is only shown as enabled for, the "rounded" mask', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.waitForTimeout(50);

    await clickOption(page, '#maskModeGroup', 'circle');
    await expect(page.locator('#radiusGroup')).toHaveClass(/disabled/);

    await clickOption(page, '#maskModeGroup', 'rounded');
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
    expect(await getActiveOptionValue(page, '#maskModeGroup')).toBe('circle');

    await page.evaluate(() => { selectedIndices = [1]; syncSliderControls(); });
    expect(await getActiveOptionValue(page, '#maskModeGroup')).toBe('rounded');
  });

  // Regression test: applying a mask shape to a multi-selection with mixed
  // current shapes used to silently no-op for some photos in the selection,
  // back when this was a native <select>: the dropdown displayed the
  // *first* selected photo's current mode, so if the user picked that same
  // mode (wanting it applied to the whole selection), the browser's native
  // <select> never fired a `change` event at all -- its value hadn't
  // actually changed -- leaving every other photo in the selection stuck on
  // its old mode. The custom button group applies on every click
  // regardless, so this can't happen anymore, but the guarantee itself
  // (every selected photo gets updated) is still worth protecting.
  test('applying a mask shape to a mixed-mode multi-selection updates every selected photo, even when the picked value matches the primary photo\'s current mode', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    await page.evaluate(() => {
      photoMasks[0].mode = 'ellipse';
      photoMasks[1].mode = 'circle';
      selectedIndices = [0, 1];
      syncSliderControls();
    });

    // Mixed selection: no single button should claim to be the current
    // shape (that would mask the fact that photo 1 differs).
    expect(await getActiveOptionValue(page, '#maskModeGroup')).toBeNull();

    // Pick "Ellipse" -- already photo 0's mode, but not photo 1's.
    await clickOption(page, '#maskModeGroup', 'ellipse');

    const modes = await page.evaluate(() => photoMasks.map((m) => m.mode));
    expect(modes[0]).toBe('ellipse');
    expect(modes[1]).toBe('ellipse');
    // The selection is uniform again now, so exactly one button is active.
    expect(await getActiveOptionValue(page, '#maskModeGroup')).toBe('ellipse');
  });

  // Same underlying guarantee applies to the Mask Pan Behavior group.
  test('applying a pan behavior to a mixed-behavior multi-selection updates every selected photo', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    await page.evaluate(() => {
      photoMasks[0].behavior = 'fixed';
      photoMasks[1].behavior = 'attached';
      selectedIndices = [0, 1];
      syncSliderControls();
    });

    expect(await getActiveOptionValue(page, '#maskBehaviorGroup')).toBeNull();

    await clickOption(page, '#maskBehaviorGroup', 'fixed');

    const behaviors = await page.evaluate(() => photoMasks.map((m) => m.behavior));
    expect(behaviors[0]).toBe('fixed');
    expect(behaviors[1]).toBe('fixed');
    expect(await getActiveOptionValue(page, '#maskBehaviorGroup')).toBe('fixed');
  });

  test('every photo\'s border defaults to white', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);

    const colors = await page.evaluate(() => photoMasks.map((m) => m.borderColor));
    expect(colors).toEqual(['#ffffff', '#ffffff', '#ffffff']);
  });

  // Regression test: the border used to be a single flat color filling the
  // whole gap area behind every photo (the old "Inner Area Background"),
  // regardless of any individual photo's own mask shape. It's now a solid
  // backer in each photo's OWN mask shape, sized a bit larger than the
  // photo, drawn behind it -- so a circle-masked photo gets a circular
  // border ring, not a rectangular one, and different photos can have
  // different border colors.
  test('a photo\'s border hugs its own mask shape and color, independent of other photos', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.click('button:text("Deselect All")'); // avoid the selection outline overlapping the samples below
    // Canvas Background auto-picks an opaque color on load -- turn it off so
    // the "untouched (transparent)" corner sample below isolates the border
    // shape, not that separate fill.
    await page.evaluate(() => { canvasColorVal = 'none'; });
    await page.evaluate(() => {
      photoMasks[0].mode = 'circle';
      photoMasks[0].borderColor = '#ff8800';
      requestRender();
    });
    await page.waitForTimeout(100);

    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));
    // Just past the circle's edge -- inside its (custom-colored) border ring.
    const ringPoint = await samplePixel(page, bounds.x + bounds.w + 4, bounds.y + Math.floor(bounds.h / 2));
    expect(ringPoint).toEqual([255, 136, 0, 255]);
    // The square cell's corner -- outside even the enlarged circular border,
    // so it's untouched (transparent), proving the border followed the
    // circle shape rather than filling the whole rectangular cell.
    const corner = await samplePixel(page, bounds.x + 5, bounds.y + 5);
    expect(corner[3]).toBe(0);
  });

  test('the Border Color control updates only the selected photo(s), leaving others untouched', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });

    // Photo Border Color is one of three Color Target buttons now (Outer
    // Border and Canvas Background are the others) -- it must be the active
    // target before its picker input takes effect, same as those two.
    await page.click('#targetBorderBtn');
    await setColorInput(page, '#borderColor', '#00aaff');
    await page.waitForTimeout(50);

    const colors = await page.evaluate(() => photoMasks.map((m) => m.borderColor));
    expect(colors[0]).toBe('#00aaff');
    expect(colors[1]).toBe('#ffffff'); // untouched

    // Switching selection reflects that photo's own color, not photo 0's.
    await page.evaluate(() => { selectedIndices = [1]; syncSliderControls(); });
    expect(await page.locator('#borderColor').inputValue()).toBe('#ffffff');
  });

  // Regression test: syncSliderControls set the swatch's .value but never
  // toggled the transparent-active checkerboard class, so switching to a
  // photo whose border is set to None showed a stale solid color instead
  // of the same "None" pattern used everywhere else in the app.
  test('the Border Color swatch shows the transparent "None" pattern for a photo whose border is set to none', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.evaluate(() => { photoMasks[0].borderColor = 'none'; });

    await page.evaluate(() => { selectedIndices = [1]; syncSliderControls(); });
    expect(await page.locator('#borderColor').evaluate(el => el.classList.contains('transparent-active'))).toBe(false);

    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });
    expect(await page.locator('#borderColor').evaluate(el => el.classList.contains('transparent-active'))).toBe(true);
  });

  // Regression test: an unrecognized mask mode used to fall through
  // applyMaskPath's if/else chain with no matching branch, leaving the
  // clip path empty and the photo invisible with no error. Not reachable
  // through the UI today (the option buttons only ever write one of the
  // four known modes), but a defensive fallback protects against a future
  // source of bad mode values (e.g. a saved/imported collage).
  test('an unrecognized mask mode falls back to a plain rect instead of clipping the photo to nothing', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].mode = 'square'; requestRender(); });
    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));

    await page.evaluate(() => { photoMasks[0].mode = 'this-mode-does-not-exist'; requestRender(); });

    const center = await samplePixel(page, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    expect(center).toEqual([220, 60, 60, 255]); // still rendered, not clipped away
  });

  // Regression test: Photo Border Color applies to whatever's currently
  // selected -- with nothing selected, both its picker input and a palette
  // swatch click used to silently no-op with no visible sign why. It's now
  // disabled outright whenever there's no selection to apply to.
  test('the Photo Border Color target is disabled when nothing is selected, and falls back to Outer Border', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")'); // nothing is selected by default

    await expect(page.locator('#targetBorderBtn')).toBeEnabled();

    await page.click('#targetBorderBtn');
    expect(await page.evaluate(() => activeColorTarget)).toBe('border');

    await page.click('button:text("Deselect All")');

    await expect(page.locator('#targetBorderBtn')).toBeDisabled();
    // It was the active target when the selection emptied out -- falls
    // back to Outer Border rather than staying active-but-unusable.
    expect(await page.evaluate(() => activeColorTarget)).toBe('outer');

    await page.click('button:text("Select All")');
    await expect(page.locator('#targetBorderBtn')).toBeEnabled();
  });
});
