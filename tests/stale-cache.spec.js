const { test, expect, chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// This suite deliberately does NOT use the shared webServer from
// playwright.config.js, which serves one fixed, unchanging copy of the repo.
// Reproducing the real bug requires simulating two sequential deploys of
// DIFFERENT content on the same origin -- exactly "the site gets updated
// while a visitor already has an old version cached".
function startServer(dir, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(dir, urlPath === '/' ? 'index.html' : urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(filePath);
        const type = ext === '.html' ? 'text/html'
          : ext === '.js' ? 'application/javascript'
          : ext === '.json' ? 'application/json'
          : 'text/plain';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
      });
    });
    server.listen(port, () => resolve(server));
  });
}

// Regression test for a bug where a brand-new tab (not just a lingering old
// one) kept showing a deploy from days earlier no matter how many times the
// page was refreshed, because the service worker's fetch handler served the
// page itself (index.html) cache-first. Since index.html is what registers
// the *current* sw.js?v=... URL, a stale cached index.html meant the browser
// never even saw that a newer service worker existed -- it kept
// re-registering the same old one forever. The fix: navigation requests go
// to the network first, falling back to cache only when offline.
test.describe('Service worker updates', () => {
  test('a fresh tab in an already-cached browser picks up a new deploy, with no manual cache-clearing', async () => {
    const port = 4599;
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sw-update-test-'));
    const repoDir = path.join(__dirname, '..');

    for (const f of ['index.html', 'sw.js', 'manifest.json']) {
      fs.copyFileSync(path.join(repoDir, f), path.join(tmpDir, f));
    }

    const server = await startServer(tmpDir, port);
    const browser = await chromium.launch({
      executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    });
    const context = await browser.newContext();

    try {
      // "Deploy 1": load the app as it currently ships, and let the service
      // worker install and cache everything -- putting this browser profile
      // into the exact state a real returning visitor's browser would be in.
      let page = await context.newPage();
      await page.goto(`http://localhost:${port}/index.html`);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10_000 });
      const v1Content = await page.content();
      await page.close();

      // "Deploy 2": a genuinely new release -- bumped cache version, as
      // every real deploy here does. Used below purely as a marker to tell
      // which deploy's content got served on the next load.
      let html = fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8');
      html = html.replace(/sw\.js\?v=\d+/, 'sw.js?v=999999999999');
      fs.writeFileSync(path.join(tmpDir, 'index.html'), html);

      let sw = fs.readFileSync(path.join(tmpDir, 'sw.js'), 'utf8');
      sw = sw.replace(/CACHE_NAME = '[^']*'/, "CACHE_NAME = 'test-cache-v2'");
      fs.writeFileSync(path.join(tmpDir, 'sw.js'), sw);

      // Open a brand-new tab in the SAME already-cached browser context --
      // no incognito window, no manual unregister/reload -- exactly what a
      // user does when they close every tab and open a fresh one.
      page = await context.newPage();
      await page.goto(`http://localhost:${port}/index.html`);
      await page.waitForTimeout(300);
      const v2Content = await page.content();
      await page.close();

      expect(v1Content).not.toContain('sw.js?v=999999999999');
      expect(v2Content).toContain('sw.js?v=999999999999');
    } finally {
      await browser.close();
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
