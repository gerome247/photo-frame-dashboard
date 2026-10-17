// Prints the shopping list from the kiosk app: draws A4 pages on a canvas (black on white,
// two columns, grouped by aisle, with tick boxes) and hands each one to the kiosk as a JPEG
// (window.HomeHQ.printJpeg, see kiosk IppPrinter.java), which sends it to the network printer.
(function () {
  'use strict';
  var D = window.DATA;
  // A4 at 200 dpi: sharp enough for text, small enough for an old tablet's memory.
  var W = 1654, H = 2339, M = 130, GAP = 70, COL = (W - 2 * M - GAP) / 2;
  var SANS = "'Archivo', 'Roboto', sans-serif", SERIF = "'Instrument Serif', 'Noto Serif', serif";

  function canPrint() {
    try { return !!(window.HomeHQ && window.HomeHQ.canPrint()); } catch (e) { return false; }
  }

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
    ctx.font = '120px ' + SERIF;
    ctx.fillText('Shopping list', M, M + 90);
    ctx.font = '36px ' + SANS; ctx.fillStyle = '#555';
    var d = new Date(), when = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    ctx.fillText(when + (total > 1 ? '  ·  page ' + n + ' of ' + total : ''), M, M + 150);
    ctx.fillStyle = '#000'; ctx.fillRect(M, M + 185, W - 2 * M, 4);
    return { canvas: c, ctx: ctx };
  }

  // Lays the list out; returns canvases. Runs twice: once to count pages, once to draw.
  function layout(total) {
    var pages = [], p = null, col = 0, y = 0, top = M + 250, bottom = H - M;
    var multiStore = D.stores.length > 1;
    function start() { p = newPage(pages.length + 1, total); pages.push(p); col = 0; y = top; }
    function x() { return M + col * (COL + GAP); }
    function need(h) { if (y + h > bottom) { if (col === 0) { col = 1; y = top; } else start(); } }
    start();
    groups().forEach(function (gr) {
      need(130); // keep an aisle heading with at least its first item
      var ctx = p.ctx;
      ctx.font = 'bold 30px ' + SANS; ctx.fillStyle = '#000';
      ctx.fillText(gr.cat.toUpperCase(), x(), y + 30);
      ctx.fillRect(x(), y + 46, COL, 3);
      y += 70;
      gr.items.forEach(function (g) {
        ctx = p.ctx;
        ctx.font = '42px ' + SANS;
        var qty = g.qty > 1 ? '×' + g.qty : '';
        var qtyW = qty ? ctx.measureText(qty).width + 20 : 0;
        var lines = wrap(ctx, g.name, COL - 70 - qtyW);
        var extra = [];
        if (g.note) extra.push(g.note);
        if (multiStore && g.store !== D.stores[0].id) extra.push(D.stores.filter(function (s) { return s.id === g.store; }).map(function (s) { return s.name; })[0] || '');
        ctx.font = '30px ' + SANS;
        var noteLines = extra.length ? wrap(ctx, extra.join(' · '), COL - 70) : [];
        var h = lines.length * 52 + noteLines.length * 38 + 22;
        need(h);
        ctx = p.ctx;
        var bx = x(), by = y;
        ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
        ctx.strokeRect(bx + 2, by + 10, 38, 38);
        ctx.font = '42px ' + SANS; ctx.fillStyle = '#000';
        lines.forEach(function (l, i) { ctx.fillText(l, bx + 70, by + 44 + i * 52); });
        if (qty) { ctx.font = 'bold 42px ' + SANS; ctx.fillText(qty, bx + COL - ctx.measureText(qty).width, by + 44); }
        ctx.font = '30px ' + SANS; ctx.fillStyle = '#555';
        noteLines.forEach(function (l, i) { ctx.fillText(l, bx + 70, by + 44 + lines.length * 52 - 8 + i * 38); });
        y += h;
      });
      y += 26;
    });
    return pages;
  }

  var busy = false;
  function print() {
    if (busy) return;
    if (!groups().length) return App.toast('Nothing to print · the list is empty', { icon: 'cart', ms: 3000 });
    busy = true;
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(function () {
      var count = layout(1).length;
      var jpegs = layout(count).map(function (pg) { return pg.canvas.toDataURL('image/jpeg', 0.9).split(',')[1]; });
      App.toast('Printing ' + (count > 1 ? count + ' pages' : 'the list') + '…', { icon: 'cart', ms: 20000 });
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

  window.PrintList = { canPrint: canPrint, print: print, _layout: layout };
})();
