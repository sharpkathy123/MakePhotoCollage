const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Sampled color palette', () => {
  // Regression test: a photo's own sampled colors don't always happen to
  // include anything near black or white (e.g. this solid-red fixture has
  // neither), but both are common, useful choices for a border or
  // background -- they're always added to the internal palette (which only
  // feeds Background's auto-pick, with no visible swatch grid or eyedropper)
  // if nothing already sampled is close enough to either.
  test('the internal sampled palette always includes black and white, even when nothing sampled is close to either', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]); // solid (220, 60, 60) -- nowhere near black or white

    const hexes = await page.evaluate(() => extractSortedPalette(rawImages).map((c) => c.hex));
    expect(hexes).toContain('#000000');
    expect(hexes).toContain('#ffffff');
  });

  test('clicking a color row\'s none button sets that target to transparent', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await page.click('.none-btn[data-target="outer"]');
    expect(await page.evaluate(() => outerColorVal)).toBe('none');
  });

  // Regression coverage for Photo Border Color's own disabled-but-visible
  // state (it stays in the always-visible color-row list; only its swatch/
  // none disable without a selection) lives in layout-reorg.spec.js,
  // alongside the rest of that list's layout.
  //
  // There's no in-app eyedropper any more -- the native color swatches'
  // own OS picker (iOS Safari's color sheet includes its own eyedropper/
  // magnifier) made a custom one redundant real estate.
});
