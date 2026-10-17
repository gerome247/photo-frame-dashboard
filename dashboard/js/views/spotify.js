// Spotify: a remote for the family's Spotify account (Worker /api/spotify*). Music plays on the
// account's devices (phones, speakers, laptop); this tab shows and steers it.
// Left: now playing. Right: Library (playlists, liked, albums, recent), Search, Queue, Devices.
(function () {
  'use strict';
  var V = {
    el: null, sp: null, tab: 'library', lib: 'playlists', detail: null, query: '',
    lists: {}, busy: false, poll: null, tick: null, at: 0, searchTimer: null
  };

  function esc(s) { return App.esc(s == null ? '' : String(s)); }
  function mmss(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function img(src, cls) {
    return src ? '<img class="' + cls + '" src="' + esc(src) + '" alt="" loading="lazy">' : '<div class="' + cls + ' sp-noart">' + App.icon('music', 28) + '</div>';
  }

  // ------------------------------------------------------------ data
  function api(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function command(body, quiet) {
    if (V.busy) return Promise.resolve();
    V.busy = true;
    return fetch('/api/spotify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        V.busy = false;
        if (s.error && s.configured === undefined) { App.toast(esc(s.error), { icon: 'music', ms: 4500 }); return; }
        setState(s);
        if (!quiet && V.tab === 'queue') loadList('queue', true);
      })
      .catch(function () { V.busy = false; App.toast('Couldn’t reach Spotify', { icon: 'music', ms: 4000 }); });
  }
  function setState(s) {
    if (!s) return;
    V.sp = s;
    V.at = Date.now();
    paintNow();
  }
  function fetchState() { return api('/api/spotify').then(setState).catch(function () {}); }

  function listKey(kind, id, q) { return kind + (id ? ':' + id : '') + (q ? ':' + q : ''); }
  function loadList(kind, force, id, q) {
    var key = listKey(kind, id, q);
    if (V.lists[key] && !force) { paintSide(); return; }
    if (!V.lists[key]) V.lists[key] = { loading: true };
    paintSide();
    var url = '/api/spotify/list?kind=' + kind + (id ? '&id=' + encodeURIComponent(id) : '') + (q ? '&q=' + encodeURIComponent(q) : '');
    api(url).then(function (data) { V.lists[key] = data; paintSide(); })
      .catch(function () { V.lists[key] = { error: 'Couldn’t reach Spotify' }; paintSide(); });
  }

  // ------------------------------------------------------------ now playing (left)
  function nowHTML() {
    var s = V.sp;
    if (!s) return '<div class="sp-now"><div class="sp-empty">Loading…</div></div>';
    if (!s.configured) return '<div class="sp-now"><div class="sp-empty"><b>Spotify isn’t connected</b><span>Run <code>node scripts/spotify-login.mjs</code> on the PC.</span></div></div>';
    if (!s.active) {
      return '<div class="sp-now"><div class="sp-art sp-noart">' + App.icon('music', 80) + '</div>' +
        '<div class="sp-title"><b>Nothing playing</b><span>Pick something from your library, or choose a device under Devices.</span></div></div>';
    }
    var shuffleOn = s.shuffle ? ' is-on' : '', rep = s.repeat || 'off';
    return '<div class="sp-now">' + img(s.artLarge || s.art, 'sp-art') +
      '<div class="sp-title"><b>' + esc(s.title) + '</b><span>' + esc(s.artist) + '</span></div>' +
      '<div class="sp-prog" data-seek><i style="width:' + progressPct() + '%"></i></div>' +
      '<div class="sp-times"><span data-elapsed>' + mmss(progress()) + '</span><span>' + mmss(s.duration) + '</span></div>' +
      '<div class="sp-ctrls">' +
      '<button class="sp-ctl' + shuffleOn + '" data-cmd="shuffle" aria-label="Shuffle">' + App.icon('shuffle', 26) + '</button>' +
      '<button class="sp-ctl" data-cmd="previous" aria-label="Previous">' + App.icon('prev', 30) + '</button>' +
      '<button class="sp-ctl sp-play" data-cmd="' + (s.playing ? 'pause' : 'play') + '" aria-label="Play/Pause">' + App.icon(s.playing ? 'pause' : 'play', 38) + '</button>' +
      '<button class="sp-ctl" data-cmd="next" aria-label="Next">' + App.icon('next', 30) + '</button>' +
      '<button class="sp-ctl' + (rep !== 'off' ? ' is-on' : '') + '" data-cmd="repeat" aria-label="Repeat">' + App.icon('repeat', 26) + (rep === 'track' ? '<sup>1</sup>' : '') + '</button>' +
      '</div>' +
      (s.canVolume ? '<div class="sp-vol"><button data-vol="-10" aria-label="Quieter">' + App.icon('minus', 22) + '</button><div class="sp-volbar"><i style="width:' + s.volume + '%"></i></div><button data-vol="10" aria-label="Louder">' + App.icon('plus', 22) + '</button></div>' : '') +
      '<button class="sp-device" data-tab="devices">' + App.icon('music', 18) + ' Playing on <b>' + esc(s.device) + '</b></button>' +
      '</div>';
  }
  function progress() {
    var s = V.sp;
    if (!s || !s.active) return 0;
    return Math.min(s.duration, s.progress + (s.playing ? Date.now() - V.at : 0));
  }
  function progressPct() { return V.sp && V.sp.duration ? progress() / V.sp.duration * 100 : 0; }
  function paintNow() {
    var box = V.el && V.el.querySelector('.sp-left');
    if (!box) return;
    // Same song: only the moving parts, so the art doesn't flicker every poll.
    var s = V.sp, key = s ? [s.configured, s.active, s.uri, s.playing, s.shuffle, s.repeat, s.volume, s.device, s.canVolume].join('|') : '';
    if (key === V.nowKey) return tickNow();
    V.nowKey = key;
    box.innerHTML = nowHTML();
  }
  function tickNow() {
    if (!V.el) return;
    var bar = V.el.querySelector('.sp-prog i'), t = V.el.querySelector('[data-elapsed]');
    if (bar) bar.style.width = progressPct() + '%';
    if (t) t.textContent = mmss(progress());
  }

  // ------------------------------------------------------------ side (right)
  function row(item, i, list) {
    var isTrack = item.kind === 'track' || item.kind === 'episode';
    var playing = V.sp && V.sp.uri === item.uri;
    return '<div class="sp-row' + (playing ? ' is-playing' : '') + '">' +
      '<button class="sp-hit" data-item="' + i + '" data-list="' + list + '">' + img(item.art, 'sp-thumb') +
      '<span class="sp-name"><b>' + esc(item.name) + '</b><small>' + esc(item.sub) + (isTrack && item.duration ? ' · ' + mmss(item.duration) : '') + '</small></span>' +
      (isTrack ? '' : App.icon('right', 22)) + '</button>' +
      (isTrack && item.kind === 'track' ? '<button class="sp-add" data-queue="' + esc(item.uri) + '" aria-label="Add to queue">' + App.icon('plus', 22) + '</button>' : '') +
      '</div>';
  }
  function rows(items, list) {
    return items.length ? items.map(function (it, i) { return row(it, i, list); }).join('') : '<div class="sp-empty">Nothing here yet.</div>';
  }
  function state(data) {
    if (!data || data.loading) return '<div class="sp-empty">Loading…</div>';
    if (data.error === 'scope') return '<div class="sp-empty"><b>Spotify needs one more permission</b><span>Run <code>node scripts/spotify-login.mjs</code> again on the PC and click Agree.</span></div>';
    if (data.error) return '<div class="sp-empty">' + esc(data.error) + '</div>';
    return null;
  }
  // The list each row's data-list points at, so a tap can find its item and its neighbours.
  V.shown = {};
  function show(name, items) { V.shown[name] = items; return rows(items, name); }

  function libraryHTML() {
    var chips = [['playlists', 'Playlists'], ['liked', 'Liked songs'], ['albums', 'Albums'], ['recent', 'Recently played']];
    var data = V.lists[listKey(V.lib)];
    return '<div class="seg sp-chips">' + chips.map(function (c) {
      return '<button class="' + (V.lib === c[0] ? 'is-on' : '') + '" data-lib="' + c[0] + '">' + c[1] + '</button>';
    }).join('') + '</div><div class="sp-list">' + (state(data) || show('lib', data.items || [])) + '</div>';
  }
  function detailHTML() {
    var d = V.detail, data = V.lists[listKey(d.kind, d.id)];
    var head = (data && data.head) || d.item;
    return '<div class="sp-detail-h"><button class="icon-btn" data-back aria-label="Back">' + App.icon('left', 26) + '</button>' +
      img(head.art, 'sp-thumb sp-thumb--big') + '<span class="sp-name"><span class="label">' + esc(d.kind) + '</span><b>' + esc(head.name) + '</b><small>' + esc(head.sub) + '</small></span>' +
      '<button class="btn btn--solid" data-playctx>' + App.icon('play', 22) + ' Play</button></div>' +
      '<div class="sp-list">' + (state(data) || (data.note && !(data.items || []).length ? '<div class="sp-empty">' + esc(data.note) + '</div>' : show('detail', data.items || []))) + '</div>';
  }
  function searchHTML() {
    var data = V.query.trim() ? V.lists[listKey('search', null, V.query.trim())] : null;
    var body = '';
    if (!V.query.trim()) body = '<div class="sp-empty">Search for a song, artist, album or playlist.</div>';
    else if (state(data)) body = state(data);
    else {
      [['tracks', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['playlists', 'Playlists']].forEach(function (g) {
        if ((data[g[0]] || []).length) body += '<div class="label sp-group">' + g[1] + '</div>' + show('s-' + g[0], data[g[0]]);
      });
      if (!body) body = '<div class="sp-empty">No results.</div>';
    }
    return '<label class="s-input-wrap sp-search">' + App.icon('search', 26) + '<input class="sp-q" placeholder="What do you want to play?" autocomplete="off" enterkeyhint="search"></label>' +
      '<div class="sp-list">' + body + '</div>';
  }
  function queueHTML() {
    var data = V.lists[listKey('queue')];
    if (state(data)) return state(data);
    return '<div class="sp-list">' + (data.now ? '<div class="label sp-group">Now playing</div>' + show('q-now', [data.now]) : '') +
      '<div class="label sp-group">Next up</div>' + show('queue', data.items || []) + '</div>';
  }
  function devicesHTML() {
    var data = V.lists[listKey('devices')];
    if (state(data)) return state(data);
    var items = data.items || [];
    return '<div class="sp-list">' + (items.length ? items.map(function (d, i) {
      return '<button class="sp-dev' + (d.active ? ' is-on' : '') + '" data-dev="' + i + '"' + (d.restricted ? ' disabled' : '') + '>' +
        App.icon(d.type === 'Smartphone' ? 'phone' : d.type === 'Computer' ? 'laptop' : 'speaker', 30) +
        '<span class="sp-name"><b>' + esc(d.name) + '</b><small>' + esc(d.type) + (d.active ? ' · playing here' : '') + (d.restricted ? ' · can’t be controlled' : '') + '</small></span>' +
        (d.active ? App.icon('check', 26) : '') + '</button>';
    }).join('') : '<div class="sp-empty"><b>No devices found</b><span>Open Spotify on a phone, laptop or speaker on your Wi-Fi, then tap Devices again.</span></div>') + '</div>';
  }
  function sideHTML() {
    if (V.tab === 'library') return V.detail ? detailHTML() : libraryHTML();
    if (V.tab === 'search') return searchHTML();
    if (V.tab === 'queue') return queueHTML();
    return devicesHTML();
  }
  function paintSide() {
    var box = V.el && V.el.querySelector('.sp-side-body');
    if (!box) return;
    var input = box.querySelector('.sp-q'), focused = input && document.activeElement === input, pos = input && input.selectionStart;
    var list = box.querySelector('.sp-list'), top = list ? list.scrollTop : 0, sameView = V.paintedView === viewKey();
    box.innerHTML = sideHTML();
    V.paintedView = viewKey();
    var q = box.querySelector('.sp-q');
    if (q) {
      q.value = V.query;
      q.addEventListener('input', onSearchInput);
      if (focused) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) {} }
    }
    if (sameView) { var l2 = box.querySelector('.sp-list'); if (l2) l2.scrollTop = top; }
    V.el.querySelectorAll('[data-tab]').forEach(function (b) { if (b.closest('.sp-tabs')) b.classList.toggle('is-on', b.dataset.tab === V.tab); });
  }
  function viewKey() { return V.tab + '|' + V.lib + '|' + (V.detail ? V.detail.kind + V.detail.id : ''); }

  function onSearchInput(e) {
    V.query = e.target.value;
    clearTimeout(V.searchTimer);
    V.searchTimer = setTimeout(function () {
      var q = V.query.trim();
      if (q) loadList('search', false, null, q); else paintSide();
    }, 500);
  }

  // ------------------------------------------------------------ taps
  function playFrom(list, i) {
    var items = V.shown[list] || [], it = items[i];
    if (!it) return;
    if (it.kind === 'playlist' || it.kind === 'album' || it.kind === 'artist') {
      V.tab = 'library';
      V.detail = { kind: it.kind, id: it.id, item: it };
      loadList(it.kind, false, it.id);
      return;
    }
    if (list === 'detail' && V.detail.kind !== 'artist') return command({ action: 'playItem', context: V.detail.item.uri || ('spotify:' + V.detail.kind + ':' + V.detail.id), offset: it.uri });
    // Liked, recent, search results, artist top tracks: play this list from the tapped song.
    var tracks = items.filter(function (x) { return x.kind === 'track' || x.kind === 'episode'; });
    var uris = tracks.map(function (x) { return x.uri; }).slice(0, 100);
    command({ action: 'playItem', uris: uris, position: Math.max(0, uris.indexOf(it.uri)) });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-cmd]'))) {
      var c = t.dataset.cmd, s = V.sp || {};
      if (c === 'shuffle') return command({ action: 'shuffle', state: !s.shuffle });
      if (c === 'repeat') return command({ action: 'repeat', state: s.repeat === 'off' ? 'context' : s.repeat === 'context' ? 'track' : 'off' });
      return command({ action: c });
    }
    if ((t = e.target.closest('[data-vol]'))) return command({ action: 'volume', volume: Math.max(0, Math.min(100, (V.sp.volume || 0) + +t.dataset.vol)) });
    if ((t = e.target.closest('[data-seek]'))) {
      var r = t.getBoundingClientRect();
      return command({ action: 'seek', position: Math.round((e.clientX - r.left) / r.width * V.sp.duration) });
    }
    if ((t = e.target.closest('[data-tab]'))) {
      V.tab = t.dataset.tab;
      if (V.tab === 'library') { V.detail = null; loadList(V.lib); }
      else if (V.tab === 'queue' || V.tab === 'devices') loadList(V.tab, true);
      else paintSide();
      if (V.tab === 'search') { var q = V.el.querySelector('.sp-q'); if (q && !V.query) q.focus(); }
      return;
    }
    if ((t = e.target.closest('[data-lib]'))) { V.lib = t.dataset.lib; return loadList(V.lib); }
    if ((t = e.target.closest('[data-back]'))) { V.detail = null; return paintSide(); }
    if ((t = e.target.closest('[data-playctx]'))) return command({ action: 'playItem', context: V.detail.item.uri || ('spotify:' + V.detail.kind + ':' + V.detail.id) });
    if ((t = e.target.closest('[data-queue]'))) {
      return command({ action: 'queue', uri: t.dataset.queue }, true).then(function () { App.toast('Added to the queue', { icon: 'plus', ms: 2500 }); });
    }
    if ((t = e.target.closest('[data-dev]'))) {
      var d = (V.lists[listKey('devices')].items || [])[+t.dataset.dev];
      if (d && !d.active) command({ action: 'transfer', device: d.id }).then(function () { loadList('devices', true); });
      return;
    }
    if ((t = e.target.closest('[data-item]'))) return playFrom(t.dataset.list, +t.dataset.item);
  }

  function render() {
    V.el.innerHTML = '<div class="sp">' +
      '<aside class="sp-left"></aside>' +
      '<section class="sp-side">' +
      '<header class="sp-head"><div><div class="label">Your music</div><h1 class="serif">Spotify</h1></div>' +
      '<div class="seg sp-tabs">' + [['library', 'Library'], ['search', 'Search'], ['queue', 'Queue'], ['devices', 'Devices']].map(function (x) {
        return '<button data-tab="' + x[0] + '" class="' + (V.tab === x[0] ? 'is-on' : '') + '">' + x[1] + '</button>';
      }).join('') + '</div></header>' +
      '<div class="sp-side-body"></div></section></div>';
    V.nowKey = null;
    paintNow();
    paintSide();
  }

  function start() {
    stop();
    fetchState();
    if (V.tab === 'library' && !V.detail) loadList(V.lib);
    V.poll = setInterval(fetchState, 3000);
    V.tick = setInterval(tickNow, 1000);
  }
  function stop() { clearInterval(V.poll); clearInterval(V.tick); }

  App.register('spotify', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
      // Views are also built in the background; only talk to Spotify while this tab is open.
      if (App.current === 'spotify') start();
    },
    resume: function () { start(); },
    hide: function () { stop(); }
  });
})();
