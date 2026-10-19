// Sends AI plan usage from this PC to the dashboard's Agents tab (/api/agents). Run every few
// minutes by a systemd user timer (see the Obsidian notes), or by hand:
//
//   node scripts/agents-push.mjs          (from dashboard/)
//
// Claude: the usage limits Claude Code's /usage shows (5-hour session and weekly), read with the
// Claude Code login in ~/.claude/.credentials.json, plus tokens per day from Claude Code's logs.
// Grok Build: the weekly credit limit Grok's /usage shows, read with the login in ~/.grok/auth.json
// (the same billing call the CLI makes), plus tokens per day from each session's usage.json.
// Logins are only read here: they never leave this PC and are never refreshed (the CLIs do that),
// so if one has expired its limits are skipped until that CLI is next used.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessHeaders } from './access-token.mjs';

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

// Tokens per local day for the last 7 days, from Grok Build session usage.
// Counts uncached input + output + cache writes. Cache reads sit inside inputTokens and are
// left out, same as Claude, because they would dwarf the real work.
function grokTokens() {
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return day(d); });
  const totals = Object.fromEntries(days.map((d) => [d, 0]));
  const since = Date.now() - 8 * 864e5;
  const root = join(homedir(), '.grok', 'sessions');
  const walk = (dir) => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const p = join(dir, name), st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name === 'usage.json' && st.mtimeMs > since) {
        let d;
        try { d = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
        for (const t of d.turns || []) {
          if (!t.endedAt) continue;
          const key = day(new Date(t.endedAt));
          if (!(key in totals)) continue;
          const fresh = Math.max(0, (t.inputTokens || 0) - (t.cachedReadTokens || 0));
          totals[key] += fresh + (t.outputTokens || 0) + (t.cacheCreationTokens || 0);
        }
      }
    }
  };
  walk(root);
  return days.map((d) => totals[d]);
}

async function grok() {
  const out = { id: 'grok', plan: (plans.grok && plans.grok.plan) || 'Subscription', tokensWeek: grokTokens() };
  const credFile = join(homedir(), '.grok', 'auth.json');
  if (!existsSync(credFile)) return { ...out, note: 'No Grok Build login on the PC' };
  const entry = Object.values(JSON.parse(readFileSync(credFile, 'utf8'))).find((e) => e && e.key);
  if (!entry) return { ...out, note: 'No Grok Build login on the PC' };
  if (!entry.expires_at || Date.parse(entry.expires_at) < Date.now()) {
    return { ...out, note: 'Limits update next time Grok Build is used on the PC' };
  }
  let version = '0.0.0';
  try { version = JSON.parse(readFileSync(join(homedir(), '.grok', 'version.json'), 'utf8')).version || version; } catch { /* header is advisory */ }
  const res = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
    headers: {
      Authorization: 'Bearer ' + entry.key,
      'x-grok-client-version': version,
      'x-grok-client-surface': 'grok-build',
      'User-Agent': 'home-dashboard',
    },
  });
  if (!res.ok) return { ...out, note: 'Grok usage unavailable (' + res.status + ')' };
  const cfgB = (await res.json()).config || {};
  const period = cfgB.currentPeriod || {};
  if (cfgB.creditUsagePercent == null || !period.end) return { ...out, note: 'Grok usage unavailable' };
  const names = { GrokBuild: 'Grok Build', GrokChat: 'Grok chat' };
  return {
    ...out,
    weekly: { used: Math.round(cfgB.creditUsagePercent), resets: period.end, label: 'Weekly · credits' },
    breakdown: (cfgB.productUsage || [])
      .filter((r) => r.usagePercent > 0)
      .map((r) => ({ name: names[r.product] || r.product, percent: Math.round(r.usagePercent) })),
  };
}

const payload = {
  agents: [
    await claude().catch((err) => ({ id: 'claude', note: 'Claude usage unavailable', error: String(err.message).slice(0, 80) })),
    await grok().catch((err) => ({ id: 'grok', plan: (plans.grok && plans.grok.plan) || 'Subscription', note: 'Grok usage unavailable', error: String(err.message).slice(0, 80) })),
  ],
};
const res = await fetch(cfg.url.replace(/\/$/, '') + '/api/agents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: 'dash_key=' + key, ...accessHeaders() },
  body: JSON.stringify(payload),
});
const c = payload.agents[0], g = payload.agents[1];
console.log(new Date().toISOString(), 'agents push', res.status,
  '| Claude', c.session ? 'session ' + c.session.used + '%, weekly ' + (c.weekly || {}).used + '%' : c.note,
  '| tokens today', c.tokensWeek ? c.tokensWeek[6] : '?',
  '| Grok', g.weekly ? 'weekly ' + g.weekly.used + '%' : g.note,
  '| tokens today', g.tokensWeek ? g.tokensWeek[6] : '?');
if (!res.ok) process.exitCode = 1;
