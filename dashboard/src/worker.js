import { renderSVG } from 'uqr';

// Gatekeeper for the dashboard: nothing (not even index.html) is served without the key.
// - The frame visits /?key=<DASH_KEY> once: a redirect sets a long-lived cookie and opens
//   the clean URL. Safari on the iPhone drops a cookie set that way, so the Phone tab does
//   not use it.
// - The Phone tab's code is a separate /?phone= link stored in D1. That address opens the
//   dashboard itself, and the files on that page carry the same link, so bookmarking it
//   signs the phone in again. Wrong or missing key → 404, so the site looks empty.
// Set the key with: npx wrangler secret put DASH_KEY

const COOKIE = 'dash_key';
const MAX_AGE = 400 * 24 * 60 * 60; // browsers cap cookie lifetime at 400 days

async function same(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ------------------------------------------------------------ live data

// Location comes from LATITUDE / LONGITUDE / TIMEZONE vars, set at deploy time from the
// private local.config.json by scripts/deploy.mjs (rounded to ~1 km).
function weatherUrl(env) {
  const q = new URLSearchParams({
    latitude: Number(env.LATITUDE).toFixed(2),
    longitude: Number(env.LONGITUDE).toFixed(2),
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
    current: 'apparent_temperature,relative_humidity_2m,wind_speed_10m',
    forecast_days: '2',
    timezone: env.TIMEZONE || 'auto',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + q;
}

// WMO weather code -> one of the dashboard's five weather icons (no snow/storm icons exist).
function icon(code, isDay) {
  if (code <= 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return isDay ? 'partly' : 'cloud'; // no night version of the partly icon
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  return 'cloud'; // 3 overcast, 45/48 fog, 71-77/85-86 snow
}

// Same shape as DATA.weather, but 48 hourly slots (today + tomorrow, index = hours since midnight today).
async function getWeather(env) {
  if (!env.LATITUDE || !env.LONGITUDE) return null; // no location configured: keep demo weather
  const res = await fetch(weatherUrl(env));
  if (!res.ok) throw new Error('open-meteo ' + res.status);
  const w = await res.json();
  const h = w.hourly;
  return {
    hi: Math.round(w.daily.temperature_2m_max[0]),
    lo: Math.round(w.daily.temperature_2m_min[0]),
    feels: Math.round(w.current.apparent_temperature),
    humidity: Math.round(w.current.relative_humidity_2m),
    wind: Math.round(w.current.wind_speed_10m),
    t: h.temperature_2m.map(Math.round),
    c: h.weather_code.map((code, i) => icon(code, h.is_day[i])),
    p: h.precipitation_probability.map((x) => x ?? 0),
  };
}

// CALENDARS secret: one "person = secret iCal URL" per line (copy of dashboard/.calendars).
// Google ("Secret address in iCal format") and Apple iCloud (Public Calendar link) both work,
// and a person may have several lines.
// The raw ICS text is passed through and parsed on the tablet: parsing costs ~80 ms CPU per
// calendar, well over the free plan's 10 ms per request.
async function getCalendars(env) {
  const lines = (env.CALENDARS || '').split('\n').filter((l) => l.includes('='));
  return Promise.all(
    lines.map(async (line) => {
      const who = line.slice(0, line.indexOf('=')).trim().toLowerCase();
      // Apple shares calendars as webcal://; it's plain https underneath.
      const url = line.slice(line.indexOf('=') + 1).trim().replace(/^webcals?:\/\//i, 'https://');
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return { who, ics: await res.text() };
      } catch (err) {
        console.error('calendar', who, err.message);
        return { who, ics: null };
      }
    }),
  );
}

// ------------------------------------------------------------ shopping list
// Stored in D1 (binding SHOPPING, added by scripts/deploy.mjs from local.config.json), one row
// per item, so two screens editing different items never overwrite each other.
//   GET  /api/shopping                                  -> { items: [...] }
//   POST /api/shopping  { upsert: [item], delete: [id] } -> { items: [...] }

let tableReady = false;
async function shoppingTable(db) {
  if (tableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS shopping (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, cat TEXT NOT NULL, qty INTEGER NOT NULL,
      store TEXT NOT NULL, done INTEGER NOT NULL, note TEXT NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL)`,
  ).run();
  tableReady = true;
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Returns a clean item, or null if it isn't one.
function shoppingItem(g) {
  if (!g || typeof g !== 'object' || !ID.test(g.id || '')) return null;
  const name = text(g.name, 100);
  if (!name) return null;
  const qty = Math.min(99, Math.max(1, Math.round(Number(g.qty)) || 1));
  return { id: g.id, name, cat: text(g.cat, 40) || 'Other', qty, store: text(g.store, 20) || 'grocer', done: !!g.done, note: text(g.note, 200) };
}

async function shoppingList(db) {
  const { results } = await db.prepare('SELECT id, name, cat, qty, store, done, note FROM shopping ORDER BY created, id').all();
  return results.map((r) => ({ ...r, done: !!r.done }));
}

async function shopping(request, env) {
  const db = env.SHOPPING;
  if (!db) return Response.json({ error: 'no SHOPPING database' }, { status: 503 });
  await shoppingTable(db);
  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'bad JSON' }, { status: 400 });
    }
    const upsert = Array.isArray(body.upsert) ? body.upsert.slice(0, 500).map(shoppingItem) : [];
    const del = Array.isArray(body.delete) ? body.delete.slice(0, 500) : [];
    if (upsert.some((g) => !g) || del.some((id) => typeof id !== 'string' || !ID.test(id))) {
      return Response.json({ error: 'bad item' }, { status: 400 });
    }
    const now = Date.now();
    const stmts = upsert.map((g) =>
      db.prepare(
        `INSERT INTO shopping (id, name, cat, qty, store, done, note, created, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT(id) DO UPDATE SET name = ?2, cat = ?3, qty = ?4, store = ?5, done = ?6, note = ?7, updated = ?8`,
      ).bind(g.id, g.name, g.cat, g.qty, g.store, g.done ? 1 : 0, g.note, now),
    );
    for (const id of del) stmts.push(db.prepare('DELETE FROM shopping WHERE id = ?1').bind(id));
    if (stmts.length) await db.batch(stmts);
  } else if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  return Response.json({ items: await shoppingList(db) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// ------------------------------------------------------------ chores
// Chore definitions plus one tick per chore, person and day, so every chore resets at midnight
// (the screen's own date) and a chore shared by several people is ticked by each of them.
// Stars are counted from the ticks.
//   GET  /api/chores?from=YYYY-MM-DD&to=YYYY-MM-DD   -> { chores, done (in range), stars }
//   POST /api/chores { upsert: [chore], delete: [id] } -> same as GET
//   POST /api/chores/done { id, who, day, done, by?, earner?, stars? } -> same as GET
// A chore: { id, title, icon, who, r, stars, days }. who: "maya" or "maya,otto" (or "any");
// days: 7 chars, Mon..Sun, "1" = that day.

let choreTables = false;
async function choresTables(db) {
  if (choreTables) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS chores (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, icon TEXT NOT NULL, who TEXT NOT NULL, r TEXT NOT NULL,
      stars INTEGER NOT NULL, days TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS chore_ticks (
      chore_id TEXT NOT NULL, who TEXT NOT NULL, day TEXT NOT NULL, by TEXT, earner TEXT, stars INTEGER NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (chore_id, who, day))`),
  ]);
  choreTables = true;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WHO = /^[a-z0-9_-]{1,20}$/;
function choreItem(c) {
  if (!c || typeof c !== 'object' || !ID.test(c.id || '')) return null;
  const title = text(c.title, 60);
  const who = [...new Set(String(c.who || '').split(','))];
  if (!who.length || who.length > 6 || !who.every((w) => WHO.test(w)) || (who.includes('any') && who.length > 1)) return null;
  if (!title || !/^[a-z0-9-]{1,40}$/.test(c.icon || '') || !['morning', 'after', 'evening'].includes(c.r)) return null;
  const days = /^[01]{7}$/.test(c.days || '') ? c.days : '1111111';
  return { id: c.id, title, icon: c.icon, who: who.join(','), r: c.r, stars: Math.min(5, Math.max(0, Math.round(Number(c.stars)) || 0)), days };
}

async function choresState(db, url) {
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  const [defs, done, stars] = await Promise.all([
    db.prepare('SELECT id, title, icon, who, r, stars, days, created FROM chores ORDER BY created, id').all(),
    DAY.test(from || '') && DAY.test(to || '')
      ? db.prepare('SELECT chore_id AS id, who, day, by, earner, stars FROM chore_ticks WHERE day >= ?1 AND day <= ?2').bind(from, to).all()
      : { results: [] },
    db.prepare('SELECT earner, SUM(stars) AS stars FROM chore_ticks WHERE earner IS NOT NULL GROUP BY earner').all(),
  ]);
  const totals = {};
  stars.results.forEach((r) => { totals[r.earner] = r.stars; });
  return { chores: defs.results, done: done.results, stars: totals };
}

async function chores(request, env, url) {
  const db = env.SHOPPING;
  if (!db) return Response.json({ error: 'no database' }, { status: 503 });
  await choresTables(db);
  if (request.method === 'POST') {
    let b;
    try {
      b = await request.json();
    } catch {
      return Response.json({ error: 'bad JSON' }, { status: 400 });
    }
    const now = Date.now();
    const stmts = [];
    if (url.pathname === '/api/chores/done') {
      if (!ID.test(b.id || '') || !WHO.test(b.who || '') || !DAY.test(b.day || '')) return Response.json({ error: 'bad done' }, { status: 400 });
      if (b.done) {
        const by = WHO.test(b.by || '') ? b.by : null, earner = WHO.test(b.earner || '') ? b.earner : null;
        stmts.push(db.prepare(
          `INSERT INTO chore_ticks (chore_id, who, day, by, earner, stars, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(chore_id, who, day) DO UPDATE SET by = ?4, earner = ?5, stars = ?6, at = ?7`,
        ).bind(b.id, b.who, b.day, by, earner, earner ? Math.min(5, Math.max(0, Math.round(Number(b.stars)) || 0)) : 0, now));
      } else {
        stmts.push(db.prepare('DELETE FROM chore_ticks WHERE chore_id = ?1 AND who = ?2 AND day = ?3').bind(b.id, b.who, b.day));
      }
    } else {
      const upsert = Array.isArray(b.upsert) ? b.upsert.slice(0, 200).map(choreItem) : [];
      const del = Array.isArray(b.delete) ? b.delete.slice(0, 200) : [];
      if (upsert.some((c) => !c) || del.some((id) => typeof id !== 'string' || !ID.test(id))) {
        return Response.json({ error: 'bad chore' }, { status: 400 });
      }
      for (const c of upsert) {
        stmts.push(db.prepare(
          `INSERT INTO chores (id, title, icon, who, r, stars, days, created, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
           ON CONFLICT(id) DO UPDATE SET title = ?2, icon = ?3, who = ?4, r = ?5, stars = ?6, days = ?7, updated = ?8`,
        ).bind(c.id, c.title, c.icon, c.who, c.r, c.stars, c.days, now));
      }
      for (const id of del) {
        // Its past done rows stay, so stars already earned aren't taken away.
        stmts.push(db.prepare('DELETE FROM chores WHERE id = ?1').bind(id));
      }
    }
    if (stmts.length) await db.batch(stmts);
  } else if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  return Response.json(await choresState(db, url), { headers: { 'Cache-Control': 'private, no-store' } });
}

// ------------------------------------------------------------ agents (AI plan usage)
// The PC pushes usage numbers (scripts/agents-push.mjs reads the Claude Code and Grok Build
// logins and their local logs, so no AI account token ever reaches Cloudflare). Kept in D1; the live service status
// comes from the providers' public status pages.
//   GET  /api/agents          -> { updated, agents: [...], status: { claude: {...} } }
//   POST /api/agents { ... }  -> stores the PC's numbers

let statusCache = { at: 0, value: {} };
async function serviceStatus() {
  if (Date.now() - statusCache.at < 5 * 60000) return statusCache.value;
  const pages = { claude: 'https://status.claude.com/api/v2/summary.json', grok: 'https://status.x.ai/api/v2/summary.json' };
  const value = {};
  await Promise.all(Object.entries(pages).map(async ([id, u]) => {
    try {
      const res = await fetch(u, { cf: { cacheTtl: 120 } });
      if (!res.ok) return;
      const d = await res.json();
      const incident = (d.incidents || []).find((i) => i.status !== 'resolved' && i.status !== 'postmortem');
      value[id] = { indicator: (d.status || {}).indicator || 'none', description: (d.status || {}).description || '', incident: incident ? incident.name : '' };
    } catch {
      // no status for this one
    }
  }));
  statusCache = { at: Date.now(), value };
  return value;
}

async function agents(request, env) {
  const db = env.SHOPPING;
  if (!db) return Response.json({ error: 'no database' }, { status: 503 });
  if (request.method === 'POST') {
    const body = await request.text();
    if (body.length > 20000) return Response.json({ error: 'too big' }, { status: 413 });
    let d;
    try {
      d = JSON.parse(body);
    } catch {
      return Response.json({ error: 'bad JSON' }, { status: 400 });
    }
    if (!d || !Array.isArray(d.agents)) return Response.json({ error: 'bad agents' }, { status: 400 });
    await kvPut(db, 'agents', JSON.stringify({ updated: new Date().toISOString(), agents: d.agents.slice(0, 8) }));
    return Response.json({ ok: true });
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const [stored, status] = await Promise.all([kvGet(db, 'agents'), serviceStatus()]);
  return Response.json({ ...(stored ? JSON.parse(stored) : { agents: [] }), status }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// ------------------------------------------------------------ Hive (heating, hot water, lights)
// Hive has no official API; this is the one the Hive app uses (as Home Assistant does). Secrets
// from scripts/hive-login.py: HIVE_CLIENT_ID, HIVE_REGION, HIVE_REFRESH_TOKEN, HIVE_DEVICE_KEY.
// The Worker swaps the refresh token for a short-lived IdToken with Cognito; no password here.
// Hive's firewall (AWS WAF) blocks requests without a User-Agent, so every call sends one.
//   GET  /api/hive                      -> { configured, heating, hotwater, lights }
//   POST /api/hive { action, id, ... }  -> the same, after the change (see hiveCommand)

const HIVE_API = 'https://beekeeper-uk.hivehome.com/1.0';
let hiveToken = null; // { value, expires }

async function hiveAccess(env, force) {
  if (!force && hiveToken && hiveToken.expires > Date.now() + 60000) return hiveToken.value;
  const slot = 'hive_refresh';
  const stored = env.SHOPPING ? await kvGet(env.SHOPPING, slot) : null;
  // A refresh token saved by an earlier run wins only while it came from the current login.
  const saved = stored ? JSON.parse(stored) : null;
  const refresh = saved && saved.from === env.HIVE_REFRESH_TOKEN.slice(-16) ? saved.token : env.HIVE_REFRESH_TOKEN;
  const params = { REFRESH_TOKEN: refresh };
  if (env.HIVE_DEVICE_KEY) params.DEVICE_KEY = env.HIVE_DEVICE_KEY;
  const res = await fetch('https://cognito-idp.' + env.HIVE_REGION + '.amazonaws.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth', 'User-Agent': 'home-dashboard/1.0 (Cloudflare Worker)' },
    body: JSON.stringify({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: env.HIVE_CLIENT_ID, AuthParameters: params }),
  });
  if (!res.ok) throw Object.assign(new Error('hive token ' + res.status + ' ' + (await res.text()).slice(0, 160)), { login: res.status === 400 });
  const r = (await res.json()).AuthenticationResult || {};
  if (r.RefreshToken && env.SHOPPING) await kvPut(env.SHOPPING, slot, JSON.stringify({ from: env.HIVE_REFRESH_TOKEN.slice(-16), token: r.RefreshToken }));
  hiveToken = { value: r.IdToken, expires: Date.now() + (r.ExpiresIn || 3600) * 1000 };
  return hiveToken.value;
}

async function hiveApi(env, method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(HIVE_API + path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: '*/*', 'User-Agent': 'home-dashboard/1.0 (Cloudflare Worker)', authorization: await hiveAccess(env, attempt > 0) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 401 && res.status !== 403) return res;
  }
  throw Object.assign(new Error('hive unauthorised'), { login: true });
}

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
async function hiveState(env) {
  const res = await hiveApi(env, 'GET', '/nodes/all?products=true&devices=true&actions=false');
  if (!res.ok) throw new Error('hive nodes ' + res.status);
  const all = await res.json();
  const products = all.products || [];
  const heat = products.find((p) => p.type === 'heating');
  const water = products.find((p) => p.type === 'hotwater');
  const h = heat && { id: heat.id, name: heat.state.name, current: num(heat.props.temperature), target: num(heat.state.target),
    mode: heat.state.mode, boost: num(heat.state.boost), working: !!heat.props.working, online: heat.props.online !== false,
    min: num(heat.props.minHeat) || 5, max: num(heat.props.maxHeat) || 32 };
  return {
    configured: true,
    heating: h || null,
    hotwater: water ? { id: water.id, mode: water.state.mode, boost: num(water.state.boost), working: !!water.props.working } : null,
    lights: products.filter((p) => /light$/.test(p.type)).map((p) => ({
      id: p.id, type: p.type, name: p.state.name, on: p.state.status === 'ON', brightness: num(p.state.brightness), online: p.props.online !== false,
    })),
  };
}

// Commands, as the Hive app sends them (values as strings). Only ids of this account's devices.
const HIVE_ID = /^[0-9a-f-]{36}$/;
function hiveCommand(b) {
  const id = String(b.id || '');
  if (!HIVE_ID.test(id)) return null;
  switch (b.action) {
    case 'target': {
      const t = Math.round(Number(b.target) * 2) / 2;
      return t >= 5 && t <= 32 ? ['heating', id, { target: t.toFixed(1) }] : null;
    }
    case 'heatMode': return ['SCHEDULE', 'MANUAL', 'OFF'].includes(b.mode) ? ['heating', id, { mode: b.mode }] : null;
    case 'heatBoost': {
      const m = Math.round(Number(b.minutes)), t = Math.round(Number(b.target) * 2) / 2;
      return m >= 15 && m <= 360 && t >= 5 && t <= 32 ? ['heating', id, { mode: 'BOOST', boost: String(m), target: t.toFixed(1) }] : null;
    }
    case 'waterMode': return ['SCHEDULE', 'ON', 'OFF'].includes(b.mode) ? ['hotwater', id, { mode: b.mode === 'ON' ? 'MANUAL' : b.mode }] : null;
    case 'waterBoost': {
      const m = Math.round(Number(b.minutes));
      return m >= 15 && m <= 360 ? ['hotwater', id, { mode: 'BOOST', boost: String(m) }] : null;
    }
    case 'light': {
      const type = ['warmwhitelight', 'tuneablelight', 'colourtuneablelight'].includes(b.type) ? b.type : null;
      if (!type) return null;
      const s = { status: b.on ? 'ON' : 'OFF' };
      if (b.on && b.brightness != null) {
        const br = Math.round(Number(b.brightness));
        if (!(br >= 5 && br <= 100)) return null;
        s.brightness = String(br);
      }
      return [type, id, s];
    }
    default: return null;
  }
}

async function hive(request, env) {
  const json = (v, status) => Response.json(v, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
  if (!env.HIVE_CLIENT_ID || !env.HIVE_REGION || !env.HIVE_REFRESH_TOKEN) return json({ configured: false });
  try {
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      let call = hiveCommand(b);
      // Cancelling a boost goes back to the mode and target from before it.
      if (b.action === 'cancelBoost' && HIVE_ID.test(String(b.id || ''))) {
        const r = await hiveApi(env, 'GET', '/products');
        const p = r.ok ? (await r.json()).find((x) => x.id === b.id) : null;
        const prev = (p && p.props && p.props.previous) || {};
        const s = { mode: prev.mode && prev.mode !== 'BOOST' ? prev.mode : 'SCHEDULE' };
        if (p && p.type === 'heating' && prev.target != null) s.target = String(prev.target);
        call = p ? [p.type, p.id, s] : null;
      }
      if (!call) return json({ error: 'bad command' }, 400);
      const res = await hiveApi(env, 'POST', '/nodes/' + call[0] + '/' + call[1], call[2]);
      if (!res.ok) throw new Error('hive ' + b.action + ' ' + res.status);
    } else if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return json(await hiveState(env));
  } catch (err) {
    console.error('hive', err.message);
    return json({ configured: true, error: err.login ? 'login' : 'Hive unavailable' }, 502);
  }
}

// ------------------------------------------------------------ Hue (lights)
// The frame loads this site over HTTPS, so it cannot call a bridge on the LAN. This uses Hue's
// The frame and this Worker cannot reach a bridge on the home LAN. scripts/hue-bridge.mjs runs on
// the PC, holds the bridge username, and posts light state to /api/hue/bridge. The dashboard keeps
// posting to /api/hue; those commands are queued in D1 and the script applies them on the bridge.
// Stored bridge state wins over the remote API below, which needs secrets from scripts/hue-login.mjs
// (HUE_CLIENT_ID, HUE_CLIENT_SECRET, HUE_REFRESH_TOKEN, HUE_USERNAME). Hue rotates that refresh
// token on every refresh, so the new one is kept in D1. One refresh runs at a time.
//   GET  /api/hue                        -> { configured, lights: [{ id, name, on, brightness, room, roomId }] }
//   POST /api/hue { action: 'light', id, on, brightness }  -> the same, after the change
//   POST /api/hue { action: 'allOff' }   -> the same, after every light is turned off
//   POST /api/hue/bridge { state, ack }  -> { commands } for the PC script only
// brightness is 0–100. Hue's bri is 1–254. Hue dropped digest auth in 2025; Basic is tried first.

const HUE_API = 'https://api.meethue.com';
let hueToken = null; // { value, expires }
let hueFlight = null;

function md5(message) {
  const msg = new TextEncoder().encode(message);
  const len = msg.length;
  const padded = new Uint8Array((((len + 8) >>> 6) << 6) + 64);
  padded.set(msg);
  padded[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 0x100000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const K = new Uint32Array(64);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  for (let i = 0; i < padded.length; i += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F, g;
      if (j < 16) { F = (B & C) | (~B & D); g = j; }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * j) % 16; }
      F = (F + A + K[j] + view.getUint32(i + g * 4, true)) >>> 0;
      const s = S[((j >>> 4) << 2) + (j & 3)];
      A = D; D = C; C = B;
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true); out.setUint32(4, b0, true); out.setUint32(8, c0, true); out.setUint32(12, d0, true);
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hueBasic(env) {
  const raw = new TextEncoder().encode(env.HUE_CLIENT_ID + ':' + env.HUE_CLIENT_SECRET);
  let s = '';
  for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
  return 'Basic ' + btoa(s);
}

// Token calls take the grant on the query string. A portal that still asks for digest answers
// the first call with 401 and a nonce; the code or refresh token is only spent on the retry.
async function hueTokenRequest(env, params) {
  const path = '/v2/oauth2/token';
  const url = HUE_API + path + '?' + new URLSearchParams(params);
  let res = await fetch(url, { method: 'POST', headers: { Authorization: hueBasic(env), Accept: 'application/json' } });
  const www = res.headers.get('www-authenticate') || '';
  if (res.status !== 401 || !/digest/i.test(www)) return res;
  const realm = /realm="([^"]*)"/.exec(www);
  const nonce = /nonce="([^"]*)"/.exec(www);
  if (!realm || !nonce) return res;
  const response = md5(md5(env.HUE_CLIENT_ID + ':' + realm[1] + ':' + env.HUE_CLIENT_SECRET) + ':' + nonce[1] + ':' + md5('POST:' + path));
  const header = 'Digest username="' + env.HUE_CLIENT_ID + '", realm="' + realm[1] + '", nonce="' + nonce[1] + '", uri="' + path + '", response="' + response + '"';
  return fetch(url, { method: 'POST', headers: { Authorization: header, Accept: 'application/json' } });
}

