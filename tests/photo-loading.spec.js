const { test, expect } = require('@playwright/test');
const { FIXTURES, loadPhotos } = require('./helpers');

test.describe('Loading photos', () => {
  test('starts with Save disabled', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#saveBtn')).toBeDisabled();
  });

  test('loading files populates rawImages and enables Save', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);

    await expect(page.locator('#saveBtn')).toBeEnabled();
    const count = await page.evaluate(() => rawImages.length);
    expect(count).toBe(2);
  });

  // Regression coverage: the Frame Shape/Behavior/Corner Radius panel used
  // to disappear entirely with nothing selected, which hid its existence
  // from new users and made it impossible to set a preferred Frame
  // Behavior before loading or selecting any photo. It's now always
  // visible; see layout-reorg.spec.js for the "editing defaults vs.
  // editing a selection" coverage.
  test('the Frame Shape/Behavior/Corner Radius panel is visible whether or not anything is selected', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#photoControls')).toBeVisible();

    await loadPhotos(page, [FIXTURES.redLandscape]);
    await expect(page.locator('#photoControls')).toBeVisible();

    await page.click('button:text("Select All")');
    await expect(page.locator('#photoControls')).toBeVisible();

    await page.click('button:text("Deselect All")');
    await expect(page.locator('#photoControls')).toBeVisible();
  });

  test('selecting files a second time appends to the previous set instead of replacing it', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);
    expect(await page.evaluate(() => rawImages.length)).toBe(3);

    await loadPhotos(page, [FIXTURES.yellowSquare]);
    expect(await page.evaluate(() => rawImages.length)).toBe(4);
  });

  test('"Start New Collage" clears all photos and resets the UI back to its empty state', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait]);
    await expect(page.locator('#startNewBtn')).toBeVisible();

    page.on('dialog', (dialog) => dialog.accept());
    await page.click('#startNewBtn');

    expect(await page.evaluate(() => rawImages.length)).toBe(0);
    expect(await page.evaluate(() => transforms.length)).toBe(0);
    expect(await page.evaluate(() => photoMasks.length)).toBe(0);
    expect(await page.evaluate(() => selectedIndices.length)).toBe(0);
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await expect(page.locator('#photoControls')).toBeVisible(); // always visible -- see the panel-visibility test above
    await expect(page.locator('#startNewBtn')).toBeHidden();

    // A fresh selection afterward starts a new set rather than appending
    // onto the (now cleared) old one.
    await loadPhotos(page, [FIXTURES.greenSquare]);
    expect(await page.evaluate(() => rawImages.length)).toBe(1);
  });

  test('each loaded photo gets its own transform and mask entry', async ({ page }) => {
    await page.goto('/index.html');
    await loadPhotos(page, [FIXTURES.redLandscape, FIXTURES.bluePortrait, FIXTURES.greenSquare]);

    const { transformsLen, masksLen, firstMask } = await page.evaluate(() => ({
      transformsLen: transforms.length,
      masksLen: photoMasks.length,
      firstMask: { ...photoMasks[0] },
    }));
    expect(transformsLen).toBe(3);
    expect(masksLen).toBe(3);
    // New photos default to no mask / Attached behavior (frame and photo
    // move together), so a first-time drag moves what the user expects.
    expect(firstMask.mode).toBe('none');
    expect(firstMask.behavior).toBe('attached');
  });

  // Regression test: one corrupt file used to discard the whole batch
  // silently (Promise.all rejects as a whole) -- the photos that decode
  // fine now still get added, with an alert() naming how many failed.
  test('a corrupt file among several does not block the others from loading, and alerts about the failure', async ({ page }) => {
    await page.goto('/index.html');
    let alertMessage = null;
    page.on('dialog', async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });

    await page.setInputFiles('#imgInput', [FIXTURES.redLandscape, FIXTURES.corrupt, FIXTURES.bluePortrait]);
    await page.waitForFunction(() => typeof rawImages !== 'undefined' && rawImages.length === 2);

    expect(await page.evaluate(() => rawImages.length)).toBe(2);
    await expect(page.locator('#saveBtn')).toBeEnabled();
    expect(alertMessage).toContain('1 of 3');
  });

  test('a batch that is entirely corrupt files loads nothing and alerts, rather than failing silently', async ({ page }) => {
    await page.goto('/index.html');
    let alertMessage = null;
    page.on('dialog', async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });

    await page.setInputFiles('#imgInput', [FIXTURES.corrupt]);
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => rawImages.length)).toBe(0);
    await expect(page.locator('#saveBtn')).toBeDisabled();
    expect(alertMessage).toBeTruthy();
  });
});
