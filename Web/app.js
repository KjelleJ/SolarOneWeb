// View routing: switches visible panels and keeps map sizes correct after tab changes.
function setActiveView(viewName) {
  const navButtons = document.querySelectorAll("[data-view]");
  const panels = document.querySelectorAll("[data-view-panel]");

  navButtons.forEach((button) => {
    const isActive = button.dataset.view === viewName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });

  panels.forEach((panel) => {
    const isActive = panel.dataset.viewPanel === viewName;
    panel.classList.toggle("d-none", !isActive);
  });

  if (viewName === "world-map" && worldMapInstance) {
    setTimeout(() => worldMapInstance.invalidateSize(), 0);
  }

  if (viewName === "add-place" && addPlaceMapInstance) {
    setTimeout(() => addPlaceMapInstance.invalidateSize(), 0);
  }

  if (viewName === "solar-sector" && solarSectorMapInstance) {
    setTimeout(() => solarSectorMapInstance.invalidateSize(), 0);
  }

  if (viewName === "graphs") {
    // clear any previous drawing so canvas is empty until user triggers Render
    clearGraphCanvas();
  }
}

function setupNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.view);

      // If navbar is collapsed (mobile), hide the collapse after selecting an item
      const collapseEl = document.getElementById("mainNavbar");
      if (collapseEl && window.bootstrap && window.bootstrap.Collapse) {
        const bsCollapse = window.bootstrap.Collapse.getInstance(collapseEl) || new window.bootstrap.Collapse(collapseEl, { toggle: false });
        bsCollapse.hide();
      }
    });
  });
}

function setStatus(message) {
  const status = document.getElementById("app-status");
  if (status) {
    status.textContent = message;
  }
}

function __t(key, fallback, vars) {
  try {
    if (window.SolarOneI18n && typeof window.SolarOneI18n.t === 'function') {
      return window.SolarOneI18n.t(key, vars);
    }
  } catch (e) {}
  return fallback;
}

// Global runtime state (maps, graph render metadata, animation timers).
let worldMapInstance = null;
let worldMapMarkers = [];
let latitudeLines = {
  tropicCancer: null,
  tropicCapricorn: null,
  arcticCircle: null,
  antarcticCircle: null
};
let addPlaceMapInstance = null;
let addPlaceMarker = null;
let solarSectorMapInstance = null;
let solarSectorOsmLayer = null;
let solarSectorSatLayer = null;
let solarSectorPlaceMarker = null;
let solarSectorPolygon = null;
let solarSectorFullDayCircle = null;
let solarSectorRiseLine = null;
let solarSectorSetLine = null;
let solarSectorDirectionArc = null;
let solarSectorDirectionArrow = null;
let solarSectorAnimTimer = null;
let solarSectorZoomRedrawTimer = null;
const TIMEZONE_CACHE_KEY = "solarone.web.timezoneCache.v1";
let graphState = {
  placeId: null,
  secondaryPlaceId: null,
  year: new Date().getFullYear(),
  mode: "rise-set",
  selectedDay: null
};

