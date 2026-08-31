const path = require('path');

const FIXTURES = {
  redLandscape: path.join(__dirname, 'fixtures', 'red-landscape.png'), // 300x180, (220,60,60)
  bluePortrait: path.join(__dirname, 'fixtures', 'blue-portrait.png'), // 180x300, (60,120,220)
  greenSquare: path.join(__dirname, 'fixtures', 'green-square.png'), // 220x220, (60,180,80)
  yellowSquare: path.join(__dirname, 'fixtures', 'yellow-square.png'), // 220x220, (230,200,40)
};

// Loads the given fixture files into the app via the file input and waits
// for the render to settle. Selecting files appends to whatever is already
// loaded (mirrors the real file input's behavior), so this waits for the
// count to grow by fixturePaths.length rather than assuming a fresh start.
async function loadPhotos(page, fixturePaths) {
  const before = await page.evaluate(() => (typeof rawImages !== 'undefined' ? rawImages.length : 0));
  await page.setInputFiles('#imgInput', fixturePaths);
  await page.waitForFunction(
    (n) => typeof rawImages !== 'undefined' && rawImages.length === n,
    before + fixturePaths.length
  );
}

// Reads the current on-screen canvas pixel at app-space (canvas-resolution)
// coordinates (x, y) — NOT CSS/viewport pixels.
async function samplePixel(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const c = document.getElementById('collageCanvas');
    const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, { x, y });
}

// Renders once with showEditingOverlays=false (what Save/export uses) and
// returns the resulting canvas pixel data as a flat array, without
// disturbing the app's normal on-screen (overlays-on) render afterward.
async function captureCleanExportPixel(page, x, y) {
  return page.evaluate(({ x, y }) => {
    renderCollage(false);
    const c = document.getElementById('collageCanvas');
    const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
    renderCollage(true);
    return [d[0], d[1], d[2], d[3]];
  }, { x, y });
}

// Converts app-space (canvas pixel resolution) coordinates to viewport
// (CSS pixel) coordinates for real mouse/touch input, accounting for the
// canvas's max-width:100% CSS scaling.
async function appPointToViewport(page, x, y) {
  const box = await page.$eval('#collageCanvas', (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, cw: el.width, ch: el.height };
  });
  return {
    x: box.left + (x / box.cw) * box.width,
    y: box.top + (y / box.ch) * box.height,
  };
}

// Returns { x, y } for the center of cellBounds[idx], in app-space.
async function cellCenter(page, idx) {
  return page.evaluate((i) => {
    const b = cellBounds[i];
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, idx);
}

// input[type="color"] doesn't behave like a text field for Playwright's
// fill() — set its value and dispatch the app's listened-for event directly.
async function setColorInput(page, selector, hexValue) {
  await page.evaluate(({ selector, hexValue }) => {
    const el = document.querySelector(selector);
    el.value = hexValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { selector, hexValue });
}

module.exports = {
  FIXTURES,
  loadPhotos,
  samplePixel,
  captureCleanExportPixel,
  appPointToViewport,
  cellCenter,
  setColorInput,
};
