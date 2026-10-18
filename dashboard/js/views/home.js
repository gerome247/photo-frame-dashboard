// Home / Today: the glanceable overview. Never scrolls.
(function () {
  'use strict';
  var D = window.DATA, V = {};

  function clock() {
    var n = App.now();
    return '<div class="h-time num">' + App.fmt.time(n, false) + '<span class="h-ampm">' + App.fmt.ampm(n) + '</span></div>' +
      '<div class="h-date"><b>' + App.fmt.day(n) + '</b> ' + App.fmt.month(n) + ' ' + n.getDate() + '</div>';
  }

  function weather() {
    var w = App.weatherNow();
    var hours = App.hourly(7);
    var tmin = Math.min.apply(null, hours.map(function (h) { return h.t; }));
    var tmax = Math.max.apply(null, hours.map(function (h) { return h.t; }));
    return '<div class="h-wx-top">' +
      '<span class="h-wx-icon">' + App.icon(w.cond, 60) + '</span>' +
      '<span class="h-wx-temp num">' + w.temp + '°</span>' +
      '<span class="h-wx-meta"><b>' + w.label + '</b><span>H ' + w.hi + '°  L ' + w.lo + '°</span></span>' +
      '</div>' +
      '<div class="h-wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>' +
      '<div class="h-wx-hours">' + hours.map(function (h) {
        var lift = tmax === tmin ? 0 : Math.round((h.t - tmin) / (tmax - tmin) * 8);
        return '<div class="h-hr' + (h.p >= 50 ? ' is-wet' : '') + '"><span class="h-hr-l">' + h.label + '</span>' +
          '<span class="h-hr-i" style="transform:translateY(' + -lift + 'px)">' + App.icon(h.c, 22) + '</span><b>' + h.t + '°</b></div>';
      }).join('') + '</div>';
  }

  // Each person's chores today (stars for the kids). Wes's demo showed made-up locations/ETAs,
  // which the dashboard can't know.
  function presence() {
    return D.people.map(function (p) {
      var mine = D.chores.filter(function (c) { return c.who === p.id; });
      var done = mine.filter(function (c) { return c.done; }).length;
      var stars = D.stars[p.id] != null ? App.icon('star', 13, 'i--fill') + D.stars[p.id] + (mine.length ? ' · ' : '') : '';
      var sub = stars + (mine.length ? (done === mine.length ? '<b>Chores done</b>' : done + '/' + mine.length + ' chores') : (stars ? '' : 'No chores today'));
      return '<div class="h-who is-home" style="' + App.pstyle(p) + '">' +
        App.avatar(p, 36) +
        '<span><b>' + p.name + '</b><small>' + sub + '</small></span></div>';
    }).join('');
  }

  // Today's chores not yet ticked, in routine order (morning, after school, evening).
  function choresLeft(who) {
    var order = D.routines.map(function (r) { return r.id; });
    return D.chores.filter(function (c) { return !c.done && (!who || c.who === who); })
      .sort(function (a, b) { return order.indexOf(a.r) - order.indexOf(b.r); });
  }
  function routineName(id) { return (D.routines.filter(function (r) { return r.id === id; })[0] || {}).name || ''; }

  function hero() {
    var e = App.nextEvent(), now = App.now();
    if (!e) {
      var tomorrow = App.timedOn(App.addDays(now, 1))[0];
      var left = choresLeft(), people = [];
      left.forEach(function (c) { if (people.indexOf(c.who) < 0) people.push(c.who); });
      var names = people.map(function (id) { return id === 'any' ? 'anyone' : App.person(id).name; });
      var namesText = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
      return '<div class="h-hero h-hero--empty" data-go="' + (left.length ? 'tasks' : 'calendar') + '">' +
        '<div class="label label--light">Rest of today</div>' +
        (left.length
          ? '<div class="h-hero-title serif">No events today.<br><i>' + left.length + ' chore' + (left.length > 1 ? 's' : '') + ' still to do.</i></div>' +
            '<div class="h-hero-meta">For ' + App.esc(namesText) + ' · tap to see them</div>'
          : '<div class="h-hero-title serif">Nothing else scheduled.<br><i>Enjoy the quiet.</i></div>') +
        (tomorrow ? '<div class="h-hero-meta">Tomorrow starts with <b>' + App.esc(tomorrow.title) + '</b> at ' + App.fmt.time(tomorrow.start) + '</div>' : '') +
        '</div>';
    }
    var p = App.evColor(e);
    var mins = (e.start - now) / 60000;
    var leave = (App.leaveBy(e) - now) / 60000;
    var who = e.people.map(function (id) { return App.person(id).name; });
    var whoText = App.isFamily(e) ? 'Everyone' : who.join(' + ');
    var big = mins < 100
      ? '<div class="h-hero-count num">' + Math.round(mins) + '<small>min</small></div>'
      : '<div class="h-hero-count num">' + App.fmt.time(e.start, false) + '<small>' + App.fmt.ampm(e.start) + '</small></div>';
    var leavePill = '';
    if (e.travel) {
      leavePill = leave <= 0
        ? '<span class="pill pill--alert"><i class="pulse"></i>Leave now</span>'
        : '<span class="pill' + (leave <= 15 ? ' pill--soon' : '') + '">' + App.icon('car', 20) + 'Leave in ' + App.fmt.mins(leave) + '</span>';
    }
    return '<button class="h-hero" style="' + App.pstyle(p) + '" data-ev="' + e.id + '">' +
      '<div class="h-hero-main">' +
      '  <div class="label label--on">Next up · ' + App.esc(whoText) + '</div>' +
      '  <div class="h-hero-title serif">' + App.esc(e.title) + '</div>' +
      '  <div class="h-hero-meta">' + App.fmt.range(e.start, e.end) + (e.loc ? ' · ' + App.esc(e.loc) : '') + '</div>' +
      '  <div class="h-hero-foot">' + (e.people.length > 1 ? App.dots(e.people, 22) : '') + leavePill + '</div>' +
      '</div>' + big + '</button>';
  }

  function lanes() {
    var now = App.now();
    return D.people.map(function (p) {
      var list = App.timedOn(now, p.id).filter(function (e) { return e.end > now; });
      var shown = list.slice(0, 3), more = list.length - shown.length;
      return '<div class="h-lane" style="' + App.pstyle(p) + '">' +
        '<div class="h-lane-head">' + App.avatar(p, 30) + '<b>' + p.name + '</b></div>' +
        (list.length ? shown.map(function (e) {
          var cur = e.start <= now;
          return '<button class="h-ev' + (cur ? ' is-now' : '') + '" data-ev="' + e.id + '">' +
            '<span class="h-ev-t">' + (cur ? 'Now' : App.fmt.time(e.start, false)) + '</span>' +
            '<span class="h-ev-n">' + App.esc(e.title) + '</span></button>';
        }).join('') : '') +
        (more > 0 ? '<button class="h-more" data-go="calendar">+' + more + ' more</button>' : '') +
        choresHTML(p.id, list.length) +
        '</div>';
    }).join('');
  }

  // A person's chores under their events: the ones left (up to 3), "Chores done" when finished,
  // "Free" only when there are no events and no chores.
  function choresHTML(id, events) {
    var all = D.chores.filter(function (c) { return c.who === id; }), left = choresLeft(id);
    if (!all.length) return events ? '' : '<div class="h-free serif"><i>Free</i> the rest of the day</div>';
    if (!left.length) return '<div class="h-chores-done">' + App.icon('check', 18) + 'Chores done</div>';
    var shown = left.slice(0, 3);
    return shown.map(function (c) {
      return '<button class="h-chore" data-go="tasks"><span class="h-chore-i">' + window.ChoreIcons.svg(c.icon, 18) + '</span>' +
        '<span class="h-ev-n">' + App.esc(c.title) + '</span><span class="h-ev-t">' + App.esc(routineName(c.r)) + '</span></button>';
    }).join('') + (left.length > 3 ? '<button class="h-more" data-go="tasks">+' + (left.length - 3) + ' more chores</button>' : '');
  }

  function ring(done, total, size) {
    var r = size / 2 - 5, c = 2 * Math.PI * r, f = total ? done / total : 0;
    return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-bg"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-fg" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }
  App.ring = ring;

  function chores() {
    var r = App.currentRoutine();
    var who = D.people.map(function (p) { return p.id; }).concat(['any']);
    return '<div class="label">Chores · ' + r.name + '</div><div class="h-rings">' + who.map(function (id) {
      var list = D.chores.filter(function (c) { return c.r === r.id && c.who === id; });
      if (!list.length) return '';
      var done = list.filter(function (c) { return c.done; }).length;
      var p = App.person(id);
      return '<div class="h-ring' + (done === list.length ? ' is-done' : '') + '" style="' + App.pstyle(p) + '">' + ring(done, list.length, 64) +
        '<b class="num">' + (done === list.length ? '✓' : done + '/' + list.length) + '</b><span>' + (id === 'any' ? 'Anyone' : p.name) + '</span></div>';
    }).join('') + '</div>';
  }

  function shopping() {
    var open = D.groceries.filter(function (g) { return !g.done; });
    var recent = open.slice(-3).reverse();
    return '<div class="label">Shopping</div>' +
      '<div class="h-stat"><span class="num">' + open.length + '</span><small>items to get</small></div>' +
      '<ul class="h-recent">' + recent.map(function (g) {
        return '<li><i></i>' + App.esc(g.name) + '</li>';
      }).join('') + '</ul>';
  }

  // Real home status when Hive / Hue / underfloor / Spotify are connected (js/live.js), else Wes's demo.
  function status() {
    if (!D.hive || D.hue == null || D.neo == null) return '<div class="label">Home</div><div class="h-st-row"><span>Loading…</span></div>'; // until js/live.js reports
    var h = D.hive.configured && D.hive.heating;
    var hueOn = D.hue.configured;
    var neoOn = D.neo.configured;
    if (!h && !hueOn && !neoOn) return D.hive.configured ? '<div class="label">Home</div><div class="h-st-row is-warn"><span>Can’t reach Hive</span></div>' : demoStatus();
    var rows = '';
    if (h) rows += '<div class="h-st-row">' + App.icon('thermo', 24) + '<b class="num">' + (h.current == null ? '–' : h.current.toFixed(1)) + '°</b><span>' +
      (h.mode === 'OFF' ? 'heating off' : (h.working ? 'heating' : 'idle') + ' · set ' + h.target + '°') + '</span></div>';
    else if (D.hive.configured && D.hive.error) rows += '<div class="h-st-row is-warn"><span>Can’t reach Hive</span></div>';
    if (neoOn) {
      var zones = D.neo.zones || [];
      if (D.neo.error && !zones.length) rows += '<div class="h-st-row is-warn">' + App.icon('thermo', 24) + '<span>Can’t reach underfloor</span></div>';
      else {
        var hot = zones.filter(function (z) { return z.heating && !z.offline; }).length;
        rows += '<div class="h-st-row">' + App.icon('thermo', 24) + (hot
          ? '<b class="num">' + hot + '</b><span>' + (hot === 1 ? 'underfloor zone on' : 'underfloor zones on') + '</span>'
          : '<span>underfloor idle</span>') + '</div>';
      }
    }
    if (hueOn) {
      if (D.hue.error && !D.hue.lights) rows += '<div class="h-st-row is-warn">' + App.icon('bulb', 24) + '<span>Can’t reach Hue</span></div>';
      else {
        var on = (D.hue.lights || []).filter(function (l) { return l.on && l.online !== false; }).length;
        rows += '<div class="h-st-row">' + App.icon('bulb', 24) + '<b class="num">' + on + '</b><span>' + (on === 1 ? 'light on' : 'lights on') + '</span></div>';
      }
    }
    // The Hive bulb is a different light from the Hue rooms, so it keeps its own row.
    (D.hive.lights || []).forEach(function (l) {
      rows += '<div class="h-st-row">' + App.icon('bulb', 24) + '<span>' + App.esc(l.name) + ' · ' + (!l.online ? 'offline' : l.on ? 'on' + (l.brightness ? ' ' + l.brightness + '%' : '') : 'off') + '</span></div>';
    });
    var np = D.nowPlaying;
    rows += '<div class="h-st-row h-st-music">' + App.icon('music', 24) + '<span>' + (np && np.playing ? '<b class="h-np">' + App.esc(np.title) + '</b> · ' + App.esc(np.device) : 'Spotify paused') + '</span></div>';
    return '<div class="label">Home</div>' + rows;
  }
  function demoStatus() {
    var lights = D.devices.filter(function (d) { return d.type === 'light' && d.on; }).length;
    var unlocked = D.devices.filter(function (d) { return d.type === 'lock' && !d.locked; });
    var garage = D.devices.filter(function (d) { return d.type === 'garage'; })[0];
    var secure = !unlocked.length && garage.state === 'closed';
    var secText = secure ? 'All locked' : (garage.state !== 'closed' ? 'Garage open' : unlocked[0].name + ' unlocked');
    return '<div class="label">Home</div>' +
      '<div class="h-st-row">' + App.icon('bulb', 24) + '<b class="num">' + lights + '</b><span>lights on</span></div>' +
      '<div class="h-st-row' + (secure ? '' : ' is-warn') + '">' + App.icon(secure ? 'lock' : 'unlock', 24) + '<span>' + secText + '</span></div>' +
      '<div class="h-st-row">' + App.icon('thermo', 24) + '<b class="num">' + D.climate.current + '°</b><span>inside</span></div>';
  }

  function paint() {
    var el = V.el;
    el.querySelector('.h-clock').innerHTML = clock();
    el.querySelector('.h-weather').innerHTML = weather();
    el.querySelector('.h-presence').innerHTML = presence();
    el.querySelector('.h-hero-slot').innerHTML = hero();
    el.querySelector('.h-lanes').innerHTML = lanes();
    el.querySelector('.h-chores').innerHTML = chores();
    el.querySelector('.h-shop').innerHTML = shopping();
    el.querySelector('.h-status').innerHTML = status();
  }

  function photoCaption(s) {
    var m = App.photoMeta(s.photos[0]);
    V.el.querySelector('.h-photo-cap').innerHTML = '<b>' + [m.onThisDay ? 'On this day' : '', m.kicker].filter(Boolean).join(' · ') + '</b><span>' + App.esc(m.place) + '</span>';
  }

  App.register('home', {
    show: function (el) {
      V.el = el;
      if (!el.firstChild) {
        el.innerHTML = '<div class="home">' +
          '<div class="h-clock" data-go="calendar"></div>' +
          '<div class="h-weather"></div>' +
          '<div class="h-presence"></div>' +
          '<div class="h-main"><div class="h-hero-slot"></div><div class="h-lanes" ></div></div>' +
          '<div class="h-side">' +
          '  <button class="h-photo" data-go="photos"><div class="h-photo-stage"></div><div class="h-photo-cap"></div></button>' +
          '  <button class="h-chores card" data-go="tasks"></button>' +
          '  <div class="h-duo"><button class="h-shop card" data-go="shopping"></button><button class="h-status card" data-go="control"></button></div>' +
          '</div></div>';
        el.addEventListener('click', function (e) {
          var ev = e.target.closest('[data-ev]');
          if (ev) { App.eventSheet(App.findEvent(ev.dataset.ev)); return; }
          var g = e.target.closest('[data-go]');
          if (g) App.go(g.dataset.go);
        });
        V.slides = new App.Slideshow(el.querySelector('.h-photo-stage'), { layout: 'cover', captions: false, interval: 12000, onChange: photoCaption });
      }
      paint();
      V.slides.start();
    },
    resume: function () { V.slides.start(); },
    hide: function () { if (V.slides) V.slides.stop(); }
  });
  // Every minute: just the clock and next-up countdown (cheap, even while hidden). Weather on the hour.
  App.on('minute', function (n) {
    if (!V.el || !V.el.firstChild) return;
    V.el.querySelector('.h-clock').innerHTML = clock();
    V.el.querySelector('.h-hero-slot').innerHTML = hero();
    if (n.getMinutes() === 0) { V.el.querySelector('.h-weather').innerHTML = weather(); V.el.querySelector('.h-lanes').innerHTML = lanes(); }
  });
  App.on('data', function () { if (App.current === 'home') paint(); });
  App.on('live', function () { if (App.current === 'home' && V.el && V.el.querySelector('.h-status')) V.el.querySelector('.h-status').innerHTML = status(); });
})();
