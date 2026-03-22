// Aurora chase plan generation engine
// Implements the scoring algorithm and generates the full structured plan

import { ZONES, WEATHER_CHECKPOINTS, CLOUD_REGIMES, TROMSO_CENTER,
  REYKJAVIK_ZONES, REYKJAVIK_WEATHER_CHECKPOINTS, REYKJAVIK_CLOUD_REGIMES, REYKJAVIK_CENTER,
  getCloudRegime, getAllLocations } from './zones.js';
import { fetchMultipleLocations, extractEveningForecast, scoreWeather } from './weather.js';
import { getAuroraSummary } from './aurora.js';
import { getDarkWindow } from './sun.js';
import { addDaysToDateStr, zonedTimeToUtcMs } from './timezone.js';

function normalizeOptions(options = {}) {
  const maxDriveMinutesRaw = options.maxDriveMinutes;
  let maxDriveMinutes = Number.isFinite(Number(maxDriveMinutesRaw)) ? Number(maxDriveMinutesRaw) : 180;
  // Clamp to a sane range (0..12h)
  maxDriveMinutes = Math.max(0, Math.min(12 * 60, Math.round(maxDriveMinutes)));

  const driveLimitMode = options.driveLimitMode === 'soft' ? 'soft' : 'hard';
  const winterComfort = options.winterComfort === 'low' || options.winterComfort === 'high'
    ? options.winterComfort
    : 'medium';

  const includeBorderCrossing = options.includeBorderCrossing !== false;
  const includeFerry = options.includeFerry !== false;
  const timeZone = typeof options.timeZone === 'string' && options.timeZone ? options.timeZone : 'Europe/Oslo';
  const debug = options.debug === true;

  return {
    maxDriveMinutes,
    driveLimitMode,
    winterComfort,
    includeBorderCrossing,
    includeFerry,
    timeZone,
    debug,
    // Pass-through dynamic location data (undefined if not provided)
    zones: options.zones,
    checkpoints: options.checkpoints,
    allLocations: options.allLocations,
    cloudRegimes: options.cloudRegimes,
    centerLat: options.centerLat,
    centerLon: options.centerLon,
    cityName: options.cityName,
    auroraLatitude: options.auroraLatitude,
    auroraNote: options.auroraNote,
    regionSafetyNotes: options.regionSafetyNotes,
  };
}

// Score a zone based on weather + metadata
function scoreZone(zoneCode, weatherScore, zone, options = {}) {
  const opts = normalizeOptions(options);
  const exclusionReasons = [];

  if (!weatherScore.valid) {
    return { total: -1, breakdown: {}, excluded: true, exclusionReasons: ['No weather data'] };
  }

  const weatherTotal = weatherScore.total; // 0-85
  const darknessBonus = zone.lightPollutionScore; // 0-15

  // Drive time penalty: longer drives get slight penalty (scaled by comfort)
  const avgDrive = (zone.driveMinutes[0] + zone.driveMinutes[1]) / 2;
  const drivePenaltyScale = opts.winterComfort === 'low' ? 1.35 : opts.winterComfort === 'high' ? 0.85 : 1.0;
  const drivePenalty = Math.min(avgDrive / 20, 8) * drivePenaltyScale; // max ~-11 for very long drives on low comfort

  // Drive limit (hard cutoff vs soft penalty)
  if (avgDrive > opts.maxDriveMinutes && opts.driveLimitMode === 'hard') {
    exclusionReasons.push(`Over max drive time (${Math.round(avgDrive)}min > ${opts.maxDriveMinutes}min)`);
  }

  // Optional constraints
  if (!opts.includeBorderCrossing && zone.requiresBorderCrossing) {
    exclusionReasons.push('Border crossing disabled');
  }
  if (!opts.includeFerry && zone.mayRequireFerry) {
    exclusionReasons.push('Ferry options disabled');
  }

  if (exclusionReasons.length > 0) {
    return {
      total: -1,
      breakdown: { weather: weatherTotal, darkness: darknessBonus, drivePenalty: -drivePenalty },
      excluded: true,
      exclusionReasons,
    };
  }

  // Soft over-limit penalty (kept separate so we can show it in UI)
  let overLimitPenalty = 0;
  if (avgDrive > opts.maxDriveMinutes && opts.driveLimitMode === 'soft') {
    // Gentle slope for small overruns, capped so weather can still win if it's massively better.
    const over = avgDrive - opts.maxDriveMinutes;
    overLimitPenalty = Math.min(20, Math.round((over / 10) * 10) / 10); // up to -20
  }

  // Safety penalties
  let safetyPenalty = 0;
  if (zone.requiresBorderCrossing) safetyPenalty += 5;
  if (zone.mayRequireFerry) safetyPenalty += 3;
  // High wind + long drive = extra penalty
  const windThreshold = opts.winterComfort === 'low' ? 8 : opts.winterComfort === 'high' ? 12 : 10;
  const gustThreshold = opts.winterComfort === 'low' ? 13 : opts.winterComfort === 'high' ? 17 : 15;
  if (weatherScore.avgWind > windThreshold && avgDrive > 60) safetyPenalty += 5;
  if (weatherScore.maxGust > gustThreshold && avgDrive > 30) safetyPenalty += 3;
  const safetyScale = opts.winterComfort === 'low' ? 1.25 : opts.winterComfort === 'high' ? 0.9 : 1.0;
  safetyPenalty *= safetyScale;

  const total = weatherTotal + darknessBonus - drivePenalty - safetyPenalty - overLimitPenalty;

  return {
    total: Math.round(total * 10) / 10,
    breakdown: {
      weather: weatherTotal,
      darkness: darknessBonus,
      drivePenalty: -drivePenalty,
      safetyPenalty: -safetyPenalty,
      overLimitPenalty: -overLimitPenalty,
    },
    excluded: false,
    exclusionReasons: [],
  };
}

