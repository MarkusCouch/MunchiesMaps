import { test, expect } from '@playwright/test';

test('SEO landing page renders and deep-links into the filtered map', async ({ page, context }) => {
  await context.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org|googletagmanager\.com/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('munchiesMapsHideIntro', 'true');
    localStorage.setItem('munchiesAnalyticsConsent', 'denied');
  });
  await page.goto('map/drinking-water/slovenia/');
  await expect(page.locator('h1')).toHaveText('Drinking water in Slovenia for cyclists');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://nightrides.cc/munchiesmaps/map/drinking-water/slovenia/');
  expect(await page.locator('table tbody tr').count()).toBeGreaterThan(3);

  await page.click('a.cta');
  await expect(page).toHaveURL(/index\.html\?c=drinking_water/);
  await expect(page.locator('#map .leaflet-pane').first()).toBeAttached();
  await expect.poll(() => page.evaluate(() => Array.from(filterState.kategorien))).toEqual(['drinking_water']);
  // The shared view is applied directly (no "Go to shared view" click needed).
  const center = await page.evaluate(() => map.getCenter());
  expect(center.lat).toBeGreaterThan(45);
  expect(center.lat).toBeLessThan(47.2);
  expect(center.lng).toBeGreaterThan(13);
  expect(center.lng).toBeLessThan(16.7);
  await expect.poll(() => page.locator('.leaflet-marker-icon').count()).toBeGreaterThan(0);
});

test('overview page links to every generated landing page', async ({ page }) => {
  await page.goto('map/');
  await expect(page.locator('h1')).toBeVisible();
  expect(await page.locator('table a').count()).toBeGreaterThan(100);
});
