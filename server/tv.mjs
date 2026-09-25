// Whole seasons: which shows have every episode of their current season in the library, with
// the season finished airing, so a new show can be watched straight through instead of three
// in and a month of waiting. Plex knows what is on disk; TMDB knows how long the season is and
// whether it is still going. One pass per TV library, cached for six hours, rebuilt in the
// background when it is stale.

import { config } from './config.mjs';
import * as tmdb from './tmdb.mjs';

const TTL = 6 * 3600e3;
const builds = new Map();    // sectionId -> { at, map: Map<showId, status>, promise }

// The status of one show: the latest aired season, how many episodes of it are here, how many
// there are, and whether that is all of them with nothing more to come.
async function statusOf(show, plex) {
  if (!show.tmdb) return null;
  const [d, kids] = await Promise.all([
    tmdb.tv(show.tmdb).catch(() => null),
    plex(`/library/metadata/${show.id}/children`).catch(() => null),
  ]);
  if (!d) return null;
  const today = new Date().toISOString().slice(0, 10);
  const seasons = (d.seasons || []).filter((s) => s.season_number > 0 && s.air_date && s.air_date <= today).sort((a, b) => b.season_number - a.season_number);
  const cur = seasons[0];
  if (!cur) return null;
  const have = (kids?.Metadata || []).find((s) => s.index === cur.season_number)?.leafCount || 0;
  const next = d.next_episode_to_air;
  const airing = Boolean(next && next.season_number === cur.season_number);
  const total = cur.episode_count || 0;
  return { index: cur.season_number, have, total, airing, complete: total > 0 && have >= total && !airing, ended: d.status === 'Ended' || d.status === 'Canceled' };
}

async function build(sectionId, plex, listShows) {
  const shows = await listShows(sectionId);
  const map = new Map();
  let i = 0;
  const workers = Array.from({ length: 10 }, async () => {
    while (i < shows.length) {
      const show = shows[i++];
      const s = await statusOf(show, plex).catch(() => null);
      if (s) map.set(String(show.id), s);
    }
  });
  await Promise.all(workers);
  return map;
}

// The map for a section: ready or not. `wait` blocks for the build; otherwise a stale or missing
// map comes back at once and a rebuild runs behind it.
export async function seasons(sectionId, plex, listShows, { wait = false } = {}) {
  if (!config.tmdb.apiKey) return new Map();
  const key = String(sectionId);
  let b = builds.get(key);
  if (!b || (Date.now() - b.at > TTL && !b.promise)) {
    const promise = build(sectionId, plex, listShows).then((map) => { builds.set(key, { at: Date.now(), map, promise: null }); return map; })
      .catch((e) => { console.warn('[tv] seasons:', e.message); const cur = builds.get(key); if (cur) cur.promise = null; return cur?.map || new Map(); });
    b = { at: b?.at || 0, map: b?.map || new Map(), promise };
    builds.set(key, b);
  }
  if (wait && b.promise) return b.promise;
  return b.map;
}
