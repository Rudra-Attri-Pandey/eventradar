# EventRadar — Community Event Board

Tinder-style local event discovery. Real Express backend + dual-mode store (Supabase when configured, JSON file otherwise); users submit real local events, swipe the shared deck, and optionally scan flyers with Gemini vision.

## Run

```bash
npm install
npm start        # http://localhost:3015 (or first free 30xx port)
```

Optional: copy `.env.example` to `.env` and set `GEMINI_API_KEY` for AI flyer vision. Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (both) to persist events to Supabase; unset = local file store (dev).

## API

- `GET /api/health` — `{ ok, ai, mode, eventCount }`
- `GET /api/events?area=&category=` — newest first, optional exact-match filters
- `POST /api/events` — `{title (3-120), date (YYYY-MM-DD, within 1y past / 3y future), time (1-80), venue (1-120), area (1-60), category (1-40), description? (≤2000), imageUrl? (≤2000)}` → `201 { event }`, bad input → `400`
- `POST /api/events/:id/like` / `POST /api/events/:id/pass` — persisted counters (no auth in demo, rate-limited)
- `POST /api/flyer` — multipart `image` (jpeg/png/webp, ≤5MB) → `{ extracted: {title,date,time,venue,category,confidence} }`. No key → honest `503`; the scan visualizer runs as a labeled demo.

Store: dual-mode. When `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set, data persists to Supabase (`radar_events` table via PostgREST; the 3 `seed:true` samples are auto-inserted once if the table is empty — idempotent). Unset, it falls back to `data/events.json` (gitignored), seeded once with 3 clearly-labeled `seed:true` sample events (shown with a "sample" tag) so the deck isn't empty. The active store is logged at boot and reported by `GET /api/health` (`store: supabase` / `json-file`).

## Honest capability list

- Real: community-submitted events, persistent likes/passes (Supabase when configured, file store otherwise), area/category filters, manual submit form, Gemini flyer vision when a key is set.
- NOT real: no automatic venue scraping, no ticket inventory, no recommendations engine, no auth (demo rate-limiting only). The scan laser/bounding-box animation is demo chrome; without a key, sample scan results are hardcoded and labeled as such.
