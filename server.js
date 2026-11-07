/* EventRadar backend — Express server (community board).
 * Modes:
 *   - AI flyer vision: GEMINI_API_KEY set. POST /api/flyer extracts
 *     {title,date,time,venue,category,confidence} via Gemini vision.
 *   - No key: /api/flyer returns honest 503. Events board works keyless.
 * Store: dual-mode — Supabase PostgREST table radar_events (via ./supabase.js)
 * when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (seeds auto-inserted
 * once if the table is empty — idempotent); else JSON file data/events.json
 * (gitignored), seeded once with 3 clearly-labeled sample events
 * ("seed":true) so the deck isn't empty.
 */
'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const net = require('net');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { sbConfigured, sbInsert, sbList, sbGet, sbUpdate } = require('./supabase');

const APP_DIR = __dirname;
const DATA_DIR = path.join(APP_DIR, 'data');
const STORE_FILE = path.join(DATA_DIR, 'events.json');
const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
const AI_MODE = Boolean(GEMINI_KEY);
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

// Supabase PostgREST is the source of truth when configured; JSON file (dev) otherwise.
const USE_SB = sbConfigured();

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3015')
  .split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- Security middleware -------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl / non-browser
    if (CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS origin not allowed'));
  },
}));
app.use(express.json({ limit: '32kb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: 'draft-7' }));
// No-auth demo votes get their own tighter bucket (per IP).
const voteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: 'draft-7' });

// Sensitive-file guard: never expose secrets, lockfiles, DBs, or server internals.
// NOTE: anchors use (^|\/) so nested paths (e.g. /api/../server.js cannot leak;
// a bare ^server\.js$ would miss sub-path matches — that was a real leaked-source
// bug in a sibling project, do not "simplify" these back to bare anchors.
const SENSITIVE = /(\.env(\.|$)|package(-lock)?\.json|\.db$|\.sqlite3?$|(^|\/)server\.js$|(^|\/)data(\/|$)|\.map$)/i;
app.use((req, res, next) => {
  if (SENSITIVE.test(req.path)) return res.status(404).json({ error: 'Not found' });
  next();
});
app.use(express.static(APP_DIR, { dotfiles: 'deny', index: 'index.html' }));

// --- JSON file store ------------------------------------------------------
function seedEvents() {
  const now = new Date().toISOString();
  return [
    {
      id: 'seed-001',
      title: 'Sample: Riverside Tech Meetup',
      date: '2026-11-12',
      time: '6:00 PM - 9:00 PM',
      venue: 'Innovation Hub Center',
      area: 'Downtown',
      category: 'tech',
      description: 'Sample event shipped with the demo seed — not a real listing. Monthly show-and-tell for local builders.',
      imageUrl: '',
      likes: 0,
      passes: 0,
      seed: true,
      createdAt: now,
    },
    {
      id: 'seed-002',
      title: 'Sample: Neon Beat DJ Night',
      date: '2026-10-24',
      time: '8:00 PM - Midnight',
      venue: 'The Warehouse Arena',
      area: 'Warehouse District',
      category: 'music',
      description: 'Sample event shipped with the demo seed — not a real listing. Local DJs, all-ages until 10 PM.',
      imageUrl: '',
      likes: 0,
      passes: 0,
      seed: true,
      createdAt: now,
    },
    {
      id: 'seed-003',
      title: 'Sample: Brutalist Art Walk',
      date: '2026-10-25',
      time: '2:00 PM - 6:00 PM',
      venue: 'Brutalist Gallery Room',
      area: 'Old Town',
      category: 'art',
      description: 'Sample event shipped with the demo seed — not a real listing. Guided walk + pop-up exhibition.',
      imageUrl: '',
      likes: 0,
      passes: 0,
      seed: true,
      createdAt: now,
    },
  ];
}

function loadStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STORE_FILE)) {
      const seeds = seedEvents();
      fs.writeFileSync(STORE_FILE, JSON.stringify(seeds, null, 2), 'utf8');
      return seeds;
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('store is not an array');
    if (parsed.length === 0) {
      const seeds = seedEvents();
      fs.writeFileSync(STORE_FILE, JSON.stringify(seeds, null, 2), 'utf8');
      return seeds;
    }
    return parsed;
  } catch (e) {
    console.error('[eventradar] store load failed, starting in-memory:', e.message);
    return seedEvents();
  }
}

