// Agents: AI plan usage at a glance (inspired by CodexBar). Display only.
// Live data from the Worker (/api/agents): the PC sends usage (scripts/agents-push.mjs) and the
// Worker adds service status. Until the first fetch, nothing is shown (no demo numbers).
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, data: null, timer: null };
  var H5 = 300, WEEK = 10080;
  // Look of each provider the PC may report.
  var LOOK = {
    claude: { name: 'Claude', color: '#D97757', rgb: '217 119 87' },
    grok: { name: 'Grok', color: '#111111', rgb: '17 17 17' }
  };

  function pstyle(a) { return '--c:' + a.color + ';--c-rgb:' + a.rgb; }
  function minsLeft(m) { return Math.max(0, (new Date(m.resets).getTime() - Date.now()) / 60000); }
  function fmtLeft(min) {
    min = Math.round(min);
    if (min < 60) return min + 'm';
    if (min < 1440) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    return Math.floor(min / 1440) + 'd ' + Math.floor((min % 1440) / 60) + 'h';
  }
  function fmtTokens(n) {
    var m = n / 1e6;
    return m >= 10 ? Math.round(m) + 'M' : m >= 0.1 ? m.toFixed(1) + 'M' : Math.round(n / 1000) + 'k';
  }

  // Server data -> the shape the cards draw.
  function agentsFrom(data) {
    return (data.agents || []).filter(function (a) { return LOOK[a.id]; }).map(function (a) {
      var look = LOOK[a.id], st = (data.status || {})[a.id], meters = [];
      if (a.session) meters.push({ label: a.session.label || 'Session · 5 hours', win: H5, used: a.session.used, resets: a.session.resets });
      if (a.weekly) meters.push({ label: a.weekly.label || 'Weekly · all models', win: WEEK, used: a.weekly.used, resets: a.weekly.resets });
      return {
        id: a.id, name: look.name, color: look.color, rgb: look.rgb, plan: a.plan || '',
        status: st ? (st.indicator === 'none' ? 'ok' : 'degraded') : null,
        incident: st && st.indicator !== 'none' ? (st.incident || st.description) : '',
        meters: meters, note: a.note || (a.id === 'grok' && !a.session && !a.weekly && !a.tokensWeek ? 'xAI doesn’t publish subscription usage, so there’s nothing to measure yet.' : ''),
        breakdown: a.breakdown || [], week: a.tokensWeek || null
      };
    });
  }

  function paceOf(m) {
    var left = minsLeft(m), pace = Math.max(0, Math.min(100, Math.round((1 - left / m.win) * 100))), diff = m.used - pace;
    return { left: left, pace: pace, diff: diff, text: Math.abs(diff) < 3 ? 'On pace' : diff > 0 ? diff + '% over pace' : -diff + '% under pace' };
  }

  function meter(m, ai, mi) {
    var p = paceOf(m), hot = m.used >= 85;
    return '<div class="ag-meter' + (hot ? ' is-hot' : '') + '">' +
      '<div class="ag-meter-top"><span class="ag-label">' + m.label + '</span>' +
      '<span class="ag-pct num">' + m.used + '<small>%</small></span></div>' +
      '<div class="ag-bar"><i style="width:' + Math.min(100, m.used) + '%"></i><em data-pace-mark style="left:' + p.pace + '%" title="Even pace"></em></div>' +
      '<div class="ag-meter-foot" data-meter="' + ai + ',' + mi + '"><span>Resets in <b data-reset>' + fmtLeft(p.left) + '</b></span>' +
      '<span class="ag-pace' + (p.diff >= 3 ? ' is-over' : '') + '" data-pace>' + p.text + '</span></div>' +
      '</div>';
  }

  function spark(vals) {
    var w = 112, h = 34, max = Math.max.apply(null, vals) || 1;
    var pts = vals.map(function (v, i) { return (i / (vals.length - 1) * w).toFixed(1) + ',' + (h - 3 - v / max * (h - 6)).toFixed(1); });
    var last = pts[pts.length - 1].split(',');
    return '<svg class="ag-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<polyline points="' + pts.join(' ') + '"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.5"/></svg>';
  }

  function card(a, ai) {
    var hot = a.meters.some(function (m) { return m.used >= 85; });
    var status = a.status === 'ok' ? '<span class="ag-status"><i></i>Operational</span>'
      : a.status === 'degraded' ? '<span class="ag-status is-warn"><i></i>Degraded</span>' : '';
    return '<section class="ag-card" style="' + pstyle(a) + '">' +
      '<header class="ag-head"><div class="ag-id"><i class="ag-swatch"></i><b>' + a.name + '</b><span class="ag-plan">' + App.esc(a.plan) + '</span></div>' + status + '</header>' +
      (a.incident ? '<div class="ag-incident">' + App.icon('bolt', 16) + App.esc(a.incident) + '</div>' : hot ? '<div class="ag-incident ag-incident--hot">' + App.icon('clock', 16) + 'Near the limit</div>' : '') +
      a.meters.map(function (m, mi) { return meter(m, ai, mi); }).join('') +
      (a.note ? '<p class="ag-note">' + App.esc(a.note) + '</p>' : '') +
      (a.breakdown.length ? '<div class="ag-breakdown"><span class="ag-label">This week</span>' + a.breakdown.map(function (b) { return '<span>' + App.esc(b.name) + ' <b>' + b.percent + '%</b></span>'; }).join('') + '</div>' : '') +
      (a.week ? '<footer class="ag-foot"><div><span class="num">' + fmtTokens(a.week[6]) + '</span><small>tokens today</small></div>' +
        '<div><span class="num">Incl.</span><small>in plan</small></div>' + spark(a.week) + '</footer>' : '') +
      '</section>';
  }

  function weekSource(list) {
    var names = list.map(function (a) { return a.id === 'claude' ? 'Claude Code' : a.id === 'grok' ? 'Grok Build' : a.name; });
    if (names.length < 2) return (names[0] || 'This PC') + ' on this PC';
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' on this PC';
  }

  function summary() {
    var withWeek = D.agents.filter(function (a) { return a.week; });
    if (!withWeek.length) return '';
    var now = App.now();
    var totals = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return withWeek.reduce(function (s, a) { return s + a.week[i]; }, 0); });
    var max = Math.max.apply(null, totals) || 1;
    var week = totals.reduce(function (s, v) { return s + v; }, 0);
    var bars = totals.map(function (t, i) {
      var d = App.addDays(now, i - 6);
      return '<div class="ag-col' + (i === 6 ? ' is-today' : '') + '"><div class="ag-stack" style="height:' + (t / max * 100) + '%">' +
        withWeek.map(function (a) { return '<i style="' + pstyle(a) + ';flex-grow:' + a.week[i] + '"></i>'; }).join('') +
        '</div><span>' + (i === 6 ? 'Today' : App.fmt.dayShort(d)) + '</span></div>';
    }).join('');
    return '<section class="ag-card ag-sum">' +
      '<header class="ag-head"><div class="ag-id"><b>Last 7 days</b><span class="ag-plan">' + App.esc(weekSource(withWeek)) + '</span></div></header>' +
      '<div class="ag-sum-stats"><div><span class="num">' + fmtTokens(week) + '</span><small>tokens</small></div>' +
      '<div><span class="num">' + fmtTokens(week / 7) + '</span><small>a day on average</small></div></div>' +
      '<div class="ag-chart">' + bars + '</div>' +
      '</section>';
  }

  // Minute tick: update countdown + pace text in place (no rebuild, so switching here stays instant).
  function tick() {
    if (!V.el || !V.el.firstChild) return;
    App.$$('[data-meter]', V.el).forEach(function (foot) {
      var ix = foot.dataset.meter.split(','), m = D.agents[+ix[0]].meters[+ix[1]], p = paceOf(m);
      foot.querySelector('[data-reset]').textContent = fmtLeft(p.left);
      var pe = foot.querySelector('[data-pace]');
      pe.textContent = p.text;
      pe.classList.toggle('is-over', p.diff >= 3);
      foot.parentNode.querySelector('[data-pace-mark]').style.left = p.pace + '%';
    });
    var sync = V.el.querySelector('.ag-sync .label');
    if (sync) sync.textContent = synced();
  }

  function synced() {
    if (!V.data) return 'Loading…';
    if (!V.data.updated) return 'Waiting for the PC';
    var m = Math.round((Date.now() - new Date(V.data.updated).getTime()) / 60000);
    if (m < 1) return 'Updated just now';
    if (m < 60) return 'Updated ' + m + ' min ago';
    return 'Updated ' + fmtLeft(m) + ' ago · PC off?';
  }

  function render() {
    D.agents = V.data ? agentsFrom(V.data) : [];
    var cards = D.agents.map(card).join('') + summary();
    var cols = D.agents.length + (D.agents.some(function (a) { return a.week; }) ? 1 : 0);
    V.el.innerHTML = '<div class="agents">' +
      '<header class="ag-top"><div><div class="label">AI plans · usage limits</div><h1 class="serif">Agents</h1></div>' +
      '<div class="ag-sync"><span class="label">' + synced() + '</span>' +
      '<button class="icon-btn" data-refresh aria-label="Refresh">' + App.icon('undo', 26) + '</button></div></header>' +
      // Column count as a variable, not an inline grid, so the phone / iPad layout can override it
      (cards ? '<div class="ag-grid" style="--ag-cols:' + cols + '">' + cards + '</div>'
        : '<div class="ag-empty serif">' + (V.data ? 'No usage from the PC yet.' : 'Loading…') + '</div>') +
      '</div>';
  }

  function load() {
    return fetch('/api/agents', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { V.data = d; if (V.el && App.current === 'agents') render(); })
      .catch(function () {});
  }

  App.register('agents', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.addEventListener('click', function (e) { if (e.target.closest('[data-refresh]')) load(); });
      }
      render();
      if (App.current === 'agents') { load(); clearInterval(V.timer); V.timer = setInterval(load, 2 * 60000); }
    },
    resume: function () { load(); clearInterval(V.timer); V.timer = setInterval(load, 2 * 60000); },
    hide: function () { clearInterval(V.timer); }
  });
  App.on('minute', tick);
})();
