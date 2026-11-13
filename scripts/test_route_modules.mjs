import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RouteState = require('../js/route-state.js');
const Gpx = require('../js/gpx-utils.js');

// --- POI ids -------------------------------------------------------------
assert.equal(
  RouteState.getPoiStableId({ properties: { osm_type: 'way', id: 1065858668, categoryId: 'shelters' } }, 'de-bb__shelters'),
  'de-bb__shelters-shelters-w-1065858668'
);
assert.equal(
  RouteState.getPoiStableId({ properties: { categoryId: 'fuel' }, geometry: { coordinates: [13.4, 52.5] } }, 'de-be__fuel'),
  'de-be__fuel-fuel-u-13.400000-52.500000'
);
assert.equal(RouteState.getPoiStableId({ properties: {} }, ''), null);
assert.equal(RouteState.getPoiStableId({ properties: {}, geometry: { coordinates: ['x', 1] } }, 'k'), null);

// --- id list sanitizing --------------------------------------------------
assert.deepEqual(RouteState.sanitizeIdList(['a', ' a ', 'b', '', null, { x: 1 }, 7, 'x'.repeat(301)]), ['a', 'b', '7']);
assert.deepEqual(RouteState.sanitizeIdList('nope'), []);

// --- backup roundtrip ----------------------------------------------------
const gpx = '<gpx><trk><trkseg><trkpt lat="52.5" lon="13.4"/><trkpt lat="52.6" lon="13.5"/></trkseg></trk></gpx>';
assert.equal(RouteState.createRouteBackup({ gpxRaw: '   ' }), null);
const backup = RouteState.createRouteBackup({
  gpxRaw: gpx,
  radiusMeters: 300,
  hiddenPoiIds: ['h1', 'h1'],
  hiddenPoiSnapshots: [RouteState.buildHiddenPoiSnapshot({ id: 'h1', lat: 1, lng: 2, categoryId: 'fuel', propsRef: { name: 'X' } }), null],
  favoritePoiIds: ['f1'],
  selectedCategories: ['fuel'],
  selectedRegions: ['de-be'],
  activeRouteSource: 'new-gpx-import',
  now: new Date('2026-11-13T10:00:00Z')
});
assert.equal(backup.type, RouteState.BACKUP_TYPE);
assert.equal(backup.createdAt, '2026-11-13T10:00:00.000Z');
assert.deepEqual(backup.hiddenPoiIds, ['h1']);
assert.equal(backup.hiddenPoiSnapshots.length, 1);
assert.equal(backup.hiddenPoiSnapshots[0].name, 'X');

const parsed = RouteState.parseRouteBackup(JSON.stringify(backup));
assert.equal(parsed.ok, true);
assert.equal(parsed.backup.gpxRaw, gpx);
assert.deepEqual(parsed.backup.favoritePoiIds, ['f1']);
assert.deepEqual(parsed.backup.selectedRegions, ['de-be']);
assert.equal(parsed.backup.radiusMeters, 300);

// Older backups without type / selections still load.
const legacy = RouteState.parseRouteBackup({ schemaVersion: 1, gpxRaw: gpx, hiddenPoiIds: ['a'] });
assert.equal(legacy.ok, true);
assert.equal(legacy.backup.selectedCategories, null);
assert.deepEqual(legacy.backup.favoritePoiIds, []);

// Invalid inputs.
assert.deepEqual(RouteState.parseRouteBackup('{not json'), { ok: false, error: 'invalid-json' });
assert.deepEqual(RouteState.parseRouteBackup('[]'), { ok: false, error: 'invalid-backup' });
assert.deepEqual(RouteState.parseRouteBackup({ schemaVersion: 1, type: 'other', gpxRaw: gpx }), { ok: false, error: 'invalid-backup' });
assert.deepEqual(RouteState.parseRouteBackup({ schemaVersion: 1, gpxRaw: '' }), { ok: false, error: 'missing-route' });
assert.equal(RouteState.parseRouteBackup({ schemaVersion: 1, gpxRaw: gpx, radiusMeters: -5 }).backup.radiusMeters, null);

// --- GPX helpers (DOM-free parts) ---------------------------------------
assert.equal(Gpx.getBaseKmMarkerIntervalForZoom(16), 1);
assert.equal(Gpx.getBaseKmMarkerIntervalForZoom(12), 10);
assert.equal(Gpx.getBaseKmMarkerIntervalForZoom(undefined), 10);
assert.equal(Gpx.getKmMarkerIntervalForZoom(15, 50), 1);
// 600 km visible at zoom 15 would need 600 markers -> next interval within the cap.
assert.equal(Gpx.getKmMarkerIntervalForZoom(15, 600), 5);
assert.equal(Gpx.parseGpxText('<gpx/>', { DOMParser: null }).points.length, 0);
assert.equal(Gpx.buildGpxGeoJson(null), null);

console.log('route module tests passed');

