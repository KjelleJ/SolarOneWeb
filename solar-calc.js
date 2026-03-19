(function () {
  // Solar model constants and math helpers.
  const ZENITH_DEGREES = 90.833;

  function toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  function toDegrees(radians) {
    return radians * (180 / Math.PI);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function dayOfYearFromDate(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((now - start) / 86400000);
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  // Clock formatting for local times (wraps over 24h).
  function minutesToHHMM(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) {
      return null;
    }

    let rounded = Math.round(totalMinutes);
    while (rounded < 0) {
      rounded += 1440;
    }
    rounded %= 1440;

    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function durationMinutesToHHMM(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) {
      return null;
    }

    const rounded = Math.max(0, Math.round(totalMinutes));
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function getOffsetMinutesAt(date, timeZoneId) {
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

    const utcEquivalent = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );

    return (utcEquivalent - date.getTime()) / 60000;
  }

  function calculateAzimuth(latitudeRad, declinationRad, hourAngleRad) {
    const sinH = Math.sin(hourAngleRad);
    const cosH = Math.cos(hourAngleRad);
    const tanDec = Math.tan(declinationRad);
    const numerator = sinH;
    const denominator = cosH * Math.sin(latitudeRad) - tanDec * Math.cos(latitudeRad);
    const azimuth = toDegrees(Math.atan2(numerator, denominator));
    return (azimuth + 180 + 360) % 360;
  }

  // Daily solar values for a location/date/time-zone offset.
  function calculateDailySolarData(options) {
    const latitude = Number(options.latitude);
    const longitude = Number(options.longitude);
    const timezoneOffsetMinutes = Number(options.timezoneOffsetMinutes);
    const date = options.date;

    const dayOfYear = dayOfYearFromDate(date);
    const latitudeRad = toRadians(latitude);
    const gamma = (2 * Math.PI / (isLeapYear(date.getUTCFullYear()) ? 366 : 365)) * (dayOfYear - 1);

    const equationOfTime = 229.18 * (
      0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma)
    );

    const declinationRad =
      0.006918 -
      0.399912 * Math.cos(gamma) +
      0.070257 * Math.sin(gamma) -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma);

    const zenithRad = toRadians(ZENITH_DEGREES);
    const cosHourAngle =
      (Math.cos(zenithRad) / (Math.cos(latitudeRad) * Math.cos(declinationRad))) -
      (Math.tan(latitudeRad) * Math.tan(declinationRad));

    const solarNoonMinutes = 720 - (4 * longitude) - equationOfTime + timezoneOffsetMinutes;

    let sunriseMinutes = null;
    let sunsetMinutes = null;
    let dayLengthMinutes = null;
    let azimuthRise = null;
    let azimuthSet = null;

    if (cosHourAngle > 1) {
      dayLengthMinutes = 0;
    } else if (cosHourAngle < -1) {
      dayLengthMinutes = 1440;
    } else {
      const hourAngleRad = Math.acos(clamp(cosHourAngle, -1, 1));
      const hourAngleDeg = toDegrees(hourAngleRad);
      sunriseMinutes = solarNoonMinutes - (4 * hourAngleDeg);
      sunsetMinutes = solarNoonMinutes + (4 * hourAngleDeg);
      dayLengthMinutes = sunsetMinutes - sunriseMinutes;
      azimuthRise = calculateAzimuth(latitudeRad, declinationRad, -hourAngleRad);
      azimuthSet = calculateAzimuth(latitudeRad, declinationRad, hourAngleRad);
    }

    const maxElevation = 90 - Math.abs(latitude - toDegrees(declinationRad));

    return {
      dayOfYear,
      sunriseMinutes,
      sunsetMinutes,
      dayLengthMinutes,
      maxElevation,
      azimuthRise,
      azimuthSet,
      sunriseText: minutesToHHMM(sunriseMinutes),
      sunsetText: minutesToHHMM(sunsetMinutes)
    };
  }

  // Generate one full year of daily values (cached by storage.js).
  function computeYearlyData(place, year) {
    const days = isLeapYear(year) ? 366 : 365;
    const daily = [];

    for (let day = 1; day <= days; day += 1) {
      const date = new Date(Date.UTC(year, 0, day, 12, 0, 0));
      const timezoneOffsetMinutes = getOffsetMinutesAt(date, place.timezoneId || "Etc/UTC");
      const solar = calculateDailySolarData({
        latitude: place.latitude,
        longitude: place.longitude,
        timezoneOffsetMinutes,
        date
      });

      daily.push({
        d: solar.dayOfYear,
        m: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        r: solar.sunriseMinutes,
        s: solar.sunsetMinutes,
        l: solar.dayLengthMinutes,
        e: solar.maxElevation,
        ar: solar.azimuthRise,
        as: solar.azimuthSet
      });
    }

    return {
      year,
      generatedAt: new Date().toISOString(),
      days,
      daily
    };
  }

  // Lightweight guardrails to detect obvious calculation regressions.
  function runSanityChecks() {
    const checks = [];

    const equinox = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
    const equator = calculateDailySolarData({
      latitude: 0,
      longitude: 0,
      timezoneOffsetMinutes: 0,
      date: equinox
    });

    checks.push({
      name: "Equator equinox day length near 12h",
      passed: Number.isFinite(equator.dayLengthMinutes) && Math.abs(equator.dayLengthMinutes - 720) < 25,
      value: equator.dayLengthMinutes
    });

    const londonSummer = calculateDailySolarData({
      latitude: 51.5072,
      longitude: -0.1276,
      timezoneOffsetMinutes: 60,
      date: new Date(Date.UTC(2026, 5, 21, 12, 0, 0))
    });

    checks.push({
      name: "London summer day length > 16h",
      passed: Number.isFinite(londonSummer.dayLengthMinutes) && londonSummer.dayLengthMinutes > 960,
      value: londonSummer.dayLengthMinutes
    });

    const londonWinter = calculateDailySolarData({
      latitude: 51.5072,
      longitude: -0.1276,
      timezoneOffsetMinutes: 0,
      date: new Date(Date.UTC(2026, 11, 21, 12, 0, 0))
    });

    checks.push({
      name: "London winter day length < 9h",
      passed: Number.isFinite(londonWinter.dayLengthMinutes) && londonWinter.dayLengthMinutes < 540,
      value: londonWinter.dayLengthMinutes
    });

    return {
      ok: checks.every((entry) => entry.passed),
      checks
    };
  }

  // Public API consumed by app.js.
  window.SolarOneSolarCalc = {
    isLeapYear,
    dayOfYearFromDate,
    minutesToHHMM,
    durationMinutesToHHMM,
    calculateDailySolarData,
    computeYearlyData,
    runSanityChecks
  };
})();