let events = USE_SB ? [] : loadStore(); // unused in Supabase mode

function saveStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(events, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
  } catch (e) {
    console.error('[eventradar] store save failed:', e.message);
  }
}

// --- Supabase (radar_events) row mapping -----------------------------------
// Table columns are snake_case (image_url, created_at); the API speaks
// camelCase (imageUrl, createdAt) — map both ways so endpoint shapes and
// the frontend never change.
function toRow(ev) {
  return {
    id: ev.id,
    title: ev.title,
    date: ev.date,
    time: ev.time,
    venue: ev.venue,
    area: ev.area,
    category: ev.category,
    description: ev.description || '',
    image_url: ev.imageUrl || '',
    likes: Number(ev.likes) || 0,
    passes: Number(ev.passes) || 0,
    seed: Boolean(ev.seed),
    created_at: ev.createdAt || new Date().toISOString(),
  };
}

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    time: row.time,
    venue: row.venue,
    area: row.area,
    category: row.category,
    description: row.description || '',
    imageUrl: row.image_url || '',
    likes: Number(row.likes) || 0,
    passes: Number(row.passes) || 0,
    seed: Boolean(row.seed),
    createdAt: row.created_at,
  };
}

// Idempotent seeding: insert the 3 sample events only when the table is empty.
let seedChecked = false;
async function ensureSeededSb() {
  if (seedChecked) return;
  try {
    const rows = await sbList('radar_events', { limit: 1 });
    if (rows.length === 0) {
      const now = new Date().toISOString();
      for (const ev of seedEvents()) {
        // eslint-disable-next-line no-await-in-loop
        await sbInsert('radar_events', toRow({ ...ev, createdAt: now })); // seed:true already set
      }
      console.log('[eventradar] supabase: seeded 3 sample events (seed:true)');
    }
    seedChecked = true;
  } catch (e) {
    console.error('[eventradar] supabase seed check failed (will retry):', (e && e.message) || e);
  }
}

