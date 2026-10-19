// Syncs a Heatmiser neoHub on this LAN to the dashboard. The frame and the Worker cannot
// reach the hub, so this process reads it and posts zone state. A token from the Heatmiser
// app (Settings, API, +) lives only in .neohub-token (mode 600). Nothing from the hub is printed.
//
//   node scripts/neohub.mjs     (from dashboard/, or the home-dashboard-neohub user service)
//
// Port 4242 is the older API and needs no token, once the app has it open. Port 4243 is the
// encrypted API and needs the token file. Until one of those is usable it waits and retries.
import { createHash, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accessHeaders } from './access-token.mjs';

const DASH = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_FILE = join(DASH, '.neohub-token');
const TOKEN_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CACHE_MS = 10 * 60 * 1000;

export function mapLive(data) {
  if (!data || typeof data !== 'object' || data.error || data.ERROR) fail('rejected');
  const list = devicesOf(data);
  if (!list) fail('live');
  const zones = [];
  const seen = new Set();
  for (const d of list) {
    if (zones.length >= 40) break;
    if (!d || typeof d !== 'object') continue;
    const thermostat = d.THERMOSTAT ?? d.thermostat;
    const timeclock = d.TIMECLOCK === true || d.timeclock === true || d.TIME_CLOCK === true;
    if (thermostat === false) continue;
    if (timeclock && thermostat !== true) continue;
    const id = String(d.DEVICE_ID ?? d.device_id ?? '');
    if (!/^[0-9]{1,8}$/.test(id) || seen.has(id)) continue;
    const name = label(d.ZONE_NAME ?? d.zone_name ?? d.device ?? d.name);
    if (!name) continue;
    const current = temp(d.ACTUAL_TEMP ?? d.CURRENT_TEMPERATURE ?? d.temperature);
    const target = temp(d.SET_TEMP ?? d.CURRENT_SET_TEMPERATURE ?? d.set_temp);
    if (current == null && target == null) continue;
    seen.add(id);
    const offline = !!(d.OFFLINE ?? d.offline);
    zones.push({
      id,
      name,
      current,
      target,
      heating: !offline && !!(d.HEAT_ON ?? d.HEATING ?? d.heat_on),
      frost: !!(d.STANDBY ?? d.standby),
      offline,
      away: !!(d.AWAY ?? d.away),
    });
  }
  zones.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : Number(a.id) - Number(b.id)));
  return { configured: true, zones };
}

function devicesOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.devices)) return data.devices;
  if (Array.isArray(data.DEVICES)) return data.DEVICES;
  const bag = data.devices || data.DEVICES;
  if (bag && typeof bag === 'object') return Object.values(bag);
  return null;
}

function label(v) {
  return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
}

function temp(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n) || n < -10 || n > 60) return null;
  return Math.round(n * 10) / 10;
}

function fail(code) {
  const err = new Error(code);
  err.code = code;
  throw err;
}

function validIp(ip) {
  return typeof ip === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every((n) => Number(n) <= 255);
}

function isPrivate(ip) {
  const p = ip.split('.').map(Number);
  return p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
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
  if (!url || !key) fail('config');
  return { url, key };
}

function privatePrefixes() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) {
      if (n.internal || n.family !== 'IPv4') continue;
      if (validIp(n.address) && isPrivate(n.address)) out.push(n.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...new Set(out)];
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 300 });
    const done = (ok) => {
      try { s.destroy(); } catch { /* already closed */ }
      resolve(ok);
    };
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

function hubseek() {
  return new Promise((resolve) => {
    const found = [];
    let sock;
    const finish = () => {
      clearTimeout(timer);
      try { sock.close(); } catch { /* not open */ }
      resolve(found);
    };
    const timer = setTimeout(finish, 800);
    try {
      sock = dgram.createSocket('udp4');
    } catch {
      finish();
      return;
    }
    sock.on('error', () => {});
    sock.on('message', (msg) => {
      try {
        const j = JSON.parse(msg.toString('utf8'));
        if (validIp(j.ip) && isPrivate(j.ip)) found.push(j.ip);
      } catch { /* not a hub reply */ }
    });
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch { /* broadcast may be blocked */ }
      const buf = Buffer.from('hubseek');
      try { sock.send(buf, 19790, '255.255.255.255'); } catch { /* ignore */ }
      for (const pre of privatePrefixes()) {
        try { sock.send(buf, 19790, pre + '.255'); } catch { /* ignore */ }
      }
    });
  });
}

let cached = null;

