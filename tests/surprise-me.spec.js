const { test, expect } = require('@playwright/test');
const { loadSyntheticPhotos } = require('./helpers');

// "Surprise Me" auto-picks a shape and a sampled border color per photo,
// and rearranges the photos (grouping similar colors together, centering a
// lone minority-orientation photo) -- leaving both border-width sliders as
// the user set them. There's no real subject/face detection behind the
// shape pick --
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

  // pickShapeFor picks randomly among whichever shapes are safe for a
  // photo's content profile (see shapeCandidatesFor) -- so a center-focused
  // squarish photo can come back as any of Circle/Square/Ellipse/Rounded,
  // never a single fixed shape, but an edge-heavy photo must always stay
  // Original Aspect (its candidate set has only one member).
  test('a photo with a centered blob on a plain background is treated as center-focused (any of Circle/Square/Ellipse/Rounded), a photo with detail at the edges is not (always Original Aspect)', async ({ page }) => {
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
      // 50 draws each -- with true randomness among the center-focused
      // photo's 4 candidates, the odds of never seeing more than one
      // distinct shape are astronomically small (this isn't asserted on,
      // but it's why the loop count is what it is); edgeShapes must all
      // come back 'none' every single time, no randomness involved there.
      const centerShapes = new Set();
      const edgeShapes = new Set();
      for (let i = 0; i < 50; i++) {
        centerShapes.add(pickShapeFor(centerAnalysis));
        edgeShapes.add(pickShapeFor(edgeAnalysis));
      }
      return {
        centerFocusScore: centerAnalysis.focusScore,
        edgeFocusScore: edgeAnalysis.focusScore,
        centerCandidates: shapeCandidatesFor(centerAnalysis),
        edgeCandidates: shapeCandidatesFor(edgeAnalysis),
        centerShapesSeen: Array.from(centerShapes),
        edgeShapesSeen: Array.from(edgeShapes),
      };
    });

    expect(result.centerFocusScore).toBeGreaterThan(result.edgeFocusScore);
    expect(result.centerCandidates.sort()).toEqual(['circle', 'ellipse', 'rounded', 'square']);
    result.centerShapesSeen.forEach((shape) => expect(result.centerCandidates).toContain(shape));
    expect(result.edgeCandidates).toEqual(['none']);
    expect(result.edgeShapesSeen).toEqual(['none']);
  });

  // Regression test: Circle/Square used to require an aspect ratio between
  // 0.85 and 1.15 (essentially "already a square photo") -- but ordinary
  // camera/phone photos are almost never that shape (typical 4:3, 3:2, and
  // 16:9 shots, portrait or landscape, all fall well outside that window),
  // so Circle/Square were practically unreachable for real photos no
  // matter how center-focused the content was. A center-focused photo at
  // an ordinary photo aspect ratio (e.g. 3:4 portrait or 4:3 landscape)
  // should now include Circle/Square; a true panorama-style aspect should
  // still exclude them (too much would be cropped away).
  test('Circle/Square are reachable at ordinary photo aspect ratios (3:4, 4:3), not just near-square ones', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(() => {
      function makeImage(draw, w, h) {
        return new Promise((resolve) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          draw(c.getContext('2d'), w, h);
          const img = new Image();
          img.onload = () => resolve(img);
          img.src = c.toDataURL();
        });
      }
      const centeredBlob = (cx, w, h) => {
        cx.fillStyle = '#eeeeee';
        cx.fillRect(0, 0, w, h);
        cx.fillStyle = '#cc2222';
        cx.beginPath();
        cx.arc(w / 2, h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2);
        cx.fill();
      };
      return Promise.all([
        makeImage(centeredBlob, 300, 400), // 3:4 portrait -- a typical phone photo shape
        makeImage(centeredBlob, 400, 300), // 4:3 landscape -- also typical
        makeImage(centeredBlob, 800, 300), // panorama-ish -- should stay excluded
      ]).then(([portrait, landscape, panorama]) => ({
        portrait: shapeCandidatesFor(analyzePhoto(portrait)).sort(),
        landscape: shapeCandidatesFor(analyzePhoto(landscape)).sort(),
        panorama: shapeCandidatesFor(analyzePhoto(panorama)).sort(),
      }));
    });

    expect(result.portrait).toEqual(['circle', 'ellipse', 'rounded', 'square']);
    expect(result.landscape).toEqual(['circle', 'ellipse', 'rounded', 'square']);
    expect(result.panorama).toEqual(['ellipse', 'rounded']);
  });

  // Regression test: a scenery/landscape photo has no single centered
  // subject, so the edge-vs-center energy comparison never reads it as
  // confidently "center-focused" -- it lands in the middle, no-strong-
  // signal bucket, which used to only offer Rounded/Original Aspect. That
  // meant Ellipse (and Circle/Square) were unreachable for an entire
  // common category of real photos, not just an edge case. Ellipse is a
  // much gentler crop than Circle -- it loses far less content -- so it's
  // safe to offer even without a confident center-focus read.
  test('a scenery photo with no single centered subject still gets Ellipse as an option, not just Rounded/Original Aspect', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(async () => {
      function makeImage(draw, w, h) {
        return new Promise((resolve) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          draw(c.getContext('2d'), w, h);
          const img = new Image();
          img.onload = () => resolve(img);
          img.src = c.toDataURL();
        });
      }
      function seededRandom(seed) {
        let s = seed;
        return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      }
      // A busy landscape with texture spread evenly across the whole
      // frame and no one focal point -- detail near the edges is just as
      // present as detail in the center.
      const scenery = await makeImage((cx, w, h) => {
        const rnd = seededRandom(1);
        cx.fillStyle = '#7a8f6a';
        cx.fillRect(0, 0, w, h);
        for (let i = 0; i < 3000; i++) {
          const x = rnd() * w, y = rnd() * h, shade = 80 + rnd() * 100;
          cx.fillStyle = `rgb(${shade * 0.6},${shade},${shade * 0.5})`;
          cx.fillRect(x, y, 4, 4);
        }
      }, 400, 300);

      const analysis = analyzePhoto(scenery);
      return { focusScore: analysis.focusScore, candidates: shapeCandidatesFor(analysis).sort() };
    });

    // Confirms this really is the "no strong signal" middle bucket, not
    // the edge-heavy or confidently-center-focused ones.
    expect(result.focusScore).toBeGreaterThan(0.8);
    expect(result.focusScore).toBeLessThan(1.1);
    expect(result.candidates).toEqual(['ellipse', 'rounded']);
  });

  // Regression test: the "confidently center-focused" bar (which gates
  // Circle/Square) was calibrated against clean synthetic images and
  // turned out to sit right in the middle of where REAL macro/subject
  // photos actually score -- tested directly against real garden photos
  // (see tests/fixtures/real-*.jpg), which clustered between ~1.0 and 1.5
  // and mostly landed just under the old 1.4 bar. A typical real photo
  // with a clear central subject (flower filling most of the frame, softly
  // blurred background) should now actually reach Circle/Square, not just
  // Ellipse/Rounded.
  test('a real photo with a clear central subject reaches Circle/Square, calibrated against actual garden photos', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(async () => {
      function loadImg(url) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      }
      const img = await loadImg('/tests/fixtures/real-red-flower-topleft.jpg');
      const analysis = analyzePhoto(img);
      return { focusScore: analysis.focusScore, candidates: shapeCandidatesFor(analysis).sort() };
    });

    expect(result.focusScore).toBeGreaterThan(1.1);
    expect(result.candidates).toEqual(['circle', 'ellipse', 'rounded', 'square']);
  });

  test('across many photos, Surprise Me actually uses more than one shape (not the same shape every time)', async ({ page }) => {
    await page.goto('/index.html');
    // 9 identical center-focused squarish photos -- same content profile,
    // so any variety in the outcome can only come from real randomization
    // among that profile's candidate shapes, not from differing content.
    // 9 also lands on a perfect 3x3 grid (0 remainder), so none of them
    // get widened to close a grid gap -- keeps this test about shape
    // variety specifically, not also exercising grid spanning at the same
    // time (see the "grid spanning" tests below for that).
    await loadSyntheticPhotos(page, Array.from({ length: 9 }, () => ({
      type: 'centerFocus', size: 200, bgColor: '#eeeeee', fgColor: '#cc2222',
    })));

    await page.click('#surpriseMeBtn');
    expect(await page.evaluate(() => activeCols)).toBe(3); // guards the "0 remainder" assumption above

    const shapes = await page.evaluate(() => photoMasks.map((m) => m.mode));
    expect(new Set(shapes).size).toBeGreaterThan(1);

    // Shape usage is dealt from a shuffled bag per candidate group rather
    // than rolled independently per photo, so all 4 candidate shapes
    // (circle/square/ellipse/rounded) should come out close to evenly for
    // 9 photos sharing one candidate set -- not just "more than one".
    const counts = {};
    shapes.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    expect(Object.keys(counts).sort()).toEqual(['circle', 'ellipse', 'rounded', 'square']);
    expect(Object.values(counts).sort((a, b) => a - b)).toEqual([2, 2, 2, 3]);
  });

  test('assignShapesProportionally distributes each candidate shape proportionally, with any remainder handled per group', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(() => {
      const squareFocus = { focusScore: 2.0, aspect: 1.0 };
      const elongatedFocus = { focusScore: 2.0, aspect: 2.0 };
      const edgeHeavy = { focusScore: 0.5, aspect: 1.0 };

      const countOf = (shapes) => {
        const counts = {};
        shapes.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
        return counts;
      };

      // 9 photos sharing a 4-shape candidate set: 2/2/2/2 plus one extra
      // (9 isn't evenly divisible by 4), not left fully to chance.
      const nine = assignShapesProportionally(Array.from({ length: 9 }, () => squareFocus));
      const nineCounts = countOf(nine);

      // Two independent groups (elongated-focus only has ellipse/rounded
      // as candidates, edge-heavy is always 'none') should each be
      // distributed within their own group, not mixed with the other.
      const mixed = assignShapesProportionally([
        ...Array.from({ length: 4 }, () => edgeHeavy),
        ...Array.from({ length: 6 }, () => elongatedFocus),
      ]);
      const mixedCounts = countOf(mixed);

      // A spanned photo (gridSpan > 1, e.g. widened to close a grid gap)
      // can't use Circle/Square -- passing spanByIdx should exclude those
      // from ONLY the spanned photos' own candidates, splitting them into
      // a separate ellipse/rounded-only group rather than either breaking
      // the non-spanned photos' proportional balance or silently letting
      // a spanned photo end up with Circle/Square anyway.
      const spanByIdx = new Map([[6, 2], [7, 2]]); // photos 6 and 7 are spanned
      const eightWithTwoSpanned = assignShapesProportionally(
        Array.from({ length: 8 }, () => squareFocus), spanByIdx
      );
      const spannedShapes = [eightWithTwoSpanned[6], eightWithTwoSpanned[7]];
      const nonSpannedCounts = countOf(eightWithTwoSpanned.slice(0, 6));

      return { nineCounts, mixedCounts, spannedShapes, nonSpannedCounts };
    });

    const nineValues = Object.values(result.nineCounts).sort((a, b) => a - b);
    expect(Object.keys(result.nineCounts).sort()).toEqual(['circle', 'ellipse', 'rounded', 'square']);
    expect(nineValues).toEqual([2, 2, 2, 3]); // proportional, remainder goes to exactly one shape

    expect(result.mixedCounts.none).toBe(4); // edge-heavy group, forced shape
    expect(result.mixedCounts.ellipse).toBe(3); // elongated-focus group, split evenly
    expect(result.mixedCounts.rounded).toBe(3);

    result.spannedShapes.forEach((s) => expect(['ellipse', 'rounded']).toContain(s));
    // The 6 non-spanned photos still get the full 4-shape set, split as
    // evenly as 6/4 allows -- unaffected by the 2 spanned photos being
    // routed into their own separate group.
    expect(Object.keys(result.nonSpannedCounts).sort()).toEqual(['circle', 'ellipse', 'rounded', 'square']);
    expect(Object.values(result.nonSpannedCounts).sort((a, b) => a - b)).toEqual([1, 1, 2, 2]);
  });

  test('applying Surprise Me sets a per-photo sampled border color and picks a layout', async ({ page }) => {
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

    expect(await page.evaluate(() => layoutType)).toBeTruthy();
  });

  // Regression test: Surprise Me used to compute its own "shared" Photo
  // Border width and overwrite whatever the user had dialed in on every
  // press -- Outer Border width was already left untouched, so this made
  // the two controls behave inconsistently for no reason a user could see.
  test('Surprise Me leaves the Photo Border width slider alone, same as it already does for Outer Border', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 300, height: 180, color: '#dd2222' },
      { type: 'solid', width: 300, height: 180, color: '#2222dd' },
    ]);

    await page.fill('#innerSpacing', '77');
    await page.dispatchEvent('#innerSpacing', 'input');
    await page.fill('#outerSpacing', '88');
    await page.dispatchEvent('#outerSpacing', 'input');

    for (let i = 0; i < 5; i++) {
      await page.click('#surpriseMeBtn');
    }

    expect(await page.inputValue('#innerSpacing')).toBe('77');
    expect(await page.inputValue('#outerSpacing')).toBe('88');
  });

  // Regression test: the centering swap used to run unconditionally
  // whenever a minority orientation existed. computeCenterSlot only
  // depends on itemCount/cols -- both fixed across repeated presses on
  // the same photos -- so the orientation outlier always landed in the
  // exact same slot no matter how many times the button was pressed, even
  // though everything else (colors, shapes, spanning) kept reshuffling.
  // Now applied on most presses (see the ~60% roll in surpriseMe()), not
  // every one.
  test('Surprise Me groups similar colors together and centers a lone minority-orientation photo most (but not every) press', async ({ page }) => {
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

    // 3 photos -> Horizontal Strip (see computeOptimalColumns), center slot
    // = index 1. Several presses -- at ~60% odds of centering per press,
    // the chance of never once landing either way across 15 tries is
    // astronomically small, rather than "unlikely once".
    let sawCentered = false;
    let sawNotCentered = false;
    for (let i = 0; i < 15; i++) {
      await page.click('#surpriseMeBtn');
      const aspects = await page.evaluate(() => rawImages.map((img) => img.naturalWidth / img.naturalHeight));
      if (aspects[1] < 1) sawCentered = true; else sawNotCentered = true;
    }
    expect(sawCentered).toBe(true); // the feature still works when it triggers
    expect(sawNotCentered).toBe(true); // and it no longer triggers every single time
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
    // slightly from the original #dd2222/#2222dd. Which color group lands
    // first is randomized on every press, so either grouped arrangement is
    // valid here -- only "grouped, not interleaved" is being checked.
    const hexes = await page.evaluate(() => photoMasks.map((m) => m.borderColor.toLowerCase()));
    const sameAsFirst = hexes.map((h) => h === hexes[0]);
    expect([[true, true, false, false], [false, false, true, true]]).toContainEqual(sameAsFirst);
  });

  // Regression test: border color used to always land on the single most-
  // prevalent sampled color, and photo order was a fully deterministic
  // sort -- so pressing Surprise Me repeatedly on the same photos produced
  // the exact same result every time. Border color now randomizes among a
  // photo's top few sampled colors, and which color group (and which
  // photo within it) comes first is now reshuffled too, so repeated
  // presses actually vary.
  test('pressing Surprise Me repeatedly on the same photos produces different results, not the same arrangement every time', async ({ page }) => {
    await page.goto('/index.html');
    // Each photo has three substantial, distinctly-colored regions so its
    // own top sampled colors genuinely differ from each other (not just
    // one dominant color with a couple of stray pixels) -- giving
    // pickBorderColorAvoiding real options to randomize among.
    await page.evaluate(async () => {
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
      const stripes = (colors) => (cx, size) => {
        const bandH = size / colors.length;
        colors.forEach((color, i) => {
          cx.fillStyle = color;
          cx.fillRect(0, i * bandH, size, bandH);
        });
      };
      const images = await Promise.all([
        makeImage(stripes(['#dd2222', '#22aa22', '#2222dd']), 200),
        makeImage(stripes(['#dddd22', '#dd22dd', '#22dddd']), 200),
        makeImage(stripes(['#dd8822', '#8822dd', '#22dd88']), 200),
        makeImage(stripes(['#aa2222', '#22aa88', '#2288aa']), 200),
      ]);
      applyNewImageSet(images, {});
    });

    const snapshot = async () => page.evaluate(() => ({
      colors: photoMasks.map((m) => m.borderColor),
      order: rawImages.map((img) => img.src),
      canvasColor: canvasColorVal,
      outerColor: outerColorVal,
    }));

    // Baseline is taken AFTER the first press, not before -- comparing
    // against the pre-press state (default white borders, original load
    // order) would trivially "differ" on the very next press regardless of
    // any randomization at all, proving nothing.
    await page.click('#surpriseMeBtn');
    const first = await snapshot();
    // Several more presses, not just one -- makes a coincidental exact
    // repeat (same color pool draw AND same shuffled order every single
    // time) astronomically unlikely, rather than just "unlikely once".
    let sawDifference = false;
    for (let i = 0; i < 5; i++) {
      await page.click('#surpriseMeBtn');
      const next = await snapshot();
      if (JSON.stringify(next) !== JSON.stringify(first)) {
        sawDifference = true;
        break;
      }
    }
    expect(sawDifference).toBe(true);
  });

  // Regression test: Canvas Background and Outer Border used to be
  // untouched by Surprise Me entirely -- only per-photo borders varied.
  test('Surprise Me also randomizes Canvas Background and Outer Border, not just per-photo borders', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 300, height: 300, color: '#dd2222' },
      { type: 'solid', width: 300, height: 300, color: '#22dd22' },
      { type: 'solid', width: 300, height: 300, color: '#2222dd' },
      { type: 'solid', width: 300, height: 300, color: '#dddd22' },
    ]);

    const canvasColors = new Set();
    const outerColors = new Set();
    for (let i = 0; i < 6; i++) {
      await page.click('#surpriseMeBtn');
      canvasColors.add(await page.evaluate(() => canvasColorVal));
      outerColors.add(await page.evaluate(() => outerColorVal));
    }

    expect(canvasColors.size).toBeGreaterThan(1);
    expect(outerColors.size).toBeGreaterThan(1);
  });

  // Regression test: border color used to draw from the top 3 sampled
  // colors by PIXEL PREVALENCE -- but a real photo's single largest
  // cluster is very often a big, comparatively muted area (sky, wall,
  // skin tone), so a small but genuinely vivid accent region almost never
  // ranked in the top 3 and could never be picked. Sorting by saturation
  // first makes the vivid colors actually reachable.
  test('a small but vivid accent color is reachable, not just the large muted background behind it', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(async () => {
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
      // Four muted bands (40/25/20/10%) plus a small 5% vivid red-orange
      // one -- by raw pixel prevalence the vivid band ranks 4th (verified
      // directly: colorOptions comes back muted, muted, muted, vivid,
      // ...), so a pool limited to the top 3 BY PREVALENCE excludes it
      // entirely, no matter how many times Surprise Me is pressed.
      const img = await makeImage((cx, size) => {
        cx.fillStyle = '#8a9a8a'; cx.fillRect(0, 0, size, size * 0.40);
        cx.fillStyle = '#c4b498'; cx.fillRect(0, size * 0.40, size, size * 0.25);
        cx.fillStyle = '#8898a8'; cx.fillRect(0, size * 0.65, size, size * 0.20);
        cx.fillStyle = '#a89878'; cx.fillRect(0, size * 0.85, size, size * 0.10);
        cx.fillStyle = '#ff2200'; cx.fillRect(0, size * 0.95, size, size * 0.05);
      }, 300);
      applyNewImageSet([img], {});
    });

    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      await page.click('#surpriseMeBtn');
      seen.add(await page.evaluate(() => photoMasks[0].borderColor.toLowerCase()));
    }

    // The vivid accent should show up at least once across 20 rolls --
    // allow for clustering/resampling to shift it slightly from the exact
    // #ff2200 it was drawn with.
    const rgbDistance = (hexA, hexB) => {
      const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };
      const a = toRgb(hexA), b = toRgb(hexB);
      return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    };
    const sawVivid = Array.from(seen).some((hex) => rgbDistance(hex, '#ff2200') < 40);
    expect(sawVivid).toBe(true);
  });

  // Regression test: 3 or 5 photos used to always force Horizontal Strip
  // layout, even if the user had already picked Grid -- undoing their
  // choice right when Surprise Me's other randomization (shapes, colors,
  // spanning) would have been most visible in a grid arrangement.
  test('Surprise Me keeps Grid layout for 3 or 5 photos when Grid was already selected', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 300, height: 300, color: '#dd2222' },
      { type: 'solid', width: 300, height: 300, color: '#22dd22' },
      { type: 'solid', width: 300, height: 300, color: '#2222dd' },
    ]);
    await page.evaluate(() => { setLayoutType('grid'); requestRender(); });

    await page.click('#surpriseMeBtn');

    expect(await page.evaluate(() => layoutType)).toBe('grid');
  });

  // An invisible border (one that blends straight into Canvas Background)
  // defeats the point of picking one at all.
  // pickBorderColorAvoiding is now tested directly (rather than through a
  // real #surpriseMeBtn click) because Surprise Me randomizes Canvas
  // Background itself as of this round -- a test that manually pre-sets
  // canvasColorVal before clicking would just get that value overwritten
  // by the click's own random pick, making it impossible to control from
  // the outside anymore. See the integration test right after this block
  // for coverage that the anti-collision guarantee holds against whatever
  // background a real press actually lands on.
  test.describe('pickBorderColorAvoiding avoids clashing with a given background', () => {
    function rgbDistance(hexA, hexB) {
      const toRgb = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
      };
      const a = toRgb(hexA), b = toRgb(hexB);
      return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    }

    test('a color that matches the background exactly gets a visibly different one instead', async ({ page }) => {
      await page.goto('/index.html');
      const result = await page.evaluate(() => pickBorderColorAvoiding({ colorOptions: ['#dd2222'] }, '#dd2222'));
      expect(rgbDistance(result, '#dd2222')).toBeGreaterThanOrEqual(60);
    });

    test('a color that does not clash with the background is left as its own sampled color', async ({ page }) => {
      await page.goto('/index.html');
      const result = await page.evaluate(() => pickBorderColorAvoiding({ colorOptions: ['#2222dd'] }, '#dd2222'));
      expect(rgbDistance(result, '#2222dd')).toBeLessThan(10);
    });

    test('no background (none) never triggers the anti-collision adjustment', async ({ page }) => {
      await page.goto('/index.html');
      const result = await page.evaluate(() => pickBorderColorAvoiding({ colorOptions: ['#dd2222'] }, 'none'));
      expect(rgbDistance(result, '#dd2222')).toBeLessThan(10);
    });
  });

  test('per-photo border colors never clash with whatever Canvas Background Surprise Me itself just picked', async ({ page }) => {
    await page.goto('/index.html');
    await loadSyntheticPhotos(page, [
      { type: 'solid', width: 300, height: 300, color: '#dd2222' },
      { type: 'solid', width: 300, height: 300, color: '#22dd22' },
      { type: 'solid', width: 300, height: 300, color: '#2222dd' },
    ]);

    const rgbDistance = (hexA, hexB) => {
      const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };
      const a = toRgb(hexA), b = toRgb(hexB);
      return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    };

    for (let i = 0; i < 8; i++) {
      await page.click('#surpriseMeBtn');
      const { bg, borders } = await page.evaluate(() => ({
        bg: canvasColorVal,
        borders: photoMasks.map((m) => m.borderColor),
      }));
      if (bg === 'none') continue; // nothing to clash with
      borders.forEach((hex) => expect(rgbDistance(hex, bg)).toBeGreaterThanOrEqual(60));
    }
  });

  // Grid layout only: when the photo count doesn't divide evenly into the
  // chosen column count, the last row used to just be short -- leaving
  // empty cells. Surprise Me now widens that row's own photos (gridSpan)
  // to close the gap exactly, distributed as evenly as possible across
  // however many photos are in that row (not always a fixed 2x span).
  test.describe('grid spanning fills a short last row instead of leaving empty cells', () => {
    // Reads geometry generically off activeCols/cellBounds rather than
    // hardcoding an expected column count, so these stay valid even if
    // computeOptimalColumns's own heuristic is retuned later.
    async function gridGeometryCheck(page) {
      return page.evaluate(() => {
        const bounds = cellBounds.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
        let overlap = false;
        for (let i = 0; i < bounds.length; i++) {
          for (let j = i + 1; j < bounds.length; j++) {
            const a = bounds[i], b = bounds[j];
            if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlap = true;
          }
        }
        const rows = {};
        bounds.forEach((b) => { (rows[b.y] = rows[b.y] || []).push(b); });
        const rowWidths = Object.values(rows).map((cells) => {
          cells.sort((a, b) => a.x - b.x);
          return Math.max(...cells.map((c) => c.x + c.w)) - cells[0].x;
        });
        return {
          overlap,
          rowWidths,
          allRowsSameWidth: new Set(rowWidths.map((w) => Math.round(w))).size === 1,
          spans: photoMasks.map((m) => m.gridSpan),
          cols: activeCols,
          count: rawImages.length,
        };
      });
    }

    test('a photo count that leaves a remainder gets its last row widened to fill exactly, with no gaps or overlaps', async ({ page }) => {
      await page.goto('/index.html');
      // 7 photos -- enough that computeOptimalColumns won't land on a
      // perfect rectangle (verified directly: lands on a 3-column grid,
      // leaving 1 photo in the last row).
      await loadSyntheticPhotos(page, Array.from({ length: 7 }, (_, i) => ({
        type: 'solid', width: 300, height: 300, color: `hsl(${i * 40}, 70%, 50%)`,
      })));

      await page.click('#surpriseMeBtn');
      const geo = await gridGeometryCheck(page);

      expect(geo.overlap).toBe(false);
      expect(geo.allRowsSameWidth).toBe(true);
      // At least one photo actually got widened -- otherwise this test
      // would trivially pass even with spanning entirely broken/no-op'd.
      expect(geo.spans.some((s) => s > 1)).toBe(true);
      // Total span-units across every photo exactly fills the grid (rows
      // x cols) with nothing left over -- the gap-closing guarantee, true
      // regardless of whether the widening landed in just the last row or
      // was spread across more than one (see the "spreads across more
      // than one row" test below for that specifically).
      const rows = Math.ceil(geo.count / geo.cols);
      expect(geo.spans.reduce((a, b) => a + b, 0)).toBe(geo.cols * rows);
    });

    test('spreads the widening across more than one row when there is more than one empty cell to close, instead of one dramatically wide photo', async ({ page }) => {
      await page.goto('/index.html');
      // 7 photos -- lands on a 3-column grid (verified directly), leaving
      // only 1 photo in the last row but 2 empty cells to close. A single
      // photo spanning all 3 columns by itself would technically close
      // the gap too, but reads as one oddly stretched photo rather than
      // several modestly widened ones.
      await loadSyntheticPhotos(page, Array.from({ length: 7 }, (_, i) => ({
        type: 'solid', width: 300, height: 300, color: `hsl(${i * 40}, 70%, 50%)`,
      })));

      await page.click('#surpriseMeBtn');
      const geo = await gridGeometryCheck(page);

      expect(geo.overlap).toBe(false);
      expect(geo.allRowsSameWidth).toBe(true);
      expect(geo.spans.filter((s) => s === 2).length).toBeGreaterThan(1);
      expect(Math.max(...geo.spans)).toBeLessThanOrEqual(2); // never one giant span
    });

    // Regression test: which position within an affected row got the
    // widened cell used to always be the first (leftmost) one -- e.g. for
    // 5 photos in a 3-column grid, always the bottom-left cell, no matter
    // how many times Surprise Me was pressed.
    test('which position gets widened within a row is reshuffled across presses, not always the same spot', async ({ page }) => {
      await page.goto('/index.html');
      // 5 photos in a Grid the user already picked (Grid is preserved --
      // see the "keeps Grid layout for 3 or 5" test -- but 5 also needs
      // this explicit opt-in since it's one of the special-cased counts).
      await loadSyntheticPhotos(page, Array.from({ length: 5 }, (_, i) => ({
        type: 'solid', width: 300, height: 300, color: `hsl(${i * 60}, 70%, 50%)`,
      })));
      await page.evaluate(() => { setLayoutType('grid'); requestRender(); });

      const widenedPositions = new Set();
      for (let i = 0; i < 15; i++) {
        await page.click('#surpriseMeBtn');
        const spans = await page.evaluate(() => photoMasks.map((m) => m.gridSpan));
        widenedPositions.add(spans.findIndex((s) => s === 2));
      }

      // 5 photos / 3 cols leaves exactly 2 candidate positions for the
      // single widened cell (the last row has 2 photos) -- across 15
      // presses both should show up, not just one of them every time.
      expect(widenedPositions.size).toBeGreaterThan(1);
    });

    test('a spanned photo never keeps Circle or Square (a fixed-square mask on a non-square cell)', async ({ page }) => {
      await page.goto('/index.html');
      await loadSyntheticPhotos(page, Array.from({ length: 7 }, (_, i) => ({
        type: 'solid', width: 300, height: 300, color: `hsl(${i * 40}, 70%, 50%)`,
      })));

      // Random shape assignment means a single run might not happen to
      // assign Circle/Square to the spanned photo at all -- run several
      // presses so the downgrade guarantee gets genuinely exercised, not
      // just trivially satisfied by chance.
      for (let i = 0; i < 10; i++) {
        await page.click('#surpriseMeBtn');
        const bad = await page.evaluate(() =>
          photoMasks.some((m) => m.gridSpan > 1 && (m.mode === 'circle' || m.mode === 'square'))
        );
        expect(bad).toBe(false);
      }
    });

    test('changing the column count after Surprise Me resets grid spans back to 1', async ({ page }) => {
      await page.goto('/index.html');
      await loadSyntheticPhotos(page, Array.from({ length: 7 }, (_, i) => ({
        type: 'solid', width: 300, height: 300, color: `hsl(${i * 40}, 70%, 50%)`,
      })));
      await page.click('#surpriseMeBtn');

      const hadSpan = await page.evaluate(() => photoMasks.some((m) => m.gridSpan > 1));
      expect(hadSpan).toBe(true);

      await page.selectOption('#gridCols', '4');
      const spansAfter = await page.evaluate(() => photoMasks.map((m) => m.gridSpan));
      expect(spansAfter.every((s) => s === 1)).toBe(true);
    });
  });
});
