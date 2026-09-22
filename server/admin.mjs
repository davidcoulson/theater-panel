// Admin page API: view and change the panel's settings from a laptop instead of editing the
// Unraid container. Settings are the same names as the environment variables; what is saved here
// wins over the container's value, and a blank field falls back to it.
//
// Protected by ADMIN_PASSWORD (environment only). Sign-in sets a signed, HttpOnly, SameSite=Strict
// cookie; secrets are write-only (the page is told whether one is set, never its value).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config, settings, saveSettings, effectiveVars } from './config.mjs';
import { loadGames, loadGamesFile } from './games.mjs';

// type: text | secret | entity | list (comma-separated) | libraries | bool | apps (Name=package list)
export const FIELDS = [
  { group: 'Home Assistant', key: 'HA_URL', label: 'URL', type: 'text', placeholder: 'http://10.2.3.6:8123' },
  { group: 'Home Assistant', key: 'HA_TOKEN', label: 'Long-lived access token', type: 'secret' },

  { group: 'Plex', key: 'PLEX_URL', label: 'URL', type: 'text', placeholder: 'http://10.2.6.3:32400' },
  { group: 'Plex', key: 'PLEX_TOKEN', label: 'Token', type: 'secret' },
  { group: 'Plex', key: 'PLEX_LIBRARIES', label: 'Libraries, in tab order', type: 'libraries', help: 'Movie libraries are merged into one Movies tab. Blank shows every movie and TV library.' },
  { group: 'Plex', key: 'PLEX_PLAYER_NAME', label: 'Theater player name', type: 'text', help: "The client's name as Plex reports it, to pick the theater's session." },

  { group: 'Seerr', key: 'SEERR_URL', label: 'URL', type: 'text' },
  { group: 'Seerr', key: 'SEERR_API_KEY', label: 'API key', type: 'secret' },
  { group: 'Seerr', key: 'SEERR_USER_ID', label: 'Request as user id', type: 'text' },
  { group: 'Seerr', key: 'SEERR_REGION', label: 'Streaming region', type: 'text', placeholder: 'US' },

  { group: 'Entities', key: 'ENTITY_PROJECTOR', label: 'Projector (ADB media player)', type: 'entity', domain: 'media_player' },
  { group: 'Entities', key: 'ENTITY_APPLE_TV', label: 'Apple TV', type: 'entity', domain: 'media_player' },
  { group: 'Entities', key: 'ENTITY_APPLE_TV_REMOTE', label: 'Apple TV remote', type: 'entity', domain: 'remote' },
  { group: 'Entities', key: 'ENTITY_PLEX_PLAYER', label: 'Plex player', type: 'entity', domain: 'media_player' },
  { group: 'Entities', key: 'ENTITY_MUSIC_PLAYERS', label: 'Music players (first is the theater)', type: 'list', domain: 'media_player' },
  { group: 'Entities', key: 'ENTITY_LIGHTS', label: 'Lights', type: 'list', domain: 'light' },
  { group: 'Entities', key: 'ENTITY_PICTURE_MODE', label: 'Picture mode (input_select)', type: 'entity', domain: 'input_select' },
  { group: 'Entities', key: 'ENTITY_TEMPERATURE', label: 'Temperature', type: 'entity', domain: 'sensor' },
  { group: 'Entities', key: 'ENTITY_OCCUPANCY', label: 'Occupancy', type: 'entity', domain: 'binary_sensor' },
  { group: 'Entities', key: 'ENTITY_TAUTULLI', label: 'Tautulli watching', type: 'entity', domain: 'sensor' },

  { group: 'Projector apps', key: 'PROJECTOR_APPS', label: 'Apps', type: 'apps', help: 'Open on the projector over ADB. The package is the Android app id.' },

  { group: 'Games', key: 'STEAM_API_KEY', label: 'Steam Web API key', type: 'secret', help: 'steamcommunity.com/dev/apikey' },
  { group: 'Games', key: 'STEAM_ID', label: 'SteamID64', type: 'text' },

  { group: 'Display', key: 'SHOW_QUALITY_BADGES', label: '4K / HDR / Dolby Vision labels on posters', type: 'bool', default: true },
  { group: 'Display', key: 'SHOW_NETWORK_BADGES', label: 'Streaming network labels on posters', type: 'bool', default: false },
  { group: 'Display', key: 'FRAME_ANCESTORS', label: 'Pages allowed to embed the panel', type: 'list', help: 'The Home Assistant dashboard Kiosk Satellite shows.' },
];
const BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// ---------- sessions ----------

