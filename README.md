# Munchies Maps – Night-friendly stops for long rides

Munchies Maps is an early-stage, community-driven map for cyclists, focused on **night-friendly stops for long rides**.
While it was originally designed with night rides in mind, **it is equally useful during daytime rides, touring and bikepacking**.
The project is a practical reference tool rather than a routing or navigation app. It is actively developed and already usable, but **data completeness and accuracy can vary** depending on region and source.

Live: <https://nightrides.cc/munchiesmaps/>

## Who it’s for
- Night riders and long-distance cyclists
- Brevet, randonneuring and ultra-distance riders
- Bikepacking and touring cyclists
- Anyone riding outside regular opening hours and looking for basic infrastructure

## What works today
- Night-friendly points of interest: food, fuel, water, toilets, shelters, vending, accommodation
- Filters for categories, countries/regions (grouped **Country → Region**) and night availability
- Option to include POIs with missing or unknown opening hours
- **Route tools:** GPX import (POIs near the route), GPX export of visible POIs
- Hide POIs and mark favorites along a route (`Restore hidden`, `Show favorites only`)
- Save routes locally (IndexedDB) incl. an offline map tile snapshot (`Offline Map detail`)
- JSON session backup (route, radius, filters, hidden POIs, favorites) – export and re-import
- Shareable URLs with compact filter state (see [`URL_STATE.md`](URL_STATE.md))
- Open any POI in Google Maps; shelters additionally in Mapy.com
- Installable PWA with offline support, dark mode, mobile-friendly interface
- Feedback form and support link in the drawer (`Feedback & Support`)

## Country coverage
32 countries are configured in [`fetch_data/config.yml`](fetch_data/config.yml), among them Germany, Austria,
Switzerland, Czechia, Poland, France, Italy, Spain, Portugal, the Benelux countries, Great Britain, Ireland,
Scandinavia and most of the Balkans. Datasets are generated automatically via GitHub Actions from OpenStreetMap.

## Alpha status & feedback
Munchies Maps is currently in an **Alpha stage**. Features, data coverage and behavior may change at any time.
Feedback from real-world use is highly appreciated and helps improve data quality, usability and future features.

## A quick note on the data
All information comes from OpenStreetMap and other community-maintained sources.
Some details might be missing, outdated or simply wrong.
Please treat this map as a **helpful guide, not a guarantee** — especially at night.

## Data sources & license
Map data is © OpenStreetMap contributors and licensed under the **Open Database License (ODbL)**.
The accuracy, completeness and freshness of individual points of interest depend on local contributions and tagging practices.

---

## Development

### Repository layout

| Path | Purpose |
|---|---|
| `index.html` | The web app (markup + main script) |
| `css/app.css` | App styles |
| `js/` | Browser modules: `gpx-utils.js` (GPX parsing), `route-state.js` (POI ids, backup format), `offline-route-store.js` (IndexedDB), `consent.js` (analytics consent) |
| `sw.js` | Service worker (offline app shell, GeoJSON + tile caching) |
| `resources/geojson/` | Generated POI datasets per country / region / category + `manifest.json` |
| `resources/icons/` | Category marker icons |
| `fetch_data/` | Python Overpass fetch pipeline (see [`fetch_data/README.md`](fetch_data/README.md)) |
| `scripts/` | Maintenance scripts, tests, SEO page generator |
| `map/` | Generated SEO landing pages (do not edit) |
| `legal/` | Imprint and privacy policy |
| `tests/e2e/` | Playwright smoke tests |
| `vendor/` | Local copies of Leaflet, MarkerCluster, opening_hours.js, Font Awesome |
| `.github/workflows/` | Data fetch automation and CI (see [`.github/workflows/README.md`](.github/workflows/README.md)) |

### Tests

```bash
npm install
npm test          # unit / regression tests (Node)
npm run test:e2e  # Playwright smoke tests (GPX, favorites, saved routes, backup roundtrip)
```

CI (`.github/workflows/ci.yml`) runs the unit tests, the vendor check, the GeoJSON integrity check and the
Playwright smoke tests on every pull request and on `main`. Use `npm run serve` to run the app locally on
<http://localhost:4173/>.

### Service worker cache version

`sw.js` contains a `BUILD_ID`, a content hash of the app shell (`index.html`, `js/`, `vendor/`, icons).
A new `BUILD_ID` makes browsers install the updated service worker and drop the old static cache.
After merges to `main`, the workflow `sw-build-id.yml` updates it automatically. Locally:

```bash
npm run bump-sw   # update BUILD_ID
npm run check-sw  # verify it is current
```

### SEO landing pages

Static, crawlable landing pages per category and country (e.g. `map/drinking-water/slovenia/`), an overview
page (`map/`) and `sitemap.xml` are generated from `resources/geojson/` – nothing is maintained by hand:

```bash
npm run generate-seo
```

Each page has a static H1, POI counts per region, the data date and a deep link that opens the filtered map
directly. After data updates on `main`, `seo-pages.yml` regenerates them automatically.
Submit `https://nightrides.cc/munchiesmaps/sitemap.xml` in Google Search Console (a `robots.txt` inside
`/munchiesmaps/` is ignored by crawlers; only the domain root counts).

### Privacy

Google Analytics is only loaded after consent (`js/consent.js`). Imprint and privacy policy live in `legal/`
– **fill in the placeholders in `legal/imprint.html` (and the hosting provider in `legal/privacy.html`)
before deploying.**

### Vendor files

```bash
npm install
npm run sync-vendor
npm run check-vendor
```

Commit the `vendor/` folder afterwards (including binary assets from npm packages).
Alternatively run **Actions → Sync vendor assets → Run workflow**.
Do not use placeholder files, CDN wrappers or synchronous XHR fallbacks for vendor libraries.

### PWA icons

PWA / home screen / favicon icons live in `assets/icons/` (incl. maskable icons for Android and an Apple touch icon for iOS).