// Select Primary + Backup A + Backup B
function selectPlans(zoneScoredList, cloudRegimes) {
  // Only consider zones with valid weather data and positive scores
  const validZones = zoneScoredList.filter(z => z.score.total > 0 && z.weatherScore.valid);
  const sorted = [...validZones].sort((a, b) => b.score.total - a.score.total);

  if (sorted.length === 0) return { primary: null, backupA: null, backupB: null };

  const primary = sorted[0];
  const primaryRegime = getCloudRegime(primary.zoneCode, cloudRegimes);

  // Backup A: best score from a DIFFERENT cloud regime
  const backupA = sorted.find(z =>
    z.zoneCode !== primary.zoneCode &&
    getCloudRegime(z.zoneCode, cloudRegimes) !== primaryRegime
  ) || sorted.find(z => z.zoneCode !== primary.zoneCode) || null;

  // Backup B: closest safe option (prefer Zone 0 or Zone W), must have valid data
  const backupB = sorted.find(z =>
    z.zoneCode !== primary.zoneCode &&
    z.zoneCode !== backupA?.zoneCode &&
    ['0', 'W'].includes(z.zoneCode)
  ) || sorted.find(z =>
    z.zoneCode !== primary.zoneCode &&
    z.zoneCode !== backupA?.zoneCode
  ) || null;

  return { primary, backupA, backupB };
}

// Pick the best specific location within a zone
function pickBestLocation(zone, weatherResults, targetDate, timeZone) {
  let bestLoc = zone.locations[0];
  let bestScore = -1;

  for (const loc of zone.locations) {
    const result = weatherResults.get(loc.id);
    if (!result || !result.data) continue;
    const evening = extractEveningForecast(result.data, targetDate, 18, 3, timeZone);
    const score = scoreWeather(evening);
    if (score.total > bestScore) {
      bestScore = score.total;
      bestLoc = loc;
    }
  }

  return bestLoc;
}

// Generate confidence level
function getConfidence(primary, aurora) {
  const weatherScore = primary?.weatherScore?.total ?? 0;
  const kpMax = aurora?.tonightKp?.max ?? 0;

  if (weatherScore >= 60 && kpMax >= 3) return { level: 'HIGH', reason: 'Clear skies forecast + good aurora activity' };
  if (weatherScore >= 45 && kpMax >= 2) return { level: 'MEDIUM', reason: 'Partly clear skies with moderate aurora activity' };
  if (weatherScore >= 30) return { level: 'MEDIUM', reason: 'Variable cloud cover; be ready to reposition' };
  return { level: 'LOW', reason: 'Challenging conditions; cloud cover may obstruct viewing' };
}

