// Theater panel server: serves the panel UI, a small JSON API over Plex / Seerr / Music
// Assistant, an image cache, and a Server-Sent Events stream of the theater's HA entities.
// No framework and no build step; Node's http module is enough for one wall panel.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import { config, watchedEntities } from './config.mjs';
import { HomeAssistant } from './ha.mjs';
import * as plex from './plex.mjs';
import * as seerr from './seerr.mjs';
import { initImageCache, serveImage, extImage } from './images.mjs';
import { runAction, musicLibrary, musicSearch, musicQueue } from './actions.mjs';
import { gameEntities, gamesState, steamLibrary } from './games.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(root, 'web');
const MODULES = join(root, 'node_modules');

// Browser paths for third-party files, so the page loads nothing from the internet.
const VENDOR = {
  '/vendor/preact.mjs': 'preact/dist/preact.module.js',
  '/vendor/preact-hooks.mjs': 'preact/hooks/dist/hooks.module.js',
  '/vendor/htm.mjs': 'htm/dist/htm.module.js',
};
const FONTS = /^\/fonts\/((big-shoulders-display|ibm-plex-sans|ibm-plex-mono)-latin-\d{3}-normal\.woff2)$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

// ---------- Home Assistant bridge ----------

// Entities streamed to the panel: the theater's own, plus the gaming PC's power and sensors.
const entities = [...new Set([...watchedEntities(), ...(await gameEntities())])];
const ha = new HomeAssistant({ url: config.ha.url, token: config.ha.token, entities });
const clients = new Set();
function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(line);
}
ha.on('states', (changed) => broadcast('states', changed));
ha.on('status', (connected) => broadcast('ha', { connected }));

// Plex sessions: polled only while someone is looking, faster while something is playing.
let sessions = [];
async function pollSessions() {
  let next = 30000;
  if (clients.size && config.plex.url) {
    try {
      const all = await plex.sessions();
      const mine = config.plexPlayerName ? all.filter((s) => s.player === config.plexPlayerName) : all;
      if (JSON.stringify(mine) !== JSON.stringify(sessions)) { sessions = mine; broadcast('sessions', sessions); }
      if (mine.length) next = 5000;
    } catch (e) { /* Plex unreachable: keep the last known state */ }
    const tv = ha.states[config.entities.appleTv]?.state;
    if (tv === 'playing' || tv === 'paused') next = 5000;
  }
  setTimeout(pollSessions, next);
}

