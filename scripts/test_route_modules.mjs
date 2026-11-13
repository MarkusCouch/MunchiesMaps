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
