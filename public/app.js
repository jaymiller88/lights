// Aurora Chase Copilot - Frontend Application

let currentPlan = null;
let countdownInterval = null;

// --- User settings (persisted) ---

const SETTINGS_KEY = 'nl_settings_v1';
const RECENT_ORIGINS_KEY = 'nl_recent_origins_v1';
const FAV_ORIGINS_KEY = 'nl_fav_origins_v1';
const LAST_PLAN_KEY = 'nl_last_plan_v1';
const GEO_PROMPT_DISMISS_UNTIL_KEY = 'nl_geo_prompt_dismiss_until_v1';

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultSettings() {
  return {
    origin: 'Reykjavík',
    originSource: 'default', // default | manual | gps
    originUpdatedAt: null,
    date: todayLocalISO(),
    maxDriveMinutes: 180,
    driveLimitMode: 'hard', // hard = hide over-budget, soft = show but penalize
    winterComfort: 'medium', // low | medium | high
    includeBorderCrossing: true,
    includeFerry: true,
  };
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  const s = raw ? safeJsonParse(raw, null) : null;
  const merged = { ...defaultSettings(), ...(s || {}) };
  // Backward-compat: infer originSource for older saved settings.
  const o = (merged.origin || '').trim();
  const isDefaultOrigin = o.toLowerCase() === 'reykjavík' || o.toLowerCase() === 'reykjavik' || o.toLowerCase() === 'tromsø' || o.toLowerCase() === 'tromso';
  if (merged.originSource === 'default' && o && !isDefaultOrigin) {
    merged.originSource = 'manual';
  }
  return merged;
}

let userSettings = loadSettings();

function saveSettings(next) {
  userSettings = { ...userSettings, ...next };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(userSettings));
  updateSubtitle();
}

function updateSubtitle() {
  const el = document.getElementById('subtitle');
  if (!el) return;
  const hrs = (userSettings.maxDriveMinutes / 60);
  const hrsLabel = hrs >= 3 ? `${hrs}h radius` : `${hrs}h max`;
  const comfort = userSettings.winterComfort === 'low' ? 'cautious' :
                  userSettings.winterComfort === 'high' ? 'confident' : 'balanced';
  const origin = (userSettings.origin || 'Reykjavík').trim();
  const coordRe = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;
  const originLabel = (userSettings.originSource === 'gps' && coordRe.test(origin)) ? 'GPS' : origin;
  // Show the active city name from the last plan if available
  const cityName = currentPlan?.cityName;
  const cityLabel = cityName && cityName !== origin ? ` (${cityName})` : '';
  el.textContent = `${hrsLabel} • ${originLabel}${cityLabel} • ${comfort}`;
}

function getRecentOrigins() {
  return safeJsonParse(localStorage.getItem(RECENT_ORIGINS_KEY) || '[]', []).filter(Boolean);
}

function setRecentOrigins(list) {
  localStorage.setItem(RECENT_ORIGINS_KEY, JSON.stringify(list.slice(0, 8)));
}

function addRecentOrigin(origin) {
  const o = (origin || '').trim();
  if (!o) return;
  const recents = getRecentOrigins();
  const next = [o, ...recents.filter(x => x !== o)];
  setRecentOrigins(next);
}

function getFavOrigins() {
  return safeJsonParse(localStorage.getItem(FAV_ORIGINS_KEY) || '[]', []).filter(Boolean);
}

function setFavOrigins(list) {
  localStorage.setItem(FAV_ORIGINS_KEY, JSON.stringify(list.slice(0, 12)));
}

function addFavOrigin(origin) {
  const o = (origin || '').trim();
  if (!o) return;
  const favs = getFavOrigins();
  if (favs.includes(o)) return;
  setFavOrigins([o, ...favs]);
}

function removeFavOrigin(origin) {
  const o = (origin || '').trim();
  if (!o) return;
  setFavOrigins(getFavOrigins().filter(x => x !== o));
}

function saveLastPlan(plan) {
  try {
    localStorage.setItem(LAST_PLAN_KEY, JSON.stringify({ plan, savedAt: Date.now() }));
  } catch {
    // Ignore quota errors.
  }
}

function restoreLastPlanIfFresh() {
  const raw = localStorage.getItem(LAST_PLAN_KEY);
  if (!raw) return;
  const parsed = safeJsonParse(raw, null);
  const plan = parsed?.plan;
  if (!plan?.date || !plan?.generatedAt) return;

  // Only restore if it's for today's date (local) and reasonably fresh.
  const isToday = plan.date === todayLocalISO();
  const ageMs = Date.now() - new Date(plan.generatedAt).getTime();
  if (!isToday || ageMs > 12 * 60 * 60 * 1000) return;

  currentPlan = plan;
  renderPlan(plan);
  startCountdown(plan);
  setStatus('ok', 'Plan restored');
}

function formatCoordOrigin(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return `${la.toFixed(5)},${lo.toFixed(5)}`;
}