// --- Rain radar palette (ported from Rainy) ------------------------------
const Rain = require('../js/rain-radar.js');
assert.equal(Rain.rgbToDbz(0x00, 0xa3, 0xe0, 255), 20);
assert.equal(Rain.rgbToDbz(0x00, 0xa3, 0xe0, 0), null);
assert.equal(Rain.rgbToDbz(1, 2, 3, 255), null);
assert.equal(Rain.radarClassForDbz(5).name, 'very light');
assert.equal(Rain.radarClassForDbz(20).name, 'moderate');
assert.equal(Rain.radarClassForDbz(60).name, 'very heavy');
const px = [0x00, 0xa3, 0xe0, 255, 1, 2, 3, 255];
Rain.recolorPixels(px);
assert.deepEqual(px, [40, 207, 214, 202, 1, 2, 3, 0]);
assert.equal(
  Rain.radarTileUrl('https://tilecache.rainviewer.com', { path: '/v2/radar/x' }, { z: 6, x: 33, y: 21 }),
  'https://tilecache.rainviewer.com/v2/radar/x/256/6/33/21/2/0_0.png'
);
console.log('rain radar palette tests passed');

// --- Rain motion (ported from Rainy's tests) -----------------------------
const Motion = require('../js/rain-motion.js');
{
  const width = 40; const height = 40;
  const first = new Int16Array(width * height).fill(-999);
  const second = new Int16Array(width * height).fill(-999);
  for (let y = 10; y < 17; y += 1) {
    for (let x = 11; x < 19; x += 1) {
      first[y * width + x] = 30 + ((x + y) % 8);
      second[(y + 2) * width + x + 3] = 30 + ((x + y) % 8);
    }
  }
  const shift = Motion.estimateShift(first, second, width, height, 8, 15);
  assert.ok(Math.abs(shift.dx - 3) < 0.55 && Math.abs(shift.dy - 2) < 0.55 && shift.score > 0.95);
}
{
  const position = { lat: 48.137, lng: 11.575 };
  const g = Motion.computeTimelineGeometry(position, 120, 30);
  for (let h = 1; h <= 4; h += 1) assert.ok(Math.abs(Motion.haversineKm(position, g[`point${h}`]) - 30 * h) < 0.2);
  assert.equal(g.distance4, 120);
}
{
  const now = 1_800_000_000;
  const response = (speed = 30, direction = 270, time = now) => ({ hourly: { time: [time], wind_speed_700hPa: [speed], wind_direction_700hPa: [direction] } });
  const wind = await Motion.chooseDisplayMotion({ ok: false, reason: 'not-enough-rain' }, {}, async () => Motion.windMotionFromResponse(response(), now));
  assert.equal(wind.source, 'wind');
  assert.equal(wind.bearing, 90); // wind from west travels east
  const position = { lat: 51.05, lng: 13.74 };
  assert.ok(Motion.computeTimelineGeometry(position, wind.bearing, wind.speedKmh).point4.lng < position.lng);
  const radar = { ok: true, speedKmh: 25, bearing: 120 };
  const mustNotFetch = () => { throw new Error('must not fetch'); };
  assert.equal(await Motion.chooseDisplayMotion(radar, {}, mustNotFetch), radar);
  assert.equal(await Motion.chooseDisplayMotion({ ok: false, reason: 'inconsistent' }, {}, mustNotFetch), null);
  for (const data of [{}, response(null), response(0), response(30, null), response(30, 270, now - 7200)]) {
    assert.equal(Motion.windMotionFromResponse(data, now), null);
  }
  assert.equal(await Motion.chooseDisplayMotion({ ok: false, reason: 'not-enough-rain' }, {}, async () => { throw new Error('offline'); }), null);
}
{
  // Full pipeline: a rain blob moving east by 2 px (512 px tiles, zoom 7) per 10 min frame.
  const size = 512;
  const blob = (offset) => {
    const values = new Int16Array(size * size).fill(-999);
    for (let y = 200; y < 300; y += 1) for (let x = 150 + offset; x < 260 + offset; x += 1) values[y * size + x] = 25 + ((x * 7 + y * 3) % 15);
    return { values, width: size, height: size };
  };
  const now = 1_800_000_000;
  const meta = { host: 'h', frames: [{ time: now - 1200, path: '/a' }, { time: now - 600, path: '/b' }, { time: now, path: '/c' }] };
  const fields = { '/a': blob(0), '/b': blob(8), '/c': blob(16) };
  const result = await Motion.computeDisplayMotion({ lat: 52.5, lng: 13.4 }, meta, {
    loadField: async (host, frame) => fields[frame.path],
    loadWind: () => { throw new Error('wind must not be used when radar motion is clear'); }
  });
  assert.equal(result.motion.source, 'radar');
  assert.ok(Math.abs(result.motion.bearing - 90) < 10, `bearing ${result.motion.bearing}`);
  assert.ok(result.motion.speedKmh > 5 && result.motion.speedKmh < 140);
  assert.ok(result.geometry.point4.lng < 13.4);
}
console.log('rain motion tests passed');
