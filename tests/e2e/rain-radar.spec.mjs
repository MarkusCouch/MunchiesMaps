import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import { openApp } from './helpers.mjs';

// Builds a 256x256 RGBA PNG filled with one colour (RainViewer palette value).
function solidPng(r, g, b, a = 255) {
  const size = 256;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) raw.set([r, g, b, a], row + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

async function mockRainViewer(page) {
  const tileRequests = [];
  const now = Math.floor(Date.now() / 1000);
  await page.context().route('https://api.rainviewer.com/public/weather-maps.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [{ time: now - 600, path: '/v2/radar/a' }, { time: now, path: '/v2/radar/b' }] }
    })
  }));
  // 0x00a3e0 = 20 dBZ in the Universal Blue palette -> Rainy's "moderate" cyan class.
  const png = solidPng(0x00, 0xa3, 0xe0);
  await page.context().route(/tilecache\.rainviewer\.com/, (route) => {
    tileRequests.push(route.request().url());
    route.fulfill({ contentType: 'image/png', body: png });
  });
  return tileRequests;
}

test('rain cloud button toggles the Rainy radar overlay', async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const tileRequests = await mockRainViewer(page);
  await openApp(page);

  const button = page.locator('#rainRadarBtn');
  // The cloud sits above the other controls in the bottom-right stack.
  const order = await page.evaluate(() => Array.from(document.querySelector('.map-controls-br').children).map((el) => el.id || el.className));
  expect(order[0]).toBe('rainRadarBtn');

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rainRadarLegend')).toBeVisible();
  await expect(page.locator('#rainRadarTime')).toHaveText(/·\s\d{1,2}:\d{2}/);
  await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
  expect(tileRequests[0]).toMatch(/\/v2\/radar\/b\/256\/\d+\/\d+\/\d+\/2\/0_0\.png$/);

  // Tiles are recoloured into Rainy's palette (moderate = rgb(40,207,214), alpha 202).
  // Canvas stores premultiplied alpha, so allow ±2 rounding per channel.
  const expected = [40, 207, 214, 202];
  await expect.poll(() => page.evaluate((exp) => {
    const canvas = document.querySelector('.rain-radar-tile');
    if (!canvas) return false;
    const px = canvas.getContext('2d').getImageData(128, 128, 1, 1).data;
    return exp.every((v, i) => Math.abs(px[i] - v) <= 2);
  }, expected)).toBe(true);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#rainRadarLegend')).toBeHidden();
  await expect(page.locator('.rain-radar-tile')).toHaveCount(0);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test('rain radar shows a message when RainViewer is unreachable', async ({ page }) => {
  await page.context().route(/rainviewer\.com/, (route) => route.abort());
  await openApp(page);
  await page.click('#rainRadarBtn');
  await expect(page.locator('#mapToast')).toContainText('Rain radar');
  await expect(page.locator('#rainRadarBtn')).toHaveAttribute('aria-pressed', 'false');
});

async function mockRadarAndWind(page, { windFrom = 270, windKmh = 30, analysisStatus = 200 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  await page.context().route('https://api.rainviewer.com/public/weather-maps.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [
        { time: now - 1200, path: '/v2/radar/a' },
        { time: now - 600, path: '/v2/radar/b' },
        { time: now, path: '/v2/radar/c' }
      ] }
    })
  }));
  // No rain anywhere -> Rainy falls back to the modelled wind at 700 hPa.
  const empty = solidPng(0, 0, 0, 0);
  await page.context().route(/tilecache\.rainviewer\.com/, (route) => {
    const isAnalysis = /\/512\/7\//.test(route.request().url());
    if (isAnalysis && analysisStatus !== 200) return route.fulfill({ status: analysisStatus, body: '' });
    return route.fulfill({ contentType: 'image/png', body: empty });
  });
  const windRequests = [];
  await page.context().route(/api\.open-meteo\.com/, (route) => {
    windRequests.push(route.request().url());
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ hourly: { time: [now], wind_speed_700hPa: [windKmh], wind_direction_700hPa: [windFrom] } })
    });
  });
  return windRequests;
}

function mockGeolocation(page, lat, lng) {
  return page.addInitScript(([la, ln]) => {
    const fix = { coords: { latitude: la, longitude: ln, accuracy: 20 }, timestamp: Date.now() };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok) => setTimeout(() => ok(fix), 20),
        watchPosition: (ok) => { setTimeout(() => ok(fix), 20); return 1; },
        clearWatch: () => {}
      }
    });
  }, [lat, lng]);
}

test('rain button matches the other controls in size', async ({ page }) => {
  await openApp(page);
  const rain = await page.locator('#rainRadarBtn').boundingBox();
  const locate = await page.locator('#locateButton').boundingBox();
  expect(Math.round(rain.width)).toBe(Math.round(locate.width));
  expect(Math.round(rain.height)).toBe(Math.round(locate.height));
});

