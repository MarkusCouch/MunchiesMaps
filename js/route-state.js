/*
 * POI identity and route backup format (pure functions, no DOM / Leaflet).
 * Browser: window.MunchiesRouteState · Node: module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MunchiesRouteState = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BACKUP_TYPE = 'munchies-route-backup';
  var BACKUP_SCHEMA_VERSION = 1;
  var MAX_ID_LIST_LENGTH = 50000;
  var MAX_ID_LENGTH = 300;
  var MAX_GPX_LENGTH = 50 * 1024 * 1024;

  /**
   * Stable POI id used for hidden/favorite state, e.g. "de-bb__shelters-shelters-w-1065858668".
   * Format: <datasetKey>-<category>-<n|w|r|u>-<osm id>, or coordinates when no id exists.
   */
  function getPoiStableId(feature, datasetKey) {
    if (!feature || !datasetKey) return null;
    var props = feature.properties || {};
    var osmType = String(props.osm_type || '').trim().toLowerCase();
    var typePrefix = (osmType === 'node' || osmType === 'way' || osmType === 'relation') ? osmType[0] : 'u';
    var categoryToken = String(props.categoryID || props.categoryId || props.category || 'uncat').trim();
    var candidates = [props.id, props.osm_id, feature.id, props['@id']];
    var stableSource = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var value = candidates[i];
      if (value !== undefined && value !== null && String(value).trim() !== '') { stableSource = value; break; }
    }
    if (stableSource != null) return datasetKey + '-' + categoryToken + '-' + typePrefix + '-' + String(stableSource);
    var coords = (feature.geometry && feature.geometry.coordinates) || [];
    var lon = Number(coords[0]);
    var lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return datasetKey + '-' + categoryToken + '-' + typePrefix + '-' + lon.toFixed(6) + '-' + lat.toFixed(6);
  }

  function sanitizeIdList(list) {
    if (!Array.isArray(list)) return [];
    var seen = new Set();
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX_ID_LIST_LENGTH; i += 1) {
      var value = list[i];
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      var id = String(value).trim();
      if (!id || id.length > MAX_ID_LENGTH || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  /** Minimal record of a hidden POI so "Show hidden" can still render it after a restore. */
  function buildHiddenPoiSnapshot(point) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
    var props = point.propsRef || {};
    return {
      id: point.id,
      lat: point.lat,
      lng: point.lng,
      categoryId: point.categoryId || null,
      name: props.name || null,
      osm_type: props.osm_type || null,
      osm_id: props.osm_id || props.id || point.id || null,
      properties: props
    };
  }

  /** Build the JSON backup payload of a route session. Returns null without route data. */
  function createRouteBackup(input) {
    var data = input || {};
    var gpxRaw = typeof data.gpxRaw === 'string' ? data.gpxRaw.trim() : '';
    if (!gpxRaw) return null;
    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      app: 'Munchies Maps',
      type: BACKUP_TYPE,
      createdAt: (data.now instanceof Date ? data.now : new Date()).toISOString(),
      routeHash: data.routeHash || null,
      gpxRaw: gpxRaw,
      radiusMeters: data.radiusMeters || null,
      hiddenPoiIds: sanitizeIdList(data.hiddenPoiIds),
      hiddenPoiSnapshots: Array.isArray(data.hiddenPoiSnapshots) ? data.hiddenPoiSnapshots.filter(Boolean) : [],
      selectedCategories: sanitizeIdList(data.selectedCategories),
      selectedRegions: sanitizeIdList(data.selectedRegions),
      favoritePoiIds: sanitizeIdList(data.favoritePoiIds),
      activeRouteSource: data.activeRouteSource || null
    };
  }

  /**
   * Parse and validate backup JSON text (or an already parsed object).
   * Returns { ok: true, backup } with sanitized fields, or { ok: false, error }.
   * error: 'invalid-json' | 'invalid-backup' | 'missing-route' | 'route-too-large'
   */
  function parseRouteBackup(input) {
    var raw = input;
    if (typeof input === 'string') {
      try { raw = JSON.parse(input); } catch (_) { return { ok: false, error: 'invalid-json' }; }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid-backup' };
    if (!raw.schemaVersion || (raw.type && raw.type !== BACKUP_TYPE)) return { ok: false, error: 'invalid-backup' };
    if (typeof raw.gpxRaw !== 'string' || !raw.gpxRaw.trim()) return { ok: false, error: 'missing-route' };
    if (raw.gpxRaw.length > MAX_GPX_LENGTH) return { ok: false, error: 'route-too-large' };
    var radius = Number(raw.radiusMeters);
    return {
      ok: true,
      backup: {
        schemaVersion: raw.schemaVersion,
        gpxRaw: raw.gpxRaw,
        radiusMeters: Number.isFinite(radius) && radius > 0 ? radius : null,
        hiddenPoiIds: sanitizeIdList(raw.hiddenPoiIds),
        favoritePoiIds: sanitizeIdList(raw.favoritePoiIds),
        selectedCategories: Array.isArray(raw.selectedCategories) ? sanitizeIdList(raw.selectedCategories) : null,
        selectedRegions: Array.isArray(raw.selectedRegions) ? sanitizeIdList(raw.selectedRegions) : null
      }
    };
  }

  return {
    BACKUP_TYPE: BACKUP_TYPE,
    BACKUP_SCHEMA_VERSION: BACKUP_SCHEMA_VERSION,
    getPoiStableId: getPoiStableId,
    sanitizeIdList: sanitizeIdList,
    buildHiddenPoiSnapshot: buildHiddenPoiSnapshot,
    createRouteBackup: createRouteBackup,
    parseRouteBackup: parseRouteBackup
  };
}));
