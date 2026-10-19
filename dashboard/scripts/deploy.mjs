// `npm run deploy`: wrangler deploy, adding the private settings from the gitignored
// local.config.json so they aren't committed in wrangler.jsonc:
// - the weather location, as Worker vars
// - Cloudflare Access, as Worker vars, from "access": { "teamDomain": "<team>.cloudflareaccess.com",
//   "aud": "<application AUD tag>" }. Add it only once Access is on: from then on the Worker
//   refuses any request Access hasn't signed
// - the shopping list's D1 database (shoppingDatabaseId), as the SHOPPING binding, via a
//   generated config next to wrangler.jsonc (.wrangler.deploy.json, also gitignored)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const cfg = existsSync('local.config.json') ? JSON.parse(readFileSync('local.config.json', 'utf8')) : {};
const loc = cfg.location || {};
const vars = [];
if (loc.latitude != null && loc.longitude != null) {
  vars.push('--var', `LATITUDE:${loc.latitude}`, '--var', `LONGITUDE:${loc.longitude}`);
  if (loc.timezone) vars.push('--var', `TIMEZONE:${loc.timezone}`);
} else {
  console.warn('deploy: no location in local.config.json, so the dashboard keeps its demo weather');
}

const access = cfg.access || {};
if (access.teamDomain && access.aud) {
  vars.push('--var', `ACCESS_TEAM_DOMAIN:${access.teamDomain}`, '--var', `ACCESS_AUD:${access.aud}`);
} else if (access.teamDomain || access.aud) {
  throw new Error('deploy: access in local.config.json needs both teamDomain and aud');
}

const config = [];
if (cfg.shoppingDatabaseId) {
  // wrangler.jsonc allows comments; drop whole-line ones before parsing.
  const base = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  base.d1_databases = [{ binding: 'SHOPPING', database_name: 'home-dashboard-shopping', database_id: cfg.shoppingDatabaseId }];
  writeFileSync('.wrangler.deploy.json', JSON.stringify(base, null, 2) + '\n');
  config.push('--config', '.wrangler.deploy.json');
} else {
  console.warn('deploy: no shoppingDatabaseId in local.config.json, so the shopping list is not saved');
}

execFileSync('npx', ['wrangler', 'deploy', ...config, ...vars, ...process.argv.slice(2)], { stdio: 'inherit' });
