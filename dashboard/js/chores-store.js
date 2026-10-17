// Keeps the chores in step with the Worker (/api/chores, stored in D1).
// The Worker holds chore definitions (title, icon, who, routine, stars, weekdays) and one tick
// per chore, person and day. From those this builds what the views already use:
// - DATA.chores: today's chores, one entry per person a chore is for (a chore for "maya,otto"
//   shows in both lanes and each ticks it), with done / doneBy for today. id = "<chore>|<who>",
//   defId = the chore.
// - DATA.stars: stars earned so far, per kid
// - DATA.week: Mon..Sun, 1 = all that kid's chores done that day, 0 = not, null = future or
//   nothing to do (no chores that day, or only ones added later)
// - DATA.choreDefs: every chore, for the editor
var D = window.DATA;
var POLL_MS = 30 * 1000;
var KIDS = Object.keys(D.stars); // the people whose lanes show stars (from data.js)
var busy = 0;

function pad(n) { return (n < 10 ? '0' : '') + n; }
export function dayStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function weekday(d) { return (d.getDay() + 6) % 7; } // Mon = 0
function monday(d) { var m = new Date(d); m.setDate(d.getDate() - weekday(d)); return m; }

// The demo clock (App.now) once app.js has loaded, else the real time.
function now() { return window.App && window.App.now ? window.App.now() : new Date(); }

D._cid = function () { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };

function whoOf(c) { return c.who.split(','); }

// Saturday and Sunday have no school: the middle routine is "Afternoon" then.
function nameRoutines(t) {
  var after = D.routines.filter(function (r) { return r.id === 'after'; })[0];
  if (after) after.name = weekday(t) >= 5 ? 'Afternoon' : 'After school';
}

function apply(data) {
  var t = now(), today = dayStr(t), wd = weekday(t);
  nameRoutines(t);
  var doneOn = {};
  data.done.forEach(function (x) { (doneOn[x.day] = doneOn[x.day] || {})[x.id + '|' + x.who] = x; });
  var old = {};
  (D.chores || []).forEach(function (c) { old[c.id] = c; });
  D.choreDefs = data.chores;
  D.chores = [];
  data.chores.filter(function (c) { return c.days.charAt(wd) === '1'; }).forEach(function (c) {
    whoOf(c).forEach(function (who) {
      var id = c.id + '|' + who, d = (doneOn[today] || {})[id];
      var o = old[id] || {};
      o.id = id; o.defId = c.id; o.r = c.r; o.who = who; o.title = c.title; o.icon = c.icon; o.stars = c.stars; o.days = c.days;
      o.done = !!d;
      if (d && d.by) o.doneBy = d.by; else delete o.doneBy;
      D.chores.push(o);
    });
  });
  var stars = {};
  KIDS.forEach(function (k) { stars[k] = data.stars[k] || 0; });
  D.stars = stars;
  var mon = monday(t), week = {};
  KIDS.forEach(function (k) {
    week[k] = [0, 1, 2, 3, 4, 5, 6].map(function (i) {
      if (i > wd) return null;
      var day = new Date(mon); day.setDate(mon.getDate() + i);
      var end = new Date(day); end.setHours(23, 59, 59, 999);
      var mine = data.chores.filter(function (c) {
        return whoOf(c).indexOf(k) >= 0 && c.days.charAt(i) === '1' && (!c.created || c.created <= end.getTime());
      });
      if (!mine.length) return null;
      var done = doneOn[dayStr(day)] || {};
      return mine.every(function (c) { return done[c.id + '|' + k]; }) ? 1 : 0;
    });
  });
  D.week = week;
}

function signature() {
  return JSON.stringify([D.choreDefs, D.chores.map(function (c) { return [c.id, c.done, c.doneBy]; }), D.stars]);
}

export function load() {
  var t = now();
  return fetch('/api/chores?from=' + dayStr(monday(t)) + '&to=' + dayStr(t), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { var before = D.choreDefs ? signature() : ''; apply(data); return before !== signature(); });
}

function post(path, body) {
  busy++;
  var t = now();
  return fetch(path + '?from=' + dayStr(monday(t)) + '&to=' + dayStr(t), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { busy--; apply(data); return true; })
    .catch(function (err) {
      busy--;
      console.error('chores save', err);
      App.toast('Couldn’t save the chore. Check the Wi-Fi.', { icon: 'x', ms: 5000 });
      return false;
    });
}

// Ticks a chore off (or back on) for today. earner gets the stars.
export function setDone(c, done, by, earner) {
  return post('/api/chores/done', { id: c.defId, who: c.who, day: dayStr(now()), done: done, by: by || null, earner: earner || null, stars: c.stars });
}
export function saveChore(def) { return post('/api/chores', { upsert: [def] }); }
export function deleteChore(id) { return post('/api/chores', { delete: [id] }); }

// Refreshes every 30 s (also rolls over to the new day at midnight); onChange runs if it changed.
export function watch(onChange) {
  setInterval(function () {
    if (busy) return;
    load().then(function (changed) { if (changed) onChange(); }).catch(function (err) { console.error('chores refresh', err); });
  }, POLL_MS);
}
