const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos, cellCenter, appPointToViewport, clickOption, samplePixel, getActiveOptionValue, pinchGesture } = require('./helpers');

test.describe('Mask Pan Behavior (Fixed vs Attached)', () => {
  // A freshly loaded photo defaults to Attached ("Moving Frame") behavior --
  // the most common first thing a person does is drag a photo around, and
  // that should move the frame and photo together, not leave the frame
  // stationary while the photo pans invisibly behind it.
  test('a freshly loaded photo defaults to Attached (Moving Frame) behavior', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    expect(await page.evaluate(() => photoMasks[0].behavior)).toBe('attached');

    // Nothing is selected by default, so the button group itself shows no
    // highlight yet -- selecting the photo should reveal the real default.
    await page.click('button:text("Select All")');
    expect(await getActiveOptionValue(page, '#maskBehaviorGroup')).toBe('attached');
  });

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

  // Regression test: a pinch zoom must write to the field the CURRENT mode
  // actually renders -- scale for Fixed, frameScale for Attached -- leaving
  // the other field untouched, exactly like drag already does for x/y vs.
  // panX/panY.
  test('a pinch zoom updates scale in Fixed mode and frameScale in Attached mode, leaving the other field untouched', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")'); // nothing is selected by default
    await page.evaluate(() => { photoMasks[0].behavior = 'fixed'; });

    const center = await cellCenter(page, 0);
    await pinchGesture(page, center, { startDist: 100, endDist: 160 });
    await page.waitForTimeout(50);
    let t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t.scale).toBeCloseTo(1.6, 2);
    expect(t.frameScale).toBe(1);

    await clickOption(page, '#maskBehaviorGroup', 'attached');
    await pinchGesture(page, center, { startDist: 100, endDist: 220 });
    await page.waitForTimeout(50);
    t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t.frameScale).toBeCloseTo(2.2, 2);
    expect(t.scale).toBeCloseTo(1.6, 2); // untouched, preserved from the earlier Fixed-mode use
  });

  // Regression test: rotation used to always write to `rot` regardless of
  // mode, which -- because `rot` also rotates the frame/mask (see
  // renderCollage) -- meant rotating a Fixed-mode ("Fixed Window") photo
  // visibly rotated the window itself too, indistinguishable from Attached.
  // Fixed mode is supposed to be a stationary window with the photo free to
  // move behind it, so it needs its own content-only rotation field
  // (panRot), exactly like scale/frameScale above.
  test('a pinch twist updates panRot in Fixed mode and rot in Attached mode, leaving the other field untouched', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")'); // nothing is selected by default
    await page.click('#rotationLockBtn'); // unlock -- locked by default
    await page.evaluate(() => { photoMasks[0].behavior = 'fixed'; });

    const center = await cellCenter(page, 0);
    await pinchGesture(page, center, { startDist: 100, endDist: 100, startAngle: 0, endAngle: 20 });
    await page.waitForTimeout(50);
    let t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t.panRot).toBeCloseTo(20, 1);
    expect(t.rot).toBe(0);

    await clickOption(page, '#maskBehaviorGroup', 'attached');
    await pinchGesture(page, center, { startDist: 100, endDist: 100, startAngle: 0, endAngle: 65 });
    await page.waitForTimeout(50);
    t = await page.evaluate(() => ({ ...transforms[0] }));
    expect(t.rot).toBeCloseTo(65, 1);
    expect(t.panRot).toBeCloseTo(20, 1); // untouched, preserved from the earlier Fixed-mode use
  });

  // Regression test (the actual bug report): in Fixed mode, rotating must
  // spin only the photo content -- the frame/mask itself must never turn.
  // Verified two ways at once: sampling points near the clip rectangle's
  // corners, which a rotated wide image uncovers (proving content actually
  // rotated) while points just outside the (still axis-aligned) rectangle
  // stay background throughout (proving the frame itself never rotated,
  // grew, or moved).
  test('in Fixed mode, a pinch twist spins the photo content but leaves the frame/mask stationary', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await clickOption(page, '#layoutTypeGroup', 'horizontal');
    // layoutType flips synchronously on click, but the actual re-render
    // (and cellBounds with it) is requestAnimationFrame-deferred -- wait
    // for cellBounds to actually reflect the new layout (redLandscape's
    // 5:3 aspect no longer squared off to the old grid's 600x600) instead
    // of racing ahead of it.
    await page.waitForFunction(() => layoutType === 'horizontal' && cellBounds[0] && cellBounds[0].w !== 600);
    await page.click('#rotationLockBtn'); // unlock -- locked by default
    await page.evaluate(() => { photoMasks[0].behavior = 'fixed'; });

    const points = await page.evaluate(() => {
      const b = cellBounds[0];
      return {
        topLeftCorner: [Math.round(b.x + 5), Math.round(b.y + 5)],
        topRightCorner: [Math.round(b.x + b.w - 5), Math.round(b.y + 5)],
        bottomLeftCorner: [Math.round(b.x + 5), Math.round(b.y + b.h - 5)],
        outsideLeft: [Math.max(0, b.x - 5), Math.round(b.y + b.h / 2)],
        outsideTop: [Math.round(b.x + b.w / 2), Math.max(0, b.y - 5)],
      };
    });

    // Deselect first -- these sample points sit right along the frame's own
    // boundary, which the selection outline strokes directly over, so
    // leaving the photo selected would tint them with outline color instead
    // of the true rendered content/background underneath.
    await page.click('button:text("Deselect All")');
    await page.waitForTimeout(100);
    // The three inner-corner points start fully covered by the unrotated
    // photo; the two outside points are outside the frame and start (and
    // must always stay) background.
    for (const key of ['topLeftCorner', 'topRightCorner', 'bottomLeftCorner']) {
      expect(await samplePixel(page, ...points[key])).toEqual([220, 60, 60, 255]);
    }
    for (const key of ['outsideLeft', 'outsideTop']) {
      expect(await samplePixel(page, ...points[key])).toEqual([255, 255, 255, 255]);
    }

    // Re-select so the pinch twist (which only applies to whatever's
    // currently selected) has a photo to act on, then deselect again before
    // sampling for the same reason as above.
    await page.click('button:text("Select All")');
    const center = await cellCenter(page, 0);
    await pinchGesture(page, center, { startDist: 100, endDist: 100, startAngle: 0, endAngle: 30 });
    await page.click('button:text("Deselect All")');
    await page.waitForTimeout(50);

    // The corners are no longer covered -- content actually rotated away
    // from them, uncovering the white Inner Gap background underneath.
    expect(await samplePixel(page, ...points.topLeftCorner)).toEqual([255, 255, 255, 255]);
    expect(await samplePixel(page, ...points.topRightCorner)).toEqual([255, 255, 255, 255]);
    expect(await samplePixel(page, ...points.bottomLeftCorner)).toEqual([255, 255, 255, 255]);
    // Just outside the (still axis-aligned) frame: never covered, whether
    // rotated or not -- proves the frame itself stayed put.
    expect(await samplePixel(page, ...points.outsideLeft)).toEqual([255, 255, 255, 255]);
    expect(await samplePixel(page, ...points.outsideTop)).toEqual([255, 255, 255, 255]);
    // The frame/mask's own rotation field never moved.
    expect(await page.evaluate(() => transforms[0].rot)).toBe(0);
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
    await page.click('#rotationLockBtn'); // unlock -- locked by default

    await clickOption(page, '#maskBehaviorGroup', 'attached');
    const center = await cellCenter(page, 0);
    await pinchGesture(page, center, { startDist: 100, endDist: 100, startAngle: 0, endAngle: 35 });
    // The gesture's own requestRender() is rAF-deferred -- give it a real
    // paint before reading pixels below, or "before" can race the render
    // and capture a stale (pre-twist) frame.
    await page.waitForTimeout(100);
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
    const rots = await page.evaluate(() => transforms.map((t) => t.rot));
    rots.forEach((r) => expect(r).toBeCloseTo(35, 1));
    expect(totalPixels).toBeGreaterThan(0);
    expect(diffCount).toBe(0);
  });

  // Regression test: a pinch zoom only ever grew the photo content behind a
  // fixed-size frame -- correct for Fixed mode, but in Attached mode the
  // mask is supposed to be part of "the photo" and grow with it, the same
  // way it already moves with it on drag. That's tracked as a separate
  // field, frameScale, so switching modes never snaps the frame (see
  // defaultTransform's comment) -- only a subsequent pinch decides which
  // field it updates. A point just past the photo's own nominal cell edge
  // should stay background at frameScale 1, then show photo content once
  // frameScale grows the frame out to cover it.
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

  // Regression test: hit-testing used to check taps against an
  // axis-aligned box built from cellBounds/frameScale only, never
  // accounting for t.rot -- even though renderCollage does rotate the
  // frame/mask itself. For a rotated square frame (a diamond on screen),
  // that left real gaps between what's visibly tappable and what the code
  // thought was tappable, in both directions.
  test('hit-testing accounts for the frame\'s own rotation, not just its position and scale', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    // Extra outer spacing so the rotated diamond's vertices (which reach
    // out to roughly 300*sqrt(2) =~ 424px from center, well past the
    // unrotated square's own 300px half-width) still land inside the
    // canvas -- otherwise the cardinal-direction tap point below would
    // fall outside the canvas entirely with the default 24px margin.
    await page.fill('#outerSpacing', '120');
    await page.dispatchEvent('#outerSpacing', 'input');
    await page.evaluate(() => {
      photoMasks[0].mode = 'square'; // cover-mode: mask exactly matches the 600x600 cell
      photoMasks[0].behavior = 'attached'; // rotating writes to t.rot, the frame's own rotation
      transforms[0].rot = 45;
      requestRender();
    });
    await page.waitForTimeout(100);

    async function tapAndGetSelection(offsetX, offsetY) {
      await page.evaluate(() => { selectedIndices = []; syncSliderControls(); });
      const point = await page.evaluate(({ offsetX, offsetY }) => {
        const b = cellBounds[0];
        return { x: b.x + b.w / 2 + offsetX, y: b.y + b.h / 2 + offsetY };
      }, { offsetX, offsetY });
      const viewportPoint = await appPointToViewport(page, point.x, point.y);
      await page.mouse.click(viewportPoint.x, viewportPoint.y);
      return page.evaluate(() => selectedIndices.slice());
    }

    // (295, 295): inside the OLD unrotated 600x600 box (near its corner),
    // but the frame is now a diamond -- its edge, not a corner, faces this
    // direction, so the rotated shape doesn't actually reach this point.
    expect(await tapAndGetSelection(295, 295)).toEqual([]);

    // (350, 0): outside the OLD unrotated box entirely (300px half-width),
    // but a vertex of the rotated diamond now points along this cardinal
    // direction and reaches out to roughly 300*sqrt(2) =~ 424px -- so this
    // point is genuinely covered by the visible, rotated frame.
    expect(await tapAndGetSelection(350, 0)).toEqual([0]);
  });
});
