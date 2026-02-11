// AI-powered aurora location generator using OpenAI API
// Generates zone/location data matching the ZONES structure for any city.

import { ZONES, WEATHER_CHECKPOINTS, CLOUD_REGIMES, TROMSO_CENTER } from './zones.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';
const OPENAI_API_BASE = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');

export const AI_ENABLED = !!OPENAI_API_KEY;

// In-memory cache: normalized city name -> { data, expiry }
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function normalizeCityKey(city) {
  return city.trim().toLowerCase().replace(/\s+/g, ' ');
}

const SYSTEM_PROMPT = `You are an expert aurora and night-sky travel safety advisor. Given ANY location in the world (city, town, region, or coordinates), generate safe aurora/night-sky viewing zones and locations nearby.

SAFETY IS YOUR TOP PRIORITY. Every location you recommend must be safe to drive to and stop at during winter nighttime conditions. Never suggest locations that require dangerous unmarked roads, off-road driving, or areas known for hazards without clear warnings.

Return ONLY valid JSON (no markdown, no backticks) with this exact structure:
{
  "cityName": "the city/location name as commonly known",
  "centerLat": <center latitude>,
  "centerLon": <center longitude>,
  "timeZone": "<IANA timezone string, e.g. Europe/Oslo>",
  "auroraLatitude": "<good|moderate|marginal|unlikely> based on geomagnetic latitude",
  "auroraNote": "<brief note about aurora visibility at this latitude, e.g. 'Visible during strong storms (Kp 5+)' or 'Prime aurora belt location'>",
  "regionSafetyNotes": "<general travel/driving safety notes for this region in winter>",
  "zones": {
    "<zone_code>": {
      "name": "<zone display name>",
      "code": "<same zone_code>",
      "driveMinutes": [<min_minutes>, <max_minutes>],
      "lightPollution": "<high|medium|low-medium|low|very-low|minimal>",
      "lightPollutionScore": <0-15, higher=darker/better>,
      "description": "<brief description of the zone>",
      "roadType": "<highway|paved_secondary|gravel|mixed> - primary road type to reach this zone",
      "cellCoverage": "<good|partial|poor|none> - mobile phone coverage in the zone",
      "nearestServices": "<nearest town/gas station/hospital with approximate distance>",
      "winterRoadWarning": "<null or string with specific winter road hazards: mountain passes, avalanche zones, ice, etc>",
      "requiresBorderCrossing": <true|false>,
      "mayRequireFerry": <true|false>,
      "safetyNotes": "<zone-specific safety notes: wildlife, terrain, weather patterns, seasonal closures>",
      "locations": [
        {
          "id": "<unique_snake_case_id>",
          "name": "<location display name>",
          "anchor": "<search-friendly name for maps navigation>",
          "lat": <latitude>,
          "lon": <longitude>,
          "parking": "<detailed safe parking info: surface type, capacity, plowing status, lighting>",
          "notes": "<viewing notes for this spot: horizon direction, foreground features, wind exposure>",
          "safetyNotes": "<location-specific safety: road shoulder width, guardrails, hazards, nearest shelter>"
        }
      ]
    }
  }
}

SAFETY RULES (CRITICAL):
- Only recommend locations reachable by maintained, plowed roads in winter
- Every location MUST have safe off-road parking (pull-offs, car parks, wide shoulders)
- Never suggest stopping on narrow roads, blind curves, bridges, or tunnels
- Flag mountain passes, avalanche-prone areas, and roads with known winter closures
- Include cellCoverage for each zone — travelers must know if they'll be out of contact
- Include nearestServices — distance to fuel, emergency services, warm shelter
- Flag wildlife hazards (moose, reindeer, elk, bears) where relevant
- For remote locations, warn about distances between services
- If a zone requires border crossing or ferry, mark it explicitly
- winterRoadWarning should be null if no specific concerns, or a clear warning string

LOCATION RULES:
- Generate 5-7 zones with 2-4 locations each
- First zone (code "0") should be "in town / quick fallback" with driveMinutes [0, 15]
- Zones should progress from closest/safest to farthest/darkest
- Use real place names and accurate GPS coordinates
- Locations should have dark skies, open horizons (preferably north), and safe access
- Drive times should be realistic WINTER nighttime estimates from the city center
- Light pollution scores: 0 for city center, up to 15 for remote wilderness
- The anchor field should work as a Google Maps / Apple Maps search query
- Consider local geography: coastal vs inland, rain shadow effects, elevation, prevailing weather

LATITUDE AWARENESS:
- For locations above ~64°N geomagnetic latitude: aurora is frequent, mark auroraLatitude "good"
- For locations 58-64°N geomagnetic: aurora during moderate activity, mark "moderate"
- For locations 50-58°N geomagnetic: aurora only during strong storms, mark "marginal"
- For locations below ~50°N geomagnetic: aurora rare, mark "unlikely" and note in auroraNote that strong Kp (7+) storms are needed
- Always generate useful dark-sky locations regardless of aurora probability — the app is also useful for night sky photography and stargazing`;

