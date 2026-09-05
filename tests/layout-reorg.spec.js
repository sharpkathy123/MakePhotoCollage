const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

// Regression coverage for the "arrange the page around how it's actually
// used" pass: sections are ordered by how likely a person is to want them
// early (colors, then per-photo adjustments, then layout last), and the
// Save button stays reachable from anywhere on the page instead of only
// appearing after scrolling all the way down past every control.
test.describe('Page layout & reachability', () => {
  // Section headings ("2. Style", "3. Layout & Columns") were removed to
  // cut scrolling -- only "1. Select Photos" remains, since it's the file
  // input's actual <label>, not just a divider. Order is now verified via
  // each section's first real control instead of a heading.
  test('sections appear in priority order: Select Photos, Style controls, Layout controls', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    const order = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('label[for="imgInput"], .color-row[data-target="outer"], #layoutTypeGroup'));
      return all.map((el) => el.id || el.getAttribute('for') || el.dataset.target);
    });
    expect(order).toEqual(['imgInput', 'outer', 'layoutTypeGroup']);
  });

  test('the Save button is docked to the bottom of the viewport (#saveBar), not just placed at the end of the page', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    const info = await page.evaluate(() => {
      const bar = document.getElementById('saveBar');
      return {
        containsSave: !!bar && bar.contains(document.getElementById('saveBtn')),
        position: bar ? getComputedStyle(bar).position : null,
      };
    });
    expect(info.containsSave).toBe(true);
    expect(info.position).toBe('fixed');
  });

  test('on a narrow/tall viewport, the Save button stays visible after scrolling down to a control further down the page', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 650 });
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);

    // Scroll all the way down to the last (lowest-priority) control on the page.
    await page.locator('#gridColsGroup').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);

    const saveBarBox = await page.locator('#saveBar').boundingBox();
    const saveBox = await page.locator('#saveBtn').boundingBox();
    expect(saveBox).not.toBeNull();
    // Docked to the bottom of the viewport regardless of scroll position.
    expect(saveBox.y).toBeGreaterThanOrEqual(0);
    expect(saveBox.y).toBeLessThan(650);

    // The section just scrolled to is also fully reachable -- not hidden
    // underneath the fixed Save bar (the actual bug the earlier sticky-canvas
    // attempt had: it covered whatever the page scrolled to next).
    const lastControlBox = await page.locator('#gridColsGroup').boundingBox();
    expect(lastControlBox.y + lastControlBox.height).toBeLessThanOrEqual(saveBarBox.y);
  });

  test('the selection action buttons wrap onto multiple rows instead of overflowing on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")'); // enables the Reset/Front/Back row

    const wrapStyle = await page.evaluate(() => getComputedStyle(document.getElementById('selectionActionButtons')).flexWrap);
    expect(wrapStyle).toBe('wrap');

    const boxes = await page.locator('#selectionActionButtons .btn-secondary').all();
    const tops = [];
    for (const box of boxes) {
      const b = await box.boundingBox();
      tops.push(b.y);
    }
    // At least two distinct row positions -- proves the buttons actually
    // wrapped rather than merely being allowed to.
    expect(new Set(tops).size).toBeGreaterThan(1);
  });

  // Regression coverage: Reset Photo/Bring to Front/Send to Back used to
  // live inside the conditionally-shown #photoControls panel, far below the
  // canvas -- splitting the "act on your selection" workflow across the top
  // and bottom of the page caused real scroll-and-mis-tap friction (reaching
  // for Reset Photo, scrolling past the toolbar above the canvas, and
  // accidentally tapping something that cleared the selection along the
  // way). They now live in the always-visible toolbar above the canvas,
  // right alongside Select All/Deselect All, disabled-but-visible (like
  // Photo Border Color) rather than appearing/disappearing.
  test('Reset Photo/Bring to Front/Send to Back sit in the always-visible toolbar above the canvas, not inside the per-photo panel', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    const order = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('#selectedPhotoLabel, #selectionActionButtons, #canvas-container'));
      return all.map((el) => el.id);
    });
    expect(order).toEqual(['selectedPhotoLabel', 'selectionActionButtons', 'canvas-container']);

    const insidePhotoControls = await page.evaluate(() =>
      document.getElementById('photoControls').contains(document.getElementById('resetPhotoBtn'))
    );
    expect(insidePhotoControls).toBe(false);

    await expect(page.locator('#resetPhotoBtn')).toBeDisabled();
    await expect(page.locator('#bringToFrontBtn')).toBeDisabled();
    await expect(page.locator('#sendToBackBtn')).toBeDisabled();

    await page.click('button:text("Select All")');
    await expect(page.locator('#resetPhotoBtn')).toBeEnabled();
    await expect(page.locator('#bringToFrontBtn')).toBeEnabled();
    await expect(page.locator('#sendToBackBtn')).toBeEnabled();
  });

  // Regression coverage: the width sliders used to sit in their own row
  // above the color rows -- now each lives inline on its paired color row
  // (Outer Spacing with Outer Border, Photo Spacing with Photo Border
  // Color -- both describe the same thing, that photo's own frame).
  test('the Outer/Photo Spacing sliders sit on the same row as their paired color control', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    const outerSpacingInRow = await page.evaluate(() =>
      document.querySelector('.color-row[data-target="outer"]').contains(document.getElementById('outerSpacing'))
    );
    const innerSpacingInRow = await page.evaluate(() =>
      document.querySelector('.color-row[data-target="border"]').contains(document.getElementById('innerSpacing'))
    );
    expect(outerSpacingInRow).toBe(true);
    expect(innerSpacingInRow).toBe(true);
  });

  // Regression coverage: Photo Border Color used to live in a separate,
  // conditionally-hidden panel from Outer Border/Background -- now all
  // three stay in one list, with just its own swatch/none disabling (not
  // the row disappearing) when nothing's selected, the same
  // disabled-but-visible treatment Corner Radius already uses.
  test('Photo Border Color stays in the same always-visible list as Outer Border and Background', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    await expect(page.locator('.color-row[data-target="border"]')).toBeVisible();
    await expect(page.locator('#borderColor')).toBeDisabled();
    await expect(page.locator('#borderColorLabel')).toHaveClass(/disabled/);
    // Its width slider stays fully active regardless -- it affects every
    // photo immediately, not just a selection.
    await expect(page.locator('#innerSpacing')).toBeEnabled();

    await page.click('button:text("Select All")');
    await expect(page.locator('#borderColor')).toBeEnabled();
    await expect(page.locator('#borderColorLabel')).not.toHaveClass(/disabled/);
  });

  // The selection toolbar (which photo(s) you're about to edit) now sits
  // right above the collage itself, not buried below it among the color
  // controls.
  test('the photo selection toolbar sits above the canvas, not below it among the color controls', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    const order = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('#selectedPhotoLabel, #canvas-container, .color-row[data-target="outer"]'));
      return all.map((el) => el.id || el.dataset.target);
    });
    expect(order).toEqual(['selectedPhotoLabel', 'canvas-container', 'outer']);
  });

  // The Google Photos button only works for accounts approved via the
  // README's own OAuth setup steps -- effectively just the app's owner --
  // so it stays a small, discreet icon rather than competing for attention
  // with "Choose Files," the button everyone else actually wants first.
  test('the Google Photos button is a small discreet icon, not a labeled button competing with Choose Files', async ({ page }) => {
    await page.goto('/index.html');

    const btn = page.locator('#gphotosImportBtn');
    await expect(btn).toHaveClass(/info-toggle-btn/);
    await expect(btn).not.toHaveText(/Google Photos/);
    const box = await btn.boundingBox();
    expect(box.width).toBeLessThanOrEqual(48); // same small square as the (i) info button
  });
});

