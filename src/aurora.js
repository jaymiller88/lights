// Aurora forecast service using NOAA SWPC data
// Fetches Kp index forecasts and OVATION aurora probability

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
    headers: { 'User-Agent': 'TromsoAuroraCopilot/1.0' },
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

// Extract aurora probability for Tromsø latitude from OVATION data
export function getAuroraProbabilityForTromso(ovationData) {
  if (!ovationData?.coordinates) return null;

  // Tromsø is at ~69.65°N, ~19°E
  // Find the closest OVATION grid points
  const targetLat = 69.65;
  const targetLon = 19.0;
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
export function getTonightKp(kpEntries, targetDate) {
  if (!kpEntries) return { avg: null, max: null, entries: [] };

  const tonight = [];
  for (const entry of kpEntries) {
    const entryDate = new Date(entry.time);
    const entryDateStr = entryDate.toISOString().slice(0, 10);
    const hour = entryDate.getUTCHours();

    // Evening in Norway (CET = UTC+1): 18:00-03:00 local = 17:00-02:00 UTC
    if (entryDateStr === targetDate && hour >= 17) {
      tonight.push(entry);
    }
    // Next day early morning
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);
    if (entryDateStr === nextDateStr && hour <= 2) {
      tonight.push(entry);
    }
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
export async function getAuroraSummary(targetDate) {
  const [kpForecast, currentKp, ovation] = await Promise.all([
    fetchKpForecast(),
    fetchCurrentKp(),
    fetchOvation(),
  ]);

  const tonightKp = getTonightKp(kpForecast, targetDate);
  const tromsoProbability = ovation ? getAuroraProbabilityForTromso(ovation) : null;

  // Determine activity level
  const kpMax = tonightKp.max ?? currentKp?.kp ?? 0;
  let activityLevel;
  if (kpMax >= 7) activityLevel = 'EXTREME';
  else if (kpMax >= 5) activityLevel = 'STRONG';
  else if (kpMax >= 4) activityLevel = 'MODERATE';
  else if (kpMax >= 2) activityLevel = 'NORMAL';
  else activityLevel = 'LOW';

  // At Tromsø's latitude (69.65°N), even Kp 1-2 can produce visible aurora
  let visibility;
  if (kpMax >= 3) visibility = 'Good chance of visible aurora at Tromsø latitude';
  else if (kpMax >= 1.5) visibility = 'Possible aurora at Tromsø latitude, may be faint or low on horizon';
  else visibility = 'Low aurora activity, but faint displays still possible at this latitude';

  return {
    currentKp: currentKp?.kp ?? null,
    tonightKp,
    tromsoProbability,
    activityLevel,
    visibility,
    ovationTime: ovation?.Forecast_Time ?? null,
    kpForecastAvailable: kpForecast !== null,
    ovationAvailable: ovation !== null,
  };
}
