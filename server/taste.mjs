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
  // What the house rated highly leads: a five-star film from the "How was it?" card is a
  // better seed than whatever happened to finish last night.
  for (const it of await loved()) {
    if (list.length >= 2) break;
    const d = await plex.seedDetails(it.id).catch(() => null);
    if (d?.title) list.push({ ...d, loved: true, userRating: it.userRating });
  }
  for (const row of rows) {
    if (list.length >= n) break;
    if (list.some((s) => s.id === row.key)) continue;
    const d = await plex.seedDetails(row.key).catch(() => null);
    if (!d || !d.title) continue;
    list.push({ ...d, watchedAt: row.viewedAt });
  }
  seedCache = { at: Date.now(), key, list };
  return list;
}

// The house's own star ratings, from the movie index: loved is four stars and up (Plex counts
// in halves, so 8+), disliked two and under (4-).
const rated = () => plex.ratedMovies().catch(() => []);
const loved = async () => (await rated()).filter((it) => it.userRating >= 8).sort((a, b) => b.userRating - a.userRating);
const disliked = async () => (await rated()).filter((it) => it.userRating <= 4);

// The settings page names accounts ("Alice, Bob"); Plex wants ids. Unknown names are
// ignored rather than silently narrowing the history to nothing.
async function accountIds() {
  const want = config.historyAccounts;
  if (!want.length) return [];
  const all = await plex.accounts().catch(() => []);
  return want.map((w) => (/^\d+$/.test(w) ? Number(w) : all.find((a) => a.name.toLowerCase() === w.toLowerCase())?.id)).filter(Boolean);
}

// Rows are worth an hour when they came back full; a failure or an empty answer is worth a
// minute, so a Seerr hiccup at startup does not leave the tab empty for the rest of the hour.
let rowCache = { at: 0, rows: null, ttl: ROW_TTL };

// "You'll love this": three rows, each seeded by something recently finished. Titles already in
// Plex carry the key that plays them; the rest can be requested from the same card.
export async function rows({ count = 3, size = 12 } = {}) {
  if (rowCache.rows && Date.now() - rowCache.at < rowCache.ttl) return rowCache.rows;
  if (!config.seerr.url) return [];
  const list = (await seeds(8)).filter((s) => s.tmdbId).slice(0, count);
  const seen = new Set(list.map((s) => s.tmdbId));
  const out = [];
  for (const seed of list) {
    const type = seed.type === 'show' ? 'tv' : 'movie';
    const r = await seerr.recommendations(type, seed.tmdbId).catch((e) => { console.warn('[taste]', seed.title, e.message); return []; });
    const items = r.filter((x) => !seen.has(x.id)).slice(0, size);
    items.forEach((x) => seen.add(x.id));
    if (items.length) out.push({ seed: { id: seed.id, title: seed.title, type: seed.type, poster: seed.poster, year: seed.year, loved: Boolean(seed.loved) }, items });
  }
  rowCache = { at: Date.now(), rows: out, ttl: out.length ? ROW_TTL : 60e3 };
  return out;
}

export const forget = () => { seedCache = { at: 0, key: '', list: null }; rowCache = { at: 0, rows: null, ttl: ROW_TTL }; };

// Warm the caches at startup, like the movie index, so the first visit to For you is not eight
// round trips to Plex.
export const warm = () => seeds(8).then(() => rows()).catch((e) => console.warn('[taste] warm:', e.message));

// The Mystery box: an unwatched film inside the admin page's limits (by default the last ten
// years, rated 7 or better), weighted towards the genres the house has been watching, so it is a
// surprise but not a random one. Returns the pick and the reason, and plays nothing by itself -
// the panel counts down first so it can be waved off.
export async function mystery({ filters = [], exclude = [] } = {}) {
  const rules = config.mystery;
  const [pool, list] = await Promise.all([
    plex.listLibrary(plex.MERGED, { filters: [...new Set(['unwatched', 'recent', 'rated', ...filters])], sort: 'random', size: 200 }),
    seeds(8).catch(() => []),
  ]);
  const skip = new Set(exclude.map(String));
  const items = pool.items.filter((i) => !skip.has(String(i.id)))
    .filter((i) => !rules.maxMinutes || !i.duration || i.duration <= rules.maxMinutes * 60000)
    .filter((i) => !(i.genres || []).some((g) => rules.excludeGenres.includes(g.toLowerCase())));
  if (!items.length) {
    const limits = [rules.years ? `from ${plex.RECENT_FROM()} on` : '', rules.minRating ? `rated ${rules.minRating}+` : '',
      rules.maxMinutes ? `under ${rules.maxMinutes} min` : '', rules.excludeGenres.length ? `outside ${rules.excludeGenres.join(', ')}` : ''].filter(Boolean).join(', ');
    throw new Error(`Nothing unwatched${limits ? ` ${limits}` : ''} matches that`);
  }

  // Genre weights: what has been watched most recently counts most, a loved film counts double,
  // and the genres of anything rated two stars or under count against.
  const weights = new Map();
  list.forEach((s, i) => {
    for (const g of s.genres || []) weights.set(g, (weights.get(g) || 0) + (list.length - i) * (s.loved ? 2 : 1));
  });
  for (const it of await disliked()) for (const g of it.genres || []) weights.set(g, (weights.get(g) || 0) - 4);
  const scored = items.map((it) => {
    const hits = (it.genres || []).filter((g) => (weights.get(g) || 0) > 0);
    const taste = (it.genres || []).reduce((sum, g) => sum + (weights.get(g) || 0), 0);
    return { it, hits, score: Math.max(1, 1 + taste + (it.rating >= 7.5 ? 4 : it.rating >= 6.5 ? 2 : 0)) };
  }).sort((a, b) => b.score - a.score).slice(0, 30);

  const total = scored.reduce((s, x) => s + x.score, 0);
  let roll = Math.random() * total;
  const pick = scored.find((x) => (roll -= x.score) <= 0) || scored[0];

  // Why this one: whichever seed it has most in common with (ties go to the more recent), named
  // along with the genre they share.
  const overlap = (s) => (s.genres || []).filter((g) => pick.hits.includes(g));
  const from = list.map((s) => ({ s, shared: overlap(s) })).filter((x) => x.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length)[0];
  const why = from ? (from.s.loved ? `More ${from.shared[0].toLowerCase()}, since you loved ${from.s.title}` : `More ${from.shared[0].toLowerCase()}, after ${from.s.title}`)
    : pick.hits.length ? `More ${pick.hits[0].toLowerCase()} for the house`
    : 'Never started, and highly rated';
  return { item: pick.it, why, pool: items.length };
}

