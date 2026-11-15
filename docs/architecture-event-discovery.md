# EventRadar v3 — Architecture for Location-Aware Event Discovery

**Status:** design only, nothing implemented.
**Date:** 2026-11-16
**Scope:** turn the demo deck into a real discovery product: geolocation, adjustable search
radius, live event supply, and Spotify-style "artist on tour near you" alerts — at $0.

---

## 1. What we are actually claiming

> "Every gig, show and conference near you — plus every date your favourite artists announce."

Not "all events in the world". That phrase is a liability: free/community listings live behind
Facebook, Meetup and Instagram walls, and the ticketed feeds explicitly forbid bulk redistribution.
A claim we cannot verify is worse than a smaller claim we can.

The product wedge stays the same: **swipe-first discovery**, with the map and radius as context
rather than the main surface. There are a hundred event listing sites; there is no swipe deck with
a radius ring.

---

## 2. Current state (as built, verified)

| Piece | Reality today |
|---|---|
| Frontend | `index.html` + `app.js` + `styles.css`, 3 tabs (swipe / scan / submit), keyless Google embed map card |
| Backend | `server.js`, Express, helmet CSP with `frame-src` for Google, rate limit 120/15min |
| Store | dual mode: Supabase `radar_events` when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set, else `data/events.json` |
| Schema | `id, title, date (text YYYY-MM-DD), time (text), venue (text), area (text), category, description, image_url, likes, passes, seed, created_at` |
| Geo data | **none** — only free-text `venue` + `area` |
| Discovery | manual submission + 3 labeled seed events |
| Auth | none (rate-limited demo votes) |

The gap to the target is therefore not UI. It is **coordinates** and **supply**.

---

## 3. Target architecture

```
  browser  ── Leaflet map, radius ring, "use my location"
     │  GET /api/events?lat=..&lng=..&radius=..&category=..
     ▼
  Express (Vercel serverless)
     ├─ geo.js        cell plan (geohash p4), haversine, auto-radius ladder
     ├─ cache.js      geo_cells freshness + single-flight fetch lock
     ├─ providers/
     │    ├─ ticketmaster.js   discovery (radius search, attractions)
     │    └─ bandsintown.js    artist follow (fallback: TM attractions)
     ├─ dedupe.js     trigram + time + venue-proximity merge
     └─ robots/ ToS guard: never expose a bulk dump endpoint
     ▼
  Supabase Postgres + PostGIS
     radar_events · geo_cells · cell_locks · follows · notifications
     ▲
  GitHub Actions (free)
     cron 6h: refresh "hot" cells   |   cron daily: artist sweep → Resend email
```

Key decision: **the browser never talks to Supabase and never holds a key.** All DB access is
server-side with the service role. This is also the answer to the open RLS question — see §12.

---

## 4. Data model

### 4.1 Extend `radar_events`, do not fork it

A new `events` table would mean two read paths and a dual-write, and the deck would have to union
two shapes. Instead: add nullable geo + provenance columns to the table that already works.

```sql
-- Migration A (non-breaking; safe to ship before any provider exists)
alter table radar_events
  add column if not exists lat          double precision,
  add column if not exists lng          double precision,
  add column if not exists city         text,
  add column if not exists country      char(2),
  add column if not exists geohash      text,          -- precision 7, ~150 m
  add column if not exists geo_cell     text,          -- precision 4 cell that discovered it
  add column if not exists starts_at    timestamptz,   -- real instant when known
  add column if not exists timezone     text,
  add column if not exists source       text not null default 'user',
  add column if not exists source_id    text,
  add column if not exists source_url   text,
  add column if not exists image_url_src text,
  add column if not exists status       text not null default 'onsale',
  add column if not exists confidence   real not null default 1.0,
  add column if not exists merge_key    text,
  add column if not exists merged_into  uuid,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at  timestamptz not null default now();

create unique index if not exists radar_events_source_uniq
  on radar_events (source, source_id) where source_id is not null;
create index if not exists radar_events_cell_idx  on radar_events (geo_cell);
create index if not exists radar_events_start_idx on radar_events (starts_at) where starts_at is not null;
```

