// One-time Hue login for the Home tab's lights. Run it yourself in a terminal:
//
//   cd dashboard && node scripts/hue-login.mjs
//
// 1. Create a Hue developer account at https://developers.meethue.com/ and add a Remote Hue API
//    app. Set its callback URL to exactly:
//
//      http://127.0.0.1:8889/callback
//
//    Keep the app's Client ID, Client secret and App ID to hand.
// 2. This script asks for those (the secret isn't echoed), opens Hue's login page, catches the
//    redirect on 127.0.0.1:8889, creates a remote bridge login, and stores HUE_CLIENT_ID,
//    HUE_CLIENT_SECRET, HUE_REFRESH_TOKEN and HUE_USERNAME as Worker secrets with wrangler.
//    Nothing is written to disk and no token is printed.
//
// The first bridge on the Hue account is the one that gets linked. Hue rotates the refresh
// token; the Worker saves the new one, so this script is only needed again if Hue asks for a
// fresh login.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const REDIRECT = 'http://127.0.0.1:8889/callback';
const HUE = 'https://api.meethue.com';

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function md5(s) { return createHash('md5').update(s).digest('hex'); }

function hueFailed(data) {
  if (Array.isArray(data)) return data.some((x) => x && x.error);
  return !!(data && data.error);
}

// Basic auth is what Hue accepts now. A portal that still challenges with digest gets one retry;
// that first 401 does not spend the code.
async function hueToken(clientId, clientSecret, params) {
  const path = '/v2/oauth2/token';
  const url = HUE + path + '?' + new URLSearchParams(params);
  const basic = 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');
  let res = await fetch(url, { method: 'POST', headers: { Authorization: basic, Accept: 'application/json' } });
  const www = res.headers.get('www-authenticate') || '';
  if (res.status === 401 && /digest/i.test(www)) {
    const realm = /realm="([^"]*)"/.exec(www);
    const nonce = /nonce="([^"]*)"/.exec(www);
    if (realm && nonce) {
      const response = md5(md5(clientId + ':' + realm[1] + ':' + clientSecret) + ':' + nonce[1] + ':' + md5('POST:' + path));
      const header = 'Digest username="' + clientId + '", realm="' + realm[1] + '", nonce="' + nonce[1] + '", uri="' + path + '", response="' + response + '"';
      res = await fetch(url, { method: 'POST', headers: { Authorization: header, Accept: 'application/json' } });
    }
  }
  return res;
}

async function hueCall(method, path, body, access) {
  const res = await fetch(HUE + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + access,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const clientId = await ask('Hue Client ID: ');
const clientSecret = await ask('Hue Client secret (hidden): ', true);
const appId = await ask('Hue App ID: ');
if (!clientId || !clientSecret || !appId || /\s/.test(clientId + clientSecret + appId)) {
  console.error('Client ID, Client secret and App ID are all required.');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const deviceId = randomBytes(8).toString('hex');
const authUrl = HUE + '/v2/oauth2/authorize?' + new URLSearchParams({
  client_id: clientId, response_type: 'code', state, appid: appId, deviceid: deviceId,
});

let code;
try {
  code = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn(value);
    };
    const server = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(ok
        ? 'Hue connected. You can close this tab and go back to the terminal.'
        : 'Login failed: ' + (u.searchParams.get('error') || 'state mismatch'));
      ok ? finish(resolve, u.searchParams.get('code')) : finish(reject, new Error(u.searchParams.get('error') || 'state mismatch'));
    });
    const timer = setTimeout(() => finish(reject, new Error('timed out')), 5 * 60 * 1000);
    server.on('error', (err) => finish(reject, err));
    server.listen(8889, '127.0.0.1', () => {
      console.log('\nOpening Hue in your browser. If it doesn\'t open, visit:\n' + authUrl + '\n');
      spawn('xdg-open', [authUrl], { stdio: 'ignore', detached: true }).on('error', () => {});
    });
  });
} catch (err) {
  console.error(err.message === 'timed out'
    ? 'No reply from Hue. The callback URL on the app must be exactly ' + REDIRECT + '.'
    : 'Login failed (' + err.message + ').');
  process.exit(1);
}

const tokenRes = await hueToken(clientId, clientSecret, { grant_type: 'authorization_code', code });
const tokens = await tokenRes.json().catch(() => ({}));
if (!tokenRes.ok || !tokens.access_token || !tokens.refresh_token) {
  console.error('Hue refused the login (' + tokenRes.status + '). Check the callback URL on the app is exactly ' + REDIRECT + '.');
  process.exit(1);
}

const link = await hueCall('PUT', '/bridge/0/config', { linkbutton: true }, tokens.access_token);
if (link.status !== 200 || hueFailed(link.data)) {
  console.error('Hue did not open the link button (' + link.status + ').');
  process.exit(1);
}
const created = await hueCall('POST', '/bridge', { devicetype: 'home-dashboard#frame' }, tokens.access_token);
const username = created.data && created.data[0] && created.data[0].success && created.data[0].success.username;
if (!username || !/^[A-Za-z0-9_-]{10,80}$/.test(username)) {
  const type = created.data && created.data[0] && created.data[0].error && created.data[0].error.type;
  console.error('Hue did not create a dashboard login' + (type ? ' (error ' + type + ')' : '') + '.');
  process.exit(1);
}

const lights = await hueCall('GET', '/bridge/' + username + '/lights', null, tokens.access_token);
if (lights.status !== 200 || hueFailed(lights.data) || !lights.data || Array.isArray(lights.data)) {
  console.error('Hue accepted the login but did not list lights (' + lights.status + ').');
  process.exit(1);
}
const count = Object.keys(lights.data).length;
console.log('Hue connected. ' + count + (count === 1 ? ' light.' : ' lights.') + ' Using the first bridge on the account.');

const config = existsSync('.wrangler.deploy.json') ? ['--config', '.wrangler.deploy.json'] : [];
for (const [name, value] of [
  ['HUE_CLIENT_ID', clientId],
  ['HUE_CLIENT_SECRET', clientSecret],
  ['HUE_REFRESH_TOKEN', tokens.refresh_token],
  ['HUE_USERNAME', username],
]) {
  execFileSync('npx', ['wrangler', 'secret', 'put', name, ...config], { input: value, stdio: ['pipe', 'ignore', 'inherit'] });
  console.log('Stored ' + name + ' in Cloudflare.');
}
console.log('Done. The Home tab picks the lights up within a minute.');
