// Icons by name, "prefix:name", from the same places Home Assistant gets them:
//
//   mdi:   Material Design Icons (bundled, @mdi/js)
//   si:    Simple Icons, from HA's simpleicons integration (/simpleicons/icons)
//   cil:   Mariusthvdb's custom-icons.js, from HA's /hacsfiles
//   cbi:, fa7-brands:, ph:, ...  every set switched on in HA's custom_icons integration (Iconify
//          sets incl. Custom Brand Icons), over the panel's HA websocket
//
// The admin page searches them; the panel loads single icons as SVG from /api/icon/<prefix>/<name>.svg
// and paints them with CSS masks, so they take the text colour like the built-in icons.

import { config } from './config.mjs';

const LIST_TTL = 3600e3;
const NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;
const PREFIX = /^[a-z0-9][a-z0-9-]{0,40}$/;

// Search order: the sets most likely to have what a theater needs come first.
const PRIORITY = ['mdi', 'cbi', 'si', 'cil', 'fa7-brands', 'fa6-brands', 'cib', 'ph'];

let mdi = null;
async function mdiIcons() {
  if (mdi) return mdi;
  const m = await import('@mdi/js');
  mdi = new Map();
  for (const [k, path] of Object.entries(m)) {
    if (!k.startsWith('mdi')) continue;
    const name = k.slice(3).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-zA-Z])([0-9])/g, '$1-$2').toLowerCase();
    mdi.set(name, path);
  }
  return mdi;
}

const pathSvg = (d, box = '0 0 24 24') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"><path fill="currentColor" d="${d.replace(/"/g, '')}"/></svg>`;

// ---------- sources ----------

async function haFetch(path) {
  if (!config.ha.url) throw new Error('HA_URL is not set');
  const r = await fetch(`${config.ha.url}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HA ${r.status} for ${path}`);
  return r;
}

let cil = null;
async function cilIcons() {
  if (cil && Date.now() - cil.t < LIST_TTL) return cil.v;
  const js = await (await haFetch('/hacsfiles/custom-icons/custom-icons.js')).text();
  const v = new Map();
  for (const m of js.matchAll(/"([a-z0-9-]+)":\s*\{\s*path:\s*"([^"]+)"(?:,\s*keywords:\s*\[([^\]]*)\])?/g)) {
    v.set(m[1], { path: m[2], keywords: (m[3] || '').replace(/"/g, '') });
  }
  cil = { t: Date.now(), v };
  return v;
}

const lists = new Map();   // prefix -> { t, names: [{name, keywords}] }
async function list(ha, prefix) {
  const hit = lists.get(prefix);
  if (hit && Date.now() - hit.t < LIST_TTL) return hit.names;
  let names = [];
  if (prefix === 'mdi') names = [...(await mdiIcons()).keys()].map((name) => ({ name }));
  else if (prefix === 'cil') names = [...(await cilIcons()).entries()].map(([name, v]) => ({ name, keywords: v.keywords }));
  else if (prefix === 'si') names = await (await haFetch('/simpleicons/icons')).json();
  else names = (await ha.request({ type: 'custom_icons/list', set: prefix })) || [];
  names = names.map((n) => ({ name: n.name, keywords: Array.isArray(n.keywords) ? n.keywords.join(' ') : n.keywords || '' }));
  lists.set(prefix, { t: Date.now(), names });
  return names;
}

// Every prefix available: mdi, plus whatever HA offers right now.
async function prefixes(ha) {
  const out = ['mdi'];
  try { await haFetch('/simpleicons/icons'); out.push('si'); } catch {}
  try { await cilIcons(); out.push('cil'); } catch {}
  if (ha.connected) {
    try { out.push(...((await ha.request({ type: 'custom_icons/activesets' })) || [])); } catch {}
  }
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}
const rank = (p) => { const i = PRIORITY.indexOf(p); return i < 0 ? PRIORITY.length : i; };

// ---------- single icons ----------

const cache = new Map();   // "prefix:name" -> svg string (or null for missing)

export async function iconSvg(ha, prefix, name) {
  if (!PREFIX.test(prefix) || !NAME.test(name)) return null;
  const key = `${prefix}:${name}`;
  if (cache.has(key)) return cache.get(key);
  let svg = null;
  try {
    if (prefix === 'mdi') { const d = (await mdiIcons()).get(name); if (d) svg = pathSvg(d); }
    else if (prefix === 'cil') { const v = (await cilIcons()).get(name); if (v) svg = pathSvg(v.path); }
    else if (prefix === 'si') { const r = await haFetch(`/simpleicons/icons/${name}`).catch(() => null); if (r) svg = pathSvg((await r.json()).path); }
    else {
      const i = await ha.request({ type: 'custom_icons/icon', set: prefix, icon: name });
      if (i?.body) svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${i.left || 0} ${i.top || 0} ${i.width || 24} ${i.height || 24}">${stripScripts(i.body)}</svg>`;
      else if (i?.path) svg = pathSvg(i.path, i.viewBox || '0 0 24 24');
    }
  } catch (e) { console.warn(`[icons] ${key}: ${e.message}`); return null; } // not cached: may work later
  if (cache.size > 2000) cache.clear();
  cache.set(key, svg);
  return svg;
}

// Iconify bodies are plain SVG shapes; drop anything active just in case.
const stripScripts = (body) => body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/(href|xlink:href)="(?!#)[^"]*"/gi, '');

// ---------- search ----------

// Up to `limit` icons whose name or keywords contain every word of the query, best sets first.
// "mdi:xbox" searches one set only.
export async function search(ha, query, limit = 72) {
  let q = String(query || '').toLowerCase().trim();
  let only = null;
  const m = /^([a-z0-9-]+):(.*)$/.exec(q);
  if (m) { only = m[1]; q = m[2]; }
  const words = q.split(/[\s-]+/).filter(Boolean);
  if (!words.length) return { sets: await prefixes(ha), icons: [] };

  const sets = only ? [only] : await prefixes(ha);
  const found = [];
  for (const prefix of sets) {
    let names;
    try { names = await list(ha, prefix); } catch { continue; }
    const hits = names.filter((n) => words.every((w) => n.name.includes(w) || n.keywords.includes(w)));
    // Exact and prefix matches before the rest.
    hits.sort((a, b) => score(b.name, q) - score(a.name, q) || a.name.length - b.name.length);
    for (const h of hits.slice(0, 24)) found.push(`${prefix}:${h.name}`);
    if (found.length >= limit * 2) break;
  }
  return { sets, icons: found.slice(0, limit) };
}
const score = (name, q) => (name === q ? 3 : name.startsWith(q) ? 2 : name.includes(q.replace(/\s+/g, '-')) ? 1 : 0);
