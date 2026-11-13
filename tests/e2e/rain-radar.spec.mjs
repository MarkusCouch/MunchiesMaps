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
