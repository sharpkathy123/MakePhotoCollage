const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, cellCenter, appPointToViewport } = require('./helpers');

// Arms the eyedropper for `target` (one of 'outer'/'canvas'/'border') and
// taps the given app-space canvas point to sample its pixel color.
async function sampleColorAt(page, target, point) {
  await page.click(`.eyedropper-btn[data-target="${target}"]`);
  const viewportPoint = await appPointToViewport(page, point.x, point.y);
  await page.mouse.click(viewportPoint.x, viewportPoint.y);
}

test.describe('Sampled color palette', () => {
  // Regression test: a photo's own sampled colors don't always happen to
  // include anything near black or white (e.g. this solid-red fixture has
  // neither), but both are common, useful choices for a border or
  // background -- they're always added to the internal palette (which now
  // only feeds Canvas Background's auto-pick, with no visible swatch grid)
  // if nothing already sampled is close enough to either.
  test('the internal sampled palette always includes black and white, even when nothing sampled is close to either', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]); // solid (220, 60, 60) -- nowhere near black or white

    const hexes = await page.evaluate(() => extractSortedPalette(rawImages).map((c) => c.hex));
    expect(hexes).toContain('#000000');
    expect(hexes).toContain('#ffffff');
  });

  test('the eyedropper samples a pixel from the collage into the armed target, then disarms itself', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    const point = await cellCenter(page, 0); // solid (220, 60, 60) content
    await sampleColorAt(page, 'outer', point);

    expect(await page.evaluate(() => outerColorVal)).toBe('#dc3c3c');
    await expect(page.locator('.eyedropper-btn[data-target="outer"]')).not.toHaveClass(/active/);
    await expect(page.locator('#collageCanvas')).not.toHaveClass(/sampling-color/);
    await expect(page.locator('#eyedropperHint')).toBeHidden();
  });

  test('clicking a color row\'s none button sets that target to transparent', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await page.click('.none-btn[data-target="outer"]');
    expect(await page.evaluate(() => outerColorVal)).toBe('none');
  });

  test('the eyedropper for Photo Border Color applies to the selected photo(s), leaving Outer Border and Canvas Background untouched', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });
    const canvasColorBefore = await page.evaluate(() => canvasColorVal);
    const outerColorBefore = await page.evaluate(() => outerColorVal);

    const point = await cellCenter(page, 1); // solid (60, 120, 220) content, a photo NOT selected
    await sampleColorAt(page, 'border', point);

    const colors = await page.evaluate(() => photoMasks.map((m) => m.borderColor));
    expect(colors[0]).toBe('#3c78dc');
    expect(colors[1]).toBe('#ffffff'); // untouched -- not selected

    // Outer Border and Canvas Background are untouched by the Photo Border
    // Color eyedropper -- it's a per-photo target, not a global one.
    expect(await page.evaluate(() => outerColorVal)).toBe(outerColorBefore);
    expect(await page.evaluate(() => canvasColorVal)).toBe(canvasColorBefore);
  });

  // Regression coverage for Photo Border Color's own disabled-but-visible
  // state (it stays in the always-visible color-row list; only its swatch/
  // eyedropper/none disable without a selection) lives in
  // layout-reorg.spec.js, alongside the rest of that list's layout.
});
