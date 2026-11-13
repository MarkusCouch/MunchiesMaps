import { test, expect } from '@playwright/test';
import { openApp, importGpx, openDrawerSection, getRouteState } from './helpers.mjs';

test('no Content Security Policy violations across the main features', async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  // Allow consent so GA is attempted as well (requests are aborted by openApp's routes).
  await openApp(page, { consent: 'granted' });
  await page.evaluate(() => map.setZoom(13));
  await importGpx(page);

  // Offline save with tiles (tile fetches are aborted, but CSP is checked before the network).
  await openDrawerSection(page, 'gpxBody');
  await page.selectOption('#offlineMapDetailSelect', 'basic');
  await page.click('#gpxSaveBtn');
  await expect.poll(async () => (await getRouteState(page)).routeSource, { timeout: 30_000 }).toBe('offline-route-package');

  // Exports (blob downloads).
  await Promise.all([page.waitForEvent('download'), page.click('#exportRouteBackupBtn')]);
  await Promise.all([page.waitForEvent('download'), page.click('#gpxExportBtn')]);

  // Dark mode tiles.
  await page.evaluate(() => { const t = document.getElementById('darkModeToggle'); t.click(); });

  // Feedback form (Google Apps Script endpoint).
  await page.context().route(/script\.google\.com/, (route) => route.fulfill({ status: 200, body: 'ok' }));
  await openDrawerSection(page, 'feedbackBody');
  await page.fill('#quickFeedbackMessage', 'CSP test message');
  await page.click('#quickFeedbackSend');
  await page.waitForTimeout(500);

  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});
