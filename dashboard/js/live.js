// Shared live state for the Today screen: Hive (heating, lights) and Spotify's now playing,
// fetched in the background and kept in DATA.hive / DATA.nowPlaying. Emits 'live' when either
// changes. The Home and Spotify tabs still poll faster while they're open.
var D = window.DATA;
var HIVE_MS = 2 * 60 * 1000, SPOTIFY_MS = 30 * 1000;

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

function spotify() {
  return get('/api/spotify').then(function (s) {
    update('nowPlaying', s.configured && s.active ? { playing: s.playing, title: s.title, artist: s.artist, device: s.device } : null);
  }).catch(function () {});
}

hive();
spotify();
setInterval(hive, HIVE_MS);
setInterval(spotify, SPOTIFY_MS);
