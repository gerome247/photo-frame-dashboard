// Entry point. Order matters: each module attaches to the shared window.App.
import './icons.js';
import './data.js';
import { eventsFromCalendars } from './calendar-feed.js';
import * as shopping from './shopping-store.js';

// The demo events are fake; real ones come from the calendar feeds below.
window.DATA.events = [];
window.DATA.busyExtras = [];

// Live data from the Worker (/api/data) replaces the demo values before anything renders.
// If it fails, the demo weather is still there, so the page never goes blank.
function loadLive() {
  return fetch('/api/data')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (live) {
      if (!live) return;
      if (live.weather) window.DATA.weather = live.weather;
      // Only replace events when every feed arrived, so one failed fetch doesn't blank a person.
      if (live.calendars && live.calendars.every(function (c) { return c.ics; })) {
        window.DATA.events = eventsFromCalendars(live.calendars, Date.now());
        if (window.App && window.App.rerender) window.App.rerender();
      }
    })
    .catch(function (err) { console.error('live data', err); });
}
// Real photos (built by scripts/build-photos.mjs). Until some are added, the demo photos stay.
await fetch('/photos/index.json')
  .then(function (r) { return r.ok ? r.json() : []; })
  .then(function (photos) { if (photos.length) window.DATA.photos = photos; })
  .catch(function () {});

await loadLive();

// The real shopping list (D1, via the Worker). The demo list is fake, so start empty if it
// can't load yet; the 30 s refresh fills it in.
await shopping.load().catch(function (err) {
  console.error('shopping list', err);
  window.DATA.groceries = [];
});
window.DATA.shopping = shopping;
setInterval(loadLive, 30 * 60 * 1000); // the home view redraws the weather at the top of each hour

await import('./app.js');
await import('./system.js');
await import('./slideshow.js');
await import('./views/home.js');
await import('./views/calendar.js');
await import('./views/tasks.js');
await import('./print-list.js');
await import('./views/shopping.js');
await import('./views/photos.js');
await import('./views/control.js');
await import('./views/agents.js');
await import('./views/ambient.js');
await import('./diag.js');
window.App.start();
shopping.watch(function () { window.App.emit('shopping-remote'); window.App.emit('data'); });
