// Syncs this LAN's Hue bridge to the dashboard. The frame and the Worker cannot reach the
// bridge, so this process holds the username from the link button and pushes light state.
// The username lives only in .hue-key (mode 600). Nothing from the bridge is printed.
//
//   node scripts/hue-bridge.mjs     (from dashboard/, or the home-dashboard-hue user service)
//
// Until .hue-key exists it asks the bridge every couple of seconds. Press the round button
// on the bridge once. After that it reads lights about every 30 seconds and applies queued
// dashboard commands. The 30 second pause keeps the dashboard inside the Cloudflare free caps.
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accessHeaders } from './access-token.mjs';

const DASH = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = join(DASH, '.hue-key');
const SYNC_MS = 30000;
const RANK = { Room: 0, Zone: 1, LightGroup: 2 };

export function mapState(lights, groups) {
  const roomOf = {};
  const rankOf = {};
  Object.entries(groups || {}).forEach(([id, g]) => {
    const rank = g && RANK[g.type];
    if (!/^[0-9]{1,6}$/.test(id) || rank == null || !Array.isArray(g.lights)) return;
    const room = label(g.name) || 'Room';
    g.lights.forEach((lid) => {
      const key = String(lid);
      if (rankOf[key] == null || rank < rankOf[key]) {
        rankOf[key] = rank;
        roomOf[key] = { roomId: id, room };
      }
    });
  });
  const list = [];
  Object.entries(lights || {}).forEach(([id, l]) => {
    if (list.length >= 200) return;
    if (!/^[0-9]{1,6}$/.test(id) || !l || !l.state) return;
    const on = !!l.state.on;
    const online = l.state.reachable !== false;
    let brightness = on ? 100 : 0;
    if (l.state.bri != null && l.state.bri !== '') {
      brightness = Math.round(Number(l.state.bri) / 254 * 100);
      if (on && brightness < 1) brightness = 1;
      brightness = Math.max(0, Math.min(100, brightness));
    }
    const room = roomOf[id] || { room: 'Hue', roomId: 'other' };
    list.push({
      id,
      name: label(l.name) || 'Light',
      on: online && on,
      brightness,
      room: room.room,
      roomId: room.roomId,
      online,
    });
  });
  list.sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : Number(a.id) - Number(b.id)));
  return { configured: true, lights: list };
}

function label(v) {
  return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32);
}

function validUser(s) {
  return /^[A-Za-z0-9_-]{10,80}$/.test(s);
}

function validIp(ip) {
  return typeof ip === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every((n) => Number(n) <= 255);
}

