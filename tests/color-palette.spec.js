const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Sampled color palette', () => {
  test('loading photos populates palette swatches, enabling the palette group', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#paletteGroup')).toHaveClass(/disabled/);

    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.greenSquare]);
    await page.waitForTimeout(100);

    await expect(page.locator('#paletteGroup')).not.toHaveClass(/disabled/);
    const swatchCount = await page.locator('#paletteArea .swatch').count();
    expect(swatchCount).toBeGreaterThan(0);
    // The always-present "None" (transparent) option stays in the palette area too.
    await expect(page.locator('#paletteArea .swatch-none')).toBeVisible();
  });

  test('clicking a palette swatch sets the active color target to that color', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]); // solid red source -> its dominant swatch is red-ish
    await page.waitForTimeout(100);

    // Outer Border is the default active target.
    await page.locator('#paletteArea .swatch').first().click();
    const outerColorValue = await page.inputValue('#outerColor');
    expect(outerColorValue).not.toBe('#1c1c1e'); // changed from the default dark color

    const appOuterColorVal = await page.evaluate(() => outerColorVal);
    expect(appOuterColorVal.toLowerCase()).toBe(outerColorValue.toLowerCase());
  });

  test('clicking the None swatch sets the active target to transparent', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.waitForTimeout(100);

    await page.click('.swatch-none');
    const target = await page.evaluate(() => outerColorVal);
    expect(target).toBe('none');
  });

  // Regression test: a photo's own sampled colors don't always happen to
  // include anything near black or white (e.g. this solid-red fixture has
  // neither), but both are common, useful choices for a border or
  // background -- they're always added to the palette if nothing already
  // sampled is close enough to either.
  test('the palette always includes black and white, even when nothing sampled is close to either', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]); // solid (220, 60, 60) -- nowhere near black or white
    await page.waitForTimeout(100);

    const swatchColors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#paletteArea .swatch')).map(el => el.style.backgroundColor)
    );
    expect(swatchColors).toContain('rgb(0, 0, 0)');
    expect(swatchColors).toContain('rgb(255, 255, 255)');
  });

  test('clicking a palette swatch while Photo Border Color is the active target applies to the selected photo(s)', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.waitForTimeout(100);
    await page.evaluate(() => { selectedIndices = [0]; syncSliderControls(); });

    await page.click('#targetBorderBtn');
    await page.locator('#paletteArea .swatch').first().click();
    await page.waitForTimeout(50);

    const colors = await page.evaluate(() => photoMasks.map((m) => m.borderColor));
    expect(colors[0]).not.toBe('#ffffff'); // changed from the default
    expect(colors[1]).toBe('#ffffff'); // untouched -- not selected

    // Outer Border and Canvas Background are untouched by a Photo Border
    // Color swatch click -- it's a per-photo target, not a global one.
    expect(await page.evaluate(() => outerColorVal)).toBe('#1c1c1e');
    expect(await page.evaluate(() => canvasColorVal)).toBe('none');
  });
});
