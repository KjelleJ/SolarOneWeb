## SolarOne Web Migration — Execution Checklist

### Phase 0 — Setup (Runnable)
- [ ] Create base web app shell in [Web](Web): `index.html`, `app.js`, Bootstrap layout, simple navigation tabs/pages.
- [ ] Add placeholder views for: World Map, Add Place, Graphs, Solar Sector, Help.
- [ ] Ensure app runs locally by opening `index.html` (or lightweight static server).
- [ ] Add basic smoke test checklist (manual).

### Phase 1 — Data Layer + Seed Starter Data (Runnable)
- [ ] Define `localStorage` schema with version key and migration guard.
- [ ] Convert Android `soldb` starter content into web seed JSON (starter places + required fields).
- [ ] Implement first-run bootstrap: if no places exist, load seed data automatically.
- [ ] Implement client-side data utility functions in browser storage only (Create/Read/Update/Delete/select places; no backend API).
- [ ] Add reset/clear utility for testing.
- [ ] Verify app runs with seeded default places after fresh load.

### Phase 2 — World Map (Leaflet + OSM) (Runnable)
- [ ] Add Leaflet map with OpenStreetMap tiles.
- [ ] Render all places as markers.
- [ ] Implement marker click → info + select/unselect toggle.
- [ ] Implement multi-select list/dialog synchronized with marker state.
- [ ] Implement delete selected places.
- [ ] Add map type fallback note (no satellite in no-key mode).
- [ ] Verify full world-map workflow is runnable end-to-end.

### Phase 3 — Add Place Flow (Runnable)
- [ ] Build Add Place form (place, lat/lng, timezone, DST options) with Bootstrap controls.
- [ ] Implement place lookup via no-key geocoding strategy (with graceful failure UI).
- [ ] Implement map-click coordinate selection.
- [ ] Implement save place into `localStorage`.
- [ ] Add validation/error states and retry guidance.
- [ ] Verify add-place workflow updates world map immediately.

### Phase 4 — Solar Calculation Engine (Runnable)
- [ ] Add known JS solar algorithm module (non-`jSunTimes`).
- [ ] Implement per-day solar values generation (rise/set/length/elev/azi).
- [ ] Implement yearly precompute for a place.
- [ ] Persist generated yearly data using compact storage shape.
- [ ] Add numerical sanity checks for representative cities/dates.
- [ ] Verify app remains runnable with computed values.

### Phase 5 — Graph Screen (Canvas, no graph libs) (Runnable)
- [ ] Implement canvas graph renderer for required graph modes.
- [ ] Add year/day navigation controls.
- [ ] Plot values from stored yearly data.
- [ ] Match Android-style interaction behavior as closely as practical.
- [ ] Verify graph screen works for multiple seeded and user-added places.

### Phase 6 — Solar Sector Screen (Runnable)
- [ ] Implement sector overlay drawing on Leaflet map.
- [ ] Add day stepping (`+/-`) with year wrap behavior.
- [ ] Add timeline/yearline date selection behavior.
- [ ] Add animate mode for predefined date steps.
- [ ] Add info dialog/panel for current sector/day values.
- [ ] Verify full sector workflow end-to-end.

### Phase 7 — Help + Docs + Accessibility (Runnable)
- [ ] Port/adapt help content from Android assets.
- [ ] Create [Web/README.md](Web/README.md): setup, run, architecture, limitations.
- [ ] Document no-key map constraints and satellite tradeoff.
- [ ] Add accessibility pass: keyboard basics, labels, contrast, responsive checks.
- [ ] Validate in modern browsers (Chromium/Firefox/Safari).

### Cross-Cutting Quality Gates (Apply every phase)
- [ ] Each phase ends with a runnable app state (Requirement #17).
- [ ] Keep plain JavaScript only; no backend (except static hosting to load app files).
- [ ] No server-side CRUD/API calls; all app data operations stay in browser storage (`localStorage`).
- [ ] Use Bootstrap for layout/styling (no custom CSS except minimal unavoidable fixes).
- [ ] Avoid graph libraries; use HTML5 Canvas.
- [ ] Keep look/feel and branding close to Android app.
- [ ] Keep concise inline comments and update docs when behavior changes.

### Known Risks to Track
- [ ] `localStorage` quota limits with many places + yearly datasets.
- [ ] No-key geocoding/timezone rate limits and availability.
- [ ] Satellite map parity gap under strict no-key/no-billing.
- [ ] Small output differences from original Android solar algorithm.
