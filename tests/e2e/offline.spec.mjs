import { test, expect } from '@playwright/test';

// This spec needs the real service worker.
test.use({ serviceWorkers: 'allow' });

test('service worker serves the app shell offline', async ({ page, context }) => {
  await context.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org|googletagmanager\.com|script\.google\.com/, (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem('munchiesMapsHideIntro', 'true'));
  await page.goto('index.html');

  const buildId = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active ? reg.active.scriptURL : null;
  });
  expect(buildId).toContain('sw.js');
  // Wait until the static cache is populated by the install step.
  await expect.poll(() => page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find((n) => n.startsWith('munchiesmaps-static-'));
    if (!name) return 0;
    return (await (await caches.open(name)).keys()).length;
  })).toBeGreaterThan(10);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#map .leaflet-pane').first()).toBeAttached();
  await expect(page.locator('#offlineIndicator')).toHaveClass(/is-visible/);
  expect(await page.evaluate(() => typeof window.opening_hours)).toBe('function');
});