`date` / `time` stay as the human-readable pair the deck already renders; `starts_at` is what we
sort, filter and dedupe on. No frontend change is required for this migration.

### 4.2 Spatial index (optional but recommended)

```sql
create extension if not exists postgis;
alter table radar_events
  add column if not exists location geography(Point,4326)
    generated always as (
      case when lat is not null and lng is not null
           then st_setsrid(st_makepoint(lng, lat), 4326)::geography
      end
    ) stored;
create index if not exists radar_events_loc_idx on radar_events using gist (location);
```

*If Postgres rejects the generated geography column* (the geometry→geography cast is immutable in
current versions, but this is the one line most likely to fight you), drop it and filter with a
bounding box plus haversine in SQL. At our row counts that is fast enough and costs nothing.

### 4.3 Cells, locks, follows, alerts

```sql
-- Metadata only. The payload never lands here — see §5.2 for why.
create table if not exists geo_cells (
  provider        text not null,
  geohash         text not null,
  center_lat      double precision not null,
  center_lng      double precision not null,
  query_radius_km int  not null,
  fetched_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  event_count     int  not null default 0,
  truncated       boolean not null default false,  -- provider hit its page cap
  hits            int  not null default 0,         -- read count, drives "hot cell" refresh
  primary key (provider, geohash)
);

create table if not exists cell_locks (
  provider   text not null,
  geohash    text not null,
  lease_until timestamptz not null,
  primary key (provider, geohash)
);

create table if not exists follows (
  device_id   text not null,             -- random 128-bit id, no PII
  artist_key  text not null,             -- provider artist id, namespaced "tm:12345"
  artist_name text not null,
  lat         double precision,          -- rounded to ~110 m (§12)
  lng         double precision,
  radius_km   int not null default 25,
  email       text,
  created_at  timestamptz not null default now(),
  primary key (device_id, artist_key)
);

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  device_id   text not null,
  event_id    uuid not null,
  channel     text not null default 'email',
  status      text not null default 'queued',  -- queued | sent | failed | skipped
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (device_id, event_id, channel)
);
```

---

## 5. The geo-cell cache (the core of the design)

### 5.1 Why not mirror the world

Free Postgres is 500 MB. A normalized event row is ~0.6–1 KB, so the ceiling is roughly
**500k events** — plausible for one country, hopeless for the planet. Mirroring also burns provider
quota on places nobody is looking at.

So coverage grows **where users are**, which is also how this would have to scale if it ever got
real traffic.

### 5.2 Cell geometry

Geohash cells at precision 4 are ≈ 39 km × 19.5 km (varies with latitude). Half-diagonal ≈ **22 km**,
so one radius query of 22 km centred on the cell centre fully covers the cell.

| Precision | Cell size | Role |
|---|---|---|
| p3 | ~156 km | grouping only |
| **p4** | **~39 × 20 km** | **fetch unit** |
| p5 | ~4.9 × 4.9 km | display / analytics |
| p6 | ~1.2 km | privacy rounding for follows |
| p7 | ~150 m | venue precision |

A 25 km user radius touches **≈ 6 p4 cells**. That is 6 provider calls on a cold area, 0 on warm.

**Do not store the raw provider payload per cell.** A 200 KB response × 6 cells × ~800 cold queries/day
would blow through 500 MB in a day. Store only normalized rows plus the manifest (`fetched_at`,
`event_count`). Rows are the cache; the payload is transient.

### 5.3 Read path

