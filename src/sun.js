// Sun position calculator for Tromsø
// Based on NOAA solar calculations
// Provides sunset, sunrise, and twilight times

import { getZonedParts } from './timezone.js';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function julianDay(year, month, day) {
  if (month <= 2) { year -= 1; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
}

function solarDeclination(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) % 360;
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = (1.914602 - T * (0.004817 + 0.000014 * T)) * Math.sin(M * DEG)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * M * DEG)
    + 0.000289 * Math.sin(3 * M * DEG);
  const sunLon = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = sunLon - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const obliq = 23.439291 - 0.0130042 * T;
  const obliqCorr = obliq + 0.00256 * Math.cos(omega * DEG);
  const dec = Math.asin(Math.sin(obliqCorr * DEG) * Math.sin(lambda * DEG)) * RAD;
  return { dec, eqTime: equationOfTime(T, L0, e, M, obliqCorr) };
}

function equationOfTime(T, L0, e, M, obliq) {
  const y = Math.tan(obliq * DEG / 2) ** 2;
  const eq = y * Math.sin(2 * L0 * DEG)
    - 2 * e * Math.sin(M * DEG)
    + 4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG)
    - 0.5 * y * y * Math.sin(4 * L0 * DEG)
    - 1.25 * e * e * Math.sin(2 * M * DEG);
  return 4 * eq * RAD; // minutes
}

// Calculate hour angle for a given solar elevation angle
function hourAngle(lat, dec, elevation) {
  const cosHA = (Math.sin(elevation * DEG) - Math.sin(lat * DEG) * Math.sin(dec * DEG))
    / (Math.cos(lat * DEG) * Math.cos(dec * DEG));
  if (cosHA > 1) return null;  // sun never rises
  if (cosHA < -1) return null; // sun never sets (midnight sun)
  return Math.acos(cosHA) * RAD;
}

// Get sun times for a given date and location
// Returns times in UTC
export function getSunTimes(year, month, day, lat, lon) {
  const jd = julianDay(year, month, day);
  const { dec, eqTime } = solarDeclination(jd);

  const solarNoon = (720 - 4 * lon - eqTime) / 1440; // fraction of day, UTC

  // Regular sunset/sunrise (sun center at -0.833°)
  const ha = hourAngle(lat, dec, -0.833);
  // Civil twilight (sun at -6°)
  const haCivil = hourAngle(lat, dec, -6);
  // Nautical twilight (sun at -12°)
  const haNautical = hourAngle(lat, dec, -12);
  // Astronomical twilight (sun at -18°)
  const haAstro = hourAngle(lat, dec, -18);

  function toTime(noonFrac, haVal, isSetting) {
    if (haVal === null) return null;
    const frac = noonFrac + (isSetting ? 1 : -1) * haVal / 360;
    const totalMin = frac * 1440;
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    return { hours: h, minutes: m, decimal: totalMin / 60 };
  }

  return {
    sunrise: toTime(solarNoon, ha, false),
    sunset: toTime(solarNoon, ha, true),
    civilDawn: toTime(solarNoon, haCivil, false),
    civilDusk: toTime(solarNoon, haCivil, true),
    nauticalDawn: toTime(solarNoon, haNautical, false),
    nauticalDusk: toTime(solarNoon, haNautical, true),
    astronomicalDawn: toTime(solarNoon, haAstro, false),
    astronomicalDusk: toTime(solarNoon, haAstro, true),
    solarNoon: { hours: Math.floor(solarNoon * 24), minutes: Math.round((solarNoon * 24 % 1) * 60) },
  };
}

// Format time in local Norway time (UTC+1 in winter CET)
function utcClockToZonedTime(year, month, day, utcTime, timeZone) {
  if (!utcTime) return null;
  const d = new Date(Date.UTC(year, month - 1, day, utcTime.hours, utcTime.minutes, 0));
  const p = getZonedParts(d, timeZone);
  return {
    hours: p.hour,
    minutes: p.minute,
    formatted: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
  };
}

// Get dark window for aurora watching
export function getDarkWindow(year, month, day, lat, lon, timeZone = 'Europe/Oslo') {
  const times = getSunTimes(year, month, day, lat, lon);

  const nauticalDusk = utcClockToZonedTime(year, month, day, times.nauticalDusk, timeZone);
  const nauticalDawn = utcClockToZonedTime(year, month, day, times.nauticalDawn, timeZone);
  const sunset = utcClockToZonedTime(year, month, day, times.sunset, timeZone);
  const sunrise = utcClockToZonedTime(year, month, day, times.sunrise, timeZone);

  // Dark enough for aurora starts ~30 min after nautical dusk (sun at -12°)
  // In February in Tromsø, this is typically around 17:00-18:00
  let darkStart = nauticalDusk;
  if (!darkStart && sunset) {
    // If nautical dusk doesn't exist (polar night), use sunset + 1h or default
    const h = (sunset.hours + 1) % 24;
    darkStart = { hours: h, minutes: sunset.minutes, formatted: '' };
  }
  if (!darkStart) {
    // Polar night - it's dark all afternoon
    darkStart = { hours: 14, minutes: 0, formatted: '14:00' };
  }
  darkStart.formatted = `${String(darkStart.hours).padStart(2, '0')}:${String(darkStart.minutes).padStart(2, '0')}`;

  let darkEnd = nauticalDawn;
  if (!darkEnd && sunrise) {
    const h = (sunrise.hours - 1 + 24) % 24;
    darkEnd = { hours: h, minutes: sunrise.minutes, formatted: '' };
  }
  if (!darkEnd) {
    darkEnd = { hours: 10, minutes: 0, formatted: '10:00' };
  }
  darkEnd.formatted = `${String(darkEnd.hours).padStart(2, '0')}:${String(darkEnd.minutes).padStart(2, '0')}`;

  return {
    sunset: sunset?.formatted ?? 'no sunset (polar night)',
    sunrise: sunrise?.formatted ?? 'no sunrise (polar night)',
    darkStart: darkStart.formatted,
    darkEnd: darkEnd.formatted,
    nauticalDusk: nauticalDusk?.formatted ?? null,
    nauticalDawn: nauticalDawn?.formatted ?? null,
  };
}
