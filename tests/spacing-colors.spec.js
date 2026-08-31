const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, samplePixel, setColorInput } = require('./helpers');

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
    await page.selectOption('#layoutType', 'horizontal');
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

  test('inner and outer color pickers fill the corresponding background areas', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);
    await page.click('button:text("Deselect All")'); // avoid the selection outline overlapping the inner-gap sample below

    // Inner Gap is the active color target by default; Outer Border must be
    // explicitly selected first, or its color input is ignored (this
    // mirrors the real UI: the color swatch buttons choose which target the
    // picker currently controls).
    await setColorInput(page, '#innerColor', '#ff00ff');
    await page.click('#targetOuterBtn');
    await setColorInput(page, '#outerColor', '#00ffff');
    await page.waitForTimeout(100);

    // Outer border pixel (near canvas edge) should be the outer color; the
    // inner gap area right at the border/photo boundary should be the inner
    // color. Sample points chosen from actual geometry, not hardcoded pixels.
    const outerPixel = await samplePixel(page, 2, 2);
    expect(outerPixel).toEqual([0, 255, 255, 255]);

    const innerGapPixel = await page.evaluate(() => {
      const b = cellBounds[0];
      return { x: Math.max(0, b.x - 5), y: b.y + Math.floor(b.h / 2) };
    });
    const inner = await samplePixel(page, innerGapPixel.x, innerGapPixel.y);
    expect(inner).toEqual([255, 0, 255, 255]);
  });

  test('"None" (transparent) color option leaves that area unpainted', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);

    // Target = Outer Border (already active target by default is Inner; switch).
    await page.click('#targetOuterBtn');
    await page.click('.swatch-none');
    await page.waitForTimeout(100);

    const outerPixel = await samplePixel(page, 2, 2);
    expect(outerPixel[3]).toBe(0); // fully transparent alpha
  });

  test('Canvas Background defaults to transparent, so existing collages are unaffected', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);
    // Turn off Inner and Outer too, so nothing else could paint this pixel --
    // isolates whether Canvas Background itself defaults to opaque or none.
    await page.click('.swatch-none'); // Inner Gap is the active target by default
    await page.click('#targetOuterBtn');
    await page.click('.swatch-none');
    await page.waitForTimeout(100);

    const outerPixel = await samplePixel(page, 2, 2);
    expect(outerPixel[3]).toBe(0);
  });

  // Regression test: Outer Frame Background fills the WHOLE canvas (0,0 to
  // width,height), not just the border strip -- it only looks confined to
  // the margin because Inner Area Background and the photos themselves are
  // drawn on top of it afterward. So Canvas Background is the one control
  // that's actually guaranteed visible everywhere, including in the outer
  // margin and the inner gap, whenever Outer Border and Inner Gap are both
  // set to None (e.g. someone wants a single flat backdrop instead of two
  // separate border/gap colors).
  test('Canvas Background shows through in both the outer margin and the inner gap once Inner and Outer are set to None', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.greenSquare]);
    await page.click('button:text("Deselect All")'); // avoid the selection outline overlapping the inner-gap sample below

    await page.click('.swatch-none'); // Inner Gap is the active target by default
    await page.click('#targetOuterBtn');
    await page.click('.swatch-none');

    await page.click('#targetCanvasBtn');
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
    await page.click('.swatch-none');
    await page.waitForTimeout(100);
    const clearedPixel = await samplePixel(page, 2, 2);
    expect(clearedPixel[3]).toBe(0);
  });
});