```
1. resolve cells = p4 cells intersecting (lat, lng, radius)
2. cells = select * from geo_cells where geohash = any(...) and provider = 'tm'
3. fresh  = expires_at > now()
4. if a fresh cell exists        -> read its rows
   if a cell is stale/missing    -> try to acquire lock, fetch, upsert rows
   if lock is held by someone else -> serve stale rows, set degraded:true
5. filter rows by real distance (st_dwithin) and order by starts_at
6. if count < MIN_RESULTS and radius < 100 -> expand one ladder step, repeat (max 2 expansions)
```

TTL: **12 h** for cells with `hits > 0`, **7 days** for cells nobody has read. Past events are not
re-fetched at all — `where starts_at > now() - interval '2 hours'` bounds every refresh.

### 5.4 Stampede protection

Serverless lambdas are concurrent, so a cold popular area can fire the same 6 calls twenty times.
Two layers:

- **In-process**: a `Map<cell, Promise>` single-flight, which handles the common burst.
- **Cross-instance**: `insert into cell_locks ... on conflict do nothing` with a 30 s lease. Winner
  fetches; losers serve stale (or an empty-but-`degraded:true` response). A lease older than 30 s is
  reclaimable via `update ... where lease_until < now() returning *`.

---

## 6. Providers

### 6.1 Adapter contract

Every provider implements the same shape, so `server.js` never learns a vendor's field names:

```js
// providers/<name>.js
module.exports = {
  key: 'tm',
  configured: () => Boolean(process.env.TICKETMASTER_KEY),
  searchArea: async ({ lat, lng, radiusKm, category, from, to }) => ({
    events: [ /* canonical events */ ],
    truncated: false,
    calls: 1,
  }),
  searchArtists: async (query) => [ /* { key, name, image } */ ],
  artistEvents: async (artistKey) => [ /* canonical events */ ],
};
```

Canonical event:

```js
{
  source, sourceId, title, description, category,
  startsAt, localDate, localTimeText, timezone,
  venueName, city, area, country, lat, lng,
  imageUrl, ticketUrl, priceMin, priceMax, currency, status, confidence
}
```

### 6.2 Sources and their real roles

| Source | Role | Auth | Notes |
|---|---|---|---|
| **Ticketmaster Discovery** | discovery + radius + artists | free API key | the only source that does radius search properly; also exposes `attractions` so the artist feature needs no second signup |
| **Bandsintown** | artist follow enrichment | free `app_id` | **not** a discovery source — no radius search. Treat as optional |
| **SeatGeek** | optional 3rd source | free client id | US-heavy; useful only to prove the adapter pattern |
| **Nominatim (OSM)** | city / venue → coords, reverse geocode | none (UA required) | 1 req/s absolute max, must cache, no autocomplete |
| **User submissions** | long tail + free events | none | already built; keeps the product alive with zero keys |
| **Seed events** | demo only | none | must stay clearly labeled `seed:true` |

Quotas move; confirm at signup rather than trusting this table. The design assumes a **low
thousands/day** budget and treats any 429 as "serve cache".

### 6.3 Mapping notes (the parts that bite)

- `dates.start.localDate` is the *local* date. Store it in `date` for display **and** the UTC instant
  in `starts_at` for sorting. Never derive one from the other without the timezone.
- Venue coordinates are the only trustworthy geodata; venue *names* are duplicated across cities
  ("The Warehouse"). Always key on coords + city, never name alone.
- Many events have no price. `price_min` stays null; the UI must say "see tickets", not "$0".
- Images are usually rights-restricted. Store the URL, render it, but never re-host or bundle it.

---

## 7. Dedupe

The same gig will arrive from Ticketmaster and a user submission with different punctuation, a
different time and a truncated title.

**Stage 1 — exact key.** Generated from *local* date (never a `timestamptz` cast in a generated
column; that is stable, not immutable, and Postgres will reject it):

```sql
alter table radar_events
  add column if not exists merge_key text generated always as (
    lower(regexp_replace(coalesce(title, ''), '[^a-zA-Z0-9]+', '', 'g'))
    || '|' || coalesce(to_char(starts_at at time zone coalesce(timezone, 'UTC'), 'YYYY-MM-DD'), '')
    || '|' || lower(coalesce(venue, ''))
  ) stored;
```

