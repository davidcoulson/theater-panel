// The holiday shelves and the Coming soon board: things for the idle screen to show between the
// films in progress, and a shelf on the For you tab while the season lasts.
//
//   Halloween Scares   all of October
//   Christmas Movies   Thanksgiving through New Year's Eve
//
// Both start from Kometa's seasonal collections in Plex ("Halloween.", "Christmas.") - owned and
// playable - and keep only what belongs on the shelf. Kometa's lists are broad: its Halloween
// collection has Twilight and Fantastic Beasts in it for their vampires and wizards. So a
// Halloween Scare has to be filed as Horror, or be about Halloween itself (trick-or-treating, a
// haunting, ghosts, witches); a Christmas Movie has to mention Christmas in its title or plot.
// Kometa only builds a season's collection inside its own window, so until it does the shelf
// falls back to films you own that TMDB tags with the holiday, through the same test (TMDB's
// "christmas" tag alone leads with the Harry Potter films, for their Christmas scenes).

import * as plex from './plex.mjs';
import * as seerr from './seerr.mjs';
import { thanksgiving } from './accents.mjs';

const HALLOWEEN = /hallowe'?en|trick.or.treat|haunt|ghost|witch|pumpkin|spook|jack-o|all hallows/i;
const CHRISTMAS = /christmas|santa|xmas|noel|sleigh|\belf\b|grinch|scrooge|nutcracker|reindeer|mistletoe|north pole/i;
// Christmas movies whatever anyone's database says - Die Hard's plot summary is all terrorists
// and Nakatomi Plaza. Always on the shelf when they're in the library, found by title if neither
// Kometa's collection nor TMDB's holiday tag has them.
const HONORARY_CHRISTMAS = ['Die Hard', 'Gremlins', 'Lethal Weapon', 'Iron Man 3', 'Batman Returns', 'Trading Places', 'Edward Scissorhands'];
const honorary = (it) => HONORARY_CHRISTMAS.some((t) => t.toLowerCase() === String(it.title).toLowerCase());
const SEASONS = {
  halloween: {
    title: 'Halloween Scares', kicker: 'All October, from your library',
    collection: /^halloween\.?$/i, keyword: 3335,
    keep: (it) => it.horror || (it.allGenres || it.genres || []).includes('Horror') || HALLOWEEN.test(`${it.title} ${it.summary || it.overview || ''}`),
  },
  christmas: {
    title: 'Christmas Movies', kicker: "Thanksgiving to New Year's Eve, from your library",
    collection: /^(christmas|holiday)\.?$/i, keyword: 207317,
    always: HONORARY_CHRISTMAS,
    keep: (it) => honorary(it) || CHRISTMAS.test(`${it.title} ${it.summary || it.overview || ''}`),
  },
};

// Which holiday shelf is up today, if any.
export function seasonNow(now = new Date()) {
  const m = now.getMonth() + 1, d = now.getDate();
  if (m === 10) return 'halloween';
  if ((m === 11 && d >= thanksgiving(now.getFullYear())) || m === 12) return 'christmas';
  return null;
}

const cache = new Map();

// The shelf for a season: { id, title, kicker, items }, or null out of season. Unwatched first,
// in an order that changes daily, so the idle screen doesn't show the same eight every time.
export async function shelf(season = seasonNow()) {
  const s = SEASONS[season];
  if (!s) return null;
  const day = new Date().toDateString();
  const hit = cache.get(season);
  if (hit && hit.day === day && Date.now() - hit.at < 6 * 3600e3) return hit.v;

  let items = (await plex.collectionItems(s.collection).catch(() => [])).filter(s.keep);
  let source = 'kometa';
  if (items.length < 8) {
    const tagged = await seerr.byKeyword(s.keyword).catch(() => []);
    const owned = tagged.filter((r) => r.plexKey && s.keep(r));
    items = owned.map((r) => ({ id: String(r.plexKey), type: 'movie', title: r.title, year: r.year, poster: r.poster, art: r.backdrop, rating: r.rating, watched: false }));
    source = 'tmdb';
  }
  for (const title of s.always || []) {
    if (items.some((it) => it.title.toLowerCase() === title.toLowerCase())) continue;
    const hit = (await plex.search(title, 10).catch(() => [])).find((m) => m.type === 'movie' && m.title.toLowerCase() === title.toLowerCase());
    if (hit) items.push(hit);
  }
  const seed = [...day].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const shuffled = items.map((it, i) => ({ it, k: ((seed ^ (i * 2654435761)) >>> 0) % 100000 }))
    .sort((a, b) => (a.it.watched - b.it.watched) || (a.k - b.k)).map((x) => x.it);
  const v = { id: season, title: s.title, kicker: s.kicker, source, total: items.length, items: shuffled.slice(0, 40) };
  cache.set(season, { at: Date.now(), day, v });
  return v;
}

// Coming soon: what has been asked for and isn't here yet, most imminent first - downloading now,
// then the soonest release date, then the rest.
export async function coming(limit = 8) {
  const { results } = await seerr.requests(20);
  const today = new Date().toISOString().slice(0, 10);
  const items = results.filter((r) => !['Available', 'Declined', 'Failed'].includes(r.label)).map((r) => {
    const future = r.releaseDate && r.releaseDate > today;
    let when;
    if (r.label === 'Downloading') when = r.progress != null ? `Downloading · ${r.progress}%` : 'Downloading';
    else if (future) when = `Out ${new Date(`${r.releaseDate}T12:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    else if (r.label === 'Waiting for approval') when = 'Requested';
    else when = 'On its way';
    const rank = r.label === 'Downloading' ? 0 : future ? 1 : 2;
    return { id: r.id, title: r.title, year: r.year, poster: r.poster, art: r.backdrop, mediaType: r.mediaType, when, rank, releaseDate: r.releaseDate, progress: r.progress };
  });
  items.sort((a, b) => a.rank - b.rank || (b.progress ?? 0) - (a.progress ?? 0) || String(a.releaseDate).localeCompare(String(b.releaseDate)));
  // A title asked for twice (another season, or 1080p and 4K) is one poster, at its best status.
  const seen = new Set();
  return items.filter((i) => { const k = `${i.mediaType}:${i.title}:${i.year}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
}
