/*
 * Rain radar overlay – ported from Rainy (github.com/MarkusCouch/Rainy, src/radar.js + src/palette.js).
 *
 * RainViewer radar tiles are decoded to dBZ and recoloured into Rainy's five pixel classes
 * (green → cyan → violet). Everything runs in the browser; no API key, no own server.
 *
 * Browser: window.MunchiesRainRadar · Node (palette tests): module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MunchiesRainRadar = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
  var REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  var NATIVE_MAX_ZOOM = 7; // highest zoom RainViewer serves radar tiles for

  // RainViewer "Universal Blue" palette: index - 10 = dBZ.
  var UNIVERSAL_BLUE = [
    '636159', '66635a', '69665c', '6c685d', '6f6b5f', '726e61', '757062', '787364',
    '7c7565', '7f7867', '827b69', '857d6a', '88806c', '8b826d', '8e856f', '928871',
    '9e9375', 'aa9e79', 'b6a97e', 'c2b482', 'cec087', 'd2c48b', 'd6c88f', 'dacc93',
    'ded097', '88ddee', '6cd1eb', '51c5e8', '36bae5', '1baee2', '00a3e0', '009ad5',
    '0091ca', '0088bf', '007fb4', '0077aa', '0070a3', '00699c', '006295', '005b8e',
    '005588', '005180', '004e78', '004a70', '004768', 'ffee00', 'ffe000', 'ffd200',
    'ffc500', 'ffb700', 'ffaa00', 'ff9f00', 'ff9500', 'ff8b00', 'ff8100', 'ff4400',
    'f23600', 'e62800', 'd91b00', 'cd0d00', 'c10000', 'a80000', '8f0000', '760000',
    '5d0000', 'ffaaff', 'ff9fff', 'ff95ff', 'ff8bff', 'ff81ff', 'ff77ff', 'ff6cff',
    'ff62ff', 'ff58ff', 'ff4eff', 'ffffff', 'ffffff', 'ffffff', 'ffffff', 'ffffff',
    'ffffff', 'ffffff', 'ffffff', 'ffffff', 'ffffff', '00ff00', '00ff00', '00ff00',
    '00ff00', '00ff00', '00ff00', '00ff00', '00ff00', '00ff00', '00ff00', '00ff00',
    '00ff00', '00ff00', '00ff00', '00ff00', '00ff00', '00ff00', '00ff00', '00ff00',
    '00ff00', '00ff00'
  ];

  var colorToDbz = new Map();
  UNIVERSAL_BLUE.forEach(function (hex, index) {
    // Same mapping as Rainy: duplicated colours resolve to their last index.
    colorToDbz.set(parseInt(hex, 16), index - 10);
  });

  var RADAR_CLASSES = [
    { max: 9, color: [0, 244, 90], alpha: 132, label: '< 10 dBZ', name: 'very light' },
    { max: 19, color: [0, 216, 121], alpha: 178, label: '10–19', name: 'light' },
    { max: 34, color: [40, 207, 214], alpha: 202, label: '20–34', name: 'moderate' },
    { max: 44, color: [89, 107, 230], alpha: 218, label: '35–44', name: 'heavy' },
    { max: Infinity, color: [163, 77, 225], alpha: 232, label: '≥ 45', name: 'very heavy' }
  ];

  function rgbToDbz(r, g, b, alpha) {
    if (alpha === 0) return null;
    var value = colorToDbz.get((r << 16) | (g << 8) | b);
    return value === undefined ? null : value;
  }

  function radarClassForDbz(dbz) {
    if (dbz === null || dbz === undefined) return null;
    for (var i = 0; i < RADAR_CLASSES.length; i += 1) {
      if (dbz <= RADAR_CLASSES[i].max) return RADAR_CLASSES[i];
    }
    return RADAR_CLASSES[RADAR_CLASSES.length - 1];
  }

  /** Recolour RGBA pixel data in place (works on ImageData.data or any array). */
  function recolorPixels(data) {
    for (var i = 0; i < data.length; i += 4) {
      var dbz = rgbToDbz(data[i], data[i + 1], data[i + 2], data[i + 3]);
      var radarClass = radarClassForDbz(dbz);
      if (!radarClass) {
        data[i + 3] = 0;
        continue;
      }
      data[i] = radarClass.color[0];
      data[i + 1] = radarClass.color[1];
      data[i + 2] = radarClass.color[2];
      data[i + 3] = dbz < 0 ? 50 : radarClass.alpha;
    }
    return data;
  }

  function radarTileUrl(host, frame, coords) {
    return host + frame.path + '/256/' + coords.z + '/' + coords.x + '/' + coords.y + '/2/0_0.png';
  }

  async function loadRadarMetadata(fetchImpl) {
    var response = await (fetchImpl || fetch)(RAINVIEWER_API, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Radar metadata: HTTP ' + response.status);
    var data = await response.json();
    var frames = data && data.radar && data.radar.past;
    if (!data.host || !Array.isArray(frames) || !frames.length) throw new Error('Radar metadata incomplete');
    return { host: data.host, frames: frames, frame: frames[frames.length - 1] };
  }

  async function blobToBitmap(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var url = URL.createObjectURL(blob);
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Radar tile could not be decoded')); };
      image.src = url;
    });
  }

  function createRadarLayer(L, host, frame, options) {
    var RadarLayer = L.GridLayer.extend({
      createTile: function (coords, done) {
        var canvas = L.DomUtil.create('canvas', 'rain-radar-tile');
        canvas.width = 256;
        canvas.height = 256;
        canvas.setAttribute('role', 'presentation');
        fetch(radarTileUrl(host, frame, coords), { cache: 'force-cache' })
          .then(function (response) {
            if (!response.ok) throw new Error('Radar tile: HTTP ' + response.status);
            return response.blob();
          })
          .then(blobToBitmap)
          .then(function (bitmap) {
            var context = canvas.getContext('2d', { willReadFrequently: true });
            context.imageSmoothingEnabled = false;
            context.drawImage(bitmap, 0, 0, 256, 256);
            if (bitmap.close) bitmap.close();
            var imageData = context.getImageData(0, 0, 256, 256);
            recolorPixels(imageData.data);
            context.putImageData(imageData, 0, 0);
            done(null, canvas);
          })
          .catch(function (error) { done(error, canvas); });
        return canvas;
      }
    });
    return new RadarLayer(Object.assign({
      tileSize: 256,
      opacity: 0.9,
      maxNativeZoom: NATIVE_MAX_ZOOM,
      minZoom: 3,
      maxZoom: 19,
      noWrap: true,
      keepBuffer: 2,
      updateWhenIdle: true,
      className: 'rain-radar-grid',
      attribution: 'Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer</a>'
    }, options || {}));
  }

  function formatFrameTime(frame) {
    var date = new Date(Number(frame.time) * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Controller for the overlay: toggling, periodic refresh, status callbacks.
   * onStatus({ state: 'off'|'loading'|'on'|'error', time?: string, message?: string })
   */
  function createRainRadarController(L, map, options) {
    var opts = options || {};
    var paneName = opts.pane || 'rainRadarPane';
    var onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    // Called with the full metadata ({ host, frames, frame }) whenever a new radar frame is shown.
    var onFrame = typeof opts.onFrame === 'function' ? opts.onFrame : function () {};
    var layer = null;
    var timer = null;
    var active = false;
    var currentFramePath = null;

    if (!map.getPane(paneName)) {
      var pane = map.createPane(paneName);
      pane.style.zIndex = 350; // above base tiles (200), below route/markers (400+)
      pane.style.pointerEvents = 'none';
    }

    async function refresh() {
      try {
        var meta = await loadRadarMetadata();
        if (!active) return;
        if (meta.frame.path !== currentFramePath) {
          var next = createRadarLayer(L, meta.host, meta.frame, { pane: paneName });
          next.addTo(map);
          if (layer) {
            var old = layer;
            // Swap after the new frame had a moment to load, to avoid flicker.
            next.once('load', function () { map.removeLayer(old); });
            setTimeout(function () { if (map.hasLayer(old)) map.removeLayer(old); }, 4000);
          }
          layer = next;
          currentFramePath = meta.frame.path;
          onFrame(meta);
        }
        onStatus({ state: 'on', time: formatFrameTime(meta.frame) });
      } catch (error) {
        if (!active) return;
        onStatus({ state: 'error', message: navigator.onLine === false ? 'Rain radar needs an internet connection.' : 'Rain radar is unavailable right now.' });
      }
    }

    function enable() {
      if (active) return;
      active = true;
      onStatus({ state: 'loading' });
      refresh();
      timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    }

    function disable() {
      active = false;
      clearInterval(timer);
      timer = null;
      if (layer) map.removeLayer(layer);
      layer = null;
      currentFramePath = null;
      onStatus({ state: 'off' });
    }

    return {
      enable: enable,
      disable: disable,
      toggle: function () { if (active) disable(); else enable(); return active; },
      isActive: function () { return active; },
      refresh: refresh
    };
  }

  return {
    RAINVIEWER_API: RAINVIEWER_API,
    RADAR_CLASSES: RADAR_CLASSES,
    rgbToDbz: rgbToDbz,
    radarClassForDbz: radarClassForDbz,
    recolorPixels: recolorPixels,
    radarTileUrl: radarTileUrl,
    loadRadarMetadata: loadRadarMetadata,
    createRadarLayer: createRadarLayer,
    createRainRadarController: createRainRadarController
  };
}));