const COOKIE = 'tp_admin';
const DAY = 86400e3;
// Signing key: derived from the admin password, so changing the password signs everyone out.
const key = () => createHmac('sha256', 'theater-panel-admin').update(config.adminPassword).digest();
const sign = (v) => createHmac('sha256', key()).update(v).digest('base64url');

export function isAdmin(req) {
  if (!config.adminPassword) return false;
  const raw = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '')?.[1];
  if (!raw) return false;
  const [exp, nonce, mac] = decodeURIComponent(raw).split('.');
  if (!mac || Number(exp) < Date.now()) return false;
  const a = Buffer.from(mac); const b = Buffer.from(sign(`${exp}.${nonce}`));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function login(res, body) {
  if (!config.adminPassword) throw httpError(403, 'Set ADMIN_PASSWORD on the container to use the admin page.');
  const a = Buffer.from(String(body.password || '')); const b = Buffer.from(config.adminPassword);
  if (!(a.length === b.length && timingSafeEqual(a, b))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    throw httpError(401, 'Wrong password');
  }
  const exp = Date.now() + 30 * DAY; const nonce = randomBytes(9).toString('base64url');
  const v = `${exp}.${nonce}.${sign(`${exp}.${nonce}`)}`;
  res.setHeader('set-cookie', `${COOKIE}=${encodeURIComponent(v)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Strict`);
  return { ok: true };
}

export function logout(res) {
  res.setHeader('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
  return { ok: true };
}

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }

// ---------- settings ----------

// What the page shows: each field's saved value, the container's value underneath it, and for
// secrets only whether one is set.
export async function view() {
  const saved = settings().vars;
  const env = process.env;
  const values = {};
  for (const f of FIELDS) {
    const own = saved[f.key]; const base = env[f.key];
    values[f.key] = f.type === 'secret'
      ? { saved: Boolean(own), container: Boolean(base) }
      : { saved: own ?? '', container: base ?? '' };
  }
  const gamesSaved = Boolean(settings().games);
  return {
    fields: FIELDS, values, rev: settings().rev || 0,
    // Settings still coming from the container (what Import would copy).
    fromContainer: FIELDS.filter((f) => process.env[f.key] && !saved[f.key]).map((f) => f.key),
    games: (await loadGames()) || { switcher: {}, sources: [] },
    gamesSource: gamesSaved ? 'admin' : (await loadGamesFile()) ? 'file' : 'none',
  };
}

// body: { values: { KEY: string | null }, games?: object }. For secrets, '' or a missing key
// keeps the saved secret and null removes it; for everything else '' falls back to the container.
export function save(body) {
  const cur = settings();
  // A page loaded before someone else's save (another tab, an import) must reload first.
  if (body.rev !== undefined && body.rev !== (cur.rev || 0)) throw httpError(409, 'Settings changed since this page loaded. Reload and try again.');
  const vars = { ...cur.vars };
  for (const [k, v] of Object.entries(body.values || {})) {
    const f = BY_KEY[k];
    if (!f) continue;
    if (f.type === 'secret') {
      if (v === null) delete vars[k];
      else if (typeof v === 'string' && v.trim()) vars[k] = v.trim();
      continue;
    }
    const s = v == null ? '' : String(v).trim();
    if (s === '') delete vars[k]; else vars[k] = s;
  }
  let games = cur.games;
  if (body.games !== undefined) games = body.games === null ? null : cleanGames(body.games);
  saveSettings({ vars, games, rev: (cur.rev || 0) + 1 });
  return { ok: true };
}

// Copy every setting that only exists on the container (tokens included) and the games.json
// sources into the saved settings, so the container's variables can then be deleted.
export async function importContainer() {
  const cur = settings();
  const vars = { ...cur.vars };
  const copied = [];
  for (const f of FIELDS) {
    const v = process.env[f.key];
    if (v && !vars[f.key]) { vars[f.key] = v; copied.push(f.key); }
  }
  let games = cur.games;
  if (!games) { const file = await loadGamesFile(); if (file) { games = cleanGames(file); copied.push('games.json'); } }
  saveSettings({ vars, games, rev: (cur.rev || 0) + 1 });
  return { ok: true, copied };
}