test('rain mode hides POIs, shows the +4 h direction arrow and zooms to it', async ({ page }) => {
  await mockGeolocation(page, 52.52, 13.405);
  const windRequests = await mockRadarAndWind(page, { windFrom: 270, windKmh: 30 });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await openApp(page);
  await page.evaluate(() => map.setView([52.52, 13.405], 14, { animate: false }));
  await expect.poll(() => page.locator('.mm-marker-wrap, .marker-cluster').count()).toBeGreaterThan(0);
  const viewBefore = await page.evaluate(() => ({ zoom: map.getZoom() }));

  await page.click('#rainRadarBtn');

  // POIs are hidden.
  await expect(page.locator('#map')).toHaveClass(/rain-mode/);
  await expect(page.locator('.mm-marker-wrap:visible, .marker-cluster:visible')).toHaveCount(0);

  // Arrow tip + four hourly markers; wind fallback is labelled.
  await expect(page.locator('.rain-motion-tip')).toHaveCount(1);
  await expect(page.locator('.rain-motion-marker')).toHaveCount(4);
  await expect(page.locator('.rain-motion-marker b').last()).toContainText('+4 h');
  await expect(page.locator('.rain-motion-source')).toHaveText('wind aloft');
  await expect(page.locator('#rainRadarMotion')).toContainText('toward E · 30 km/h');
  expect(windRequests[0]).toContain('latitude=52.5200');

  // Map is zoomed out to show the whole 4 h arrow (120 km to the west of Berlin).
  await expect.poll(() => page.evaluate(() => map.getZoom())).toBeLessThan(viewBefore.zoom);
  const fits = await page.evaluate(() => {
    const bounds = map.getBounds();
    const p4 = MunchiesRainMotion.computeTimelineGeometry({ lat: 52.52, lng: 13.405 }, 90, 30).point4;
    return bounds.contains([52.52, 13.405]) && bounds.contains([p4.lat, p4.lng]) && p4.lng < 13.405;
  });
  expect(fits).toBe(true);

  // Switching off restores POIs and the previous view.
  await page.click('#rainRadarBtn');
  await expect(page.locator('#map')).not.toHaveClass(/rain-mode/);
  await expect(page.locator('.rain-motion-tip')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => map.getZoom())).toBe(viewBefore.zoom);
  await expect.poll(() => page.locator('.mm-marker-wrap:visible, .marker-cluster:visible').count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test('rain mode also hides POI clusters', async ({ page }) => {
  await mockGeolocation(page, 52.52, 13.405);
  await mockRadarAndWind(page);
  await openApp(page);
  // Force clustering: a low threshold at a zoom with many POIs.
  await page.evaluate(() => {
    localStorage.setItem('clusterThreshold', '1');
    const input = document.getElementById('clusterThresholdInput');
    input.value = '1';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    map.setView([52.52, 13.405], 13, { animate: false });
  });
  await expect.poll(() => page.locator('.cluster-icon-wrap').count()).toBeGreaterThan(0);

  await page.click('#rainRadarBtn');
  await expect(page.locator('#map')).toHaveClass(/rain-mode/);
  await expect(page.locator('.cluster-icon-wrap:visible, .mm-marker-wrap:visible')).toHaveCount(0);

  await page.click('#rainRadarBtn');
  await expect.poll(() => page.locator('.cluster-icon-wrap:visible, .mm-marker-wrap:visible').count()).toBeGreaterThan(0);
});

test('arrow is shown even when radar images around the position are unavailable', async ({ page }) => {
  await mockGeolocation(page, 52.52, 13.405);
  await mockRadarAndWind(page, { windFrom: 0, windKmh: 20, analysisStatus: 404 });
  await openApp(page);
  await page.click('#rainRadarBtn');
  await expect(page.locator('.rain-motion-tip')).toHaveCount(1);
  await expect(page.locator('#rainRadarMotion')).toContainText('toward S · 20 km/h');
});

test('app CSS/JS references carry the current BUILD_ID', async ({ page, request }) => {
  const sw = await (await request.get('sw.js')).text();
  const buildId = sw.match(/const BUILD_ID = '([^']+)'/)[1];
  await openApp(page);
  const refs = await page.evaluate(() => [
    ...Array.from(document.querySelectorAll('link[rel="stylesheet"][href*="css/"]'), (el) => el.getAttribute('href')),
    ...Array.from(document.querySelectorAll('script[src*="js/"]'), (el) => el.getAttribute('src'))
  ].filter((ref) => ref.startsWith('./css/') || ref.startsWith('./js/')));
  expect(refs.length).toBeGreaterThan(5);
  for (const ref of refs) expect(ref).toContain(`?v=${buildId}`);
});

test('no error text when wind data fails; the arrow appears once wind aloft is reachable', async ({ page }) => {
  await mockGeolocation(page, 52.52, 13.405);
  await mockRadarAndWind(page, { analysisStatus: 404 });
  // First two wind requests fail (pipeline + direct fallback), later ones succeed.
  let windCalls = 0;
  const now = Math.floor(Date.now() / 1000);
  await page.context().unroute(/api\.open-meteo\.com/);
  await page.context().route(/api\.open-meteo\.com/, (route) => {
    windCalls += 1;
    if (windCalls <= 2) return route.abort();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ hourly: { time: [now], wind_speed_700hPa: [25], wind_direction_700hPa: [90] } })
    });
  });
  await page.addInitScript(() => { window.__mmMotionRetryMs = 500; });
  await openApp(page);
  await page.click('#rainRadarBtn');

  await expect.poll(() => windCalls).toBeGreaterThanOrEqual(2);
  // While no data is available: no error message, just the radar.
  await expect(page.locator('#rainRadarMotion')).toBeHidden();

  // Retry picks up the wind aloft.
  await expect(page.locator('.rain-motion-tip')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#rainRadarMotion')).toContainText('Wind aloft (≈3 km) toward W · 25 km/h');
});