function log(msg) {
  console.log(new Date().toISOString(), msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadDash() {
  const cfg = JSON.parse(readFileSync(join(DASH, 'local.config.json'), 'utf8'));
  const key = readFileSync(join(DASH, '.dash-key'), 'utf8').trim();
  const url = String(cfg.url || '').replace(/\/$/, '');
  if (!url || !key) throw new Error('config');
  return { url, key };
}

let bridgeIp = '';
let bridgeIpAt = 0;

async function bridgeAddress(force) {
  if (!force && bridgeIp && Date.now() - bridgeIpAt < 60000) return bridgeIp;
  const res = await fetch('https://discovery.meethue.com/', { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('discovery');
  const list = await res.json();
  const ip = Array.isArray(list) && list[0] && list[0].internalipaddress;
  if (!validIp(ip)) throw new Error('discovery');
  bridgeIp = ip;
  bridgeIpAt = Date.now();
  return ip;
}

function clipType(data) {
  if (Array.isArray(data)) {
    const row = data.find((x) => x && x.error);
    return row ? row.error.type : null;
  }
  if (data && data.error && data.error.type != null) return data.error.type;
  return null;
}

async function bridgeJson(ip, path, opts) {
  const res = await fetch('http://' + ip + path, {
    method: (opts && opts.method) || 'GET',
    headers: opts && opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts && opts.body,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error('not json'); }
  if (!res.ok) throw new Error('http');
  const clip = clipType(data);
  if (clip != null) {
    const err = new Error('clip');
    err.clip = clip;
    throw err;
  }
  return data;
}

async function pair(ip) {
  const data = await bridgeJson(ip, '/api', {
    method: 'POST',
    body: JSON.stringify({ devicetype: 'home-dashboard#frame' }),
  }).catch((err) => {
    if (err.clip === 101) return null;
    throw err;
  });
  const row = Array.isArray(data) ? data[0] : null;
  const user = row && row.success && row.success.username;
  return validUser(user) ? user : null;
}

function readUser() {
  if (!existsSync(KEY_FILE)) return '';
  const user = readFileSync(KEY_FILE, 'utf8').trim();
  return validUser(user) ? user : '';
}

function writeUser(user) {
  writeFileSync(KEY_FILE, user + '\n', { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
}

async function waitForUser() {
  log('waiting for the Hue link button');
  while (true) {
    let ip;
    try { ip = await bridgeAddress(false); } catch {
      bridgeIp = '';
      await sleep(5000);
      continue;
    }
    try {
      const user = await pair(ip);
      if (user) return user;
    } catch {
      bridgeIp = '';
      await sleep(5000);
      continue;
    }
    await sleep(2000);
  }
}

async function readBridge(ip, user) {
  const base = '/api/' + encodeURIComponent(user);
  const lights = await bridgeJson(ip, base + '/lights');
  const groups = await bridgeJson(ip, base + '/groups');
  return mapState(lights, groups);
}

function bri(level) {
  return Math.max(1, Math.min(254, Math.round(Number(level) / 100 * 254)));
}

async function applyCommand(ip, user, cmd) {
  const base = '/api/' + encodeURIComponent(user);
  if (cmd.action === 'allOff') {
    try {
      await bridgeJson(ip, base + '/groups/0/action', { method: 'PUT', body: JSON.stringify({ on: false }) });
    } catch (err) {
      if (err.clip === 1) throw err;
      const lights = await bridgeJson(ip, base + '/lights');
      for (const id of Object.keys(lights || {})) {
        if (!/^[0-9]{1,6}$/.test(id) || !lights[id] || !lights[id].state || !lights[id].state.on) continue;
        await bridgeJson(ip, base + '/lights/' + id + '/state', { method: 'PUT', body: JSON.stringify({ on: false }) });
      }
    }
    return;
  }
  if (cmd.action !== 'light' || !/^[0-9]{1,6}$/.test(String(cmd.light || ''))) return;
  const state = { on: !!cmd.on };
  if (cmd.on && cmd.brightness != null) state.bri = bri(cmd.brightness);
  await bridgeJson(ip, base + '/lights/' + cmd.light + '/state', { method: 'PUT', body: JSON.stringify(state) });
}

async function push(dash, state, ack) {
  const res = await fetch(dash.url + '/api/hue/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'dash_key=' + dash.key, ...accessHeaders() },
    body: JSON.stringify({ state, ack }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('dashboard');
  const data = await res.json();
  return Array.isArray(data.commands) ? data.commands : [];
}

async function main() {
  const dash = loadDash();
  let user = readUser();
  if (!user) {
    user = await waitForUser();
    writeUser(user);
    log('bridge paired');
  }
  log('syncing');
  let fails = 0;
  let denied = 0;
  let lastCount = -1;
  while (true) {
    try {
      const ip = await bridgeAddress(false);
      let state = await readBridge(ip, user);
      const commands = await push(dash, state, []);
      const acked = [];
      for (const cmd of commands) {
        try {
          await applyCommand(ip, user, cmd);
          acked.push(cmd.id);
        } catch (err) {
          if (err.clip === 1) throw err;
          if (err.clip === 3 && cmd.id) acked.push(cmd.id);
        }
      }
      if (acked.length) {
        state = await readBridge(ip, user);
        await push(dash, state, acked);
      }
      if (fails || state.lights.length !== lastCount) log('synced ' + state.lights.length + ' lights');
      fails = 0;
      denied = 0;
      lastCount = state.lights.length;
      await sleep(SYNC_MS);
    } catch (err) {
      bridgeIp = '';
      if (err.clip === 1) {
        denied++;
        if (denied >= 3) {
          try { unlinkSync(KEY_FILE); } catch { /* already gone */ }
          user = await waitForUser();
          writeUser(user);
          log('bridge paired');
          denied = 0;
          fails = 0;
          continue;
        }
      }
      fails++;
      if (fails === 1 || fails % 30 === 0) log('bridge sync failed (' + fails + ')');
      await sleep(SYNC_MS);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('hue bridge failed');
    process.exit(1);
  });
}
