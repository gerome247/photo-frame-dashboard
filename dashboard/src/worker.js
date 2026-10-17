// Gatekeeper for the dashboard: nothing (not even index.html) is served without the key.
// - Visit /?key=<DASH_KEY> once: sets a long-lived cookie and redirects to the clean URL.
// - After that the cookie is enough. Wrong/missing key → 404, so the site looks empty.
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
// The raw ICS text is passed through and parsed on the tablet: parsing costs ~80 ms CPU per
// calendar, well over the free plan's 10 ms per request.
async function getCalendars(env) {
  const lines = (env.CALENDARS || '').split('\n').filter((l) => l.includes('='));
  return Promise.all(
    lines.map(async (line) => {
      const who = line.slice(0, line.indexOf('=')).trim().toLowerCase();
      const url = line.slice(line.indexOf('=') + 1).trim();
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

// ------------------------------------------------------------ Spotify
// Now playing + play/pause/skip/volume for one Spotify (Premium) account, via the Web API.
// Secrets: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN, set by
// scripts/spotify-login.mjs. If Spotify hands out a new refresh token it's kept in D1.
//   GET  /api/spotify                          -> { configured, active, playing, title, ... }
//   POST /api/spotify { action, volume? }      -> the same, after the command
//        action: play | pause | next | previous | volume

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
async function spotifyApi(env, method, path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://api.spotify.com/v1' + path, {
      method,
      headers: { Authorization: 'Bearer ' + (await spotifyAccess(env, attempt > 0)) },
    });
    if (res.status !== 401) return res;
  }
  throw new Error('spotify unauthorised');
}

async function spotifyState(env) {
  const res = await spotifyApi(env, 'GET', '/me/player?additional_types=episode');
  if (res.status === 204) return { configured: true, active: false };
  if (!res.ok) throw new Error('spotify player ' + res.status);
  const p = await res.json();
  const item = p.item || {};
  const images = (item.album || item.show || {}).images || [];
  const art = images.length ? images[images.length > 1 ? 1 : 0].url : null; // ~300 px
  return {
    configured: true,
    active: true,
    playing: !!p.is_playing,
    title: item.name || '',
    artist: item.artists ? item.artists.map((a) => a.name).join(', ') : (item.show || {}).name || '',
    album: (item.album || {}).name || '',
    art: art && /^https:\/\/i\.scdn\.co\/image\/[0-9a-f]+$/.test(art) ? '/api/spotify/art?id=' + art.split('/').pop() : null,
    device: (p.device || {}).name || '',
    volume: p.device && p.device.volume_percent != null ? p.device.volume_percent : null,
    canVolume: !!(p.device && p.device.supports_volume !== false && p.device.volume_percent != null),
    progress: p.progress_ms || 0,
    duration: item.duration_ms || 0,
  };
}

const SPOTIFY_ACTIONS = {
  play: ['PUT', '/me/player/play'],
  pause: ['PUT', '/me/player/pause'],
  next: ['POST', '/me/player/next'],
  previous: ['POST', '/me/player/previous'],
};

async function spotify(request, env, url) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_REFRESH_TOKEN) {
    return Response.json({ configured: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  // Album art through the Worker, so the frame's old trust store never has to reach Spotify's CDN.
  if (url.pathname === '/api/spotify/art') {
    const id = url.searchParams.get('id') || '';
    if (!/^[0-9a-f]{20,64}$/.test(id)) return new Response('Not found', { status: 404 });
    const img = await fetch('https://i.scdn.co/image/' + id, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!img.ok) return new Response('Not found', { status: 404 });
    return new Response(img.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  }
  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      let call = SPOTIFY_ACTIONS[body.action];
      if (body.action === 'volume') {
        const v = Math.round(Number(body.volume));
        if (!(v >= 0 && v <= 100)) return Response.json({ error: 'bad volume' }, { status: 400 });
        call = ['PUT', '/me/player/volume?volume_percent=' + v];
      }
      if (!call) return Response.json({ error: 'bad action' }, { status: 400 });
      const res = await spotifyApi(env, call[0], call[1]);
      if (res.status === 404) return Response.json({ error: 'Nothing is playing on any device' }, { status: 409 });
      if (res.status === 403) return Response.json({ error: 'Spotify refused (Premium needed, or not allowed on this device)' }, { status: 409 });
      if (!res.ok && res.status !== 204) throw new Error('spotify ' + body.action + ' ' + res.status);
      await new Promise((r) => setTimeout(r, 400)); // let Spotify catch up before reading the state
    } else if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return Response.json(await spotifyState(env), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('spotify', err.message);
    return Response.json({ configured: true, error: 'Spotify unavailable' }, { status: 502 });
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

export default {
  async fetch(request, env) {
    if (!env.DASH_KEY) return new Response('DASH_KEY not configured', { status: 500 });

    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    if (key !== null) {
      if (!(await same(key, env.DASH_KEY))) return new Response('Not found', { status: 404 });
      url.searchParams.delete('key');
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.pathname + url.search,
          'Set-Cookie': `${COOKIE}=${env.DASH_KEY}; Max-Age=${MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (!(await same(cookieValue(request), env.DASH_KEY))) {
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
    if (url.pathname === '/api/spotify' || url.pathname === '/api/spotify/art') return spotify(request, env, url);

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    // Hashed files (Vite's /assets/*, scripts/build-photos.mjs's /photos/<hash>.jpg) never change
    // under the same name, so the tablet may keep them; this saves most requests from the slideshow.
    const immutable = /^\/(assets\/|photos\/[0-9a-f]+\.jpg$)/.test(url.pathname);
    out.headers.set('Cache-Control', immutable && res.ok ? 'private, max-age=31536000, immutable' : 'private, no-store');
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  },
};
