// One-time Spotify login for the dashboard's Now Playing card. Run it yourself in a terminal:
//
//   cd dashboard && node scripts/spotify-login.mjs
//
// 1. Create an app at https://developer.spotify.com/dashboard (Web API), with the redirect URI
//    http://127.0.0.1:8888/callback, and keep its Client ID and Client secret to hand.
// 2. This script asks for both (the secret isn't echoed), opens Spotify's login page in your
//    browser, catches the redirect on 127.0.0.1:8888, swaps the code for a refresh token, and
//    stores SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN as Worker secrets
//    with wrangler. Nothing is written to disk and no token is printed.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const REDIRECT = 'http://127.0.0.1:8888/callback';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing ' +
  'playlist-read-private playlist-read-collaborative user-library-read user-read-recently-played';

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

const clientId = await ask('Spotify Client ID: ');
const clientSecret = await ask('Spotify Client secret (hidden): ', true);
if (!/^[0-9a-f]{32}$/i.test(clientId) || !/^[0-9a-f]{32}$/i.test(clientSecret)) {
  console.error('Those don\'t look like a Spotify Client ID and secret (32 hex characters each).');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
  response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: REDIRECT, state,
});

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
    const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? 'Spotify connected. You can close this tab and go back to the terminal.' : 'Login failed: ' + (u.searchParams.get('error') || 'state mismatch'));
    server.close();
    ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error') || 'state mismatch'));
  });
  server.listen(8888, '127.0.0.1', () => {
    console.log('\nOpening Spotify in your browser. If it doesn\'t open, visit:\n' + authUrl + '\n');
    spawn('xdg-open', [authUrl], { stdio: 'ignore', detached: true }).on('error', () => {});
  });
});

const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }),
});
if (!tokenRes.ok) {
  console.error('Spotify refused the login (' + tokenRes.status + '). Check the redirect URI in your Spotify app.');
  process.exit(1);
}
const tokens = await tokenRes.json();
const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } }).then((r) => r.json());
console.log('Logged in as ' + (me.display_name || me.id) + (me.product ? ' (' + me.product + ')' : '') + '.');
if (me.product && me.product !== 'premium') console.log('Note: play/pause/skip need Premium; Now Playing will still show.');

// The deploy config (scripts/deploy.mjs) when there is one, so wrangler sees the same Worker.
const config = existsSync('.wrangler.deploy.json') ? ['--config', '.wrangler.deploy.json'] : [];
for (const [name, value] of [['SPOTIFY_CLIENT_ID', clientId], ['SPOTIFY_CLIENT_SECRET', clientSecret], ['SPOTIFY_REFRESH_TOKEN', tokens.refresh_token]]) {
  execFileSync('npx', ['wrangler', 'secret', 'put', name, ...config], { input: value, stdio: ['pipe', 'ignore', 'inherit'] });
  console.log('Stored ' + name + ' in Cloudflare.');
}
console.log('Done. The dashboard picks it up straight away.');
