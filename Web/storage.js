// Browser-local persistence for SolarOne.
// No backend APIs are used; all app data stays in localStorage.
const STORAGE_KEY = "solarone.web.v1";
const STORAGE_VERSION = 1;

function createDefaultState() {
  return {
    version: STORAGE_VERSION,
    nextPlaceId: 1,
    places: [],
    selectedPlaceIds: [],
    yearlyData: {}
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Normalize persisted state to current schema version.
function sanitizeState(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return createDefaultState();
  }

  const normalized = {
    version: STORAGE_VERSION,
    nextPlaceId: Number.isInteger(candidate.nextPlaceId) ? candidate.nextPlaceId : 1,
    places: Array.isArray(candidate.places) ? candidate.places : [],
    selectedPlaceIds: Array.isArray(candidate.selectedPlaceIds) ? candidate.selectedPlaceIds : [],
    yearlyData: candidate.yearlyData && typeof candidate.yearlyData === "object" ? candidate.yearlyData : {}
  };

  const maxId = normalized.places.reduce((acc, place) => {
    const placeId = Number.isInteger(place.id) ? place.id : 0;
    return Math.max(acc, placeId);
  }, 0);

  if (normalized.nextPlaceId <= maxId) {
    normalized.nextPlaceId = maxId + 1;
  }

  normalized.selectedPlaceIds = normalized.selectedPlaceIds.filter((id) => {
    return normalized.places.some((place) => place.id === id);
  });

  return normalized;
}

function readState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createDefaultState();
  }

  try {
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch {
    return createDefaultState();
  }
}

function writeState(nextState) {
  const normalized = sanitizeState(nextState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

function resetState() {
  localStorage.removeItem(STORAGE_KEY);
}

function clearAllData() {
  resetState();
}

// Seed handling: first-run starter places.
function getSeedPlaces() {
  const seed = window.SolarOneSeedData;
  if (!seed || !Array.isArray(seed.places)) {
    return [];
  }

  return seed.places.map((place, index) => ({
    id: Number.isInteger(place.id) ? place.id : index + 1,
    name: place.name || `Place ${index + 1}`,
    latitude: typeof place.latitude === "number" ? place.latitude : 0,
    longitude: typeof place.longitude === "number" ? place.longitude : 0,
    timezoneId: place.timezoneId || "Etc/UTC",
    usesDst: Boolean(place.usesDst),
    selected: Boolean(place.selected)
  }));
}

function bootstrapSeedDataIfNeeded() {
  const state = readState();
  if (state.places.length > 0) {
    return state;
  }

  const seededPlaces = getSeedPlaces();
  const selectedPlaceIds = seededPlaces
    .filter((place) => place.selected)
    .map((place) => place.id);

  const maxSeedId = seededPlaces.reduce((acc, place) => Math.max(acc, place.id), 0);

  const seededState = {
    version: STORAGE_VERSION,
    nextPlaceId: maxSeedId + 1,
    places: seededPlaces,
    selectedPlaceIds
  };

  writeState(seededState);
  return seededState;
}

function restoreSeedData() {
  resetState();
  return bootstrapSeedDataIfNeeded();
}

// Basic read helpers.
function getPlaces() {
  return clone(readState().places);
}

function getSelectedPlaceIds() {
  return clone(readState().selectedPlaceIds);
}

function buildYearlyDataKey(placeId, year) {
  return `${placeId}:${year}`;
}

function setYearlyData(placeId, year, yearlyPayload) {
  const state = readState();
  state.yearlyData[buildYearlyDataKey(placeId, year)] = yearlyPayload;
  writeState(state);
}

function getYearlyData(placeId, year) {
  const state = readState();
  return clone(state.yearlyData[buildYearlyDataKey(placeId, year)] || null);
}

function hasYearlyData(placeId, year) {
  const state = readState();
  return Boolean(state.yearlyData[buildYearlyDataKey(placeId, year)]);
}

// Client-side CRUD for places.
function addPlace(placeInput) {
  const state = readState();
  const place = {
    id: state.nextPlaceId,
    name: placeInput.name || `Place ${state.nextPlaceId}`,
    latitude: Number(placeInput.latitude) || 0,
    longitude: Number(placeInput.longitude) || 0,
    timezoneId: placeInput.timezoneId || "Etc/UTC",
    usesDst: Boolean(placeInput.usesDst),
    selected: false
  };

  state.places.push(place);
  state.nextPlaceId += 1;
  writeState(state);
  return clone(place);
}

function updatePlace(placeId, updates) {
  const state = readState();
  const target = state.places.find((place) => place.id === placeId);
  if (!target) {
    return null;
  }

  if (typeof updates.name === "string") target.name = updates.name;
  if (updates.latitude !== undefined) target.latitude = Number(updates.latitude) || 0;
  if (updates.longitude !== undefined) target.longitude = Number(updates.longitude) || 0;
  if (typeof updates.timezoneId === "string") target.timezoneId = updates.timezoneId;
  if (updates.usesDst !== undefined) target.usesDst = Boolean(updates.usesDst);

  writeState(state);
  return clone(target);
}

function setSelectedPlaceIds(placeIds) {
  const state = readState();
  state.selectedPlaceIds = placeIds.filter((id) => state.places.some((place) => place.id === id));

  state.places.forEach((place) => {
    place.selected = state.selectedPlaceIds.includes(place.id);
  });

  writeState(state);
  return clone(state.selectedPlaceIds);
}

function toggleSelectedPlace(placeId) {
  const state = readState();
  const isSelected = state.selectedPlaceIds.includes(placeId);

  if (isSelected) {
    state.selectedPlaceIds = state.selectedPlaceIds.filter((id) => id !== placeId);
  } else if (state.places.some((place) => place.id === placeId)) {
    state.selectedPlaceIds.push(placeId);
  }

  state.places.forEach((place) => {
    place.selected = state.selectedPlaceIds.includes(place.id);
  });

  writeState(state);
  return clone(state.selectedPlaceIds);
}

function deletePlaces(placeIds) {
  const state = readState();
  const idSet = new Set(placeIds);
  const beforeCount = state.places.length;

  state.places = state.places.filter((place) => !idSet.has(place.id));
  state.selectedPlaceIds = state.selectedPlaceIds.filter((id) => !idSet.has(id));
  Object.keys(state.yearlyData).forEach((key) => {
    const placeId = Number(String(key).split(":")[0]);
    if (idSet.has(placeId)) {
      delete state.yearlyData[key];
    }
  });

  const removedCount = beforeCount - state.places.length;
  writeState(state);
  return removedCount;
}

// Public storage API exposed globally for app.js.
window.SolarOneStorage = {
  STORAGE_KEY,
  STORAGE_VERSION,
  createDefaultState,
  readState,
  writeState,
  resetState,
  clearAllData,
  bootstrapSeedDataIfNeeded,
  restoreSeedData,
  getPlaces,
  getSelectedPlaceIds,
  setYearlyData,
  getYearlyData,
  hasYearlyData,
  addPlace,
  updatePlace,
  setSelectedPlaceIds,
  toggleSelectedPlace,
  deletePlaces
};