async function hueAccess(env) {
  if (hueToken && hueToken.expires > Date.now() + 60000) return hueToken.value;
  if (hueFlight) return hueFlight;
  const flight = (async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.HUE_REFRESH_TOKEN));
    const slot = 'hue_refresh:' + [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
    const refresh = (env.SHOPPING && (await kvGet(env.SHOPPING, slot))) || env.HUE_REFRESH_TOKEN;
    const res = await hueTokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh });
    if (!res.ok) throw Object.assign(new Error('hue token ' + res.status), { login: res.status === 400 || res.status === 401 });
    const t = await res.json();
    if (!t.access_token) throw Object.assign(new Error('hue token empty'), { login: true });
    if (t.refresh_token && t.refresh_token !== refresh && env.SHOPPING) await kvPut(env.SHOPPING, slot, t.refresh_token);
    const expiresIn = Number(t.expires_in || t.access_token_expires_in || 3600);
    hueToken = { value: t.access_token, expires: Date.now() + expiresIn * 1000 };
    return hueToken.value;
  })();
  hueFlight = flight;
  try {
    return await flight;
  } finally {
    if (hueFlight === flight) hueFlight = null;
  }
}

async function hueApi(env, method, path, body) {
  const user = env.HUE_USERNAME || '';
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(user)) throw Object.assign(new Error('hue username'), { login: true });
  const headers = { Authorization: 'Bearer ' + (await hueAccess(env)), Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(HUE_API + '/bridge/' + user + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status !== 401) return res;
  hueToken = null;
  headers.Authorization = 'Bearer ' + (await hueAccess(env));
  return fetch(HUE_API + '/bridge/' + user + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function hueOk(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* Hue sometimes returns an empty body */ }
  const err = Array.isArray(data) ? data.find((x) => x && x.error) : (data && data.error ? data : null);
  const type = err && err.error ? err.error.type : null;
  if (!res.ok || err) throw Object.assign(new Error('hue ' + (type || res.status)), { login: res.status === 401 || type === 1 });
  return data;
}

function hueLevel(on, bri) {
  if (bri == null || bri === '') return on ? 100 : 0;
  const level = Math.round(Number(bri) / 254 * 100);
  if (on && level < 1) return 1;
  return Math.max(0, Math.min(100, level));
}

function hueLabel(v) {
  return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32);
}

