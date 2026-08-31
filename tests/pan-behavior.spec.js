const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, cellCenter, appPointToViewport, clickOption } = require('./helpers');

test.describe('Mask Pan Behavior (Fixed vs Attached)', () => {
  // Regression test: switching Fixed -> Attached used to reinterpret the
  // same x/y offset completely differently, jumping the crop. Position
  // (x, y) and pan (panX, panY) are now tracked separately; the rendered
  // image must be pixel-identical at the instant of switching, before any
  // further drag. The diff runs entirely inside the page (not transferring
  // ~1.8M pixel values over the wire) so this stays fast.
  test('switching from Fixed to Attached does not move/resize the rendered photo', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].mode = 'circle'; });

    const { diffCount, totalPixels } = await page.evaluate(() => {
      photoMasks[0].behavior = 'fixed';
      transforms[0] = { scale: 1.5, rot: 0, x: 0, y: 0, panX: 40, panY: -25 };
      renderCollage(false);
      const c = document.getElementById('collageCanvas');
      const before = new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);

      photoMasks[0].behavior = 'attached'; // x/y stay 0 (freshly switched); panX/panY unchanged
      renderCollage(false);
      const after = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;

      let diffCount = 0;
      for (let i = 0; i < before.length; i += 4) {
        if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) diffCount++;
      }
      return { diffCount, totalPixels: before.length / 4 };
    });

    expect(totalPixels).toBeGreaterThan(0);
    expect(diffCount).toBe(0);
  });

  test('Attached mode\'s frame size does not grow/shrink with the zoom slider (matches Fixed mode)', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].mode = 'circle'; });

    const { diffCount } = await page.evaluate(() => {
      photoMasks[0].behavior = 'fixed';
      transforms[0] = { scale: 1.5, rot: 0, x: 0, y: 0, panX: 0, panY: 0 };
      renderCollage(false);
      const c = document.getElementById('collageCanvas');
      const before = new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);

      photoMasks[0].behavior = 'attached';
      renderCollage(false);
      const after = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;

      let diffCount = 0;
      for (let i = 0; i < before.length; i += 4) {
        if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) diffCount++;
      }
      return { diffCount };
    });

    expect(diffCount).toBe(0);
  });

  test('with rotation, the underlying photo content still aligns between modes (frame orientation is allowed to differ)', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].mode = 'circle'; });

    const result = await page.evaluate(() => {
      photoMasks[0].behavior = 'fixed';
      transforms[0] = { scale: 1.2, rot: 30, x: 0, y: 0, panX: 30, panY: -15 };
      renderCollage(false);
      const c = document.getElementById('collageCanvas');
      const ctx = c.getContext('2d');
      const cx = Math.round(cellBounds[0].x + cellBounds[0].w / 2);
      const cy = Math.round(cellBounds[0].y + cellBounds[0].h / 2 - 30); // off-center, still well inside the circle
      const fixedPixel = Array.from(ctx.getImageData(cx, cy, 1, 1).data);

      photoMasks[0].behavior = 'attached';
      renderCollage(false);
      const attachedPixel = Array.from(ctx.getImageData(cx, cy, 1, 1).data);

      return { fixedPixel, attachedPixel };
    });

    expect(result.attachedPixel).toEqual(result.fixedPixel);
    expect(result.fixedPixel).toEqual([220, 60, 60, 255]); // sanity check: this is actual photo content, not background
  });

  test('dragging in Fixed mode updates panX/panY; dragging in Attached mode updates x/y and leaves pan untouched', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].mode = 'circle'; photoMasks[0].behavior = 'fixed'; });

    async function dragBy(dxPixels, dyPixels) {
      const canvasBox = await page.$eval('#collageCanvas', (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height, cw: el.width, ch: el.height };
      });
      const cell = await page.evaluate(() => ({ x: cellBounds[0].x + cellBounds[0].w / 2, y: cellBounds[0].y + cellBounds[0].h / 2 }));
      const scaleFactor = canvasBox.cw / canvasBox.width;
      const startX = canvasBox.left + (cell.x / canvasBox.cw) * canvasBox.width;
      const startY = canvasBox.top + (cell.y / canvasBox.ch) * canvasBox.height;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + dxPixels / scaleFactor, startY + dyPixels / scaleFactor, { steps: 5 });
      await page.mouse.up();
    }

    await dragBy(60, -40);
    const afterFixedDrag = await page.evaluate(() => ({ ...transforms[0] }));
    expect(afterFixedDrag.x).toBe(0);
    expect(afterFixedDrag.y).toBe(0);
    expect(afterFixedDrag.panX).toBeGreaterThan(50);
    expect(afterFixedDrag.panY).toBeLessThan(-30);

    await page.evaluate(() => { photoMasks[0].behavior = 'attached'; syncSliderControls(); });
    await dragBy(-30, 50);
    const afterAttachedDrag = await page.evaluate(() => ({ ...transforms[0] }));
    expect(afterAttachedDrag.panX).toBe(afterFixedDrag.panX); // pan preserved, untouched by the Attached-mode drag
    expect(afterAttachedDrag.panY).toBe(afterFixedDrag.panY);
    expect(afterAttachedDrag.x).toBeLessThan(-20);
    expect(afterAttachedDrag.y).toBeGreaterThan(40);
  });

  // Regression test: hit-testing used to check taps only against each
  // photo's nominal, undragged grid-slot rectangle. In Attached mode,
  // dragging moves the frame's actual rendered position away from that
  // slot (see the render code's unitCenterX/Y = centerX/Y + t.x/t.y
  // offset) -- so a photo dragged away from its slot became untappable
  // at its real, visible location; only its now-empty original slot
  // still registered a hit for it.
  test('a photo dragged in Attached mode can still be tapped/selected at its new, moved position', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.evaluate(() => { photoMasks[0].behavior = 'attached'; });

    // Move photo 0 straight up by just over half its own cell height,
    // entirely programmatically (this test is about hit-testing the
    // result, not the drag gesture itself, which is already covered
    // above). That lands its new center just above both cells (they sit
    // side by side at the same y-range in this 2-photo horizontal layout),
    // clearly outside its own nominal cell bounds and nowhere near photo
    // 1's cell either -- so there's no ambiguity about which cell a hit
    // should land in.
    await page.evaluate(() => {
      transforms[0].x = 0;
      transforms[0].y = -(Math.floor(cellBounds[0].h / 2) + 5);
      requestRender();
    });
    await page.waitForTimeout(100);

    // Select a different photo first, so photo 0 isn't already selected --
    // otherwise tapping it wouldn't prove the hit-test itself found it.
    await page.evaluate(() => { selectedIndices = [1]; syncSliderControls(); });

    const nominalCenter = await cellCenter(page, 0);
    const draggedCenter = await page.evaluate(
      ({ x, y }) => ({ x: x + transforms[0].x, y: y + transforms[0].y }),
      nominalCenter
    );
    const viewportPoint = await appPointToViewport(page, draggedCenter.x, draggedCenter.y);
    await page.mouse.click(viewportPoint.x, viewportPoint.y);

    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);
  });

  // Regression test: rotation means something different in each mode -- in
  // Attached mode it spins the frame and content together as one rigid
  // unit, in Fixed mode it spins only the content behind a frame that
  // stays put. Carrying a rotation value over from one mode to the other
  // produced a jarring result: the frame snaps to a different orientation
  // than the still-rotated content, making the selection outline (which
  // faithfully traces the actual frame) look "out of sync" with what's
  // visibly a rotated photo. Switching Mask Pan Behavior now resets
  // rotation to 0, in either direction.
  test('switching Mask Pan Behavior resets rotation, in either direction', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.click('button:text("Select All")');

    await clickOption(page, '#maskBehaviorGroup', 'attached');
    await page.fill('#modRotate', '35');
    await page.dispatchEvent('#modRotate', 'input');
    expect(await page.evaluate(() => transforms.map((t) => t.rot))).toEqual([35, 35]);

    await clickOption(page, '#maskBehaviorGroup', 'fixed');
    expect(await page.evaluate(() => transforms.map((t) => t.rot))).toEqual([0, 0]);
    await expect(page.locator('#rotVal')).toHaveText('0°');

    // And the same in reverse: Fixed -> Attached also resets it.
    await page.fill('#modRotate', '-50');
    await page.dispatchEvent('#modRotate', 'input');
    expect(await page.evaluate(() => transforms.map((t) => t.rot))).toEqual([-50, -50]);

    await clickOption(page, '#maskBehaviorGroup', 'attached');
    expect(await page.evaluate(() => transforms.map((t) => t.rot))).toEqual([0, 0]);
  });
});