function makeId() {
  return 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

// --- Validation ------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v) { return typeof v === 'string' ? v : ''; }

function validateEvent(body) {
  const errors = [];
  const title = str(body.title).trim();
  const date = str(body.date).trim();
  const time = str(body.time).trim();
  const venue = str(body.venue).trim();
  const area = str(body.area).trim();
  const category = str(body.category).trim().toLowerCase();
  const description = body.description === undefined ? '' : str(body.description).trim();
  const imageUrl = body.imageUrl === undefined ? '' : str(body.imageUrl).trim();

  if (title.length < 3 || title.length > 120) errors.push('title must be 3-120 characters');
  if (!DATE_RE.test(date)) {
    errors.push('date must be YYYY-MM-DD');
  } else {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      errors.push('date is not a real calendar date');
    } else {
      const today = new Date();
      const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
      const pastLimit = todayUTC - 365 * 24 * 3600 * 1000; // absurdly-past cutoff: 1 year
      const futureLimit = todayUTC + 3 * 365 * 24 * 3600 * 1000;
      const t = dt.getTime();
      if (t < pastLimit) errors.push('date is absurdly far in the past (over 1 year ago)');
      if (t > futureLimit) errors.push('date is too far in the future (over 3 years out)');
    }
  }
  if (time.length < 1 || time.length > 80) errors.push('time must be 1-80 characters');
  if (venue.length < 1 || venue.length > 120) errors.push('venue must be 1-120 characters');
  if (area.length < 1 || area.length > 60) errors.push('area must be 1-60 characters');
  if (category.length < 1 || category.length > 40) errors.push('category must be 1-40 characters');
  else if (!/^[a-z0-9][a-z0-9 &\-]*$/i.test(category)) errors.push('category contains invalid characters');
  if (description.length > 2000) errors.push('description must be ≤2000 characters');
  if (imageUrl.length > 2000) errors.push('imageUrl must be ≤2000 characters');
  else if (imageUrl && !/^(https?:\/\/|data:image\/)/i.test(imageUrl) && !/^linear-gradient\(/i.test(imageUrl)) {
    errors.push('imageUrl must be an http(s) URL, data:image URI, or CSS linear-gradient');
  }

  if (errors.length) return { errors };
  return {
    value: { title, date, time, venue, area, category, description, imageUrl },
  };
}

// --- Gemini vision ----------------------------------------------------------
const FLYER_PROMPT = 'Analyze this event flyer image and extract event details. '
  + 'Return ONLY a JSON object (no markdown, no prose) with keys: '
  + '{"title": "event title", "date": "date as written, or YYYY-MM-DD if clear", '
  + '"time": "start/end times as written", "venue": "venue name", '
  + '"category": "one of: music, tech, art, food, sports, nightlife, community, other", '
  + '"confidence": "High or Medium or Low"}. '
  + 'If a field is unreadable, use an empty string for it (confidence Low).';

function extractJsonObject(raw) {
  const s = String(raw || '').replace(/```json|```/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

function sanitizeFlyer(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const clean = {
    title: str(obj.title).trim().slice(0, 120),
    date: str(obj.date).trim().slice(0, 40),
    time: str(obj.time).trim().slice(0, 80),
    venue: str(obj.venue).trim().slice(0, 120),
    category: str(obj.category).trim().toLowerCase().slice(0, 40) || 'other',
    confidence: str(obj.confidence).trim().slice(0, 10) || 'Low',
  };
  if (!['High', 'Medium', 'Low'].includes(clean.confidence)) clean.confidence = 'Low';
  if (!clean.title && !clean.venue && !clean.date) return null;
  return clean;
}

async function callGeminiVision(buffer, mimeType) {
  const base64 = buffer.toString('base64');
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: FLYER_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 800 },
        }),
      }
    );
    if (r.ok) {
      const j = await r.json();
      const text = j && j.candidates && j.candidates[0] && j.candidates[0].content
        && j.candidates[0].content.parts && j.candidates[0].content.parts.map((p) => p.text || '').join('');
      const parsed = sanitizeFlyer(extractJsonObject(text));
      if (!parsed) throw new Error('Gemini returned unparseable JSON');
      return { extracted: parsed, model };
    }
    lastErr = new Error(`Gemini ${model} HTTP ${r.status}`);
    if (r.status === 400) break; // bad request/key — another model won't help
  }
  throw lastErr || new Error('Gemini vision failed');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Only jpeg, png, or webp images are accepted'));
  },
});

// --- API -------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  if (USE_SB) {
    try {
      await ensureSeededSb();
      const rows = await sbList('radar_events', { limit: 1000 });
      return res.json({ ok: true, ai: AI_MODE, mode: AI_MODE ? 'ai' : 'no-key', store: 'supabase', eventCount: rows.length, simulated: false });
    } catch (e) {
      return res.status(500).json({ error: `Store read failed: ${(e && e.message) || e}` });
    }
  }
  return res.json({ ok: true, ai: AI_MODE, mode: AI_MODE ? 'ai' : 'no-key', store: 'json-file', eventCount: events.length, simulated: false });
});

app.get('/api/events', async (req, res) => {
  const area = str(req.query.area).trim().toLowerCase();
  const category = str(req.query.category).trim().toLowerCase();
  if (USE_SB) {
    try {
      await ensureSeededSb();
      const filter = {};
      if (area) filter.area = `ilike.${area}`; // case-insensitive exact match, as before
      if (category) filter.category = `ilike.${category}`;
      const rows = await sbList('radar_events', { filter, order: 'created_at.desc', limit: 1000 });
      const out = rows.map(fromRow);
      return res.json({ events: out, count: out.length, simulated: false });
    } catch (e) {
      return res.status(500).json({ error: `Store read failed: ${(e && e.message) || e}` });
    }
  }
  let out = [...events];
  if (area) out = out.filter((e) => str(e.area).toLowerCase() === area);
  if (category) out = out.filter((e) => str(e.category).toLowerCase() === category);
  out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return res.json({ events: out, count: out.length, simulated: false });
});

app.post('/api/events', async (req, res) => {
  const { errors, value } = validateEvent(req.body || {});
  if (errors) return res.status(400).json({ error: errors.join('; ') });
  const ev = {
    id: makeId(),
    ...value,
    likes: 0,
    passes: 0,
    seed: false,
    createdAt: new Date().toISOString(),
  };
  if (USE_SB) {
    try {
      const row = await sbInsert('radar_events', toRow(ev));
      return res.status(201).json({ event: row ? fromRow(row) : ev });
    } catch (e) {
      return res.status(500).json({ error: `Store write failed: ${(e && e.message) || e}` });
    }
  }
  events.push(ev);
  saveStore();
  return res.status(201).json({ event: ev });
});

