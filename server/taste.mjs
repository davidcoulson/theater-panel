// What the house actually watches, and what to do with it: the "You'll love this" rows on the
// Watch board and the Mystery box that picks a film and starts it.
//
// Both read Plex's own history (server/plex.mjs) and, for the rows, Seerr's TMDB proxy for
// "people who watched this also watched". No Trakt account and no second service to keep signed
// in - the panel already has a Plex token and a Seerr key.

import { config } from './config.mjs';
import * as plex from './plex.mjs';
import * as seerr from './seerr.mjs';

const SEED_TTL = 20 * 60e3;
const ROW_TTL = 60 * 60e3;

let seedCache = { at: 0, key: '', list: null };

// The last few distinct titles anyone finished, with the genres and TMDB id a recommendation
// needs. Only the first handful of history rows are looked up in full, so this is a couple of
// Plex calls, not a couple of hundred.
export async function seeds(n = 6) {
  const key = `${n}:${config.historyAccounts.join(',')}`;
  if (seedCache.list && seedCache.key === key && Date.now() - seedCache.at < SEED_TTL) return seedCache.list;
  const accounts = await accountIds();
  const rows = await plex.history({ size: 200, accounts });
  const list = [];
  for (const row of rows) {
    if (list.length >= n) break;
    const d = await plex.seedDetails(row.key).catch(() => null);
    if (!d || !d.title) continue;
    list.push({ ...d, watchedAt: row.viewedAt });
  }
  seedCache = { at: Date.now(), key, list };
  return list;
}

// The settings page names accounts ("David, Michelle"); Plex wants ids. Unknown names are
// ignored rather than silently narrowing the history to nothing.
async function accountIds() {
  const want = config.historyAccounts;
  if (!want.length) return [];
  const all = await plex.accounts().catch(() => []);
  return want.map((w) => (/^\d+$/.test(w) ? Number(w) : all.find((a) => a.name.toLowerCase() === w.toLowerCase())?.id)).filter(Boolean);
}

let rowCache = { at: 0, rows: null };

// "You'll love this": three rows, each seeded by something recently finished. Titles already in
// Plex carry the key that plays them; the rest can be requested from the same card.
export async function rows({ count = 3, size = 12 } = {}) {
  if (rowCache.rows && Date.now() - rowCache.at < ROW_TTL) return rowCache.rows;
  if (!config.seerr.url) return [];
  const list = (await seeds(8)).filter((s) => s.tmdbId).slice(0, count);
  const seen = new Set(list.map((s) => s.tmdbId));
  const out = [];
  for (const seed of list) {
    const type = seed.type === 'show' ? 'tv' : 'movie';
    const r = await seerr.recommendations(type, seed.tmdbId).catch((e) => { console.warn('[taste]', seed.title, e.message); return []; });
    const items = r.filter((x) => !seen.has(x.id)).slice(0, size);
    items.forEach((x) => seen.add(x.id));
    if (items.length) out.push({ seed: { id: seed.id, title: seed.title, type: seed.type, poster: seed.poster, year: seed.year }, items });
  }
  rowCache = { at: Date.now(), rows: out };
  return out;
}

export const forget = () => { seedCache = { at: 0, key: '', list: null }; rowCache = { at: 0, rows: null }; };

// The Mystery box: an unwatched film from the library, weighted towards the genres the house has
// been watching, so it is a surprise but not a random one. Returns the pick and the reason, and
// plays nothing by itself - the panel counts down first so it can be waved off.
export async function mystery({ filters = [], exclude = [] } = {}) {
  const [pool, list] = await Promise.all([
    plex.listLibrary(plex.MERGED, { filters: [...new Set(['unwatched', ...filters])], sort: 'random', size: 150 }),
    seeds(8).catch(() => []),
  ]);
  const skip = new Set(exclude.map(String));
  let items = pool.items.filter((i) => !skip.has(String(i.id)));
  // A surprise should still be worth watching: leave the 3-star-and-under stuff out while there
  // is enough else to choose from (an unrated title is given the benefit of the doubt).
  const decent = items.filter((i) => (i.rating ?? 6.5) >= 5);
  if (decent.length >= 20) items = decent;
  if (!items.length) throw new Error('Nothing unwatched matches that');

  // Genre weights: what has been watched most recently counts most.
  const weights = new Map();
  list.forEach((s, i) => {
    for (const g of s.genres || []) weights.set(g, (weights.get(g) || 0) + (list.length - i));
  });
  const scored = items.map((it) => {
    const hits = (it.genres || []).filter((g) => weights.has(g));
    const taste = hits.reduce((sum, g) => sum + weights.get(g), 0);
    return { it, hits, score: 1 + taste + (it.rating >= 7.5 ? 4 : it.rating >= 6.5 ? 2 : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, 30);

  const total = scored.reduce((s, x) => s + x.score, 0);
  let roll = Math.random() * total;
  const pick = scored.find((x) => (roll -= x.score) <= 0) || scored[0];

  // Why this one: whichever seed it has most in common with (ties go to the more recent), named
  // along with the genre they share.
  const overlap = (s) => (s.genres || []).filter((g) => pick.hits.includes(g));
  const from = list.map((s) => ({ s, shared: overlap(s) })).filter((x) => x.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length)[0];
  const why = from ? `More ${from.shared[0].toLowerCase()}, after ${from.s.title}`
    : pick.hits.length ? `More ${pick.hits[0].toLowerCase()} for the house`
    : 'Never started, and highly rated';
  return { item: pick.it, why, pool: items.length };
}
