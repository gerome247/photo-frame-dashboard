// Shopping: categorized list (left) + quick-add with usuals (right).
(function () {
  'use strict';
  var D = window.DATA;
  var save = D.shopping ? D.shopping.save : function () {}; // shopping-store.js
  var V = { el: null, store: 'all', query: '', drawer: false, pending: {}, flash: null };

  function open() { return D.groceries.filter(function (g) { return !g.done && (V.store === 'all' || g.store === V.store); }); }
  function done() { return D.groceries.filter(function (g) { return g.done && (V.store === 'all' || g.store === V.store); }); }
  function storeName(id) { var s = D.stores.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }
  // Store for a new item: the usual's own store, else the open tab (Tesco from the All tab).
  function storeFor(u) { return u && u.store !== 'all' ? u.store : (V.store === 'all' ? D.stores[0].id : V.store); }
  function usual(name) { return D.usuals.filter(function (u) { return u.name.toLowerCase() === name.toLowerCase(); })[0]; }

  function categorize(name) {
    var n = name.toLowerCase();
    var hit = D.catalog.filter(function (c) { return c[0].toLowerCase() === n; })[0] ||
      D.catalog.filter(function (c) { var a = c[0].toLowerCase(); return a.indexOf(n) > -1 || n.indexOf(a) > -1; })[0] ||
      D.catalog.filter(function (c) { return n.split(/\s+/).some(function (w) { return w.length > 3 && c[0].toLowerCase().indexOf(w) > -1; }); })[0];
    return hit ? hit[1] : 'Other';
  }
  function find(name, isDone) {
    return D.groceries.filter(function (g) { return !!g.done === isDone && g.name.toLowerCase() === name.toLowerCase(); })[0];
  }

  function row(g) {
    return '<div class="s-row' + (V.pending[g.id] ? ' is-checking' : '') + '" data-id="' + g.id + '">' +
      '<button class="s-hit" data-check="' + g.id + '">' +
      '<span class="s-box">' + App.icon('check', 22) + '</span>' +
      '<span class="s-name"><b>' + App.esc(g.name) + '</b>' + (g.note ? '<small>' + App.esc(g.note) + '</small>' : '') + '</span>' +
      (V.store === 'all' && g.store !== D.stores[0].id ? '<span class="s-store">' + App.esc(storeName(g.store)) + '</span>' : '') +
      '</button>' +
      '<div class="s-qty"><button data-qty="-1" data-id="' + g.id + '" aria-label="Less">' + App.icon('minus', 22) + '</button><span class="num">' + g.qty + '</span><button data-qty="1" data-id="' + g.id + '" aria-label="More">' + App.icon('plus', 22) + '</button></div>' +
      '</div>';
  }

  function listHTML() {
    var items = open(), order = D.catOrder[V.store].concat(['Other']);
    var groups = order.map(function (cat) { return { cat: cat, items: items.filter(function (g) { return g.cat === cat; }) }; }).filter(function (x) { return x.items.length; });
    var d = done();
    return (items.length ? groups.map(function (gr) {
      return '<div class="s-cat" data-cat="' + gr.cat + '"><div class="s-cat-h"><span class="label">' + gr.cat + '</span><span class="label" data-cat-count>' + gr.items.length + '</span></div>' + gr.items.map(row).join('') + '</div>';
    }).join('') : '<div class="s-empty serif">All stocked up.<br><i>Nothing left to buy.</i></div>') +
      (d.length ? '<div class="s-drawer' + (V.drawer ? ' is-open' : '') + '">' +
        '<button class="s-drawer-h" data-drawer><span>' + App.icon('check', 22) + ' Got it <b class="num">(' + d.length + ')</b></span><span class="label">' + (V.drawer ? 'Hide' : 'Show') + '</span></button>' +
        (V.drawer ? '<div class="s-drawer-list">' + d.map(function (g) {
          return '<button class="s-got" data-revive="' + g.id + '">' + App.esc(g.name) + '<span class="label">Add back</span></button>';
        }).join('') + '<button class="btn btn--ghost s-clear" data-clear>Clear ' + d.length + ' checked items</button></div>' : '') +
        '</div>' : '');
  }

  function suggestHTML() {
    var q = V.query.trim().toLowerCase();
    if (q) {
      var matches = D.catalog.filter(function (c) { return c[0].toLowerCase().indexOf(q) === 0; })
        .concat(D.catalog.filter(function (c) { var i = c[0].toLowerCase().indexOf(q); return i > 0; })).slice(0, 5);
      var exact = matches.some(function (m) { return m[0].toLowerCase() === q; });
      return '<div class="label">Suggestions</div><div class="s-ac">' + matches.map(function (m) {
        var on = find(m[0], false);
        return '<button class="s-ac-row" data-add="' + App.esc(m[0]) + '"><b>' + App.esc(m[0]) + '</b><span class="label">' + (on ? 'On list · ×' + on.qty : m[1]) + '</span>' + App.icon('plus', 26) + '</button>';
      }).join('') + (exact ? '' : '<button class="s-ac-row s-ac-row--new" data-add="' + App.esc(V.query.trim()) + '"><b>Add “' + App.esc(V.query.trim()) + '”</b><span class="label">' + categorize(V.query) + '</span>' + App.icon('plus', 26) + '</button>') + '</div>';
    }
    // A store tab shows its own usuals and the 'all' ones; the All tab shows every usual.
    var list = D.usuals.filter(function (u) { return V.store === 'all' || u.store === 'all' || u.store === V.store; });
    return '<div class="label">Usuals · tap to add</div><div class="s-usuals">' + list.map(usualTile).join('') +
      '<button class="s-tile s-tile--new" data-new-usual>' + App.icon('plus', 30) + '<span>Add a usual</span></button></div>';
  }
  function usualTile(u) {
    var on = find(u.name, false);
    return '<button class="s-tile' + (on ? ' is-on' : '') + '" data-add="' + App.esc(u.name) + '">' +
      '<b>' + App.esc(u.name) + '</b><span>' + (on ? App.icon('check', 16) + 'On list' + (on.qty > 1 ? ' ×' + on.qty : '')
        : (u.store !== 'all' ? App.esc(storeName(u.store)) + ' · ' : '') + categorize(u.name)) + '</span></button>';
  }

  // "Add a usual": a name and which store's tab it shows on (All: every tab).
  function newUsual() {
    var pick = V.store;
    var saveUsuals = D.shopping && D.shopping.saveUsuals;
    function seg() {
      return [['all', 'All']].concat(D.stores.map(function (x) { return [x.id, x.name]; })).map(function (o) {
        return '<button class="' + (o[0] === pick ? 'is-on' : '') + '" data-pick="' + o[0] + '">' + App.esc(o[1]) + '</button>';
      }).join('');
    }
    App.sheet('<div class="sheet-pad add">' +
      '<div class="label">New usual</div>' +
      '<input class="big-input s-usual-name" placeholder="What do you often buy?" maxlength="40" autocomplete="off" enterkeyhint="done">' +
      '<div class="label">Shows on</div><div class="seg s-usual-store">' + seg() + '</div>' +
      '<div class="sheet-actions"><button class="btn btn--solid" data-save-usual>' + App.icon('plus', 22) + ' Add usual</button></div>' +
      '</div>', {
      onMount: function (sheet, close) {
        var input = sheet.querySelector('.s-usual-name');
        setTimeout(function () { input.focus(); }, 50);
        function done() {
          var name = input.value.trim();
          if (!name) { input.focus(); return; }
          name = name.charAt(0).toUpperCase() + name.slice(1);
          var old = usual(name);
          var list = D.usuals.filter(function (u) { return u !== old; }).concat([{ name: old ? old.name : name, store: pick }]);
          close();
          if (!saveUsuals) return;
          saveUsuals(list).then(function () {
            if (V.el && App.current === 'shopping' && !V.query.trim()) paintSuggest();
          }).catch(function (err) {
            console.error('usuals save', err);
            if (V.el && !V.query.trim()) paintSuggest();
            App.toast('Couldn’t save the usual', { icon: 'x', tone: 'error', ms: 4000 });
          });
          if (!V.query.trim()) paintSuggest();
          App.toast((old ? 'Moved' : 'Added') + ' <b>' + App.esc(old ? old.name : name) + '</b> to the usuals' + (pick !== 'all' ? ' · ' + App.esc(storeName(pick)) : ''), { icon: 'check', ms: 3000 });
        }
        sheet.addEventListener('click', function (e) {
          var b = e.target.closest('[data-pick]');
          if (b) { pick = b.dataset.pick; sheet.querySelector('.s-usual-store').innerHTML = seg(); return; }
          if (e.target.closest('[data-save-usual]')) done();
        });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(); });
      }
    });
  }

  // ---- granular updates (full list + usuals rebuild costs ~500ms on the wall tablet)
  function swap(old, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    old.parentNode.replaceChild(tmp.firstChild, old);
  }
  function refreshSuggestFor(g) {
    if (V.query.trim()) return paintSuggest();
    var t = V.el.querySelector('.s-usuals [data-add="' + App.esc(g.name) + '"]');
    var u = usual(g.name);
    if (t && u) swap(t, usualTile(u));
  }
  function catCount(cat) {
    var c = V.el.querySelector('.s-cat[data-cat="' + cat + '"]');
    if (!c) return;
    var n = c.querySelectorAll('.s-row').length;
    if (!n) c.parentNode.removeChild(c);
    else c.querySelector('[data-cat-count]').textContent = n;
  }
  function inView(g) { return !g.done && (V.store === 'all' || g.store === V.store); }
  function insertRow(g) {
    var cat = V.el.querySelector('.s-cat[data-cat="' + g.cat + '"]');
    if (!inView(g)) return paintHead();
    if (!cat) return paintList();
    var tmp = document.createElement('div');
    tmp.innerHTML = row(g);
    cat.appendChild(tmp.firstChild);
    catCount(g.cat);
    paintHead();
  }
  function removeRow(g) {
    var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]');
    var drawer = V.el.querySelector('.s-drawer');
    if (!r || !drawer || V.drawer || !open().length) return paintList();
    r.parentNode.removeChild(r);
    catCount(g.cat);
    drawer.querySelector('.num').textContent = '(' + done().length + ')';
    paintHead();
  }
  function flash(g) {
    var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]');
    if (!r) return;
    r.classList.add('is-flash');
    if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    setTimeout(function () { r.classList.remove('is-flash'); }, 1200);
  }

  function paintList() { var l = V.el.querySelector('.s-list'); var st = l.scrollTop; l.innerHTML = listHTML(); l.scrollTop = st; paintHead(); }
  function paintSuggest() { V.el.querySelector('.s-suggest').innerHTML = suggestHTML(); }
  // A store with its own colours themes the view while its tab is open (--store, --store-accent).
  function paintTheme() {
    var shop = V.el.querySelector('.shop'), st = D.stores.filter(function (x) { return x.id === V.store; })[0];
    var on = !!(st && st.color);
    shop.classList.toggle('is-themed', on);
    shop.style.cssText = on ? '--store:' + st.color + ';--store-accent:' + (st.accent || st.color) : '';
  }
  function paintHead() {
    paintTheme();
    var all = D.groceries.filter(function (g) { return !g.done; });
    V.el.querySelector('.s-count').innerHTML = '<span class="num">' + open().length + '</span> to get';
    V.el.querySelector('.s-stores').innerHTML = [['all', 'All']].concat(D.stores.map(function (s) { return [s.id, s.name]; })).map(function (s) {
      var n = s[0] === 'all' ? all.length : all.filter(function (g) { return g.store === s[0]; }).length;
      return '<button class="' + (V.store === s[0] ? 'is-on' : '') + '" data-store="' + s[0] + '">' + s[1] + ' <span class="num">' + n + '</span></button>';
    }).join('');
  }
  function render() {
    V.el.innerHTML = '<div class="shop">' +
      '<header class="s-head"><div><div class="label">Shared list</div><h1 class="serif">Groceries</h1></div><div class="s-count"></div>' +
      (window.PrintList && PrintList.canPrint() ? '<button class="btn s-print" data-print>' + App.icon('print', 26) + ' Print</button>' : '') +
      '<div class="seg s-stores"></div></header>' +
      '<div class="s-list"></div>' +
      '<aside class="s-side">' +
      '  <div class="s-add">' +
      '    <label class="s-input-wrap">' + App.icon('plus', 30) + '<input class="s-input" placeholder="Add an item…" autocomplete="off" enterkeyhint="done"></label>' +
      '  </div>' +
      '  <div class="s-suggest"></div>' +
      '</aside></div>';
    var input = V.el.querySelector('.s-input');
    input.value = V.query;
    input.addEventListener('input', function () { V.query = input.value; paintSuggest(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && input.value.trim()) { add(input.value); } });
    paintList(); paintSuggest();
  }

  // store: where a new item goes (a usual's store); defaults to the open tab.
  function add(name, store) {
    name = name.trim();
    var g = find(name, false), msg;
    if (g) {
      g.qty++;
      save([g]);
      msg = 'Already on the list · now <b>×' + g.qty + '</b> ' + App.esc(g.name);
      var q = V.el.querySelector('.s-list [data-id="' + g.id + '"] .s-qty .num');
      if (q) q.textContent = g.qty;
    } else if ((g = find(name, true))) {
      g.done = false; g.qty = 1;
      save([g]);
      msg = 'Added back <b>' + App.esc(g.name) + '</b>';
      paintList();
    } else {
      var cat = D.catalog.filter(function (c) { return c[0].toLowerCase() === name.toLowerCase(); })[0];
      g = { id: D._gid(), name: cat ? cat[0] : name.charAt(0).toUpperCase() + name.slice(1), cat: categorize(name), qty: 1, store: store || storeFor(null), done: false, note: '' };
      D.groceries.push(g);
      save([g]);
      msg = 'Added <b>' + App.esc(g.name) + '</b> to ' + g.cat + (D.stores.length > 1 ? ' · ' + App.esc(storeName(g.store)) : '');
      insertRow(g);
    }
    var hadQuery = !!V.query.trim();
    V.query = '';
    var input = V.el.querySelector('.s-input');
    if (input) input.value = '';
    if (hadQuery) paintSuggest(); else refreshSuggestFor(g);
    flash(g);
    App.emit('data');
    App.toast(msg, { icon: 'cart', ms: 3000 });
  }

  function check(g) {
    V.pending[g.id] = true;
    var rowEl = V.el.querySelector('[data-id="' + g.id + '"]');
    rowEl.classList.add('is-checking');
    setTimeout(function () {
      if (!V.pending[g.id]) return;
      delete V.pending[g.id];
      g.done = true;
      save([g]);
      removeRow(g);
      refreshSuggestFor(g);
      App.emit('data');
    }, 1200);
    App.toast('<b>' + App.esc(g.name) + '</b> checked off', {
      icon: 'check',
      undo: function () {
        var wasDone = g.done;
        delete V.pending[g.id];
        g.done = false;
        if (wasDone) save([g]);
        if (wasDone) paintList();
        else { var r = V.el.querySelector('.s-list [data-id="' + g.id + '"]'); if (r) r.classList.remove('is-checking'); }
        refreshSuggestFor(g);
        App.emit('data');
      }
    });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-check]'))) {
      var g = D.groceries.filter(function (x) { return x.id === t.dataset.check; })[0];
      if (g && !V.pending[g.id]) check(g);
      else if (g) { delete V.pending[g.id]; t.parentNode.classList.remove('is-checking'); }
      return;
    }
    if ((t = e.target.closest('[data-qty]'))) {
      var q = D.groceries.filter(function (x) { return x.id === t.dataset.id; })[0];
      q.qty = Math.max(1, q.qty + +t.dataset.qty);
      save([q]);
      t.parentNode.querySelector('.num').textContent = q.qty;
      refreshSuggestFor(q);
      return;
    }
    if ((t = e.target.closest('[data-print]'))) return PrintList.print();
    if ((t = e.target.closest('[data-new-usual]'))) return newUsual();
    if ((t = e.target.closest('[data-add]'))) { var u = t.closest('.s-usuals') ? usual(t.dataset.add) : null; return add(t.dataset.add, u ? storeFor(u) : null); }
    if ((t = e.target.closest('[data-store]'))) { V.store = t.dataset.store; paintList(); if (!V.query.trim()) paintSuggest(); return; }
    if ((t = e.target.closest('[data-drawer]'))) { V.drawer = !V.drawer; return paintList(); }
    if ((t = e.target.closest('[data-revive]'))) {
      var r = D.groceries.filter(function (x) { return x.id === t.dataset.revive; })[0];
      r.done = false; save([r]); paintList(); paintSuggest(); App.emit('data');
      return App.toast('Added back <b>' + App.esc(r.name) + '</b>', { icon: 'cart', ms: 2500 });
    }
    if ((t = e.target.closest('[data-clear]'))) {
      var gone = done();
      D.groceries = D.groceries.filter(function (x) { return gone.indexOf(x) < 0; });
      save([], gone.map(function (x) { return x.id; }));
      V.drawer = false;
      paintList();
      App.toast('Cleared ' + gone.length + ' items', {
        icon: 'check', undo: function () { D.groceries = D.groceries.concat(gone); save(gone); paintList(); }
      });
    }
  }

  // The list changed on another screen (shopping-store.js). Redraw the list but not the input,
  // so a half-typed item survives.
  App.on('shopping-remote', function () {
    if (!V.el || App.current !== 'shopping') return;
    paintList();
    if (!V.query.trim()) paintSuggest();
  });

  App.register('shopping', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  });
})();
