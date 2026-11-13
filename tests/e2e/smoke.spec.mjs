import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  openApp, importGpx, getRouteState, openDrawerSection, closeDrawer,
  favoriteAndHidePois, poiMarkers
} from './helpers.mjs';

test.describe('app boot', () => {
  test('loads without runtime errors and with all vendor libraries', async ({ page }) => {
    const { pageErrors, warnings } = await openApp(page);
    await expect.poll(() => page.evaluate(() => typeof window.opening_hours)).toBe('function');
    expect(await page.evaluate(() => typeof L.markerClusterGroup)).toBe('function');
    // Give async init a moment to surface errors.
    await page.waitForTimeout(500);
    expect(pageErrors).toEqual([]);
    expect(warnings.filter((w) => w.includes('self-check failed'))).toEqual([]);
    expect(warnings.filter((w) => /Content Security Policy/i.test(w))).toEqual([]);
  });

  test('night badge logic uses opening_hours.js', async ({ page }) => {
    await openApp(page);
    const result = await page.evaluate(() => {
      const oh = new opening_hours('Mo-Su 06:00-23:00');
      return { open: oh.getState(new Date('2026-11-13T22:00:00')), parsed: typeof parseOpeningHours('Mo-Fr 08:00-22:00') };
    });
    expect(result).toEqual({ open: true, parsed: 'object' });
  });
});

test.describe('route tools', () => {
  test('GPX import renders the track, POIs near the route and fits the map', async ({ page }) => {
    await openApp(page);
    await importGpx(page);
    await expect(page.locator('#offlineMapDetailRow')).toBeVisible();
    const state = await getRouteState(page);
    expect(state.trackOnMap).toBe(true);
    expect(state.routeSource).toBe('new-gpx-import');
    const fits = await page.evaluate(() => map.getBounds().contains(appState.gpxLayer.getBounds()));
    expect(fits).toBe(true);
    await expect(page.locator('#poiHideToggleBtn')).toBeVisible();
  });

  test('favorite + hide, and "Show favorites only" survives closing the menu', async ({ page }) => {
    await openApp(page);
    await importGpx(page);
    const { favoriteId } = await favoriteAndHidePois(page);

    await expect(page.locator('.mm-marker--favorite')).toHaveCount(1);

    await page.click('#poiHideMenu [data-action="favorites-only"]');
    await expect.poll(async () => (await getRouteState(page)).favoritesOnly).toBe(true);
    await expect(poiMarkers(page)).toHaveCount(1);

    // Close the hide menu – the favorites filter must stay active.
    await page.click('#poiHideToggleBtn');
    await expect(page.locator('#poiHideMenu')).toBeHidden();
    const state = await getRouteState(page);
    expect(state.favoritesOnly).toBe(true);
    expect(state.favorites).toEqual([favoriteId]);
    await expect(poiMarkers(page)).toHaveCount(1);
  });

  test('saved route restores track, favorites and hidden POIs after reload', async ({ page }) => {
    await openApp(page);
    await importGpx(page);
    const { favoriteId, hiddenId } = await favoriteAndHidePois(page);

    await openDrawerSection(page, 'gpxBody');
    await page.selectOption('#offlineMapDetailSelect', 'off');
    await page.click('#gpxSaveBtn');
    await expect.poll(async () => (await getRouteState(page)).routeSource).toBe('offline-route-package');
    await expect(page.locator('#gpxSaveBtn')).toHaveText('Saved');
    expect((await getRouteState(page)).unsavedChanges).toBe(false);
    // The offline detail picker is hidden once the route is saved.
    await expect(page.locator('#offlineMapDetailRow')).toBeHidden();
    await expect(page.locator('#offlineMapDetailHint')).toBeHidden();

    await page.reload();
    await expect(page.locator('#map .leaflet-pane').first()).toBeAttached();
    expect((await getRouteState(page)).trackPoints).toBe(0);

    await openDrawerSection(page, 'gpxBody');
    await page.click('#gpxLoadSavedBtn');
    await expect.poll(async () => (await getRouteState(page)).trackOnMap).toBe(true);
    await expect.poll(async () => (await getRouteState(page)).favorites).toEqual([favoriteId]);
    const state = await getRouteState(page);
    expect(state.hidden).toEqual([hiddenId]);
    await closeDrawer(page);
    await expect(page.locator('.mm-marker--favorite')).toHaveCount(1);
  });

  test('backup export/import roundtrip restores the session', async ({ page }, testInfo) => {
    await openApp(page);
    await importGpx(page);
    const { favoriteId, hiddenId } = await favoriteAndHidePois(page);

    await openDrawerSection(page, 'gpxBody');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportRouteBackupBtn')
    ]);
    const backupPath = testInfo.outputPath('backup.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(await readFile(backupPath, 'utf8'));
    expect(backup.type).toBe('munchies-route-backup');
    expect(backup.gpxRaw).toContain('<trkpt');
    expect(backup.favoritePoiIds).toEqual([favoriteId]);
    expect(backup.hiddenPoiIds).toEqual([hiddenId]);
    // Hidden POIs are excluded from the visible set but kept as minimal snapshots for "Show hidden".
    expect((backup.hiddenPoiSnapshots ?? []).map((poi) => poi.id)).toEqual([hiddenId]);

    await page.click('#gpxRemoveRouteBtn');
    await expect.poll(async () => (await getRouteState(page)).trackOnMap).toBe(false);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#loadRouteBackupBtn')
    ]);
    await chooser.setFiles(backupPath);
    await expect.poll(async () => (await getRouteState(page)).trackOnMap).toBe(true);
    const state = await getRouteState(page);
    expect(state.routeSource).toBe('backup-import');
    expect(state.favorites).toEqual([favoriteId]);
    expect(state.hidden).toEqual([hiddenId]);
    expect(state.trackPoints).toBeGreaterThan(10);
  });
});

test.describe('share state', () => {
  test('region state with more than 53 regions (Turkey) roundtrips via URL', async ({ page }) => {
    await openApp(page);
    const ok = await page.evaluate(() => {
      const parsed = parseRegionStateParam('tr:' + (2n ** 80n + 5n).toString(36));
      const set = parsed.tr;
      return set instanceof Set && set.has('tr-01') && set.has('tr-79') && set.has('tr-81') && set.size === 3;
    });
    expect(ok).toBe(true);
  });
});
