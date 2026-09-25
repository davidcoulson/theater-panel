// TMDB's public lists, read with a free API key - nobody signs in. The holiday shelves use one
// list per season (server/seasonal.mjs). A v3 key goes on the query string; a v4 read access
// token (the long "eyJ..." one) goes in the Authorization header; either works.

import { config } from './config.mjs';

const cache = new Map();

// A list id (the number in the list's address on themoviedb.org) -> the TMDB ids of its films,
// in the list's own order. Cached for six hours; a bad key or a missing list throws.
export async function listIds(list) {
  const id = String(list || '').trim().match(/\d+/)?.[0];
  const key = config.tmdb.apiKey;
  if (!key) throw new Error('TMDB_API_KEY is not set');
  if (!id) throw new Error(`Not a TMDB list: "${list}" (want the number from its address)`);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.ids;
  const bearer = key.startsWith('eyJ');
  const ids = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`https://api.themoviedb.org/3/list/${id}?page=${page}${bearer ? '' : `&api_key=${encodeURIComponent(key)}`}`,
      { headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(r.status === 401 ? 'TMDB refused the key' : r.status === 404 ? `TMDB list ${id} not found` : `TMDB ${r.status}`);
    const d = await r.json();
    for (const it of d.items || []) if ((it.media_type || 'movie') === 'movie' && it.id) ids.push(it.id);
    if (!d.total_pages || page >= d.total_pages) break;
  }
  cache.set(id, { at: Date.now(), ids });
  return ids;
}

// ---------- one film, its trailer, its series ----------

async function api(path, params = {}) {
  const key = config.tmdb.apiKey;
  if (!key) throw new Error('TMDB_API_KEY is not set');
  const bearer = key.startsWith('eyJ');
  const q = new URLSearchParams({ ...params, ...(bearer ? {} : { api_key: key }) });
  const r = await fetch(`https://api.themoviedb.org/3${path}?${q}`, { headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(r.status === 401 ? 'TMDB refused the key' : r.status === 404 ? 'Not on TMDB' : `TMDB ${r.status}`);
  return r.json();
}

const memo = new Map();
async function remember(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  return v;
}

// A film with its videos and the series it belongs to, cached for six hours.
export const movie = (id) => remember(`movie:${id}`, 6 * 3600e3, () => api(`/movie/${Number(id)}`, { append_to_response: 'videos' }));

// The YouTube key of the film's trailer: an official trailer first, then any trailer, then a teaser.
export async function trailer(id) {
  const m = await movie(id).catch(() => null);
  const vids = (m?.videos?.results || []).filter((v) => v.site === 'YouTube' && v.key && ['Trailer', 'Teaser'].includes(v.type));
  vids.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || (a.type === 'Trailer' ? -1 : 1) - (b.type === 'Trailer' ? -1 : 1));
  return vids[0]?.key || null;
}

// The film before and after this one in its series (TMDB's collection, by release date), or
// nulls when it stands alone. A part with no release date yet is still listed, flagged unreleased.
export async function neighbours(id) {
  const m = await movie(id);
  const c = m.belongs_to_collection;
  if (!c) return { collection: null, prev: null, next: null };
  const col = await remember(`collection:${c.id}`, 6 * 3600e3, () => api(`/collection/${c.id}`));
  const today = new Date().toISOString().slice(0, 10);
  const parts = (col.parts || []).slice().sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'));
  const i = parts.findIndex((p) => p.id === Number(id));
  const pick = (p) => p ? { tmdb: p.id, title: p.title, year: Number((p.release_date || '').slice(0, 4)) || null, released: Boolean(p.release_date) && p.release_date <= today } : null;
  return { collection: c.name, prev: i > 0 ? pick(parts[i - 1]) : null, next: i >= 0 ? pick(parts[i + 1]) : null };
}

// A series: its seasons, what aired last and what airs next. Cached for six hours.
export const tv = (id) => remember(`tv:${id}`, 6 * 3600e3, () => api(`/tv/${Number(id)}`));
