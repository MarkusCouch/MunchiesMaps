import { expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BERLIN_GPX = path.join(here, 'fixtures', 'berlin-route.gpx');

/**
 * Prepare a context for deterministic tests:
 * - no service worker (avoids cache interference between tests)
 * - external tiles / analytics / feedback endpoints are blocked
 * - intro modal is suppressed
 * - page errors are collected
 */
export async function openApp(page, { url = 'index.html', consent = 'denied' } = {}) {
  const pageErrors = [];
  const warnings = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text());
  });
  await page.context().route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org|googletagmanager\.com|google-analytics\.com|script\.google\.com/, (route) => route.abort());
  await page.addInitScript((consentChoice) => {
    try {
      localStorage.setItem('munchiesMapsHideIntro', 'true');
      if (consentChoice) localStorage.setItem('munchiesAnalyticsConsent', consentChoice);
    } catch (_) { /* ignore */ }
  }, consent);
  await page.goto(url);
  await expect(page.locator('#map .leaflet-pane').first()).toBeAttached();
  return { pageErrors, warnings };
}

export async function getRouteState(page) {
  return page.evaluate(() => ({
    trackPoints: Array.isArray(appState.gpxTrackLatLngs) ? appState.gpxTrackLatLngs.length : 0,
    trackOnMap: Boolean(appState.gpxLayer && map.hasLayer(appState.gpxLayer)),
    favorites: Array.from(poiVisibilityState.favoritePoiIds).sort(),
    hidden: Array.from(poiVisibilityState.hiddenPoiIds).sort(),
    favoritesOnly: Boolean(poiVisibilityState.favoritesOnlyActive),
    unsavedChanges: Boolean(poiVisibilityState.unsavedChanges),
    routeSource: typeof activeRouteSource !== 'undefined' ? activeRouteSource : null
  }));
}

export async function openDrawerSection(page, targetId) {
  const drawer = page.locator('#layerDrawer');
  if ((await drawer.getAttribute('aria-hidden')) !== 'false') {
    await page.click('#layerDrawerToggle');
  }
  const header = page.locator(`button.accordion-header[data-target="${targetId}"]`);
  if ((await header.getAttribute('aria-expanded')) !== 'true') {
    await header.click();
  }
  await expect(header).toHaveAttribute('aria-expanded', 'true');
}

export async function closeDrawer(page) {
  if ((await page.locator('#layerDrawer').getAttribute('aria-hidden')) === 'false') {
    await page.click('#layerDrawerClose');
  }
}

export async function importGpx(page, file = BERLIN_GPX) {
  await openDrawerSection(page, 'gpxBody');
  await page.click('#gpxImportNewBtn');
  await page.setInputFiles('#gpxFileInput', file);
  await page.click('#gpxApplyBtn');
  await expect.poll(async () => (await getRouteState(page)).trackPoints).toBeGreaterThan(10);
  await expect.poll(() => poiMarkers(page).count()).toBeGreaterThan(10);
}

export function poiMarkers(page) {
  return page.locator('.leaflet-marker-icon.mm-marker-wrap');
}

/**
 * Open the popup of the n-th POI marker that satisfies `accept(poiId)` and return its id.
 */
export async function openPoiPopup(page, { startIndex = 0, accept = () => true } = {}) {
  const markers = poiMarkers(page);
  const count = await markers.count();
  for (let i = startIndex; i < count; i += 1) {
    await markers.nth(i).click({ force: true });
    const popup = page.locator('.leaflet-popup');
    await expect(popup).toHaveCount(1);
    const idHolder = popup.locator('[data-poi-id]').first();
    const id = await idHolder.getAttribute('data-poi-id').catch(() => null);
    if (id && accept(id)) return id;
    await closePopup(page);
  }
  throw new Error('No matching POI marker found');
}

export async function closePopup(page) {
  // Closing via the Leaflet API is more robust than clicking the tiny close button
  // while markers are re-rendered underneath it.
  await page.evaluate(() => map.closePopup());
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
}

/** Enable hide mode, favorite one POI and hide another one. Returns both ids. */
export async function favoriteAndHidePois(page) {
  await closeDrawer(page);
  await page.click('#poiHideToggleBtn');
  await expect(page.locator('#poiHideMenu')).toBeVisible();

  const favoriteId = await openPoiPopup(page, { startIndex: 3 });
  await page.locator('.leaflet-popup .popup-favorite-toggle').click();
  await expect.poll(async () => (await getRouteState(page)).favorites).toContain(favoriteId);
  await closePopup(page);

  const hiddenId = await openPoiPopup(page, { startIndex: 10, accept: (id) => id !== favoriteId });
  await page.locator('.leaflet-popup .popup-hide-pill').click();
  await expect.poll(async () => (await getRouteState(page)).hidden).toContain(hiddenId);
  if (await page.locator('.leaflet-popup').count()) await closePopup(page);

  return { favoriteId, hiddenId };
}