*Same escape hatch as §4.2: if the generated expression is rejected, compute `merge_key` in
`toRow()` instead — it is a pure function of fields we already hold.*

**Stage 2 — fuzzy.** Only when stage 1 misses: same local date (±1 day for timezone drift),
title trigram `similarity() > 0.55` (pg_trgm), and venue distance < 300 m.

**Merge policy.** Source priority `ticketmaster > user > seed`. The canonical row keeps the
highest-priority `source_id`; losers get `merged_into = canonical_id` and are excluded from reads.
Never delete — the ticket URL and image often only exist on the loser.

---

## 8. Radius, the interesting part

A fixed slider is wrong: 10 km is empty in the suburbs and noise in central Mumbai.

```
resolve(lat, lng, requested):
  fetch cells for `requested`
  n = count within requested
  while n < 20 and radius < 100 and expansions < 2:
      radius = next ladder step (5 → 10 → 25 → 50 → 100)
      fetch ONLY the newly intersecting ring cells
      n = count within radius
  if count at 5 km > 200: radius = 5        # dense city, don't drown the user
  return { radiusUsed, expanded: radius > requested, count }
```

Every response carries `geo.radiusKmUsed` and `geo.expanded`, so the UI can say *"nothing within
10 km — widened to 25 km"* instead of silently showing distant events. That sentence is the whole
feature; without it, expanding feels like a bug.

Guard: at most **2 expansions per request** and a per-instance call budget, or a user in the
Atlantic will sweep cells across three continents.

---

## 9. Artist watchlist (the Spotify feature)

Spotify does not own concert data; it licenses it. The equivalent here is Ticketmaster
`attractions` (or Bandsintown if its app_id approval is still open).

```
search:  GET /api/artists/search?q=coldplay        -> [{ key:"tm:K8vZ...", name, image }]
follow:  POST /api/artists/follow { key, name, lat, lng, radiusKm }
sweep:   daily job -> for each distinct artist_key, fetch upcoming events
         -> upsert events -> haversine to each follower
         -> if distance <= follower.radius_km -> insert notification (unique-guarded)
alert:   batch per device -> one Resend email listing N dates + one-click unsubscribe
```

Notes that matter:

- **Anonymous by default.** `device_id` is a random id in an httpOnly, HMAC-signed cookie. Email is
  optional and only asked for at the moment of "notify me". No email, no account, no PII beyond an
  address the user typed.
- **Dedupe the alert, not the email.** `unique (device_id, event_id, channel)` means a re-run of the
  sweep never sends the same show twice.
- **Unsubscribe** is an HMAC token over `device_id` — no login, no table of tokens to leak.
- Batching is not cosmetic: Resend's free tier is ~100/day, and one email per event would burn it.

No second signup is strictly required — Ticketmaster `attractions` covers search, follow and sweep.
Bandsintown is an enhancement, not a dependency.

---

## 10. API surface

| Endpoint | Change |
|---|---|
| `GET /api/events` | **+ `lat`, `lng`, `radius` (km), `from`, `to`, `limit`**; keeps `area`/`category` |
| `GET /api/events/:id` | new — single event for deep links |
| `POST /api/events` | unchanged shape; server now geocodes `venue`+`area` |
| `GET /api/geo/reverse?lat&lng` | new — server-side Nominatim proxy + cache (keeps `connect-src 'self'`) |
| `GET /api/artists/search?q` | new |
| `POST /api/artists/follow` · `DELETE /api/artists/follow/:key` | new |
| `GET /api/me/follows` | new — by signed device cookie |
| `GET /api/health` | extended: `providers:{tm:'ok'\|'no-key'}`, `cells:{fresh,stale}`, `radii:{...}` |

Response envelope (backwards compatible — old fields untouched):

