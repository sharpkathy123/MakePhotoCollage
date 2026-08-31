const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Save / export', () => {
  // Regression test: the selection outline is an on-screen editing aid, but
  // Save/Share used to capture the very same canvas it was drawn on, so it
  // leaked into the exported PNG.
  test('exported render (showEditingOverlays=false) excludes the selection outline present in the normal editing view', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    // Photo 0 is selected by default after loading; sample the middle of
    // its top edge, where the outline stroke is centered.
    const edgePoint = await page.evaluate(() => ({ x: cellBounds[0].x + Math.floor(cellBounds[0].w / 2), y: cellBounds[0].y }));

    const editingPixel = await page.evaluate(({ x, y }) => {
      renderCollage(true);
      return Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
    }, edgePoint);
    expect(editingPixel).toEqual([0, 122, 255, 255]); // solid #007aff outline stroke

    const exportPixel = await page.evaluate(({ x, y }) => {
      renderCollage(false);
      const p = Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
      renderCollage(true); // restore the normal editing view afterward
      return p;
    }, edgePoint);
    // Same spot, clean render: background (white, per default inner color), no outline.
    expect(exportPixel).toEqual([255, 255, 255, 255]);
  });

  test('clicking Save renders a clean frame (no overlays) and restores the editing view afterward', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    // Intercept the real Save flow's own toBlob() call without letting the
    // download/share side effects actually run, and check the canvas
    // content it captured at that moment.
    const edgePoint = await page.evaluate(() => ({ x: cellBounds[0].x + Math.floor(cellBounds[0].w / 2), y: cellBounds[0].y }));

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
    }, edgePoint);

    expect(capturedDuringSave).toEqual([255, 255, 255, 255]); // no outline captured

    // On-screen canvas should show the outline again after Save finishes
    // (photo 0 is still selected).
    await page.waitForTimeout(100);
    const afterSavePixel = await page.evaluate(({ x, y }) => {
      return Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
    }, edgePoint);
    expect(afterSavePixel).toEqual([0, 122, 255, 255]);
  });

  test('the selection outline shows for a selected photo even when not actively dragging', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    const edgePoint = await page.evaluate(() => ({ x: cellBounds[0].x + Math.floor(cellBounds[0].w / 2), y: cellBounds[0].y }));

    const selectedPixel = await page.evaluate(({ x, y }) => {
      renderCollage(true);
      return Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
    }, edgePoint);
    expect(selectedPixel).toEqual([0, 122, 255, 255]);

    await page.click('button:text("Deselect All")');
    const deselectedPixel = await page.evaluate(({ x, y }) => {
      renderCollage(true);
      return Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
    }, edgePoint);
    expect(deselectedPixel).toEqual([255, 255, 255, 255]);
  });
});
