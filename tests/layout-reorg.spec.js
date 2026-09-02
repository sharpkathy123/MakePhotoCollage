const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

// Regression coverage for the "arrange the page around how it's actually
// used" pass: sections are ordered by how likely a person is to want them
// early (colors, then per-photo adjustments, then layout last), and the
// Save button stays reachable from anywhere on the page instead of only
// appearing after scrolling all the way down past every control.
test.describe('Page layout & reachability', () => {
  test('sections appear in priority order: Select Photos, Style, Layout & Columns', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    const headings = await page.evaluate(() =>
      Array.from(document.querySelectorAll('label[for="imgInput"], .section-title')).map(el => el.textContent.trim())
    );
    expect(headings).toEqual([
      '1. Select Photos',
      '2. Style',
      '3. Layout & Columns',
    ]);
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

  test('the per-photo toolbar buttons wrap onto multiple rows instead of overflowing on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);
    await page.click('button:text("Select All")'); // reveals the Reset/Front/Back row

    const wrapStyle = await page.evaluate(() => getComputedStyle(document.querySelector('.button-group-inline')).flexWrap);
    expect(wrapStyle).toBe('wrap');

    const boxes = await page.locator('#photoControls .button-group-inline .btn-secondary').all();
    const tops = [];
    for (const box of boxes) {
      const b = await box.boundingBox();
      tops.push(b.y);
    }
    // At least two distinct row positions -- proves the buttons actually
    // wrapped rather than merely being allowed to.
    expect(new Set(tops).size).toBeGreaterThan(1);
  });

  // Regression coverage: the width sliders used to sit in their own row
  // above the color rows -- now each lives inline on its paired color row
  // (Outer Spacing with Outer Border, Photo Spacing with Canvas Background,
  // since Photo Border Color itself only shows once something's selected
  // but photo border *width* affects every photo immediately).
  test('the Outer/Photo Spacing sliders sit on the same row as their paired color control', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape]);

    const outerSpacingInRow = await page.evaluate(() =>
      document.querySelector('.color-row[data-target="outer"]').contains(document.getElementById('outerSpacing'))
    );
    const innerSpacingInRow = await page.evaluate(() =>
      document.querySelector('.color-row[data-target="canvas"]').contains(document.getElementById('innerSpacing'))
    );
    expect(outerSpacingInRow).toBe(true);
    expect(innerSpacingInRow).toBe(true);
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
