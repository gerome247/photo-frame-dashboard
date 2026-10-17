// Tasks / chores: one lane per person + "Anyone", scoped to the current time-of-day routine.
// Chores are stored by the Worker (js/chores-store.js); "New chore" and "Edit" open the editor.
(function () {
  'use strict';
  var D = window.DATA;
  var S = D.choresStore; // js/chores-store.js
  var V = { el: null, routine: null, pending: {}, editing: false };
  var LANES = ['alex', 'jordan', 'maya', 'otto', 'any'];
  var DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function icon(c, size) { return window.ChoreIcons.svg(c.icon, size || 30); }
  function routine() { return V.routine ? D.routines.filter(function (r) { return r.id === V.routine; })[0] : App.currentRoutine(); }
  function listFor(who, r) {
    return D.chores.filter(function (c) { return c.r === r.id && c.who === who; })
      .sort(function (a, b) { return a.done - b.done; });
  }
  function earnerFor(c, by) { return D.stars[c.who] != null ? c.who : (by && D.stars[by] != null ? by : null); }

  function row(c) {
    var pend = V.pending[c.id];
    return '<button class="ch' + (c.done ? ' is-done' : '') + (pend ? ' is-checking' : '') + (V.editing ? ' is-editing' : '') + '" data-ch="' + c.id + '">' +
      '<span class="ch-emoji">' + icon(c) + '<span class="ch-check"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span></span>' +
      '<span class="ch-text"><b>' + App.esc(c.title) + '</b>' +
      (c.stars ? '<small>' + App.icon('star', 14, 'i--fill') + c.stars + (c.doneBy ? ' · ' + App.person(c.doneBy).name : '') + '</small>' : (c.doneBy ? '<small>by ' + App.person(c.doneBy).name + '</small>' : '')) +
      '</span>' + (V.editing ? '<span class="ch-edit">' + App.icon('pencil', 20) + '</span>' : '') +
      '</button>';
  }

  function weekGrid(id) {
    var w = D.week[id];
    if (!w) return '';
    var today = (App.now().getDay() + 6) % 7;
    return '<div class="ch-week"><div class="label">This week</div><div class="ch-week-row">' + DAYS.map(function (d, i) {
      var cls = i > today ? 'is-future' : i === today ? 'is-today' : (w[i] ? 'is-hit' : 'is-miss');
      return '<span class="' + cls + '"><i></i>' + d + '</span>';
    }).join('') + '</div></div>';
  }

  function lane(who, r) {
    var p = App.person(who), list = listFor(who, r);
    var done = list.filter(function (c) { return c.done; }).length;
    var all = list.length && done === list.length;
    var kid = D.stars[who] != null;
    return '<section class="ch-lane' + (all ? ' is-complete' : '') + '" data-lane="' + who + '" style="' + App.pstyle(p) + '">' +
      '<header class="ch-head">' + App.avatar(p, 42) +
      '<div><b>' + (who === 'any' ? 'Anyone' : p.name) + '</b>' +
      (kid ? '<span class="ch-stars">' + App.icon('star', 18, 'i--fill') + '<span class="num">' + D.stars[who] + '</span></span>' : '<span class="ch-sub">' + (who === 'any' ? 'Up for grabs' : (list.length ? done + ' of ' + list.length : 'Nothing')) + '</span>') + '</div>' +
      '<div class="ch-ring">' + App.ring(done, list.length || 1, 46) + '<span class="num">' + (all ? '✓' : list.length ? done + '/' + list.length : '–') + '</span></div>' +
      '</header>' +
      '<div class="ch-list">' + (list.length ? list.map(row).join('') : '<div class="ch-none serif"><i>Nothing this ' + (r.id === 'evening' ? 'evening' : r.id === 'morning' ? 'morning' : 'afternoon') + '</i></div>') +
      (all && !V.editing ? '<div class="ch-alldone serif">All done<i>!</i></div>' : '') + '</div>' +
      weekGrid(who) +
      '</section>';
  }

  function render() {
    var r = routine(), auto = App.currentRoutine();
    var inR = D.chores.filter(function (c) { return c.r === r.id; });
    var done = inR.filter(function (c) { return c.done; }).length;
    V.el.innerHTML = '<div class="tasks' + (V.editing ? ' is-editing' : '') + '">' +
      '<header class="t-head">' +
      '<div class="t-title"><div class="label">' + (V.editing ? 'Tap a chore to change it' : (r.id === auto.id ? 'Right now · ' : '') + r.range) + '</div><h1 class="serif">' + r.name + '</h1></div>' +
      '<div class="seg">' + D.routines.map(function (x) { return '<button class="' + (x.id === r.id ? 'is-on' : '') + '" data-r="' + x.id + '">' + x.name + '</button>'; }).join('') + '</div>' +
      '<div class="t-actions"><button class="btn" data-new>' + App.icon('plus', 22) + ' New</button>' +
      '<button class="btn' + (V.editing ? ' btn--solid' : '') + '" data-editmode>' + (V.editing ? 'Done' : App.icon('pencil', 20) + ' Edit') + '</button></div>' +
      '<div class="t-progress"><span class="num">' + done + '<small>/' + inR.length + '</small></span><div class="t-bar"><i style="width:' + (inR.length ? done / inR.length * 100 : 0) + '%"></i></div><span class="label">done</span></div>' +
      '</header>' +
      '<div class="ch-lanes">' + LANES.map(function (w) { return lane(w, r); }).join('') + '</div>' +
      '</div>';
  }

  function complete(c, btn, by) {
    var r = routine();
    V.pending[c.id] = true;
    btn.classList.add('is-checking');
    setTimeout(function () {
      delete V.pending[c.id];
      var earner = earnerFor(c, by);
      c.done = true;
      if (by) c.doneBy = by;
      if (earner && c.stars) D.stars[earner] += c.stars;
      S.setDone(c, true, by, earner).then(refresh);
      render();
      App.emit('data');
      var allDone = D.chores.filter(function (x) { return x.r === r.id; }).every(function (x) { return x.done; });
      if (allDone) {
        App.toast('<b>' + r.name + ' routine complete!</b> Everyone crushed it.', { icon: 'star', ms: 5000 });
        return;
      }
      App.toast('<b>' + App.esc(c.title) + '</b> done' + (earner && c.stars ? ' · +' + c.stars + '★ ' + App.person(earner).name : ''), {
        icon: 'check',
        undo: function () { undone(c); }
      });
    }, 350);
  }
  function undone(c) {
    var earner = earnerFor(c, c.doneBy);
    if (earner && c.stars) D.stars[earner] -= c.stars;
    c.done = false;
    delete c.doneBy;
    S.setDone(c, false).then(refresh);
    render();
    App.emit('data');
  }
  // After a save the store has the Worker's copy (stars, week); redraw if this tab is open.
  function refresh() { if (V.el && App.current === 'tasks') render(); App.emit('data'); }

  // "Anyone" chores ask who did it, so stars go to the right kid
  function whoDidIt(c, btn) {
    App.sheet('<div class="sheet-pad"><div class="label ch-sheet-label">' + icon(c, 20) + ' ' + App.esc(c.title) + '</div><h2 class="serif sheet-h">Who did it?</h2>' +
      '<div class="add-who add-who--big">' + D.people.map(function (p) {
        return '<button class="who-btn" data-by="' + p.id + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 88) + '<span>' + p.name + '</span></button>';
      }).join('') + '</div></div>', {
      onMount: function (s, close) {
        s.addEventListener('click', function (e) {
          var b = e.target.closest('[data-by]');
          if (!b) return;
          close();
          var fresh = V.el.querySelector('[data-ch="' + c.id + '"]');
          complete(c, fresh || btn, b.dataset.by);
        });
      }
    });
  }

  // ------------------------------------------------------------ editor
  function editor(def) {
    var isNew = !def;
    var f = def ? Object.assign({}, def) : { id: D._cid(), title: '', icon: 'star', who: 'any', r: routine().id, stars: 1, days: '1111111' };
    var iconPicked = !isNew; // until an icon is tapped, typing the name picks one
    function iconsHTML() {
      var first = window.ChoreIcons.suggest(f.title).slice(0, 8);
      var rest = window.ChoreIcons.names.filter(function (n) { return first.indexOf(n) < 0; });
      return first.concat(rest).map(function (n) {
        return '<button class="ce-icon' + (n === f.icon ? ' is-on' : '') + '" data-icon="' + n + '" aria-label="' + n + '">' + window.ChoreIcons.svg(n, 30) + '</button>';
      }).join('');
    }
    function seg(name, opts, val) {
      return '<div class="seg">' + opts.map(function (o) { return '<button class="' + (String(o[0]) === String(val) ? 'is-on' : '') + '" data-' + name + '="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
    }
    function bodyHTML() {
      return '<div class="label">Who</div><div class="add-who">' + D.people.map(function (p) { return p.id; }).concat(['any']).map(function (id) {
        var p = App.person(id);
        return '<button class="who-btn' + (f.who === id ? ' is-on' : '') + '" data-who="' + id + '" style="' + App.pstyle(p) + '">' + App.avatar(p, 48) + '<span>' + (id === 'any' ? 'Anyone' : p.name) + '</span></button>';
      }).join('') + '</div>' +
        '<div class="add-row"><div><div class="label">When</div>' + seg('when', D.routines.map(function (r) { return [r.id, r.name]; }), f.r) + '</div>' +
        '<div><div class="label">Stars</div>' + seg('stars', [[0, 'None'], [1, '1'], [2, '2'], [3, '3']], f.stars) + '</div></div>' +
        '<div class="label">Days</div><div class="ce-days">' + DAYS.map(function (d, i) {
          return '<button class="' + (f.days.charAt(i) === '1' ? 'is-on' : '') + '" data-day="' + i + '">' + d + '</button>';
        }).join('') + '<button class="ce-every" data-everyday>Every day</button></div>';
    }
    App.sheet('<div class="sheet-pad add ce">' +
      '<div class="label">' + (isNew ? 'New chore' : 'Edit chore') + '</div>' +
      '<input class="big-input ce-title" placeholder="What needs doing?" maxlength="60" autocomplete="off" enterkeyhint="done">' +
      '<div class="label">Icon</div><div class="ce-icons"></div>' +
      '<div class="ce-body"></div>' +
      '<div class="ce-foot">' + (isNew ? '' : '<button class="btn btn--ghost ce-del" data-delete>' + App.icon('x', 20) + ' Delete</button>') +
      '<button class="btn btn--solid" data-save>' + (isNew ? 'Add chore' : 'Save') + '</button></div>' +
      '</div>', {
      cls: 'sheet--wide sheet--tall',
      onMount: function (s, close) {
        var input = s.querySelector('.ce-title'), icons = s.querySelector('.ce-icons'), body = s.querySelector('.ce-body');
        input.value = f.title;
        icons.innerHTML = iconsHTML();
        body.innerHTML = bodyHTML();
        input.addEventListener('input', function () {
          f.title = input.value;
          if (!iconPicked) f.icon = window.ChoreIcons.suggest(f.title)[0] || 'star';
          icons.innerHTML = iconsHTML();
          icons.scrollLeft = 0;
        });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
        if (isNew) setTimeout(function () { input.focus(); }, 300);
        s.addEventListener('click', function (e) {
          var t;
          if ((t = e.target.closest('[data-icon]'))) { f.icon = t.dataset.icon; iconPicked = true; icons.querySelectorAll('.ce-icon').forEach(function (b) { b.classList.toggle('is-on', b === t); }); return; }
          if ((t = e.target.closest('[data-who]'))) { f.who = t.dataset.who; body.innerHTML = bodyHTML(); return; }
          if ((t = e.target.closest('[data-when]'))) { f.r = t.dataset.when; body.innerHTML = bodyHTML(); return; }
          if ((t = e.target.closest('[data-stars]'))) { f.stars = +t.dataset.stars; body.innerHTML = bodyHTML(); return; }
          if ((t = e.target.closest('[data-day]'))) {
            var i = +t.dataset.day, d = f.days.split('');
            d[i] = d[i] === '1' ? '0' : '1';
            if (d.indexOf('1') < 0) return App.toast('A chore needs at least one day', { icon: 'calendar', ms: 2500 });
            f.days = d.join(''); body.innerHTML = bodyHTML(); return;
          }
          if (e.target.closest('[data-everyday]')) { f.days = '1111111'; body.innerHTML = bodyHTML(); return; }
          if (e.target.closest('[data-delete]')) {
            close();
            S.deleteChore(f.id).then(function (ok) { if (ok) { refresh(); App.toast('Deleted <b>' + App.esc(f.title) + '</b>', { icon: 'x', ms: 3000 }); } });
            return;
          }
          if (e.target.closest('[data-save]')) {
            f.title = input.value.trim();
            if (!f.title) { input.focus(); return App.toast('Give the chore a name', { icon: 'pencil', ms: 2500 }); }
            close();
            S.saveChore({ id: f.id, title: f.title, icon: f.icon, who: f.who, r: f.r, stars: f.stars, days: f.days }).then(function (ok) {
              if (!ok) return;
              if (f.r !== routine().id) V.routine = f.r === App.currentRoutine().id ? null : f.r; // show where it went
              refresh();
              App.toast((isNew ? 'Added ' : 'Saved ') + '<b>' + App.esc(f.title) + '</b> for ' + (f.who === 'any' ? 'Anyone' : App.person(f.who).name), { icon: 'check', ms: 3000 });
            });
          }
        });
      }
    });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-r]'))) { V.routine = t.dataset.r === App.currentRoutine().id ? null : t.dataset.r; return render(); }
    if (e.target.closest('[data-new]')) return editor(null);
    if (e.target.closest('[data-editmode]')) { V.editing = !V.editing; return render(); }
    if ((t = e.target.closest('[data-ch]'))) {
      if (V.editing) return editor(D.choreDefs.filter(function (x) { return x.id === t.dataset.ch; })[0]);
      var c = D.chores.filter(function (x) { return x.id === t.dataset.ch; })[0];
      if (!c || V.pending[c.id]) return;
      if (c.done) return undone(c);
      if (c.who === 'any') return whoDidIt(c, t);
      complete(c, t);
    }
  }

  App.register('tasks', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  });
  App.on('time', function () { V.routine = null; });
  // Changed on the other screen (chores-store.js).
  App.on('chores-remote', function () { if (V.el && App.current === 'tasks' && !Object.keys(V.pending).length) render(); });
})();
