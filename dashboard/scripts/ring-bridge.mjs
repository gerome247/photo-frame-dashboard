// Syncs Ring doorbells to the dashboard. The frame cannot reach Ring, so this process holds the
// refresh token from scripts/ring-login.mjs and pushes stills plus recent events.
// The token lives only in .ring-token (mode 600). Nothing from Ring is printed.
//
//   node scripts/ring-bridge.mjs     (from dashboard/, or the home-dashboard-ring user service)
//
// Still pictures and the event list only. No live video, no audio, no siren.
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accessHeaders } from './access-token.mjs';

const DASH = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_FILE = join(DASH, '.ring-token');
const CLIENT = 'ring_official_android';

export function mapRingDevices(payload, eventsById) {
  const doors = asList(payload && payload.doorbots).concat(asList(payload && payload.authorized_doorbots));
  const cams = (doors.length ? doors : asList(payload && payload.stickup_cams)).slice(0, 4);
  const out = [];
  for (const cam of cams) {
    const row = mapOne(cam, eventsById && eventsById[String(cam && cam.id)]);
    if (row) out.push(row);
  }
  return out;
}

// A battery camera that is not on a wired power mode. Forcing snapshots on these drains them.
export function ringOnBattery(cam) {
  return batteryOf(cam) != null && !(cam && cam.settings && cam.settings.power_mode === 'wired');
}

function asList(v) {
  return Array.isArray(v) ? v : [];
}

function label(v) {
  return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
}

function batteryOf(cam) {
  const health = cam && cam.health;
  if (health && health.battery_percentage != null && health.battery_percentage !== '') {
    const pct = Number(health.battery_percentage);
    if (pct >= 0 && pct <= 100) return Math.round(pct);
  }
  const life = Number(cam && cam.battery_life);
  if (life >= 0 && life <= 100) return Math.round(life);
  return null;
}

function chargingOf(cam) {
  if (cam && cam.external_connection) return true;
  if (cam && cam.settings && cam.settings.power_mode === 'wired') return true;
  if (cam && cam.health && Number(cam.health.ac_power) === 1) return true;
  return false;
}

function personOf(cv) {
  if (!cv || typeof cv !== 'object') return false;
  if (cv.person_detected) return true;
  const d = cv.detection_type;
  if (typeof d === 'string') return /human|person/i.test(d);
  if (d && typeof d === 'object') return !!(d.human || d.person);
  return false;
}

function kindOf(k) {
  if (k === 'ding') return 'ding';
  if (k === 'motion') return 'motion';
  if (k === 'door_activity') return 'knock';
  return null;
}

function mapEvents(rows) {
  const out = [];
  const seen = new Set();
  for (const e of asList(rows)) {
    if (!e || typeof e !== 'object') continue;
    const kind = kindOf(e.kind);
    const id = String(e.ding_id_str || e.ding_id || '');
    const at = Date.parse(e.created_at);
    if (!kind || !/^[0-9]{4,24}$/.test(id) || seen.has(id) || !(at > 1e12 && at < 1e14)) continue;
    seen.add(id);
    out.push({
      id,
      at,
      kind,
      person: personOf(e.cv_properties),
      missed: kind === 'ding' && e.state === 'timed_out',
      answered: kind === 'ding' && e.state === 'completed',
    });
  }
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, 12);
}

function mapOne(cam, events) {
  if (!cam || typeof cam !== 'object') return null;
  const id = String(cam.id ?? '');
  if (!/^[0-9]{1,20}$/.test(id)) return null;
  return {
    id,
    name: label(cam.description) || 'Doorbell',
    battery: batteryOf(cam),
    charging: chargingOf(cam),
    offline: !!(cam.alerts && cam.alerts.connection === 'offline'),
    snap: null,
    events: mapEvents(events),
  };
}

function fail(code, wait) {
  const err = new Error(code);
  err.code = code;
  if (wait) err.wait = wait;
  throw err;
}