async function findHub(force) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    if (await portOpen(cached.ip, cached.port)) return cached;
    cached = null;
  }
  const hinted = new Set(await hubseek());
  const hosts = [];
  const seen = new Set();
  const add = (h) => {
    if (seen.has(h) || !validIp(h) || !isPrivate(h)) return;
    seen.add(h);
    hosts.push(h);
  };
  for (const h of hinted) add(h);
  for (const pre of privatePrefixes()) for (let i = 1; i <= 254; i++) add(pre + '.' + i);
  const legacy = [];
  const secure = [];
  let idx = 0;
  async function worker() {
    while (idx < hosts.length) {
      const h = hosts[idx++];
      const [a, b] = await Promise.all([portOpen(h, 4242), portOpen(h, 4243)]);
      if (a) legacy.push(h);
      else if (b) secure.push(h);
    }
  }
  await Promise.all(Array.from({ length: 40 }, worker));
  const pick = (list) => list.find((h) => hinted.has(h)) || list.slice().sort()[0];
  const old = pick(legacy);
  const next = old ? { ip: old, port: 4242, at: Date.now() } : null;
  const neu = pick(secure);
  cached = next || (neu ? { ip: neu, port: 4243, at: Date.now() } : null);
  return cached;
}

function readToken() {
  if (!existsSync(TOKEN_FILE)) return '';
  try {
    const token = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (!TOKEN_RE.test(token)) return '';
    try { chmodSync(TOKEN_FILE, 0o600); } catch { /* the file stays as the owner left it */ }
    return token;
  } catch {
    return '';
  }
}

function encodeFrame(payload, opcode) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const mask = randomBytes(4);
  const masked = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ mask[i % 4];
  let head;
  if (body.length < 126) head = Buffer.from([opcode, 0x80 | body.length]);
  else if (body.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = opcode;
    head[1] = 0x80 | 126;
    head.writeUInt16BE(body.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = opcode;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([head, mask, masked]);
}

// Pulls complete server frames out of buf. Returns null when the first frame is still short.
function takeFrame(buf) {
  if (buf.length < 2) return null;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const n = buf.readBigUInt64BE(2);
    if (n > 1000000n) fail('big');
    len = Number(n);
    off = 10;
  }
  const masked = (buf[1] & 0x80) !== 0;
  if (buf.length < off + (masked ? 4 : 0) + len) return null;
  let payload = buf.subarray(off + (masked ? 4 : 0), off + (masked ? 4 : 0) + len);
  if (masked) {
    const mask = buf.subarray(off, off + 4);
    const copy = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) copy[i] = payload[i] ^ mask[i % 4];
    payload = copy;
  }
  return {
    fin: (buf[0] & 0x80) !== 0,
    opcode: buf[0] & 0x0f,
    payload,
    rest: buf.subarray(off + (masked ? 4 : 0) + len),
  };
}

function wsCall(ip, token, command, port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buf = Buffer.alloc(0);
    let stage = 'handshake';
    let acc = Buffer.alloc(0);
    const sock = tls.connect({
      host: ip,
      port: port || 4243,
      rejectUnauthorized: false,
      servername: 'neohub',
    });
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* already closed */ }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('timeout'), { code: 'timeout' })), 8000);
    const key = randomBytes(16).toString('base64');
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    const acceptRe = new RegExp('sec-websocket-accept:\\s*' + accept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    sock.on('secureConnect', () => {
      sock.write([
        'GET / HTTP/1.1',
        'Host: ' + ip + ':' + (port || 4243),
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: ' + key,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        if (stage === 'handshake') {
          const end = buf.indexOf('\r\n\r\n');
          if (end < 0) return;
          const head = buf.subarray(0, end).toString('latin1');
          buf = buf.subarray(end + 4);
          const ok = /^HTTP\/1\.1 101/i.test(head) && acceptRe.test(head);
          if (!ok) return finish(Object.assign(new Error('handshake'), { code: 'handshake' }));
          stage = 'open';
          const middle = JSON.stringify({ token, COMMANDS: [{ COMMAND: command, COMMANDID: 1 }] });
          sock.write(encodeFrame(JSON.stringify({ message_type: 'hm_get_command_queue', message: middle }), 0x81));
        }
        while (stage === 'open') {
          const frame = takeFrame(buf);
          if (!frame) return;
          buf = frame.rest;
          if (frame.opcode === 9) {
            sock.write(encodeFrame(frame.payload, 0x8a));
            continue;
          }
          if (frame.opcode === 8) return finish(Object.assign(new Error('closed'), { code: 'closed' }));
          if (frame.opcode === 1) acc = Buffer.alloc(0);
          if (frame.opcode === 1 || frame.opcode === 0) {
            acc = Buffer.concat([acc, frame.payload]);
            if (frame.fin) {
              let msg = null;
              try { msg = JSON.parse(acc.toString('utf8')); } catch { return finish(Object.assign(new Error('not json'), { code: 'live' })); }
              return finish(null, msg);
            }
          }
        }
      } catch (err) {
        finish(err.code ? err : Object.assign(new Error('live'), { code: 'live' }));
      }
    });
    sock.on('error', () => finish(Object.assign(new Error('tls'), { code: 'tls' })));
  });
}

function unwrap(msg) {
  if (!msg || msg.message_type !== 'hm_set_command_response') fail('live');
  const raw = msg.response;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { fail('live'); }
  }
  if (raw && typeof raw === 'object') return raw;
  fail('live');
}

