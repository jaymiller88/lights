import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generatePlan, condensePlan, generateUpdateResponse, diagnoseCamera } from './src/planner.js';
import { getZonedDateStr } from './src/timezone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3838;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Cache the last generated plan
let cachedPlan = null;
let cachedPlanKey = null;
let generating = false;

function parseBool(val, defaultValue) {
  if (val === undefined || val === null) return defaultValue;
  if (val === true || val === 'true' || val === '1') return true;
  if (val === false || val === 'false' || val === '0') return false;
  return defaultValue;
}

// GET /api/plan - Generate tonight's aurora plan
app.get('/api/plan', async (req, res) => {
  try {
    const date = req.query.date || getZonedDateStr(new Date(), 'Europe/Oslo');

    const maxDriveMinutes = req.query.maxDriveMinutes !== undefined ? parseInt(req.query.maxDriveMinutes, 10) : undefined;
    const driveLimitMode = req.query.driveLimitMode;
    const winterComfort = req.query.winterComfort;
    const includeBorderCrossing = parseBool(req.query.includeBorderCrossing, true);
    const includeFerry = parseBool(req.query.includeFerry, true);
    const timeZone = req.query.timeZone;
    const debug = parseBool(req.query.debug, false);

    const key = JSON.stringify({
      date,
      maxDriveMinutes: Number.isFinite(maxDriveMinutes) ? maxDriveMinutes : undefined,
      driveLimitMode,
      winterComfort,
      includeBorderCrossing,
      includeFerry,
      timeZone,
      debug,
    });

    // Return cached plan if same date and less than 30 min old
    if (cachedPlan && cachedPlanKey === key &&
        Date.now() - new Date(cachedPlan.generatedAt).getTime() < 30 * 60 * 1000) {
      return res.json({ ok: true, plan: cachedPlan, cached: true });
    }

    if (generating) {
      return res.status(429).json({ ok: false, error: 'Plan generation already in progress. Please wait.' });
    }

    generating = true;
    const plan = await generatePlan(date, {
      maxDriveMinutes,
      driveLimitMode,
      winterComfort,
      includeBorderCrossing,
      includeFerry,
      timeZone,
      debug,
    });
    cachedPlan = plan;
    cachedPlanKey = key;
    generating = false;

    res.json({ ok: true, plan, cached: false });
  } catch (err) {
    generating = false;
    console.error('Plan generation error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/condense - Get condensed plan
app.get('/api/condense', (req, res) => {
  if (!cachedPlan) {
    return res.status(404).json({ ok: false, error: 'No plan generated yet. Run the plan first.' });
  }
  res.json({ ok: true, condensed: condensePlan(cachedPlan) });
});

// POST /api/update - "UPDATE NOW" with current conditions
app.post('/api/update', (req, res) => {
  const { location, sky, snow } = req.body;
  if (!location || !sky) {
    return res.status(400).json({ ok: false, error: 'Provide location and sky condition.' });
  }
  const response = generateUpdateResponse(location, sky, snow || 'none', cachedPlan);
  res.json({ ok: true, update: response });
});

// GET /api/camera-help/:issue - Camera diagnostic
app.get('/api/camera-help/:issue', (req, res) => {
  const diagnosis = diagnoseCamera(req.params.issue);
  res.json({ ok: true, diagnosis });
});

// GET /api/parking - Safe parking rules
app.get('/api/parking', (req, res) => {
  res.json({
    ok: true,
    rules: {
      do: [
        'Park fully off the road surface on solid ground',
        'Use designated pull-offs, wide shoulders, or parking areas',
        'Keep parking lights on when stopped near roads',
        'Leave engine running periodically for heat',
        'Wear reflective vest when outside the car',
      ],
      dont: [
        'Never park ON the road surface',
        'Never block driveways, farm gates, or snow plow access',
        'Never park in "No Parking" zones even briefly',
        'Never leave headlights on (ruins night vision for everyone)',
        'Never walk on the road without reflective gear',
        'Never park on a blind curve or crest',
      ],
    },
  });
});

app.listen(PORT, () => {
  console.log(`\n  Aurora Chase Copilot running at http://localhost:${PORT}\n`);
});