const HUE_GROUP_RANK = { Room: 0, Zone: 1, LightGroup: 2 };

async function hueState(env) {
  const lights = await hueOk(await hueApi(env, 'GET', '/lights'));
  const groups = await hueOk(await hueApi(env, 'GET', '/groups'));
  const roomOf = {};
  const rankOf = {};
  Object.entries(groups || {}).forEach(([id, g]) => {
    const rank = g && HUE_GROUP_RANK[g.type];
    if (!/^[0-9]{1,6}$/.test(id) || rank == null || !Array.isArray(g.lights)) return;
    g.lights.forEach((lid) => {
      const key = String(lid);
      if (rankOf[key] == null || rank < rankOf[key]) {
        rankOf[key] = rank;
        roomOf[key] = { roomId: id, room: hueLabel(g.name) || 'Room' };
      }
    });
  });
  const list = Object.entries(lights || {}).filter(([id, l]) => /^[0-9]{1,6}$/.test(id) && l && l.state).map(([id, l]) => {
    const online = l.state.reachable !== false;
    return {
      id,
      name: hueLabel(l.name) || 'Light',
      on: online && !!l.state.on,
      brightness: hueLevel(!!l.state.on, l.state.bri),
      room: (roomOf[id] && roomOf[id].room) || 'Hue',
      roomId: (roomOf[id] && roomOf[id].roomId) || 'other',
      online,
    };
  });
  list.sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : Number(a.id) - Number(b.id)));
  return { configured: true, lights: list };
}

