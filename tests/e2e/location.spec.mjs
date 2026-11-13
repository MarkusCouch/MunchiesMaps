import { test, expect } from '@playwright/test';
import { openApp } from './helpers.mjs';

test('locate button recovers when iOS reports "location unknown" before GPS is ready', async ({ page }) => {
  await page.addInitScript(() => {
    const unknown = { code: 2, message: 'The operation couldn’t be completed. (kCLErrorDomain error 0.)' };
    const fix = { coords: { latitude: 52.52, longitude: 13.405, accuracy: 15 }, timestamp: Date.now() };
    const geo = {
      getCurrentPosition: (ok, fail) => setTimeout(() => fail(unknown), 10),
      watchPosition: (ok, fail) => {
        setTimeout(() => fail(unknown), 10);
        const id = setTimeout(() => ok(fix), 600);
        return id;
      },
      clearWatch: (id) => clearTimeout(id)
    };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  });
  await openApp(page);
  await page.click('#locateButton');
  await expect(page.locator('#mapToast')).toHaveText('Live location found.', { timeout: 10_000 });
  const center = await page.evaluate(() => map.getCenter());
  expect(Math.abs(center.lat - 52.52)).toBeLessThan(0.01);
  expect(Math.abs(center.lng - 13.405)).toBeLessThan(0.01);
});

test('locate button falls back to the last known position', async ({ page }) => {
  await page.addInitScript(() => {
    const unknown = { code: 2, message: 'kCLErrorDomain error 0' };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok, fail) => setTimeout(() => fail(unknown), 10),
        watchPosition: (ok, fail) => { setTimeout(() => fail(unknown), 10); return 1; },
        clearWatch: () => {}
      }
    });
    localStorage.setItem('munchiesmaps.lastKnownLocation', JSON.stringify({ lat: 48.137, lng: 11.575, accuracy: 30, timestamp: Date.now() }));
  });
  await page.addInitScript(() => { window.__mmLocationWatchTimeoutMs = 800; });
  await openApp(page);
  await page.click('#locateButton');
  await expect(page.locator('#mapToast')).toContainText('Showing last known position', { timeout: 10_000 });
});
