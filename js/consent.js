/*
 * Analytics consent (GDPR / TTDSG).
 * Google Analytics is only loaded after the visitor explicitly allows it.
 * The choice is stored in localStorage and can be changed via
 * "Privacy settings" in the drawer (window.munchiesConsent.openSettings()).
 */
(function () {
  'use strict';

  var GA_MEASUREMENT_ID = 'G-8SSC7BE5TP';
  var STORAGE_KEY = 'munchiesAnalyticsConsent'; // 'granted' | 'denied'
  var PRIVACY_URL = 'legal/privacy.html';
  var IMPRINT_URL = 'legal/imprint.html';
  var gaLoaded = false;

  function readChoice() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === 'granted' || value === 'denied' ? value : null;
    } catch (_) {
      return null;
    }
  }

  function storeChoice(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) { /* private mode: choice lasts for this page view only */ }
  }

  function loadAnalytics() {
    if (gaLoaded || navigator.onLine === false) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    document.head.appendChild(script);
  }

  function removeAnalyticsCookies() {
    var host = location.hostname;
    var domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
    document.cookie.split(';').forEach(function (cookie) {
      var name = cookie.split('=')[0].trim();
      if (!/^_ga/.test(name)) return;
      domains.forEach(function (domain) {
        document.cookie = name + '=; Max-Age=0; path=/' + (domain ? '; domain=' + domain : '');
      });
    });
  }

  function closeBanner() {
    var banner = document.getElementById('consentBanner');
    if (banner) banner.remove();
  }

  function decide(value) {
    var previous = readChoice();
    storeChoice(value);
    closeBanner();
    if (value === 'granted') {
      loadAnalytics();
    } else {
      removeAnalyticsCookies();
      if (previous === 'granted' && gaLoaded) {
        // Fully stop an already running GA instance.
        window['ga-disable-' + GA_MEASUREMENT_ID] = true;
      }
    }
  }

  function showBanner() {
    if (document.getElementById('consentBanner')) return;
    var banner = document.createElement('div');
    banner.id = 'consentBanner';
    banner.className = 'consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Privacy settings');
    banner.innerHTML =
      '<p class="consent-banner__text">' +
      'Munchies Maps would like to use Google Analytics to understand how the map is used. ' +
      'This is optional and only enabled with your consent. ' +
      '<a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">Privacy policy</a> · ' +
      '<a href="' + IMPRINT_URL + '" target="_blank" rel="noopener">Imprint</a>' +
      '</p>' +
      '<div class="consent-banner__actions">' +
      '<button type="button" data-consent="denied">Decline</button>' +
      '<button type="button" data-consent="granted" class="consent-banner__accept">Allow analytics</button>' +
      '</div>';
    banner.addEventListener('click', function (event) {
      var target = event.target;
      var value = target && target.getAttribute && target.getAttribute('data-consent');
      if (value) decide(value);
    });
    document.body.appendChild(banner);
  }

  window.munchiesConsent = {
    getChoice: readChoice,
    openSettings: showBanner,
    grant: function () { decide('granted'); },
    deny: function () { decide('denied'); }
  };

  var choice = readChoice();
  if (choice === 'granted') {
    loadAnalytics();
  } else if (choice === null) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }
})();