```json
{
  "events": [],
  "count": 42,
  "geo": { "lat": 19.076, "lng": 72.8777, "radiusKmUsed": 25, "requestedRadiusKm": 10,
           "expanded": true, "label": "Bandra West, Mumbai" },
  "sources": { "cache": 38, "live": 4, "stale": 0 },
  "degraded": false
}
```

**Never add a bulk dump endpoint.** Every source's terms forbid redistribution; a paginated
"give me everything" route is how a free key gets revoked.

---

## 11. Frontend

| Item | Decision | Why |
|---|---|---|
| Map | **Leaflet + OSM raster tiles, vendored locally** | Google's keyless embed cannot draw a radius ring, cannot cluster, and is an undocumented surface that can vanish. Leaflet is 150 KB, free, and honest |
| CSP | keep `connect-src 'self'` | geocoding is proxied server-side; Leaflet raster tiles are `<img>`, already allowed by `img-src https:` |
| Location | `navigator.geolocation` with an explicit "use my location" button | never auto-prompt on load; a denied prompt costs you the user forever |
| Denied / unsupported | city picker + manual radius, remembered in `localStorage` | the app must work with zero geo permission |
| Radius control | slider **and** a draggable ring, both bound to the same value | the ring teaches what the number means |
| Empty state | "Nothing within 10 km — widened to 25 km" + one-tap expand | silent expansion reads as a bug |
| Deck | unchanged, still primary | the swipe is the differentiator; the map is context |

Keep the existing Google embed as a per-event "view on Google Maps" link. It is a fine *fallback*;
it is not a map engine.

---

## 12. Privacy, security, RLS

- **Coordinates are personal data.** Store follows at 4 decimal places (~11 m) rounded to 3 (~110 m);
  the radius test does not need better.
- **No location in logs.** Log cell hashes, never lat/lng, never IPs beyond the rate limiter's memory.
- **RLS, answered:** because the browser never holds a Supabase key, enabling RLS on every
  `radar_*` / `geo_*` / `follows` / `notifications` table with **zero anon policies** changes nothing
  functionally — all reads and writes already go through the service role. That closes the open
  advisory for this app at no cost. Do it as part of Migration A.
- Provider keys stay in env, server-only. Never in `app.js`, never in a build artifact.
- Rate limits: keep 120/15min on `/api/*`; add a tighter bucket (e.g. 20/min) on
  `/api/geo/reverse` and `/api/artists/search` because both spend someone else's quota.

---

## 13. Cost model

| Layer | Free ceiling | What actually breaks first | Mitigation |
|---|---|---|---|
| Supabase DB | 500 MB | provider rows accumulating in unvisited cities | TTL sweep: delete provider rows never read in 30 days (`hits = 0`) |
| Supabase egress | 5 GB/mo | full-deck fetches on every swipe | cache-control + only refetch on radius/category change |
| Ticketmaster | low thousands/day | a viral link; bots | cell cache (≈10 calls/day per active metro), 429 → serve cache |
| Nominatim | 1 req/s | submit form geocoding | cache by normalized address; geocode only on submit |
| Vercel | Hobby | build minutes, not traffic | static assets already split; API is one function |
| GitHub Actions | 2k min/mo (private) / unlimited (public) | nothing | one 6-hourly job, one daily job |
| Resend | ~100/day | follow fan-out | batch per device, cap alerts per sweep |

Expected steady state for a demo: **≤ 50 provider calls/day**. That is two orders of magnitude under
any of these ceilings, which is what makes the cache worth the complexity.

---

## 14. Legal / attribution (read before charging anything)

- **Ticketmaster**: attribution required, no bulk redistribution, no building a competing database,
  images may not be re-hosted. Fine for a demo/portfolio; a paid product needs a partnership.
- **Bandsintown**: attribution + app_id terms; access tiers have changed before — do not make the
  product depend on it.
