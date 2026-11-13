import { test, expect } from '@playwright/test';
import { openApp } from './helpers.mjs';

function trackAnalyticsRequests(page) {
  const requests = [];
  page.on('request', (req) => {
    if (/googletagmanager\.com|google-analytics\.com/.test(req.url())) requests.push(req.url());
  });
  return requests;
}

test('analytics is not loaded before consent and banner offers a choice', async ({ page }) => {
  const requests = trackAnalyticsRequests(page);
  await openApp(page, { consent: null });
  await expect(page.locator('#consentBanner')).toBeVisible();
  await expect(page.locator('#consentBanner a[href$="privacy.html"]')).toBeVisible();
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
});

test('declining hides the banner and keeps analytics off after reload', async ({ page }) => {
  const requests = trackAnalyticsRequests(page);
  await openApp(page, { consent: null });
  await page.click('#consentBanner [data-consent="denied"]');
  await expect(page.locator('#consentBanner')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('munchiesAnalyticsConsent'))).toBe('denied');
  await page.reload();
  await expect(page.locator('#map .leaflet-pane').first()).toBeAttached();
  await page.waitForTimeout(300);
  await expect(page.locator('#consentBanner')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('allowing analytics loads gtag; privacy settings can reopen the banner', async ({ page }) => {
  const requests = trackAnalyticsRequests(page);
  await openApp(page, { consent: null });
  await page.click('#consentBanner [data-consent="granted"]');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.locator('#consentBanner')).toHaveCount(0);

  await page.click('#layerDrawerToggle');
  await page.click('#privacySettingsBtn');
  await expect(page.locator('#consentBanner')).toBeVisible();
});

test('legal pages are reachable', async ({ page }) => {
  for (const path of ['legal/imprint.html', 'legal/privacy.html']) {
    const res = await page.goto(path);
    expect(res.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
  }
});
