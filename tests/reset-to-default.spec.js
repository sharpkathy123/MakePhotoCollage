const { test, expect } = require('@playwright/test');
const { loadSyntheticPhotos } = require('./helpers');

// "Reset to Default" keeps every currently-loaded photo but wipes every
// styling/layout choice made since -- shapes, border colors/widths,
// positions, z-order, selection, layout type/columns -- back to the same
// defaults a brand-new collage of these same photos would start from. Lets
// someone back out of a Surprise Me (or their own fiddling) they don't like
// without having to re-pick every photo from scratch.
test.describe('Reset to Default (keep photos)', () => {
  test('the button is hidden until photos are loaded, and hidden again after Start New Collage', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#resetDefaultBtn')).toBeHidden();

    await loadSyntheticPhotos(page, [{ type: 'solid', width: 200, height: 200, color: '#dd2222' }]);
    await expect(page.locator('#resetDefaultBtn')).toBeVisible();

    page.on('dialog', (d) => d.accept());
    await page.click('#startNewBtn');
    await expect(page.locator('#resetDefaultBtn')).toBeHidden();
  });

  test('resets colors, border widths, layout, shapes, positions, and selection, but keeps the photos', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 200, height: 200, color: '#dd2222' },
      { type: 'solid', width: 200, height: 200, color: '#2222dd' },
    ]);

    // Scramble everything a Reset should put back.
    await page.evaluate(() => {
      setLayoutType('vertical');
      applyColorToTarget('outer', '#00ff00');
      applyColorToTarget('canvas', '#ff00ff');
      selectedIndices = [0, 1];
      photoMasks[0].mode = 'circle';
      photoMasks[1].mode = 'square';
      photoMasks[0].borderColor = '#abcdef';
      transforms[0].panX = 55;
      transforms[0].scale = 2;
      zOrder = [1, 0];
      multiSelectMode = true;
      requestRender();
    });
    await page.fill('#innerSpacing', '77');
    await page.dispatchEvent('#innerSpacing', 'input');
    await page.fill('#outerSpacing', '88');
    await page.dispatchEvent('#outerSpacing', 'input');

    page.on('dialog', (d) => d.accept());
    await page.click('#resetDefaultBtn');
    await page.waitForTimeout(50);

    const state = await page.evaluate(() => ({
      rawImagesLen: rawImages.length,
      layoutType,
      outerColorVal,
      canvasColorVal,
      selectedIndices,
      masks: photoMasks.map((m) => ({ mode: m.mode, borderColor: m.borderColor, gridSpan: m.gridSpan })),
      transforms: transforms.map((t) => ({ panX: t.panX, scale: t.scale })),
      zOrder,
      multiSelectMode,
    }));

    expect(state.rawImagesLen).toBe(2); // photos themselves are untouched
    expect(state.layoutType).toBe('grid'); // the documented default for 2 photos
    expect(state.outerColorVal).toBe('#1c1c1e'); // the app's declared default
    expect(state.canvasColorVal).toMatch(/^#[0-9a-f]{6}$/); // auto-picked from the photos, same as a fresh load
    expect(state.selectedIndices).toEqual([]);
    expect(state.masks).toEqual([
      { mode: 'none', borderColor: '#ffffff', gridSpan: 1 },
      { mode: 'none', borderColor: '#ffffff', gridSpan: 1 },
    ]);
    state.transforms.forEach((t) => {
      expect(t.panX).toBe(0);
      expect(t.scale).toBe(1);
    });
    expect(state.zOrder).toEqual([0, 1]);
    expect(state.multiSelectMode).toBe(false);
    expect(await page.inputValue('#innerSpacing')).toBe('16');
    expect(await page.inputValue('#outerSpacing')).toBe('24');
  });

  test('canceling the confirmation leaves everything untouched', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [{ type: 'solid', width: 200, height: 200, color: '#dd2222' }]);
    await page.evaluate(() => { applyColorToTarget('outer', '#00ff00'); });

    page.on('dialog', (d) => d.dismiss());
    await page.click('#resetDefaultBtn');

    expect(await page.evaluate(() => outerColorVal)).toBe('#00ff00');
  });
});