function getCssColorVariable(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

let graphRenderMeta = null;
const GRAPH_COLORS = {
  firstFill: getCssColorVariable("--graph-first-fill", "rgba(255, 193, 7, 0.28)"),
  secondFill: getCssColorVariable("--graph-second-fill", "rgba(220, 53, 69, 0.28)"),
  firstLine: getCssColorVariable("--graph-first-line", "#b58100"),
  secondLine: getCssColorVariable("--graph-second-line", "#b02a37"),
  firstAccent: "#0d6efd",
  secondAccent: "#6f42c1"
};
let solarSectorState = {
  placeId: null,
  year: new Date().getFullYear(),
  day: 1,
  animIndex: 0,
  animating: false,
  lastCenteredPlaceId: null
};
const INITIAL_SECTOR_ZOOM = 14;

// Shared helpers and yearly-data preparation.
function getCurrentYear() {
  return new Date().getFullYear();
}

function ensureYearlyDataForPlace(place, year) {
  if (!window.SolarOneSolarCalc) {
    return false;
  }

  if (window.SolarOneStorage.hasYearlyData(place.id, year)) {
    return false;
  }

  const yearly = window.SolarOneSolarCalc.computeYearlyData(place, year);
  window.SolarOneStorage.setYearlyData(place.id, year, yearly);
  return true;
}

function ensureYearlyDataForAllPlaces(year) {
  const places = window.SolarOneStorage.getPlaces();
  let generatedCount = 0;

  places.forEach((place) => {
    if (ensureYearlyDataForPlace(place, year)) {
      generatedCount += 1;
    }
  });

  return {
    generatedCount,
    totalPlaces: places.length
  };
}

function runSolarSanityChecks() {
  if (!window.SolarOneSolarCalc) {
    return {
      ok: false,
      checks: []
    };
  }

  const result = window.SolarOneSolarCalc.runSanityChecks();
  if (!result.ok) {
    console.warn("Solar sanity checks reported warnings:", result.checks);
  }
  return result;
}

// -------------------- Graphs --------------------
function setGraphFeedback(message, level) {
  const feedback = document.getElementById("graph-feedback");
  if (!feedback) {
    return;
  }

  feedback.className = "small mb-2";
  if (level === "error") {
    feedback.classList.add("text-danger");
  } else if (level === "success") {
    feedback.classList.add("text-success");
  } else {
    feedback.classList.add("text-secondary");
  }
  feedback.textContent = message;
}

function hideGraphTooltip() {
  const tooltip = document.getElementById("graph-tooltip");
  if (!tooltip) {
    return;
  }
  tooltip.classList.add("d-none");
  tooltip.innerHTML = "";
}

function showGraphTooltip(html, x, y) {
  const tooltip = document.getElementById("graph-tooltip");
  const canvas = document.getElementById("solar-graph-canvas");
  if (!tooltip || !canvas) {
    return;
  }

  tooltip.innerHTML = html;
  tooltip.classList.remove("d-none");

  const rect = canvas.getBoundingClientRect();
  const tooltipWidth = 220;
  const tooltipHeight = 86;
  const left = Math.min(Math.max(8, x + 12), rect.width - tooltipWidth - 8);
  const top = Math.min(Math.max(8, y - tooltipHeight - 10), rect.height - 8);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function getGraphCanvasContext() {
  const canvas = document.getElementById("solar-graph-canvas");
  if (!canvas) {
    return null;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  if (canvas.width !== width) {
    canvas.width = width;
  }
  return {
    canvas,
    context
  };
}

function clearGraphCanvas() {
  const bundle = getGraphCanvasContext();
  if (!bundle) return;
  const { canvas, context } = bundle;
  try {
    context.clearRect(0, 0, canvas.width, canvas.height);
  } catch (e) {}
  // hide tooltip and clear legend
  hideGraphTooltip();
  const colorLegend = document.getElementById("graph-color-legend");
  if (colorLegend) colorLegend.innerHTML = "";
  graphRenderMeta = null;
}

function getMonthStartDays(daysInYear) {
  const monthLengths = daysInYear === 366
    ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  const starts = [];
  let day = 1;
  monthLengths.forEach((length) => {
    starts.push(day);
    day += length;
  });

  // try to get localized month labels from i18n if available
  const months = (window.SolarOneI18n && window.SolarOneI18n.t && window.SolarOneI18n.t('graph.months')) || ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return {
    starts,
    labels: months
  };
}

function drawGraphAxes(context, width, height, options) {
  const margin = { top: 20, right: 14, bottom: 44, left: 58 };
  const plot = {
    x: margin.left,
    y: margin.top,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom
  };

  const yRange = Math.max(1, options.yMax - options.yMin);
  const toY = (value) => plot.y + plot.height - ((value - options.yMin) / yRange) * plot.height;

  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  const monthInfo = getMonthStartDays(options.daysInYear);
  const monthBoundaryColor = "#ced4da";
  const gridColor = "#e9ecef";

  context.lineWidth = 1;
  context.strokeStyle = monthBoundaryColor;
  monthInfo.starts.forEach((monthDay) => {
    const x = scaleX(monthDay, options.daysInYear, plot);
    context.beginPath();
    context.moveTo(x, plot.y);
    context.lineTo(x, plot.y + plot.height);
    context.stroke();
  });

  const yTicks = 8;
  context.strokeStyle = gridColor;
  for (let tick = 0; tick <= yTicks; tick += 1) {
    const ratio = tick / yTicks;
    const y = plot.y + plot.height - (ratio * plot.height);
    context.beginPath();
    context.moveTo(plot.x, y);
    context.lineTo(plot.x + plot.width, y);
    context.stroke();

    const value = options.yMin + ratio * yRange;
    context.fillStyle = "#495057";
    context.font = "11px sans-serif";
    let label = options.yTickFormatter ? options.yTickFormatter(value) : String(Math.round(value));
    // allow caller to omit the top-most y-axis label (useful for hh:mm wrap-around at max)
    if (options.omitTopTickLabel && tick === yTicks) {
      label = "";
    }
    context.fillText(label, 6, y + 4);
  }

  context.strokeStyle = "#222";
  context.lineWidth = 1;
  context.beginPath();
  // draw left Y axis only (remove bottom axis line)
  context.moveTo(plot.x, plot.y);
  context.lineTo(plot.x, plot.y + plot.height);
  context.stroke();

  context.fillStyle = "#444";
  context.font = "12px sans-serif";
  context.fillText(options.labelY, 8, plot.y + 14);

  // month labels (Jan..Dec) centered under the plot
  monthInfo.labels.forEach((label, index) => {
    const startDay = monthInfo.starts[index];
    const endDay = monthInfo.starts[index + 1] || (options.daysInYear + 1);
    const centerDay = startDay + ((endDay - startDay) / 2);
    const x = scaleX(centerDay, options.daysInYear, plot);
    context.fillStyle = "#495057";
    context.font = "11px sans-serif";
    context.fillText(label, x - 10, plot.y + plot.height + 16);
  });

  return {
    plot,
    toY
  };
}

function scaleX(dayOfYear, daysInYear, plot) {
  return plot.x + ((dayOfYear - 1) / Math.max(1, daysInYear - 1)) * plot.width;
}

function drawLine(context, points, color, dashPattern) {
  if (points.length < 2) {
    return;
  }

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.setLineDash(Array.isArray(dashPattern) ? dashPattern : []);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    context.lineTo(points[i].x, points[i].y);
  }
  context.stroke();
  context.setLineDash([]);
}

function fillUnderCurve(context, points, baselineY, fillColor) {
  if (points.length < 2) {
    return;
  }

  context.fillStyle = fillColor;
  context.beginPath();
  context.moveTo(points[0].x, baselineY);
  points.forEach((point) => {
    context.lineTo(point.x, point.y);
  });
  context.lineTo(points[points.length - 1].x, baselineY);
  context.closePath();
  context.fill();
}

function fillBetweenCurves(context, pointsA, pointsB, fillColor) {
  if (pointsA.length < 2 || pointsB.length < 2) {
    return;
  }

  const length = Math.min(pointsA.length, pointsB.length);
  context.fillStyle = fillColor;
  context.beginPath();
  context.moveTo(pointsA[0].x, pointsA[0].y);
  for (let i = 1; i < length; i += 1) {
    context.lineTo(pointsA[i].x, pointsA[i].y);
  }
  for (let i = length - 1; i >= 0; i -= 1) {
    context.lineTo(pointsB[i].x, pointsB[i].y);
  }
  context.closePath();
  context.fill();
}

function drawLegend(context, items, width) {
  context.font = "12px sans-serif";
  // Compute needed width for the longest label so we can keep the legend on-canvas
  const padding = 8;
  const markerWidth = 18; // marker + gap
  const maxLabelWidth = items.reduce((max, it) => Math.max(max, context.measureText(it.label).width), 0);
  let startX = Math.max(padding, width - (markerWidth + Math.ceil(maxLabelWidth) + padding * 2));
  let y = 18;

  items.forEach((item) => {
    context.fillStyle = item.color;
    context.fillRect(startX, y - 8, 12, 3);
    context.fillStyle = "#333";
    context.fillText(item.label, startX + markerWidth, y);
    y += 16;
  });
}

function makeSeriesPoints(yearly, axis, selector) {
  return yearly.daily
    .filter((entry) => Number.isFinite(selector(entry)))
    .map((entry) => ({
      d: entry.d,
      x: scaleX(entry.d, yearly.days, axis.plot),
      y: axis.toY(selector(entry))
    }));
}

function renderRiseSetGraph(context, axis, primaryYearly, secondaryYearly) {
  const risePrimary = makeSeriesPoints(primaryYearly, axis, (entry) => entry.r);
  const setPrimary = makeSeriesPoints(primaryYearly, axis, (entry) => entry.s);
  if (risePrimary.length === 0 || setPrimary.length === 0) {
    return false;
  }

  fillBetweenCurves(context, risePrimary, setPrimary, GRAPH_COLORS.firstFill);
  drawLine(context, risePrimary, GRAPH_COLORS.firstLine);
  drawLine(context, setPrimary, GRAPH_COLORS.firstLine, [6, 4]);

  if (secondaryYearly) {
    const riseSecondary = makeSeriesPoints(secondaryYearly, axis, (entry) => entry.r);
    const setSecondary = makeSeriesPoints(secondaryYearly, axis, (entry) => entry.s);
    if (riseSecondary.length > 1 && setSecondary.length > 1) {
      fillBetweenCurves(context, riseSecondary, setSecondary, GRAPH_COLORS.secondFill);
      drawLine(context, riseSecondary, GRAPH_COLORS.secondLine);
      drawLine(context, setSecondary, GRAPH_COLORS.secondLine, [6, 4]);
    }
  }

  drawLegend(context, [
    { color: GRAPH_COLORS.firstLine, label: __t('graph.legend.riseSet', 'Rise (solid) / Set (dash)') }
  ], context.canvas.width);

  return true;
}

function renderSingleSeriesGraph(context, axis, primaryYearly, secondaryYearly, selector, options) {
  const primaryPoints = makeSeriesPoints(primaryYearly, axis, selector);
  if (primaryPoints.length === 0) {
    return false;
  }

  if (options.fillUnderPrimary) {
    fillUnderCurve(context, primaryPoints, axis.toY(options.baselineValue || 0), GRAPH_COLORS.firstFill);
  }
  drawLine(context, primaryPoints, GRAPH_COLORS.firstLine);

  let secondaryPoints = null;
  if (secondaryYearly) {
    secondaryPoints = makeSeriesPoints(secondaryYearly, axis, selector);
    if (secondaryPoints.length > 1) {
      if (options.fillUnderSecondary) {
        fillUnderCurve(context, secondaryPoints, axis.toY(options.baselineValue || 0), GRAPH_COLORS.secondFill);
      }
      drawLine(context, secondaryPoints, GRAPH_COLORS.secondLine);
    }
  }

  // Optional comparison band between two place curves.
  // We intentionally draw both translucent fills so overlap visually mixes.
  if (options.fillBetween && secondaryPoints && secondaryPoints.length > 1) {
    fillBetweenCurves(context, primaryPoints, secondaryPoints, GRAPH_COLORS.firstFill);
    fillBetweenCurves(context, primaryPoints, secondaryPoints, GRAPH_COLORS.secondFill);
  }

  return true;
}

function drawInspectionMarker(context, axis, dataset, dataset2, mode, day) {
  const entry = dataset.daily.find((item) => item.d === day);
  if (!entry) {
    return null;
  }

  const entry2 = dataset2 ? dataset2.daily.find((item) => item.d === day) : null;

  const x = scaleX(day, dataset.days, axis.plot);
  context.strokeStyle = "#6c757d";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, axis.plot.y);
  context.lineTo(x, axis.plot.y + axis.plot.height);
  context.stroke();

  const points = [];
  if (mode === "rise-set") {
    if (Number.isFinite(entry.r)) points.push({ y: axis.toY(entry.r), color: GRAPH_COLORS.firstAccent });
    if (Number.isFinite(entry.s)) points.push({ y: axis.toY(entry.s), color: GRAPH_COLORS.firstLine });
    if (entry2 && Number.isFinite(entry2.r)) points.push({ y: axis.toY(entry2.r), color: GRAPH_COLORS.secondAccent });
    if (entry2 && Number.isFinite(entry2.s)) points.push({ y: axis.toY(entry2.s), color: GRAPH_COLORS.secondLine });
  } else if (mode === "max-elevation" && Number.isFinite(entry.e)) {
    points.push({ y: axis.toY(entry.e), color: GRAPH_COLORS.firstLine });
    if (entry2 && Number.isFinite(entry2.e)) points.push({ y: axis.toY(entry2.e), color: GRAPH_COLORS.secondLine });
  } else if (mode === "day-length" && Number.isFinite(entry.l)) {
    points.push({ y: axis.toY(entry.l), color: GRAPH_COLORS.firstLine });
    if (entry2 && Number.isFinite(entry2.l)) points.push({ y: axis.toY(entry2.l), color: GRAPH_COLORS.secondLine });
  }

  points.forEach((point) => {
    context.fillStyle = point.color;
    context.beginPath();
    context.arc(x, point.y, 4, 0, Math.PI * 2);
    context.fill();
  });

  const focusY = points.length > 0 ? points[0].y : axis.plot.y + (axis.plot.height / 2);
  return { entry, entry2, x, y: focusY };
}

function buildTooltipHtml(mode, placeName, year, entry, placeName2, entry2) {
  const dateText = `${String(entry.day).padStart(2, "0")}/${String(entry.m).padStart(2, "0")}/${year}`;
  const get = (key, fallback) => (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(key) : fallback;

  if (mode === "rise-set") {
    const second = placeName2 && entry2
      ? `<div class="mt-1"><strong>${placeName2}</strong> · ${get('tooltip.rise','Rise')} ${window.SolarOneSolarCalc.minutesToHHMM(entry2.r) || "--"} · ${get('tooltip.set','Set')} ${window.SolarOneSolarCalc.minutesToHHMM(entry2.s) || "--"}</div>`
      : "";
    return `<div><strong>${placeName}</strong></div><div>${dateText}</div><div>${get('tooltip.rise','Rise')}: ${window.SolarOneSolarCalc.minutesToHHMM(entry.r) || "--"} · ${get('tooltip.set','Set')}: ${window.SolarOneSolarCalc.minutesToHHMM(entry.s) || "--"}</div>${second}`;
  }

  if (mode === "max-elevation") {
    const second = placeName2 && entry2
      ? `<div class="mt-1"><strong>${placeName2}</strong> · ${get('tooltip.maxElevation','Max elevation')}: ${Number.isFinite(entry2.e) ? entry2.e.toFixed(1) : "--"}°</div>`
      : "";
    return `<div><strong>${placeName}</strong></div><div>${dateText}</div><div>${get('tooltip.maxElevation','Max elevation')}: ${Number.isFinite(entry.e) ? entry.e.toFixed(1) : "--"}°</div>${second}`;
  }

  const second = placeName2 && entry2
    ? `<div class="mt-1"><strong>${placeName2}</strong> · ${get('tooltip.dayLength','Day length')}: ${window.SolarOneSolarCalc.durationMinutesToHHMM(entry2.l) || "--"}</div>`
    : "";
  return `<div><strong>${placeName}</strong></div><div>${dateText}</div><div>${get('tooltip.dayLength','Day length')}: ${window.SolarOneSolarCalc.durationMinutesToHHMM(entry.l) || "--"}</div>${second}`;
}

function renderGraph() {
  const placeId = Number(graphState.placeId);
  const _t = (k, f) => (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(k) : f;
  if (!Number.isInteger(placeId)) {
    setGraphFeedback(_t('messages.selectPlaceFirst', 'Select a place first.'), "error");
    return;
  }

  const secondaryPlaceId = Number(graphState.secondaryPlaceId);
  const places = window.SolarOneStorage.getPlaces();
  const primaryPlace = places.find((entry) => entry.id === placeId);
  const secondaryPlace = Number.isInteger(secondaryPlaceId) && secondaryPlaceId !== placeId
    ? places.find((entry) => entry.id === secondaryPlaceId)
    : null;

  if (!primaryPlace || !window.SolarOneSolarCalc) {
    setGraphFeedback(_t('messages.noYearlyData', 'No yearly data available for selected place/year.'), "error");
    return;
  }

  ensureYearlyDataForPlace(primaryPlace, graphState.year);
  if (secondaryPlace) {
    ensureYearlyDataForPlace(secondaryPlace, graphState.year);
  }

  const dataset = window.SolarOneStorage.getYearlyData(primaryPlace.id, graphState.year);
  const dataset2 = secondaryPlace ? window.SolarOneStorage.getYearlyData(secondaryPlace.id, graphState.year) : null;
  const canvasBundle = getGraphCanvasContext();
  if (!canvasBundle || !dataset) {
    setGraphFeedback(_t('messages.graphCanvasUnavailable', 'Graph canvas not available.'), "error");
    return;
  }

  const { canvas, context } = canvasBundle;

  let labelY = "";
  let rendered = false;
  let yMin = 0;
  let yMax = 1;
  let yTickFormatter = (value) => String(Math.round(value));

  if (graphState.mode === "rise-set") {
    const validRise = dataset.daily.filter((entry) => Number.isFinite(entry.r)).map((entry) => entry.r);
    const validSet = dataset.daily.filter((entry) => Number.isFinite(entry.s)).map((entry) => entry.s);
    const validRise2 = dataset2 ? dataset2.daily.filter((entry) => Number.isFinite(entry.r)).map((entry) => entry.r) : [];
    const validSet2 = dataset2 ? dataset2.daily.filter((entry) => Number.isFinite(entry.s)).map((entry) => entry.s) : [];
    if (validRise.length === 0 || validSet.length === 0) {
      setGraphFeedback(_t('messages.insufficientData', 'Insufficient data for selected graph mode.'), "error");
      return;
    }
    yMin = Math.min(...validRise, ...validSet, ...(validRise2.length ? validRise2 : [Infinity]), ...(validSet2.length ? validSet2 : [Infinity]));
    yMax = Math.max(...validRise, ...validSet, ...(validRise2.length ? validRise2 : [-Infinity]), ...(validSet2.length ? validSet2 : [-Infinity]));
    yTickFormatter = (value) => window.SolarOneSolarCalc.durationMinutesToHHMM(value) || "--";
  } else if (graphState.mode === "max-elevation") {
    const valid = dataset.daily.filter((entry) => Number.isFinite(entry.e)).map((entry) => entry.e);
    const valid2 = dataset2 ? dataset2.daily.filter((entry) => Number.isFinite(entry.e)).map((entry) => entry.e) : [];
    yMin = 0;
    yMax = Math.max(90, ...valid, ...(valid2.length ? valid2 : [0]));
  } else if (graphState.mode === "day-length") {
    const valid = dataset.daily.filter((entry) => Number.isFinite(entry.l)).map((entry) => entry.l);
    const valid2 = dataset2 ? dataset2.daily.filter((entry) => Number.isFinite(entry.l)).map((entry) => entry.l) : [];
    yMin = 0;
    yMax = Math.max(1440, ...valid, ...(valid2.length ? valid2 : [0]));
    yTickFormatter = (value) => window.SolarOneSolarCalc.minutesToHHMM(value) || "--";
  }

  // localized Y label
  const yLabelKey = graphState.mode === "rise-set" ? 'graph.label.time' : (graphState.mode === 'max-elevation' ? 'graph.label.deg' : (graphState.mode === 'day-length' ? 'graph.label.daylength' : 'graph.label.time'));
  const yLabelLocalized = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(yLabelKey) : (graphState.mode === "rise-set" ? "Time" : graphState.mode === "max-elevation" ? "Deg" : (graphState.mode === "day-length" ? "hh:mm" : "Min"));

  const axis = drawGraphAxes(context, canvas.width, canvas.height, {
    labelY: yLabelLocalized,
    daysInYear: dataset.days,
    yMin,
    yMax,
    yTickFormatter,
    omitTopTickLabel: graphState.mode === "day-length"
  });

  // use localized label for Y axis/legend
  labelY = yLabelLocalized;
  if (graphState.mode === "rise-set") {
    rendered = renderRiseSetGraph(context, axis, dataset, dataset2);
  } else if (graphState.mode === "max-elevation") {
    rendered = renderSingleSeriesGraph(context, axis, dataset, dataset2, (entry) => entry.e, {
      fillBetween: false,
      fillUnderPrimary: true,
      fillUnderSecondary: Boolean(dataset2),
      baselineValue: 0
    });
  } else if (graphState.mode === "day-length") {
    rendered = renderSingleSeriesGraph(context, axis, dataset, dataset2, (entry) => entry.l, {
      fillBetween: false,
      fillUnderPrimary: true,
      fillUnderSecondary: Boolean(dataset2),
      baselineValue: 0
    });
  }

    if (!rendered) {
    setGraphFeedback(__t('messages.insufficientData', 'Insufficient data for selected graph mode.'), 'error');
    return;
  }

  graphRenderMeta = {
    dataset,
    dataset2,
    axis,
    placeName: primaryPlace ? primaryPlace.name : "Place",
    placeName2: secondaryPlace ? secondaryPlace.name : null,
    placeId,
    year: graphState.year,
    mode: graphState.mode,
    canvas
  };

  if (Number.isInteger(graphState.selectedDay)) {
    const marker = drawInspectionMarker(context, axis, dataset, dataset2, graphState.mode, graphState.selectedDay);
    if (marker) {
      const html = buildTooltipHtml(
        graphState.mode,
        graphRenderMeta.placeName,
        graphState.year,
        marker.entry,
        graphRenderMeta.placeName2,
        marker.entry2
      );
      showGraphTooltip(html, marker.x, marker.y);
    } else {
      hideGraphTooltip();
    }
  } else {
    hideGraphTooltip();
  }

  // metadata text below graph intentionally removed to keep UI minimal

  const colorLegend = document.getElementById("graph-color-legend");
  if (colorLegend) {
    // build place chips
    const firstChip = `<span class="d-inline-flex align-items-center"><span class="rounded-circle me-1" style="width:10px;height:10px;background:${GRAPH_COLORS.firstFill};border:1px solid ${GRAPH_COLORS.firstLine};display:inline-block;"></span>${primaryPlace.name}</span>`;
    const secondChip = secondaryPlace
      ? `<span class="d-inline-flex align-items-center"><span class="rounded-circle me-1" style="width:10px;height:10px;background:${GRAPH_COLORS.secondFill};border:1px solid ${GRAPH_COLORS.secondLine};display:inline-block;"></span>${secondaryPlace.name}</span>`
      : "";

    const modeText = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(`graph.modes.${graphState.mode}`) : (graphState.mode === 'rise-set' ? 'Rise & Set' : (graphState.mode === 'max-elevation' ? 'Max Elevation' : (graphState.mode === 'day-length' ? 'Length of Day' : graphState.mode)));

    // center the legend and put bold title first
    colorLegend.className = "mb-2 text-center";
    colorLegend.innerHTML = `
      <div class="d-inline-flex align-items-center justify-content-center gap-3">
        <span class="fw-bold">${modeText}</span>
        ${firstChip}
        ${secondChip}
      </div>
    `;
  }

  // clear any leftover metadata text that might remain on the canvas (left-bottom)
  try {
    context.clearRect(0, canvas.height - 20, canvas.width, 20);
    // redraw month labels so they remain visible after clearing
    const monthInfo = getMonthStartDays(dataset.days);
    monthInfo.labels.forEach((label, index) => {
      const startDay = monthInfo.starts[index];
      const endDay = monthInfo.starts[index + 1] || (dataset.days + 1);
      const centerDay = startDay + ((endDay - startDay) / 2);
      const x = scaleX(centerDay, dataset.days, axis.plot);
      context.fillStyle = "#495057";
      context.font = "11px sans-serif";
      context.fillText(label, x - 10, axis.plot.y + axis.plot.height + 16);
    });
  } catch (e) {
    // ignore canvas clearing errors
  }

  // removed automatic "Graph rendered" feedback to keep UI minimal
}

function handleGraphCanvasClick(event) {
  if (!graphRenderMeta || !graphRenderMeta.axis || !graphRenderMeta.dataset) {
    return;
  }

  const rect = graphRenderMeta.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const plot = graphRenderMeta.axis.plot;

  if (x < plot.x || x > plot.x + plot.width || y < plot.y || y > plot.y + plot.height) {
    graphState.selectedDay = null;
    hideGraphTooltip();
    renderGraph();
    return;
  }

  const dayFloat = 1 + ((x - plot.x) / plot.width) * Math.max(1, graphRenderMeta.dataset.days - 1);
  const selectedDay = Math.max(1, Math.min(graphRenderMeta.dataset.days, Math.round(dayFloat)));
  graphState.selectedDay = selectedDay;
  renderGraph();
}

function setupGraphs() {
  const placeSelect = document.getElementById("graph-place-select");
  const placeSelect2 = document.getElementById("graph-place-select-2");
  const yearInput = document.getElementById("graph-year-input");
  const modeSelect = document.getElementById("graph-mode-select");
  const renderButton = document.getElementById("graph-render-button");
  const prevButton = document.getElementById("graph-year-prev");
  const nextButton = document.getElementById("graph-year-next");
  const canvas = document.getElementById("solar-graph-canvas");

  if (!placeSelect || !placeSelect2 || !yearInput || !modeSelect || !renderButton || !prevButton || !nextButton || !canvas) {
    return;
  }

  const places = window.SolarOneStorage.getPlaces();
  placeSelect.innerHTML = "";
  placeSelect2.innerHTML = "";

  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = __t('controls.none', 'None');
  placeSelect2.appendChild(noneOption);

  places.forEach((place) => {
    const option = document.createElement("option");
    option.value = String(place.id);
    option.textContent = place.name;
    placeSelect.appendChild(option);

    const option2 = document.createElement("option");
    option2.value = String(place.id);
    option2.textContent = place.name;
    placeSelect2.appendChild(option2);
  });

  if (!graphState.placeId && places.length > 0) {
    graphState.placeId = places[0].id;
  }

  placeSelect.value = graphState.placeId ? String(graphState.placeId) : "";
  placeSelect2.value = graphState.secondaryPlaceId ? String(graphState.secondaryPlaceId) : "";
  yearInput.value = String(graphState.year);
  modeSelect.value = graphState.mode;

  placeSelect.addEventListener("change", () => {
    graphState.placeId = Number(placeSelect.value);
    if (graphState.secondaryPlaceId === graphState.placeId) {
      graphState.secondaryPlaceId = null;
      placeSelect2.value = "";
    }
    graphState.selectedDay = null;
  });

  placeSelect2.addEventListener("change", () => {
    const value = placeSelect2.value;
    graphState.secondaryPlaceId = value ? Number(value) : null;
    if (graphState.secondaryPlaceId === graphState.placeId) {
      graphState.secondaryPlaceId = null;
      placeSelect2.value = "";
    }
    graphState.selectedDay = null;
  });

  yearInput.addEventListener("change", () => {
    const parsed = Number(yearInput.value);
    graphState.year = Number.isInteger(parsed) ? parsed : getCurrentYear();
    yearInput.value = String(graphState.year);
    graphState.selectedDay = null;
  });

  modeSelect.addEventListener("change", () => {
    graphState.mode = modeSelect.value;
    graphState.selectedDay = null;
  });

  prevButton.addEventListener("click", () => {
    graphState.year -= 1;
    yearInput.value = String(graphState.year);
    graphState.selectedDay = null;
    renderGraph();
  });

  nextButton.addEventListener("click", () => {
    graphState.year += 1;
    yearInput.value = String(graphState.year);
    graphState.selectedDay = null;
    renderGraph();
  });

  renderButton.addEventListener("click", () => {
    graphState.placeId = Number(placeSelect.value);
    graphState.secondaryPlaceId = placeSelect2.value ? Number(placeSelect2.value) : null;
    if (graphState.secondaryPlaceId === graphState.placeId) {
      graphState.secondaryPlaceId = null;
      placeSelect2.value = "";
    }
    graphState.year = Number(yearInput.value) || getCurrentYear();
    graphState.mode = modeSelect.value;
    graphState.selectedDay = null;
    renderGraph();
  });

  canvas.addEventListener("click", handleGraphCanvasClick);
}

function refreshGraphPlaceSelector() {
  const placeSelect = document.getElementById("graph-place-select");
  const placeSelect2 = document.getElementById("graph-place-select-2");
  if (!placeSelect || !placeSelect2) {
    return;
  }

  const places = window.SolarOneStorage.getPlaces();
  // prefer currently selected places from world map: first => primary, second => secondary
  const selectedPlaces = places.filter((p) => p.selected);

  placeSelect.innerHTML = "";
  placeSelect2.innerHTML = "";

  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = __t('controls.none', 'None');
  placeSelect2.appendChild(noneOption);

  places.forEach((place) => {
    const option = document.createElement("option");
    option.value = String(place.id);
    option.textContent = place.name;
    placeSelect.appendChild(option);

    const option2 = document.createElement("option");
    option2.value = String(place.id);
    option2.textContent = place.name;
    placeSelect2.appendChild(option2);
  });

  if (places.length === 0) {
    graphState.placeId = null;
    graphState.secondaryPlaceId = null;
    return;
  }

  if (selectedPlaces.length > 0) {
    graphState.placeId = selectedPlaces[0].id;
    graphState.secondaryPlaceId = selectedPlaces[1] ? selectedPlaces[1].id : null;
  } else {
    // fallback: preserve previous or pick first place
    graphState.placeId = graphState.placeId && places.some((pl) => pl.id === graphState.placeId) ? graphState.placeId : places[0].id;
    graphState.secondaryPlaceId = graphState.secondaryPlaceId && places.some((pl) => pl.id === graphState.secondaryPlaceId && pl.id !== graphState.placeId) ? graphState.secondaryPlaceId : null;
  }

  placeSelect.value = graphState.placeId ? String(graphState.placeId) : "";
  placeSelect2.value = graphState.secondaryPlaceId ? String(graphState.secondaryPlaceId) : "";
}

// -------------------- World Map --------------------
function clearMarkers() {
  worldMapMarkers.forEach((marker) => marker.remove());
  worldMapMarkers = [];
}

function ensureWorldMap() {
  if (worldMapInstance || !window.L) {
    return;
  }

  worldMapInstance = window.L.map("world-map-canvas", {
    center: [15, 0],
    zoom: 2,
    minZoom: 2,
    worldCopyJump: true
  });

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(worldMapInstance);

  // draw latitude reference lines (tropics and polar circles)
  renderLatitudeLines();
}

function renderLatitudeLines() {
  if (!worldMapInstance || !window.L) return;

  // remove existing lines and their tooltips
  Object.keys(latitudeLines).forEach((k) => {
    const entry = latitudeLines[k];
    if (!entry) return;
    if (entry.poly && worldMapInstance.hasLayer(entry.poly)) {
      worldMapInstance.removeLayer(entry.poly);
    }
    if (entry.marker && worldMapInstance.hasLayer(entry.marker)) {
      worldMapInstance.removeLayer(entry.marker);
    }
    if (entry.tooltip && worldMapInstance.hasLayer(entry.tooltip)) {
      worldMapInstance.removeLayer(entry.tooltip);
    }
    latitudeLines[k] = null;
  });

  const specs = [
    { key: 'tropicCancer', name: 'Tropic of Cancer', lat: 23.44, color: '#ff8c00', dash: '6 6' },
    { key: 'tropicCapricorn', name: 'Tropic of Capricorn', lat: -23.44, color: '#ff8c00', dash: '6 6' },
    { key: 'arcticCircle', name: 'Arctic Circle', lat: 66.56, color: '#0dcaf0', dash: '4 4' },
    { key: 'antarcticCircle', name: 'Antarctic Circle', lat: -66.56, color: '#0dcaf0', dash: '4 4' }
  ];

  specs.forEach((spec) => {
    const points = [];
    for (let lon = -180; lon <= 180; lon += 6) {
      points.push([spec.lat, lon]);
    }

    const poly = window.L.polyline(points, {
      color: spec.color,
      weight: 2,
      dashArray: spec.dash,
      interactive: false
    }).addTo(worldMapInstance);
    // create a separate permanent tooltip at longitude 0
    const tooltip = window.L.tooltip({
      permanent: true,
      direction: 'center',
      className: 'map-lat-label'
    }).setLatLng([spec.lat, 0]).setContent(`${spec.name} (${Math.abs(spec.lat).toFixed(2)}°${spec.lat > 0 ? 'N' : 'S'})`).addTo(worldMapInstance);
    // attempt to use i18n name if available
    try {
      const tKey = `sector.${spec.key}`;
      const displayName = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(tKey) : spec.name;
      tooltip.setContent(`${displayName} (${Math.abs(spec.lat).toFixed(2)}°${spec.lat > 0 ? 'N' : 'S'})`);
    } catch (e) {
      // ignore
    }

    latitudeLines[spec.key] = { poly, tooltip };
  });

  // Prime Meridian (longitude 0)
  try {
    const meridianPoints = [];
    for (let lat = -90; lat <= 90; lat += 3) {
      meridianPoints.push([lat, 0]);
    }
    const arcticColor = (latitudeLines && latitudeLines.arcticCircle && latitudeLines.arcticCircle.poly && latitudeLines.arcticCircle.poly.options && latitudeLines.arcticCircle.poly.options.color) ? latitudeLines.arcticCircle.poly.options.color : '#0dcaf0';
    const meridian = window.L.polyline(meridianPoints, {
      color: arcticColor,
      weight: 2,
      dashArray: '4 4',
      interactive: false
    }).addTo(worldMapInstance);

    const meridianTooltip = window.L.tooltip({
      permanent: true,
      direction: 'center',
      className: 'map-lat-label'
    }).setLatLng([0, 0]).setContent('Prime Meridian (0°)').addTo(worldMapInstance);
    try {
      const pm = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('sector.primeMeridian') : 'Prime Meridian (0°)';
      meridianTooltip.setContent(pm);
    } catch (e) {}

    latitudeLines['primeMeridian'] = { poly: meridian, tooltip: meridianTooltip };
  } catch (e) {
    console.warn('Could not render prime meridian', e);
  }

  // Add markers for the poles (use slightly inset latitudes for reliable rendering)
  try {
    const northLat = 89.999;
    const southLat = -89.999;

    const northMarker = window.L.circleMarker([northLat, 0], {
      radius: 6,
      color: '#FFD400',
      fillColor: '#FFD400',
      fillOpacity: 1,
      weight: 1,
      interactive: false
    }).addTo(worldMapInstance);

    const northTooltip = window.L.tooltip({
      permanent: true,
      direction: 'center',
      className: 'map-lat-label'
    }).setLatLng([northLat, 0]).setContent('North Pole').addTo(worldMapInstance);
    try {
      const np = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('sector.northPole') : 'North Pole';
      northTooltip.setContent(np);
    } catch (e) {}

    latitudeLines['northPole'] = { marker: northMarker, tooltip: northTooltip };

    const southMarker = window.L.circleMarker([southLat, 0], {
      radius: 6,
      color: '#FFD400',
      fillColor: '#FFD400',
      fillOpacity: 1,
      weight: 1,
      interactive: false
    }).addTo(worldMapInstance);

    const southTooltip = window.L.tooltip({
      permanent: true,
      direction: 'center',
      className: 'map-lat-label'
    }).setLatLng([southLat, 0]).setContent('South Pole').addTo(worldMapInstance);
    try {
      const sp = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('sector.southPole') : 'South Pole';
      southTooltip.setContent(sp);
    } catch (e) {}

    latitudeLines['southPole'] = { marker: southMarker, tooltip: southTooltip };
  } catch (e) {
    // ignore failures rendering extreme-latitude markers
    console.warn('Could not render pole markers', e);
  }
}

function markerIcon(isSelected) {
  const fill = isSelected ? "#dc3545" : "#ffc107";
  const svg = `
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M13 1C8 1 4 5 4 10c0 7 9 18 9 18s9-11 9-18c0-5-4-9-9-9z" fill="${fill}" stroke="#000" stroke-width="1"/>
      <ellipse cx="9" cy="9" rx="3" ry="2" fill="rgba(255,255,255,0.6)" />
      <path d="M11 28c0 2 4 4 4 4s4-2 4-4" fill="none" stroke="#000" stroke-width="1"/>
    </svg>`;

  return window.L.divIcon({
    className: "leaflet-marker-icon-custom",
    html: svg,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -34]
  });
}

function renderSelectionSummary(places) {
  const selectedCount = places.filter((place) => place.selected).length;
  const summary = document.getElementById("world-map-selection-summary");
  if (summary) {
    try {
      const txt = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('messages2.selectionSummary', { selected: selectedCount, total: places.length }) : `Selected places: ${selectedCount} / ${places.length}`;
      summary.textContent = txt;
    } catch (e) {
      summary.textContent = `Selected places: ${selectedCount} / ${places.length}`;
    }
  }
}

function renderWorldMapPlaceholder(places) {
  const list = document.getElementById("world-map-place-list");
  if (!list) {
    // list removed from layout — still update selection summary
    renderSelectionSummary(places);
    return;
  }

  list.innerHTML = "";
  places.forEach((place) => {
    const item = document.createElement("li");
    item.className = "list-group-item";

    const row = document.createElement("div");
    row.className = "d-flex justify-content-between align-items-center";

    const left = document.createElement("div");
    left.className = "d-flex align-items-center";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "form-check-input me-2";
    checkbox.id = `place-list-check-${place.id}`;
    checkbox.checked = Boolean(place.selected);

    const label = document.createElement("label");
    label.className = "mb-0";
    label.setAttribute("for", checkbox.id);
    label.textContent = `${place.name} (${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)})`;

    left.appendChild(checkbox);
    left.appendChild(label);

    const badge = document.createElement("span");
    badge.className = `badge ${place.selected ? "text-bg-danger" : "text-bg-warning"}`;
    try {
      const selText = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(place.selected ? 'messages.selected' : 'messages.notSelected') : (place.selected ? 'Selected' : 'Not selected');
      badge.textContent = selText;
    } catch (e) {
      badge.textContent = place.selected ? "Selected" : "Not selected";
    }

    row.appendChild(left);
    row.appendChild(badge);
    item.appendChild(row);
    list.appendChild(item);

    // checkbox change toggles selection and refreshes UI
    checkbox.addEventListener("change", (e) => {
      // toggleSelectedPlace flips stored selected state
      window.SolarOneStorage.toggleSelectedPlace(place.id);
      renderWorldMapData();
    });

    // clicking the whole list item (except the checkbox) should also toggle selection
    item.addEventListener("click", (e) => {
      if (e.target === checkbox || e.target.closest("input") ) {
        return;
      }
      window.SolarOneStorage.toggleSelectedPlace(place.id);
      renderWorldMapData();
    });
  });

  renderSelectionSummary(places);
}

function handleMarkerToggle(place) {
  window.SolarOneStorage.toggleSelectedPlace(place.id);
  renderWorldMapData();
}

function renderMarkers(places) {
  if (!worldMapInstance || !window.L) {
    return;
  }

  clearMarkers();

  places.forEach((place) => {
    const marker = window.L.marker([place.latitude, place.longitude], {
      icon: markerIcon(place.selected)
    })
      .addTo(worldMapInstance);
    try {
      const latLabel = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('labels.latitude') : 'Lat';
      const lngLabel = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('labels.longitude') : 'Lng';
      const selText = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(place.selected ? 'messages.selected' : 'messages.notSelected') : (place.selected ? 'Selected' : 'Not selected');
      marker.bindPopup(`<strong>${place.name}</strong><br/>${latLabel}: ${place.latitude.toFixed(4)}<br/>${lngLabel}: ${place.longitude.toFixed(4)}<br/>${selText}`);
    } catch (e) {
      marker.bindPopup(`<strong>${place.name}</strong><br/>Lat: ${place.latitude.toFixed(4)}<br/>Lng: ${place.longitude.toFixed(4)}<br/>${place.selected ? "Selected" : "Not selected"}`);
    }

    marker.on("click", () => {
      handleMarkerToggle(place);
    });

    worldMapMarkers.push(marker);
  });
}

function renderPlacesDialog(places) {
  const list = document.getElementById("places-dialog-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  places.forEach((place) => {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check mb-1";

    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "checkbox";
    input.id = `place-check-${place.id}`;
    input.value = String(place.id);
    input.checked = place.selected;

    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", input.id);
    label.textContent = place.name;

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    list.appendChild(wrapper);
  });
}

function renderWorldMapData() {
  const places = window.SolarOneStorage.getPlaces();
  renderWorldMapPlaceholder(places);
  renderMarkers(places);
  renderPlacesDialog(places);
  refreshGraphPlaceSelector();
  refreshSolarSectorPlaceSelector();
  const year = getCurrentYear();
  const readyCount = places.filter((place) => window.SolarOneStorage.hasYearlyData(place.id, year)).length;
  setStatus(__t('status.ready', `Ready · local places: ${places.length} · yearly data: ${readyCount}/${places.length} (${year})`, { places: places.length, readyCount, year }));
}

function applyDialogSelection() {
  const checks = Array.from(document.querySelectorAll("#places-dialog-list input[type='checkbox']"));
  const selectedIds = checks.filter((input) => input.checked).map((input) => Number(input.value));
  window.SolarOneStorage.setSelectedPlaceIds(selectedIds);
  renderWorldMapData();
}

function setupWorldMapActions() {
  const openDialogButton = document.getElementById("open-places-dialog");
  const applyDialogButton = document.getElementById("apply-places-selection");
  const deleteButton = document.getElementById("delete-selected-places");
  const restoreButton = document.getElementById("restore-starter-places");
  const dialog = document.getElementById("places-dialog");

  if (openDialogButton && dialog) {
    openDialogButton.addEventListener("click", () => {
      renderPlacesDialog(window.SolarOneStorage.getPlaces());
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      }
    });
  }

  if (applyDialogButton) {
    applyDialogButton.addEventListener("click", () => {
      applyDialogSelection();
    });
  }

  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      const selectedIds = window.SolarOneStorage.getSelectedPlaceIds();
      if (selectedIds.length === 0) {
        window.alert(__t('alerts.noPlacesSelected', 'No places selected.'));
        return;
      }

      const removedCount = window.SolarOneStorage.deletePlaces(selectedIds);
      renderWorldMapData();
      window.alert(__t('alerts.deletedPlaces', `Deleted ${removedCount} place(s).`, { count: removedCount }));
    });
  }

  if (restoreButton) {
    restoreButton.addEventListener("click", () => {
      const state = window.SolarOneStorage.restoreSeedData();
      renderWorldMapData();
      window.alert(__t('alerts.restoredPlaces', `Restored ${state.places.length} starter place(s).`, { count: state.places.length }));
    });
  }
}