function getGeoPromptDismissUntil() {
  const raw = localStorage.getItem(GEO_PROMPT_DISMISS_UNTIL_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function dismissGeoPrompt(days = 7) {
  const until = Date.now() + days * 24 * 60 * 60 * 1000;
  localStorage.setItem(GEO_PROMPT_DISMISS_UNTIL_KEY, String(until));
}

function hideLocationPrompt() {
  const el = document.getElementById('location-prompt');
  if (!el) return;
  el.classList.add('hidden');
  el.innerHTML = '';
}

function requestGpsOrigin() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not available on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos?.coords?.latitude;
        const lon = pos?.coords?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          reject(new Error('GPS returned an invalid location.'));
          return;
        }
        resolve({ lat, lon });
      },
      (err) => {
        const msg = err?.message || (err?.code === 1 ? 'Permission denied' : 'Unable to get location');
        reject(new Error(msg));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function maybeShowLocationPrompt() {
  const el = document.getElementById('location-prompt');
  if (!el) return;
  if (!navigator.geolocation) return;

  const originSource = userSettings.originSource || 'default';
  if (originSource !== 'default') return;
  if (Date.now() < getGeoPromptDismissUntil()) return;

  // If geolocation is already granted, quietly set the origin without extra UI.
  if (navigator.permissions?.query) {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm?.state === 'granted') {
        try {
          const { lat, lon } = await requestGpsOrigin();
          const origin = formatCoordOrigin(lat, lon);
          if (origin) {
            addRecentOrigin(origin);
            saveSettings({ origin, originSource: 'gps', originUpdatedAt: Date.now() });
            hideLocationPrompt();
            return;
          }
        } catch {
          // Fall back to showing the prompt.
        }
      }
    } catch {
      // Ignore permissions API failures.
    }
  }

  el.innerHTML = `
    <div class="location-prompt-title">Use your current location as your starting point?</div>
    <div class="text-sm text-muted">
      This sets the <strong>start</strong> used for driving directions links. It's saved on this device only.
    </div>
    <div class="location-prompt-actions">
      <button class="mini-btn primary" id="geo-prompt-use">Use my location</button>
      <button class="mini-btn" id="geo-prompt-skip">Not now</button>
      <button class="mini-btn" id="geo-prompt-settings">Settings</button>
    </div>
    <div id="geo-prompt-msg" class="text-sm text-muted mt-8"></div>
  `;
  el.classList.remove('hidden');

  const useBtn = el.querySelector('#geo-prompt-use');
  const skipBtn = el.querySelector('#geo-prompt-skip');
  const settingsBtn = el.querySelector('#geo-prompt-settings');
  const msgEl = el.querySelector('#geo-prompt-msg');

  useBtn?.addEventListener('click', async () => {
    if (useBtn) useBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
    if (settingsBtn) settingsBtn.disabled = true;
    if (msgEl) msgEl.textContent = 'Requesting GPS...';

    try {
      const { lat, lon } = await requestGpsOrigin();
      const origin = formatCoordOrigin(lat, lon);
      if (!origin) throw new Error('GPS returned an invalid location.');

      addRecentOrigin(origin);
      saveSettings({ origin, originSource: 'gps', originUpdatedAt: Date.now() });

      if (msgEl) msgEl.textContent = 'Starting point set to GPS.';
      setTimeout(() => hideLocationPrompt(), 600);
    } catch (err) {
      if (msgEl) msgEl.textContent = `GPS failed: ${err.message}`;
      if (useBtn) useBtn.disabled = false;
      if (skipBtn) skipBtn.disabled = false;
      if (settingsBtn) settingsBtn.disabled = false;
    }
  });

  skipBtn?.addEventListener('click', () => {
    dismissGeoPrompt(7);
    hideLocationPrompt();
  });

  settingsBtn?.addEventListener('click', () => {
    hideLocationPrompt();
    showSettingsModal();
  });
}

// --- API calls ---

async function api(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'API request failed');
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Main Commands ---

function detectCity(origin) {
  const o = (origin || '').trim();
  if (!o) return '';
  // If it looks like GPS coordinates, it's not a city name
  const coordRe = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;
  if (coordRe.test(o)) return '';
  return o;
}

async function runPlan() {
  showLoading(true);
  hideError();
  hidePlanContent();
  setStatus('loading', 'Fetching data...');

  try {
    const city = detectCity(userSettings.origin);
    const timeZone = userSettings.detectedTimeZone || 'Europe/Oslo';

    // Always send settings so the backend can score/filter consistently.
    const params = new URLSearchParams({
      date: userSettings.date || todayLocalISO(),
      maxDriveMinutes: String(userSettings.maxDriveMinutes ?? 180),
      driveLimitMode: userSettings.driveLimitMode || 'hard',
      winterComfort: userSettings.winterComfort || 'medium',
      includeBorderCrossing: userSettings.includeBorderCrossing ? '1' : '0',
      includeFerry: userSettings.includeFerry ? '1' : '0',
      timeZone,
    });
    if (city) {
      params.set('city', city);
    }
    const data = await api(`/api/plan?${params.toString()}`);
    currentPlan = data.plan;

    // Pick up AI-detected timezone for future requests
    if (data.plan?.settings?.timeZone && data.plan.settings.timeZone !== timeZone) {
      saveSettings({ detectedTimeZone: data.plan.settings.timeZone });
    }

    renderPlan(data.plan);
    startCountdown(data.plan);
    saveLastPlan(data.plan);
    updateSubtitle();
    setStatus('ok', data.cached ? 'Plan loaded (cached)' : 'Plan generated');
  } catch (err) {
    showError(`Failed to generate plan: ${err.message}`);
    setStatus('error', 'Error');
  } finally {
    showLoading(false);
  }
}

async function condensePlan() {
  if (!currentPlan) {
    showError('Run the daily plan first before condensing.');
    return;
  }

  try {
    const data = await api('/api/condense');
    showModal(`
      <div class="modal-title">CONDENSED PLAN</div>
      <div class="condensed-view">${escapeHtml(data.condensed)}</div>
    `);
  } catch (err) {
    showError(err.message);
  }
}

