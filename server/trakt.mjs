// Trakt's public lists, read with a client ID alone - nobody signs in, so the panel never sees a
// Trakt account. The holiday shelves use one list per season (server/seasonal.mjs).

import { config } from './config.mjs';

const cache = new Map();

// "user/list-slug" (as in the list's address on trakt.tv) -> the TMDB ids of its films, in the
// list's own order. Cached for six hours; a bad client ID or a missing list throws.
export async function listTmdbIds(slug) {
  const key = String(slug || '').trim().replace(/^\/+|\/+$/g, '').replace('/lists/', '/');
  const [user, list] = key.split('/');
  if (!config.trakt.clientId) throw new Error('TRAKT_CLIENT_ID is not set');
  if (!user || !list) throw new Error(`Not a Trakt list: "${slug}" (want user/list-slug)`);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.ids;
  const ids = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://api.trakt.tv/users/${encodeURIComponent(user)}/lists/${encodeURIComponent(list)}/items/movies?page=${page}&limit=100`,
      { headers: { 'trakt-api-version': '2', 'trakt-api-key': config.trakt.clientId }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(r.status === 403 ? 'Trakt refused the client ID' : r.status === 404 ? `Trakt list ${key} not found` : `Trakt ${r.status}`);
    const items = await r.json();
    for (const it of items) if (it.movie?.ids?.tmdb) ids.push(it.movie.ids.tmdb);
    if (items.length < 100 || page >= Number(r.headers.get('x-pagination-page-count') || 1)) break;
  }
  cache.set(key, { at: Date.now(), ids });
  return ids;
}