// -------------------- Add Place --------------------
function setAddPlaceFeedback(message, level) {
  const feedback = document.getElementById("add-place-feedback");
  if (!feedback) {
    return;
  }

  feedback.className = "small mb-2";
  if (level === "error") {
    feedback.classList.add("text-danger");
  } else if (level === "success") {
    feedback.classList.add("text-success");
  } else {
    feedback.classList.add("text-secondary");
  }

  feedback.textContent = message;
}

function getAddPlaceFormValues() {
  const name = document.getElementById("add-place-name")?.value.trim() || "";
  const latitudeRaw = document.getElementById("add-place-latitude")?.value || "";
  const longitudeRaw = document.getElementById("add-place-longitude")?.value || "";
  const timezoneId = document.getElementById("add-place-timezone")?.value.trim() || "Etc/UTC";
  const usesDst = Boolean(document.getElementById("add-place-uses-dst")?.checked);

  return {
    name,
    latitudeRaw,
    longitudeRaw,
    latitude: Number(latitudeRaw),
    longitude: Number(longitudeRaw),
    timezoneId,
    usesDst
  };
}

function validateAddPlace(values) {
  if (!values.name) {
    return __t('validation.placeNameRequired', 'Place name is required.');
  }

  if (!Number.isFinite(values.latitude) || values.latitude < -90 || values.latitude > 90) {
    return __t('validation.latitudeRange', 'Latitude must be between -90 and 90.');
  }

  if (!Number.isFinite(values.longitude) || values.longitude < -180 || values.longitude > 180) {
    return __t('validation.longitudeRange', 'Longitude must be between -180 and 180.');
  }

  return null;
}

