// Weather service using met.no LocationForecast 2.0 API
// https://api.met.no/weatherapi/locationforecast/2.0/documentation

import { addDaysToDateStr, getZonedParts } from './timezone.js';

const USER_AGENT = 'AuroraChaseCopilot/2.0 github.com/aurora-copilot';
const BASE_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Simple in-memory cache
const cache = new Map();

function cacheKey(lat, lon) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export async function fetchWeather(lat, lon) {
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${BASE_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const headers = { 'User-Agent': USER_AGENT };

  // Use cached ETag/Last-Modified for conditional requests
  if (cached) {
    if (cached.etag) headers['If-None-Match'] = cached.etag;
    if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
  }

  const res = await fetch(url, { headers });

  if (res.status === 304 && cached) {
    cached.timestamp = Date.now();
    return cached.data;
  }

  if (!res.ok) {
    throw new Error(`met.no API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  cache.set(key, {
    data,
    timestamp: Date.now(),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  });

  return data;
}

// Fetch weather for multiple locations with concurrency control
export async function fetchMultipleLocations(locations, concurrency = 4) {
  const results = new Map();
  const queue = [...locations];

  async function worker() {
    while (queue.length > 0) {
      const loc = queue.shift();
      try {
        const data = await fetchWeather(loc.lat, loc.lon);
        results.set(loc.id, { location: loc, data, error: null });
      } catch (err) {
        results.set(loc.id, { location: loc, data: null, error: err.message });
      }
      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, locations.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Extract evening forecast data (target hours for aurora watching)
// Returns hourly data from startHour to endHour (next day if endHour < startHour)
// Times are evaluated in the requested `timeZone` so DST is handled correctly.
export function extractEveningForecast(weatherData, targetDate, startHour = 18, endHour = 3, timeZone = 'Europe/Oslo') {
  if (!weatherData?.properties?.timeseries) return [];

  const timeseries = weatherData.properties.timeseries;
  const entries = [];

  const nextDateStr = addDaysToDateStr(targetDate, 1);
  const crossesMidnight = endHour <= startHour;

  for (const entry of timeseries) {
    const d = new Date(entry.time);
    const p = getZonedParts(d, timeZone);
    const localDateStr = `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    const localHour = p.hour;

    const inWindow = crossesMidnight
      ? ((localDateStr === targetDate && localHour >= startHour) || (localDateStr === nextDateStr && localHour <= endHour))
      : (localDateStr === targetDate && localHour >= startHour && localHour <= endHour);

    if (inWindow) {

      const instant = entry.data?.instant?.details || {};
      const next1h = entry.data?.next_1_hours || {};
      const next6h = entry.data?.next_6_hours || {};

      entries.push({
        time: entry.time,
        localHour,
        cloudTotal: instant.cloud_area_fraction ?? null,
        cloudLow: instant.cloud_area_fraction_low ?? null,
        cloudMedium: instant.cloud_area_fraction_medium ?? null,
        cloudHigh: instant.cloud_area_fraction_high ?? null,
        temperature: instant.air_temperature ?? null,
        windSpeed: instant.wind_speed ?? null,
        windGust: instant.wind_speed_of_gust ?? null,
        humidity: instant.relative_humidity ?? null,
        pressure: instant.air_pressure_at_sea_level ?? null,
        precipAmount: next1h?.details?.precipitation_amount ?? next6h?.details?.precipitation_amount ?? null,
        symbolCode: next1h?.summary?.symbol_code ?? next6h?.summary?.symbol_code ?? null,
      });
    }
  }

  return entries;
}

// Calculate aggregate scores for a location's evening forecast
export function scoreWeather(eveningData) {
  if (!eveningData || eveningData.length === 0) {
    return {
      cloudScore: 0, precipScore: 0, windScore: 0,
      avgCloudTotal: null, avgCloudLow: null,
      avgWind: null, maxGust: null, maxPrecip: null,
      tempC: null, total: 0, valid: false,
    };
  }

  // Focus on prime aurora hours: 21:00-01:00 local
  const primeHours = eveningData.filter(h => {
    const lh = h.localHour;
    return lh >= 21 || lh <= 1;
  });
  const data = primeHours.length > 0 ? primeHours : eveningData;

  // Cloud score: lower is better. Low clouds are worst.
  const avgCloudTotal = avg(data.map(h => h.cloudTotal));
  const avgCloudLow = avg(data.map(h => h.cloudLow));
  // 0% cloud = 40pts, 100% cloud = 0pts. Low cloud penalty is extra harsh.
  const cloudScore = Math.max(0, 40 - (avgCloudTotal * 0.25) - (avgCloudLow * 0.20));

  // Precipitation score: 0mm = 30pts
  const maxPrecip = Math.max(...data.map(h => h.precipAmount ?? 0));
  const precipScore = maxPrecip === 0 ? 30 : maxPrecip < 0.3 ? 18 : maxPrecip < 1.0 ? 8 : 0;

  // Wind score: lower = better for tripod + comfort
  const avgWind = avg(data.map(h => h.windSpeed));
  const maxGust = Math.max(...data.map(h => h.windGust ?? h.windSpeed ?? 0));
  const windScore = avgWind < 3 ? 15 : avgWind < 6 ? 11 : avgWind < 10 ? 6 : avgWind < 15 ? 2 : 0;

  // Temperature (just for info, not scoring)
  const avgTemp = avg(data.map(h => h.temperature));

  const total = cloudScore + precipScore + windScore;

  return {
    cloudScore: Math.round(cloudScore * 10) / 10,
    precipScore,
    windScore,
    avgCloudTotal: Math.round(avgCloudTotal),
    avgCloudLow: Math.round(avgCloudLow),
    avgWind: Math.round(avgWind * 10) / 10,
    maxGust: Math.round(maxGust * 10) / 10,
    maxPrecip: Math.round(maxPrecip * 10) / 10,
    tempC: avgTemp !== null ? Math.round(avgTemp) : null,
    total: Math.round(total * 10) / 10,
    valid: true,
    hourlyData: data,
  };
}

function avg(arr) {
  const valid = arr.filter(v => v !== null && v !== undefined);
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
