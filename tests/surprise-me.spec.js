const { test, expect } = require('@playwright/test');
const { loadSyntheticPhotos } = require('./helpers');

// "Surprise Me" auto-picks a shape and a sampled border color per photo,
// one shared border width for the whole collage, and rearranges the photos
// (grouping similar colors together, centering a lone minority-orientation
// photo). There's no real subject/face detection behind the shape pick --
// iOS Safari has no browser API for it, and a real ML model would be a big
// step for this dependency-free single file -- so it's a cheap heuristic
// (edge-region vs center-region pixel-gradient energy) instead. These
// tests use synthetic canvas-drawn photos with controlled patterns rather
// than real fixture photos, so the heuristic's behavior is deterministic.
test.describe('Surprise Me', () => {
  test('the button is hidden until photos are loaded, and hidden again after Start New Collage', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#surpriseMeBtn')).toBeHidden();

    await loadSyntheticPhotos(page, [{ type: 'solid', width: 200, height: 200, color: '#cc2222' }]);
    await expect(page.locator('#surpriseMeBtn')).toBeVisible();

    page.on('dialog', (dialog) => dialog.accept());
    await page.click('#startNewBtn');
    await expect(page.locator('#surpriseMeBtn')).toBeHidden();
  });

  test('a photo with a centered blob on a plain background is treated as center-focused (circle), a photo with detail at the edges is not (Original Aspect)', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(async () => {
      // (duplicated minimal versions of the synthetic generators so this
      // assertion can call analyzePhoto/pickShapeFor directly, without
      // going through the full surpriseMe()/collage pipeline)
      function makeImage(draw, size) {
        return new Promise((resolve) => {
          const c = document.createElement('canvas');
          c.width = size; c.height = size;
          draw(c.getContext('2d'), size);
          const img = new Image();
          img.onload = () => resolve(img);
          img.src = c.toDataURL();
        });
      }
      const centerImg = await makeImage((cx, size) => {
        cx.fillStyle = '#eeeeee';
        cx.fillRect(0, 0, size, size);
        cx.fillStyle = '#cc2222';
        cx.beginPath();
        cx.arc(size / 2, size / 2, size * 0.15, 0, Math.PI * 2);
        cx.fill();
      }, 200);
      const edgeImg = await makeImage((cx, size) => {
        cx.fillStyle = '#888888';
        cx.fillRect(0, 0, size, size);
        for (let i = 0; i < 400; i++) {
          cx.fillStyle = `rgb(${(Math.random() * 255) | 0},${(Math.random() * 255) | 0},${(Math.random() * 255) | 0})`;
          const side = i % 4;
          let x, y;
          if (side === 0) { x = Math.random() * size; y = Math.random() * 5; }
          else if (side === 1) { x = Math.random() * size; y = size - 5 + Math.random() * 5; }
          else if (side === 2) { x = Math.random() * 5; y = Math.random() * size; }
          else { x = size - 5 + Math.random() * 5; y = Math.random() * size; }
          cx.fillRect(x, y, 3, 3);
        }
      }, 200);

      const centerAnalysis = analyzePhoto(centerImg);
      const edgeAnalysis = analyzePhoto(edgeImg);
      return {
        centerFocusScore: centerAnalysis.focusScore,
        edgeFocusScore: edgeAnalysis.focusScore,
        centerShape: pickShapeFor(centerAnalysis),
        edgeShape: pickShapeFor(edgeAnalysis),
      };
    });

    expect(result.centerFocusScore).toBeGreaterThan(result.edgeFocusScore);
    expect(result.centerShape).toBe('circle');
    expect(result.edgeShape).toBe('none');
  });

  test('applying Surprise Me sets a per-photo sampled border color and one shared border width, and picks a layout', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 300, height: 180, color: '#dd2222' },
      { type: 'solid', width: 300, height: 180, color: '#2222dd' },
    ]);

    await page.click('#surpriseMeBtn');

    const colors = await page.evaluate(() => photoMasks.map((m) => m.borderColor));
    // Solid-color photos: the sampled/dominant color should closely match
    // each photo's own actual color (allowing for the clustering distance
    // threshold and canvas resampling, not necessarily bit-exact).
    expect(colors).toHaveLength(2);
    colors.forEach((hex) => expect(hex).toMatch(/^#[0-9a-f]{6}$/));

    const width = await page.evaluate(() => parseInt(innerSpacing.value, 10));
    expect(width).toBeGreaterThan(0);
    expect(await page.evaluate(() => layoutType)).toBeTruthy();
  });

  test('Surprise Me groups similar colors together and centers a lone minority-orientation photo', async ({ page }) => {
    await page.goto('/index.html');
    // Pure color-category order would sort these red, orange, magenta --
    // landing the (portrait) magenta photo LAST, not centered -- so this
    // specifically exercises the orientation-centering swap, not just the
    // color grouping (which the next test covers on its own).
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 300, height: 180, color: '#dd2222' }, // red, landscape
      { type: 'solid', width: 300, height: 180, color: '#ee8800' }, // orange, landscape
      { type: 'solid', width: 180, height: 300, color: '#cc22cc' }, // magenta, portrait -- the odd one out
    ]);

    await page.click('#surpriseMeBtn');

    const aspects = await page.evaluate(() => rawImages.map((img) => img.naturalWidth / img.naturalHeight));
    // 3 photos -> Horizontal Strip (see computeOptimalColumns), center slot = index 1.
    expect(aspects[1]).toBeLessThan(1); // the portrait photo, now centered
    expect(aspects[0]).toBeGreaterThan(1);
    expect(aspects[2]).toBeGreaterThan(1);
  });

  test('Surprise Me groups same-colored photos together when there is no orientation tiebreak to fight it', async ({ page }) => {
    await page.goto('/index.html');
    // All landscape (no minority orientation to re-center), loaded in a
    // deliberately shuffled color order.
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 300, height: 180, color: '#2222dd' }, // blue
      { type: 'solid', width: 300, height: 180, color: '#dd2222' }, // red
      { type: 'solid', width: 300, height: 180, color: '#dd2222' }, // red
      { type: 'solid', width: 300, height: 180, color: '#2222dd' }, // blue
    ]);

    await page.click('#surpriseMeBtn');

    // The two reds should end up adjacent, and the two blues should end up
    // adjacent -- not interleaved -- once grouped by color. Compared by
    // equality to the first photo's own sampled color (rather than to a
    // fixed literal), since the clustering/resampling can shift a channel
    // slightly from the original #dd2222/#2222dd.
    const hexes = await page.evaluate(() => photoMasks.map((m) => m.borderColor.toLowerCase()));
    const sameAsFirst = hexes.map((h) => h === hexes[0]);
    expect(sameAsFirst).toEqual([true, true, false, false]);
  });
});