function updateAddPlaceMarker(latitude, longitude, popupText) {
  if (!addPlaceMapInstance || !window.L) {
    return;
  }

  if (!addPlaceMarker) {
    addPlaceMarker = window.L.marker([latitude, longitude]).addTo(addPlaceMapInstance);
  } else {
    addPlaceMarker.setLatLng([latitude, longitude]);
  }

  if (popupText) {
    try {
      const pt = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(popupText) : popupText;
      addPlaceMarker.bindPopup(pt).openPopup();
    } catch (e) {
      addPlaceMarker.bindPopup(popupText).openPopup();
    }
  }
}

function setAddPlaceCoordinates(latitude, longitude, fromMapClick) {
  const latInput = document.getElementById("add-place-latitude");
  const lngInput = document.getElementById("add-place-longitude");
  if (latInput) latInput.value = latitude.toFixed(4);
  if (lngInput) lngInput.value = longitude.toFixed(4);

  updateAddPlaceMarker(latitude, longitude, fromMapClick ? 'addPlace.pickedFromMap' : 'addPlace.locationSet');
}

function readTimezoneCache() {
  try {
    const raw = localStorage.getItem(TIMEZONE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeTimezoneCache(cache) {
  localStorage.setItem(TIMEZONE_CACHE_KEY, JSON.stringify(cache));
}

function cacheKeyForCoordinates(latitude, longitude) {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

function getZoneOffsetMinutesAt(date, timeZoneId) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZoneId,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  const utcTime = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return (utcTime - date.getTime()) / 60000;
}

function inferDstUsage(timeZoneId) {
  try {
    const now = new Date();
    const year = now.getUTCFullYear();
    const jan = new Date(Date.UTC(year, 0, 1, 12, 0, 0));
    const jul = new Date(Date.UTC(year, 6, 1, 12, 0, 0));
    const janOffset = getZoneOffsetMinutesAt(jan, timeZoneId);
    const julOffset = getZoneOffsetMinutesAt(jul, timeZoneId);
    return janOffset !== julOffset;
  } catch {
    return false;
  }
}

async function lookupTimezoneByCoordinates(latitude, longitude) {
  const cache = readTimezoneCache();
  const key = cacheKeyForCoordinates(latitude, longitude);
  if (cache[key]) {
    return cache[key];
  }

  const endpoint = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&daily=sunrise&timezone=auto&forecast_days=1`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Timezone lookup failed (${response.status}).`);
  }

  const payload = await response.json();
  if (!payload || typeof payload.timezone !== "string" || payload.timezone.length === 0) {
    throw new Error("Timezone could not be determined.");
  }

  const result = {
    timezoneId: payload.timezone,
    usesDst: inferDstUsage(payload.timezone)
  };

  cache[key] = result;
  writeTimezoneCache(cache);
  return result;
}

async function autoFillTimezoneAndDst(latitude, longitude) {
  const timezoneInput = document.getElementById("add-place-timezone");
  const dstCheckbox = document.getElementById("add-place-uses-dst");

  setAddPlaceFeedback(__t('addPlace.lookingUpTimezone', 'Looking up timezone and DST…'), 'neutral');
  try {
    const match = await lookupTimezoneByCoordinates(latitude, longitude);
    if (timezoneInput) {
      timezoneInput.value = match.timezoneId;
    }
    if (dstCheckbox) {
      dstCheckbox.checked = match.usesDst;
    }
    setAddPlaceFeedback(__t('addPlace.timezoneSet', `Timezone set to ${match.timezoneId}. DST ${match.usesDst ? "enabled" : "disabled"} by rule inference.`, { timezoneId: match.timezoneId, dst: match.usesDst ? 'enabled' : 'disabled' }), 'success');
  } catch (error) {
    setAddPlaceFeedback(__t('addPlace.timezoneErrorFallback', `${error.message} Keep manual timezone/DST values or retry.`, { error: error.message }), 'error');
  }
}

function ensureAddPlaceMap() {
  if (addPlaceMapInstance || !window.L) {
    return;
  }

  addPlaceMapInstance = window.L.map("add-place-map", {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    worldCopyJump: true
  });

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(addPlaceMapInstance);

  addPlaceMapInstance.on("click", (event) => {
    const { lat, lng } = event.latlng;
    setAddPlaceCoordinates(lat, lng, true);
    autoFillTimezoneAndDst(lat, lng);
  });
}

async function geocodePlaceByName(placeName) {
  const endpoint = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(placeName)}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Geocoding failed (${response.status}).`);
  }

  const result = await response.json();
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error("No place match found.");
  }

  const first = result[0];
  return {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    displayName: first.display_name || placeName
  };
}

function setupAddPlaceActions() {
  const form = document.getElementById("add-place-form");
  const geocodeButton = document.getElementById("add-place-geocode");
  const clearButton = document.getElementById("add-place-clear");
  const latInput = document.getElementById("add-place-latitude");
  const lngInput = document.getElementById("add-place-longitude");

  if (geocodeButton) {
    geocodeButton.addEventListener("click", async () => {
      const values = getAddPlaceFormValues();
      if (!values.name) {
        setAddPlaceFeedback(__t('addPlace.enterPlaceNameFirst', 'Enter place name first.'), 'error');
        return;
      }

      setAddPlaceFeedback(__t('addPlace.searchingGeocoder', 'Searching place using no-key geocoder…'), 'neutral');
      try {
        const match = await geocodePlaceByName(values.name);
        setAddPlaceCoordinates(match.latitude, match.longitude, false);
        if (addPlaceMapInstance) {
          addPlaceMapInstance.setView([match.latitude, match.longitude], 9);
        }
        setAddPlaceFeedback(__t('addPlace.foundVerifyingTimezone', `Found: ${match.displayName}. Verifying timezone/DST…`, { displayName: match.displayName }), 'neutral');
        await autoFillTimezoneAndDst(match.latitude, match.longitude);
      } catch (error) {
        setAddPlaceFeedback(__t('addPlace.geocodeErrorFallback', `${error.message} You can still set coordinates manually or by map click.`, { error: error.message }), 'error');
      }
    });
  }

  if (latInput && lngInput) {
    const updateFromInputs = () => {
      const values = getAddPlaceFormValues();
      if (Number.isFinite(values.latitude) && Number.isFinite(values.longitude)) {
        updateAddPlaceMarker(values.latitude, values.longitude);
      }
    };

    latInput.addEventListener("change", updateFromInputs);
    lngInput.addEventListener("change", updateFromInputs);
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      if (form instanceof HTMLFormElement) {
        form.reset();
      }

      const tz = document.getElementById("add-place-timezone");
      if (tz) {
        tz.value = "Etc/UTC";
      }

      const dst = document.getElementById("add-place-uses-dst");
      if (dst) {
        dst.checked = false;
      }

      if (addPlaceMarker) {
        addPlaceMarker.remove();
        addPlaceMarker = null;
      }

      setAddPlaceFeedback(__t('addPlace.formCleared', 'Form cleared.'), 'neutral');
    });
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = getAddPlaceFormValues();
      const validationError = validateAddPlace(values);
      if (validationError) {
        setAddPlaceFeedback(validationError, "error");
        return;
      }

      const place = window.SolarOneStorage.addPlace({
        name: values.name,
        latitude: values.latitude,
        longitude: values.longitude,
        timezoneId: values.timezoneId,
        usesDst: values.usesDst
      });

      const year = getCurrentYear();
      ensureYearlyDataForPlace(place, year);

      renderWorldMapData();
      setAddPlaceFeedback(__t('addPlace.savedAdded', `Saved ${place.name}. Added to world map with precomputed ${year} solar data.`, { name: place.name, year }), 'success');
      setActiveView("world-map");
    });
  }
}

// -------------------- Solar Sector --------------------
function setSectorFeedback(message, level) {
  const feedback = document.getElementById("sector-feedback");
  if (!feedback) {
    return;
  }

  feedback.className = "small mb-2";
  if (level === "error") {
    feedback.classList.add("text-danger");
  } else if (level === "success") {
    feedback.classList.add("text-success");
  } else {
    feedback.classList.add("text-secondary");
  }
  feedback.textContent = message;
}

function dayToDateLabel(entry, year) {
  if (!entry) {
    return "";
  }
  const dayWord = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('sector.dayLabel', 'day') : 'day';
  return `${String(entry.day).padStart(2, "0")}/${String(entry.m).padStart(2, "0")}/${year} (${dayWord} ${entry.d})`;
}

function getDaysInYear(year) {
  return window.SolarOneSolarCalc && window.SolarOneSolarCalc.isLeapYear(year) ? 366 : 365;
}

function clampSectorDay() {
  const max = getDaysInYear(solarSectorState.year);
  if (solarSectorState.day > max) {
    solarSectorState.day = max;
  }
  if (solarSectorState.day < 1) {
    solarSectorState.day = 1;
  }
}

function wrapSectorDay(delta) {
  const max = getDaysInYear(solarSectorState.year);
  let day = solarSectorState.day + delta;
  if (day < 1) {
    day = max;
  }
  if (day > max) {
    day = 1;
  }
  solarSectorState.day = day;
}

function destinationPoint(latitude, longitude, bearingDeg, distanceKm) {
  const earthRadiusKm = 6371;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const angularDistance = distanceKm / earthRadiusKm;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );

  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lng: lon2 * 180 / Math.PI
  };
}

function buildSectorArcPoints(place, aziRise, aziSet, distanceKm) {
  const points = [];
  if (!Number.isFinite(aziRise) || !Number.isFinite(aziSet)) {
    return points;
  }

  const steps = 32;
  let startBearing = aziRise;
  let sweep = aziSet - aziRise;

  // Match Android behavior:
  // - North: sweep sunrise -> sunset directly.
  // - South: sweep via north (passing 0°) so sector is on correct side.
  if (place.latitude >= 0) {
    if (sweep <= 0) {
      sweep += 360;
    }
  } else {
    startBearing = aziSet;
    sweep = 360 - aziSet + aziRise;
    if (sweep <= 0) {
      sweep += 360;
    }
  }

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (startBearing + (sweep * (i / steps))) % 360;
    const point = destinationPoint(place.latitude, place.longitude, bearing, distanceKm);
    points.push([point.lat, point.lng]);
  }
  return points;
}

function buildDirectionalArrowOverlay(place, aziRise, aziSet, map, radiusPx) {
  if (!map || !Number.isFinite(aziRise) || !Number.isFinite(aziSet)) {
    return {
      arcPoints: [],
      arrowHead: []
    };
  }

  const centerLatLng = window.L.latLng(place.latitude, place.longitude);
  const centerPoint = map.latLngToContainerPoint(centerLatLng);
  const steps = 40;

  const isNorth = place.latitude >= 0;
  const startBearing = aziRise;
  let sweep = 0;

  // Arrow direction indicates perceived sun path direction.
  // North uses clockwise sweep, south uses counter-clockwise sweep.
  if (isNorth) {
    sweep = aziSet - aziRise;
    if (sweep <= 0) {
      sweep += 360;
    }
  } else {
    sweep = aziRise - aziSet;
    if (sweep <= 0) {
      sweep += 360;
    }
  }

  const arcPoints = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = isNorth
      ? (startBearing + (sweep * (i / steps))) % 360
      : (startBearing - (sweep * (i / steps)) + 360) % 360;
    const radians = bearing * Math.PI / 180;
    const x = centerPoint.x + radiusPx * Math.sin(radians);
    const y = centerPoint.y - radiusPx * Math.cos(radians);
    const latLng = map.containerPointToLatLng(window.L.point(x, y));
    arcPoints.push([latLng.lat, latLng.lng]);
  }

  const endBearing = isNorth
    ? (startBearing + sweep) % 360
    : (startBearing - sweep + 360) % 360;
  const endRadians = endBearing * Math.PI / 180;
  const tipX = centerPoint.x + radiusPx * Math.sin(endRadians);
  const tipY = centerPoint.y - radiusPx * Math.cos(endRadians);

  // Tangent must follow sweep direction at end of arc, otherwise arrowhead flips.
  const tangentBearing = isNorth
    ? (endBearing + 90) % 360
    : (endBearing - 90 + 360) % 360;
  const tangentRadians = tangentBearing * Math.PI / 180;
  const dirX = Math.sin(tangentRadians);
  const dirY = -Math.cos(tangentRadians);
  const perpX = -dirY;
  const perpY = dirX;

  const arrowLengthPx = 10;
  const arrowHalfWidthPx = 5;
  const baseX = tipX - dirX * arrowLengthPx;
  const baseY = tipY - dirY * arrowLengthPx;

  const leftX = baseX + perpX * arrowHalfWidthPx;
  const leftY = baseY + perpY * arrowHalfWidthPx;
  const rightX = baseX - perpX * arrowHalfWidthPx;
  const rightY = baseY - perpY * arrowHalfWidthPx;

  const tipLatLng = map.containerPointToLatLng(window.L.point(tipX, tipY));
  const leftLatLng = map.containerPointToLatLng(window.L.point(leftX, leftY));
  const rightLatLng = map.containerPointToLatLng(window.L.point(rightX, rightY));

  return {
    arcPoints,
    arrowHead: [
      [tipLatLng.lat, tipLatLng.lng],
      [leftLatLng.lat, leftLatLng.lng],
      [rightLatLng.lat, rightLatLng.lng]
    ]
  };
}

function clearSolarSectorLayers() {
  [
    solarSectorPlaceMarker,
    solarSectorPolygon,
    solarSectorFullDayCircle,
    solarSectorRiseLine,
    solarSectorSetLine,
    solarSectorDirectionArc,
    solarSectorDirectionArrow
  ].forEach((layer) => {
    if (layer && solarSectorMapInstance) {
      solarSectorMapInstance.removeLayer(layer);
    }
  });

  solarSectorPlaceMarker = null;
  solarSectorPolygon = null;
  solarSectorFullDayCircle = null;
  solarSectorRiseLine = null;
  solarSectorSetLine = null;
  solarSectorDirectionArc = null;
  solarSectorDirectionArrow = null;
}

function ensureSolarSectorMap() {
  if (solarSectorMapInstance || !window.L) {
    return;
  }

  solarSectorMapInstance = window.L.map("solar-sector-map", {
    center: [15, 0],
    zoom: 2,
    minZoom: 2,
    worldCopyJump: true
  });

  solarSectorOsmLayer = window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(solarSectorMapInstance);

  solarSectorSatLayer = window.L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
    }
  );

  solarSectorMapInstance.on("zoomend", () => {
    if (solarSectorState.placeId) {
      if (solarSectorZoomRedrawTimer) {
        clearTimeout(solarSectorZoomRedrawTimer);
      }
      solarSectorZoomRedrawTimer = setTimeout(() => {
        solarSectorZoomRedrawTimer = null;
        renderSolarSector();
      }, 30);
    }
  });
}

function ensureSectorYearlyData(place, year) {
  if (window.SolarOneStorage.hasYearlyData(place.id, year)) {
    return;
  }
  if (window.SolarOneSolarCalc) {
    const generated = window.SolarOneSolarCalc.computeYearlyData(place, year);
    window.SolarOneStorage.setYearlyData(place.id, year, generated);
  }
}

function setSectorInfoHtml(place, entry, year) {
  const info = document.getElementById("sector-info");
  const dialogBody = document.getElementById("sector-info-dialog-body");

  if (!info && !dialogBody) {
    return;
  }

  if (!entry) {
    const nodata = (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('messages.noDataForDate') : 'No data for this date.';
    if (info) info.textContent = nodata;
    if (dialogBody) dialogBody.textContent = nodata;
    return;
  }

  const usedYear = typeof year === 'number' ? year : (window && window.solarSectorState && window.solarSectorState.year) || new Date().getFullYear();
  const dateLabel = dayToDateLabel(entry, usedYear);
  const hemisphereDirection = place.latitude >= 0 ? ((window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('sector.sunPathDirection.north') : 'Clockwise (north hemisphere)') : ((window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('sector.sunPathDirection.south') : 'Counter-clockwise (south hemisphere)');
  const _g = (k, f) => (window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t(k) : f;
  const html = [
    `<div><strong>${place.name}</strong></div>`,
    `<div class="text-secondary small">${dateLabel}</div>`,
    `<div>${_g('tooltip.rise','Rise')}: ${window.SolarOneSolarCalc.minutesToHHMM(entry.r) || "--"} · ${_g('tooltip.set','Set')}: ${window.SolarOneSolarCalc.minutesToHHMM(entry.s) || "--"}</div>`,
    `<div>${_g('tooltip.dayLength','Day length')}: ${window.SolarOneSolarCalc.durationMinutesToHHMM(entry.l) || "--"}</div>`,
    `<div>${_g('tooltip.maxElevation','Max elevation')}: ${Number.isFinite(entry.e) ? entry.e.toFixed(1) : "--"}°</div>`,
    `<div>${(window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('sector.azimuthRiseSet') : 'Azimuth rise/set'}: ${Number.isFinite(entry.ar) ? entry.ar.toFixed(1) : "--"}° / ${Number.isFinite(entry.as) ? entry.as.toFixed(1) : "--"}°</div>`,
    `<div>${(window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('sector.sunPathLabel','Sun path direction') : 'Sun path direction'}: ${hemisphereDirection}</div>`
  ].join("");

  if (info) info.innerHTML = html;
  if (dialogBody) dialogBody.innerHTML = html;
}

function renderSolarSector() {
  const placeSelect = document.getElementById("sector-place-select");
  const yearInput = document.getElementById("sector-year-input");
  const slider = document.getElementById("sector-day-slider");
  const dateLabel = document.getElementById("sector-date-label");
  const sliderDate = document.getElementById("sector-slider-date");

  if (!placeSelect || !yearInput || !slider || !dateLabel || !sliderDate) {
    return;
  }

  const places = window.SolarOneStorage.getPlaces();
  if (places.length === 0) {
    setSectorFeedback((window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('messages.noPlaces') : 'No places available.', "error");
    clearSolarSectorLayers();
    return;
  }

  if (!solarSectorState.placeId || !places.some((entry) => entry.id === solarSectorState.placeId)) {
    solarSectorState.placeId = places[0].id;
  }

  const place = places.find((entry) => entry.id === solarSectorState.placeId);
  if (!place) {
    return;
  }

  // update the small header showing the currently selected place
  const placeTitleEl = document.getElementById('sector-place-title');
  if (placeTitleEl) placeTitleEl.textContent = place.name;

  const maxDays = getDaysInYear(solarSectorState.year);
  slider.max = String(maxDays);
  clampSectorDay();
  slider.value = String(solarSectorState.day);
  yearInput.value = String(solarSectorState.year);

  ensureSectorYearlyData(place, solarSectorState.year);
  const yearly = window.SolarOneStorage.getYearlyData(place.id, solarSectorState.year);
  if (!yearly || !Array.isArray(yearly.daily)) {
    setSectorFeedback((window.SolarOneI18n && window.SolarOneI18n.t) ? window.SolarOneI18n.t('messages.noYearlyData') : 'No yearly data available for selected place/year.', "error");
    return;
  }

  const entry = yearly.daily.find((item) => item.d === solarSectorState.day);
  const dateText = dayToDateLabel(entry, solarSectorState.year);
  dateLabel.textContent = dateText;
  sliderDate.textContent = dateText;
  setSectorInfoHtml(place, entry, solarSectorState.year);

  if (!solarSectorMapInstance || !window.L) {
    return;
  }

  clearSolarSectorLayers();

  solarSectorPlaceMarker = window.L.marker([place.latitude, place.longitude]).addTo(solarSectorMapInstance)
    .bindPopup(`<strong>${place.name}</strong>`);
  if (solarSectorState.lastCenteredPlaceId !== place.id) {
    solarSectorMapInstance.setView([place.latitude, place.longitude], INITIAL_SECTOR_ZOOM);
    solarSectorState.lastCenteredPlaceId = place.id;
  }

  const center = [place.latitude, place.longitude];
  const hasAzimuth = entry && Number.isFinite(entry.ar) && Number.isFinite(entry.as);
  // Polar-day fallback: some days have 24h daylight but no sunrise/sunset azimuth values.
  // In that case we still show a full yellow sector disk.
  const isFullDaySun = entry && Number.isFinite(entry.l) && (entry.l >= 1439 || Math.abs(entry.l - 24) < 0.01);

  if (!hasAzimuth && isFullDaySun) {
    solarSectorFullDayCircle = window.L.circle(center, {
      radius: 60000,
      stroke: false,
      fillColor: "#ffc107",
      fillOpacity: 0.35
    }).addTo(solarSectorMapInstance);

    // clicking the full-day circle opens the info dialog
    solarSectorFullDayCircle.on('click', () => {
      setSectorInfoHtml(place, entry, solarSectorState.year);
      const dlg = document.getElementById('sector-info-dialog');
      if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
    });

    setSectorFeedback("Midnight sun: full 24h sector shown.", "success");
    return;
  }

  // Polar-night or invalid day: keep map clear (same as Android behavior for no sector).
  if (!hasAzimuth) {
    setSectorFeedback("No azimuth data for selected date.", "neutral");
    return;
  }

  const arc = buildSectorArcPoints(place, entry.ar, entry.as, 60);
  const polygonPoints = [center, ...arc, center];

  solarSectorPolygon = window.L.polygon(polygonPoints, {
    stroke: false,
    fillColor: "#ffc107",
    fillOpacity: 0.25
  }).addTo(solarSectorMapInstance);

  // clicking the sector polygon opens the info dialog
  if (solarSectorPolygon && typeof solarSectorPolygon.on === 'function') {
    solarSectorPolygon.on('click', () => {
      setSectorInfoHtml(place, entry, solarSectorState.year);
      const dlg = document.getElementById('sector-info-dialog');
      if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
    });
  }

  const risePoint = destinationPoint(place.latitude, place.longitude, entry.ar, 60);
  const setPoint = destinationPoint(place.latitude, place.longitude, entry.as, 60);

  solarSectorRiseLine = window.L.polyline([center, [risePoint.lat, risePoint.lng]], {
    color: "#0d6efd",
    weight: 2,
    dashArray: "4 4"
  }).addTo(solarSectorMapInstance);

  solarSectorSetLine = window.L.polyline([center, [setPoint.lat, setPoint.lng]], {
    color: "#198754",
    weight: 2,
    dashArray: "4 4"
  }).addTo(solarSectorMapInstance);

  const directionOverlay = buildDirectionalArrowOverlay(place, entry.ar, entry.as, solarSectorMapInstance, 68);
  if (directionOverlay.arcPoints.length > 1) {
    solarSectorDirectionArc = window.L.polyline(directionOverlay.arcPoints, {
      color: "#dc3545",
      weight: 3,
      opacity: 0.9
    }).addTo(solarSectorMapInstance);
  }

  if (directionOverlay.arrowHead.length === 3) {
    solarSectorDirectionArrow = window.L.polygon(directionOverlay.arrowHead, {
      color: "#dc3545",
      fillColor: "#dc3545",
      fillOpacity: 0.95,
      weight: 1
    }).addTo(solarSectorMapInstance);
  }
}

function stopSectorAnimation() {
  if (solarSectorAnimTimer) {
    clearInterval(solarSectorAnimTimer);
    solarSectorAnimTimer = null;
  }
  solarSectorState.animating = false;
  const button = document.getElementById("sector-animate-toggle");
  if (button) {
    button.textContent = "Animate";
    button.classList.remove("btn-danger");
    button.classList.add("btn-primary");
  }
}

function startSectorAnimation() {
  const schedule = [
    5, 15, 25, 36, 46, 56, 64, 74, 84, 95, 105, 115,
    126, 136, 146, 156, 166, 176, 187, 197, 207, 218, 228, 238,
    248, 258, 268, 279, 289, 299, 309, 319, 329, 340, 350, 360
  ];

  solarSectorState.animating = true;
  const button = document.getElementById("sector-animate-toggle");
  if (button) {
    button.textContent = "Stop";
    button.classList.remove("btn-primary");
    button.classList.add("btn-danger");
  }

  solarSectorAnimTimer = setInterval(() => {
    if (!solarSectorState.animating) {
      stopSectorAnimation();
      return;
    }

    const maxDay = getDaysInYear(solarSectorState.year);
    const targetDay = schedule[solarSectorState.animIndex % schedule.length];
    solarSectorState.day = Math.min(targetDay, maxDay);
    solarSectorState.animIndex += 1;
    renderSolarSector();
  }, 900);
}

function toggleSectorLayer() {
  if (!solarSectorMapInstance || !solarSectorOsmLayer || !solarSectorSatLayer) {
    return;
  }
  const btn = document.getElementById("sector-layer-toggle");
  if (solarSectorMapInstance.hasLayer(solarSectorSatLayer)) {
    solarSectorMapInstance.removeLayer(solarSectorSatLayer);
    solarSectorOsmLayer.addTo(solarSectorMapInstance);
    if (btn) btn.setAttribute("aria-pressed", "false");
  } else {
    solarSectorMapInstance.removeLayer(solarSectorOsmLayer);
    solarSectorSatLayer.addTo(solarSectorMapInstance);
    if (btn) btn.setAttribute("aria-pressed", "true");
  }
}

function setupSolarSector() {
  const placeSelect = document.getElementById("sector-place-select");
  const yearInput = document.getElementById("sector-year-input");
  const slider = document.getElementById("sector-day-slider");
  const prev = document.getElementById("sector-day-prev");
  const next = document.getElementById("sector-day-next");
  const layerToggle = document.getElementById("sector-layer-toggle");
  const animateToggle = document.getElementById("sector-animate-toggle");

  if (!placeSelect || !yearInput || !slider || !prev || !next) {
    return;
  }

  const places = window.SolarOneStorage.getPlaces();
  placeSelect.innerHTML = "";
  places.forEach((place) => {
    const option = document.createElement("option");
    option.value = String(place.id);
    option.textContent = place.name;
    placeSelect.appendChild(option);
  });

  if (!solarSectorState.placeId && places.length > 0) {
    solarSectorState.placeId = places[0].id;
  }

  placeSelect.value = solarSectorState.placeId ? String(solarSectorState.placeId) : "";
  yearInput.value = String(solarSectorState.year);
  slider.value = String(solarSectorState.day);

  placeSelect.addEventListener("change", () => {
    solarSectorState.placeId = Number(placeSelect.value);
    solarSectorState.lastCenteredPlaceId = null;
    renderSolarSector();
  });

  yearInput.addEventListener("change", () => {
    const year = Number(yearInput.value);
    solarSectorState.year = Number.isInteger(year) ? year : getCurrentYear();
    clampSectorDay();
    renderSolarSector();
  });

  slider.addEventListener("input", () => {
    solarSectorState.day = Number(slider.value) || 1;
    renderSolarSector();
  });

  prev.addEventListener("click", () => {
    wrapSectorDay(-1);
    renderSolarSector();
  });

  next.addEventListener("click", () => {
    wrapSectorDay(1);
    renderSolarSector();
  });

  if (layerToggle) {
    layerToggle.addEventListener("click", toggleSectorLayer);
  }

  if (animateToggle) {
    animateToggle.addEventListener("click", () => {
      if (solarSectorState.animating) {
        stopSectorAnimation();
        return;
      }
      solarSectorState.animIndex = 0;
      startSectorAnimation();
    });
  }

  // wire dialog close button if present
  const infoClose = document.getElementById('sector-info-close');
  if (infoClose) {
    infoClose.addEventListener('click', () => {
      const dlg = document.getElementById('sector-info-dialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();
    });
  }
}

function refreshSolarSectorPlaceSelector() {
  const placeSelect = document.getElementById("sector-place-select");
  if (!placeSelect) {
    return;
  }

  const places = window.SolarOneStorage.getPlaces();
  placeSelect.innerHTML = "";
  places.forEach((place) => {
    const option = document.createElement("option");
    option.value = String(place.id);
    option.textContent = place.name;
    placeSelect.appendChild(option);
  });

  if (places.length === 0) {
    solarSectorState.placeId = null;
    return;
  }

  // prefer first selected place from world map when available
  const selectedPlaces = places.filter((p) => p.selected);
  if (selectedPlaces.length > 0) {
    solarSectorState.placeId = selectedPlaces[0].id;
  } else if (!places.some((entry) => entry.id === solarSectorState.placeId)) {
    solarSectorState.placeId = places[0].id;
  }

  placeSelect.value = solarSectorState.placeId ? String(solarSectorState.placeId) : "";
}

// App bootstrap.
async function init() {
  // initialize i18n first (populates UI strings)
  if (window.SolarOneI18n && window.SolarOneI18n.init) {
    try {
      await window.SolarOneI18n.init();
    } catch (e) {
      console.warn('i18n init failed', e);
    }
    // when language changes, re-render dynamic UI
    window.SolarOneI18n.onLanguageChanged = (lang) => {
      // reapply dynamic fragments
      try {
        // update latitude/pole/meridian labels on the map
        renderLatitudeLines();
        renderWorldMapData();
        renderSolarSector();
        renderGraph();
      } catch (e) {
        // ignore
      }
    };
  }

  setupNavigation();
  setActiveView("world-map");

  window.SolarOneStorage.bootstrapSeedDataIfNeeded();
  const year = getCurrentYear();
  const generated = ensureYearlyDataForAllPlaces(year);
  const sanity = runSolarSanityChecks();

  ensureWorldMap();
  ensureAddPlaceMap();
  ensureSolarSectorMap();
  setupWorldMapActions();
  setupAddPlaceActions();
  setupGraphs();
  setupSolarSector();
  renderWorldMapData();
  renderSolarSector();

  if (generated.generatedCount > 0) {
    console.log(`Generated yearly solar data for ${generated.generatedCount} place(s) for ${year}.`);
  }

  if (!sanity.ok) {
    setStatus("Ready with solar-check warnings · review console for details");
  }
}

window.addEventListener("DOMContentLoaded", init);
