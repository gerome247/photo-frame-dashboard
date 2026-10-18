// Home control: status summary, scenes, rooms of tiles, climate, cameras, media.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, pending: {}, scene: null, camTimer: null, camAge: 4 };

  function dev(id) { return D.devices.filter(function (d) { return d.id === id; })[0]; }

  // Optimistic device update: flip immediately, confirm (or revert) shortly after.
  App.setDevice = function (id, patch, opts) {
    var d = dev(id), before = {};
    if (d.hue) return hueLight(d, patch);
    if (d.hive) return hiveLight(d, patch);
    Object.keys(patch).forEach(function (k) { before[k] = d[k]; d[k] = patch[k]; });
    V.pending[id] = true;
    changed([id]);
    setTimeout(function () {
      delete V.pending[id];
      if (d.flaky && !(opts && opts.silent)) {
        Object.keys(before).forEach(function (k) { d[k] = before[k]; });
        App.toast('Couldn’t reach <b>' + d.name + '</b> · it may be offline', { tone: 'error', icon: 'bolt' });
        changed([id]);
      } else paintTile(id);
    }, d.flaky ? 2600 : 600);
  };

  // ------------------------------------------------------------ tiles
  function tile(d) {
    var pend = V.pending[d.id] ? '<i class="pend"></i>' : '';
    if (d.type === 'light') {
      if (d.offline) {
        return '<div class="tile tile--light is-offline" data-dev="' + d.id + '"><span class="tile-icon">' + App.icon('bulb', 28) + '</span>' +
          '<span class="tile-name">' + App.esc(d.name) + '</span><span class="tile-state">Offline<small>Switched off at the wall?</small></span></div>';
      }
      return '<div class="tile tile--light' + (d.on ? ' is-on' : '') + '" data-dev="' + d.id + '" style="--lvl:' + (d.on ? d.level : 0) + '%">' +
        '<span class="tile-fill"></span>' + pend +
        '<span class="tile-icon">' + App.icon('bulb', 28) + '</span>' +
        '<span class="tile-name">' + App.esc(d.name) + '</span>' +
        '<span class="tile-state num">' + (d.on ? d.level + '%' : 'Off') + '</span></div>';
    }
    if (d.type === 'blind') {
      return '<div class="tile tile--blind' + (d.pos > 0 ? ' is-on' : '') + '" data-dev="' + d.id + '" style="--lvl:' + d.pos + '%">' +
        '<span class="tile-fill"></span>' + pend +
        '<span class="tile-icon">' + App.icon('blinds', 28) + '</span>' +
        '<span class="tile-name">' + d.name + '</span>' +
        '<span class="tile-state num">' + (d.pos === 0 ? 'Closed' : d.pos === 100 ? 'Open' : d.pos + '% open') + '</span></div>';
    }
    if (d.type === 'lock') {
      return '<div class="tile tile--lock' + (d.locked ? '' : ' is-warn') + '" data-dev="' + d.id + '">' + pend +
        '<span class="tile-icon">' + App.icon(d.locked ? 'lock' : 'unlock', 28) + '</span>' +
        '<span class="tile-name">' + d.name + '</span>' +
        '<span class="tile-state">' + (d.locked ? 'Locked<small>Hold to unlock</small>' : 'Unlocked<small>Tap to lock</small>') + '</span>' +
        '<svg class="hold-ring" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/></svg></div>';
    }
    if (d.type === 'garage') {
      var label = { closed: 'Closed', open: 'Open', opening: 'Opening…', closing: 'Closing…' }[d.state];
      return '<div class="tile tile--garage' + (d.state !== 'closed' ? ' is-warn' : '') + (/ing$/.test(d.state) ? ' is-moving' : '') + '" data-dev="' + d.id + '">' + pend +
        '<span class="tile-icon">' + App.icon('garage', 28) + '</span>' +
        '<span class="tile-name">' + d.name + '</span>' +
        '<span class="tile-state">' + label + '</span></div>';
    }
    return '';
  }

  function summary() {
    var lights = D.devices.filter(function (d) { return d.type === 'light' && d.on; });
    var c = D.climate, m = D.media;
    var html = '<button class="sum' + (lights.length ? ' sum--warm' : '') + '" data-sum="lights"><span class="label">Lights</span><b class="num">' + lights.length + '</b><small>on in ' + unique(lights.map(function (l) { return l.room; })).length + ' rooms</small></button>';
    var garage = dev('g-door');
    if (garage) {
      var unlocked = D.devices.filter(function (d) { return d.type === 'lock' && !d.locked; });
      var secure = !unlocked.length && garage.state === 'closed';
      html += '<button class="sum' + (secure ? '' : ' sum--warn') + '" data-sum="security"><span class="label">Security</span><b class="num">' + (secure ? 'Locked' : unlocked.length + (garage.state !== 'closed' ? 1 : 0)) + '</b><small>' + (secure ? 'All doors + garage' : (garage.state !== 'closed' ? 'Garage ' + garage.state : '') + (unlocked.length ? (garage.state !== 'closed' ? ' · ' : '') + unlocked.map(function (u) { return u.name; }).join(', ') : '') + (secure ? '' : ' open')) + '</small></button>';
    }
    html += neoSummary() || (hiveOn() ? '<button class="sum" data-sum="climate"><span class="label">Heating</span><b class="num">' + (V.hive.heating.current == null ? '–' : V.hive.heating.current.toFixed(1)) + '°</b><small>' +
      (V.hive.heating.mode === 'OFF' ? 'Off' : (V.hive.heating.working ? 'Heating' : 'Idle') + ' · set ' + V.hive.heating.target + '°') + '</small></button>' :
      '<button class="sum" data-sum="climate"><span class="label">Climate</span><b class="num">' + c.current + '°</b><small>' + (c.mode === 'off' ? 'System off' : (c.set > c.current ? 'Heating' : c.set < c.current ? 'Cooling' : 'Holding') + ' to ' + c.set + '°') + '</small></button>');
    html += V.sp && V.sp.configured
      ? '<button class="sum" data-sum="media"><span class="label">Spotify</span><b class="num">' + (V.sp.active ? (V.sp.playing ? 'Playing' : 'Paused') : 'Off') + '</b><small>' + App.esc(V.sp.active ? V.sp.device : 'Nothing playing') + '</small></button>'
      : '<button class="sum" data-sum="media"><span class="label">Media</span><b class="num">' + (m.playing ? 'Playing' : 'Paused') + '</b><small>' + m.room + ' speaker</small></button>';
    return html;
  }
  function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  function scenes() {
    // The scene buttons drive Wes's demo bulbs. Real Hue lights have their own tiles.
    // With Hue sync off, those demo scenes stay hidden too.
    if (window.HUE_SYNC === false || (V.hue && V.hue.configured)) return '';
    return D.scenes.map(function (s) {
      return '<button class="scene' + (V.scene === s.id ? ' is-on' : '') + '" data-scene="' + s.id + '">' + App.icon(s.icon, 26) + '<span>' + s.name + '</span></button>';
    }).join('');
  }

  function roomCount(room) {
    var on = D.devices.filter(function (d) { return d.room === room && d.type === 'light' && d.on; }).length;
    return on ? on + ' on' : 'All off';
  }
  function rooms() {
    return D.rooms.map(function (r) {
      var list = D.devices.filter(function (d) { return d.room === r.id; });
      var on = list.filter(function (d) { return d.type === 'light' && d.on; }).length;
      return '<section class="room"><div class="room-h"><h3 class="serif">' + App.esc(r.name) + '</h3><span class="label" data-room-count="' + r.id + '">' + roomCount(r.id) + '</span></div>' +
        '<div class="tiles">' + list.map(tile).join('') + '</div></section>';
    }).join('');
  }

  // ------------------------------------------------------------ Hive (Worker /api/hive)
  // With a Hive login the climate card is the real thermostat and Hive lights get a room;
  // without one, Wes's demo stays.
  function hiveOn() { return V.hive && V.hive.configured && V.hive.heating; }
  function hiveClimate() {
    var h = V.hive.heating, w = V.hive.hotwater, t = V.hiveTarget != null ? V.hiveTarget : h.target;
    var verb = h.mode === 'OFF' ? 'Off' : h.working ? 'Heating' : 'Idle';
    var boosting = h.mode === 'BOOST';
    return '<div class="label label--light">Heating · Hive' + (h.online ? '' : ' · offline') + '</div>' +
      '<div class="th-main"><button class="th-btn" data-htemp="-0.5" aria-label="Cooler">' + App.icon('minus', 36) + '</button>' +
      '<div class="th-set"><span class="num">' + (t == null ? '–' : String(t).replace('.0', '')) + '°</span><small>' + (boosting ? 'Boost · ' + h.boost + ' min left' : h.mode === 'SCHEDULE' ? 'Set by schedule' : 'Set to') + '</small></div>' +
      '<button class="th-btn" data-htemp="0.5" aria-label="Warmer">' + App.icon('plus', 36) + '</button></div>' +
      '<div class="th-now"><span><b class="num">' + (h.current == null ? '–' : h.current.toFixed(1)) + '°</b> inside</span><span class="th-verb th-verb--' + verb.toLowerCase() + '">' + verb + '</span>' +
      (w ? '<span>Hot water <b>' + (w.mode === 'BOOST' ? 'Boost' : w.mode === 'MANUAL' ? 'On' : w.mode === 'OFF' ? 'Off' : 'Schedule') + '</b></span>' : '<span class="th-src">Live from Hive</span>') + '</div>' +
      '<div class="th-row"><div class="seg seg--dark">' + [['SCHEDULE', 'Schedule'], ['MANUAL', 'Manual'], ['OFF', 'Off']].map(function (m) {
        return '<button class="' + (h.mode === m[0] ? 'is-on' : '') + '" data-hmode="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>' +
      '<button class="th-boost' + (boosting ? ' is-on' : '') + '" data-hboost>' + (boosting ? 'Cancel boost' : 'Boost 1h') + '</button></div>';
  }
  function hiveError() {
    var e = V.hive.error;
    return '<div class="label label--light">Heating · Hive</div><div class="th-msg">' + (e === 'login'
      ? '<b>Hive needs you to log in again</b><span>Run <code>hive-login.py</code> on the PC.</span>'
      : '<b>Can’t reach Hive right now</b><span>The Hive app still works. Trying again shortly.</span>') + '</div>';
  }
  function hiveShow(state) {
    if (!state) return;
    if (state.error && V.hive && V.hive.heating && state.error !== 'login') { V.hive.stale = true; return; } // keep the last good state
    V.hive = state;
    V.hiveTarget = null;
    placeLiveDevices();
    if (V.el && App.current === 'control') paint();
  }
  function hiveFetch() {
    return fetch('/api/hive', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(hiveShow).catch(function () {});
  }
  function hiveSend(body) {
    return fetch('/api/hive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (s.error) App.toast(s.error === 'login' ? 'Hive needs you to log in again' : 'Couldn’t reach Hive', { icon: 'thermo', ms: 4000 });
        hiveShow(s);
      })
      .catch(function () { App.toast('Couldn’t reach Hive', { icon: 'thermo', ms: 4000 }); });
  }
  // Hive lights stay in their own room. Once Hue is configured, its rooms replace the whole
  // sample home (bulbs, shades, locks, garage). The sample comes back if Hue drops off.
  // Hue sync is off (window.HUE_SYNC === false): no Hue rooms and no sample rooms.
  // The sample lists are copied on the first call, so a later Hive poll does not reset a
  // garage animation while Hue is still off.
  function copyDev(d) {
    var o = {};
    Object.keys(d).forEach(function (k) { o[k] = d[k]; });
    return o;
  }
  function baseLists() {
    if (V.baseDevices) return;
    V.baseDevices = D.devices.filter(function (d) { return !d.hive && !d.hue; }).map(copyDev);
    V.baseRooms = D.rooms.filter(function (r) { return r.id !== 'hive' && r.id.indexOf('hue-') !== 0; }).map(function (r) { return { id: r.id, name: r.name }; });
  }
  function placeLiveDevices() {
    baseLists();
    var hueSync = window.HUE_SYNC !== false;
    var hueLive = hueSync && V.hue && V.hue.configured && Array.isArray(V.hue.lights);
    if (hueLive) {
      V.hueWasLive = true;
      D.devices = [];
      D.rooms = [];
      var hueRooms = [], seen = {};
      V.hue.lights.forEach(function (l) {
        var rid = 'hue-' + (l.roomId || 'other');
        if (!seen[rid]) { seen[rid] = true; hueRooms.push({ id: rid, name: l.room || 'Hue' }); }
        D.devices.push({
          id: 'hue-' + l.id, hue: true, hueId: String(l.id), room: rid, type: 'light',
          name: l.name, on: l.online !== false && !!l.on, level: l.brightness == null ? 100 : l.brightness,
          offline: l.online === false
        });
      });
      D.rooms = hueRooms;
    } else if (hueSync && V.hueWasLive) {
      V.hueWasLive = false;
      D.devices = V.baseDevices.map(copyDev);
      D.rooms = V.baseRooms.map(function (r) { return { id: r.id, name: r.name }; });
    } else if (!hueSync) {
      D.devices = [];
      D.rooms = [];
    } else {
      D.devices = D.devices.filter(function (d) { return !d.hive && !d.hue; });
      D.rooms = D.rooms.filter(function (r) { return r.id !== 'hive' && r.id.indexOf('hue-') !== 0; });
    }
    var hiveLights = (V.hive && V.hive.lights) || [];
    if (hiveLights.length) {
      D.rooms.unshift({ id: 'hive', name: 'Hive' });
      hiveLights.forEach(function (l) {
        D.devices.unshift({ id: 'hive-' + l.id, hive: true, hiveId: l.id, hiveType: l.type, room: 'hive', type: 'light', name: l.name, on: l.online && l.on, level: l.brightness || 100, offline: !l.online });
      });
    }
  }
  function hueLight(d, patch) {
    var before = { on: d.on, level: d.level };
    Object.keys(patch).forEach(function (k) { d[k] = patch[k]; });
    V.pending[d.id] = true;
    changed([d.id]);
    hueSend({ action: 'light', id: d.hueId, on: !!d.on, brightness: d.on ? (d.level || 100) : 0 }).then(function (ok) {
      delete V.pending[d.id];
      var now = dev(d.id);
      if (!ok && now) { now.on = before.on; now.level = before.level; }
      if (now) changed([now.id]);
    });
  }
  function hueShow(state) {
    if (!state || state.error) return false;
    V.hue = state;
    D.hue = state;
    placeLiveDevices();
    if (V.el && App.current === 'control') paint();
    App.emit('live', 'hue');
    return !!state.configured;
  }
  function hueFetch() {
    return fetch('/api/hue', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(hueShow).catch(function () {});
  }
  function hueSend(body) {
    return fetch('/api/hue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s || s.error) {
          App.toast(s && s.error === 'login' ? 'Hue needs you to log in again' : 'Couldn’t reach Hue', { icon: 'bulb', ms: 4000 });
          return false;
        }
        hueShow(s);
        return true;
      })
      .catch(function () { App.toast('Couldn’t reach Hue', { icon: 'bulb', ms: 4000 }); return false; });
  }
  function huePoll() {
    clearInterval(V.huePollTimer);
    if (window.HUE_SYNC === false) return;
    if (!V.hue && D.hue && D.hue.configured) hueShow(D.hue);
    hueFetch();
    V.huePollTimer = setInterval(hueFetch, 5000);
  }
  function hiveLight(d, patch) {
    Object.keys(patch).forEach(function (k) { d[k] = patch[k]; });
    V.pending[d.id] = true;
    changed([d.id]);
    hiveSend({ action: 'light', id: d.hiveId, type: d.hiveType, on: d.on, brightness: d.on ? Math.max(5, d.level) : null })
      .then(function () { delete V.pending[d.id]; if (dev(d.id)) changed([d.id]); });
  }
  // − / + taps gather for a moment, then one change goes to Hive.
  function hiveTemp(step) {
    var h = V.hive.heating;
    V.hiveTarget = Math.max(h.min, Math.min(h.max, (V.hiveTarget != null ? V.hiveTarget : h.target || 20) + step));
    paintPart('.hc-climate', climate());
    clearTimeout(V.hiveTimer);
    V.hiveTimer = setTimeout(function () { hiveSend({ action: 'target', id: h.id, target: V.hiveTarget }); }, 900);
  }
  function hivePoll() {
    clearInterval(V.hivePollTimer);
    hiveFetch();
    V.hivePollTimer = setInterval(hiveFetch, 60000);
  }

  // ------------------------------------------------------------ Heatmiser neoHub (underfloor)
  // One Hive-style card per zone, directly under the Hive card. /api/neohub.
  function neoLive() { return !!(V.neo && V.neo.configured); }
  function neoZone(id) {
    return ((V.neo && V.neo.zones) || []).filter(function (z) { return String(z.id) === String(id); })[0];
  }
  function neoSummary() {
    if (!neoLive()) return '';
    var zones = V.neo.zones || [];
    if (V.neo.error && !zones.length) return '<button class="sum" data-sum="neo"><span class="label">Underfloor</span><b class="num">–</b><small>Can’t reach neoHub</small></button>';
    var hot = zones.filter(function (z) { return z.heating && !z.offline; }).length;
    return '<button class="sum' + (hot ? ' sum--warm' : '') + '" data-sum="neo"><span class="label">Underfloor</span><b class="num">' + hot + '</b><small>' + hot + ' of ' + zones.length + ' heating</small></button>';
  }
  function neoDeg(n) { return n == null ? '–' : String(n).replace('.0', ''); }
  function neoZoneCard(z) {
    var t = V.neoTarget && V.neoTarget[z.id] != null ? V.neoTarget[z.id] : z.target;
    var verb = z.offline ? 'Offline' : z.frost ? 'Frost' : z.heating ? 'Heating' : z.away ? 'Away' : 'Idle';
    var setLabel = z.offline ? 'Offline' : z.frost ? 'Frost' : z.away ? 'Away' : 'Set to';
    var id = App.esc(z.id);
    return '<div class="uf-card' + (z.offline ? ' is-off' : '') + '">' +
      '<div class="label label--light">Underfloor' + (z.name ? ' · ' + App.esc(z.name) : '') + '</div>' +
      '<div class="th-main"><button class="th-btn" data-ntemp="-0.5" data-nid="' + id + '" aria-label="Cooler">' + App.icon('minus', 36) + '</button>' +
      '<div class="th-set"><span class="num">' + neoDeg(t) + '°</span><small>' + setLabel + '</small></div>' +
      '<button class="th-btn" data-ntemp="0.5" data-nid="' + id + '" aria-label="Warmer">' + App.icon('plus', 36) + '</button></div>' +
      '<div class="th-now"><span><b class="num">' + (z.current == null ? '–' : z.current.toFixed(1)) + '°</b> inside</span>' +
      '<span class="th-verb th-verb--' + verb.toLowerCase() + '">' + verb + '</span><span class="th-src">Heatmiser</span></div>' +
      '<button class="th-boost' + (z.frost ? ' is-on' : '') + '" data-nfrost data-nid="' + id + '">' + (z.frost ? 'Frost on' : 'Frost') + '</button></div>';
  }
  function neoCard() {
    if (!neoLive()) return '';
    if (V.neo.error && !(V.neo.zones || []).length) {
      return '<div class="uf-card"><div class="label label--light">Underfloor</div><div class="th-msg"><b>Can’t reach the neoHub</b><span>Trying again shortly.</span></div></div>';
    }
    return (V.neo.zones || []).map(neoZoneCard).join('');
  }
  function neoPaint() {
    if (!V.el) return;
    var box = V.el.querySelector('.hc-neo');
    if (!box) return;
    box.classList.toggle('is-on', neoLive());
    box.innerHTML = neoCard();
  }
  function neoShow(state) {
    if (!state) return false;
    if (state.error && V.neo && V.neo.zones && V.neo.zones.length) { V.neo.stale = true; return true; }
    var pending = V.neoTarget || {};
    V.neo = state;
    D.neo = state;
    V.neoTarget = {};
    Object.keys(pending).forEach(function (id) {
      if (V.neoTimers && V.neoTimers[id]) V.neoTarget[id] = pending[id];
    });
    if (V.el && App.current === 'control') { neoPaint(); paintPart('.hc-sum', summary()); }
    App.emit('live', 'neo');
    return !!state.configured;
  }
  function neoFetch() {
    return fetch('/api/neohub', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(neoShow).catch(function () {});
  }
  function neoSend(body) {
    return fetch('/api/neohub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s || s.error) {
          App.toast('Couldn’t reach the neoHub', { icon: 'thermo', ms: 4000 });
          return false;
        }
        neoShow(s);
        return true;
      })
      .catch(function () { App.toast('Couldn’t reach the neoHub', { icon: 'thermo', ms: 4000 }); return false; });
  }
  function neoTemp(id, step) {
    var z = neoZone(id);
    if (!z) return;
    if (z.offline) return App.toast(App.esc(z.name) + ' is offline', { icon: 'thermo', ms: 3000 });
    if (!V.neoTarget) V.neoTarget = {};
    var cur = V.neoTarget[id] != null ? V.neoTarget[id] : (z.target == null ? 20 : z.target);
    V.neoTarget[id] = Math.max(5, Math.min(35, Math.round((cur + step) * 2) / 2));
    neoPaint();
    if (!V.neoTimers) V.neoTimers = {};
    clearTimeout(V.neoTimers[id]);
    V.neoTimers[id] = setTimeout(function () {
      var target = V.neoTarget[id];
      neoSend({ action: 'target', id: id, target: target }).then(function () {
        delete V.neoTimers[id];
        if (V.neoTarget) delete V.neoTarget[id];
        neoPaint();
      });
    }, 900);
  }
  function neoFrost(id) {
    var z = neoZone(id);
    if (!z) return;
    if (z.offline) return App.toast(App.esc(z.name) + ' is offline', { icon: 'thermo', ms: 3000 });
    z.frost = !z.frost;
    neoPaint();
    paintPart('.hc-sum', summary());
    neoSend({ action: 'frost', id: id, on: z.frost });
  }
  function neoPoll() {
    clearInterval(V.neoPollTimer);
    if (!V.neo && D.neo) neoShow(D.neo);
    neoFetch();
    V.neoPollTimer = setInterval(neoFetch, 5000);
  }

  function climate() {
    var box = V.el && V.el.querySelector('.hc-climate');
    if (box) box.classList.toggle('is-hive', !!(V.hive && V.hive.configured));
    if (V.hive && V.hive.configured && V.hive.error && !V.hive.heating) return hiveError();
    if (hiveOn()) return hiveClimate();
    var c = D.climate;
    var verb = c.mode === 'off' ? 'Off' : c.set > c.current ? 'Heating' : c.set < c.current ? 'Cooling' : 'Holding';
    return '<div class="label label--light">Climate · Main floor</div>' +
      '<div class="th-main"><button class="th-btn" data-temp="-0.5" aria-label="Cooler">' + App.icon('minus', 36) + '</button>' +
      '<div class="th-set"><span class="num">' + c.set.toFixed(1).replace('.0', '') + '°</span><small>Set to</small></div>' +
      '<button class="th-btn" data-temp="0.5" aria-label="Warmer">' + App.icon('plus', 36) + '</button></div>' +
      '<div class="th-now"><span><b class="num">' + c.current + '°</b> inside</span><span class="th-verb th-verb--' + verb.toLowerCase() + '">' + verb + '</span><span><b class="num">' + c.humidity + '%</b> humidity</span></div>' +
      '<div class="seg seg--dark">' + [['heat', 'Heat'], ['cool', 'Cool'], ['auto', 'Auto'], ['off', 'Off']].map(function (m) {
        return '<button class="' + (c.mode === m[0] ? 'is-on' : '') + '" data-tmode="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>';
  }

  function cams() {
    return '<div class="label">Cameras · snapshots every 20s</div><div class="cams">' + D.cameras.slice(0, 2).map(function (c) {
      return '<button class="cam" data-cam="' + c.id + '"><img src="' + App.img(c.seed, 400, 250) + '" alt=""><span class="cam-name">' + c.name + '</span><span class="cam-age">' + V.camAge + 's ago</span></button>';
    }).join('') + '</div>';
  }

  // ------------------------------------------------------------ Spotify (Worker /api/spotify)
  // Real now-playing card when the Worker has a Spotify login, else Wes's demo card.
  function spotifyCard() {
    var s = V.sp;
    if (s.error && !s.active) return '<div class="np-art np-art--icon">' + App.icon('music', 34) + '</div><div class="np-text"><span class="label">Spotify</span><b>Can’t reach Spotify</b><span>Trying again shortly</span></div>';
    if (!s.active) return '<div class="np-art np-art--icon">' + App.icon('music', 34) + '</div><div class="np-text"><span class="label">Spotify</span><b>Nothing playing</b><span>Start music on a phone or speaker</span></div>';
    return (s.art ? '<img class="np-art" src="' + s.art + '" alt="">' : '<div class="np-art np-art--icon">' + App.icon('music', 34) + '</div>') +
      '<div class="np-text"><span class="label">' + App.esc(s.device || 'Spotify') + '</span><b>' + App.esc(s.title) + '</b><span>' + App.esc(s.artist) + '</span>' +
      (s.canVolume ? '<span class="np-vol"><button data-spvol="-10" aria-label="Quieter">' + App.icon('minus', 20) + '</button><span class="num">' + s.volume + '%</span><button data-spvol="10" aria-label="Louder">' + App.icon('plus', 20) + '</button></span>' : '') +
      '</div>' +
      '<div class="np-ctrls"><button class="np-btn np-btn--ghost" data-sp="previous" aria-label="Previous">' + App.icon('left', 26) + '</button>' +
      '<button class="np-btn" data-sp="' + (s.playing ? 'pause' : 'play') + '" aria-label="Play/Pause">' + App.icon(s.playing ? 'pause' : 'play', 30) + '</button>' +
      '<button class="np-btn np-btn--ghost" data-sp="next" aria-label="Next">' + App.icon('right', 26) + '</button></div>';
  }
  function spotifyShow(state) {
    if (!state) return;
    V.sp = state;
    if (V.el && App.current === 'control') { paintPart('.hc-media', media()); paintPart('.hc-sum', summary()); }
  }
  function spotifyFetch() {
    return fetch('/api/spotify', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(spotifyShow).catch(function () {});
  }
  function spotifyCommand(body) {
    if (V.spBusy) return;
    V.spBusy = true;
    fetch('/api/spotify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        V.spBusy = false;
        if (s.error && s.configured === undefined) return App.toast(App.esc(s.error), { icon: 'music', ms: 4000 });
        spotifyShow(s);
      })
      .catch(function () { V.spBusy = false; App.toast('Couldn’t reach Spotify', { icon: 'music', ms: 4000 }); });
  }

  function media() {
    if (V.sp && V.sp.configured) return spotifyCard();
    var m = D.media;
    return '<img class="np-art" src="' + App.img(m.seed, 160, 160) + '" alt="">' +
      '<div class="np-text"><span class="label">' + m.room + '</span><b>' + m.title + '</b><span>' + m.artist + '</span></div>' +
      '<button class="np-btn" data-play aria-label="Play/Pause">' + App.icon(m.playing ? 'pause' : 'play', 30) + '</button>';
  }

  // Granular updates: an action repaints only what it touched (full paint() rebuilds ~270 nodes,
  // which costs ~350ms on the wall tablet).
  function paintTile(id) {
    var d = dev(id);
    [V.el && V.el.querySelector('.hc-rooms'), V.sheetBox].forEach(function (root) {
      var old = root && root.querySelector('[data-dev="' + id + '"]');
      if (!old) return;
      var tmp = document.createElement('div');
      tmp.innerHTML = tile(d);
      var nt = tmp.firstChild;
      old.parentNode.replaceChild(nt, old);
      bindTile(nt);
    });
    var c = V.el && V.el.querySelector('[data-room-count="' + d.room + '"]');
    if (c) c.textContent = roomCount(d.room);
  }
  function paintPart(sel, html) { if (V.el) V.el.querySelector(sel).innerHTML = html; }
  function changed(ids) {
    ids.forEach(paintTile);
    paintPart('.hc-sum', summary());
    App.emit('data');
  }

  function paint() {
    if (!V.el) return;
    var el = V.el;
    var sum = el.querySelector('.hc-sum');
    sum.classList.toggle('hc-sum--3', !dev('g-door'));
    sum.innerHTML = summary();
    var sceneHtml = scenes();
    var scenesEl = el.querySelector('.hc-scenes');
    scenesEl.innerHTML = sceneHtml;
    scenesEl.style.display = sceneHtml ? '' : 'none';
    var rs = el.querySelector('.hc-rooms'), st = rs.scrollTop;
    rs.innerHTML = rooms();
    rs.scrollTop = st;
    bindTiles(rs);
    neoPaint();
    el.querySelector('.hc-climate').innerHTML = climate();
    var camsEl = el.querySelector('.hc-cams');
    var showDemoCams = window.HUE_SYNC !== false && !(V.hue && V.hue.configured);
    camsEl.hidden = !showDemoCams;
    camsEl.innerHTML = showDemoCams ? cams() : '';
    el.querySelector('.hc-media').innerHTML = media();
  }

  // ------------------------------------------------------------ tile gestures
  // Lights + blinds: tap toggles, horizontal drag sets level (whole tile is the slider).
  function sliderTile(t, d) {
    var sx, startLvl, dragging = false, w;
    t.addEventListener('pointerdown', function (e) {
      sx = e.clientX; dragging = false; w = t.getBoundingClientRect().width;
      startLvl = d.type === 'light' ? (d.on ? d.level : 0) : d.pos;
      try { t.setPointerCapture(e.pointerId); } catch (err) {}
    });
    t.addEventListener('pointermove', function (e) {
      if (sx == null) return;
      var dx = e.clientX - sx;
      if (!dragging && Math.abs(dx) > 10) { dragging = true; t.classList.add('is-drag'); }
      if (!dragging) return;
      var lvl = Math.max(0, Math.min(100, Math.round(startLvl + dx / w * 100)));
      t.style.setProperty('--lvl', lvl + '%');
      t.classList.toggle('is-on', lvl > 0);
      t.querySelector('.tile-state').textContent = d.type === 'light' ? (lvl ? lvl + '%' : 'Off') : (lvl === 0 ? 'Closed' : lvl === 100 ? 'Open' : lvl + '% open');
      t._lvl = lvl;
    });
    t.addEventListener('pointerup', function () {
      if (sx == null) return;
      sx = null;
      t.classList.remove('is-drag');
      V.scene = null;
      if (dragging) {
        var lvl = t._lvl;
        if (d.type === 'light') App.setDevice(d.id, lvl ? { on: true, level: lvl } : { on: false });
        else App.setDevice(d.id, { pos: lvl });
      } else if (d.type === 'light') App.setDevice(d.id, { on: !d.on, level: d.level || 100 });
      else App.setDevice(d.id, { pos: d.pos > 0 ? 0 : 100 });
    });
    t.addEventListener('pointercancel', function () { sx = null; t.classList.remove('is-drag'); paintTile(d.id); });
  }

  function bindTiles(root) { App.$$('[data-dev]', root).forEach(bindTile); }
  function bindTile(t) {
    (function () {
      var d = dev(t.dataset.dev);
      if (d.offline) t.addEventListener('click', function () { App.toast('<b>' + App.esc(d.name) + '</b> is offline in ' + (d.hue ? 'Hue' : 'Hive') + '. Check it’s switched on at the wall.', { icon: 'bulb', ms: 4000 }); });
      else if (d.type === 'light' || d.type === 'blind') sliderTile(t, d);
      if (d.type === 'lock') {
        App.hold(t, 1000, {
          enabled: function () { return d.locked; },
          done: function () { V.lastHold = Date.now(); App.setDevice(d.id, { locked: false }); App.toast('<b>' + d.name + '</b> unlocked', { icon: 'unlock' }); },
          cancel: function () { App.toast('Hold for a second to unlock <b>' + d.name + '</b>', { icon: 'lock', ms: 2200 }); }
        });
        t.addEventListener('click', function () { if (!d.locked && Date.now() - (V.lastHold || 0) > 800) App.setDevice(d.id, { locked: true }); });
      }
      if (d.type === 'garage') t.addEventListener('click', function () { App.openGarageSheet(); });
    })();
  }

  // Slide-to-confirm for the garage
  App.openGarageSheet = function () {
    var g = dev('g-door'), opening = g.state === 'closed';
    App.sheet('<div class="sheet-pad"><div class="label">Garage door · currently ' + g.state + '</div><h2 class="serif sheet-h">' + (opening ? 'Open' : 'Close') + ' the garage?</h2>' +
      '<p class="sheet-p">' + (opening ? 'Make sure the driveway is clear.' : 'The door will stop and reverse if anything is in the way.') + '</p>' +
      '<div class="slide-confirm"><span class="sc-label">Slide to ' + (opening ? 'open' : 'close') + ' →</span><span class="sc-fill"></span><span class="sc-knob">' + App.icon('garage', 30) + '</span></div></div>', {
      onMount: function (s, close) {
        var track = s.querySelector('.slide-confirm'), knob = s.querySelector('.sc-knob'), fill = s.querySelector('.sc-fill');
        var sx = null, max;
        knob.addEventListener('pointerdown', function (e) {
          sx = e.clientX; max = track.getBoundingClientRect().width - knob.getBoundingClientRect().width - 8;
          knob.setPointerCapture(e.pointerId);
        });
        knob.addEventListener('pointermove', function (e) {
          if (sx == null) return;
          var k = App.$('#stage').getBoundingClientRect().width / 1280;
          var x = Math.max(0, Math.min(max / k, (e.clientX - sx) / k));
          knob.style.transform = 'translateX(' + x + 'px)';
          fill.style.width = (x + 76) + 'px';
          knob._x = x; knob._max = max / k;
        });
        knob.addEventListener('pointerup', function () {
          if (sx == null) return;
          sx = null;

          if (knob._x >= knob._max - 6) {
            close();
            g.state = opening ? 'opening' : 'closing';
            V.scene = null;
            changed(['g-door']);
            setTimeout(function () { g.state = opening ? 'open' : 'closed'; changed(['g-door']); App.toast('Garage ' + g.state, { icon: 'garage', ms: 2500 }); }, 4000);
          } else { knob.style.transform = ''; fill.style.width = ''; }
        });
      }
    });
  };

  App.cameraSheet = function (c) {
    App.sheet('<div class="cam-big"><img src="' + App.img(c.seed, 1200, 750) + '" alt=""><div class="cam-big-bar"><span class="tk-live"><i></i>' + c.name + '</span><span class="label label--light">Snapshot · ' + V.camAge + 's ago</span></div></div>', { cls: 'sheet--cam' });
  };

  function listSheet(kind) {
    var list = D.devices.filter(function (d) { return kind === 'lights' ? d.type === 'light' : (d.type === 'lock' || d.type === 'garage'); });
    if (kind === 'lights') list.sort(function (a, b) { return b.on - a.on; });
    App.sheet('<div class="sheet-pad"><div class="label">' + (kind === 'lights' ? 'Every light in the house' : 'Doors + garage') + '</div>' +
      '<h2 class="serif sheet-h">' + (kind === 'lights' ? 'Lights' : 'Security') + '</h2>' +
      '<div class="tiles tiles--sheet">' + list.map(tile).join('') + '</div>' +
      '<div class="sheet-actions">' + (kind === 'lights' ? '<button class="btn btn--solid" data-alloff>Turn everything off</button>' : '<button class="btn btn--solid" data-lockall>Lock all doors</button>') + '</div></div>', {
      cls: 'sheet--wide',
      onClose: function () { V.sheetBox = null; },
      onMount: function (s, close) {
        var box = s.querySelector('.tiles--sheet');
        V.sheetBox = box;
        bindTiles(box);
        var off = s.querySelector('[data-alloff]'), lk = s.querySelector('[data-lockall]');
        if (off) off.onclick = function () {
          var prev = D.devices.filter(function (d) { return d.type === 'light' && d.on && !d.offline; });
          var snapshot = prev.map(function (d) { return { id: d.id, on: d.on, level: d.level, hue: d.hue, hive: d.hive, hueId: d.hueId, hiveId: d.hiveId, hiveType: d.hiveType }; });
          prev.forEach(function (d) { d.on = false; });
          close(); changed(prev.map(function (d) { return d.id; }));
          if (snapshot.some(function (d) { return d.hue; })) {
            hueSend({ action: 'allOff' }).then(function (ok) {
              if (ok) return;
              snapshot.forEach(function (s) { var d = s.hue && dev(s.id); if (d) { d.on = s.on; d.level = s.level; } });
              changed(snapshot.filter(function (s) { return s.hue; }).map(function (s) { return s.id; }));
            });
          }
          snapshot.forEach(function (s) { if (s.hive) hiveSend({ action: 'light', id: s.hiveId, type: s.hiveType, on: false }); });
          App.toast('Turned off ' + prev.length + ' lights', { icon: 'bulb', undo: function () {
            snapshot.forEach(function (s) {
              var d = dev(s.id);
              if (!d) return;
              d.on = true; d.level = s.level;
              if (d.hue) hueLight(d, { on: true, level: s.level || 100 });
              else if (d.hive) hiveLight(d, { on: true, level: Math.max(5, s.level || 100) });
            });
            changed(snapshot.map(function (s) { return s.id; }));
          } });
        };
        if (lk) lk.onclick = function () {
          var locks = D.devices.filter(function (d) { return d.type === 'lock'; });
          locks.forEach(function (d) { d.locked = true; });
          close(); changed(locks.map(function (d) { return d.id; }));
          App.toast('All doors locked', { icon: 'lock' });
        };
      }
    });
  }

  function applyScene(id) {
    var s = D.scenes.filter(function (x) { return x.id === id; })[0];
    var snapshot = D.devices.map(function (d) { return Object.assign({}, d); });
    var prevScene = V.scene;
    Object.keys(s.set).forEach(function (k) {
      var d = dev(k), v = s.set[k];
      if (!d || d.hue || d.hive) return;
      if (d.type === 'blind') d.pos = v;
      else if (v === 0) d.on = false;
      else { d.on = true; d.level = v; }
    });
    if (id === 'away' || id === 'night') D.devices.forEach(function (d) { if (d.type === 'lock') d.locked = true; });
    V.scene = id;
    function diff() {
      return snapshot.filter(function (o) { var d = dev(o.id); return o.on !== d.on || o.level !== d.level || o.pos !== d.pos || o.locked !== d.locked; })
        .map(function (o) { return o.id; });
    }
    var ids = diff();
    paintPart('.hc-scenes', scenes());
    changed(ids);
    App.toast('<b>' + s.name + '</b> scene on', {
      icon: s.icon, undo: function () {
        snapshot.forEach(function (o) { Object.assign(dev(o.id), o); });
        V.scene = prevScene;
        paintPart('.hc-scenes', scenes());
        changed(ids);
      }
    });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-scene]'))) return applyScene(t.dataset.scene);
    if ((t = e.target.closest('[data-sum]'))) {
      var k = t.dataset.sum;
      if (k === 'lights' || k === 'security') return listSheet(k);
      var target = V.el.querySelector(k === 'climate' ? '.hc-climate' : k === 'neo' ? '.hc-neo' : '.hc-media');
      target.classList.add('is-pulse'); setTimeout(function () { target.classList.remove('is-pulse'); }, 900);
      return;
    }
    if ((t = e.target.closest('[data-ntemp]'))) return neoTemp(t.dataset.nid, +t.dataset.ntemp);
    if ((t = e.target.closest('[data-nfrost]'))) return neoFrost(t.dataset.nid);
    if ((t = e.target.closest('[data-htemp]'))) return hiveTemp(+t.dataset.htemp);
    if ((t = e.target.closest('[data-hmode]'))) return hiveSend({ action: 'heatMode', id: V.hive.heating.id, mode: t.dataset.hmode });
    if (e.target.closest('[data-hboost]')) {
      var hh = V.hive.heating;
      if (hh.mode === 'BOOST') return hiveSend({ action: 'cancelBoost', id: hh.id });
      return hiveSend({ action: 'heatBoost', id: hh.id, minutes: 60, target: Math.max(21, hh.target || 0) });
    }
    if ((t = e.target.closest('[data-temp]'))) {
      D.climate.set = Math.max(15, Math.min(28, D.climate.set + +t.dataset.temp));
      if (D.climate.mode === 'off') D.climate.mode = 'heat';
      return climateChanged();
    }
    if ((t = e.target.closest('[data-tmode]'))) { D.climate.mode = t.dataset.tmode; return climateChanged(); }
    if ((t = e.target.closest('[data-cam]'))) return App.cameraSheet(D.cameras.filter(function (c) { return c.id === t.dataset.cam; })[0]);
    if ((t = e.target.closest('[data-sp]'))) return spotifyCommand({ action: t.dataset.sp });
    if ((t = e.target.closest('[data-spvol]'))) {
      return spotifyCommand({ action: 'volume', volume: Math.max(0, Math.min(100, (V.sp.volume || 0) + +t.dataset.spvol)) });
    }
    if ((t = e.target.closest('[data-play]'))) { D.media.playing = !D.media.playing; paintPart('.hc-media', media()); paintPart('.hc-sum', summary()); }
  }
  function climateChanged() { paintPart('.hc-climate', climate()); paintPart('.hc-sum', summary()); App.emit('data'); }

  // Spotify is only asked while this view is on screen.
  function spotifyPoll() {
    clearInterval(V.spTimer);
    spotifyFetch();
    V.spTimer = setInterval(spotifyFetch, 5000);
  }

  function camTimer() {
    clearInterval(V.camTimer);
    V.camTimer = setInterval(function () {
      V.camAge = V.camAge >= 20 ? 1 : V.camAge + 1;
      App.$$('.cam-age', V.el).forEach(function (a) { a.textContent = V.camAge + 's ago'; });
    }, 1000);
  }

  App.on('live', function (key) {
    if (window.HUE_SYNC !== false || key !== 'hue') return;
    V.hue = D.hue || { configured: false };
    placeLiveDevices();
    if (V.el && App.current === 'control') paint();
  });

  App.register('control', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.innerHTML = '<div class="hc">' +
          '<div class="hc-left"><div class="hc-sum"></div><div class="hc-scenes"></div><div class="hc-rooms"></div></div>' +
          '<div class="hc-right"><div class="hc-climate"></div><div class="hc-neo"></div><div class="hc-cams"></div><div class="hc-media card"></div></div>' +
          '</div>';
        el.addEventListener('click', onClick);
      }
      if (!V.hue && D.hue) { V.hue = D.hue; placeLiveDevices(); }
      paint();
      camTimer();
      if (App.current === 'control') { spotifyPoll(); hivePoll(); huePoll(); neoPoll(); }
    },
    resume: function () { camTimer(); spotifyPoll(); hivePoll(); huePoll(); neoPoll(); },
    hide: function () { clearInterval(V.camTimer); clearInterval(V.spTimer); clearInterval(V.hivePollTimer); clearInterval(V.huePollTimer); clearInterval(V.neoPollTimer); }
  });
})();
