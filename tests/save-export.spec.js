const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

// A point just outside a square-masked frame's top edge: within reach of the
// selection outline's stroke (its ~9px width straddles the boundary, so it
// extends a few pixels outside the frame too), but never inside the photo's
// own clip region — unlike sampling exactly *on* the boundary, which lands
// inside the clip (canvas clip regions include their own edge).
function justOutsideTopEdge(bounds, extraY = 0) {
  return { x: bounds.x + Math.floor(bounds.w / 2), y: bounds.y - 3 + extraY };
}

test.describe('Save / export', () => {
  // Regression test: the selection outline is an on-screen editing aid, but
  // Save/Share used to capture the very same canvas it was drawn on, so it
  // leaked into the exported PNG.
  test('exported render (showEditingOverlays=false) excludes the selection outline present in the normal editing view', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    // Square mask uses cover-fit, so its frame exactly matches the cell
    // bounds — keeps the edge sample point simple and predictable.
    await page.evaluate(() => { photoMasks[0].mode = 'square'; requestRender(); });
    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));
    const edgePoint = justOutsideTopEdge(bounds);

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
    await page.evaluate(() => { photoMasks[0].mode = 'square'; requestRender(); });

    // Intercept the real Save flow's own toBlob() call without letting the
    // download/share side effects actually run, and check the canvas
    // content it captured at that moment.
    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));
    const edgePoint = justOutsideTopEdge(bounds);

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
    await page.evaluate(() => { photoMasks[0].mode = 'square'; requestRender(); });
    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));
    const edgePoint = justOutsideTopEdge(bounds);

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

  // Regression test: the outline previously traced the cell's fixed bounds
  // instead of the mask/frame's own current position, so it stayed behind
  // when a photo was dragged in Attached mode -- the exact same "doesn't
  // move with the photo" problem the numbered badge it replaced had.
  test('the selection outline follows the frame when dragged in Attached mode', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => {
      // Canvas Background auto-picks an opaque color on load -- turn it off
      // so the vacated original position below reads as truly untouched
      // (transparent), isolating whether the frame/outline/border actually
      // moved rather than what's painted underneath them.
      canvasColorVal = 'none';
      photoMasks[0].mode = 'square';
      photoMasks[0].behavior = 'attached';
      transforms[0].x = 150; // frame moved well away from its original cell position
      transforms[0].y = 80;
      renderCollage(true);
    });

    const bounds = await page.evaluate(() => ({ ...cellBounds[0] }));
    const originalEdgePixel = await page.evaluate(({ x, y }) => {
      return Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
    }, justOutsideTopEdge(bounds));
    // The outline AND the photo's own border moved away with the frame (see
    // renderCollage -- the border is drawn as part of the same translated
    // unit as the photo and outline), so the original cell edge is now
    // fully untouched -- not background-colored, truly transparent.
    expect(originalEdgePixel).toEqual([0, 0, 0, 0]);

    // Frame's new top edge = cell's top edge + the applied x/y offset.
    const newEdgePoint = justOutsideTopEdge({ ...bounds, x: bounds.x + 150 }, 80);
    const newEdgePixel = await page.evaluate(({ x, y }) => {
      return Array.from(document.getElementById('collageCanvas').getContext('2d').getImageData(x, y, 1, 1).data);
    }, newEdgePoint);
    expect(newEdgePixel).toEqual([0, 122, 255, 255]);
  });
});