function showSettingsModal() {
  const favs = getFavOrigins();
  const recents = getRecentOrigins();

  const originSuggestions = [
    'Reykjavík',
    'Reykjavík city center',
    'Keflavík airport',
    'Tromsø',
    'Tromsø city center',
    ...favs,
    ...recents,
  ].filter(Boolean);

  const suggestionOptions = [...new Set(originSuggestions)].map(o => `<option value="${escapeHtml(o)}"></option>`).join('');

  const favChips = favs.length === 0 ? '<div class="text-sm text-muted">No favorites yet.</div>' : `
    <div class="chip-row">
      ${favs.map(o => `
        <button class="chip" data-origin-chip="${escapeHtml(o)}">${escapeHtml(o)}</button>
      `).join('')}
    </div>
  `;

  const recentChips = recents.length === 0 ? '' : `
    <div class="mt-8 text-sm text-muted">Recent</div>
    <div class="chip-row">
      ${recents.map(o => `
        <button class="chip chip-muted" data-origin-chip="${escapeHtml(o)}">${escapeHtml(o)}</button>
      `).join('')}
    </div>
  `;

  showModal(`
    <div class="modal-title">SETTINGS</div>

    <div class="modal-field">
      <label class="modal-label">Start Location (for directions)</label>
      <input type="text" class="modal-input" id="settings-origin" list="origin-suggestions" placeholder="Hotel name, address, or lat,lon">
      <datalist id="origin-suggestions">${suggestionOptions}</datalist>
      <div class="settings-row mt-8">
        <button class="mini-btn" id="settings-gps-btn">Use GPS</button>
        <button class="mini-btn" id="settings-fav-btn">Add Favorite</button>
      </div>
      <div id="settings-gps-status" class="text-sm text-muted mt-8"></div>
      <div class="mt-8 text-sm text-muted">Favorites</div>
      ${favChips}
      ${recentChips}
    </div>

    <div class="modal-field">
      <label class="modal-label">Plan Date (local)</label>
      <input type="date" class="modal-input" id="settings-date">
    </div>

    <div class="modal-field">
      <label class="modal-label">Max Drive Time</label>
      <select class="modal-select" id="settings-max-drive">
        <option value="60">1 hour</option>
        <option value="120">2 hours</option>
        <option value="180">3 hours</option>
        <option value="240">4 hours</option>
        <option value="360">6 hours</option>
      </select>
    </div>

    <div class="modal-field">
      <label class="modal-label">Drive Limit Mode</label>
      <select class="modal-select" id="settings-drive-mode">
        <option value="hard">Hard cutoff (hide over-budget)</option>
        <option value="soft">Soft (show but penalize)</option>
      </select>
    </div>

    <div class="modal-field">
      <label class="modal-label">Winter Driving Comfort</label>
      <select class="modal-select" id="settings-comfort">
        <option value="low">Low (prefer closer/safer)</option>
        <option value="medium">Medium</option>
        <option value="high">High (willing to drive)</option>
      </select>
    </div>

    <div class="modal-field">
      <label class="modal-label">Optional Destinations</label>
      <div class="check-row">
        <label class="check">
          <input type="checkbox" id="settings-border">
          Include border crossing options (Finland)
        </label>
      </div>
      <div class="check-row">
        <label class="check">
          <input type="checkbox" id="settings-ferry">
          Include ferry-risk options (Senja)
        </label>
      </div>
    </div>

    <div class="settings-row">
      <button class="modal-btn" id="settings-save-run">SAVE &amp; RUN</button>
      <button class="modal-btn modal-btn-secondary" id="settings-save">SAVE</button>
    </div>
  `);

  // Populate current values
  const originInput = document.getElementById('settings-origin');
  originInput.value = userSettings.origin || '';
  originInput.dataset.originSource = userSettings.originSource || 'manual';
  originInput.addEventListener('input', () => {
    originInput.dataset.originSource = 'manual';
  });
  document.getElementById('settings-date').value = userSettings.date || todayLocalISO();
  document.getElementById('settings-max-drive').value = String(userSettings.maxDriveMinutes ?? 180);
  document.getElementById('settings-drive-mode').value = userSettings.driveLimitMode || 'hard';
  document.getElementById('settings-comfort').value = userSettings.winterComfort || 'medium';
  document.getElementById('settings-border').checked = !!userSettings.includeBorderCrossing;
  document.getElementById('settings-ferry').checked = !!userSettings.includeFerry;

  // Bind actions
  document.getElementById('settings-save-run').addEventListener('click', () => {
    persistSettingsFromModal();
    hideModal();
    runPlan();
  });
  document.getElementById('settings-save').addEventListener('click', () => {
    persistSettingsFromModal();
    hideModal();
  });
  document.getElementById('settings-gps-btn').addEventListener('click', useGpsForOrigin);
  document.getElementById('settings-fav-btn').addEventListener('click', () => {
    const origin = document.getElementById('settings-origin').value;
    addFavOrigin(origin);
    addRecentOrigin(origin);
    // Re-open to refresh chips quickly.
    showSettingsModal();
  });

  document.querySelectorAll('[data-origin-chip]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const val = btn.dataset.originChip || '';
      const input = document.getElementById('settings-origin');
      input.value = val;
      input.dataset.originSource = 'manual';
    });
  });
}

function persistSettingsFromModal() {
  const originEl = document.getElementById('settings-origin');
  const origin = originEl?.value || '';
  const date = document.getElementById('settings-date')?.value || todayLocalISO();
  const maxDriveMinutes = parseInt(document.getElementById('settings-max-drive')?.value || '180', 10);
  const driveLimitMode = document.getElementById('settings-drive-mode')?.value || 'hard';
  const winterComfort = document.getElementById('settings-comfort')?.value || 'medium';
  const includeBorderCrossing = !!document.getElementById('settings-border')?.checked;
  const includeFerry = !!document.getElementById('settings-ferry')?.checked;

  const prevOrigin = (userSettings.origin || '').trim();
  const nextOrigin = (origin.trim() || 'Reykjavík');
  const originSource = originEl?.dataset?.originSource
    ? originEl.dataset.originSource
    : (nextOrigin === prevOrigin ? (userSettings.originSource || 'manual') : 'manual');

  addRecentOrigin(origin);
  const originChanged = nextOrigin.toLowerCase() !== prevOrigin.toLowerCase();
  saveSettings({
    origin: nextOrigin,
    originSource: originSource === 'gps' ? 'gps' : 'manual',
    originUpdatedAt: originChanged ? Date.now() : (userSettings.originUpdatedAt || null),
    date,
    maxDriveMinutes: Number.isFinite(maxDriveMinutes) ? maxDriveMinutes : 180,
    driveLimitMode,
    winterComfort,
    includeBorderCrossing,
    includeFerry,
    // Reset detected timezone when origin changes so AI can re-detect it
    detectedTimeZone: originChanged ? undefined : userSettings.detectedTimeZone,
  });
}

function useGpsForOrigin() {
  const status = document.getElementById('settings-gps-status');
  if (status) status.textContent = 'Requesting GPS...';

  requestGpsOrigin().then(({ lat, lon }) => {
    const val = formatCoordOrigin(lat, lon);
    const input = document.getElementById('settings-origin');
    if (input && val) {
      input.value = val;
      input.dataset.originSource = 'gps';
    }
    if (status) status.textContent = val ? 'GPS set. Save to apply.' : 'GPS returned an invalid location.';
  }).catch((err) => {
    if (status) status.textContent = `GPS failed: ${err.message}`;
  });
}

