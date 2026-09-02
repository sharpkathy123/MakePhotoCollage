const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, samplePixel, setColorInput, clickOption } = require('./helpers');

test.describe('Spacing & colors', () => {
  test('outer spacing slider changes the outer border thickness in the render', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);

    await page.fill('#outerSpacing', '0');
    await page.dispatchEvent('#outerSpacing', 'input');
    await page.dispatchEvent('#outerSpacing', 'change');
    await page.waitForTimeout(100);
    const canvasAt0 = await page.evaluate(() => ({ w: document.getElementById('collageCanvas').width, h: document.getElementById('collageCanvas').height }));

    await page.fill('#outerSpacing', '60');
    await page.dispatchEvent('#outerSpacing', 'input');
    await page.dispatchEvent('#outerSpacing', 'change');
    await page.waitForTimeout(100);
    const canvasAt60 = await page.evaluate(() => ({ w: document.getElementById('collageCanvas').width, h: document.getElementById('collageCanvas').height }));

    // Outer border adds `b` on both sides of both dimensions: +120 width, +120 height going from 0 to 60.
    expect(canvasAt60.w - canvasAt0.w).toBe(120);
    expect(canvasAt60.h - canvasAt0.h).toBe(120);
  });

  test('inner spacing slider changes the gap between photos', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare, FIXTURES.yellowSquare]);
    await clickOption(page, '#layoutTypeGroup', 'horizontal');
    await page.waitForTimeout(100);

    await page.fill('#innerSpacing', '10');
    await page.dispatchEvent('#innerSpacing', 'input');
    await page.waitForTimeout(100);
    const gapAt10 = await page.evaluate(() => cellBounds[1].x - (cellBounds[0].x + cellBounds[0].w));

    await page.fill('#innerSpacing', '50');
    await page.dispatchEvent('#innerSpacing', 'input');
    await page.waitForTimeout(100);
    const gapAt50 = await page.evaluate(() => cellBounds[1].x - (cellBounds[0].x + cellBounds[0].w));

    expect(gapAt10).toBe(10);
    expect(gapAt50).toBe(50);
  });

  test('the Outer Border color picker fills the outer background area', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);

    await setColorInput(page, '#outerColor', '#00ffff');
    await page.waitForTimeout(100);

    const outerPixel = await samplePixel(page, 2, 2);
    expect(outerPixel).toEqual([0, 255, 255, 255]);
  });

  test('the Outer Border "None" button leaves that area unpainted', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);
    // Canvas Background auto-picks an opaque color on load and would
    // otherwise show through here -- turn it off so this test isolates
    // Outer Border's own "None" button.
    await page.evaluate(() => { canvasColorVal = 'none'; });

    await page.click('.none-btn[data-target="outer"]');
    await page.waitForTimeout(100);

    const outerPixel = await samplePixel(page, 2, 2);
    expect(outerPixel[3]).toBe(0); // fully transparent alpha
  });

  test('Canvas Background defaults to an auto-picked Sampled Palette color, so a freshly loaded collage already looks finished', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);

    const pickedColor = await page.evaluate(() => canvasColorVal);
    expect(pickedColor).not.toBe('none');
    expect(pickedColor).toMatch(/^#[0-9a-f]{6}$/i);

    // Turn off Outer Border too, so nothing else could paint this pixel --
    // isolates whether Canvas Background itself is actually painted.
    await page.click('.none-btn[data-target="outer"]');
    await page.waitForTimeout(100);

    const outerPixel = await samplePixel(page, 2, 2);
    expect(outerPixel[3]).toBe(255); // opaque, not transparent
  });

  test('appending more photos to an existing collage leaves the already-picked Canvas Background alone', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);
    const firstPick = await page.evaluate(() => canvasColorVal);

    await loadPhotos(page, [FIXTURES.bluePortrait]); // file input always appends to an existing collage
    await page.waitForTimeout(100);

    expect(await page.evaluate(() => canvasColorVal)).toBe(firstPick);
  });

  // Regression test: Outer Frame Background fills the WHOLE canvas (0,0 to
  // width,height), not just the border strip -- it only looks confined to
  // the margin because the photos themselves (and, within their own cells,
  // each photo's own border) are drawn on top of it afterward. So Canvas
  // Background is the one control that's actually guaranteed visible
  // everywhere, including in the outer margin and the inner gap, once
  // Outer Border and every photo's own border are set to None.
  test('Canvas Background shows through in both the outer margin and the inner gap once Outer Border and each photo\'s own border are set to None', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);
    await page.click('button:text("Deselect All")'); // avoid the selection outline overlapping the inner-gap sample below

    await page.click('.none-btn[data-target="outer"]');
    await page.evaluate(() => { photoMasks[0].borderColor = 'none'; requestRender(); });

    await setColorInput(page, '#canvasColor', '#ff8800');
    await page.waitForTimeout(100);

    const outerPixel = await samplePixel(page, 2, 2);
    expect(outerPixel).toEqual([255, 136, 0, 255]);

    const innerGapPixel = await page.evaluate(() => {
      const b = cellBounds[0];
      return { x: Math.max(0, b.x - 5), y: b.y + Math.floor(b.h / 2) };
    });
    const innerPixel = await samplePixel(page, innerGapPixel.x, innerGapPixel.y);
    expect(innerPixel).toEqual([255, 136, 0, 255]);

    // Switching back to None returns it to transparent.
    await page.click('.none-btn[data-target="canvas"]');
    await page.waitForTimeout(100);
    const clearedPixel = await samplePixel(page, 2, 2);
    expect(clearedPixel[3]).toBe(0);
  });
});
