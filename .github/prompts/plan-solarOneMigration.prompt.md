**Updated Direction**
- Good change: use starter seed data from [Android/solarone/assets/soldb](Android/solarone/assets/soldb) behavior and avoid Google keys/billing.
- Requirement #17 in [my_requirements.txt](my_requirements.txt#L17) is now central: each phase ends with a runnable web app checkpoint.

**No-key Map Alternatives**
- Leaflet + OpenStreetMap (chosen): fastest plain-JS path, no key/billing, strong marker/click support.
- OpenLayers + OSM: powerful but slower to build for MVP.
- Static map/canvas fallback: safest no-key baseline, but weaker UX (no real pan/zoom map).
- Main tradeoff: satellite view parity from Android is not realistically key-free at production quality.

## Plan: Incremental Web Migration with Seed Data
Build a plain JS + Bootstrap web app in [Web](Web) with Leaflet/OSM, local browser storage, and seeded starter places equivalent to Android first-run behavior from [WorldMap bootstrap flow](Android/solarone/src/se/gubboit/solarone/WorldMap.java#L131-L157). Keep each step runnable so you can review continuously, with no backend API/server-side CRUD (except static hosting to load app files).

**Steps**
1. Scaffold runnable shell in [Web](Web): navigation + empty views matching Android screens; smoke test in browser.
2. Add client-side storage module (`localStorage`) with schema/versioning and first-run seeding from converted `soldb` starter dataset; app runs with default places and browser-only data operations.
3. Implement World Map view (Leaflet): markers, select/unselect, multi-select dialog, delete; runnable review checkpoint.
4. Implement Add Place flow: search + map click to set location + save; fallback behavior when geocode/timezone services are unavailable.
5. Port solar calculation engine (known JS algorithm) and yearly precompute/update path; verify sample cities.
6. Implement Graph screen using HTML5 Canvas only (no graph libs); match Android graph modes.
7. Implement Solar Sector map overlay + day stepper + animation; runnable parity check.
8. Port Help/About content and create [Web/README.md](Web/README.md); finalize accessibility/browser checks.

**Likely Problems**
- `soldb` is a binary SQLite asset, so conversion to web seed JSON is required once (one-time extraction script/tooling).
- `localStorage` size limits may constrain full yearly precomputed data for many places.
- No-key geocoding/timezone services can rate-limit; we should add graceful fallbacks and caching.
- Satellite map parity is the main feature gap under strict no-key/no-billing constraints.

If you want, next I can produce a concrete “Step 1 deliverables checklist” (files, acceptance criteria, and demo test script) so implementation can start immediately.