// Format a plan section for a destination
function formatDestination(plan, weatherScore, location, zone, isCondensed = false) {
  if (!plan || !location) return 'No data available for this destination.';

  const ws = weatherScore;
  const driveTime = `${zone.driveMinutes[0]}-${zone.driveMinutes[1]} min`;

  const warnings = [];
  if (zone.requiresBorderCrossing) {
    warnings.push('BORDER CROSSING: Confirm rental car is allowed across border. Bring passport/ID.');
  }
  if (zone.mayRequireFerry) {
    warnings.push('FERRY MAY BE NEEDED: Check ferry schedule. Wind/exposure risk. Consider non-ferry route.');
  }
  if (zone.winterRoadWarning) {
    warnings.push(`ROAD WARNING: ${zone.winterRoadWarning}`);
  }
  if (zone.cellCoverage === 'none' || zone.cellCoverage === 'poor') {
    warnings.push(`LIMITED CELL COVERAGE: ${zone.cellCoverage} signal in this area. Download offline maps before departing.`);
  }
  if (location.safetyNotes) {
    warnings.push(location.safetyNotes);
  }

  // Build travel safety summary
  const travelSafety = [];
  if (zone.roadType) travelSafety.push(`Road: ${zone.roadType}`);
  if (zone.cellCoverage) travelSafety.push(`Cell: ${zone.cellCoverage}`);
  if (zone.nearestServices) travelSafety.push(`Services: ${zone.nearestServices}`);
  if (zone.safetyNotes) travelSafety.push(zone.safetyNotes);

  return {
    zone: `Zone ${zone.code} - ${zone.name}`,
    location: location.name,
    anchor: location.anchor,
    driveTime,
    whyThisSpot: [
      `Cloud cover: ~${ws.avgCloudTotal}% total, ~${ws.avgCloudLow}% low cloud`,
      `Precip: ${ws.maxPrecip}mm max | Wind: ${ws.avgWind}m/s avg, gusts ${ws.maxGust}m/s`,
      `Temp: ${ws.tempC}°C | Light pollution: ${zone.lightPollution}`,
      `Score: ${plan.score.total}/100`,
    ],
    parking: location.parking,
    notes: location.notes,
    travelSafety,
    warnings,
    arrivalChecklist: [
      'Turn off headlights / park facing away from viewing direction',
      'Check sky: can you see stars? If no stars visible within 10 min, trigger backup switch',
      'Set up tripod on stable ground (avoid snow drifts that shift)',
      'Take a 15-sec test shot at ISO 3200, f/2.8 to check for aurora glow',
      'Enable camera intervalometer or set timer for regular shots',
      'Start warm-up timer: 20 min outside, then warm up in car 5 min',
    ],
    switchTrigger: [
      'No stars visible after 15 minutes at location',
      'Snow/precip starts and does not stop within 10 minutes',
      'Cloud cover visibly increasing and moving in your direction',
      'Wind makes tripod unstable even with weight bag',
    ],
  };
}

// Classify a checkpoint as GO / MAYBE / NOGO based on thresholds
function classifyCheckpoint(ws) {
  if (!ws.valid) return 'NOGO';
  if (ws.avgCloudTotal < 40 && ws.avgCloudLow < 25 && ws.maxPrecip === 0) return 'GO';
  if (ws.avgCloudTotal > 80 && ws.avgCloudLow > 60) return 'NOGO';
  if (ws.maxPrecip > 1) return 'NOGO';
  return 'MAYBE';
}

function buildExplorer(dateStr, weatherMap, options, selectedLocationIds = new Set(), dynamicZones) {
  const opts = normalizeOptions(options);
  const locations = [];
  const zones = [];
  const zonesData = dynamicZones || ZONES;

  for (const zone of Object.values(zonesData)) {
    let best = null;
    for (const loc of zone.locations) {
      const wr = weatherMap.get(loc.id);
      const evening = wr?.data ? extractEveningForecast(wr.data, dateStr, 18, 3, opts.timeZone) : [];
      const ws = scoreWeather(evening);
      const score = scoreZone(zone.code, ws, zone, opts);
      const warnings = [];
      if (zone.requiresBorderCrossing) warnings.push('Border crossing required');
      if (zone.mayRequireFerry) warnings.push('Ferry may be required');
      if (zone.winterRoadWarning) warnings.push(zone.winterRoadWarning);
      if (zone.cellCoverage === 'none' || zone.cellCoverage === 'poor') {
        warnings.push(`Limited cell coverage (${zone.cellCoverage})`);
      }

      const row = {
        id: loc.id,
        name: loc.name,
        zoneCode: zone.code,
        zoneName: zone.name,
        anchor: loc.anchor,
        parking: loc.parking,
        notes: loc.notes,
        safetyNotes: loc.safetyNotes || null,
        driveMinutes: zone.driveMinutes,
        driveTime: `${zone.driveMinutes[0]}-${zone.driveMinutes[1]} min`,
        lightPollution: zone.lightPollution,
        roadType: zone.roadType || null,
        cellCoverage: zone.cellCoverage || null,
        nearestServices: zone.nearestServices || null,
        zoneSafetyNotes: zone.safetyNotes || null,
        weather: {
          cloudTotal: ws.avgCloudTotal ?? null,
          cloudLow: ws.avgCloudLow ?? null,
          precip: ws.maxPrecip ?? null,
          wind: ws.avgWind ?? null,
          gust: ws.maxGust ?? null,
          tempC: ws.tempC ?? null,
          total: ws.total ?? null,
          valid: ws.valid === true,
        },
        score: {
          total: score.total,
          breakdown: score.breakdown,
          excluded: score.excluded === true,
          exclusionReasons: score.exclusionReasons || [],
        },
        verdict: score.excluded ? 'EXCL' : classifyCheckpoint(ws),
        warnings,
        selected: selectedLocationIds.has(loc.id),
      };

      locations.push(row);

      if (!row.score.excluded && (best === null || row.score.total > best.score.total)) {
        best = row;
      }
    }

    zones.push({
      zoneCode: zone.code,
      zoneName: zone.name,
      driveMinutes: zone.driveMinutes,
      lightPollution: zone.lightPollution,
      bestLocation: best ? {
        id: best.id,
        name: best.name,
        anchor: best.anchor,
        score: best.score,
        weather: best.weather,
        verdict: best.verdict,
        warnings: best.warnings,
      } : null,
    });
  }

  // Highest score first; excluded always sink to bottom.
  locations.sort((a, b) => {
    const ae = a.score.excluded ? 1 : 0;
    const be = b.score.excluded ? 1 : 0;
    if (ae !== be) return ae - be;
    return (b.score.total ?? -1) - (a.score.total ?? -1);
  });

  zones.sort((a, b) => {
    const as = a.bestLocation?.score?.total ?? -1;
    const bs = b.bestLocation?.score?.total ?? -1;
    return bs - as;
  });

  return {
    settings: {
      maxDriveMinutes: opts.maxDriveMinutes,
      driveLimitMode: opts.driveLimitMode,
      winterComfort: opts.winterComfort,
      includeBorderCrossing: opts.includeBorderCrossing,
      includeFerry: opts.includeFerry,
      timeZone: opts.timeZone,
    },
    zones,
    locations,
  };
}

