# CLAUDE.md

A fork of [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard) running a family dashboard on a rooted PF1007L photo frame and an Amazon Fire HD 10 tablet. `docs/` and `scripts/` (top level) are Wes's frame guides and tools; `dashboard/` is the web app, its Cloudflare Worker and the Android kiosk. Private, per-household details are in `CLAUDE.local.md` (gitignored).

This repo is **public**. Nothing personal goes in a commit.

## Rules

- **Secrets stay local.** Never print, log, paste or commit `dashboard/.dash-key` (the site key), `dashboard/.calendars` (iCal links, treat as passwords), `dashboard/local.config.json` (names, location, URL, D1 id) or anything from `~/.claude/.credentials.json`. Spotify keys live only as Worker secrets.
- **Scan before every push.** Grep the staged diff for the key, calendar links, family names, location, the workers.dev subdomain, IDs and LAN addresses, and **print match counts only, never the matched text**. Commit or push only when the owner asks.
- **Frame writes need the owner's approval, one at a time** (eMMC, `/system`, boot). Make a verified backup first. Don't weaken hash/size/sector guards in Wes's scripts. Don't publish serials, MACs, dumps or whole-eMMC hashes (`backups/`, `diagnostics/` are ignored).
- **Keep vendor remote access off.** AiMOR (`com.efercro.os.aimor`) gives the vendor a root shell on TCP 7806; it, the OTA updater (`com.yhk.qeota`) and `com.DeviceTest` stay disabled.
- **People use the screens.** Before sending `adb shell input` taps, take a screenshot and check nobody is mid-use. Don't start music, tick chores or change lists as a test without saying so, and undo test data afterwards.
- New npm dependencies: pin an exact version at least two weeks old.

## Layout

| Path | What |
| --- | --- |
| `dashboard/src/worker.js` | Cloudflare Worker: key gate (`?key=` → HttpOnly cookie, else 404) in front of everything, plus `/api/data` (weather, iCal), `/api/shopping`, `/api/chores`, `/api/spotify*`, `/api/agents` |
| `dashboard/js/` | Dashboard (Vite, plain JS). `main.js` loads data then views; stores: `shopping-store.js`, `chores-store.js`; `print-list.js`; `chore-icons.js` (Lucide) |
| `dashboard/js/views/` | One file per tab: home (Today), calendar, tasks (Chores), shopping, photos, control (Home), agents, spotify |
| `dashboard/kiosk/` | Android kiosk app (no Gradle): full-screen WebView, offline screen, controls menu, Home alias, `IppPrinter.java` (network printing) |
| `dashboard/scripts/` | `deploy.mjs`, `build-photos.mjs`, `spotify-login.mjs`, `agents-push.mjs` |
| `dashboard/local.config.example.json` | Template for the private `local.config.json` |

Storage: one D1 database (binding `SHOPPING`, added at deploy time by `deploy.mjs` from `local.config.json` → gitignored `.wrangler.deploy.json`). Tables `shopping`, `chores`, `chore_done` (one row per chore per day), `kv` (agents numbers, rotated Spotify token). Tables are created on first use.

## Commands

All from `dashboard/`:

```bash
npm run deploy                 # build photos + vite build + wrangler deploy (with vars and D1 binding)
npx vite build                 # build check only

# Kiosk APK (JDK 17 via mise, Android SDK in ~/Android/Sdk); one build for both devices
cd kiosk && JAVA_HOME=$(mise where java@temurin-17) ANDROID_HOME=$HOME/Android/Sdk bash build.sh
~/Android/Sdk/platform-tools/adb -d install -r build/homehq.apk

node scripts/spotify-login.mjs   # owner runs it in their own terminal (asks for Client ID/secret)
node scripts/agents-push.mjs     # also run every 5 min by the user timer home-dashboard-agents.timer

npx wrangler d1 execute home-dashboard-shopping --remote --config .wrangler.deploy.json --command "SELECT ..."
```

API checks: `curl -b "dash_key=$(tr -d '\n' < .dash-key)" <url>/api/...` with the URL from `local.config.json`, piping JSON through Python so the key never reaches the output.

## Frame and kiosk gotchas

- **WebView 106** on the PF1007L (Android 6). No CSS nesting, `:has()`, `color-mix()` or `oklch()`. Test layouts at 1280×800.
- **Big canvases**: the frame's GPU canvas loses its blue channel at A4 size (white turns yellow, text vanishes). Use `getContext('2d', { willReadFrequently: true })`.
- **Touch**: the `gslX680` panel merges two nearby fingers into one. The controls menu also opens with one finger held 3 s on the top-left corner.
- **Kiosk min SDK 22**: the Fire tablet runs Android 5.1. Avoid API 23 calls (e.g. `checkSelfPermission`; use `checkPermission`).
- **Printing** (`IppPrinter.java`): DNS-SD needs a `WifiManager.MulticastLock`; IPP Print-Job with `image/jpeg` (many printers accept no PDF over IPP).
- **Old trust store**: the frame lacks newer roots (ISRG X1, GTS R1/R4 were added). Third-party images go through the Worker (e.g. `/api/spotify/art`).
- **Screenshots**: `adb -d exec-out screencap -p > file.png`. To inspect the page, launch the kiosk with `--ez debug true`, `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, and use the DevTools protocol.
- Keep the error page from showing the URL: it contains the key. Don't use the kiosk's `--es url` with the keyed URL (it's logged).

## Worker and API limits

- Cloudflare free plan: 10 ms CPU per request. Heavy parsing (iCal) happens on the screen, not the Worker.
- Spotify development mode: max 10 items per request (page them), no artist top tracks, no items of playlists the user doesn't own, no recommendations. 403 on those is expected, not a scope problem.
- The Claude usage endpoint (`api.anthropic.com/api/oauth/usage`) is Claude Code's own, undocumented; `agents-push.mjs` only reads the login and never refreshes it.