const ID = /^[a-z0-9_-]{1,32}$/;
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
function cleanGames(g) {
  const out = { v: 2, switcher: {}, sources: [] };
  if (g.switcher?.entity) {
    if (!ENTITY.test(g.switcher.entity)) throw httpError(400, `Bad switcher entity: ${g.switcher.entity}`);
    out.switcher = { entity: g.switcher.entity, projectorInput: String(g.switcher.projectorInput || 'HDMI 3') };
  }
  for (const s of g.sources || []) {
    const id = String(s.id || s.name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    if (!ID.test(id) || !s.name) throw httpError(400, 'Every source needs a name');
    const src = { id, name: String(s.name).slice(0, 24), icon: String(s.icon || 'pad'), via: s.via === 'switcher' ? 'switcher' : 'projector' };
    if (src.via === 'switcher') src.option = String(s.option || s.name);
    else src.projectorInput = String(s.projectorInput || 'HDMI 2');
    if (s.games === false) src.games = false;
    if (s.haScript) src.haScript = String(s.haScript);
    out.sources.push(src);
  }
  if (g.pc) out.pc = g.pc; // PC stats and launch script are kept as they were
  return out;
}

// ---------- helpers for the page ----------

// Plex's movie and TV libraries, for the library picker.
export async function plexLibraries() {
  const { url, token } = config.plex;
  if (!url) return [];
  const r = await fetch(`${url}/library/sections?X-Plex-Token=${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw httpError(502, `Plex ${r.status}`);
  return ((await r.json()).MediaContainer.Directory || [])
    .filter((d) => d.type === 'movie' || d.type === 'show')
    .map((d) => ({ title: d.title, type: d.type }));
}

// Entity ids and names from HA, for the pickers.
export async function haEntities(ha) {
  const states = await ha.request({ type: 'get_states' });
  return states.map((s) => ({ id: s.entity_id, name: s.attributes?.friendly_name || '' }));
}

// Try a service with the settings as they would be after saving (unsaved field values win).
export async function test(service, values = {}) {
  const v = { ...effectiveVars() };
  for (const [k, val] of Object.entries(values)) if (typeof val === 'string' && val.trim()) v[k] = val.trim();
  const t = AbortSignal.timeout(8000);
  const need = { ha: ['HA_URL', 'HA_TOKEN'], plex: ['PLEX_URL', 'PLEX_TOKEN'], seerr: ['SEERR_URL', 'SEERR_API_KEY'] }[service];
  if (!need) throw httpError(400, 'Unknown service');
  const gone = need.filter((k) => !v[k]);
  if (gone.length) return { ok: false, detail: `${gone.join(' and ')} not set` };
  try {
    if (service === 'ha') {
      const r = await fetch(`${v.HA_URL.replace(/\/$/, '')}/api/`, { headers: { Authorization: `Bearer ${v.HA_TOKEN}` }, signal: t });
      return r.ok ? { ok: true, detail: (await r.json()).message } : { ok: false, detail: `HTTP ${r.status}` };
    }
    if (service === 'plex') {
      const r = await fetch(`${v.PLEX_URL.replace(/\/$/, '')}/identity?X-Plex-Token=${encodeURIComponent(v.PLEX_TOKEN || '')}`, { headers: { Accept: 'application/json' }, signal: t });
      const libs = await fetch(`${v.PLEX_URL.replace(/\/$/, '')}/library/sections?X-Plex-Token=${encodeURIComponent(v.PLEX_TOKEN || '')}`, { headers: { Accept: 'application/json' }, signal: t });
      if (!libs.ok) return { ok: false, detail: `HTTP ${libs.status}` };
      const names = ((await libs.json()).MediaContainer.Directory || []).map((d) => d.title);
      return { ok: r.ok, detail: `Libraries: ${names.join(', ')}` };
    }
    if (service === 'seerr') {
      const r = await fetch(`${v.SEERR_URL.replace(/\/$/, '')}/api/v1/settings/main`, { headers: { 'X-Api-Key': v.SEERR_API_KEY || '' }, signal: t });
      return r.ok ? { ok: true, detail: (await r.json()).applicationTitle || 'Connected' } : { ok: false, detail: `HTTP ${r.status}` };
    }
  } catch (e) { return { ok: false, detail: e.message }; }
  throw httpError(400, 'Unknown service');
}
