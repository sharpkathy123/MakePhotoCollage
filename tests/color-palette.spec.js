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

    // Inner Gap is the default active target.
    await page.locator('#paletteArea .swatch').first().click();
    const innerColorValue = await page.inputValue('#innerColor');
    expect(innerColorValue).not.toBe('#ffffff'); // changed from the default white

    const appInnerColorVal = await page.evaluate(() => innerColorVal);
    expect(appInnerColorVal.toLowerCase()).toBe(innerColorValue.toLowerCase());
  });

  test('clicking the None swatch sets the active target to transparent', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.waitForTimeout(100);

    await page.click('.swatch-none');
    const target = await page.evaluate(() => innerColorVal);
    expect(target).toBe('none');
  });
});
