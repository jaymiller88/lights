// Aurora Chase Copilot - Frontend Application

let currentPlan = null;
let countdownInterval = null;

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

async function runPlan() {
  showLoading(true);
  hideError();
  hidePlanContent();
  setStatus('loading', 'Fetching data...');

  try {
    const data = await api('/api/plan');
    currentPlan = data.plan;
    renderPlan(data.plan);
    startCountdown(data.plan);
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
  const events = [
    { key: 'forecastCheck', label: 'Forecast check' },
    { key: 'finalCommit', label: 'Final commit' },
    { key: 'depart', label: 'Depart Troms\u00f8' },
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
  el.appendChild(renderSection(4, 'PRIMARY PLAN', renderDestination(plan.primary, 'primary')));

  // Section 5: Backup A
  el.appendChild(renderSection(5, 'BACKUP A', renderDestination(plan.backupA, 'backup-a')));

  // Section 6: Backup B
  el.appendChild(renderSection(6, 'BACKUP B', renderDestination(plan.backupB, 'backup-b')));

  // Section 7: On-Site Loop
  el.appendChild(renderSection(7, 'ON-SITE OPERATING LOOP', renderOnsiteLoop(plan), true));

  // Section 8: Photo Playbook
  el.appendChild(renderSection(8, 'PHOTO PLAYBOOK', renderPhotoPlaybook(plan), true));

  // Section 9: Safety
  el.appendChild(renderSection(9, 'SAFETY', renderSafety(plan), true));

  // Section 10: Packing Checklist
  el.appendChild(renderSection(10, 'PACKING CHECKLIST', renderChecklist(plan)));

  el.classList.remove('hidden');

  // Bind all anchor-copy buttons via data attributes (Fix #8 - no inline onclick)
  el.querySelectorAll('[data-anchor]').forEach(btn => {
    btn.addEventListener('click', () => copyAnchor(btn, btn.dataset.anchor));
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
      <li class="glance-item">
        <span class="glance-label">Temp/Wind</span>
        <span class="glance-value">${escapeHtml(g.tempWind)}</span>
      </li>
      <li class="glance-item">
        <span class="glance-label">Road Risk</span>
        <span class="glance-value">${escapeHtml(g.roadRisk)}</span>
      </li>
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
    const scoreClass = cp.score >= 60 ? 'score-high' : cp.score >= 35 ? 'score-med' : 'score-low';
    const verdictClass = cp.verdict === 'GO' ? 'confidence-high' :
                          cp.verdict === 'MAYBE' ? 'confidence-med' : 'confidence-low';
    return `
      <tr>
        <td>${escapeHtml(cp.name)}</td>
        <td>${cp.cloudTotal}%</td>
        <td>${cp.cloudLow}%</td>
        <td>${cp.precip}mm</td>
        <td>${cp.wind}m/s</td>
        <td><span class="${verdictClass}" style="font-weight:700">${cp.verdict || '?'}</span></td>
        <td>
          <div class="score-bar ${scoreClass}">
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.min(cp.score, 100)}%"></div></div>
            <span class="score-bar-value">${cp.score}</span>
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
  const items = [
    { time: t.forecastCheck, label: 'Forecast check + pick plan' },
    { time: t.finalCommit, label: 'Final commit check - lock in destination' },
    { time: t.depart, label: 'Depart Troms\u00f8' },
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

function renderDestination(dest, badgeClass) {
  if (!dest) return '<p class="text-muted">No destination data available.</p>';

  const badgeLabel = badgeClass === 'primary' ? 'PRIMARY' :
                     badgeClass === 'backup-a' ? 'BACKUP A' : 'BACKUP B';

  // Fix #8: use data-anchor attribute instead of inline onclick
  return `
    <div class="dest-card">
      <div class="dest-header">
        <span class="dest-badge ${badgeClass}">${badgeLabel}</span>
        <span class="dest-name">${escapeHtml(dest.location)}</span>
      </div>
      <div class="dest-zone">${escapeHtml(dest.zone)} &bull; Drive: ${escapeHtml(dest.driveTime)}</div>

      <div class="dest-field mt-12">
        <div class="dest-field-label">Navigation Anchor</div>
        <button class="anchor-copy" data-anchor="${escapeHtml(dest.anchor)}">${escapeHtml(dest.anchor)}</button>
      </div>

      <div class="dest-field">
        <div class="dest-field-label">Why This Spot</div>
        <ul class="plan-list">
          ${dest.whyThisSpot.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
        </ul>
      </div>

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