app.post('/api/events/:id/like', voteLimiter, async (req, res) => {
  if (USE_SB) {
    try {
      const row = await sbGet('radar_events', req.params.id);
      if (!row) return res.status(404).json({ error: 'Event not found' });
      const likes = (Number(row.likes) || 0) + 1; // read row, update likes+1 (no atomic increment; fine at demo scale)
      const updated = await sbUpdate('radar_events', req.params.id, { likes });
      const ev = updated ? fromRow(updated) : { ...fromRow(row), likes };
      return res.json({ id: ev.id, likes: ev.likes, passes: ev.passes || 0 });
    } catch (e) {
      return res.status(500).json({ error: `Store write failed: ${(e && e.message) || e}` });
    }
  }
  const ev = events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  ev.likes = (Number(ev.likes) || 0) + 1;
  saveStore();
  return res.json({ id: ev.id, likes: ev.likes, passes: ev.passes || 0 });
});

app.post('/api/events/:id/pass', voteLimiter, async (req, res) => {
  if (USE_SB) {
    try {
      const row = await sbGet('radar_events', req.params.id);
      if (!row) return res.status(404).json({ error: 'Event not found' });
      const passes = (Number(row.passes) || 0) + 1; // read row, update passes+1
      const updated = await sbUpdate('radar_events', req.params.id, { passes });
      const ev = updated ? fromRow(updated) : { ...fromRow(row), passes };
      return res.json({ id: ev.id, likes: ev.likes || 0, passes: ev.passes });
    } catch (e) {
      return res.status(500).json({ error: `Store write failed: ${(e && e.message) || e}` });
    }
  }
  const ev = events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  ev.passes = (Number(ev.passes) || 0) + 1;
  saveStore();
  return res.json({ id: ev.id, likes: ev.likes || 0, passes: ev.passes });
});

app.post('/api/flyer', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = /file too large|limit/i.test(err.message || String(err.code || ''))
        ? 'Image exceeds 5MB limit'
        : (err.message || 'Invalid upload');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing image file field "image" (jpeg/png/webp, ≤5MB).' });
  if (!AI_MODE) {
    return res.status(503).json({
      error: 'Flyer vision unavailable — no GEMINI_API_KEY configured. The scan visualizer runs as a labeled demo; submit events manually via POST /api/events.',
      ai: false,
    });
  }
  try {
    const { extracted, model } = await callGeminiVision(req.file.buffer, req.file.mimetype);
    res.json({ ok: true, ai: true, provider: 'gemini', model, extracted, simulated: false });
  } catch (e) {
    res.status(502).json({ error: `Flyer vision failed (${(e && e.message) || e}). Try again or submit the event manually.`, ai: false });
  }
});

// --- Boot: PORT or first free 30xx ------------------------------------------
function listenOn(port) {
  if (port > 3099) { console.error('No free port in 3015-3099.'); process.exit(1); }
  const server = net.createServer();
  server.once('error', () => listenOn(port + 1));
  server.once('listening', () => {
    server.close(() => {
      app.listen(port, () => {
        console.log(`[eventradar] listening on http://localhost:${port}`);
        console.log(`[eventradar] mode: ${AI_MODE ? 'AI (gemini vision on)' : 'NO-KEY (board works; /api/flyer returns honest 503 — set GEMINI_API_KEY for vision)'}`);
        console.log(`[eventradar] CORS origins: ${CORS_ORIGINS.join(', ')}`);
        if (USE_SB) console.log('[eventradar] store: supabase (radar_events — source of truth)');
        else console.log(`[eventradar] store: json-file (dev): ${STORE_FILE} (${events.length} events)`);
      });
    });
  });
  server.listen(port);
}
module.exports = app;

// Guarded so `require('./server')` (e.g. serverless) does not start a listener.
// Direct `node server.js` behavior is unchanged.
if (require.main === module) {
  listenOn(Number(process.env.PORT) || 3015);
}
