# Aurora Chase Copilot

A real-time aurora-chasing copilot. For a given city and night it pulls live
cloud cover, aurora activity, moon and twilight, then ranks nearby viewing zones
inside your driving limit and hands back a full field plan — primary + two
backups, a decision rule, a camera playbook, and cold-weather safety.

It's an installable, offline-capable PWA: the app shell and your last plan stay
reachable when you're out of cell range.

## Run

```bash
npm install
npm start          # http://localhost:3838
npm run dev        # same, with --watch reload
```

No build step — the frontend is vanilla JS/CSS served from `public/`.

## Configuration

All configuration is via environment variables (all optional):

| Variable            | Default                     | Purpose |
| ------------------- | --------------------------- | ------- |
| `PORT`              | `3838`                      | HTTP port |
| `OPENAI_API_KEY`    | _(unset)_                   | Enables AI zone generation for any city. Without it, the app falls back to the built-in Reykjavík zones. |
| `OPENAI_CHAT_MODEL` | `gpt-4o`                    | Model used to generate zones. |
| `OPENAI_API_BASE`   | `https://api.openai.com/v1` | Override for OpenAI-compatible endpoints. |
| `OPENAI_TIMEOUT_MS` | `30000`                     | Abort the zone-generation request after this many ms. |

## Data sources

- **Clouds / wind / precip / temp** — [met.no LocationForecast 2.0](https://api.met.no/) (conditional ETag requests, 30-min cache).
- **Aurora (Kp forecast + OVATION probability)** — [NOAA SWPC](https://services.swpc.noaa.gov/) (15-min cache).
- **Sun / twilight / dark window** — computed locally (NOAA solar equations), timezone-aware.

No API keys are needed for the core forecast; `OPENAI_API_KEY` only unlocks
arbitrary-city zone generation.

## HTTP API

| Route                    | Description |
| ------------------------ | ----------- |
| `GET /api/plan`          | Generate (and cache 30 min) tonight's plan. Query: `city`, `lat`, `lon`, `date`, `maxDriveMinutes`, `driveLimitMode`, `winterComfort`, `includeBorderCrossing`, `includeFerry`, `timeZone`. |
| `GET /api/locations`     | AI zone generation for a city (requires `OPENAI_API_KEY`). |
| `GET /api/condense`      | 12-line lock-screen version of the last plan. |
| `POST /api/update`       | "I'm here, sky is X" → immediate stay/move/switch advice. |
| `GET /api/camera-help/:issue` | Camera diagnosis (`blurry`, `dark`, `washed out`, `green blob`). |
| `GET /api/parking`       | Safe roadside parking do / don't rules. |
| `GET /api/health`        | Liveness probe. |

## Stack

Node ≥ 18, Express 5, ES modules. Frontend is dependency-free vanilla JS with a
service worker (`public/sw.js`) for offline support.
