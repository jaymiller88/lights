// Minimal timezone helpers (no external deps).
// We use IANA tz names (e.g., "Europe/Oslo") so DST is handled correctly.

const DEFAULT_TIME_ZONE = 'Atlantic/Reykjavik';

function dtf(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function getZonedParts(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = dtf(timeZone).formatToParts(date);
  const out = {};
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

export function getZonedDateStr(date, timeZone = DEFAULT_TIME_ZONE) {
  const p = getZonedParts(date, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function getZonedHour(date, timeZone = DEFAULT_TIME_ZONE) {
  return getZonedParts(date, timeZone).hour;
}

export function formatTimeHHMM(date, timeZone = DEFAULT_TIME_ZONE) {
  const p = getZonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// Convert a local time (in `timeZone`) to a UTC epoch ms timestamp.
// `dateStr`: YYYY-MM-DD (local calendar date in that timezone)
// `timeStr`: HH:MM
export function zonedTimeToUtcMs(dateStr, timeStr, timeZone = DEFAULT_TIME_ZONE) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // Treat the local time as-if it were UTC, then compute and remove the tz offset.
  const utcAssumed = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const zoned = getZonedParts(utcAssumed, timeZone);
  const zonedAsUtcMs = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  const offsetMs = zonedAsUtcMs - utcAssumed.getTime();
  return utcAssumed.getTime() - offsetMs;
}

export function addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