function buildUserPrompt(cityName, lat, lon) {
  const coordNote = (lat !== 0 || lon !== 0) ? ` (approximate coordinates: ${lat}, ${lon})` : '';
  return `Generate safe aurora/night-sky viewing zones and locations near ${cityName}${coordNote}.

Requirements:
- Prioritize locations that are SAFE to drive to and stop at during winter nights
- Include a mix of close easy-access spots and darker remote locations
- Every location must have safe parking away from traffic
- Note road conditions, cell coverage, and nearest services for each zone
- Flag any hazards: wildlife crossings, mountain passes, avalanche areas, seasonal road closures
- Consider the local geography, typical winter weather patterns, and light pollution sources
- Assess aurora visibility based on the geomagnetic latitude of this region`;
}

function validateZones(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.zones || typeof data.zones !== 'object') return false;
  if (!data.timeZone || typeof data.timeZone !== 'string') return false;
  if (typeof data.centerLat !== 'number' || typeof data.centerLon !== 'number') return false;

  const zones = data.zones;
  const zoneCodes = Object.keys(zones);
  if (zoneCodes.length < 2) return false;

  for (const code of zoneCodes) {
    const zone = zones[code];
    if (!zone.name || !zone.code || !Array.isArray(zone.driveMinutes) || zone.driveMinutes.length < 2) return false;
    if (typeof zone.lightPollutionScore !== 'number') return false;
    if (!Array.isArray(zone.locations) || zone.locations.length === 0) return false;

    for (const loc of zone.locations) {
      if (!loc.id || !loc.name || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return false;
      if (!loc.anchor) return false;
    }
  }

  return true;
}

async function callOpenAI(cityName, lat, lon) {
  const url = `${OPENAI_API_BASE}/chat/completions`;
  const body = {
    model: OPENAI_CHAT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(cityName, lat, lon) },
    ],
    temperature: 0.7,
    max_tokens: 6000,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Generate aurora photography locations for a given city.
 * Returns { zones, checkpoints, allLocations, cloudRegimes, centerLat, centerLon, timeZone, cityName }.
 * Falls back to Tromsø defaults on failure or missing API key.
 */
export async function generateLocationsForCity(cityName, originLat, originLon) {
  // Fallback: no API key or empty city
  if (!AI_ENABLED || !cityName) {
    return getTromsoFallback();
  }

  const key = normalizeCityKey(cityName);

  // Check cache
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  // Use provided coords or let the AI figure it out
  const lat = Number.isFinite(originLat) ? originLat : 0;
  const lon = Number.isFinite(originLon) ? originLon : 0;

  try {
    console.log(`[AI] Generating locations for "${cityName}" (${lat}, ${lon})...`);
    const raw = await callOpenAI(cityName, lat, lon);

    if (!validateZones(raw)) {
      console.warn('[AI] Invalid zone data from OpenAI, falling back to Tromsø');
      return getTromsoFallback();
    }

    const result = buildResult(raw);

    // Cache it
    cache.set(key, { data: result, expiry: Date.now() + CACHE_TTL_MS });
    console.log(`[AI] Generated ${Object.keys(raw.zones).length} zones for "${cityName}"`);

    return result;
  } catch (err) {
    console.error(`[AI] Failed to generate locations for "${cityName}":`, err.message);
    return getTromsoFallback();
  }
}