// Main plan generation function
export async function generatePlan(targetDate, options = {}) {
  const dateStr = targetDate || new Date().toISOString().slice(0, 10);
  const [year, month, day] = dateStr.split('-').map(Number);
  const opts = normalizeOptions(options);

  // Use dynamic zones/checkpoints if provided, otherwise use Reykjavík defaults
  const activeZones = opts.zones || REYKJAVIK_ZONES;
  const checkpoints = opts.checkpoints || REYKJAVIK_WEATHER_CHECKPOINTS;
  const allLocations = opts.allLocations || getAllLocations();
  const cloudRegimes = opts.cloudRegimes || REYKJAVIK_CLOUD_REGIMES;
  const centerLat = opts.centerLat ?? REYKJAVIK_CENTER.lat;
  const centerLon = opts.centerLon ?? REYKJAVIK_CENTER.lon;
  const cityName = opts.cityName || 'Reykjavík';

  // Fetch aurora data (with fallback on failure)
  let aurora;
  try {
    aurora = await getAuroraSummary(dateStr, { centerLat, centerLon, cityName });
  } catch (err) {
    console.error('Aurora fetch failed, using defaults:', err.message);
    aurora = {
      currentKp: null, tonightKp: { avg: null, max: null, entries: [] },
      locationProbability: null, activityLevel: 'UNKNOWN', visibility: 'Aurora data unavailable - check manually',
      ovationTime: null, kpForecastAvailable: false, ovationAvailable: false,
    };
  }
  const seen = new Set();
  const fetchList = [];
  // Checkpoints first (they're used for scoring)
  for (const cp of checkpoints) {
    const key = `${cp.lat.toFixed(4)},${cp.lon.toFixed(4)}`;
    if (!seen.has(key)) { seen.add(key); fetchList.push(cp); }
  }
  // Then individual locations not already covered
  for (const loc of allLocations) {
    const key = `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;
    if (!seen.has(key)) { seen.add(key); fetchList.push(loc); }
  }

  // Fetch weather with concurrency limiting to reduce met.no rate-limit risk.
  const weatherMap = await fetchMultipleLocations(fetchList, 4);

  // Score each zone using checkpoint weather
  const zoneScores = [];
  for (const cp of checkpoints) {
    const wr = weatherMap.get(cp.id);
    if (!wr || !wr.data) continue;

    const evening = extractEveningForecast(wr.data, dateStr, 18, 3, opts.timeZone);
    const ws = scoreWeather(evening);
    const zone = activeZones[cp.zone];
    if (!zone) continue;

    const zoneScore = scoreZone(cp.zone, ws, zone, opts);
    zoneScores.push({
      zoneCode: cp.zone,
      zone,
      weatherScore: ws,
      score: zoneScore,
      checkpoint: cp,
    });
  }

  // Select plans
  const { primary, backupA, backupB } = selectPlans(zoneScores, cloudRegimes);

  // Pick best specific locations using unified weather map
  const primaryLoc = primary ? pickBestLocation(primary.zone, weatherMap, dateStr, opts.timeZone) : null;
  const backupALoc = backupA ? pickBestLocation(backupA.zone, weatherMap, dateStr, opts.timeZone) : null;
  const backupBLoc = backupB ? pickBestLocation(backupB.zone, weatherMap, dateStr, opts.timeZone) : null;

  // Get dark window
  const darkWindow = getDarkWindow(year, month, day, centerLat, centerLon, opts.timeZone);

  // Get confidence
  const confidence = getConfidence(primary, aurora);

  // Build checkpoint summary for decision rule (with GO/MAYBE/NOGO verdict)
  const checkpointSummary = zoneScores.map(zs => ({
    name: zs.checkpoint.name,
    zone: zs.zoneCode,
    cloudTotal: zs.weatherScore.avgCloudTotal,
    cloudLow: zs.weatherScore.avgCloudLow,
    precip: zs.weatherScore.maxPrecip,
    wind: zs.weatherScore.avgWind,
    temp: zs.weatherScore.tempC,
    score: zs.score.total,
    verdict: zs.score.excluded ? 'EXCL' : classifyCheckpoint(zs.weatherScore),
    excluded: zs.score.excluded,
    exclusionReasons: zs.score.exclusionReasons,
    breakdown: zs.score.breakdown,
  }));

  // Calculate timeline
  const primaryDriveMin = primary ? (primary.zone.driveMinutes[0] + primary.zone.driveMinutes[1]) / 2 : 45;
  const departHour = Math.max(17, parseInt(darkWindow.darkStart) - 1);
  const arriveHour = departHour + Math.ceil(primaryDriveMin / 60);
  const nextDateStr = addDaysToDateStr(dateStr, 1);

  // Road safety assessment
  const roadRisk = assessRoadRisk(zoneScores);

  const selectedLocationIds = new Set([primaryLoc?.id, backupALoc?.id, backupBLoc?.id].filter(Boolean));
  const explorer = buildExplorer(dateStr, weatherMap, opts, selectedLocationIds, activeZones);

  // Build the full plan object
  return {
    date: dateStr,
    generatedAt: new Date().toISOString(),
    cityName,
    auroraLatitude: opts.auroraLatitude || null,
    auroraNote: opts.auroraNote || null,
    regionSafetyNotes: opts.regionSafetyNotes || null,
    darkWindow,
    settings: {
      maxDriveMinutes: opts.maxDriveMinutes,
      driveLimitMode: opts.driveLimitMode,
      winterComfort: opts.winterComfort,
      includeBorderCrossing: opts.includeBorderCrossing,
      includeFerry: opts.includeFerry,
      timeZone: opts.timeZone,
    },
    explorer,

    // Section 1: Tonight at a glance
    atAGlance: {
      skyWinner: primary ? `Zone ${primary.zoneCode} (${primary.zone.name}) - ${primary.weatherScore.avgCloudTotal}% cloud cover, ${primary.weatherScore.avgCloudLow}% low cloud` : 'Unable to determine - check weather manually',
      auroraPotential: `Kp ${aurora.tonightKp.max ?? '?'} forecast (${aurora.activityLevel}). ${aurora.visibility}`,
      auroraNote: opts.auroraNote || null,
      auroraLatitude: opts.auroraLatitude || null,
      tempWind: primary ? `${primary.weatherScore.tempC}°C at destination, wind ${primary.weatherScore.avgWind}m/s (gusts ${primary.weatherScore.maxGust}m/s)` : 'Check weather manually',
      roadRisk: roadRisk.summary,
      regionSafetyNotes: opts.regionSafetyNotes || null,
      confidence: `${confidence.level} - ${confidence.reason}`,
    },

    // Section 2: Decision rule
    decisionRule: {
      checkpoints: checkpointSummary,
      thresholds: {
        go: 'Cloud total < 40% AND low cloud < 25% AND precip = 0mm',
        maybe: 'Cloud total 40-70% OR low cloud 25-50% OR light precip < 0.3mm',
        noGo: 'Cloud total > 80% AND low cloud > 60% OR heavy precip > 1mm',
      },
      tiebreakers: 'If tied: least precip > lowest wind > shortest drive > darkest sky',
    },

    // Section 3: Timeline (with epoch ms for countdown timer)
    timeline: {
      forecastCheck: '15:00',
      finalCommit: '19:00',
      depart: `${String(departHour).padStart(2, '0')}:00`,
      arrive: `${String(Math.min(arriveHour, 23)).padStart(2, '0')}:00`,
      bestWindow: `${darkWindow.darkStart} - 01:00`,
      repositionTrigger: '22:00 (if primary not working, switch to backup)',
      giveUp: '02:00 (fatigue safety - begin return)',
      // Epoch timestamps for frontend countdown timer (timezone-aware; handles DST)
      epochs: {
        forecastCheck: zonedTimeToUtcMs(dateStr, '15:00', opts.timeZone),
        finalCommit: zonedTimeToUtcMs(dateStr, '19:00', opts.timeZone),
        depart: zonedTimeToUtcMs(dateStr, `${String(departHour).padStart(2, '0')}:00`, opts.timeZone),
        repositionTrigger: zonedTimeToUtcMs(dateStr, '22:00', opts.timeZone),
        giveUp: zonedTimeToUtcMs(nextDateStr, '02:00', opts.timeZone),
      },
    },

    // Sections 4-6: Plans
    primary: primary ? formatDestination(primary, primary.weatherScore, primaryLoc, primary.zone) : null,
    backupA: backupA ? formatDestination(backupA, backupA.weatherScore, backupALoc, backupA.zone) : null,
    backupB: backupB ? formatDestination(backupB, backupB.weatherScore, backupBLoc, backupB.zone) : null,

    // Section 7: On-site loop
    onsiteLoop: {
      interval: '20 minutes',
      steps: [
        { step: 1, name: 'Sky Test', action: 'Look straight up. Can you see stars clearly? Count at least 5 stars in a fist-sized patch of sky. YES → continue. NO → start 10-min countdown to switch.' },
        { step: 2, name: 'Aurora Test', action: 'Look north, low on horizon. Any faint greenish/whitish glow or arc? Take a 10-sec test shot at ISO 6400. Check camera screen for green/purple bands. FAINT ARC → stay, keep shooting. MOVEMENT → switch to fast aurora preset. NOTHING → continue waiting.' },
        { step: 3, name: 'Decision', action: 'STAY if sky is clear and you see glow. MOVE 10-30 km along your zone if clouds are partial. SWITCH ZONE if solid overcast or precip starts. Check weather radar on phone.' },
        { step: 4, name: 'Warm-up', action: 'After 20 min outside: return to car for 5 min. Run engine for heat. Check extremities for numbness. Drink warm beverage. Do NOT skip this in temps below -10°C.' },
      ],
    },

    // Section 8: Photo playbook
    photoPlaybook: {
      focusMethod: [
        'Switch lens to manual focus',
        'Use live view + magnify (5x or 10x) on a bright star',
        'Adjust focus ring until star is the smallest possible point',
        'Mark focus position with gaffer tape on lens ring',
        'Re-check focus every 30 minutes (cold causes lens shift)',
      ],
      presets: {
        faintAurora: { iso: 3200, shutter: '15s', aperture: 'f/2.8 (widest)', notes: 'Long exposure to capture faint glow. Use intervalometer.' },
        moderateAurora: { iso: 1600, shutter: '8s', aperture: 'f/2.8', notes: 'Good balance of detail and noise. Sweet spot for most displays.' },
        fastDancing: { iso: 3200, shutter: '2-4s', aperture: 'f/2.8', notes: 'Short exposure to freeze curtain movement. Accept more noise.' },
      },
      adjustmentRules: [
        'Aurora too dark → increase ISO one stop (e.g., 1600 → 3200). Only increase shutter if aurora is stationary.',
        'Aurora washed out / too bright → decrease ISO or shorten shutter. Lucky you!',
        'Stars are trails → shorten shutter speed. At 14mm use max ~20s, at 24mm max ~12s.',
        'Aurora is blurry smear → shutter too long for the movement speed. Drop to 3-5s and raise ISO.',
      ],
      batteryTips: [
        'Carry 3+ fully charged batteries. Cold halves battery life.',
        'Keep spare batteries in inner jacket pocket (body heat).',
        'When swapping, put cold battery in warm pocket - it will recover some charge.',
        'Avoid chimping (reviewing every shot) - screen drains battery fast.',
      ],
      condensationTips: [
        'When moving from cold to warm car, put camera in sealed plastic bag FIRST.',
        'Let camera warm up slowly in the bag for 15-20 minutes.',
        'If lens fogs: do NOT wipe. Wait for it to clear or use a hand warmer near (not on) the lens.',
      ],
    },

    // Section 9: Safety
    safety: {
      driving: [
        'Max speed 60-70 km/h on unfamiliar winter roads at night',
        'Keep 4+ seconds following distance on ice/snow',
        'Only stop in designated pull-offs or wide shoulders - NEVER on the road surface',
        'Use low beam headlights in snow (high beams reflect off flakes)',
        'If visibility drops below 50m, slow to 30 km/h or stop safely',
      ],
      visibility: [
        'Wear a reflective vest ANY time you exit the car on a road',
        'Place a reflective triangle 50m behind your car if stopped on a shoulder',
        'Keep parking lights on while stopped near roads',
      ],
      cold: [
        'Dress in layers: base (merino), mid (fleece/down), shell (windproof)',
        'Protect extremities first: insulated boots, double gloves (liner + outer), balaclava',
        'Recognize frostbite signs: white/waxy patches on nose, ears, fingers. Warm IMMEDIATELY.',
        'Hypothermia signs: uncontrolled shivering, confusion, slurred speech. GET IN CAR, heat on max, drive to safety.',
        'Never fall asleep in a non-running car in sub-zero temps',
      ],
      parking: [
        'Park fully off the road surface on solid ground',
        'Do not block driveways, farm gates, or snow plow access',
        'Leave space for other aurora chasers to pass',
        'Do not park in "No Parking" areas even briefly',
        'Turn off all car lights when viewing (preserve night vision)',
      ],
      abortTriggers: [
        'Road closure or police advisory',
        'Whiteout conditions or near-zero visibility driving',
        'Wind gusts > 25 m/s making driving unsafe',
        'Any sign of hypothermia or frostbite in yourself',
        'Vehicle issues (low fuel, warning lights, stuck)',
        'Extreme fatigue - if you feel drowsy, stop immediately',
      ],
    },

    // Section 10: Packing checklist
    packingChecklist: {
      worn: [
        'Insulated winter boots (rated -25°C or colder)',
        'Thermal base layers (top + bottom)',
        'Down/insulated jacket + windproof shell',
        'Double glove system (thin liner for camera work + thick insulated)',
        'Balaclava or buff + warm hat',
      ],
      cameraKit: [
        'Camera with fully charged battery',
        '2-3 spare batteries (in warm pocket)',
        'Wide-angle lens (14-24mm ideal)',
        'Sturdy tripod with weight hook',
        'Headlamp with RED light mode (preserves night vision)',
        'Lens cloth + gaffer tape (for focus lock)',
      ],
      carEmergency: [
        'Phone charger (car + power bank)',
        'Thermos with hot drink',
        'Snacks (chocolate, nuts)',
        'Reflective vest + warning triangle',
        'Windshield scraper + de-icer',
        'Blanket / emergency sleeping bag',
      ],
    },

    // Aurora data for display
    aurora,
    // Raw zone scores for debugging / display
    zoneScores: checkpointSummary,
  };
}

// Generate the condensed 12-line version
export function condensePlan(plan) {
  if (!plan) return 'No plan available.';

  const p = plan.primary;
  const lines = [
    `DATE: ${plan.date} | Confidence: ${plan.atAGlance.confidence}`,
    `AURORA: Kp ${plan.aurora.tonightKp.max ?? '?'} (${plan.aurora.activityLevel}) | Dark: ${plan.darkWindow.darkStart}-${plan.darkWindow.darkEnd}`,
    `SKY WINNER: ${plan.atAGlance.skyWinner}`,
    `---`,
    `PRIMARY: ${p?.location ?? 'N/A'} → "${p?.anchor ?? ''}" | Drive: ${p?.driveTime ?? '?'}`,
    `BACKUP A: ${plan.backupA?.location ?? 'N/A'} → "${plan.backupA?.anchor ?? ''}"`,
    `BACKUP B: ${plan.backupB?.location ?? 'N/A'} → "${plan.backupB?.anchor ?? ''}"`,
    `---`,
    `DEPART: ${plan.timeline.depart} | ARRIVE: ${plan.timeline.arrive} | WINDOW: ${plan.timeline.bestWindow}`,
    `SWITCH IF: no stars after 15min / precip starts / cloud incoming`,
    `CAMERA: ISO 1600-3200 | 8-15s | f/2.8 | Manual focus on star`,
    `GIVE UP: ${plan.timeline.giveUp} | Stay warm, stay safe.`,
  ];
  return lines.join('\n');
}

// Generate "UPDATE NOW" response
export function generateUpdateResponse(currentLocation, skyCondition, snowCondition, plan) {
  const actions = [];

  if (skyCondition === 'clear') {
    actions.push('STAY - Clear skies! Set up and start shooting.');
    actions.push(`Camera preset: ${plan?.aurora?.activityLevel === 'STRONG' || plan?.aurora?.activityLevel === 'EXTREME' ? 'Fast Dancing (ISO 3200, 2-4s, f/2.8)' : 'Moderate (ISO 1600, 8s, f/2.8)'}`);
    actions.push('Run 20-min on-site loop. Check for aurora movement and adjust shutter speed.');
  } else if (skyCondition === 'partly') {
    actions.push('STAY 20 MIN - Watch for clearing trend. Take test shots through gaps.');
    actions.push('If cloud cover increasing: MOVE 20-40 min toward clearest backup zone.');
    actions.push(`Camera preset: Faint Aurora (ISO 3200, 15s, f/2.8) - shoot through clear patches.`);
  } else {
    // cloudy
    if (snowCondition === 'heavy') {
      actions.push('SWITCH TO BACKUP B (closest safe option) or return to base.');
    } else {
      actions.push(`MOVE to ${plan?.backupA?.location ?? 'Backup A'} → "${plan?.backupA?.anchor ?? 'check plan'}" (different cloud regime)`);
    }
    actions.push('Drive carefully. Re-assess every 20 km for clearing.');
    actions.push('If no improvement after 45 min of driving: abort to closest safe parking, reassess.');
  }

  return {
    currentLocation,
    skyCondition,
    snowCondition,
    actions,
    timestamp: new Date().toISOString(),
  };
}

// Camera help diagnostics
export function diagnoseCamera(issue) {
  const diagnoses = {
    blurry: {
      problem: 'Image is blurry',
      causes: ['Focus has drifted (cold causes lens elements to shift)', 'Shutter speed too long for aurora movement', 'Tripod not stable / vibration'],
      fixes: [
        'FIRST: Re-check focus using live view + magnify on a bright star. Re-tape focus ring.',
        'If stars are sharp but aurora is smeared: reduce shutter to 3-5s, increase ISO to 3200-6400.',
        'Hang bag from tripod center hook for stability. Shield from wind with your body.',
        'Use 2-second timer or remote release to avoid camera shake when pressing shutter.',
      ],
    },
    dark: {
      problem: 'Image is too dark',
      causes: ['ISO too low', 'Shutter too short', 'Aperture not fully open'],
      fixes: [
        'FIRST: Open aperture to widest (lowest f-number, e.g., f/2.8 or f/1.4).',
        'THEN: Increase ISO one stop at a time (1600 → 3200 → 6400). Check noise.',
        'THEN: Increase shutter to 10-15s (max 20s at 14mm before star trails).',
        'If still dark at ISO 6400 + 15s: aurora may simply be very faint. Try again in 20 min.',
      ],
    },
    'washed out': {
      problem: 'Image is washed out / too bright',
      causes: ['ISO too high', 'Shutter too long', 'Light pollution in frame', 'Moon in frame'],
      fixes: [
        'FIRST: Reduce ISO (6400 → 3200 → 1600).',
        'THEN: Reduce shutter (15s → 8s → 4s).',
        'Aim camera away from city light dome (shoot north or into dark horizon).',
        'If moon is up, use it as a creative element but reduce exposure significantly.',
      ],
    },
    'green blob': {
      problem: 'Aurora appears as a green blob with no structure',
      causes: ['Shutter speed too long for active aurora', 'Overexposed aurora band'],
      fixes: [
        'FIRST: Reduce shutter to 2-4 seconds. This freezes curtain structure.',
        'THEN: Reduce ISO if image is bright enough (e.g., 3200 → 1600).',
        'Fast-moving aurora NEEDS short exposures (1-4s) to show curtain/ray detail.',
        'The more movement you see with your eyes, the shorter the shutter should be.',
      ],
    },
  };

  const key = issue.toLowerCase();
  return diagnoses[key] || {
    problem: `Issue: ${issue}`,
    causes: ['Unknown issue'],
    fixes: [
      'Take a test shot: ISO 3200, 8s, f/2.8, manual focus on star.',
      'If stars are points: focus is good. Adjust exposure.',
      'If stars are blobs: re-focus using live view magnification.',
      'If image is black: check lens cap, check shutter is opening, check battery.',
    ],
  };
}

// Assess overall road risk
function assessRoadRisk(zoneScores) {
  const risks = [];
  let worstRisk = 'LOW';

  for (const zs of zoneScores) {
    if (zs.weatherScore.maxGust > 20) {
      risks.push(`High winds at ${zs.checkpoint.name} (gusts ${zs.weatherScore.maxGust}m/s)`);
      worstRisk = 'HIGH';
    } else if (zs.weatherScore.maxGust > 12) {
      risks.push(`Moderate winds at ${zs.checkpoint.name} (gusts ${zs.weatherScore.maxGust}m/s)`);
      if (worstRisk === 'LOW') worstRisk = 'MODERATE';
    }
    if (zs.weatherScore.maxPrecip > 1) {
      risks.push(`Significant precip at ${zs.checkpoint.name} (${zs.weatherScore.maxPrecip}mm) - reduced visibility`);
      worstRisk = 'HIGH';
    } else if (zs.weatherScore.maxPrecip > 0.3) {
      risks.push(`Light precip at ${zs.checkpoint.name}`);
      if (worstRisk === 'LOW') worstRisk = 'MODERATE';
    }
  }

  const summary = risks.length === 0
    ? 'LOW - No significant road hazards detected in forecast.'
    : `${worstRisk} - ${risks.slice(0, 3).join('. ')}.`;

  return { level: worstRisk, risks, summary };
}
