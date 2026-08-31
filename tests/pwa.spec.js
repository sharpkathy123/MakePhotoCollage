const { test, expect } = require('@playwright/test');

test.describe('PWA basics', () => {
  test('manifest.json is valid and has the required fields', async ({ page, baseURL }) => {
    const res = await page.request.get(`${baseURL}/manifest.json`);
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('service worker registers without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/index.html');
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return true; // nothing to wait for
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    }, { timeout: 10_000 });

    expect(errors).toEqual([]);
  });

  // Footer timestamp: fetched live from GitHub's API for the latest commit
  // on main (not baked into the file by CI), then reformatted client-side
  // into the viewer's own local time. Regression coverage for that
  // conversion, including a date-rollover case (a viewer far enough behind
  // UTC that the local calendar date differs from the UTC one).
  test('footer timestamp converts the fetched commit date into the browser\'s local time', async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
    const page = await context.newPage();

    await page.route('https://api.github.com/repos/sharpkathy123/MakePhotoCollage/commits/main', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commit: { committer: { date: '2026-08-31T03:12:00Z' } } }),
      });
    });

    await page.goto('/index.html');

    // UTC 2026-08-31 03:12 in America/Los_Angeles (UTC-7 in August) is the
    // previous calendar day, 20:12 -- the date-rollover case.
    await expect(page.locator('#updateTimestamp')).toHaveText('2026-08-30 20:12');

    await context.close();
  });

  test('footer timestamp shows "unavailable" if the commit lookup fails', async ({ page }) => {
    await page.route('https://api.github.com/repos/sharpkathy123/MakePhotoCollage/commits/main', (route) => {
      route.fulfill({ status: 500, body: 'server error' });
    });

    await page.goto('/index.html');
    await expect(page.locator('#updateTimestamp')).toHaveText('unavailable');
  });
});
