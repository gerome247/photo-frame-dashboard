// Ring: newest doorbell picture and who rang (doorbell, knock, motion, person). Display only.
// The PC posts stills and events (scripts/ring-bridge.mjs). Ring does not name a person.
(function () {
  'use strict';
  var V = { el: null, data: null, failed: false, timer: null, pick: '', picked: false, shot: '', mode: '' };
  // New on each page load so a previously failed picture is fetched again.
  var BOOT = Date.now();

  function verb(e) {
    var s;
    if (e.kind === 'ding' && e.answered) s = 'Answered';
    else if (e.kind === 'ding' && e.missed) s = 'Missed ring';
    else if (e.kind === 'ding') s = 'Doorbell';
    else if (e.kind === 'knock') s = 'Knock';
    else if (e.kind === 'motion' && e.person) s = 'Person';
    else s = 'Motion';
    if (e.person && e.kind !== 'motion') s += ' \u00b7 Person';
    return s;
  }

  function when(at) {
    var mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + ' min ago';
    return App.fmt.time(new Date(at));
  }

  function power(d) {
    var bits = [];
    if (d.battery == null && d.charging) bits.push('Wired');
    else if (d.battery != null) {
      bits.push(d.battery + '%');
      if (d.charging) bits.push('charging');
    }
    if (d.offline) bits.push('Offline');
    return bits.join(' \u00b7 ');
  }

  function fresh(updated) {
    if (!updated) return '';
    var m = Math.round((Date.now() - updated) / 60000);
    if (m < 1) return 'Updated just now';
    if (m < 60) return 'Updated ' + m + ' min ago';
    return 'Updated ' + App.fmt.time(new Date(updated));
  }

  function online(devices) {
    var out = [], i;
    for (i = 0; i < devices.length; i++) if (!devices[i].offline) out.push(devices[i]);
    return out;
  }

  function chosen(devices) {
    var i;
    if (V.picked) {
      for (i = 0; i < devices.length; i++) if (devices[i].id === V.pick) return devices[i];
    }
    for (i = 0; i < devices.length; i++) if (devices[i].snap) { V.pick = devices[i].id; return devices[i]; }
    for (i = 0; i < devices.length; i++) if (!devices[i].offline) { V.pick = devices[i].id; return devices[i]; }
    V.pick = devices[0].id;
    return devices[0];
  }

  function emptyHtml(mode) {
    var title = mode === 'loading' ? 'Loading\u2026'
      : mode === 'fail' ? 'Ring didn\u2019t answer'
      : mode === 'empty' ? 'No doorbell on this account.'
      : mode === 'down' ? 'Doorbell is offline'
      : 'Ring isn\u2019t connected';
    var sub = mode === 'off' ? 'Sign in on the computer, then this fills in.'
      : mode === 'fail' ? 'It will try again.'
      : mode === 'down' ? 'It will show here when it reconnects.'
      : '';
    return '<div class="ring"><header class="ring-top"><div><div class="label">Door</div><h1 class="serif">Ring</h1></div></header>' +
      '<div class="ring-empty"><p class="serif">' + title + '</p>' +
      (sub ? '<p>' + sub + '</p>' : '') + '</div></div>';
  }

  function liveHtml() {
    return '<div class="ring"><header class="ring-top"><div><div class="label">Door</div><h1 class="serif">Ring</h1></div>' +
      '<div class="ring-meta"><span class="label" data-fresh></span><div class="ring-pills" data-pills></div></div></header>' +
      '<div class="ring-body"><div class="ring-photo is-waiting"><img class="ring-shot" alt="">' +
      '<div class="ring-wait serif">Waiting for a picture</div>' +
      '<div class="ring-cap"><b data-name></b><span data-power></span><span data-now></span></div></div>' +
      '<div class="ring-side" data-list></div></div></div>';
  }

  function bindShot() {
    var img = V.el.querySelector('.ring-shot');
    img.addEventListener('error', function () { img.parentNode.classList.add('is-waiting'); });
    img.addEventListener('load', function () { img.parentNode.classList.remove('is-waiting'); });
  }

  function pills(devices, id) {
    if (devices.length < 2) return '';
    return devices.map(function (d) {
      return '<button type="button" data-ring="' + d.id + '"' + (d.id === id ? ' class="is-on"' : '') + '>' + App.esc(d.name) + '</button>';
    }).join('');
  }

  function list(events) {
    if (!events.length) return '<p class="ring-none">No recent rings</p>';
    return events.map(function (e) {
      var missed = e.kind === 'ding' && e.missed;
      return '<div class="ring-ev' + (missed ? ' is-missed' : '') + '"><b>' + verb(e) + '</b><span>' + when(e.at) + '</span></div>';
    }).join('');
  }

  function render() {
    if (!V.el) return;
    var data = V.data;
    var all = data && data.devices ? data.devices : [];
    var devices = online(all);
    var mode = !data ? (V.failed ? 'fail' : 'loading')
      : !data.configured ? 'off'
      : !devices.length ? (all.length ? 'down' : 'empty')
      : 'live';
    if (mode !== 'live') {
      V.mode = mode;
      V.shot = '';
      V.el.innerHTML = emptyHtml(mode);
      return;
    }
    var cam = chosen(devices);
    if (V.mode !== 'live' || !V.el.querySelector('.ring-shot')) {
      V.mode = 'live';
      V.shot = '';
      V.el.innerHTML = liveHtml();
      bindShot();
    }
    V.el.querySelector('[data-fresh]').textContent = fresh(data.updated);
    V.el.querySelector('[data-pills]').innerHTML = pills(devices, cam.id);
    V.el.querySelector('[data-name]').textContent = cam.name;
    V.el.querySelector('[data-power]').textContent = power(cam);
    var now = cam.events[0];
    var nowEl = V.el.querySelector('[data-now]');
    nowEl.textContent = now ? verb(now) + ' \u00b7 ' + when(now.at) : 'No recent rings';
    nowEl.classList.toggle('is-missed', !!(now && now.kind === 'ding' && now.missed));
    V.el.querySelector('[data-list]').innerHTML = list(cam.events);
    var key = cam.id + ':' + (cam.snap || '');
    var img = V.el.querySelector('.ring-shot');
    if (V.shot !== key) {
      V.shot = key;
      if (cam.snap) img.src = '/api/ring/snapshot?id=' + encodeURIComponent(cam.id) + '&t=' + cam.snap + '&b=' + BOOT;
      else {
        img.removeAttribute('src');
        img.parentNode.classList.add('is-waiting');
      }
    }
  }

  function load() {
    return fetch('/api/ring', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http');
      return r.json();
    }).then(function (d) {
      V.data = d;
      V.failed = false;
      if (V.el && App.current === 'ring') render();
    }).catch(function () {
      V.failed = !V.data;
      if (V.el && App.current === 'ring' && !V.data) render();
    });
  }

  function arm() {
    clearInterval(V.timer);
    render();
    load();
    V.timer = setInterval(load, 20000);
  }

  function onClick(e) {
    var b = e.target.closest('[data-ring]');
    if (!b) return;
    V.pick = b.getAttribute('data-ring');
    V.picked = true;
    render();
  }

  App.register('ring', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.addEventListener('click', onClick);
      }
      render();
      if (App.current === 'ring') arm();
    },
    resume: function () { arm(); },
    hide: function () { clearInterval(V.timer); V.timer = null; }
  });
})();
