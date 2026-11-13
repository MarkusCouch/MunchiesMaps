/*
 * GPX parsing helpers (no Leaflet dependency).
 * Browser: window.MunchiesGpx · Node: module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MunchiesGpx = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KM_MARKER_INTERVALS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
  var MAX_KM_MARKERS = 120;

  function getElementsByLocalName(xml, name) {
    var byNs = xml.getElementsByTagNameNS ? xml.getElementsByTagNameNS('*', name) : [];
    if (byNs && byNs.length) return Array.from(byNs);
    return Array.from(xml.getElementsByTagName(name));
  }

  function readLatLon(el) {
    var lat = parseFloat(el.getAttribute('lat'));
    var lon = parseFloat(el.getAttribute('lon'));
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: lat, lon: lon } : null;
  }

  /**
   * Parse GPX text. Returns { points: [{lat, lon}], xml } – points are taken from
   * track points, falling back to route points and then waypoints.
   */
  function parseGpxText(text, options) {
    var Parser = (options && options.DOMParser) || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!Parser) return { points: [], xml: null };
    try {
      var xml = new Parser().parseFromString(String(text || ''), 'application/xml');
      if (xml.getElementsByTagName('parsererror').length) return { points: [], xml: null };
      var extract = function (tagName) {
        return getElementsByLocalName(xml, tagName).map(readLatLon).filter(Boolean);
      };
      var pts = extract('trkpt');
      if (!pts.length) pts = extract('rtept');
      if (!pts.length) pts = extract('wpt');
      return { points: pts, xml: xml };
    } catch (err) {
      if (typeof console !== 'undefined') console.error('GPX parse error', err);
      return { points: [], xml: null };
    }
  }

  /** Convert track segments (or a route) of a parsed GPX document to a GeoJSON FeatureCollection. */
  function buildGpxGeoJson(xmlDoc) {
    if (!xmlDoc) return null;
    var toCoords = function (nodes) {
      return Array.from(nodes).map(readLatLon).filter(Boolean).map(function (p) { return [p.lon, p.lat]; });
    };
    var line = function (coords) {
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
    };
    var features = [];
    getElementsByLocalName(xmlDoc, 'trkseg').forEach(function (seg) {
      var coords = toCoords(getElementsByLocalName(seg, 'trkpt'));
      if (coords.length >= 2) features.push(line(coords));
    });
    if (!features.length) {
      var rte = toCoords(getElementsByLocalName(xmlDoc, 'rtept'));
      if (rte.length >= 2) features.push(line(rte));
    }
    return { type: 'FeatureCollection', features: features };
  }

  function getBaseKmMarkerIntervalForZoom(zoom) {
    var z = Number.isFinite(zoom) ? zoom : 12;
    if (z >= 15) return 1;
    if (z >= 13) return 5;
    if (z >= 11) return 10;
    if (z >= 9) return 25;
    if (z >= 7) return 50;
    return 100;
  }

  function getKmMarkerIntervalForZoom(zoom, visibleRouteLengthKm) {
    var base = getBaseKmMarkerIntervalForZoom(zoom);
    for (var i = 0; i < KM_MARKER_INTERVALS.length; i += 1) {
      var candidate = KM_MARKER_INTERVALS[i];
      if (candidate < base) continue;
      if (!visibleRouteLengthKm || Math.ceil(visibleRouteLengthKm / candidate) <= MAX_KM_MARKERS) return candidate;
    }
    return KM_MARKER_INTERVALS[KM_MARKER_INTERVALS.length - 1];
  }

  return {
    KM_MARKER_INTERVALS: KM_MARKER_INTERVALS,
    MAX_KM_MARKERS: MAX_KM_MARKERS,
    getElementsByLocalName: getElementsByLocalName,
    parseGpxText: parseGpxText,
    buildGpxGeoJson: buildGpxGeoJson,
    getBaseKmMarkerIntervalForZoom: getBaseKmMarkerIntervalForZoom,
    getKmMarkerIntervalForZoom: getKmMarkerIntervalForZoom
  };
}));