function hueCommand(b) {
  const id = String(b.id || '');
  if (!/^[0-9]{1,6}$/.test(id)) return null;
  const on = !!b.on;
  const state = { on };
  if (on && b.brightness != null) {
    const level = Math.round(Number(b.brightness));
    if (!(level >= 1 && level <= 100)) return null;
    state.bri = Math.max(1, Math.min(254, Math.round(level / 100 * 254)));
  }
  return { id, state };
}

async function hueAllOff(env) {
  try {
    await hueOk(await hueApi(env, 'PUT', '/groups/0/action', { on: false }));
  } catch (err) {
    if (err.login) throw err;
    const lights = await hueOk(await hueApi(env, 'GET', '/lights'));
    for (const id of Object.keys(lights || {})) {
      if (!/^[0-9]{1,6}$/.test(id) || !lights[id] || !lights[id].state || !lights[id].state.on) continue;
      await hueOk(await hueApi(env, 'PUT', '/lights/' + id + '/state', { on: false }));
    }
  }
}

function hueJson(v, status) {
  return Response.json(v, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

function hueCloud(env) {
  return !!(env.HUE_CLIENT_ID && env.HUE_CLIENT_SECRET && env.HUE_REFRESH_TOKEN && env.HUE_USERNAME);
}

function hueRoomId(v) {
  const s = String(v || 'other').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  return s || 'other';
}

function sanitizeHueLights(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const l of list) {
    if (out.length >= 200) break;
    if (!l || typeof l !== 'object') continue;
    const id = String(l.id ?? '');
    if (!/^[0-9]{1,6}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const online = l.online !== false;
    const on = online && !!l.on;
    let brightness = Math.round(Number(l.brightness));
    if (!(brightness >= 0 && brightness <= 100)) brightness = on ? 100 : 0;
    out.push({
      id,
      name: hueLabel(l.name) || 'Light',
      on,
      brightness,
      room: hueLabel(l.room) || 'Hue',
      roomId: hueRoomId(l.roomId),
      online,
    });
  }
  return out;
}

function hueDashCommand(b) {
  if (!b || typeof b !== 'object') return null;
  if (b.action === 'allOff') return { id: crypto.randomUUID(), action: 'allOff' };
  if (b.action !== 'light') return null;
  const light = String(b.id ?? '');
  if (!/^[0-9]{1,6}$/.test(light)) return null;
  const on = !!b.on;
  const cmd = { id: crypto.randomUUID(), action: 'light', light, on };
  if (on && b.brightness != null && b.brightness !== '') {
    const level = Math.round(Number(b.brightness));
    if (!(level >= 0 && level <= 100)) return null;
    cmd.brightness = level === 0 ? 1 : level;
  }
  return cmd;
}

function applyHueCommands(lights, cmds) {
  for (const c of cmds || []) {
    if (!c) continue;
    if (c.action === 'allOff') {
      for (const l of lights) l.on = false;
    } else if (c.action === 'light') {
      const l = lights.find((x) => String(x.id) === String(c.light));
      if (!l) continue;
      l.on = !!c.on;
      if (c.on && c.brightness != null) l.brightness = c.brightness;
    }
  }
}

function huePublic(doc) {
  return { configured: true, lights: doc.lights };
}

function huePublicCmd(c) {
  const out = { id: c.id, action: c.action };
  if (c.action === 'light') {
    out.light = c.light;
    out.on = !!c.on;
    if (c.brightness != null) out.brightness = c.brightness;
  }
  return out;
}

async function hueLoad(env) {
  if (!env.SHOPPING) return null;
  const raw = await kvGet(env.SHOPPING, 'hue_bridge');
  if (!raw) return { raw: null, doc: null };
  try {
    const doc = JSON.parse(raw);
    if (!doc || !Array.isArray(doc.lights) || !Array.isArray(doc.cmds)) return { raw, doc: null };
    return { raw, doc };
  } catch {
    return { raw, doc: null };
  }
}

function hueWrote(r) {
  const m = (r && r.meta) || {};
  if (m.changes != null) return Number(m.changes) > 0;
  if (m.rows_written != null) return Number(m.rows_written) > 0;
  return false;
}

async function hueSave(env, prevRaw, doc) {
  const next = JSON.stringify(doc);
  const db = env.SHOPPING;
  const r = prevRaw == null
    ? await db.prepare('INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO NOTHING').bind('hue_bridge', next).run()
    : await db.prepare('UPDATE kv SET v = ?1 WHERE k = ?2 AND v = ?3').bind(next, 'hue_bridge', prevRaw).run();
  return hueWrote(r);
}

// Read-modify-write on one kv row. A stale bridge push cannot drop a tap that landed mid-sync:
// the loser retries and applies the commands still in the row.
async function hueMutate(env, fn) {
  if (!env.SHOPPING) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await hueLoad(env);
    const next = fn(cur.doc);
    if (next === cur.doc) return cur.doc;
    if (await hueSave(env, cur.raw, next)) return next;
  }
  throw Object.assign(new Error('hue busy'), { busy: true });
}

// The bridge posts about every 30 seconds. Set this false, and window.HUE_SYNC in js/live.js,
// to pause again: GET keeps the last rooms and POST does not queue a command.
const HUE_SYNC = true;

async function hue(request, env) {
  try {
    const cur = await hueLoad(env);
    const stored = cur && cur.doc && cur.doc.configured;
    if (!HUE_SYNC) {
      if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return hueJson(stored ? huePublic(cur.doc) : { configured: false });
    }
    if (request.method === 'GET') {
      if (stored) return hueJson(huePublic(cur.doc));
      if (!hueCloud(env)) return hueJson({ configured: false });
      return hueJson(await hueState(env));
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const b = await request.json().catch(() => ({}));
    if (stored) {
      const cmd = hueDashCommand(b);
      if (!cmd) return hueJson({ error: 'bad command' }, 400);
      const next = await hueMutate(env, (doc) => {
        if (!doc || !doc.configured || !Array.isArray(doc.lights)) return doc;
        const lights = doc.lights.map((l) => ({ ...l }));
        applyHueCommands(lights, [cmd]);
        const cmds = doc.cmds.concat(cmd).slice(-40);
        return { configured: true, rev: (doc.rev || 0) + 1, lights, cmds };
      });
      if (!next || !next.configured) return hueJson({ configured: false });
      return hueJson(huePublic(next));
    }
    if (!hueCloud(env)) return hueJson({ configured: false });
    if (b.action === 'allOff') await hueAllOff(env);
    else if (b.action === 'light') {
      const call = hueCommand(b);
      if (!call) return hueJson({ error: 'bad command' }, 400);
      await hueOk(await hueApi(env, 'PUT', '/lights/' + call.id + '/state', call.state));
    } else return hueJson({ error: 'bad command' }, 400);
    return hueJson(await hueState(env));
  } catch (err) {
    console.error('hue', err.busy ? 'busy' : err.message);
    return hueJson({ configured: true, error: err.login ? 'login' : 'Hue unavailable' }, err.busy ? 503 : 502);
  }
}

async function hueBridge(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!env.SHOPPING) return hueJson({ error: 'no database' }, 503);
  const body = await request.text();
  if (body.length > 100000) return hueJson({ error: 'too big' }, 413);
  let d;
  try { d = JSON.parse(body); } catch { return hueJson({ error: 'bad JSON' }, 400); }
  const lights = sanitizeHueLights(d && d.state && d.state.lights);
  if (!lights) return hueJson({ error: 'bad state' }, 400);
  const ack = new Set((Array.isArray(d.ack) ? d.ack : []).filter((x) => typeof x === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(x)).slice(0, 80));
  try {
    const next = await hueMutate(env, (doc) => {
      const cmds = ((doc && doc.cmds) || []).filter((c) => c && !ack.has(c.id));
      const merged = lights.map((l) => ({ ...l }));
      applyHueCommands(merged, cmds);
      return { configured: true, rev: ((doc && doc.rev) || 0) + 1, lights: merged, cmds };
    });
    return hueJson({ ok: true, commands: ((next && next.cmds) || []).map(huePublicCmd) });
  } catch (err) {
    console.error('hue bridge', err.busy ? 'busy' : 'failed');
    return hueJson({ error: 'Hue unavailable' }, err.busy ? 503 : 502);
  }
}

// ------------------------------------------------------------ Heatmiser neoHub (underfloor)
// The frame and this Worker cannot reach a hub on the home LAN. scripts/neohub.mjs runs on
// the PC, reads the hub, and posts zone state to /api/neohub/bridge. The dashboard keeps
// posting to /api/neohub; those commands are queued in D1 and the script applies them.
//   GET  /api/neohub                          -> { configured, zones: [{ id, name, current, target, heating, frost, offline, away }] }
//   POST /api/neohub { action: 'target', id, target }  -> the same, after the change
//   POST /api/neohub { action: 'frost', id, on }       -> the same, after frost mode changes
//   POST /api/neohub/bridge { state, ack }    -> { commands } for the PC script only
// Temperatures are °C. A target is 5–35 in half-degree steps.

function neoLabel(v) {
  return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
}

function neoNum(v, min, max) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

function sanitizeNeoZones(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const z of list) {
    if (out.length >= 40) break;
    if (!z || typeof z !== 'object') continue;
    const id = String(z.id ?? '');
    if (!/^[0-9]{1,8}$/.test(id) || seen.has(id)) continue;
    const name = neoLabel(z.name);
    if (!name) continue;
    seen.add(id);
    out.push({
      id,
      name,
      current: neoNum(z.current, -10, 60),
      target: neoNum(z.target, 0, 40),
      heating: !!z.heating,
      frost: !!z.frost,
      offline: !!z.offline,
      away: !!z.away,
    });
  }
  return out;
}

