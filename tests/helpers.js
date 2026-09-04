const path = require('path');
const fs = require('fs');

const FIXTURES = {
  redLandscape: path.join(__dirname, 'fixtures', 'red-landscape.png'), // 300x180, (220,60,60)
  bluePortrait: path.join(__dirname, 'fixtures', 'blue-portrait.png'), // 180x300, (60,120,220)
  greenSquare: path.join(__dirname, 'fixtures', 'green-square.png'), // 220x220, (60,180,80)
  yellowSquare: path.join(__dirname, 'fixtures', 'yellow-square.png'), // 220x220, (230,200,40)
  corrupt: path.join(__dirname, 'fixtures', 'corrupt.png'), // not a real image -- fails to decode, on purpose
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
// canvas's max-width:100% CSS scaling. Scrolls the canvas into view first --
// unlike page.click(selector), a raw page.mouse.click(x, y) never auto-
// scrolls, so a canvas sitting below the fold (easy with 4+ photos loaded
// plus an expanded controls panel) would silently compute coordinates for
// a click that lands outside the actual viewport and hits nothing.
async function appPointToViewport(page, x, y) {
  await page.locator('#collageCanvas').scrollIntoViewIfNeeded();
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

// Clicks the option-group button with the given data-value -- replaces
// page.selectOption() for Mask Shape (#maskModeGroup) and Mask Pan
// Behavior (#maskBehaviorGroup), which are custom button groups rather
// than native <select> elements.
async function clickOption(page, groupSelector, value) {
  await page.click(`${groupSelector} .option-btn[data-value="${value}"]`);
}

// Returns the data-value of whichever button in an option-group is
// currently marked active, or null if none is (the "Mixed" state for a
// multi-selection whose current values differ).
async function getActiveOptionValue(page, groupSelector) {
  return page.evaluate((sel) => {
    const active = document.querySelector(`${sel} .option-btn.active`);
    return active ? active.dataset.value : null;
  }, groupSelector);
}

// Converts an app-space (canvas pixel resolution) distance to viewport (CSS
// pixel) distance, using the same canvas scale factor as appPointToViewport.
async function appDistToViewport(page, dist) {
  const box = await page.$eval('#collageCanvas', (el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, cw: el.width };
  });
  return dist * (box.width / box.cw);
}

// Dispatches a real two-finger touch gesture on the canvas by constructing
// actual Touch/TouchEvent objects and dispatching them -- not a mock of the
// gesture's effects, the genuine touchstart/touchmove/touchend handlers run
// exactly as they would for a real pinch or twist. `pairs` is an array of
// [{x,y}, {x,y}] viewport-coordinate pairs: the first fires touchstart, any
// further ones each fire touchmove, and a final touchend (no touches)
// closes the gesture.
async function twoFingerGesture(page, pairs) {
  await page.evaluate((pairs) => {
    const canvas = document.getElementById('collageCanvas');
    function touchEventFor(type, pair) {
      const touches = pair.map((p, i) => new Touch({ identifier: i, target: canvas, clientX: p.x, clientY: p.y }));
      return new TouchEvent(type, { touches, changedTouches: touches, bubbles: true, cancelable: true });
    }
    canvas.dispatchEvent(touchEventFor('touchstart', pairs[0]));
    for (let i = 1; i < pairs.length; i++) {
      canvas.dispatchEvent(touchEventFor('touchmove', pairs[i]));
    }
    canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [], bubbles: true, cancelable: true }));
  }, pairs);
}

// Simulates a two-finger pinch/twist centered on the given app-space point:
// two touches start `startDist` (app-space px) apart at `startAngle`
// degrees and end `endDist` apart at `endAngle` degrees. A single
// touchmove step is enough -- the app's gesture math only ever compares the
// current touch positions against the ones captured at touchstart, not the
// path traveled in between.
async function pinchGesture(page, centerApp, { startDist, endDist, startAngle = 0, endAngle = 0 } = {}) {
  const center = await appPointToViewport(page, centerApp.x, centerApp.y);
  const startD = await appDistToViewport(page, startDist);
  const endD = await appDistToViewport(page, endDist);
  const pairAt = (dist, angleDeg) => {
    const rad = angleDeg * Math.PI / 180;
    const dx = Math.cos(rad) * dist / 2;
    const dy = Math.sin(rad) * dist / 2;
    return [{ x: center.x - dx, y: center.y - dy }, { x: center.x + dx, y: center.y + dy }];
  };
  await twoFingerGesture(page, [pairAt(startD, startAngle), pairAt(endD, endAngle)]);
}

// Dispatches a real `paste` event (with an actual DataTransfer carrying the
// given fixture image as a File) at #pasteZone -- not a mock of the app's
// handling, the genuine paste listener runs exactly as it would for a real
// OS paste gesture. navigator.clipboard.read() (the Async Clipboard API)
// turned out to be unreliable for images on iOS Safari in real use, so the
// app reads pastes the classic way instead: focus a field, wait for the
// browser's own `paste` event, read event.clipboardData.
async function pastePhotoInto(page, fixturePath, mimeType = 'image/png') {
  const base64 = fs.readFileSync(fixturePath).toString('base64');
  await page.evaluate(({ base64, mimeType }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'pasted.png', { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    const zone = document.getElementById('pasteZone');
    zone.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { base64, mimeType });
}

// Same, but with plain text on the clipboard instead of an image -- covers
// the "that paste didn't include a photo" branch.
async function pasteTextInto(page, text = 'hello') {
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(text, 'text/plain');
    const zone = document.getElementById('pasteZone');
    zone.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

module.exports = {
  FIXTURES,
  loadPhotos,
  samplePixel,
  captureCleanExportPixel,
  appPointToViewport,
  cellCenter,
  setColorInput,
  clickOption,
  getActiveOptionValue,
  twoFingerGesture,
  pinchGesture,
  pastePhotoInto,
  pasteTextInto,
};
