# Munchies Maps – Roadmap

Living plan for the project. Status as of 2026-11. Implementation details: see README and tests.

## Done

### Phase 0 – Foundation
- Cleanup: `.gitignore`, removed unused `opening_hours_unique.*` and the obsolete `fetch-missing.yml`, merged READMEs
- CI (`ci.yml`): unit tests, vendor check, GeoJSON integrity, Playwright smoke tests on every PR
- Playwright smoke tests (`tests/e2e/`): boot, GPX import, favorites/hide, *Show favorites only*,
  saved route reload, backup roundtrip, mobile zoom-to-route, offline shell, consent, SEO pages, location, CSP
- Service worker cache versioning via content-hash `BUILD_ID` (auto-updated on `main`)
- Bugs fixed on the way:
  - `opening_hours.js` crashed on load (missing i18next/SunCalc) → night badges used a regex fallback
  - Share URLs broke for countries with > 53 regions (Turkey) → BigInt bitmask
  - *Save Route* left the button on "Update saved route"

### Phase 1 – Privacy & SEO
- Google Analytics only after consent (`js/consent.js`), *Privacy settings* in the drawer
- `legal/imprint.html`, `legal/privacy.html` – **imprint placeholders must be filled in by the operator**
- 317 generated landing pages `map/<category>/<country>/` + `sitemap.xml`, deep links open the filtered map
  directly, regenerated automatically after data updates

### Phase 2 – Stabilize
- Verified by tests: favorites survive save → reload → load; backup restores the GPX track; mobile zoom on
  new and saved routes
- iOS `kCLErrorDomain 0`: extra `watchPosition` attempt before falling back to the last known position
- *Offline map detail* hidden once the route is saved
- Extracted `css/app.css`, `js/gpx-utils.js`, `js/route-state.js` (with unit tests)
- Content Security Policy (meta tag)

## Next

### Phase 3 – Product
1. **Roadbook MVP** – list of favorites / POIs along the route sorted by `routeKm`, later planned stops,
   supply gaps and ETA vs. opening hours
2. **Report issue to OSM** – compact popup button, modal with pre-filled text, start with an OSM note link
   (no OAuth)
3. Own POIs in the backup, multiple saved route slots (~10)
4. Deep links: Google search by name for named POIs, exact position for unnamed ones; Mapy `showmap`

### Technical follow-ups
- Move the main inline script into `js/` modules (state, map, POI layer, route tools, sharing, UI), then drop
  `'unsafe-inline'` from the CSP
- Pin GitHub Actions to commit SHAs
- Rate limiting / length check in the feedback Apps Script
- Consider moving GeoJSON data out of the main git history (data branch, releases or object storage)

### Later
Community trust signals / rankings, public backup viewer / share by UUID, Wahoo export, data tiles instead of
admin regions, rain radar integration (separate project *Rainy*).
