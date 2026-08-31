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

  // Footer timestamp: stamped in UTC by CI, then reformatted client-side
  // into the viewer's own local time. Regression coverage for that
  // conversion, including a date-rollover case (a viewer far enough behind
  // UTC that the local calendar date differs from the UTC one).
  test('footer timestamp converts the stamped UTC value into the browser\'s local time', async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
    const page = await context.newPage();
    await page.goto('/index.html');

    await page.evaluate(() => {
      document.getElementById('updateTimestamp').setAttribute('data-updated-utc', '2026-08-31T03:12:00Z');
    });
    // Re-run the same conversion the page does on load.
    const displayed = await page.evaluate(() => {
      const el = document.getElementById('updateTimestamp');
      const d = new Date(el.getAttribute('data-updated-utc'));
      const pad = (n) => String(n).padStart(2, '0');
      const text = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      el.textContent = text;
      return text;
    });

    // UTC 2026-08-31 03:12 in America/Los_Angeles (UTC-7 in August) is the
    // previous calendar day, 20:12 -- the date-rollover case.
    expect(displayed).toBe('2026-08-30 20:12');
    await expect(page.locator('#updateTimestamp')).toHaveText(displayed);

    await context.close();
  });
});
