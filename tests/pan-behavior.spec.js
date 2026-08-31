const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, cellCenter, appPointToViewport, clickOption, samplePixel } = require('./helpers');

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
      transforms[0] = { scale: 1.5, rot: 0, x: 0, y: 0, panX: 40, panY: -25, frameScale: 1 };
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
      transforms[0] = { scale: 1.5, rot: 0, x: 0, y: 0, panX: 0, panY: 0, frameScale: 1 };
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

  // The frame's rotation, position, and how content renders inside it are
  // now identical in both modes -- Fixed vs. Attached is purely about what
  // a subsequent drag updates, never about how a given transform renders.
  // Switching modes with rotation (and pan, and scale) already set must
  // not change a single pixel.
  test('switching modes with rotation, pan, and scale all set renders pixel-identically -- the frame no longer differs between modes', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].mode = 'circle'; });

    const { diffCount, totalPixels } = await page.evaluate(() => {
      photoMasks[0].behavior = 'fixed';
      transforms[0] = { scale: 1.2, rot: 30, x: 0, y: 0, panX: 30, panY: -15, frameScale: 1 };
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
      return { diffCount, totalPixels: before.length / 4 };
    });

    expect(totalPixels).toBeGreaterThan(0);
    expect(diffCount).toBe(0);
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

  // Regression test: the Scale slider (and pinch, which routes through the
  // same setGestureScale helper) must write to the field the CURRENT mode
  // actually renders -- scale for Fixed, frameScale for Attached -- leaving
  // the other field untouched, exactly like drag already does for x/y vs.
  // panX/panY.
  test('the Scale slider updates scale in Fixed mode and frameScale in Attached mode, leaving the other field untouched', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].behavior = 'fixed'; });

    await page.fill('#modScale', '1.6');
    await page.dispatchEvent('#modScale', 'input');
    await page.waitForTimeout(50);
    let t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t.scale).toBe(1.6);
    expect(t.frameScale).toBe(1);

    await clickOption(page, '#maskBehaviorGroup', 'attached');
    await page.fill('#modScale', '2.2');
    await page.dispatchEvent('#modScale', 'input');
    await page.waitForTimeout(50);
    t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t.frameScale).toBe(2.2);
    expect(t.scale).toBe(1.6); // untouched, preserved from the earlier Fixed-mode use
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

  // Regression test: switching Mask Pan Behavior used to visibly snap the
  // frame's rotation -- Fixed mode's frame couldn't rotate at all, so
  // going from a rotated Attached photo to Fixed made the frame jump to
  // unrotated while the selection outline (which traces the actual frame)
  // suddenly no longer matched the still-rotated-looking content. Fixed
  // and Attached now render identically in every respect; switching
  // between them must never change a transform value or a single pixel.
  test('switching Mask Pan Behavior does not change rotation (or any transform) or the rendered image, in either direction', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.click('button:text("Select All")');

    await clickOption(page, '#maskBehaviorGroup', 'attached');
    await page.fill('#modRotate', '35');
    await page.dispatchEvent('#modRotate', 'input');
    const beforeTransforms = await page.evaluate(() => transforms.map((t) => ({ ...t })));
    // Stash the "before" pixels in a page-side global and diff entirely
    // inside the page later -- transferring the full ~1.8M-element pixel
    // array across the CDP boundary (even once, let alone twice) is slow
    // enough to blow the test timeout.
    await page.evaluate(() => {
      const c = document.getElementById('collageCanvas');
      window.__beforePixels = new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    });

    await clickOption(page, '#maskBehaviorGroup', 'fixed');
    const afterTransforms = await page.evaluate(() => transforms.map((t) => ({ ...t })));
    const { diffCount, totalPixels } = await page.evaluate(() => {
      const c = document.getElementById('collageCanvas');
      const after = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const before = window.__beforePixels;
      let diffCount = 0;
      for (let i = 0; i < before.length; i += 4) {
        if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) diffCount++;
      }
      return { diffCount, totalPixels: before.length / 4 };
    });

    expect(afterTransforms).toEqual(beforeTransforms);
    expect(await page.evaluate(() => transforms.map((t) => t.rot))).toEqual([35, 35]);
    await expect(page.locator('#rotVal')).toHaveText('35°');
    expect(totalPixels).toBeGreaterThan(0);
    expect(diffCount).toBe(0);
  });

  // Regression test: pinching (or dragging the Scale slider) only ever grew
  // the photo content behind a fixed-size frame -- correct for Fixed mode,
  // but in Attached mode the mask is supposed to be part of "the photo" and
  // grow with it, the same way it already moves with it on drag. That's
  // tracked as a separate field, frameScale, so switching modes never snaps
  // the frame (see defaultTransform's comment) -- only a subsequent pinch
  // or Scale-slider drag decides which field it updates. A point just past
  // the photo's own nominal cell edge should stay background at
  // frameScale 1, then show photo content once frameScale grows the frame
  // out to cover it.
  test('scaling an Attached-mode photo grows the frame/mask itself, not just the content behind it', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].mode = 'square'; photoMasks[0].behavior = 'attached'; });

    const point = await page.evaluate(() => ({
      x: Math.round(cellBounds[0].x + cellBounds[0].w + 5),
      y: Math.round(cellBounds[0].y + cellBounds[0].h / 2),
    }));

    await page.evaluate(() => { transforms[0].frameScale = 1; renderCollage(false); });
    const bgColor = await samplePixel(page, point.x, point.y);

    await page.evaluate(() => { transforms[0].frameScale = 1.5; renderCollage(false); });
    const grownColor = await samplePixel(page, point.x, point.y);

    expect(grownColor).not.toEqual(bgColor);
  });

  // Companion regression test: the same growth must NOT happen in Fixed
  // mode, where the frame is a stationary window and only the content
  // behind it should zoom.
  test('scaling a Fixed-mode photo does not grow the frame -- only the content behind it', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.evaluate(() => { photoMasks[0].mode = 'square'; photoMasks[0].behavior = 'fixed'; });

    const point = await page.evaluate(() => ({
      x: Math.round(cellBounds[0].x + cellBounds[0].w + 5),
      y: Math.round(cellBounds[0].y + cellBounds[0].h / 2),
    }));

    await page.evaluate(() => { transforms[0].scale = 1; renderCollage(false); });
    const bgColor = await samplePixel(page, point.x, point.y);

    await page.evaluate(() => { transforms[0].scale = 1.5; renderCollage(false); });
    const stillBgColor = await samplePixel(page, point.x, point.y);

    expect(stillBgColor).toEqual(bgColor);
  });

  // Regression test: hit-testing must grow along with the frame in Attached
  // mode, or a pinch/scale-grown photo becomes untappable at its own new,
  // visibly larger edge -- the same class of bug already fixed for dragging
  // a photo out of its nominal slot.
  test('a scaled-up Attached-mode photo can still be tapped/selected at its new, larger edge', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await page.evaluate(() => {
      photoMasks[0].behavior = 'attached';
      transforms[0].frameScale = 1.8;
      requestRender();
    });
    await page.waitForTimeout(100);

    // Select the other photo first, so tapping photo 0 actually proves the
    // hit-test found it rather than it already being selected.
    await page.evaluate(() => { selectedIndices = [1]; syncSliderControls(); });

    const point = await page.evaluate(() => ({
      // Just past photo 0's own nominal right edge -- still inside the gap
      // before photo 1's cell starts, so this can only be a hit on photo 0's
      // grown frame, never an accidental hit on photo 1.
      x: Math.round(cellBounds[0].x + cellBounds[0].w + 5),
      y: Math.round(cellBounds[0].y + cellBounds[0].h / 2),
    }));
    const viewportPoint = await appPointToViewport(page, point.x, point.y);
    await page.mouse.click(viewportPoint.x, viewportPoint.y);

    expect(await page.evaluate(() => selectedIndices.slice())).toEqual([0]);
  });
});