// ---------- Year in review ----------

// The house's year, from Plex's history: how much was watched, by whom, what came back most
// often, and when the room is actually busy. Plays are exact; hours are an estimate - history
// records that something was watched, not for how long, so each play counts as the length of the
// film, or of a typical episode of that show.
let reviewCache = new Map();

export async function review({ year = new Date().getFullYear() } = {}) {
  const key = String(year);
  const hit = reviewCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.v;

  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime();
  const rows = (await plex.history({ size: 6000, since: from, dedupe: false })).filter((r) => r.viewedAt && r.viewedAt < to);
  const names = new Map((await plex.accounts().catch(() => [])).map((a) => [a.id, a.name]));
  const meta = await plex.metaBatch(rows.map((r) => r.key)).catch(() => new Map());

  // Median known length, for anything the library no longer has.
  const lengths = [...meta.values()].map((m) => m.duration).filter(Boolean).sort((a, b) => a - b);
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 45 * 60e3;
  const lengthOf = (k) => meta.get(k)?.duration || median;

  const titles = new Map();          // one row per film or series
  const people = new Map();
  const days = new Array(7).fill(0);
  const hours = new Array(24).fill(0);
  const months = new Array(12).fill(0);
  const binges = new Map();          // "key|date" -> plays, for the longest sitting
  let ms = 0;

  for (const r of rows) {
    const len = lengthOf(r.key);
    ms += len;
    const d = new Date(r.viewedAt);
    days[d.getDay()] += 1;
    hours[d.getHours()] += 1;
    months[d.getMonth()] += 1;

    const t = titles.get(r.key) || { key: r.key, title: r.title, type: r.type, plays: 0, ms: 0, poster: meta.get(r.key)?.poster || null, year: meta.get(r.key)?.year };
    t.plays += 1; t.ms += len;
    titles.set(r.key, t);

    const who = names.get(r.account) || 'Someone';
    const p = people.get(who) || { name: who, plays: 0, ms: 0, titles: new Set() };
    p.plays += 1; p.ms += len; p.titles.add(r.key);
    people.set(who, p);

    const bk = `${r.key}|${d.toDateString()}`;
    binges.set(bk, (binges.get(bk) || 0) + 1);
  }

  const [bingeKey, bingePlays] = [...binges.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const [bk, bdate] = bingeKey.split('|');
  const top = [...titles.values()].sort((a, b) => b.ms - a.ms).slice(0, 10);

  const v = {
    year,
    plays: rows.length,
    hours: Math.round(ms / 3600e3),
    movies: rows.filter((r) => r.type === 'movie').length,
    episodes: rows.filter((r) => r.type === 'show').length,
    distinct: titles.size,
    first: rows.length ? Math.min(...rows.map((r) => r.viewedAt)) : null,
    last: rows.length ? Math.max(...rows.map((r) => r.viewedAt)) : null,
    top,
    people: [...people.values()].map((p) => ({ name: p.name, plays: p.plays, hours: Math.round(p.ms / 3600e3), titles: p.titles.size }))
      .sort((a, b) => b.plays - a.plays).slice(0, 8),
    days, hours24: hours, months,
    binge: bingePlays > 2 ? { title: titles.get(bk)?.title || 'Something', plays: bingePlays, date: bdate, poster: titles.get(bk)?.poster || null } : null,
  };
  if (reviewCache.size > 8) reviewCache.clear();
  reviewCache.set(key, { at: Date.now(), v });
  return v;
}
