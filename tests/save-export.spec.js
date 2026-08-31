const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Save / export', () => {
  // Regression test: the numbered selection badges and the blue
  // drag-selection outline are on-screen editing aids, but Save/Share used
  // to capture the very same canvas they were drawn on, so they leaked into
  // the exported PNG.
  test('exported render (showEditingOverlays=false) excludes the number badges present in the normal editing view', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    // Offset from the badge's exact center: the number glyph is drawn
    // centered on that same point (textAlign/textBaseline: center/middle),
    // so sampling dead-center would hit white glyph pixels, not the
    // circle's own fill color, and give a false read either way.
    const badgeCenter = await page.evaluate(() => ({ x: cellBounds[0].x + 22, y: cellBounds[0].y + 22 - 9 }));

    const editingPixel = await page.evaluate(({ x, y }) => {
      renderCollage(true);
      return Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
    }, badgeCenter);
    // The badge is a solid blue/dark circle, not the white background or photo color.
    expect(editingPixel).not.toEqual([255, 255, 255, 255]);
    expect(editingPixel).not.toEqual([220, 60, 60, 255]);

    const exportPixel = await page.evaluate(({ x, y }) => {
      renderCollage(false);
      const p = Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
      renderCollage(true); // restore the normal editing view afterward
      return p;
    }, badgeCenter);
    // Same spot, clean render: background (white, per default inner color), no badge.
    expect(exportPixel).toEqual([255, 255, 255, 255]);
  });

  test('clicking Save renders a clean frame (no overlays) and restores the editing view afterward', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    // Intercept the real Save flow's own toBlob() call without letting the
    // download/share side effects actually run, and check the canvas
    // content it captured at that moment.
    // Offset from the badge's exact center: the number glyph is drawn
    // centered on that same point (textAlign/textBaseline: center/middle),
    // so sampling dead-center would hit white glyph pixels, not the
    // circle's own fill color, and give a false read either way.
    const badgeCenter = await page.evaluate(() => ({ x: cellBounds[0].x + 22, y: cellBounds[0].y + 22 - 9 }));

    const capturedDuringSave = await page.evaluate(({ x, y }) => {
      return new Promise((resolve) => {
        const c = document.getElementById('collageCanvas');
        const originalToBlob = c.toBlob.bind(c);
        c.toBlob = (cb, type) => {
          const pixel = Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
          resolve(pixel);
          originalToBlob(() => {}, type); // let the real call proceed harmlessly
        };
        document.getElementById('saveBtn').click();
      });
    }, badgeCenter);

    expect(capturedDuringSave).toEqual([255, 255, 255, 255]); // no badge captured

    // On-screen canvas should show the badge again after Save finishes.
    await page.waitForTimeout(100);
    const afterSavePixel = await page.evaluate(({ x, y }) => {
      return Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
    }, badgeCenter);
    expect(afterSavePixel).not.toEqual([255, 255, 255, 255]);
  });
});
