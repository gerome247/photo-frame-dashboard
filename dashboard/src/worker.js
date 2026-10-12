// Gatekeeper for the dashboard: nothing (not even index.html) is served without the key.
// - Visit /?key=<DASH_KEY> once: sets a long-lived cookie and redirects to the clean URL.
// - After that the cookie is enough. Wrong/missing key → 404, so the site looks empty.
// Set the key with: npx wrangler secret put DASH_KEY

const COOKIE = 'dash_key';
const MAX_AGE = 400 * 24 * 60 * 60; // browsers cap cookie lifetime at 400 days

async function same(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ------------------------------------------------------------ live data

// Location comes from LATITUDE / LONGITUDE / TIMEZONE vars, set at deploy time from the
// private local.config.json by scripts/deploy.mjs (rounded to ~1 km).
function weatherUrl(env) {
  const q = new URLSearchParams({
    latitude: Number(env.LATITUDE).toFixed(2),
    longitude: Number(env.LONGITUDE).toFixed(2),
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
    current: 'apparent_temperature,relative_humidity_2m,wind_speed_10m',
    forecast_days: '2',
    timezone: env.TIMEZONE || 'auto',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + q;
}

// WMO weather code -> one of the dashboard's five weather icons (no snow/storm icons exist).
function icon(code, isDay) {
  if (code <= 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return isDay ? 'partly' : 'cloud'; // no night version of the partly icon
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  return 'cloud'; // 3 overcast, 45/48 fog, 71-77/85-86 snow
}

// Same shape as DATA.weather, but 48 hourly slots (today + tomorrow, index = hours since midnight today).
async function getWeather(env) {
  if (!env.LATITUDE || !env.LONGITUDE) return null; // no location configured: keep demo weather
  const res = await fetch(weatherUrl(env));
  if (!res.ok) throw new Error('open-meteo ' + res.status);
  const w = await res.json();
  const h = w.hourly;
  return {
    hi: Math.round(w.daily.temperature_2m_max[0]),
    lo: Math.round(w.daily.temperature_2m_min[0]),
    feels: Math.round(w.current.apparent_temperature),
    humidity: Math.round(w.current.relative_humidity_2m),
    wind: Math.round(w.current.wind_speed_10m),
    t: h.temperature_2m.map(Math.round),
    c: h.weather_code.map((code, i) => icon(code, h.is_day[i])),
    p: h.precipitation_probability.map((x) => x ?? 0),
  };
}

// CALENDARS secret: one "person = secret iCal URL" per line (copy of dashboard/.calendars).
// The raw ICS text is passed through and parsed on the tablet: parsing costs ~80 ms CPU per
// calendar, well over the free plan's 10 ms per request.
async function getCalendars(env) {
  const lines = (env.CALENDARS || '').split('\n').filter((l) => l.includes('='));
  return Promise.all(
    lines.map(async (line) => {
      const who = line.slice(0, line.indexOf('=')).trim().toLowerCase();
      const url = line.slice(line.indexOf('=') + 1).trim();
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return { who, ics: await res.text() };
      } catch (err) {
        console.error('calendar', who, err.message);
        return { who, ics: null };
      }
    }),
  );
}

function cookieValue(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export default {
  async fetch(request, env) {
    if (!env.DASH_KEY) return new Response('DASH_KEY not configured', { status: 500 });

    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    if (key !== null) {
      if (!(await same(key, env.DASH_KEY))) return new Response('Not found', { status: 404 });
      url.searchParams.delete('key');
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.pathname + url.search,
          'Set-Cookie': `${COOKIE}=${env.DASH_KEY}; Max-Age=${MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (!(await same(cookieValue(request), env.DASH_KEY))) {
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname === '/api/data') {
      const [weather, calendars] = await Promise.all([
        getWeather(env).catch((err) => {
          console.error('weather', err);
          return null;
        }),
        getCalendars(env),
      ]);
      return Response.json({ weather, calendars }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    // Hashed files (Vite's /assets/*, scripts/build-photos.mjs's /photos/<hash>.jpg) never change
    // under the same name, so the tablet may keep them; this saves most requests from the slideshow.
    const immutable = /^\/(assets\/|photos\/[0-9a-f]+\.jpg$)/.test(url.pathname);
    out.headers.set('Cache-Control', immutable && res.ok ? 'private, max-age=31536000, immutable' : 'private, no-store');
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  },
};