function neoDashCommand(b, zones) {
  if (!b || typeof b !== 'object') return null;
  const zoneId = String(b.id ?? '');
  if (!/^[0-9]{1,8}$/.test(zoneId)) return null;
  const zone = (zones || []).find((z) => z.id === zoneId);
  if (!zone) return null;
  if (b.action === 'target') {
    const target = Math.round(Number(b.target) * 2) / 2;
    if (!(target >= 5 && target <= 35)) return null;
    return { id: crypto.randomUUID(), action: 'target', zone: zoneId, name: zone.name, target };
  }
  if (b.action === 'frost') return { id: crypto.randomUUID(), action: 'frost', zone: zoneId, name: zone.name, on: !!b.on };
  return null;
}

function applyNeoCommands(zones, cmds) {
  for (const c of cmds || []) {
    if (!c) continue;
    const z = zones.find((x) => x.id === String(c.zone));
    if (!z) continue;
    if (c.action === 'target' && c.target != null) {
      z.target = c.target;
      z.frost = false;
    } else if (c.action === 'frost') z.frost = !!c.on;
  }
}

function neoPublic(doc) {
  return { configured: true, zones: doc.zones };
}

function neoPublicCmd(c) {
  const out = { id: c.id, action: c.action, zone: c.zone, name: c.name };
  if (c.action === 'target') out.target = c.target;
  if (c.action === 'frost') out.on = !!c.on;
  return out;
}

function neoJson(v, status) {
  return Response.json(v, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

async function neoLoad(env) {
  if (!env.SHOPPING) return null;
  const raw = await kvGet(env.SHOPPING, 'neohub_bridge');
  if (!raw) return { raw: null, doc: null };
  try {
    const doc = JSON.parse(raw);
    if (!doc || !Array.isArray(doc.zones) || !Array.isArray(doc.cmds)) return { raw, doc: null };
    return { raw, doc };
  } catch {
    return { raw, doc: null };
  }
}

async function neoSave(env, prevRaw, doc) {
  const next = JSON.stringify(doc);
  const db = env.SHOPPING;
  const r = prevRaw == null
    ? await db.prepare('INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO NOTHING').bind('neohub_bridge', next).run()
    : await db.prepare('UPDATE kv SET v = ?1 WHERE k = ?2 AND v = ?3').bind(next, 'neohub_bridge', prevRaw).run();
  return hueWrote(r);
}

async function neoMutate(env, fn) {
  if (!env.SHOPPING) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await neoLoad(env);
    const next = fn(cur.doc);
    if (next === cur.doc) return cur.doc;
    if (await neoSave(env, cur.raw, next)) return next;
  }
  throw Object.assign(new Error('neohub busy'), { busy: true });
}

async function neohub(request, env) {
  try {
    const cur = await neoLoad(env);
    const stored = cur && cur.doc && cur.doc.configured;
    if (request.method === 'GET') return neoJson(stored ? neoPublic(cur.doc) : { configured: false });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!stored) return neoJson({ configured: false });
    const b = await request.json().catch(() => ({}));
    const cmd = neoDashCommand(b, cur.doc.zones);
    if (!cmd) return neoJson({ error: 'bad command' }, 400);
    const next = await neoMutate(env, (doc) => {
      if (!doc || !doc.configured || !Array.isArray(doc.zones)) return doc;
      const zones = doc.zones.map((z) => ({ ...z }));
      applyNeoCommands(zones, [cmd]);
      return { configured: true, rev: (doc.rev || 0) + 1, zones, cmds: doc.cmds.concat(cmd).slice(-40) };
    });
    if (!next || !next.configured) return neoJson({ configured: false });
    return neoJson(neoPublic(next));
  } catch (err) {
    console.error('neohub', err.busy ? 'busy' : 'failed');
    return neoJson({ configured: true, error: 'Underfloor unavailable' }, err.busy ? 503 : 502);
  }
}

async function neohubBridge(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!env.SHOPPING) return neoJson({ error: 'no database' }, 503);
  const body = await request.text();
  if (body.length > 100000) return neoJson({ error: 'too big' }, 413);
  let d;
  try { d = JSON.parse(body); } catch { return neoJson({ error: 'bad JSON' }, 400); }
  const zones = sanitizeNeoZones(d && d.state && d.state.zones);
  if (!zones) return neoJson({ error: 'bad state' }, 400);
  const ack = new Set((Array.isArray(d.ack) ? d.ack : []).filter((x) => typeof x === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(x)).slice(0, 80));
  try {
    const next = await neoMutate(env, (doc) => {
      const cmds = ((doc && doc.cmds) || []).filter((c) => c && !ack.has(c.id));
      const merged = zones.map((z) => ({ ...z }));
      applyNeoCommands(merged, cmds);
      return { configured: true, rev: ((doc && doc.rev) || 0) + 1, zones: merged, cmds };
    });
    return neoJson({ ok: true, commands: ((next && next.cmds) || []).map(neoPublicCmd) });
  } catch (err) {
    console.error('neohub bridge', err.busy ? 'busy' : 'failed');
    return neoJson({ error: 'Underfloor unavailable' }, err.busy ? 503 : 502);
  }
}

// ------------------------------------------------------------ Ring doorbell
// The frame cannot call Ring (old trust store, no WebRTC). scripts/ring-bridge.mjs on the PC
// holds the refresh token and posts camera state here. Pictures are JPEGs in D1, served from
// this origin. Read only: no live video, no audio, no siren.
//   GET  /api/ring                 -> { configured, devices, updated }
//   POST /api/ring/bridge { state }-> { ok }
//   GET  /api/ring/snapshot?id=    -> image/jpeg
//   POST /api/ring/snapshot?id=    -> raw JPEG body

function ringLabel(v) {
  return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
}

function ringMillis(v) {
  const n = Number(v);
  if (!(n > 1e12 && n < 1e14)) return null;
  return n;
}

function ringBattery(v) {
  const n = Number(v);
  if (!(n >= 0 && n <= 100)) return null;
  return Math.round(n);
}

function ringEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const id = String(e.id || '');
  if (!/^[0-9]{4,24}$/.test(id)) return null;
  const kind = e.kind === 'ding' || e.kind === 'motion' || e.kind === 'knock' ? e.kind : null;
  if (!kind) return null;
  const at = ringMillis(e.at);
  if (at == null) return null;
  return { id, at, kind, person: !!e.person, missed: !!e.missed, answered: !!e.answered };
}