- **Nominatim**: 1 req/s, cache required, identifying `User-Agent`, no autocomplete-style traffic.
- **OSM tiles**: "© OpenStreetMap contributors" visible, no bulk download. If traffic ever justifies
  it, move to a paid tile host — until then this is the only honest free option.

Add a footer: `Event data © respective providers · Map © OpenStreetMap contributors`.

---

## 15. Degradation ladder

| Failure | Behaviour |
|---|---|
| Provider 429 / 5xx | serve cache, `degraded:true`, UI "showing cached results (updated 3 h ago)" |
| No provider key | user submissions + seed only, banner "live listings off" — never an empty deck |
| Supabase down | in-memory LRU of the last payloads (cold starts empty), banner; the file store still works locally |
| Geolocation denied | city picker + manual radius |
| Nominatim down | skip reverse geocode, caption "near you" |
| PostGIS unavailable | bbox + haversine in SQL |

Every one of these must be visible to the user. Silent degradation is indistinguishable from a bug.

---

## 16. Phases + acceptance criteria

**Phase 1 — Radius on real data** *(≈ half a session)*
`lat/lng/radius` on `/api/events`, migration A + RLS, geohash helpers, Ticketmaster adapter with a
demo fallback, Leaflet ring map, geolocation button, auto-radius ladder.
*Accepted when:* from a Mumbai coordinate with `radius=10`, the API returns at least one real
Ticketmaster event, the response carries `radiusKmUsed`, the ring matches it, and with no key the UI
shows the demo banner instead of breaking.

**Phase 2 — Artist watchlist** *(≈ one session)*
Artist search/follow, device cookie, daily sweep, deduped notifications, Resend email with
unsubscribe.
*Accepted when:* following an artist with a nearby date produces exactly one email, a second sweep
sends nothing new, and the unsubscribe link works without a login.

**Phase 3 — Cell cache + scheduler** *(multi-day)*
`geo_cells`, `cell_locks`, hot-cell refresh in Actions, dedupe stage 2, TTL sweeps, health metrics.
*Accepted when:* a cold query costs ≤ 6 provider calls, a repeat query within 12 h costs 0, and two
concurrent requests to a cold cell produce exactly 6 calls total.

---

## 17. Open decisions (yours, not mine)

1. **Wording** — I recommend "every gig and your artists", never "all events in the world".
2. **Accounts** — anonymous `device_id` first; real auth only when people ask to sync devices.
3. **Primary surface** — I recommend swipe stays primary; a map-first product competes with
   Eventbrite on their turf and loses.
4. **Prices** — show them or not? They are stale more often than titles, and a wrong price is worse
   than none.
5. **Third source** — skip SeatGeek until a user complains about US coverage.
6. **Timeline** — Phase 1 before the TailorFit campaign, or after?

---

## Appendix A — geohash cell plan

```
cellsFor(lat, lng, radiusKm):
  bbox = boundingBox(lat, lng, radiusKm)      # lat ± r/111.32, lng ± r/(111.32*cos(lat))
  return geohashes(bbox, precision = 4)       # 1–6 cells for r ≤ 50 km
```

Cell radius for the provider query: `ceil(halfDiagonalKm(cell)) + 2` — the +2 km margin absorbs
the difference between "cell covered" and "circle covered".

## Appendix B — haversine guard

Always re-filter server-side:

```sql
select * from radar_events
where geo_cell = any($1)
  and starts_at > now() - interval '2 hours'
  and (lat is null or st_dwithin(location, st_makepoint($2,$3)::geography, $4 * 1000))
order by starts_at asc
limit $5;
```

Cells are rectangles and the provider radius is approximate; without this line a user 40 km away
appears inside a 10 km ring.

## Appendix C — what this design deliberately does not do

- No scraping of Facebook/Meetup/Instagram (walled, and against their terms).
- No ticket inventory, checkout, or price guarantees.
- No "global index" — coverage follows demand, and that is by design.
- No real-time push; the daily sweep is enough for concert announcements.
