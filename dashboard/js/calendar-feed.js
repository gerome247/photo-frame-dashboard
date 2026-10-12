// Turns the raw ICS feeds from /api/data into DATA.events entries.
// Parsed here (on the tablet) rather than in the Worker, to stay under the free plan's CPU limit.
import ICAL from 'ical.js';

// Calendar name (left side of dashboard/.calendars) -> person ids. A calendar may be named after a
// person's display name (from local.config.json) or id, or "family" for everyone.
function whoMap() {
  var map = { family: window.DATA.people.map(function (p) { return p.id; }) };
  window.DATA.people.forEach(function (p) { map[p.id] = [p.id]; map[String(p.name).toLowerCase()] = [p.id]; });
  return map;
}

var DAY = 864e5;
var MAX_OCCURRENCES = 1000; // per recurring event, guards against runaway RRULEs

// All-day dates are floating ("2026-10-12"), so build them in the tablet's local time.
function toDate(t) {
  return t.isDate ? new Date(t.year, t.month - 1, t.day) : t.toJSDate();
}

function add(out, seen, uid, start, end, item, people) {
  var s = toDate(start), e = toDate(end);
  var key = uid + '|' + s.getTime();
  if (seen[key]) { // same event on two calendars (e.g. an invite): merge the people
    people.forEach(function (p) { if (seen[key].people.indexOf(p) < 0) seen[key].people.push(p); });
    return;
  }
  var loc = item.location;
  var ev = { id: 'cal' + out.length, title: item.summary || '(No title)', start: s, end: e, people: people.slice() };
  if (start.isDate) ev.allDay = true;
  if (loc) ev.loc = loc;
  seen[key] = ev;
  out.push(ev);
}

export function eventsFromCalendars(calendars, now) {
  var from = ICAL.Time.fromJSDate(new Date(now - 45 * DAY));
  var to = ICAL.Time.fromJSDate(new Date(now + 90 * DAY));
  var out = [], seen = {}, WHO = whoMap();

  calendars.forEach(function (cal) {
    var people = WHO[cal.who];
    if (!cal.ics || !people) return;
    try {
      var comp = new ICAL.Component(ICAL.parse(cal.ics));
      comp.getAllSubcomponents('vtimezone').forEach(function (tz) { ICAL.TimezoneService.register(tz); });

      var masters = {}, exceptions = [];
      comp.getAllSubcomponents('vevent').forEach(function (v) {
        if (String(v.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
        if (v.hasProperty('recurrence-id')) exceptions.push(v);
        else masters[v.getFirstPropertyValue('uid')] = new ICAL.Event(v);
      });
      // Moved/edited single occurrences of a recurring event.
      exceptions.forEach(function (v) {
        var m = masters[v.getFirstPropertyValue('uid')];
        if (m) m.relateException(new ICAL.Event(v));
        else masters[v.getFirstPropertyValue('uid') + '|' + v.getFirstPropertyValue('recurrence-id')] = new ICAL.Event(v); // lone invite instance
      });

      Object.keys(masters).forEach(function (uid) {
        var e = masters[uid];
        if (!e.startDate) return;
        if (!e.isRecurring()) {
          var end = e.endDate || e.startDate;
          if (e.startDate.compare(to) < 0 && end.compare(from) >= 0) add(out, seen, uid, e.startDate, end, e, people);
          return;
        }
        var it = e.iterator(), t, n = 0;
        while ((t = it.next()) && t.compare(to) < 0 && n++ < MAX_OCCURRENCES) {
          var d = e.getOccurrenceDetails(t);
          if (d.endDate.compare(from) >= 0) add(out, seen, uid, d.startDate, d.endDate, d.item, people);
        }
      });
    } catch (err) {
      console.error('calendar ' + cal.who, err);
    }
  });

  out.sort(function (a, b) { return a.start - b.start; });
  return out;
}