function sanitizeRingDevices(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const d of list) {
    if (out.length >= 4) break;
    if (!d || typeof d !== 'object') continue;
    const id = String(d.id ?? '');
    if (!/^[0-9]{1,20}$/.test(id) || seen.has(id)) continue;
    const name = ringLabel(d.name);
    if (!name) continue;
    seen.add(id);
    const events = [];
    const seenEv = new Set();
    for (const raw of (Array.isArray(d.events) ? d.events : [])) {
      const ev = ringEvent(raw);
      if (!ev || seenEv.has(ev.id)) continue;
      seenEv.add(ev.id);
      events.push(ev);
    }
    events.sort((a, b) => b.at - a.at);
    out.push({
      id,
      name,
      battery: ringBattery(d.battery),
      charging: !!d.charging,
      offline: !!d.offline,
      snap: ringMillis(d.snap),
      events: events.slice(0, 12),
    });
  }
  return out;
}

// Accepts an ArrayBuffer, a typed array, a base64 string, or a plain array of bytes.
// D1 gives a BLOB back as an array of numbers. Rejects anything that is not a JPEG
// between 100 bytes and 800 KB (D1's row limit is about 1 MB).
function ringJpegBytes(v) {
  if (!v) return null;
  let bytes = null;
  if (v instanceof ArrayBuffer) bytes = new Uint8Array(v);
  else if (ArrayBuffer.isView(v)) bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  else if (Array.isArray(v)) {
    if (v.length < 100 || v.length > 800000) return null;
    bytes = Uint8Array.from(v);
  } else if (typeof v === 'string') {
    try {
      const bin = atob(v.replace(/\s/g, ''));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return null;
    }
  }
  if (!bytes || bytes.byteLength < 100 || bytes.byteLength > 800000) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

function ringJson(v, status) {
  return Response.json(v, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
}

async function ringLoad(env) {
  if (!env.SHOPPING) return null;
  const raw = await kvGet(env.SHOPPING, 'ring_bridge');
  if (!raw) return null;
  try {
    const doc = JSON.parse(raw);
    const devices = sanitizeRingDevices(doc && doc.devices);
    if (!doc || !doc.configured || !devices) return null;
    return { configured: true, devices, updated: ringMillis(doc.updated) };
  } catch {
    return null;
  }
}

async function ring(request, env) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  try {
    const doc = await ringLoad(env);
    return ringJson(doc || { configured: false });
  } catch (err) {
    console.error('ring', err && err.busy ? 'busy' : 'failed');
    return ringJson({ configured: false });
  }
}

async function ringBridge(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!env.SHOPPING) return ringJson({ error: 'no database' }, 503);
  const body = await request.text();
  if (body.length > 100000) return ringJson({ error: 'too big' }, 413);
  let d;
  try { d = JSON.parse(body); } catch { return ringJson({ error: 'bad JSON' }, 400); }
  const devices = sanitizeRingDevices(d && d.state && d.state.devices);
  if (!devices) return ringJson({ error: 'bad state' }, 400);
  try {
    await kvPut(env.SHOPPING, 'ring_bridge', JSON.stringify({
      configured: true,
      rev: Date.now(),
      devices,
      updated: ringMillis(d.state && d.state.updated) || Date.now(),
    }));
    return ringJson({ ok: true });
  } catch {
    console.error('ring bridge failed');
    return ringJson({ error: 'Ring unavailable' }, 502);
  }
}

async function ringSnapTable(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS ring_snap (id TEXT PRIMARY KEY, jpeg BLOB NOT NULL, at INTEGER NOT NULL)').run();
}

async function ringSnapshot(request, env, url) {
  const id = url.searchParams.get('id') || '';
  if (!/^[0-9]{1,20}$/.test(id)) return new Response('Not found', { status: 404 });
  if (!env.SHOPPING) return request.method === 'GET' ? new Response('Not found', { status: 404 }) : ringJson({ error: 'no database' }, 503);
  const known = await ringLoad(env);
  if (!known || !known.devices.some((d) => d.id === id)) return new Response('Not found', { status: 404 });
  try {
    await ringSnapTable(env.SHOPPING);
    if (request.method === 'GET') {
      const row = await env.SHOPPING.prepare('SELECT jpeg FROM ring_snap WHERE id = ?1').bind(id).first();
      const bytes = ringJpegBytes(row && row.jpeg);
      if (!bytes) return new Response('Not found', { status: 404 });
      return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const type = request.headers.get('Content-Type') || '';
    if (!type.startsWith('image/jpeg')) return ringJson({ error: 'bad image' }, 400);
    const bytes = ringJpegBytes(await request.arrayBuffer());
    if (!bytes) return ringJson({ error: 'bad image' }, 400);
    const blob = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await env.SHOPPING.prepare(
      'INSERT INTO ring_snap (id, jpeg, at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET jpeg = excluded.jpeg, at = excluded.at',
    ).bind(id, blob, Date.now()).run();
    return ringJson({ ok: true });
  } catch {
    console.error('ring snapshot failed');
    return new Response('Not found', { status: 404 });
  }
}

// ------------------------------------------------------------ Phone sign-in
// A QR code for the iPhone camera. The code is a phone link stored in D1, not the household
// key. It is not written into the page as text, and it is not cached.
const PHONE_LINK = 'phone_link';
let phoneLinkCache = '';

function phoneQrSvg(link) {
  return renderSVG(link, { ecc: 'H', border: 4, pixelSize: 8, whiteColor: '#ffffff', blackColor: '#111111' });
}

function newPhoneLink() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function validPhoneLink(value) {
  return typeof value === 'string' && /^[0-9a-f]{48}$/.test(value);
}

async function storedPhoneLink(env) {
  if (phoneLinkCache) return phoneLinkCache;
  if (!env.SHOPPING) return null;
  const token = await kvGet(env.SHOPPING, PHONE_LINK);
  if (!validPhoneLink(token)) return null;
  phoneLinkCache = token;
  return token;
}

async function phoneLink(env) {
  const existing = await storedPhoneLink(env);
  if (existing) return existing;
  if (!env.SHOPPING) return null;
  const token = newPhoneLink();
  await env.SHOPPING.prepare(
    'INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO NOTHING'
  ).bind(PHONE_LINK, token).run();
  phoneLinkCache = '';
  return storedPhoneLink(env);
}

async function phone(request, env) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  let svg;
  try {
    const token = await phoneLink(env);
    if (!token) return new Response('Not found', { status: 404 });
    svg = phoneQrSvg(new URL(request.url).origin + '/?phone=' + token);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

// ------------------------------------------------------------ Spotify
// Remote control for one Spotify (Premium) account via the Web API: now playing, controls,
// library, search, queue and devices. Music plays on the account's devices, not on the screen.
// Secrets: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN, set by
// scripts/spotify-login.mjs. If Spotify hands out a new refresh token it's kept in D1.
//   GET  /api/spotify                       -> player state { configured, active, playing, ... }
//   GET  /api/spotify/list?kind=...         -> { items: [...] } (see spotifyList)
//   GET  /api/spotify/art?u=<image url>     -> the image, from Spotify's CDN only
//   POST /api/spotify { action, ... }       -> player state after the command (see spotifyCommand)

let spotifyToken = null; // { value, expires }

async function kvGet(db, k) {
  await db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)').run();
  const row = await db.prepare('SELECT v FROM kv WHERE k = ?1').bind(k).first();
  return row ? row.v : null;
}

async function kvPut(db, k, v) {
  await db.prepare('INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, v).run();
}

async function spotifyAccess(env, force) {
  if (!force && spotifyToken && spotifyToken.expires > Date.now() + 60000) return spotifyToken.value;
  // A rotated token is stored under a hash of the secret it replaced, so logging in again
  // (a new SPOTIFY_REFRESH_TOKEN secret) always wins over an older stored one.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SPOTIFY_REFRESH_TOKEN));
  const slot = 'spotify_refresh:' + [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const refresh = (env.SHOPPING && (await kvGet(env.SHOPPING, slot))) || env.SPOTIFY_REFRESH_TOKEN;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  });
  if (!res.ok) throw new Error('spotify token ' + res.status);
  const t = await res.json();
  if (t.refresh_token && t.refresh_token !== refresh && env.SHOPPING) await kvPut(env.SHOPPING, slot, t.refresh_token);
  spotifyToken = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 };
  return spotifyToken.value;
}

// Calls the Web API, refreshing the access token once if it was rejected.
async function spotifyApi(env, method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = { Authorization: 'Bearer ' + (await spotifyAccess(env, attempt > 0)) };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch('https://api.spotify.com/v1' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status !== 401) return res;
  }
  throw new Error('spotify unauthorised');
}

