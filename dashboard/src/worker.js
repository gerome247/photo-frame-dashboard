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
// The PC pushes usage numbers (scripts/agents-push.mjs reads the Claude Code login and logs
// there, so no AI account token ever reaches Cloudflare). Kept in D1; the live service status
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
const DEVICE = /^[A-Za-z0-9]{1,64}$/;

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
      if (res.status === 404) return json({ error: 'No active device. Start Spotify on a phone or speaker, or pick one under Devices.' }, 409);
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
    if (url.pathname === '/api/chores' || url.pathname === '/api/chores/done') return chores(request, env, url);
    if (url.pathname === '/api/agents') return agents(request, env);
    if (url.pathname === '/api/spotify' || url.pathname.startsWith('/api/spotify/')) return spotify(request, env, url);

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
