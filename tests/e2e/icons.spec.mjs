import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Same algorithm as scripts/sw-build-id.mjs (computeIconVersion).
async function expectedIconVersion() {
  const dir = 'assets/icons';
  const files = (await readdir(dir)).filter((name) => !name.startsWith('.')).map((name) => path.posix.join(dir, name)).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file); hash.update('\0');
    hash.update(await readFile(file)); hash.update('\0');
  }
  return hash.digest('hex').slice(0, 8);
}

test('icon and manifest URLs carry the icon content version', async ({ page, request }) => {
  const version = await expectedIconVersion();
  await page.addInitScript(() => localStorage.setItem('munchiesAnalyticsConsent', 'denied'));
  await page.goto('index.html');

  const iconHrefs = await page.evaluate(() => Array.from(
    document.querySelectorAll('link[rel*="icon"], link[rel="manifest"], meta[property="og:image"], meta[name="twitter:image"]'),
    (el) => el.getAttribute('href') || el.getAttribute('content')
  ));
  expect(iconHrefs.length).toBeGreaterThanOrEqual(11);
  for (const href of iconHrefs) expect(href).toContain(`?v=${version}`);

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  const manifest = await (await request.get(manifestHref)).json();
  expect(manifest.icons.length).toBe(4);
  for (const icon of manifest.icons) {
    expect(icon.src).toContain(`?v=${version}`);
    const res = await request.get(icon.src);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
  const touch = await request.get(await page.getAttribute('link[rel="apple-touch-icon"]', 'href'));
  expect(touch.status()).toBe(200);
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('service worker serves versioned icons offline', async ({ page, context }) => {
    await context.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org|googletagmanager\.com/, (route) => route.abort());
    await page.addInitScript(() => {
      localStorage.setItem('munchiesMapsHideIntro', 'true');
      localStorage.setItem('munchiesAnalyticsConsent', 'denied');
    });
    await page.goto('index.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(async () => {
      const name = (await caches.keys()).find((n) => n.startsWith('munchiesmaps-static-'));
      return name ? (await (await caches.open(name)).keys()).length : 0;
    })).toBeGreaterThan(10);
    await page.reload(); // make sure the page is controlled by the service worker

    const href = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
    await context.setOffline(true);
    const status = await page.evaluate(async (url) => (await fetch(url)).status, href);
    expect(status).toBe(200);
  });
});