// Image URLs go through /api/spotify/art, so the frame's old trust store never has to reach
// Spotify's CDN. Picks the image nearest `size` px.
const ART_HOST = /^https:\/\/(i\.scdn\.co|mosaic\.scdn\.co|image-cdn-[a-z0-9-]+\.spotifycdn\.com|[a-z0-9-]+\.scdn\.co)\/[A-Za-z0-9/_.-]+$/;
function art(images, size) {
  if (!images || !images.length) return null;
  const pick = images.slice().sort((a, b) => Math.abs((a.width || 300) - size) - Math.abs((b.width || 300) - size))[0];
  return pick && ART_HOST.test(pick.url) ? '/api/spotify/art?u=' + encodeURIComponent(pick.url) : null;
}

const names = (list) => (list || []).map((a) => a.name).join(', ');

function track(t) {
  if (!t) return null;
  return {
    uri: t.uri,
    name: t.name || '',
    sub: t.artists ? names(t.artists) : (t.show || {}).name || '',
    art: art((t.album || t.show || {}).images || t.images, 64),
    duration: t.duration_ms || 0,
    kind: t.type || 'track',
  };
}

async function spotifyState(env) {
  const res = await spotifyApi(env, 'GET', '/me/player?additional_types=episode');
  if (res.status === 204) return { configured: true, active: false };
  if (!res.ok) throw new Error('spotify player ' + res.status);
  const p = await res.json();
  const item = p.item || {};
  const d = p.device || {};
  return {
    configured: true,
    active: true,
    playing: !!p.is_playing,
    uri: item.uri || '',
    title: item.name || '',
    artist: item.artists ? names(item.artists) : (item.show || {}).name || '',
    album: (item.album || {}).name || '',
    art: art((item.album || item.show || {}).images || item.images, 300),
    artLarge: art((item.album || item.show || {}).images || item.images, 640),
    context: (p.context || {}).uri || '',
    device: d.name || '',
    deviceId: d.id || '',
    deviceType: d.type || '',
    volume: d.volume_percent != null ? d.volume_percent : null,
    canVolume: !!(d.supports_volume !== false && d.volume_percent != null),
    shuffle: !!p.shuffle_state,
    repeat: p.repeat_state || 'off',
    progress: p.progress_ms || 0,
    duration: item.duration_ms || 0,
  };
}

// Lists for the Spotify tab. kind: playlists | albums | liked | recent | queue | devices |
// search (q) | playlist (id) | album (id) | artist (id).
const SID = /^[A-Za-z0-9]{22}$/;
async function spotifyList(env, url) {
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id') || '';
  if (['playlist', 'album', 'artist'].includes(kind) && !SID.test(id)) return { error: 'bad id' };
  const get = async (path) => {
    const res = await spotifyApi(env, 'GET', path);
    if (res.status === 403) throw Object.assign(new Error('scope'), { scope: true });
    if (!res.ok) throw new Error('spotify ' + kind + ' ' + res.status);
    return res.status === 204 ? {} : res.json();
  };
  // Development-mode apps get at most 10 items per request, so long lists come in pages.
  const pages = async (path, max) => {
    const sep = path.includes('?') ? '&' : '?';
    let items = [];
    for (let offset = 0; offset < max; offset += 10) {
      const r = await get(path + sep + 'limit=10&offset=' + offset);
      items = items.concat(r.items || []);
      if (!r.next || !(r.items || []).length) break;
    }
    return { items };
  };
  const ctx = (o, sub) => o && { uri: o.uri, id: o.id, name: o.name || '', sub, art: art(o.images, 64), kind: o.type };
  switch (kind) {
    case 'playlists': {
      const r = await pages('/me/playlists', 50);
      return { items: (r.items || []).filter(Boolean).map((p) => ctx(p, ((p.items || p.tracks || {}).total || 0) + ' songs · ' + ((p.owner || {}).display_name || ''))) };
    }
    case 'albums': {
      const r = await pages('/me/albums', 50);
      return { items: (r.items || []).map((a) => ctx(a.album, names(a.album.artists))) };
    }
    case 'liked': {
      const r = await pages('/me/tracks', 50);
      return { items: (r.items || []).map((x) => track(x.track)).filter(Boolean) };
    }
    case 'recent': {
      const r = await get('/me/player/recently-played?limit=10');
      const seen = {};
      return { items: (r.items || []).map((x) => track(x.track)).filter((t) => t && !seen[t.uri] && (seen[t.uri] = true)) };
    }
    case 'queue': {
      const r = await get('/me/player/queue');
      return { now: track(r.currently_playing), items: (r.queue || []).slice(0, 30).map(track).filter(Boolean) };
    }
    case 'devices': {
      const r = await get('/me/player/devices');
      return { items: (r.devices || []).map((d) => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, restricted: d.is_restricted, volume: d.volume_percent })) };
    }
    case 'search': {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      if (!q) return { tracks: [], artists: [], albums: [], playlists: [] };
      const r = await get('/search?type=track,artist,album,playlist&limit=8&q=' + encodeURIComponent(q));
      return {
        tracks: ((r.tracks || {}).items || []).map(track).filter(Boolean),
        artists: ((r.artists || {}).items || []).filter(Boolean).map((a) => ctx(a, 'Artist')),
        albums: ((r.albums || {}).items || []).filter(Boolean).map((a) => ctx(a, names(a.artists))),
        playlists: ((r.playlists || {}).items || []).filter(Boolean).map((p) => ctx(p, (p.owner || {}).display_name || 'Playlist')),
      };
    }
    case 'playlist': {
      const p = await get('/playlists/' + id + '?fields=uri,name,images,owner(display_name)');
      const head = ctx({ ...p, type: 'playlist', id }, (p.owner || {}).display_name || '');
      // Spotify only lets development-mode apps list the songs of playlists the user owns or
      // collaborates on (403 otherwise); playing the whole playlist still works.
      try {
        const r = await pages('/playlists/' + id + '/items', 50);
        return { head, items: r.items.map((x) => track(x.item || x.track)).filter((t) => t && t.uri) };
      } catch (err) {
        if (err.scope) return { head, items: [], note: 'Spotify only shows the songs in your own playlists here. Tap Play to play this one.' };
        throw err;
      }
    }
    case 'album': {
      const a = await get('/albums/' + id);
      const img = a.images;
      return { head: ctx(a, names(a.artists)), items: ((a.tracks || {}).items || []).map((t) => ({ ...track(t), art: art(img, 64) })) };
    }
    case 'artist': {
      // Top tracks are closed to development-mode apps, so an artist page lists their releases.
      const [a, rel] = await Promise.all([get('/artists/' + id), pages('/artists/' + id + '/albums?include_groups=album,single', 30)]);
      return { head: ctx(a, 'Artist'), items: (rel.items || []).filter(Boolean).map((x) => ctx(x, (x.album_type === 'single' ? 'Single' : 'Album') + (x.release_date ? ' · ' + x.release_date.slice(0, 4) : ''))) };
    }
    default:
      return { error: 'bad kind' };
  }
}

const URI = /^spotify:(track|episode|album|playlist|artist|show):[A-Za-z0-9]{22}$/;
const DEVICE = /^[A-Za-z0-9_-]{1,128}$/; // Alexa/Echo device ids contain - and _

// POST bodies: { action: play | pause | next | previous | volume (volume) | seek (position) |
// shuffle (state) | repeat (state) | queue (uri) | transfer (device) | playItem (context?, uris?, offset?) }
function spotifyCommand(b) {
  const dev = b.device && DEVICE.test(b.device) ? '?device_id=' + b.device : '';
  switch (b.action) {
    case 'play': return ['PUT', '/me/player/play' + dev];
    case 'pause': return ['PUT', '/me/player/pause'];
    case 'next': return ['POST', '/me/player/next'];
    case 'previous': return ['POST', '/me/player/previous'];
    case 'volume': {
      const v = Math.round(Number(b.volume));
      return v >= 0 && v <= 100 ? ['PUT', '/me/player/volume?volume_percent=' + v] : null;
    }
    case 'seek': {
      const ms = Math.round(Number(b.position));
      return ms >= 0 ? ['PUT', '/me/player/seek?position_ms=' + ms] : null;
    }
    case 'shuffle': return ['PUT', '/me/player/shuffle?state=' + (b.state ? 'true' : 'false')];
    case 'repeat': return ['off', 'context', 'track'].includes(b.state) ? ['PUT', '/me/player/repeat?state=' + b.state] : null;
    case 'queue': return URI.test(b.uri || '') ? ['POST', '/me/player/queue?uri=' + encodeURIComponent(b.uri)] : null;
    case 'transfer': return DEVICE.test(b.device || '') ? ['PUT', '/me/player', { device_ids: [b.device], play: true }] : null;
    case 'playItem': {
      const body = {};
      if (b.context) {
        if (!URI.test(b.context)) return null;
        body.context_uri = b.context;
        if (b.offset) { if (!URI.test(b.offset)) return null; body.offset = { uri: b.offset }; }
      } else if (Array.isArray(b.uris) && b.uris.length && b.uris.length <= 100 && b.uris.every((u) => URI.test(u))) {
        body.uris = b.uris;
        const i = Math.round(Number(b.position || 0));
        if (i > 0 && i < b.uris.length) body.offset = { position: i };
      } else return null;
      return ['PUT', '/me/player/play' + dev, body];
    }
    default: return null;
  }
}