// A round of feedback aimed squarely at cutting scroll distance: drop the
// "2. Style"/"3. Layout & Columns" headings (pure dividers, not functional
// labels), drop the in-app eyedropper (the native color swatches' own OS
// picker already offers one), and shrink Corner Radius's slider to match
// the compact width the border-width sliders already use, rather than a
// full-width slider all to itself for a rarely-touched option.
test.describe('Reclaiming vertical space', () => {
  test('the "Style" and "Layout & Columns" section headings are gone; "1. Select Photos" (a real <label>) remains', async ({ page }) => {
    await page.goto('/index.html');

    expect(await page.locator('.section-title').count()).toBe(0);
    await expect(page.locator('label[for="imgInput"]')).toHaveText('1. Select Photos');
  });

  test('there is no in-app eyedropper any more', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    expect(await page.locator('.eyedropper-btn').count()).toBe(0);
    expect(await page.locator('#eyedropperHint').count()).toBe(0);
    // The none button (still a real, non-duplicate action) is untouched.
    await expect(page.locator('.none-btn[data-target="outer"]')).toBeVisible();
  });

  test('Corner Radius uses the same compact slider width as the border-width sliders, not a full-width slider to itself', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")'); // reveals #radiusGroup's real (enabled) width
    await page.evaluate(() => { photoMasks[0].mode = 'rounded'; syncSliderControls(); }); // undims it

    const radiusWidth = await page.locator('#cornerRadius').evaluate((el) => el.getBoundingClientRect().width);
    const borderSliderWidth = await page.locator('#outerSpacing').evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.abs(radiusWidth - borderSliderWidth)).toBeLessThan(2);
  });

  test('the Background color row label no longer says "Canvas Background"', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('.color-row[data-target="canvas"] label')).toHaveText('Background');
  });
});
