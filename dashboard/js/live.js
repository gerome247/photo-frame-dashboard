// Shared live state for the Today screen: Hive, Hue, Heatmiser underfloor and Spotify.
// Kept in DATA.hive / DATA.hue / DATA.neo / DATA.nowPlaying. Emits 'live' when one changes.
// The Home and Spotify tabs still poll faster while they're open.
// Hue sync is on. scripts/hue-bridge.mjs posts about every 30 seconds. Set this false,
// and HUE_SYNC false in src/worker.js, to pause it again.
window.HUE_SYNC = true;
var D = window.DATA;
var HIVE_MS = 2 * 60 * 1000, HUE_MS = 2 * 60 * 1000, NEO_MS = 2 * 60 * 1000, SPOTIFY_MS = 30 * 1000;

function get(path) {
  return fetch(path, { cache: 'no-store' }).then(function (r) { return r.json(); });
}

function update(key, value) {
  if (JSON.stringify(D[key]) === JSON.stringify(value)) return;
  D[key] = value;
  window.App.emit('live', key);
}

function hive() {
  return get('/api/hive').then(function (s) {
    if (s.error && D.hive && D.hive.heating) return; // keep the last good reading through a blip
    update('hive', s);
  }).catch(function () {});
}

function hue() {
  return get('/api/hue').then(function (s) {
    if (s.error && D.hue && D.hue.lights) return; // keep the last good reading through a blip
    update('hue', s);
  }).catch(function () { if (!D.hue) update('hue', { configured: false }); });
}

function neo() {
  return get('/api/neohub').then(function (s) {
    if (s.error && D.neo && D.neo.zones) return; // keep the last good reading through a blip
    update('neo', s);
  }).catch(function () { if (!D.neo) update('neo', { configured: false }); });
}

function spotify() {
  return get('/api/spotify').then(function (s) {
    update('nowPlaying', s.configured && s.active ? { playing: s.playing, title: s.title, artist: s.artist, device: s.device } : null);
  }).catch(function () {});
}

hive();
neo();
spotify();
if (window.HUE_SYNC) {
  hue();
  setInterval(hue, HUE_MS);
} else {
  update('hue', { configured: false });
}
setInterval(hive, HIVE_MS);
setInterval(neo, NEO_MS);
setInterval(spotify, SPOTIFY_MS);
