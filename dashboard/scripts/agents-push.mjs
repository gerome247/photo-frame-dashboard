// Sends AI plan usage from this PC to the dashboard's Agents tab (/api/agents). Run every few
// minutes by a systemd user timer (see the Obsidian notes), or by hand:
//
//   node scripts/agents-push.mjs          (from dashboard/)
//
// Claude: the usage limits Claude Code's /usage shows (5-hour session and weekly), read with the
// Claude Code login in ~/.claude/.credentials.json, plus tokens per day from Claude Code's logs.
// The login is only read here: it never leaves this PC and is never refreshed (Claude Code does
// that), so if it has expired the limits are skipped until Claude Code is next used.
// Grok: xAI doesn't publish subscription usage, so only the plan name (local.config.json) is sent.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DASH = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(DASH, 'local.config.json'), 'utf8'));
const key = readFileSync(join(DASH, '.dash-key'), 'utf8').trim();
const plans = cfg.agents || {};

function day(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// Tokens per local day for the last 7 days (oldest first), from Claude Code's session logs.
// Counts input + output + cache writes; cache reads are left out (they'd dwarf everything).
function claudeTokens() {
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return day(d); });
  const totals = Object.fromEntries(days.map((d) => [d, 0]));
  const since = Date.now() - 8 * 864e5, seen = new Set();
  const root = join(homedir(), '.claude', 'projects');
  const walk = (dir) => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const p = join(dir, name), st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.jsonl') && st.mtimeMs > since) {
        for (const line of readFileSync(p, 'utf8').split('\n')) {
          if (!line.includes('"usage"')) continue;
          let e;
          try { e = JSON.parse(line); } catch { continue; }
          const m = e.message, u = m && m.usage;
          if (!u || !e.timestamp) continue;
          const id = (m.id || '') + ':' + (e.requestId || ''); // streamed replies repeat the same message
          if (seen.has(id)) continue;
          seen.add(id);
          const d = day(new Date(e.timestamp));
          if (d in totals) totals[d] += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
        }
      }
    }
  };
  walk(root);
  return days.map((d) => totals[d]);
}

async function claude() {
  const out = { id: 'claude', plan: plans.claude && plans.claude.plan, tokensWeek: claudeTokens() };
  const credFile = join(homedir(), '.claude', '.credentials.json');
  if (!existsSync(credFile)) return { ...out, note: 'No Claude Code login on the PC' };
  const login = JSON.parse(readFileSync(credFile, 'utf8')).claudeAiOauth || {};
  if (!out.plan && login.subscriptionType) out.plan = login.subscriptionType.charAt(0).toUpperCase() + login.subscriptionType.slice(1);
  if (!login.accessToken || login.expiresAt < Date.now()) return { ...out, note: 'Limits update next time Claude Code is used on the PC' };
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: 'Bearer ' + login.accessToken, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'home-dashboard' },
  });
  if (!res.ok) return { ...out, note: 'Claude usage unavailable (' + res.status + ')' };
  const u = await res.json();
  const win = (w) => w && w.utilization != null ? { used: Math.round(w.utilization), resets: w.resets_at } : null;
  return {
    ...out,
    session: win(u.five_hour),
    weekly: win(u.seven_day),
    breakdown: ((u.seven_day_breakdown || {}).rows || []).filter((r) => r.percent > 0).map((r) => ({ name: r.display_name, percent: r.percent })),
  };
}

const payload = {
  agents: [
    await claude().catch((err) => ({ id: 'claude', note: 'Claude usage unavailable', error: String(err.message).slice(0, 80) })),
    { id: 'grok', plan: (plans.grok && plans.grok.plan) || 'Subscription' },
  ],
};
const res = await fetch(cfg.url.replace(/\/$/, '') + '/api/agents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: 'dash_key=' + key },
  body: JSON.stringify(payload),
});
const c = payload.agents[0];
console.log(new Date().toISOString(), 'agents push', res.status, '| Claude', c.session ? 'session ' + c.session.used + '%, weekly ' + (c.weekly || {}).used + '%' : c.note, '| tokens today', c.tokensWeek ? c.tokensWeek[6] : '?');
if (!res.ok) process.exitCode = 1;