// ---------- HTTP ----------

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(s);
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new Error('Body too large'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

// The app icons are public so Unraid's Docker page and bookmarks can show them.
const PUBLIC = new Set(['/assets/icon.png', '/assets/apple-touch-icon.png']);

function authorized(req, url, res) {
  if (!config.panelKey || PUBLIC.has(url.pathname)) return true;
  const cookie = /(?:^|;\s*)tp_key=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  const given = url.searchParams.get('key') || (cookie && decodeURIComponent(cookie)) || '';
  const a = Buffer.from(given); const b = Buffer.from(config.panelKey);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (ok && url.searchParams.get('key')) {
    res.setHeader('set-cookie', `tp_key=${encodeURIComponent(config.panelKey)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`);
  }
  return ok;
}

async function serveFile(res, file, cache = 'no-cache') {
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': cache });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}

const routes = [];
const get = (re, fn) => routes.push(['GET', re, fn]);
const post = (re, fn) => routes.push(['POST', re, fn]);

get(/^\/api\/state$/, () => ({
  ha: { connected: ha.connected, configured: ha.configured, states: ha.states },
  sessions,
  entities: config.entities,
  ui: config.ui,
  services: { plex: Boolean(config.plex.url), seerr: Boolean(config.seerr.url) },
}));

get(/^\/api\/plex\/libraries$/, () => plex.libraries());
get(/^\/api\/plex\/library\/(\d+)$/, (m, q) => plex.listLibrary(m[1], {
  filters: (q.get('filters') || '').split(',').filter(Boolean), genre: q.get('genre') || undefined,
  brand: q.get('brand') || undefined,
  sort: q.get('sort') || 'added', start: Number(q.get('start') || 0), size: Math.min(Number(q.get('size') || 60), 120),
}));
get(/^\/api\/plex\/genres\/(\d+)$/, (m) => plex.genres(m[1]));
get(/^\/api\/plex\/brand\/([a-z]+)$/, (m, q) => plex.brandBrowse(m[1], { filters: (q.get('filters') || '').split(',').filter(Boolean), size: Math.min(Number(q.get('size') || 60), 120) }));
get(/^\/api\/networks$/, () => (config.seerr.url ? seerr.networks() : [])); 
get(/^\/api\/plex\/item\/(\d+)$/, (m) => plex.item(m[1]));
get(/^\/api\/plex\/episodes\/(\d+)$/, (m) => plex.episodes(m[1]));
get(/^\/api\/plex\/ondeck$/, (m, q) => plex.onDeck(Number(q.get('size') || 12)));
get(/^\/api\/plex\/recent$/, (m, q) => plex.recentlyAdded(Number(q.get('size') || 16)));
get(/^\/api\/plex\/search$/, (m, q) => plex.search(q.get('q') || ''));

get(/^\/api\/seerr\/search$/, (m, q) => seerr.search(q.get('q') || '', q.get('page') || 1));
get(/^\/api\/seerr\/discover\/(trending|movies|tv)$/, (m, q) => seerr.discover(m[1], q.get('page') || 1));
get(/^\/api\/seerr\/provider\/([a-z]+)$/, (m, q) => seerr.byProvider(m[1], q.get('type') === 'tv' ? 'tv' : 'movie', q.get('page') || 1));
get(/^\/api\/seerr\/(movie|tv)\/(\d+)$/, (m) => seerr.details(m[1], m[2]));
get(/^\/api\/seerr\/requests$/, (m, q) => seerr.requests(Math.min(Number(q.get('take') || 8), 30)));
get(/^\/api\/seerr\/counts$/, () => seerr.counts());
post(/^\/api\/seerr\/request$/, (m, q, body) => seerr.request(body));

get(/^\/api\/music\/library$/, (m, q) => musicLibrary(ha, { type: q.get('type') || 'album', order: q.get('order') || 'timestamp_added_desc', limit: Math.min(Number(q.get('limit') || 24), 60) }));
get(/^\/api\/music\/search$/, (m, q) => musicSearch(ha, q.get('q') || ''));
get(/^\/api\/music\/queue$/, (m, q) => musicQueue(ha, q.get('entity_id')));

get(/^\/api\/games$/, () => gamesState());
get(/^\/api\/steam\/library$/, () => steamLibrary());

// Move every open panel to a route (#/showtime, #/watch?brand=netflix, #/games...). Kiosk
// Satellite's navigate service now moves the HA page around the panel, so HA automations reach
// the panel's own routes through here (rest_command.theater_panel_navigate in ha/theater.yaml).
post(/^\/api\/navigate$/, (m, q, body) => {
  const route = String(body.route || '');
  if (!/^#?\/?[a-z]+(\?[\w=&%.-]*)?$/i.test(route)) throw new Error('Bad route');
  broadcast('navigate', { route });
  return { ok: true, panels: clients.size };
});

post(/^\/api\/action$/, async (m, q, body) => { await runAction(ha, body); return { ok: true }; });

// The panel runs inside Home Assistant's Webpage dashboard, so it must be frameable by HA
// (and nothing else). FRAME_ANCESTORS lists the extra origins allowed to embed it, space- or
// comma-separated, e.g. https://home-iot.coulson.io; the panel's own origin is always allowed.
const FRAME_ANCESTORS = ["'self'", ...(process.env.FRAME_ANCESTORS || '').split(/[\s,]+/).filter((o) => /^https?:\/\/[\w.-]+(:\d+)?$/.test(o))].join(' ');

const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', `frame-ancestors ${FRAME_ANCESTORS}`);
  const url = new URL(req.url, 'http://panel');
  const path = url.pathname;
  try {
    if (!authorized(req, url, res)) {
      res.writeHead(401, { 'content-type': 'text/plain' }).end('Open this page once with ?key=<PANEL_KEY>.');
      return;
    }

    if (path === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ ha: { connected: ha.connected, configured: ha.configured, states: ha.states }, sessions })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    // Artwork for a watched HA entity (media player covers), cached like any other image.
    if (path === '/api/ha-image') {
      const id = url.searchParams.get('e');
      const pic = entities.includes(id) && ha.states[id]?.attributes?.entity_picture;
      if (!pic) { res.writeHead(404).end(); return; }
      res.writeHead(302, { location: extImage(pic.startsWith('http') ? pic : config.ha.url + pic), 'cache-control': 'no-store' }).end();
      return;
    }

    if (path.startsWith('/api/')) {
      for (const [method, re, fn] of routes) {
        const m = path.match(re);
        if (!m || method !== req.method) continue;
        const body = method === 'POST' ? await readBody(req) : undefined;
        return json(res, 200, await fn(m, url.searchParams, body));
      }
      return json(res, 404, { error: 'Not found' });
    }

    if (path.startsWith('/img/')) return serveImage(req, res);
    if (VENDOR[path]) return serveFile(res, join(MODULES, VENDOR[path]), 'public, max-age=86400');
    const f = FONTS.exec(path);
    if (f) return serveFile(res, join(MODULES, '@fontsource', f[2], 'files', f[1]), 'public, max-age=31536000, immutable');

    // Static UI. Every unknown path serves the app so /watch, /music etc. can be bookmarked.
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
    if (rel !== '/' && extname(rel)) return serveFile(res, join(WEB, rel));
    return serveFile(res, join(WEB, 'index.html'));
  } catch (e) {
    console.warn(`[http] ${req.method} ${path}: ${e.message}`);
    if (!res.headersSent) json(res, 502, { error: e.message });
  }
});

await initImageCache();
ha.start();
pollSessions();
server.listen(config.port, () => {
  console.log(`[panel] listening on :${config.port}`);
  console.log(`[panel] HA ${config.ha.url || '(not set)'} | Plex ${config.plex.url || '(not set)'} | Seerr ${config.seerr.url || '(not set)'}`);
});
