const { test, expect } = require('@playwright/test');

// Mocks Google Identity Services (the OAuth popup) and the Photos Picker
// API's fetch calls, so the whole two-click flow (sign in -> prepare
// session -> open picker tab -> poll -> download) can run without real
// network access or a real Google account.
async function mockGoogleIdentityAndPicker(page, { pickerUri = 'about:blank' } = {}) {
  await page.evaluate((pickerUri) => {
    window.prompt = () => 'fake-client-id.apps.googleusercontent.com';
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (opts) => ({
            requestAccessToken: () => opts.callback({ access_token: 'fake-token-abc' }),
          }),
        },
      },
    };
    let mediaItemsSet = false;
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('photospicker.googleapis.com/v1/sessions') && opts && opts.method === 'POST') {
        return new Response(JSON.stringify({
          id: 'sess123',
          pickerUri,
          pollingConfig: { pollInterval: '1s', timeoutIn: '60s' },
        }), { status: 200 });
      }
      if (u.includes('/sessions/sess123') && (!opts || opts.method !== 'DELETE')) {
        mediaItemsSet = true; // resolves the poll on the very next check
        return new Response(JSON.stringify({ mediaItemsSet }), { status: 200 });
      }
      if (u.includes('/mediaItems')) {
        return new Response(JSON.stringify({ mediaItems: [] }), { status: 200 }); // empty pick, simplest well-defined outcome
      }
      if (u.includes('/sessions/sess123') && opts && opts.method === 'DELETE') {
        return new Response('{}', { status: 200 });
      }
      return realFetch(url, opts);
    };
  }, pickerUri);
}

test.describe('Google Photos import', () => {
  test('clicking the button prompts for a Client ID and saves it to localStorage', async ({ page }) => {
    await page.goto('/index.html');
    await mockGoogleIdentityAndPicker(page);

    await page.click('#gphotosImportBtn');
    await page.waitForTimeout(300);

    const saved = await page.evaluate(() => localStorage.getItem('gphotosClientId'));
    expect(saved).toBe('fake-client-id.apps.googleusercontent.com');
  });

  test('after signing in, the "Tap to Open" button appears and the import button hides (no popup opened yet)', async ({ page }) => {
    await page.goto('/index.html');
    await mockGoogleIdentityAndPicker(page);

    await page.click('#gphotosImportBtn');
    await expect(page.locator('#gphotosOpenPickerBtn')).toBeVisible();
    await expect(page.locator('#gphotosImportBtn')).toBeHidden();
  });

  test('clicking "Tap to Open" opens the picker tab and eventually resets back to the initial button state', async ({ page }) => {
    await page.goto('/index.html');
    await mockGoogleIdentityAndPicker(page, { pickerUri: '/index.html' }); // same-origin, safe to actually open in the test

    await page.click('#gphotosImportBtn');
    await expect(page.locator('#gphotosOpenPickerBtn')).toBeVisible();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.click('#gphotosOpenPickerBtn'),
    ]);
    expect(popup).toBeTruthy();

    // Empty pick (mocked mediaItems: []) resolves the whole flow quickly:
    // resets to the initial "Google Photos" button state.
    await expect(page.locator('#gphotosImportBtn')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#gphotosOpenPickerBtn')).toBeHidden();
  });

  test('a Google sign-in error is surfaced via alert() and the button resets', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      window.prompt = () => 'fake-client-id.apps.googleusercontent.com';
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: (opts) => ({
              requestAccessToken: () => opts.error_callback({ type: 'popup_closed' }),
            }),
          },
        },
      };
    });

    let alertMessage = null;
    page.on('dialog', async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });

    await page.click('#gphotosImportBtn');
    await page.waitForTimeout(300);

    expect(alertMessage).toContain('popup_closed');
    await expect(page.locator('#gphotosImportBtn')).toBeEnabled();
    await expect(page.locator('#gphotosImportBtn')).toHaveText('📷 Google Photos');
  });

  // Regression test: the disclaimer about approved-accounts-only used to
  // show unconditionally to every visitor, right under the primary file
  // picker -- dev-audience content occupying prime first-load real estate
  // for the ~100% of users who'll never touch Google Photos import. It's
  // now hidden by default and revealed on demand via a small info toggle.
  test('the Google Photos disclaimer is hidden by default and toggled by the info button', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('#gphotosInfo')).toBeHidden();
    await expect(page.locator('#gphotosInfoBtn')).toHaveAttribute('aria-expanded', 'false');

    await page.click('#gphotosInfoBtn');
    await expect(page.locator('#gphotosInfo')).toBeVisible();
    await expect(page.locator('#gphotosInfo')).toContainText('README');
    await expect(page.locator('#gphotosInfoBtn')).toHaveAttribute('aria-expanded', 'true');

    await page.click('#gphotosInfoBtn');
    await expect(page.locator('#gphotosInfo')).toBeHidden();
  });
});