function buildResult(raw) {
  const zones = raw.zones;

  // Ensure boolean fields exist on each zone (AI may omit false values)
  for (const zone of Object.values(zones)) {
    zone.requiresBorderCrossing = !!zone.requiresBorderCrossing;
    zone.mayRequireFerry = !!zone.mayRequireFerry;
  }

  // Build checkpoints (first location per zone)
  const checkpoints = [];
  for (const [code, zone] of Object.entries(zones)) {
    const loc = zone.locations[0];
    checkpoints.push({
      id: loc.id,
      name: `${loc.name} (${zone.name})`,
      lat: loc.lat,
      lon: loc.lon,
      zone: code,
    });
  }

  // Build allLocations
  const allLocations = [];
  for (const zone of Object.values(zones)) {
    for (const loc of zone.locations) {
      allLocations.push({
        ...loc,
        zoneCode: zone.code,
        zoneName: zone.name,
        lightPollutionScore: zone.lightPollutionScore,
        driveMinutes: zone.driveMinutes,
      });
    }
  }

  // Build cloud regimes from zone metadata
  const cloudRegimes = buildCloudRegimesFromZones(zones);

  return {
    zones,
    checkpoints,
    allLocations,
    cloudRegimes,
    centerLat: raw.centerLat,
    centerLon: raw.centerLon,
    timeZone: raw.timeZone,
    cityName: raw.cityName || 'Unknown',
    auroraLatitude: raw.auroraLatitude || null,
    auroraNote: raw.auroraNote || null,
    regionSafetyNotes: raw.regionSafetyNotes || null,
    source: 'ai',
  };
}

function buildCloudRegimesFromZones(zones) {
  const coastal = [];
  const inland = [];
  const remote = [];

  for (const [code, zone] of Object.entries(zones)) {
    const avgDrive = (zone.driveMinutes[0] + zone.driveMinutes[1]) / 2;
    const desc = (zone.description || '').toLowerCase() + ' ' + (zone.name || '').toLowerCase();

    if (desc.includes('coast') || desc.includes('fjord') || desc.includes('island') || desc.includes('town') || desc.includes('city')) {
      coastal.push(code);
    } else if (avgDrive > 100 || desc.includes('inland') || desc.includes('valley') || desc.includes('border')) {
      remote.push(code);
    } else {
      inland.push(code);
    }
  }

  // Ensure at least one zone per category
  if (coastal.length === 0) coastal.push(Object.keys(zones)[0]);
  if (inland.length === 0 && Object.keys(zones).length > 1) inland.push(Object.keys(zones)[1]);

  return {
    coastal,
    inland_east: inland.length > 0 ? inland : remote.slice(0, 1),
    inland_south: remote.length > 0 ? remote : inland.slice(-1),
  };
}

function getTromsoFallback() {
  const checkpoints = WEATHER_CHECKPOINTS;
  const allLocations = [];
  for (const zone of Object.values(ZONES)) {
    for (const loc of zone.locations) {
      allLocations.push({
        ...loc,
        zoneCode: zone.code,
        zoneName: zone.name,
        lightPollutionScore: zone.lightPollutionScore,
        driveMinutes: zone.driveMinutes,
      });
    }
  }

  return {
    zones: ZONES,
    checkpoints,
    allLocations,
    cloudRegimes: CLOUD_REGIMES,
    centerLat: TROMSO_CENTER.lat,
    centerLon: TROMSO_CENTER.lon,
    timeZone: 'Europe/Oslo',
    cityName: 'Tromsø',
    source: 'default',
  };
}
