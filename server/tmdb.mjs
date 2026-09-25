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
