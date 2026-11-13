import { test, expect } from '@playwright/test';
import { openApp, importGpx, getRouteState, openDrawerSection } from './helpers.mjs';

test('mobile: GPX import zooms to the whole route and shows POIs', async ({ page }) => {
  await openApp(page);
  await importGpx(page);
  const state = await getRouteState(page);
  expect(state.trackOnMap).toBe(true);
  const fits = await page.evaluate(() => map.getBounds().pad(0.05).contains(appState.gpxLayer.getBounds()));
  expect(fits).toBe(true);
  await expect.poll(() => page.locator('.leaflet-marker-icon').count()).toBeGreaterThan(5);
});

test('mobile: loading a saved route zooms to the whole route and shows POIs', async ({ page }) => {
  await openApp(page);
  await importGpx(page);
  await page.selectOption('#offlineMapDetailSelect', 'off');
  await page.click('#gpxSaveBtn');
  await expect.poll(async () => (await getRouteState(page)).routeSource).toBe('offline-route-package');

  await page.reload();
  await expect(page.locator('#map .leaflet-pane').first()).toBeAttached();
  // Start far away from the route to make sure the map really re-fits.
  await page.evaluate(() => map.setView([48.137, 11.575], 8, { animate: false }));
  await openDrawerSection(page, 'gpxBody');
  await page.click('#gpxLoadSavedBtn');
  await expect.poll(async () => (await getRouteState(page)).trackOnMap).toBe(true);
  await expect.poll(() => page.evaluate(() => map.getBounds().pad(0.05).contains(appState.gpxLayer.getBounds()))).toBe(true);
  await expect.poll(() => page.locator('.leaflet-marker-icon').count()).toBeGreaterThan(5);
});