function showUpdateModal() {
  showModal(`
    <div class="modal-title">UPDATE NOW</div>
    <p class="text-sm text-muted mb-8">Report your current conditions for immediate advice.</p>
    <div class="modal-field">
      <label class="modal-label">Current Location</label>
      <input type="text" class="modal-input" id="update-location" placeholder="e.g., Ersfjordbotn, Skibotn...">
    </div>
    <div class="modal-field">
      <label class="modal-label">Sky Condition</label>
      <select class="modal-select" id="update-sky">
        <option value="clear">Clear - stars visible</option>
        <option value="partly">Partly cloudy - some gaps</option>
        <option value="cloudy">Overcast - no stars</option>
      </select>
    </div>
    <div class="modal-field">
      <label class="modal-label">Snow / Precipitation</label>
      <select class="modal-select" id="update-snow">
        <option value="none">None</option>
        <option value="light">Light snow/drizzle</option>
        <option value="heavy">Heavy snow/rain</option>
      </select>
    </div>
    <button class="modal-btn" id="update-submit-btn">GET ADVICE</button>
    <div id="update-result"></div>
  `);
  document.getElementById('update-submit-btn').addEventListener('click', submitUpdate);
}

async function submitUpdate() {
  const location = document.getElementById('update-location').value || 'Unknown';
  const sky = document.getElementById('update-sky').value;
  const snow = document.getElementById('update-snow').value;

  try {
    const data = await api('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, sky, snow }),
    });

    const result = document.getElementById('update-result');
    result.innerHTML = `
      <div class="update-response">
        ${data.update.actions.map((a, i) => `
          <div class="update-action">${i === 0 ? '&#10148; ' : ''}${escapeHtml(a)}</div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    document.getElementById('update-result').innerHTML =
      `<div class="error-box">${escapeHtml(err.message)}</div>`;
  }
}

function showCameraModal() {
  showModal(`
    <div class="modal-title">CAMERA HELP</div>
    <p class="text-sm text-muted mb-8">What's wrong with your aurora shots?</p>
    <div class="modal-field">
      <label class="modal-label">Issue</label>
      <select class="modal-select" id="camera-issue">
        <option value="blurry">Blurry image</option>
        <option value="dark">Too dark</option>
        <option value="washed out">Washed out / too bright</option>
        <option value="green blob">Green blob (no structure)</option>
      </select>
    </div>
    <button class="modal-btn" id="camera-submit-btn">DIAGNOSE</button>
    <div id="camera-result"></div>
  `);
  document.getElementById('camera-submit-btn').addEventListener('click', submitCameraHelp);
}

async function submitCameraHelp() {
  const issue = document.getElementById('camera-issue').value;

  try {
    const data = await api(`/api/camera-help/${encodeURIComponent(issue)}`);
    const d = data.diagnosis;

    document.getElementById('camera-result').innerHTML = `
      <div class="diagnosis">
        <div class="diagnosis-problem">${escapeHtml(d.problem)}</div>
        <div class="diagnosis-section-title">Likely Causes</div>
        <ul class="plan-list warning">
          ${d.causes.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
        </ul>
        <div class="diagnosis-section-title">Fixes (Try In Order)</div>
        <ul class="plan-list success">
          ${d.fixes.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
        </ul>
      </div>
    `;
  } catch (err) {
    document.getElementById('camera-result').innerHTML =
      `<div class="error-box">${escapeHtml(err.message)}</div>`;
  }
}

async function showParking() {
  try {
    const data = await api('/api/parking');
    showModal(`
      <div class="modal-title">SAFE PARKING CHECK</div>
      <div class="parking-col">
        <div class="parking-col-title do">DO:</div>
        <ul class="plan-list success">
          ${data.rules.do.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
        </ul>
      </div>
      <div class="parking-col">
        <div class="parking-col-title dont">DON'T:</div>
        <ul class="plan-list warning">
          ${data.rules.dont.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
        </ul>
      </div>
    `);
  } catch (err) {
    showError(err.message);
  }
}

// --- Countdown Timer (Fix #10) ---

