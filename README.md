# SolarOne Web

SolarOne Web is a browser-based migration of the Android SolarOne app.
It uses plain JavaScript, Bootstrap, Leaflet/OpenStreetMap, HTML5 Canvas, and browser-local storage only.

## Run

No backend is required.

- Option 1: Open `index.html` directly in a modern browser.
- Option 2: Serve the `Web` folder with any static file server.

## Scope Implemented (Phases 0–7)

- World Map with place markers, selection, list sync, and delete actions.
- Add Place flow with map click coordinate pick, no-key geocoding, timezone and DST auto-fill fallback.
- Solar calculations and yearly precompute/cache per place and year.
- Graphs (Rise & Set, Max Elevation, Length of Day) in HTML5 Canvas (no graph libraries).
- Graph tooltip with click inspection and day markers.
- Solar Sector map overlay with day slider, day +/- controls, animate mode, info panel, and satellite/map layer toggle (Esri World Imagery).
- Help view and accessibility live-region feedback.

## Architecture

- `index.html`: Main UI layout and views.
- `app.js`: View logic, map/graph interactions, and app orchestration.
- `storage.js`: Browser storage schema, seed bootstrap, and client-side CRUD operations.
- `seed-data.js`: Starter place dataset.
- `solar-calc.js`: Solar calculation engine and yearly generation.

## Data Model (Browser Storage)

Primary key: `solarone.web.v1`

Stored state includes:
- Places (`id`, name, coordinates, timezone, DST usage, selected flag)
- Selected place IDs
- Yearly solar data cache (`yearlyData`) keyed by `placeId:year`

All data is local to the current browser profile.

## No-key / No-backend Constraints

- Maps: OpenStreetMap tiles via Leaflet (default).
- Satellite mode: Solar Sector supports Esri World Imagery satellite view — toggle with the layer icon next to Day +/-.
- Geocoding/timezone: uses public endpoints; availability/rate limits can vary.
- No server-side APIs are used for app data.

## Accessibility Notes

- Status/feedback elements use `aria-live` regions.
- Form fields use explicit labels.
- Controls use native HTML inputs/select/buttons for keyboard support.

## Browser Validation Checklist

Validate on latest:
- Chromium-based browser
- Firefox
- Safari

Manual checks:
- World Map marker interaction and place selection sync
- Add Place geocode/map-click/save flow
- Graph render for all three modes + tooltip click inspection
- Solar Sector slider/day step/animate/info behavior
- Responsive layout at small and large viewport sizes

## Smoke test (quick sanity checks)

1. Serve the `Web` folder locally (choose one):

```powershell
# Python 3
python -m http.server 8000

# Node (http-server)
npx http-server -c-1 . -p 8000
```

2. Open a browser at `http://localhost:8000` and load `index.html`.

3. Confirm i18n runtime is loaded: open DevTools console and run:

```javascript
Boolean(window.SolarOneI18n && typeof window.SolarOneI18n.t === 'function')
```

4. Smoke checks:
- Use the language selector in the navbar; switch to Swedish and verify:
	- Navbar and view headings update.
	- Graph month labels and Y-axis label redraw in Swedish.
	- Map latitude/pole labels and sector dialog text are translated.
- Render a graph for a seeded place and hover/click to check tooltip text.
- Open the Solar Sector view, move the day slider and open the info dialog.

5. If translations do not appear, ensure `Web/i18n.js` is included before `Web/app.js` in `index.html`.

These steps are sufficient for a quick verification that i18n and core views work after localization changes.

## Known Limitations

- Public no-key service calls (geocode/timezone) may occasionally fail or throttle.
- `localStorage` capacity may limit very large place/year datasets.
- Solar outputs may differ slightly from original Android implementation due to algorithm differences.
