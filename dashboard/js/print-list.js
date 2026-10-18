// Prints the shopping list: draws A4 pages on a canvas (black on white, two columns, grouped by
// aisle, with tick boxes). The kiosk app gets each page as a JPEG (window.HomeHQ.printJpeg, see
// kiosk IppPrinter.java) and sends it to the network printer. Other browsers (phones, iPads,
// desktops) print the same pages through the browser's print dialog (AirPrint on an iPhone).
(function () {
  'use strict';
  var D = window.DATA;
  // A4 at 200 dpi: sharp enough for text, small enough for an old tablet's memory.
  var W = 1654, H = 2339, M = 110, GAP = 60, TOP = M + 200;
  var SANS = "'Archivo', 'Roboto', sans-serif", SERIF = "'Instrument Serif', 'Noto Serif', serif";

  function kioskPrint() {
    try { return !!(window.HomeHQ && window.HomeHQ.canPrint()); } catch (e) { return false; }
  }
  // The kiosk's WebView has no print dialog, so the wall screens print only through the kiosk.
  function canPrint() { return kioskPrint() || !!(window.App && !App.wall); }

  // Open items in aisle order; returns [{cat, items}].
  function groups() {
    var open = D.groceries.filter(function (g) { return !g.done; });
    return D.catOrder.all.concat(['Other']).map(function (cat) {
      return { cat: cat, items: open.filter(function (g) { return g.cat === cat || (cat === 'Other' && D.catOrder.all.indexOf(g.cat) < 0); }) };
    }).filter(function (x) { return x.items.length; });
  }

  // Splits text into lines that fit width (word wrap; a long word is left as is).
  function wrap(ctx, text, width) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      var next = line ? line + ' ' + w : w;
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = w; } else line = next;
    });
    if (line) lines.push(line);
    return lines;
  }

  function newPage(n, total) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    // Software canvas: on the PF1007 frame's GPU a large accelerated canvas loses its blue channel
    // (white turns yellow and text vanishes). willReadFrequently keeps it on the CPU.
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic';
    ctx.font = '84px ' + SERIF;
    ctx.fillText('Shopping list', M, M + 66);
    ctx.font = '30px ' + SANS; ctx.fillStyle = '#555';
    var d = new Date(), when = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    var right = when + (total > 1 ? '  ·  page ' + n + ' of ' + total : '');
    ctx.fillText(right, W - M - ctx.measureText(right).width, M + 66);
    ctx.fillStyle = '#000'; ctx.fillRect(M, M + 100, W - 2 * M, 4);
    return { canvas: c, ctx: ctx };
  }

  // Lays the list out in `cols` columns, each at most `limit` px tall (shorter than the page to
  // balance the columns). Returns { pages, height }; height is the column height used when it
  // runs as one endless column of that width (limit Infinity), which is how plan() measures it.
  function layout(total, cols, limit) {
    var pages = [], p = null, col = 0, y = 0;
    var bottom = TOP + Math.min(limit, H - M - TOP);
    var COL = (W - 2 * M - (cols - 1) * GAP) / cols;
    var multiStore = D.stores.length > 1;
    function start() { p = newPage(pages.length + 1, total); pages.push(p); col = 0; y = TOP; }
    function x() { return M + col * (COL + GAP); }
    function need(h) {
      if (limit === Infinity || y + h <= bottom || y === TOP) return;
      if (col < cols - 1) { col++; y = TOP; } else start();
    }
    start();
    groups().forEach(function (gr) {
      need(108); // keep an aisle heading with at least its first item
      var ctx = p.ctx;
      ctx.font = 'bold 26px ' + SANS; ctx.fillStyle = '#000';
      ctx.fillText(gr.cat.toUpperCase(), x(), y + 26);
      ctx.fillRect(x(), y + 38, COL, 3);
      y += 56;
      gr.items.forEach(function (g) {
        ctx = p.ctx;
        ctx.font = '34px ' + SANS;
        var qty = g.qty > 1 ? '×' + g.qty : '';
        var qtyW = qty ? ctx.measureText(qty).width + 16 : 0;
        var lines = wrap(ctx, g.name, COL - 56 - qtyW);
        var extra = [];
        if (g.note) extra.push(g.note);
        if (multiStore && g.store !== D.stores[0].id) extra.push(D.stores.filter(function (s) { return s.id === g.store; }).map(function (s) { return s.name; })[0] || '');
        ctx.font = '26px ' + SANS;
        var noteLines = extra.length ? wrap(ctx, extra.join(' · '), COL - 56) : [];
        var h = lines.length * 42 + noteLines.length * 30 + 10;
        need(h);
        ctx = p.ctx;
        var bx = x(), by = y;
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.strokeRect(bx + 2, by + 6, 30, 30);
        ctx.font = '34px ' + SANS; ctx.fillStyle = '#000';
        lines.forEach(function (l, i) { ctx.fillText(l, bx + 56, by + 34 + i * 42); });
        if (qty) { ctx.font = 'bold 34px ' + SANS; ctx.fillText(qty, bx + COL - ctx.measureText(qty).width, by + 34); }
        ctx.font = '26px ' + SANS; ctx.fillStyle = '#555';
        noteLines.forEach(function (l, i) { ctx.fillText(l, bx + 56, by + 34 + lines.length * 42 - 6 + i * 30); });
        y += h;
      });
      y += 20;
    });
    return { pages: pages, height: y - TOP };
  }

  // Picks the layout: two columns, or three for a long list (more than two full columns). A list
  // that fits on one page gets balanced columns, so a short list spreads across the page instead
  // of running down the left; a longer one fills each page in turn.
  function plan() {
    var page = H - M - TOP, cols = 2, height = layout(1, 2, Infinity).height;
    if (height > page * 2) { cols = 3; height = layout(1, 3, Infinity).height; }
    var limit = height <= page * cols ? Math.min(page, Math.ceil(height / cols) + 90) : page;
    var count = layout(1, cols, limit).pages.length;
    if (count > 1 && limit < page) { limit = page; count = layout(1, cols, limit).pages.length; }
    return layout(count, cols, limit).pages;
  }

  // Browser print (phones, iPads, desktops). Two steps, because Safari blocks a print() that
  // does not come straight from a tap, and prints canvases as blank pages: the Print button opens
  // a preview sheet that turns the pages into pictures; its own Print button then prints at once.
  // The pictures go into .print-pages, the only thing shown when printing (see base.css).
  function browserPrint() {
    var urls = [], box = document.querySelector('.print-pages');
    if (!box) { box = document.createElement('div'); box.className = 'print-pages'; document.body.appendChild(box); }
    function jpeg(canvas) {
      return new Promise(function (ok) {
        if (canvas.toBlob) canvas.toBlob(function (b) { ok(URL.createObjectURL(b)); }, 'image/jpeg', 0.9);
        else ok(canvas.toDataURL('image/jpeg', 0.9));
      });
    }
    function loaded(img) {
      return img.decode ? img.decode().catch(function () {}) : new Promise(function (ok) { img.onload = img.onerror = ok; });
    }
    App.sheet('<div class="sheet-pad"><div class="label">Shopping list</div><h2 class="serif sheet-h">Print</h2>' +
      '<div class="print-preview"><p class="sheet-p">Getting the pages ready…</p></div>' +
      '<div class="sheet-actions"><button class="btn btn--solid" data-print-now disabled>' + App.icon('print', 22) + ' Print</button></div></div>', {
      onMount: function (s) {
        var btn = s.querySelector('[data-print-now]'), preview = s.querySelector('.print-preview');
        (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () {
          return Promise.all(plan().map(function (pg) { return jpeg(pg.canvas); }));
        }).then(function (list) {
          urls = list;
          var tags = urls.map(function (u) { return '<img src="' + u + '" alt="">'; }).join('');
          box.innerHTML = tags;
          preview.innerHTML = tags;
          return Promise.all(App.$$('img', box).map(loaded));
        }).then(function () {
          btn.disabled = false;
        }).catch(function (err) {
          console.error('print', err);
          preview.innerHTML = '<p class="sheet-p">Couldn’t get the pages ready.</p>';
        });
        btn.addEventListener('click', function () { if (!btn.disabled) window.print(); });
      },
      onClose: function () {
        box.innerHTML = '';
        urls.forEach(function (u) { if (u.indexOf('blob:') === 0) URL.revokeObjectURL(u); });
      }
    });
  }

  var busy = false;
  function print() {
    if (busy) return;
    if (!groups().length) return App.toast('Nothing to print · the list is empty', { icon: 'cart', ms: 3000 });
    if (!kioskPrint()) return browserPrint();
    busy = true;
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(function () {
      var jpegs = plan().map(function (pg) { return pg.canvas.toDataURL('image/jpeg', 0.9).split(',')[1]; });
      App.toast('Printing ' + (jpegs.length > 1 ? jpegs.length + ' pages' : 'the list') + '…', { icon: 'cart', ms: 20000 });
      var i = 0;
      window.HomeHQPrinted = function (error) {
        if (error) {
          busy = false;
          return App.toast('Couldn’t print: ' + App.esc(error), { icon: 'x', ms: 6000 });
        }
        if (++i < jpegs.length) return window.HomeHQ.printJpeg(jpegs[i], 'Shopping list ' + (i + 1));
        busy = false;
        App.toast('Sent to the printer', { icon: 'check', ms: 4000 });
      };
      window.HomeHQ.printJpeg(jpegs[0], 'Shopping list');
    }).catch(function (err) {
      busy = false;
      console.error('print', err);
      App.toast('Couldn’t print', { icon: 'x', ms: 5000 });
    });
  }

  window.PrintList = { canPrint: canPrint, print: print, _plan: plan };
})();
