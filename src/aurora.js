// Aurora forecast service using NOAA SWPC data
// Fetches Kp index forecasts and OVATION aurora probability

import { addDaysToDateStr, getZonedDateStr, getZonedHour } from './timezone.js';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = new Map();

// NOAA SWPC endpoints
const KP_FORECAST_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const KP_CURRENT_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const THREE_DAY_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const WING_KP_URL = 'https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json';

async function cachedFetch(url, key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'AuroraChaseCopilot/2.0' },
  });

  if (!res.ok) {
    throw new Error(`NOAA API error (${key}): ${res.status}`);
  }

  const data = await res.json();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

// Fetch Kp index forecast
export async function fetchKpForecast() {
  try {
    const data = await cachedFetch(KP_FORECAST_URL, 'kp_forecast');
    // Format: array of [time_tag, kp, observed/estimated/predicted]
    // Skip header row
    const entries = data.slice(1).map(row => ({
      time: row[0],
      kp: parseFloat(row[1]),
      type: row[2], // "observed", "estimated", "predicted"
    }));
    return entries;
  } catch (err) {
    console.error('Failed to fetch Kp forecast:', err.message);
    return null;
  }
}

// Fetch current Kp values
export async function fetchCurrentKp() {
  try {
    const data = await cachedFetch(KP_CURRENT_URL, 'kp_current');
    const entries = data.slice(1).map(row => ({
      time: row[0],
      kp: parseFloat(row[1]),
    }));
    // Return the most recent
    return entries.length > 0 ? entries[entries.length - 1] : null;
  } catch (err) {
    console.error('Failed to fetch current Kp:', err.message);
    return null;
  }
}

// Fetch OVATION aurora forecast
// This returns aurora probability at various lat/lon points
export async function fetchOvation() {
  try {
    const data = await cachedFetch(OVATION_URL, 'ovation');
    return data;
  } catch (err) {
    console.error('Failed to fetch OVATION data:', err.message);
    return null;
  }
}

// Extract aurora probability for a given location from OVATION data
export function getAuroraProbabilityForLocation(ovationData, targetLat = 64.15, targetLon = -21.94) {
  if (!ovationData?.coordinates) return null;

  let closestProb = 0;
  let closestDist = Infinity;

  for (const point of ovationData.coordinates) {
    const [lon, lat, prob] = point;
    const dist = Math.abs(lat - targetLat) + Math.abs(lon - targetLon);
    if (dist < closestDist) {
      closestDist = dist;
      closestProb = prob;
    }
  }

  return closestProb;
}

// Get tonight's Kp values (evening hours)
export function getTonightKp(kpEntries, targetDate, timeZone = 'Atlantic/Reykjavik', startHour = 18, endHour = 3) {
  if (!kpEntries) return { avg: null, max: null, entries: [] };

  const nextDateStr = addDaysToDateStr(targetDate, 1);
  const crossesMidnight = endHour <= startHour;
  const tonight = [];
  for (const entry of kpEntries) {
    const d = new Date(entry.time);
    const localDateStr = getZonedDateStr(d, timeZone);
    const localHour = getZonedHour(d, timeZone);

    const inWindow = crossesMidnight
      ? ((localDateStr === targetDate && localHour >= startHour) || (localDateStr === nextDateStr && localHour <= endHour))
      : (localDateStr === targetDate && localHour >= startHour && localHour <= endHour);

    if (inWindow) tonight.push(entry);
  }

  if (tonight.length === 0) return { avg: null, max: null, entries: tonight };

  const kpValues = tonight.map(e => e.kp);
  return {
    avg: Math.round((kpValues.reduce((a, b) => a + b, 0) / kpValues.length) * 10) / 10,
    max: Math.max(...kpValues),
    entries: tonight,
  };
}

// Aggregate aurora data into a summary
// centerLat/centerLon default to Reykjavik; pass any city center for accurate OVATION lookup
export async function getAuroraSummary(targetDate, { centerLat = 64.15, centerLon = -21.94, cityName = 'Reykjavík' } = {}) {
  const [kpForecast, currentKp, ovation] = await Promise.all([
    fetchKpForecast(),
    fetchCurrentKp(),
    fetchOvation(),
  ]);

  const tonightKp = getTonightKp(kpForecast, targetDate);
  const locationProbability = ovation ? getAuroraProbabilityForLocation(ovation, centerLat, centerLon) : null;

  // Determine activity level
  const kpMax = tonightKp.max ?? currentKp?.kp ?? 0;
  let activityLevel;
  if (kpMax >= 7) activityLevel = 'EXTREME';
  else if (kpMax >= 5) activityLevel = 'STRONG';
  else if (kpMax >= 4) activityLevel = 'MODERATE';
  else if (kpMax >= 2) activityLevel = 'NORMAL';
  else activityLevel = 'LOW';

  // Visibility message based on latitude and Kp
  const latLabel = `${cityName} latitude`;
  let visibility;
  if (kpMax >= 3) visibility = `Good chance of visible aurora at ${latLabel}`;
  else if (kpMax >= 1.5) visibility = `Possible aurora at ${latLabel}, may be faint or low on horizon`;
  else visibility = `Low aurora activity, but faint displays still possible at ${latLabel}`;

  return {
    currentKp: currentKp?.kp ?? null,
    tonightKp,
    locationProbability,
    activityLevel,
    visibility,
    ovationTime: ovation?.Forecast_Time ?? null,
    kpForecastAvailable: kpForecast !== null,
    ovationAvailable: ovation !== null,
  };
}