function legacyCall(ip, payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buf = Buffer.alloc(0);
    const sock = net.connect({ host: ip, port: 4242, timeout: 8000 });
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* already closed */ }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('timeout'), { code: 'timeout' })), 8000);
    const parse = (text) => {
      try { finish(null, JSON.parse(text)); } catch { finish(Object.assign(new Error('not json'), { code: 'live' })); }
    };
    sock.on('connect', () => sock.write(JSON.stringify(payload) + '\0'));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const z = buf.indexOf(0);
      if (z >= 0) parse(buf.subarray(0, z).toString('utf8'));
    });
    sock.on('end', () => {
      if (settled) return;
      const z = buf.indexOf(0);
      parse((z >= 0 ? buf.subarray(0, z) : buf).toString('utf8').trim());
    });
    sock.on('timeout', () => finish(Object.assign(new Error('timeout'), { code: 'timeout' })));
    sock.on('error', () => finish(Object.assign(new Error('tcp'), { code: 'tcp' })));
  });
}

export async function hubRequest(ip, opts) {
  if (opts.port === 4242) return legacyCall(ip, opts.command);
  const command = typeof opts.command === 'string' ? opts.command : JSON.stringify(opts.command);
  return unwrap(await wsCall(ip, opts.token, command, opts.port));
}

function half(n) {
  const v = Math.round(Number(n) * 2) / 2;
  if (!(v >= 5 && v <= 35)) return null;
  return v;
}

async function applyCommand(hub, token, cmd) {
  if (!cmd || typeof cmd.name !== 'string' || !cmd.name || !/^[0-9]{1,8}$/.test(String(cmd.zone || ''))) return;
  let command = null;
  if (cmd.action === 'target') {
    const target = half(cmd.target);
    if (target == null) return;
    command = { SET_TEMP: [target, cmd.name] };
  } else if (cmd.action === 'frost') {
    command = { [cmd.on ? 'FROST_ON' : 'FROST_OFF']: cmd.name };
  } else return;
  const data = hub.port === 4242
    ? await legacyCall(hub.ip, command)
    : unwrap(await wsCall(hub.ip, token, JSON.stringify(command)));
  if (data && (data.error || data.ERROR)) fail('rejected');
  const result = data && (data.result || data.RESULT);
  if (typeof result === 'string' && result && !/set|frost|off|on|ok|success/i.test(result)) fail('rejected');
}

async function readLive(hub, token) {
  const data = hub.port === 4242
    ? await legacyCall(hub.ip, { GET_LIVE_DATA: 0 })
    : unwrap(await wsCall(hub.ip, token, "{'GET_LIVE_DATA':0}"));
  return mapLive(data);
}

async function push(dash, state, ack) {
  const res = await fetch(dash.url + '/api/neohub/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'dash_key=' + dash.key, ...accessHeaders() },
    body: JSON.stringify({ state, ack }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) fail('dashboard');
  const data = await res.json();
  return Array.isArray(data.commands) ? data.commands : [];
}

async function main() {
  const dash = loadDash();
  log('syncing');
  let fails = 0;
  let lastCount = -1;
  let toldToken = false;
  let toldHub = false;
  let toldPort = 0;
  while (true) {
    try {
      const hub = await findHub(false);
      if (!hub) {
        if (!toldHub) { log('waiting for a neoHub'); toldHub = true; }
        await sleep(5000);
        continue;
      }
      toldHub = false;
      if (hub.port !== toldPort) {
        log('neoHub on port ' + hub.port);
        toldPort = hub.port;
      }
      let token = '';
      if (hub.port === 4243) {
        token = readToken();
        if (!token) {
          // The app can open the older port from the same API screen. That needs no token.
          if (await portOpen(hub.ip, 4242)) {
            cached = { ip: hub.ip, port: 4242, at: Date.now() };
            continue;
          }
          if (!toldToken) { log('waiting for a Heatmiser API token'); toldToken = true; }
          await sleep(5000);
          continue;
        }
      }
      toldToken = false;
      let state = await readLive(hub, token);
      const commands = await push(dash, state, []);
      const acked = [];
      for (const cmd of commands) {
        try {
          await applyCommand(hub, token, cmd);
          if (cmd.id) acked.push(cmd.id);
        } catch (err) {
          if (err && err.code === 'rejected' && cmd.id) acked.push(cmd.id);
          else throw err;
        }
      }
      if (acked.length) {
        state = await readLive(hub, token);
        await push(dash, state, acked);
      }
      if (fails || state.zones.length !== lastCount) log('synced ' + state.zones.length + ' zones');
      fails = 0;
      lastCount = state.zones.length;
      await sleep(5000);
    } catch (err) {
      const code = err && err.code;
      if (code !== 'rejected' && code !== 'timeout') cached = null;
      fails++;
      if (fails === 1 || fails % 30 === 0) {
        log(code === 'rejected' ? 'Heatmiser rejected the API token' : code === 'timeout' ? 'neoHub did not answer' : 'neoHub sync failed (' + fails + ')');
      }
      await sleep(Math.min(30000, 2000 * Math.min(fails, 8)));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('neoHub failed');
    process.exit(1);
  });
}
