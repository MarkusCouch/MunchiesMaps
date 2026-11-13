/*
 * Rain motion arrow – ported from Rainy (github.com/MarkusCouch/Rainy, src/motion.js + src/wind.js).
 *
 * 1. The last three RainViewer frames around a position are compared (pattern matching)
 *    to measure where rain is moving and how fast.
 * 2. If there is too little rain to measure, the modelled wind at 700 hPa (≈3 km, Open-Meteo)
 *    is used instead and labelled as such.
 * 3. The timeline points +1 h … +4 h are placed on the upwind side: they show where rain that
 *    reaches the position in 1–4 h is now. This is a linear extrapolation, not a weather model.
 *
 * Browser: window.MunchiesRainMotion · Node (tests): module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rain-radar.js'));
  else root.MunchiesRainMotion = factory(root.MunchiesRainRadar);
}(typeof self !== 'undefined' ? self : this, function (RainRadar) {
  'use strict';

  var EARTH_RADIUS_KM = 6371.0088;
  var ANALYSIS_ZOOM = 7;
  var ANALYSIS_SIZE = 512;
  var OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

  // ---- Geometry ---------------------------------------------------------------------------

  function haversineKm(a, b) {
    var toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLon = (b.lng - a.lng) * toRad;
    var lat1 = a.lat * toRad;
    var lat2 = b.lat * toRad;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function destinationPoint(start, bearingDeg, distanceKm) {
    var angularDistance = distanceKm / EARTH_RADIUS_KM;
    var bearing = bearingDeg * Math.PI / 180;
    var lat1 = start.lat * Math.PI / 180;
    var lon1 = start.lng * Math.PI / 180;
    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
    var lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: lat2 * 180 / Math.PI, lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180 };
  }

  function bearingToCompass(bearing) {
    var directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return directions[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
  }

  function computeTimelineGeometry(position, movementBearing, speedKmh) {
    var sourceBearing = (movementBearing + 180) % 360;
    var geometry = { position: position, movementBearing: movementBearing, sourceBearing: sourceBearing };
    for (var hour = 1; hour <= 4; hour += 1) {
      geometry['distance' + hour] = speedKmh * hour;
      geometry['point' + hour] = destinationPoint(position, sourceBearing, speedKmh * hour);
    }
    geometry.tailPoint = destinationPoint(geometry.point4, sourceBearing, geometry.distance4 * 0.08);
    return geometry;
  }

  // ---- Radar motion analysis (unchanged algorithm from Rainy) ------------------------------

  function downsampleField(field, factor) {
    var f = factor || 4;
    var width = Math.floor(field.width / f);
    var height = Math.floor(field.height / f);
    var values = new Int16Array(width * height).fill(-999);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        var max = -999;
        for (var oy = 0; oy < f; oy += 1) {
          var row = (y * f + oy) * field.width;
          for (var ox = 0; ox < f; ox += 1) max = Math.max(max, field.values[row + x * f + ox]);
        }
        values[y * width + x] = max;
      }
    }
    return { values: values, width: width, height: height };
  }

  function intensity(dbz, minDbz) {
    if (dbz < minDbz) return 0;
    return Math.min(1, (dbz - minDbz + 4) / 34);
  }

  function scoreShift(a, b, width, height, dx, dy, minDbz) {
    var startX = Math.max(0, -dx);
    var endX = Math.min(width, width - dx);
    var startY = Math.max(0, -dy);
    var endY = Math.min(height, height - dy);
    var overlap = 0;
    var union = 0;
    var active = 0;
    for (var y = startY; y < endY; y += 1) {
      var rowA = y * width;
      var rowB = (y + dy) * width;
      for (var x = startX; x < endX; x += 1) {
        var valueA = intensity(a[rowA + x], minDbz);
        var valueB = intensity(b[rowB + x + dx], minDbz);
        if (valueA === 0 && valueB === 0) continue;
        active += 1;
        overlap += Math.min(valueA, valueB);
        union += Math.max(valueA, valueB);
      }
    }
    if (active < 10 || union === 0) return -Infinity;
    return overlap / union;
  }

  function refineAxis(center, minus, plus) {
    var denominator = minus - (2 * center) + plus;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) return 0;
    return Math.max(-0.5, Math.min(0.5, 0.5 * (minus - plus) / denominator));
  }

  function estimateShift(fieldA, fieldB, width, height, maxShift, minDbz) {
    var min = minDbz === undefined ? 15 : minDbz;
    var best = { dx: 0, dy: 0, score: -Infinity };
    for (var dy = -maxShift; dy <= maxShift; dy += 1) {
      for (var dx = -maxShift; dx <= maxShift; dx += 1) {
        var score = scoreShift(fieldA, fieldB, width, height, dx, dy, min);
        if (score > best.score) best = { dx: dx, dy: dy, score: score };
      }
    }
    if (!Number.isFinite(best.score)) return null;
    if (Math.abs(best.dx) < maxShift) {
      best.dx += refineAxis(best.score,
        scoreShift(fieldA, fieldB, width, height, best.dx - 1, best.dy, min),
        scoreShift(fieldA, fieldB, width, height, best.dx + 1, best.dy, min));
    }
    if (Math.abs(best.dy) < maxShift) {
      best.dy += refineAxis(best.score,
        scoreShift(fieldA, fieldB, width, height, Math.round(best.dx), best.dy - 1, min),
        scoreShift(fieldA, fieldB, width, height, Math.round(best.dx), best.dy + 1, min));
    }
    return best;
  }

  function angleDifference(a, b) {
    var delta = Math.abs(a - b) % 360;
    return Math.min(delta, 360 - delta);
  }

  function countRain(values, minDbz) {
    var count = 0;
    for (var i = 0; i < values.length; i += 1) if (values[i] >= minDbz) count += 1;
    return count;
  }

  function analyzeMotion(rawFields, options) {
    var o = options || {};
    var zoom = o.zoom || ANALYSIS_ZOOM;
    var tileSize = o.tileSize || ANALYSIS_SIZE;
    var factor = o.factor || 4;
    var minDbz = o.minDbz === undefined ? 15 : o.minDbz;
    var minSpeed = o.minSpeed === undefined ? 5 : o.minSpeed;
    var maxSpeed = o.maxSpeed || 140;
    var frameTimes = o.frameTimes || [];

    if (rawFields.length < 3 || frameTimes.length < 3) return { ok: false, reason: 'frames' };

    var fields = rawFields.map(function (field) { return downsampleField(field, factor); });
    var lastRainCells = countRain(fields[fields.length - 1].values, minDbz);
    if (lastRainCells < 12) return { ok: false, reason: 'not-enough-rain', rainCells: lastRainCells };

    var metersPerPixel = Math.cos(o.latitude * Math.PI / 180) * 2 * Math.PI * 6378137 / (tileSize * Math.pow(2, zoom));
    var cellKm = metersPerPixel * factor / 1000;
    var vectors = [];

    for (var index = 0; index < 2; index += 1) {
      var dtHours = (frameTimes[index + 1] - frameTimes[index]) / 3600;
      if (!(dtHours > 0 && dtHours <= 0.5)) return { ok: false, reason: 'frames' };
      var maxShift = Math.min(18, Math.max(3, Math.ceil(maxSpeed * dtHours / cellKm) + 1));
      var shift = estimateShift(fields[index].values, fields[index + 1].values, fields[index].width, fields[index].height, maxShift, minDbz);
      if (!shift || shift.score < 0.24) return { ok: false, reason: 'low-correlation', score: shift ? shift.score : 0 };
      var eastKmh = shift.dx * cellKm / dtHours;
      var southKmh = shift.dy * cellKm / dtHours;
      vectors.push({
        eastKmh: eastKmh,
        southKmh: southKmh,
        speedKmh: Math.hypot(eastKmh, southKmh),
        bearing: (Math.atan2(eastKmh, -southKmh) * 180 / Math.PI + 360) % 360,
        score: shift.score
      });
    }

    var angleDelta = angleDifference(vectors[0].bearing, vectors[1].bearing);
    var speedDelta = Math.abs(vectors[0].speedKmh - vectors[1].speedKmh);
    if (angleDelta > 65 || speedDelta > Math.max(38, Math.min(vectors[0].speedKmh, vectors[1].speedKmh) * 1.8)) {
      return { ok: false, reason: 'inconsistent', angleDelta: angleDelta, speedDelta: speedDelta };
    }

    var totalWeight = vectors[0].score + vectors[1].score;
    var east = (vectors[0].eastKmh * vectors[0].score + vectors[1].eastKmh * vectors[1].score) / totalWeight;
    var south = (vectors[0].southKmh * vectors[0].score + vectors[1].southKmh * vectors[1].score) / totalWeight;
    var speedKmh = Math.hypot(east, south);
    var bearing = (Math.atan2(east, -south) * 180 / Math.PI + 360) % 360;
    if (speedKmh < minSpeed || speedKmh > maxSpeed) return { ok: false, reason: 'speed-range', speedKmh: speedKmh };

    var correlation = totalWeight / 2;
    var consistency = Math.max(0, 1 - angleDelta / 65) * Math.max(0, 1 - speedDelta / 100);
    var rainCoverage = Math.min(1, lastRainCells / 70);
    return {
      ok: true,
      source: 'radar',
      speedKmh: speedKmh,
      bearing: bearing,
      confidence: Math.max(0, Math.min(1, 0.2 + correlation * 0.55 + consistency * 0.2 + rainCoverage * 0.05)),
      rainCells: lastRainCells
    };
  }

  // ---- Wind fallback ------------------------------------------------------------------------

  // A labelled display fallback only: model wind is never fed into a rain forecast.
  // Prefers wind at 700 hPa (≈3 km, steers rain cells, as in Rainy); falls back to 10 m wind.
  // Returns { ok: true, source, speedKmh, bearing }, { ok: false, reason: 'calm' } or null.
  function windMotionFromResponse(data, nowSeconds) {
    var now = nowSeconds === undefined ? Date.now() / 1000 : nowSeconds;
    var hourly = data && data.hourly;
    var times = (hourly && hourly.time) || [];
    var index = -1;
    var bestDelta = Infinity;
    for (var i = 0; i < times.length; i += 1) {
      var delta = Math.abs(now - times[i]);
      if (Number.isFinite(times[i]) && delta < bestDelta) { bestDelta = delta; index = i; }
    }
    if (index < 0 || bestDelta > 90 * 60) return null;
    var levels = [
      ['wind', 'wind_speed_700hPa', 'wind_direction_700hPa'],
      ['wind-surface', 'wind_speed_10m', 'wind_direction_10m']
    ];
    var sawCalm = false;
    for (var l = 0; l < levels.length; l += 1) {
      var speedKmh = hourly[levels[l][1]] && hourly[levels[l][1]][index];
      var fromBearing = hourly[levels[l][2]] && hourly[levels[l][2]][index];
      if (!Number.isFinite(speedKmh) || speedKmh > 250 || !Number.isFinite(fromBearing) || fromBearing < 0 || fromBearing > 360) continue;
      if (speedKmh < 1) { sawCalm = true; continue; }
      // Meteorological wind direction names its origin; the arrow points downwind.
      return { ok: true, source: levels[l][0], speedKmh: speedKmh, bearing: (fromBearing + 180) % 360 };
    }
    return sawCalm ? { ok: false, reason: 'calm' } : null;
  }

  function windUrl(position) {
    var params = [
      'latitude=' + position.lat.toFixed(4),
      'longitude=' + position.lng.toFixed(4),
      'hourly=wind_speed_700hPa,wind_direction_700hPa,wind_speed_10m,wind_direction_10m',
      'past_hours=1',
      'forecast_hours=2',
      'timeformat=unixtime',
      'wind_speed_unit=kmh',
      'timezone=UTC'
    ];
    return OPEN_METEO_URL + '?' + params.join('&');
  }

  async function loadWindMotion(position) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, 8000);
    try {
      var response = await fetch(windUrl(position), { signal: controller ? controller.signal : undefined, cache: 'no-cache' });
      if (!response.ok) throw new Error('Wind: HTTP ' + response.status);
      return windMotionFromResponse(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Measured radar motion wins. Otherwise (no rain nearby, unclear pattern, radar images
   * unavailable) the wind is shown, so there is an arrow whenever wind data exists.
   * Returns a motion object, { ok: false, reason } or null.
   */
  async function chooseDisplayMotion(radarMotion, position, loadWind) {
    if (radarMotion && radarMotion.ok) return radarMotion;
    try {
      var wind = await (loadWind || loadWindMotion)(position);
      return wind || null;
    } catch (_) {
      return null;
    }
  }

  // ---- Radar frames around a position -------------------------------------------------------

  function analysisImageUrl(host, frame, position) {
    return host + frame.path + '/' + ANALYSIS_SIZE + '/' + ANALYSIS_ZOOM + '/' +
      Number(position.lat).toFixed(5) + '/' + Number(position.lng).toFixed(5) + '/2/0_0.png';
  }

  async function loadAnalysisField(host, frame, position) {
    var response = await fetch(analysisImageUrl(host, frame, position), { cache: 'force-cache' });
    if (!response.ok) throw new Error('Radar image: HTTP ' + response.status);
    var blob = await response.blob();
    var bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : await new Promise(function (resolve, reject) {
      var image = new Image();
      var url = URL.createObjectURL(blob);
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Radar image could not be decoded')); };
      image.src = url;
    });
    var canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_SIZE;
    canvas.height = ANALYSIS_SIZE;
    var context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    if (bitmap.close) bitmap.close();
    var data = context.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE).data;
    var values = new Int16Array(ANALYSIS_SIZE * ANALYSIS_SIZE).fill(-999);
    for (var pixel = 0, i = 0; i < data.length; i += 4, pixel += 1) {
      var dbz = RainRadar.rgbToDbz(data[i], data[i + 1], data[i + 2], data[i + 3]);
      if (dbz !== null) values[pixel] = dbz;
    }
    return { values: values, width: ANALYSIS_SIZE, height: ANALYSIS_SIZE };
  }

  /**
   * Full pipeline: radar motion from the last three frames, wind fallback when there is too little rain.
   * Returns { motion, geometry, reason } – motion/geometry are null when no reliable arrow exists.
   */
  async function computeDisplayMotion(position, metadata, deps) {
    var d = deps || {};
    var frames = ((metadata && metadata.frames) || []).slice(-3);
    var radarMotion = { ok: false, reason: 'frames' };
    if (frames.length >= 3) {
      try {
        var fields = await Promise.all(frames.map(function (frame) {
          return (d.loadField || loadAnalysisField)(metadata.host, frame, position);
        }));
        radarMotion = analyzeMotion(fields, {
          latitude: position.lat,
          frameTimes: frames.map(function (frame) { return frame.time; })
        });
      } catch (error) {
        // Radar images around the position could not be loaded – the wind fallback still works.
        radarMotion = { ok: false, reason: 'radar-unavailable' };
      }
    }
    var choice = await chooseDisplayMotion(radarMotion, position, d.loadWind);
    var motion = choice && choice.ok ? choice : null;
    return {
      motion: motion,
      radarReason: radarMotion.ok ? null : radarMotion.reason,
      reason: motion ? null : ((choice && choice.reason) || 'no-wind-data'),
      geometry: motion ? computeTimelineGeometry(position, motion.bearing, motion.speedKmh) : null
    };
  }

  // ---- Leaflet rendering (same look as Rainy) ----------------------------------------------

  function createMotionLayer(L, geometry, motion, options) {
    // Only pass pane options that are set: { pane: undefined } would override Leaflet's defaults.
    var withPane = function (base, paneName) {
      if (paneName) base.pane = paneName;
      return base;
    };
    var pane = options && options.pane;
    var markerPane = options && options.markerPane;
    var dark = typeof document !== 'undefined' && document.documentElement.classList.contains('theme-dark');
    var lineColor = (options && options.lineColor) || (dark ? '#e5e7eb' : '#253238');
    var haloColor = (options && options.haloColor) || (dark ? '#111827' : '#ffffff');
    var layer = L.layerGroup();
    var timeline = [];
    for (var index = 0; index <= 68; index += 1) {
      timeline.push(destinationPoint(geometry.position, geometry.sourceBearing, motion.speedKmh * index / 16));
    }
    L.polyline(timeline, withPane({ color: haloColor, opacity: 0.7, weight: 4, lineCap: 'round', lineJoin: 'round', interactive: false }, pane)).addTo(layer);
    for (var i = 0; i < timeline.length - 1; i += 1) {
      var hour = Math.min(4, i / 16);
      L.polyline([timeline[i], timeline[i + 1]], withPane({
        color: lineColor, opacity: 0.9 - hour * 0.06, weight: 2, lineCap: 'round', lineJoin: 'round', interactive: false
      }, pane)).addTo(layer);
    }
    var arrowIcon = L.divIcon({
      className: '',
      html: '<div class="rain-motion-tip" style="--bearing:' + motion.bearing + 'deg"><svg viewBox="0 0 40 30" aria-hidden="true">' +
        '<path class="tip-halo" d="m12 14 8-10 8 10"></path><path class="tip-core" d="m12 14 8-10 8 10"></path></svg></div>',
      iconSize: [40, 28],
      iconAnchor: [20, 4]
    });
    L.marker(geometry.position, withPane({ icon: arrowIcon, interactive: false, keyboard: false, zIndexOffset: 1300 }, markerPane)).addTo(layer);
    [[geometry.point1, '+1 h', true], [geometry.point2, '+2 h', false], [geometry.point3, '+3 h', true], [geometry.point4, '+4 h', false]]
      .forEach(function (entry) {
        var sourceLabel = entry[1] !== '+4 h' ? '' : motion.source === 'wind' ? '<small class="rain-motion-source">wind aloft</small>'
          : motion.source === 'wind-surface' ? '<small class="rain-motion-source">wind</small>' : '';
        var icon = L.divIcon({
          className: '',
          html: '<div class="rain-motion-marker' + (entry[2] ? ' is-intermediate' : '') + '" style="--bearing:' + motion.bearing + 'deg"><i></i><b>' + entry[1] + sourceLabel + '</b></div>',
          iconSize: [88, 68],
          iconAnchor: [44, 21]
        });
        L.marker(entry[0], withPane({ icon: icon, interactive: false, keyboard: false, zIndexOffset: 1250 }, markerPane)).addTo(layer);
      });
    return layer;
  }

  function motionBounds(L, geometry) {
    return L.latLngBounds([geometry.tailPoint, geometry.point4, geometry.point3, geometry.point2, geometry.point1, geometry.position]);
  }

  return {
    ANALYSIS_ZOOM: ANALYSIS_ZOOM,
    ANALYSIS_SIZE: ANALYSIS_SIZE,
    haversineKm: haversineKm,
    destinationPoint: destinationPoint,
    bearingToCompass: bearingToCompass,
    computeTimelineGeometry: computeTimelineGeometry,
    downsampleField: downsampleField,
    estimateShift: estimateShift,
    analyzeMotion: analyzeMotion,
    windMotionFromResponse: windMotionFromResponse,
    windUrl: windUrl,
    loadWindMotion: loadWindMotion,
    chooseDisplayMotion: chooseDisplayMotion,
    analysisImageUrl: analysisImageUrl,
    loadAnalysisField: loadAnalysisField,
    computeDisplayMotion: computeDisplayMotion,
    createMotionLayer: createMotionLayer,
    motionBounds: motionBounds
  };
}));
