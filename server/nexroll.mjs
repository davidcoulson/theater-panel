// NeXroll (the pre-roll manager): which pre-rolls Plex plays before a film. Reads are plain GETs
// on its web API (categories, prerolls, the active category, what Plex has queued); the one
// write is "apply this category to Plex", and it only happens when the settings allow it.
// Nothing here runs unless NEXROLL_URL is set.

import { config } from './config.mjs';
import * as accents from './accents.mjs';
import { httpError } from './admin.mjs';

const on = () => Boolean(config.nexroll.url);

async function call(path, method = 'GET') {
  const headers = { Accept: 'application/json' };
  if (config.nexroll.apiKey) headers['X-Api-Key'] = config.nexroll.apiKey;
  const res = await fetch(`${config.nexroll.url}${path}`, { method, headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw httpError(502, `NeXroll ${res.status} for ${path}`);
  return res.json();
}

// Facts about a file change rarely: ask NeXroll's ffprobe once an hour. Fields it may grow
// (hdr, audio) are shown when they are there and ignored when not.
const infoCache = new Map();
async function info(id) {
  const hit = infoCache.get(id);
  if (hit && Date.now() - hit.at < 3600e3) return hit.v;
  const v = await call(`/prerolls/${id}/video-info`).catch(() => ({}));
  infoCache.set(id, { at: Date.now(), v });
  return v;
}

const badges = (v) => [
  v.height ? (v.height >= 2000 ? '4K' : `${v.height}p`) : '',
  v.hdr ? (typeof v.hdr === 'string' ? v.hdr : 'HDR') : '',
  v.frame_rate && ratio(v.frame_rate) > 30 ? `${Math.round(ratio(v.frame_rate))}fps` : '',
  v.audio_codec || v.audio || '',
].filter(Boolean);
const ratio = (r) => { const [a, b = 1] = String(r).split('/').map(Number); return a / b || 0; };

// Everything the picker draws: each category with its pre-rolls and badges, which category is
// on air, and what Plex has queued right now.
export async function overview() {
  if (!on()) throw httpError(404, 'NeXroll is not set up');
  const [cats, active, queued] = await Promise.all([
    call('/categories'),
    call('/settings/active-category').catch(() => ({})),
    call('/plex/current-preroll-details').catch(() => ({})),
  ]);
  const activeId = cats.find((c) => [c.id, c.name].some((x) => x != null && String(x) === String(active.active_category)))?.id
    ?? cats.find((c) => c.apply_to_plex)?.id ?? null;
  const out = await Promise.all(cats.map(async (c) => {
    const list = await call(`/categories/${c.id}/prerolls`).catch(() => []);
    const prerolls = await Promise.all(list.slice(0, 40).map(async (p) => ({ id: p.id, name: p.display_name || p.filename.replace(/\.[^.]+$/, ''), badges: badges(await info(p.id)) })));
    return { id: c.id, name: c.name, mode: c.plex_mode, active: c.id === activeId, prerolls };
  }));
  return { categories: out, queued: (queued.prerolls || []).map((p) => (typeof p === 'string' ? p : p.display_name || p.filename || p.name || '')).filter(Boolean), mode: queued.mode || '', canPick: canWrite() };
}

const canWrite = () => config.nexroll.autoswitch || config.nexroll.allowPick;

// Make a category what Plex plays. The only write; it drops the panel's cached view of it.
export async function pick(id) {
  if (!on()) throw httpError(404, 'NeXroll is not set up');
  if (!canWrite()) throw httpError(403, 'Switching is off: set NEXROLL_ALLOW_PICK on the settings page');
  if (!/^\d+$/.test(String(id))) throw httpError(400, 'Bad category');
  return call(`/categories/${id}/apply-to-plex`, 'POST');
}

// "halloween=Halloween, default=Default" -> Map(accent id -> category name, lower case)
export function parseMap(text) {
  return new Map(String(text || '').split(/[,\n]/).map((s) => s.split('=').map((x) => x.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
}

// Is NeXroll set for the accent in effect? Switches it when NEXROLL_AUTOSWITCH is on, says what
// it would do when not.
let lastAccent = null;
export async function seasonCheck({ force = false } = {}) {
  if (!on()) return;
  const accent = accents.resolve(config.ui.accent, accents.parseBirthdays(config.ui.birthdays)).id;
  if (!force && accent === lastAccent) return;
  try {
    const map = parseMap(config.nexroll.seasonMap);
    const want = map.get(accent) || map.get('default');
    if (!want) { lastAccent = accent; return; }
    const cats = await call('/categories');
    const cat = cats.find((c) => c.name.toLowerCase() === want);
    if (!cat) { console.warn(`[nexroll] accent ${accent} maps to "${want}", which NeXroll does not have`); lastAccent = accent; return; }
    const now = (await overview()).categories.find((c) => c.active);
    lastAccent = accent;
    if (now?.id === cat.id) return;
    if (!config.nexroll.autoswitch) { console.log(`[nexroll] accent ${accent}: would switch Plex pre-rolls to "${cat.name}" (NEXROLL_AUTOSWITCH is off)`); return; }
    await call(`/categories/${cat.id}/apply-to-plex`, 'POST');
    console.log(`[nexroll] accent ${accent}: Plex pre-rolls switched to "${cat.name}"`);
  } catch (e) { console.warn('[nexroll] season check:', e.message); }   // lastAccent stays, so the next tick retries
}

// At startup, and then hourly, which is as often as the calendar can change the accent.
let timer = null;
export function start() {
  if (timer) return;
  seasonCheck();
  timer = setInterval(seasonCheck, 3600e3);
  timer.unref();
}
