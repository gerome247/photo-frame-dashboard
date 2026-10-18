// Keeps DATA.groceries in step with the Worker's shopping list (/api/shopping, stored in D1).
// - load() replaces the demo list before anything renders.
// - save(items, deletedIds) sends only what changed, so two screens editing different items
//   don't overwrite each other. Unsent changes are kept and retried.
// - Every 30 s the list is fetched again, so a change made on the other screen shows up here.
// - The usuals (quick-add tiles) come with the list; saveUsuals(list) replaces them.
var D = window.DATA;
var queue = { upsert: {}, del: {} }; // changes not yet sent
var inflight = { upsert: {}, del: {} }; // sent, not yet confirmed by the Worker
var sending = false;
var POLL_MS = 30 * 1000;

// Random ids: the demo's g1, g2… would collide between two screens.
D._gid = function () {
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};

function copy(g) {
  return { id: g.id, name: g.name, cat: g.cat, qty: g.qty, store: g.store, done: !!g.done, note: g.note || '' };
}

// Server list plus this screen's unsent changes, in the server's order.
function apply(items) {
  var byId = {}, ups = {}, dels = {};
  [inflight, queue].forEach(function (q) { // later changes win
    Object.keys(q.upsert).forEach(function (id) { delete dels[id]; ups[id] = q.upsert[id]; });
    Object.keys(q.del).forEach(function (id) { delete ups[id]; dels[id] = true; });
  });
  items = items.filter(function (g) { return !dels[g.id]; }).map(function (g) {
    byId[g.id] = true;
    return ups[g.id] ? copy(ups[g.id]) : g;
  });
  Object.keys(ups).forEach(function (id) { if (!byId[id]) items.push(copy(ups[id])); });
  // Keep the objects the shopping view holds on to, so a pending check-off isn't lost.
  var old = {};
  D.groceries.forEach(function (g) { old[g.id] = g; });
  D.groceries = items.map(function (g) {
    var o = old[g.id];
    if (!o) return g;
    o.name = g.name; o.cat = g.cat; o.qty = g.qty; o.store = g.store; o.done = g.done; o.note = g.note;
    return o;
  });
}

function same(a, b) {
  return JSON.stringify(a.map(copy)) === JSON.stringify(b.map(copy));
}

// The saved usuals, unless a change to them is still on its way (null: keep the built-in list).
var usualsSending = false;
function applyUsuals(list) {
  if (!Array.isArray(list) || usualsSending) return false;
  var changed = JSON.stringify(list) !== JSON.stringify(D.usuals);
  D.usuals = list;
  return changed;
}

export function load() {
  return fetch('/api/shopping', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      var before = D.groceries.slice();
      apply(data.items);
      var usualsChanged = applyUsuals(data.usuals);
      return !same(before, D.groceries) || usualsChanged;
    });
}

// Replaces the usuals. Resolves when saved; on failure the previous list comes back.
export function saveUsuals(list) {
  var before = D.usuals;
  D.usuals = list;
  usualsSending = true;
  return fetch('/api/shopping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuals: list })
  })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { usualsSending = false; applyUsuals(data.usuals); })
    .catch(function (err) { usualsSending = false; D.usuals = before; throw err; });
}

function flush() {
  var ids = Object.keys(queue.upsert), dels = Object.keys(queue.del);
  if (sending || (!ids.length && !dels.length)) return;
  var sent = inflight = { upsert: queue.upsert, del: queue.del };
  queue = { upsert: {}, del: {} };
  sending = true;
  fetch('/api/shopping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upsert: ids.map(function (id) { return sent.upsert[id]; }), delete: dels })
  })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { sending = false; inflight = { upsert: {}, del: {} }; apply(data.items); flush(); })
    .catch(function (err) {
      console.error('shopping save', err);
      sending = false;
      inflight = { upsert: {}, del: {} };
      // Put the unsent changes back, under any newer ones made since.
      Object.keys(sent.upsert).forEach(function (id) { if (!queue.upsert[id] && !queue.del[id]) queue.upsert[id] = sent.upsert[id]; });
      Object.keys(sent.del).forEach(function (id) { if (!queue.upsert[id]) queue.del[id] = true; });
    });
}

export function save(items, deletedIds) {
  (items || []).forEach(function (g) { delete queue.del[g.id]; queue.upsert[g.id] = copy(g); });
  (deletedIds || []).forEach(function (id) { delete queue.upsert[id]; queue.del[id] = true; });
  flush();
}

// Starts the 30 s refresh; onChange runs when the list changed on another screen.
export function watch(onChange) {
  setInterval(function () {
    if (sending) return;
    flush(); // retry anything that failed to send
    load().then(function (changed) { if (changed) onChange(); }).catch(function (err) { console.error('shopping refresh', err); });
  }, POLL_MS);
}