async function spotify(request, env, url) {
  const json = (v, status) => Response.json(v, { status: status || 200, headers: { 'Cache-Control': 'private, no-store' } });
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_REFRESH_TOKEN) return json({ configured: false });
  if (url.pathname === '/api/spotify/art') {
    const u = url.searchParams.get('u') || '';
    if (!ART_HOST.test(u)) return new Response('Not found', { status: 404 });
    const img = await fetch(u, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!img.ok) return new Response('Not found', { status: 404 });
    return new Response(img.body, { headers: { 'Content-Type': img.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  }
  try {
    if (url.pathname === '/api/spotify/list') return json(await spotifyList(env, url));
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const call = spotifyCommand(body);
      if (!call) return json({ error: 'bad command' }, 400);
      const res = await spotifyApi(env, call[0], call[1], call[2]);
      if (res.status === 404) return json({ error: body.action === 'transfer' ? 'Spotify can’t reach that device right now. Try again, or start it from the phone.' : 'No active device. Start Spotify on a phone or speaker, or pick one under Devices.' }, 409);
      if (res.status === 403) return json({ error: 'Spotify refused (Premium needed, or not allowed on this device)' }, 409);
      if (!res.ok && res.status !== 204) throw new Error('spotify ' + body.action + ' ' + res.status);
      await new Promise((r) => setTimeout(r, 450)); // let Spotify catch up before reading the state
    } else if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return json(await spotifyState(env));
  } catch (err) {
    if (err.scope) return json({ error: 'scope' }, 403);
    console.error('spotify', err.message);
    return json({ configured: true, error: 'Spotify unavailable' }, 502);
  }
}

function cookieValue(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

function cookieHeader(dashKey) {
  return `${COOKIE}=${dashKey}; Max-Age=${MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function isIos(request) {
  return /iPhone|iPad|iPod/.test(request.headers.get('User-Agent') || '');
}

// Runs before the app script. Same-origin fetches and pictures keep the phone link, so the
// bookmark works even when Safari will not keep the cookie. The link is hex, so it needs no
// further escaping inside this script.
function phoneBoot(token) {
  return '<script>(function(){var t=' + JSON.stringify(token) + ';' +
    'function add(u){if(typeof u!=="string"||u.indexOf("data:")===0||u.indexOf("blob:")===0)return u;' +
    'try{var x=new URL(u,location.origin);if(x.origin!==location.origin||(x.protocol!=="https:"&&x.protocol!=="http:"))return u;' +
    'if(!x.searchParams.get("phone"))x.searchParams.set("phone",t);var next=x.pathname+x.search+x.hash;' +
    'return /^https?:/i.test(u)?x.origin+next:next;}catch(e){return u;}}' +
    'var f=window.fetch;window.fetch=function(i,n){if(typeof i==="string")return f.call(this,add(i),n);' +
    'if(typeof Request!=="undefined"&&i instanceof Request)return f.call(this,new Request(add(i.url),i));' +
    'return f.call(this,i,n);};' +
    'try{var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");' +
    'if(d&&d.set&&d.get)Object.defineProperty(HTMLImageElement.prototype,"src",{configurable:true,' +
    'set:function(v){d.set.call(this,add(String(v)));},get:function(){return d.get.call(this);}});}catch(e){}})();</script>';
}

function withPhoneLinks(html, token) {
  html = html.replace('<head>', '<head>' + phoneBoot(token));
  return html.replace(/\s(href|src)="([^"]+)"/g, (full, attr, u) => {
    if (/^(https?:)?\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#')) return full;
    const cut = u.split('#');
    const parts = cut[0].split('?');
    const params = new URLSearchParams(parts[1] || '');
    if (!params.get('phone')) params.set('phone', token);
    return ' ' + attr + '="' + parts[0] + '?' + params.toString() + (cut[1] ? '#' + cut[1] : '') + '"';
  });
}

function phoneManifest(token) {
  const q = '?phone=' + token;
  return Response.json({
    name: 'Home HQ',
    short_name: 'Home HQ',
    start_url: '/' + q,
    scope: '/',
    display: 'fullscreen',
    orientation: 'landscape',
    background_color: '#F2EEE6',
    theme_color: '#F2EEE6',
    icons: [
      { src: '/icon-192.png' + q, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png' + q, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }, {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

function signed(response, dashKey, opts) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', cookieHeader(dashKey));
  headers.set('Cache-Control', opts.immutable ? 'private, max-age=31536000, immutable' : 'private, no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { sanitizeHueLights, applyHueCommands, hueDashCommand, sanitizeNeoZones, applyNeoCommands, neoDashCommand, sanitizeRingDevices, ringJpegBytes, phoneQrSvg };

export default {
  async fetch(request, env) {
    if (!env.DASH_KEY) return new Response('DASH_KEY not configured', { status: 500 });

    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const phoneParam = url.searchParams.get('phone');
    let viaPhone = false;

    if (phoneParam !== null) {
      if (!validPhoneLink(phoneParam)) return new Response('Not found', { status: 404 });
      const stored = await storedPhoneLink(env);
      if (!(await same(phoneParam, stored))) return new Response('Not found', { status: 404 });
      viaPhone = true;
    } else if (key !== null) {
      if (!(await same(key, env.DASH_KEY))) return new Response('Not found', { status: 404 });
      // The frame's WebView keeps a cookie set on this redirect. Safari, opened from the
      // iPhone camera, does not, so an iPhone is given the page it actually asked for.
      if (!isIos(request)) {
        url.searchParams.delete('key');
        return new Response(null, {
          status: 302,
          headers: {
            Location: url.pathname + url.search,
            'Set-Cookie': cookieHeader(env.DASH_KEY),
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          },
        });
      }
    } else if (!(await same(cookieValue(request), env.DASH_KEY))) {
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname === '/api/data') {
      const [weather, calendars] = await Promise.all([
        getWeather(env).catch((err) => {
          console.error('weather', err);
          return null;
        }),
        getCalendars(env),
      ]);
      return Response.json({ weather, calendars }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    if (url.pathname === '/api/shopping') return shopping(request, env);
    if (url.pathname === '/api/chores' || url.pathname === '/api/chores/done') return chores(request, env, url);
    if (url.pathname === '/api/agents') return agents(request, env);
    if (url.pathname === '/api/hive') return hive(request, env);
    if (url.pathname === '/api/hue/bridge') return hueBridge(request, env);
    if (url.pathname === '/api/hue') return hue(request, env);
    if (url.pathname === '/api/neohub/bridge') return neohubBridge(request, env);
    if (url.pathname === '/api/neohub') return neohub(request, env);
    if (url.pathname === '/api/ring/snapshot') return ringSnapshot(request, env, url);
    if (url.pathname === '/api/ring/bridge') return ringBridge(request, env);
    if (url.pathname === '/api/ring') return ring(request, env);
    if (url.pathname === '/api/phone') return phone(request, env);
    if (viaPhone && url.pathname === '/manifest.webmanifest') return signed(phoneManifest(phoneParam), env.DASH_KEY, {});
    if (url.pathname === '/api/spotify' || url.pathname.startsWith('/api/spotify/')) return spotify(request, env, url);

    // The sign-in link is a query on the page address. Asset names are the path alone.
    const assetUrl = new URL(request.url);
    assetUrl.search = '';
    const res = await env.ASSETS.fetch(new Request(assetUrl, request));
    const type = res.headers.get('content-type') || '';
    // Read the HTML before wrapping it. The asset body can only be used once.
    const page = viaPhone && res.ok && type.includes('text/html')
      ? new Response(withPhoneLinks(await res.text(), phoneParam), {
        status: res.status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
      : res;
    // Hashed files (Vite's /assets/*, scripts/build-photos.mjs's /photos/<hash>.jpg) never change
    // under the same name, so the tablet may keep them; this saves most requests from the slideshow.
    const immutable = /^\/(assets\/|photos\/[0-9a-f]+\.jpg$)/.test(url.pathname);
    if (viaPhone || (key !== null && isIos(request))) return signed(page, env.DASH_KEY, { immutable: immutable && res.ok });
    const out = new Response(page.body, page);
    out.headers.set('Cache-Control', immutable && res.ok ? 'private, max-age=31536000, immutable' : 'private, no-store');
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  },
};