function startCountdown(plan) {
  if (countdownInterval) clearInterval(countdownInterval);
  if (!plan?.timeline?.epochs) return;

  const epochs = plan.timeline.epochs;
  const cityName = plan.cityName || 'Reykjavík';
  const events = [
    { key: 'forecastCheck', label: 'Forecast check' },
    { key: 'finalCommit', label: 'Final commit' },
    { key: 'depart', label: `Depart ${cityName}` },
    { key: 'repositionTrigger', label: 'Reposition trigger' },
    { key: 'giveUp', label: 'Give up & return' },
  ];

  function update() {
    const now = Date.now();
    // Find the next upcoming event
    let next = null;
    for (const ev of events) {
      const t = epochs[ev.key];
      if (t && t > now) { next = { ...ev, epoch: t }; break; }
    }

    const bar = document.getElementById('countdown-bar');
    if (!bar) return;

    if (!next) {
      bar.classList.add('hidden');
      clearInterval(countdownInterval);
      return;
    }

    bar.classList.remove('hidden');
    const diff = next.epoch - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const timeStr = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
    const isUrgent = diff < 600000; // < 10 min

    bar.querySelector('.countdown-event').textContent = next.label;
    const timeEl = bar.querySelector('.countdown-time');
    timeEl.textContent = timeStr;
    timeEl.className = 'countdown-time' + (isUrgent ? ' urgent' : '');
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

// --- Plan Renderer ---

function renderPlan(plan) {
  const el = document.getElementById('plan-content');
  el.innerHTML = '';

  // Section 1: Tonight at a Glance
  el.appendChild(renderSection(1, 'TONIGHT AT A GLANCE', renderGlance(plan)));

  // Section 2: Decision Rule
  el.appendChild(renderSection(2, 'DECISION RULE (AFTERNOON)', renderDecisionRule(plan)));

  // Section 3: Plan Timeline
  el.appendChild(renderSection(3, 'PLAN TIMELINE', renderTimeline(plan)));

  // Section 4: Primary Plan
  el.appendChild(renderSection(4, 'PRIMARY PLAN', renderDestination(plan.primary, 'primary', plan)));

  // Section 5: Backup A
  el.appendChild(renderSection(5, 'BACKUP A', renderDestination(plan.backupA, 'backup-a', plan)));

  // Section 6: Backup B
  el.appendChild(renderSection(6, 'BACKUP B', renderDestination(plan.backupB, 'backup-b', plan)));

  // Section 7: On-Site Loop
  el.appendChild(renderSection(7, 'ON-SITE OPERATING LOOP', renderOnsiteLoop(plan), true));

  // Section 8: Photo Playbook
  el.appendChild(renderSection(8, 'PHOTO PLAYBOOK', renderPhotoPlaybook(plan), true));

  // Section 9: Safety
  el.appendChild(renderSection(9, 'SAFETY', renderSafety(plan), true));

  // Section 10: Packing Checklist
  el.appendChild(renderSection(10, 'PACKING CHECKLIST', renderChecklist(plan)));

  // Section 11: Explore alternatives (optional)
  if (plan?.explorer?.locations?.length) {
    el.appendChild(renderSection(11, 'EXPLORE ALTERNATIVES', renderExplorer(plan), true));
  }

  el.classList.remove('hidden');

  // Bind all anchor-copy buttons via data attributes (Fix #8 - no inline onclick)
  el.querySelectorAll('[data-anchor]').forEach(btn => {
    btn.addEventListener('click', () => copyAnchor(btn, btn.dataset.anchor));
  });

  // Bind generic copy buttons (e.g., directions link)
  el.querySelectorAll('[data-copy-text]').forEach(btn => {
    btn.addEventListener('click', () => copyText(btn, btn.dataset.copyText));
  });

  // Bind explorer detail buttons
  el.querySelectorAll('[data-explore-id]').forEach(btn => {
    btn.addEventListener('click', () => showExplorerDetails(btn.dataset.exploreId));
  });

  // Bind checklist items with localStorage persistence (Fix #5)
  el.querySelectorAll('.checklist-item').forEach(item => {
    const key = item.dataset.checkKey;
    // Restore saved state
    if (key && localStorage.getItem(`checklist_${key}`) === '1') {
      item.classList.add('checked');
    }
    item.addEventListener('click', () => {
      item.classList.toggle('checked');
      if (key) {
        localStorage.setItem(`checklist_${key}`, item.classList.contains('checked') ? '1' : '0');
      }
    });
  });
}

function renderSection(num, title, contentHtml, collapsed = false) {
  const section = document.createElement('div');
  section.className = `plan-section${collapsed ? ' collapsed' : ''}`;
  section.innerHTML = `
    <div class="plan-section-header">
      <span class="section-number">${num}</span>
      <span class="section-title">${title}</span>
      <span class="section-chevron">&#9660;</span>
    </div>
    <div class="plan-section-body">${contentHtml}</div>
  `;
  section.querySelector('.plan-section-header').addEventListener('click', () => {
    section.classList.toggle('collapsed');
  });
  return section;
}

function renderGlance(plan) {
  const g = plan.atAGlance;
  const confClass = g.confidence.startsWith('HIGH') ? 'confidence-high' :
                     g.confidence.startsWith('MED') ? 'confidence-med' : 'confidence-low';
  const auroraLatClass = g.auroraLatitude === 'good' ? 'confidence-high' :
                          g.auroraLatitude === 'moderate' ? 'confidence-med' :
                          g.auroraLatitude ? 'confidence-low' : '';
  return `
    <ul class="glance-list">
      <li class="glance-item">
        <span class="glance-label">Sky Winner</span>
        <span class="glance-value">${escapeHtml(g.skyWinner)}</span>
      </li>
      <li class="glance-item">
        <span class="glance-label">Aurora</span>
        <span class="glance-value">${escapeHtml(g.auroraPotential)}</span>
      </li>
      ${g.auroraNote ? `
        <li class="glance-item">
          <span class="glance-label">Aurora Zone</span>
          <span class="glance-value ${auroraLatClass}">${escapeHtml(g.auroraNote)}</span>
        </li>
      ` : ''}
      <li class="glance-item">
        <span class="glance-label">Temp/Wind</span>
        <span class="glance-value">${escapeHtml(g.tempWind)}</span>
      </li>
      <li class="glance-item">
        <span class="glance-label">Road Risk</span>
        <span class="glance-value">${escapeHtml(g.roadRisk)}</span>
      </li>
      ${g.regionSafetyNotes ? `
        <li class="glance-item">
          <span class="glance-label">Travel Safety</span>
          <span class="glance-value">${escapeHtml(g.regionSafetyNotes)}</span>
        </li>
      ` : ''}
      <li class="glance-item">
        <span class="glance-label">Confidence</span>
        <span class="glance-value ${confClass}">${escapeHtml(g.confidence)}</span>
      </li>
    </ul>
    <div class="mt-12 text-sm text-muted font-mono">
      Dark window: ${escapeHtml(plan.darkWindow.darkStart)} &ndash; ${escapeHtml(plan.darkWindow.darkEnd)} &bull;
      Sunset: ${escapeHtml(plan.darkWindow.sunset)}
    </div>
  `;
}

function renderDecisionRule(plan) {
  const dr = plan.decisionRule;
  const rows = dr.checkpoints.map(cp => {
    const rawScore = typeof cp.score === 'number' ? cp.score : -1;
    const scoreVal = Math.max(0, rawScore);
    const scoreClass = scoreVal >= 60 ? 'score-high' : scoreVal >= 35 ? 'score-med' : 'score-low';
    const verdict = cp.verdict || '?';
    const verdictClass = verdict === 'GO' ? 'confidence-high' :
                          verdict === 'MAYBE' ? 'confidence-med' :
                          verdict === 'EXCL' ? 'text-muted' : 'confidence-low';
    const title = cp.excluded ? `Excluded: ${(cp.exclusionReasons || []).join('; ')}` : '';
    return `
      <tr title="${escapeHtml(title)}">
        <td>${escapeHtml(cp.name)}</td>
        <td>${cp.cloudTotal ?? '—'}%</td>
        <td>${cp.cloudLow ?? '—'}%</td>
        <td>${cp.precip ?? '—'}mm</td>
        <td>${cp.wind ?? '—'}m/s</td>
        <td><span class="${verdictClass}" style="font-weight:700">${escapeHtml(verdict)}</span></td>
        <td>
          <div class="score-bar ${scoreClass}">
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.min(scoreVal, 100)}%"></div></div>
            <span class="score-bar-value">${cp.excluded ? '-' : escapeHtml(rawScore)}</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <p class="text-sm mb-8">Check these values at 15:00 and 19:00. Compare zones to pick the best sky.</p>
    <div style="overflow-x:auto">
      <table class="checkpoint-table">
        <thead>
          <tr><th>Location</th><th>Cloud</th><th>Low Cld</th><th>Precip</th><th>Wind</th><th>Verdict</th><th>Score</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="threshold-box">
      <div class="threshold threshold-go">
        <span class="threshold-label" style="color:var(--success-text)">GO</span>
        <span>${escapeHtml(dr.thresholds.go)}</span>
      </div>
      <div class="threshold threshold-maybe">
        <span class="threshold-label" style="color:var(--warning-text)">MAYBE</span>
        <span>${escapeHtml(dr.thresholds.maybe)}</span>
      </div>
      <div class="threshold threshold-nogo">
        <span class="threshold-label" style="color:var(--danger-text)">NO GO</span>
        <span>${escapeHtml(dr.thresholds.noGo)}</span>
      </div>
    </div>
    <p class="mt-8 text-sm text-muted">Tie-breakers: ${escapeHtml(dr.tiebreakers)}</p>
  `;
}

function renderTimeline(plan) {
  const t = plan.timeline;
  const cityName = plan.cityName || 'Reykjavík';
  const items = [
    { time: t.forecastCheck, label: 'Forecast check + pick plan' },
    { time: t.finalCommit, label: 'Final commit check - lock in destination' },
    { time: t.depart, label: `Depart ${cityName}` },
    { time: t.arrive, label: 'Arrive at destination' },
    { time: t.bestWindow, label: 'Best watch window' },
    { time: t.repositionTrigger, label: 'Reposition trigger (switch if needed)' },
    { time: t.giveUp, label: 'Give up + return (fatigue safety)' },
  ];

  return `
    <ul class="timeline-list">
      ${items.map(i => `
        <li class="timeline-item">
          <span class="timeline-time">${escapeHtml(i.time)}</span>
          ${escapeHtml(i.label)}
        </li>
      `).join('')}
    </ul>
  `;
}

function renderDestination(dest, badgeClass, plan) {
  if (!dest) return '<p class="text-muted">No destination data available.</p>';

  const badgeLabel = badgeClass === 'primary' ? 'PRIMARY' :
                     badgeClass === 'backup-a' ? 'BACKUP A' : 'BACKUP B';

  const directionsUrl = buildDirectionsUrl(userSettings?.origin, dest.anchor);
  const cityName = plan?.cityName || 'Tromsø';

  // Fix #8: use data-anchor attribute instead of inline onclick
  return `
    <div class="dest-card">
      <div class="dest-header">
        <span class="dest-badge ${badgeClass}">${badgeLabel}</span>
        <span class="dest-name">${escapeHtml(dest.location)}</span>
      </div>
      <div class="dest-zone">${escapeHtml(dest.zone)} &bull; Est. drive (from ${escapeHtml(cityName)}): ${escapeHtml(dest.driveTime)}</div>

      <div class="dest-field mt-12">
        <div class="dest-field-label">Navigation Anchor</div>
        <button class="anchor-copy" data-anchor="${escapeHtml(dest.anchor)}">${escapeHtml(dest.anchor)}</button>
      </div>

      <div class="dest-field">
        <div class="dest-field-label">Directions</div>
        <div class="nav-row">
          <a class="nav-btn" href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener">Open driving directions</a>
          <button class="nav-btn nav-secondary" data-copy-text="${escapeHtml(directionsUrl)}">Copy link</button>
        </div>
        <div class="text-sm text-muted mt-8">Origin: ${escapeHtml((userSettings?.origin || 'Reykjavík').trim())}</div>
      </div>

      <div class="dest-field">
        <div class="dest-field-label">Why This Spot</div>
        <ul class="plan-list">
          ${dest.whyThisSpot.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
        </ul>
      </div>

      ${dest.travelSafety?.length ? `
        <div class="dest-field">
          <div class="dest-field-label">Travel Safety</div>
          <ul class="plan-list">
            ${dest.travelSafety.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="dest-field">
        <div class="dest-field-label">Parking</div>
        <div class="dest-field-value">${escapeHtml(dest.parking)}</div>
      </div>

      ${dest.warnings.length > 0 ? `
        <div class="dest-field">
          <div class="dest-field-label" style="color:var(--danger-text)">Warnings</div>
          <ul class="plan-list warning">
            ${dest.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="dest-field">
        <div class="dest-field-label">Arrival Checklist</div>
        <ul class="plan-list">
          ${dest.arrivalChecklist.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
        </ul>
      </div>

      <div class="dest-field">
        <div class="dest-field-label" style="color:var(--warning-text)">Switch Trigger (Move If...)</div>
        <ul class="plan-list warning">
          ${dest.switchTrigger.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
}

function renderOnsiteLoop(plan) {
  const loop = plan.onsiteLoop;
  return `
    <p class="text-sm mb-8">Repeat every ${escapeHtml(loop.interval)}. This keeps you actively assessing.</p>
    <div class="step-list">
      ${loop.steps.map(s => `
        <div class="step-item">
          <span class="step-num">${s.step}</span>
          <div class="step-content">
            <div class="step-name">${escapeHtml(s.name)}</div>
            <div class="step-action">${escapeHtml(s.action)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPhotoPlaybook(plan) {
  const pp = plan.photoPlaybook;
  return `
    <div class="dest-field">
      <div class="dest-field-label">Focus Method</div>
      <ul class="plan-list">
        ${pp.focusMethod.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
      </ul>
    </div>

    <div class="dest-field mt-12">
      <div class="dest-field-label">Starting Presets</div>
      <div class="preset-grid">
        ${Object.entries(pp.presets).map(([key, p]) => `
          <div class="preset-card">
            <div class="preset-name">${formatPresetName(key)}</div>
            <div class="preset-setting">ISO ${p.iso}</div>
            <div class="preset-setting">${p.shutter}</div>
            <div class="preset-setting">${p.aperture}</div>
            <div class="preset-note">${escapeHtml(p.notes)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="dest-field">
      <div class="dest-field-label">Adjustment Rules</div>
      <ul class="plan-list">
        ${pp.adjustmentRules.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>

    <div class="dest-field">
      <div class="dest-field-label">Battery Tips</div>
      <ul class="plan-list">
        ${pp.batteryTips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
    </div>

    <div class="dest-field">
      <div class="dest-field-label">Condensation Prevention</div>
      <ul class="plan-list">
        ${pp.condensationTips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderSafety(plan) {
  const s = plan.safety;
  return `
    <div class="dest-field">
      <div class="dest-field-label">Winter Driving</div>
      <ul class="plan-list">${s.driving.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>
    <div class="dest-field">
      <div class="dest-field-label">Roadside Visibility</div>
      <ul class="plan-list">${s.visibility.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>
    <div class="dest-field">
      <div class="dest-field-label">Cold Weather Protection</div>
      <ul class="plan-list">${s.cold.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>
    <div class="dest-field">
      <div class="dest-field-label">Parking Etiquette</div>
      <ul class="plan-list">${s.parking.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>
    <div class="dest-field">
      <div class="dest-field-label" style="color:var(--danger-text)">ABORT IMMEDIATELY IF:</div>
      <ul class="plan-list warning">${s.abortTriggers.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>
  `;
}

function renderChecklist(plan) {
  const cl = plan.packingChecklist;
  return `
    <div class="checklist-group">
      <div class="checklist-group-title">WORN</div>
      ${cl.worn.map((item, i) => checklistItem(`worn-${i}`, item)).join('')}
    </div>
    <div class="checklist-group">
      <div class="checklist-group-title">CAMERA KIT</div>
      ${cl.cameraKit.map((item, i) => checklistItem(`cam-${i}`, item)).join('')}
    </div>
    <div class="checklist-group">
      <div class="checklist-group-title">CAR EMERGENCY</div>
      ${cl.carEmergency.map((item, i) => checklistItem(`car-${i}`, item)).join('')}
    </div>
  `;
}

function renderExplorer(plan) {
  const ex = plan.explorer;
  const s = ex?.settings || plan?.settings || {};
  const maxDrive = typeof s.maxDriveMinutes === 'number' ? `${Math.round(s.maxDriveMinutes / 60)}h (${s.maxDriveMinutes} min)` : 'n/a';
  const mode = s.driveLimitMode || 'hard';
  const comfort = s.winterComfort || 'medium';
  const border = s.includeBorderCrossing ? 'on' : 'off';
  const ferry = s.includeFerry ? 'on' : 'off';

  const rows = (ex.locations || []).map(loc => {
    const excluded = !!loc.score?.excluded;
    const scoreRaw = typeof loc.score?.total === 'number' ? loc.score.total : -1;
    const scoreVal = Math.max(0, scoreRaw);
    const scoreClass = scoreVal >= 60 ? 'score-high' : scoreVal >= 35 ? 'score-med' : 'score-low';
    const verdict = loc.verdict || '?';
    const verdictClass = verdict === 'GO' ? 'confidence-high' :
                         verdict === 'MAYBE' ? 'confidence-med' :
                         verdict === 'EXCL' ? 'text-muted' : 'confidence-low';
    const why = excluded ? (loc.score.exclusionReasons || []).join('; ') : '';
    const warn = (loc.warnings || []).join(', ');

    return `
      <tr class="${excluded ? 'explorer-excluded' : ''}" title="${escapeHtml(why)}">
        <td class="mono">${escapeHtml(loc.zoneCode)}</td>
        <td>
          <div class="explorer-loc">
            <div class="explorer-loc-name">${escapeHtml(loc.name)}</div>
            <div class="explorer-loc-meta text-sm text-muted">
              ${escapeHtml(loc.zoneName)}${warn ? ` &bull; ${escapeHtml(warn)}` : ''}
            </div>
            <div class="mt-8">
              <button class="anchor-copy small" data-anchor="${escapeHtml(loc.anchor)}">${escapeHtml(loc.anchor)}</button>
            </div>
          </div>
        </td>
        <td class="mono">${escapeHtml(loc.driveTime || '')}</td>
        <td class="mono">${loc.weather?.cloudTotal ?? '?'}%</td>
        <td class="mono">${loc.weather?.cloudLow ?? '?'}%</td>
        <td class="mono">${loc.weather?.precip ?? '?'}mm</td>
        <td class="mono">${loc.weather?.wind ?? '?'}m/s</td>
        <td>
          <div class="score-bar ${scoreClass}">
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.min(scoreVal, 100)}%"></div></div>
            <span class="score-bar-value">${excluded ? '-' : escapeHtml(scoreRaw)}</span>
          </div>
        </td>
        <td class="mono"><span class="${verdictClass}" style="font-weight:700">${escapeHtml(verdict)}</span></td>
        <td><button class="mini-btn" data-explore-id="${escapeHtml(loc.id)}">Details</button></td>
      </tr>
    `;
  }).join('');

  const cityName = currentPlan?.cityName || 'Reykjavík';
  return `
    <div class="text-sm text-muted mb-8">
      Compare all scored locations (same scoring as the plan). Filters:
      max drive ${escapeHtml(maxDrive)}, mode ${escapeHtml(mode)}, comfort ${escapeHtml(comfort)}, border ${escapeHtml(border)}, ferry ${escapeHtml(ferry)}.
      Drive times shown are zone estimates from ${escapeHtml(cityName)}; use Directions for your actual start.
    </div>
    <div style="overflow-x:auto">
      <table class="explorer-table">
        <thead>
          <tr>
            <th>Zone</th><th>Location</th><th>Drive (est.)</th><th>Cloud</th><th>Low</th><th>Precip</th><th>Wind</th><th>Score</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function showExplorerDetails(locId) {
  const ex = currentPlan?.explorer;
  const loc = ex?.locations?.find(l => l.id === locId);
  if (!loc) return;

  const b = loc.score?.breakdown || {};
  const excluded = !!loc.score?.excluded;

  showModal(`
    <div class="modal-title">LOCATION DETAILS</div>
    <div class="dest-field">
      <div class="dest-field-label">Location</div>
      <div class="dest-field-value"><strong>${escapeHtml(loc.name)}</strong> &bull; ${escapeHtml(loc.zoneCode)} ${escapeHtml(loc.zoneName)}</div>
    </div>
    <div class="dest-field">
      <div class="dest-field-label">Anchor</div>
      <button class="anchor-copy" data-anchor="${escapeHtml(loc.anchor)}">${escapeHtml(loc.anchor)}</button>
    </div>
    <div class="dest-field">
      <div class="dest-field-label">Directions</div>
      <div class="nav-row">
        <a class="nav-btn" href="${escapeHtml(buildDirectionsUrl(userSettings?.origin, loc.anchor))}" target="_blank" rel="noopener">Open driving directions</a>
        <button class="nav-btn nav-secondary" data-copy-text="${escapeHtml(buildDirectionsUrl(userSettings?.origin, loc.anchor))}">Copy link</button>
      </div>
    </div>

    ${excluded ? `
      <div class="dest-field">
        <div class="dest-field-label" style="color:var(--danger-text)">Excluded By Settings</div>
        <ul class="plan-list warning">
          ${(loc.score?.exclusionReasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    <div class="dest-field">
      <div class="dest-field-label">Why / Weather</div>
      <ul class="plan-list">
        <li>Cloud: ${escapeHtml(loc.weather?.cloudTotal)}% total, ${escapeHtml(loc.weather?.cloudLow)}% low</li>
        <li>Precip: ${escapeHtml(loc.weather?.precip)}mm max</li>
        <li>Wind: ${escapeHtml(loc.weather?.wind)}m/s avg (gusts ${escapeHtml(loc.weather?.gust)}m/s)</li>
        <li>Temp: ${escapeHtml(loc.weather?.tempC)}°C</li>
        <li>Drive (est. from ${escapeHtml(currentPlan?.cityName || 'Reykjavík')}): ${escapeHtml(loc.driveTime)}</li>
        <li>Score: ${escapeHtml(loc.score?.total)}</li>
      </ul>
    </div>
    <div class="dest-field">
      <div class="dest-field-label">Score Breakdown</div>
      <ul class="plan-list">
        <li>Weather: ${escapeHtml(b.weather)}</li>
        <li>Darkness: ${escapeHtml(b.darkness)}</li>
        <li>Drive penalty: ${escapeHtml(b.drivePenalty)}</li>
        <li>Safety penalty: ${escapeHtml(b.safetyPenalty)}</li>
        <li>Over-limit penalty: ${escapeHtml(b.overLimitPenalty)}</li>
      </ul>
    </div>
    ${(loc.roadType || loc.cellCoverage || loc.nearestServices || loc.zoneSafetyNotes || loc.safetyNotes) ? `
      <div class="dest-field">
        <div class="dest-field-label">Travel Safety</div>
        <ul class="plan-list">
          ${loc.roadType ? `<li>Road: ${escapeHtml(loc.roadType)}</li>` : ''}
          ${loc.cellCoverage ? `<li>Cell coverage: ${escapeHtml(loc.cellCoverage)}</li>` : ''}
          ${loc.nearestServices ? `<li>Services: ${escapeHtml(loc.nearestServices)}</li>` : ''}
          ${loc.zoneSafetyNotes ? `<li>${escapeHtml(loc.zoneSafetyNotes)}</li>` : ''}
          ${loc.safetyNotes ? `<li>${escapeHtml(loc.safetyNotes)}</li>` : ''}
        </ul>
      </div>
    ` : ''}
    <div class="dest-field">
      <div class="dest-field-label">Parking</div>
      <div class="dest-field-value">${escapeHtml(loc.parking || '')}</div>
    </div>
    <div class="dest-field">
      <div class="dest-field-label">Notes</div>
      <div class="dest-field-value">${escapeHtml(loc.notes || '')}</div>
    </div>
  `);

  // Bind copy buttons in modal only (avoid double-binding the main page buttons)
  const modal = document.getElementById('modal-content');
  modal?.querySelectorAll('[data-anchor]').forEach(btn => {
    btn.addEventListener('click', () => copyAnchor(btn, btn.dataset.anchor));
  });
  modal?.querySelectorAll('[data-copy-text]').forEach(btn => {
    btn.addEventListener('click', () => copyText(btn, btn.dataset.copyText));
  });
}

// Fix #5: checklist items use data-check-key for localStorage persistence
function checklistItem(id, text) {
  return `
    <div class="checklist-item" data-check-key="${escapeHtml(id)}">
      <div class="checklist-box"></div>
      <span class="checklist-text">${escapeHtml(text)}</span>
    </div>
  `;
}

// --- Helpers ---

function formatPresetName(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

function isIOS() {
  // iPadOS can report as "MacIntel" but has touch points.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function buildDirectionsUrl(origin, destination) {
  const dest = (destination || '').trim();
  const org = (origin || '').trim();
  if (!dest) return '#';

  // Prefer Apple Maps on iOS to open the native app reliably.
  if (isIOS()) {
    if (!org) {
      return `https://maps.apple.com/?q=${encodeURIComponent(dest)}`;
    }
    const params = new URLSearchParams({
      saddr: org,
      daddr: dest,
      dirflg: 'd',
    });
    return `https://maps.apple.com/?${params.toString()}`;
  }

  if (!org) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`;
  }
  const params = new URLSearchParams({
    api: '1',
    origin: org,
    destination: dest,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function copyAnchor(el, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = el.textContent;
    el.textContent = 'Copied!';
    el.style.color = 'var(--success-text)';
    setTimeout(() => {
      el.textContent = orig;
      el.style.color = '';
    }, 1500);
  }).catch(() => {
    // Fallback: select text for manual copy
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

function copyText(el, text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const orig = el.textContent;
    el.textContent = 'Copied!';
    el.style.color = 'var(--success-text)';
    setTimeout(() => {
      el.textContent = orig;
      el.style.color = '';
    }, 1500);
  }).catch(() => {
    window.prompt('Copy this:', text);
  });
}

// --- UI State ---

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error').classList.add('hidden');
}

function hidePlanContent() {
  document.getElementById('plan-content').classList.add('hidden');
}

function setStatus(state, text) {
  const dot = document.querySelector('.status-dot');
  const txt = document.querySelector('.status-text');
  dot.className = 'status-dot' + (state === 'loading' ? ' loading' : state === 'error' ? ' error' : '');
  txt.textContent = text;
}

function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function closeModal(event) {
  if (event.target === document.getElementById('modal-overlay')) {
    hideModal();
  }
}

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideModal();
});

// --- Init ---
updateSubtitle();
restoreLastPlanIfFresh();
maybeShowLocationPrompt();