function log(msg) {
  console.log(new Date().toISOString(), msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function retryMs(header) {
  const n = Number(header);
  if (!(n >= 1 && n <= 600)) return 60000;
  return n * 1000;
}

function validRt(s) {
  return typeof s === 'string' && s.length >= 20 && s.length <= 4000 && !/[\u0000-\u001f\s]/.test(s);
}

function validHid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export function readToken() {
  if (!existsSync(TOKEN_FILE)) return null;
  let packed = '';
  try { packed = readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return null; }
  if (!packed) return null;
  try {
    const doc = JSON.parse(Buffer.from(packed, 'base64').toString('utf8'));
    if (!doc || !validRt(doc.rt) || !validHid(doc.hid)) return null;
    return { rt: doc.rt, hid: doc.hid };
  } catch {
    return null;
  }
}

export function writeToken(hid, rt) {
  if (!validHid(hid) || !validRt(rt)) fail('login');
  const packed = Buffer.from(JSON.stringify({ rt, hid }), 'utf8').toString('base64');
  writeFileSync(TOKEN_FILE, packed + '\n', { mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);
}

function loadDash() {
  const cfg = JSON.parse(readFileSync(join(DASH, 'local.config.json'), 'utf8'));
  const key = readFileSync(join(DASH, '.dash-key'), 'utf8').trim();
  const url = String(cfg.url || '').replace(/\/$/, '');
  if (!url || !key) fail('dashboard');
  return { url, key };
}

async function oauth(body, hardwareId, code) {
  const res = await fetch('https://oauth.ring.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      '2fa-support': 'true',
      '2fa-code': code || '',
      hardware_id: hardwareId,
      'User-Agent': 'android:com.ringapp',
    },
    body: JSON.stringify({ client_id: CLIENT, scope: 'client', ...body }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') };
}

// Used by scripts/ring-login.mjs. Returns a small result and never the response body.
export async function passwordGrant({ email, password, hardwareId, code }) {
  const res = await oauth({ grant_type: 'password', username: email, password }, hardwareId, code);
  if (res.status === 200 && res.data && validRt(res.data.refresh_token)) {
    return { ok: true, refreshToken: res.data.refresh_token };
  }
  if (res.status === 412) return { ok: false, need: res.data && res.data.tsv_state === 'totp' ? 'totp' : 'code' };
  if (res.status === 400 && res.data && typeof res.data.error === 'string' && res.data.error.startsWith('Verification Code')) {
    return { ok: false, badCode: true };
  }
  const desc = res.data && typeof res.data.error_description === 'string' ? res.data.error_description : '';
  if (/too many/i.test(desc)) return { ok: false, busy: true };
  return { ok: false, refused: true };
}

async function refreshAccess(auth) {
  const res = await oauth({ grant_type: 'refresh_token', refresh_token: auth.rt }, auth.hid, '');
  if (res.status === 429) fail('busy', retryMs(res.retryAfter));
  if (res.status === 400 || res.status === 401) fail('login');
  if (res.status !== 200 || !res.data || !validRt(res.data.refresh_token) || typeof res.data.access_token !== 'string' || !res.data.access_token) {
    fail('ring');
  }
  // Ring rotates the refresh token. Save it before doing anything else.
  if (res.data.refresh_token !== auth.rt) {
    auth.rt = res.data.refresh_token;
    writeToken(auth.hid, auth.rt);
  }
  const expiresIn = Number(res.data.expires_in) || 3600;
  return { access: res.data.access_token, until: Date.now() + Math.max(60, expiresIn - 120) * 1000 };
}

async function ringFetch(auth, access, url, opts) {
  const headers = {
    authorization: 'Bearer ' + access,
    hardware_id: auth.hid,
    'User-Agent': 'android:com.ringapp',
    accept: opts && opts.jpeg ? 'image/jpeg' : 'application/json',
  };
  let body;
  if (opts && opts.body) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, {
    method: (opts && opts.method) || 'GET',
    headers,
    body,
    signal: AbortSignal.timeout((opts && opts.timeout) || 20000),
  });
  if (res.status === 401) {
    await res.arrayBuffer().catch(() => {});
    fail('auth');
  }
  if (res.status === 429) {
    const wait = retryMs(res.headers.get('retry-after'));
    await res.arrayBuffer().catch(() => {});
    fail('busy', wait);
  }
  return res;
}

async function openSession(auth, access) {
  const res = await ringFetch(auth, access, 'https://api.ring.com/clients_api/session', {
    method: 'POST',
    body: {
      device: {
        hardware_id: auth.hid,
        metadata: { api_version: 11, device_model: 'home-dashboard' },
        os: 'android',
      },
    },
  });
  await res.arrayBuffer().catch(() => {});
  if (!res.ok) fail('ring');
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { fail('ring'); }
}

async function loadEvents(auth, access, cam) {
  const id = String(cam.id);
  const location = cam.location_id;
  if (location == null || location === '') return [];
  const url = 'https://api.ring.com/clients_api/locations/' + encodeURIComponent(location) + '/devices/' + id + '/events?limit=12';
  const res = await ringFetch(auth, access, url);
  if (res.status === 404) {
    await res.arrayBuffer().catch(() => {});
    return [];
  }
  if (!res.ok) {
    await res.arrayBuffer().catch(() => {});
    fail('ring');
  }
  const data = await readJson(res);
  return Array.isArray(data) ? data : (data && data.events);
}

async function fetchSnap(auth, access, id, force) {
  const q = force ? '?extras=force&max-wait-ms=8000' : '?max-wait-ms=4000';
  const res = await ringFetch(auth, access, 'https://app-snaps.ring.com/snapshots/next/' + id + q, { jpeg: true, timeout: 20000 });
  if (res.status === 204 || res.status === 404 || !res.ok) {
    await res.arrayBuffer().catch(() => {});
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf.length > 800000) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  return buf;
}

async function pushState(dash, devices) {
  const res = await fetch(dash.url + '/api/ring/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'dash_key=' + dash.key, ...accessHeaders() },
    body: JSON.stringify({ state: { devices, updated: Date.now() } }),
    signal: AbortSignal.timeout(15000),
  });
  await res.arrayBuffer().catch(() => {});
  if (!res.ok) fail('dashboard');
}

async function pushSnap(dash, id, jpeg) {
  const res = await fetch(dash.url + '/api/ring/snapshot?id=' + encodeURIComponent(id), {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Cookie: 'dash_key=' + dash.key, ...accessHeaders() },
    body: jpeg,
    signal: AbortSignal.timeout(20000),
  });
  await res.arrayBuffer().catch(() => {});
  if (!res.ok) fail('dashboard');
}

async function main() {
  const dash = loadDash();
  let access = '';
  let accessUntil = 0;
  let auth = null;
  let lastCount = -1;
  let toldLogin = false;
  let toldBusy = false;
  let toldDash = false;
  let toldWait = false;
  let retriedAuth = false;
  let fails = 0;
  const snaps = {};
  while (true) {
    try {
      const token = readToken();
      if (!token) {
        auth = null;
        access = '';
        if (!toldWait) { log(existsSync(TOKEN_FILE) ? 'Ring needs you to log in again' : 'waiting for a Ring login'); toldWait = true; }
        await sleep(5000);
        continue;
      }
      toldWait = false;
      if (!auth || auth.rt !== token.rt || auth.hid !== token.hid) {
        auth = { rt: token.rt, hid: token.hid };
        access = '';
      }
      if (!access || Date.now() >= accessUntil) {
        const next = await refreshAccess(auth);
        access = next.access;
        accessUntil = next.until;
        await openSession(auth, access);
      }
      const listRes = await ringFetch(auth, access, 'https://api.ring.com/clients_api/ring_devices');
      if (!listRes.ok) {
        await listRes.arrayBuffer().catch(() => {});
        fail('ring');
      }
      const payload = await readJson(listRes);
      const doors = asList(payload && payload.doorbots).concat(asList(payload && payload.authorized_doorbots));
      const cams = (doors.length ? doors : asList(payload && payload.stickup_cams)).slice(0, 4);
      const eventsById = {};
      for (const cam of cams) {
        if (!cam || !/^[0-9]{1,20}$/.test(String(cam.id ?? ''))) continue;
        eventsById[String(cam.id)] = await loadEvents(auth, access, cam);
      }
      const devices = mapRingDevices(payload, eventsById);
      const now = Date.now();
      const pending = [];
      for (const row of devices) {
        const cam = cams.find((c) => c && String(c.id) === row.id);
        const prev = snaps[row.id] || { hash: '', checked: 0, uploaded: 0, event: '' };
        snaps[row.id] = prev;
        row.snap = prev.uploaded || null;
        const newest = row.events[0] && row.events[0].id;
        const interval = cam && ringOnBattery(cam) ? 10 * 60 * 1000 : 60 * 1000;
        const due = now - prev.checked >= interval;
        const eventChanged = !!(newest && newest !== prev.event);
        if (cam && !row.offline && (due || eventChanged)) pending.push({ row, cam, prev, newest });
        else if (newest) prev.event = newest;
      }
      // The snapshot route only accepts a camera the dashboard already knows about.
      await pushState(dash, devices);
      let posted = false;
      for (const item of pending) {
        const jpeg = await fetchSnap(auth, access, item.row.id, !ringOnBattery(item.cam));
        item.prev.checked = Date.now();
        if (item.newest) item.prev.event = item.newest;
        if (!jpeg) continue;
        const hash = createHash('sha256').update(jpeg).digest('hex');
        if (hash === item.prev.hash) continue;
        await pushSnap(dash, item.row.id, jpeg);
        item.prev.hash = hash;
        item.prev.uploaded = Date.now();
        item.row.snap = item.prev.uploaded;
        posted = true;
      }
      if (posted) await pushState(dash, devices);
      if (devices.length !== lastCount) log('synced ' + devices.length + ' cameras');
      lastCount = devices.length;
      toldLogin = false;
      toldBusy = false;
      toldDash = false;
      retriedAuth = false;
      fails = 0;
      await sleep(30000);
    } catch (err) {
      const code = err && err.code;
      if (code === 'login') {
        access = '';
        if (!toldLogin) { log('Ring needs you to log in again'); toldLogin = true; }
        await sleep(60000);
        continue;
      }
      if (code === 'auth') {
        access = '';
        if (!retriedAuth) { retriedAuth = true; continue; }
      }
      if (code === 'busy') {
        if (!toldBusy) { log('Ring is busy'); toldBusy = true; }
        await sleep(err.wait || 60000);
        continue;
      }
      if (code === 'dashboard') {
        if (!toldDash) { log('dashboard failed'); toldDash = true; }
      } else {
        fails++;
        if (fails === 1 || fails % 30 === 0) log('Ring sync failed');
      }
      await sleep(30000);
    }
  }
}

export function newHardwareId() {
  return randomUUID();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('ring failed');
    process.exit(1);
  });
}
