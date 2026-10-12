// `npm run deploy`: wrangler deploy, passing the weather location from the gitignored
// local.config.json as Worker vars, so it isn't committed in wrangler.jsonc.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const cfg = existsSync('local.config.json') ? JSON.parse(readFileSync('local.config.json', 'utf8')) : {};
const loc = cfg.location || {};
const vars = [];
if (loc.latitude != null && loc.longitude != null) {
  vars.push('--var', `LATITUDE:${loc.latitude}`, '--var', `LONGITUDE:${loc.longitude}`);
  if (loc.timezone) vars.push('--var', `TIMEZONE:${loc.timezone}`);
} else {
  console.warn('deploy: no location in local.config.json, so the dashboard keeps its demo weather');
}

execFileSync('npx', ['wrangler', 'deploy', ...vars, ...process.argv.slice(2)], { stdio: 'inherit' });
