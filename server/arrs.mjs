// Release calendar: what Sonarr and Radarr expect to air or come out around today, merged into one
// list of dated events. Radarr and its 4K twin both keep movies, so a film in both is one event
// with a 4K badge. Each instance is asked on its own; one that is down leaves a note, not a blank.

import { config } from './config.mjs';
import { tmdbImage, extImage } from './images.mjs';

async function arr(svc, path, params) {
  const res = await fetch(`${svc.url}/api/v3${path}?${new URLSearchParams(params)}`, {
    headers: { 'X-Api-Key': svc.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// TMDB posters come as full-size originals; ask TMDB for a thumbnail instead. Anything else (TVDB)
// goes through the image proxy as it is.
function poster(images) {
  const url = (images || []).find((i) => i.coverType === 'poster')?.remoteUrl;
  const tmdb = url?.match(/^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+(\/.+)$/);
  return tmdb ? tmdbImage(tmdb[1], 'w185') : extImage(url);
}

const day = (iso) => (iso ? iso.slice(0, 10) : null);

function episodes(list) {
  return list.map((e) => ({
    id: `e${e.id}`,
    kind: 'tv',
    seriesId: e.seriesId,
    // A real instant: the page puts it on its own local day and shows the time.
    at: e.airDateUtc,
    title: e.series?.title || 'Unknown series',
    season: e.seasonNumber,
    episode: e.episodeNumber,
    name: e.title && e.title !== 'TBA' ? e.title : null,
    premiere: e.episodeNumber === 1,
    finale: e.finaleType || null,
    network: e.series?.network || null,
    hasFile: Boolean(e.hasFile),
    poster: poster(e.series?.images),
  }));
}

// A movie becomes one event per release that falls in the window. A disc release after the film
// was already out digitally is noise (it can be watched already), and so is a cinema date after
// a digital one (festival films that streamed first).
function movies(hd, uhd, start, end) {
  const byId = new Map();
  for (const [list, is4k] of [[hd, false], [uhd, true]]) {
    for (const m of list) {
      const prev = byId.get(m.tmdbId);
      const has = { hd: Boolean(prev?.has.hd) || (!is4k && m.hasFile), uhd: Boolean(prev?.has.uhd) || (is4k && m.hasFile) };
      byId.set(m.tmdbId, { m: prev?.m || m, has, in4k: Boolean(prev?.in4k) || is4k, inHd: Boolean(prev?.inHd) || !is4k });
    }
  }
  const inWindow = (d) => d && d >= start && d < end;
  const out = [];
  for (const { m, has, in4k, inHd } of byId.values()) {
    const digital = day(m.digitalRelease), physical = day(m.physicalRelease), cinema = day(m.inCinemas);
    const base = {
      kind: 'movie', tmdbId: m.tmdbId, title: m.title, year: m.year, poster: poster(m.images),
      hasFile: has.hd || has.uhd, has4k: has.uhd, in4k, inHd, runtime: m.runtime || null,
    };
    if (inWindow(cinema) && !(digital && digital < cinema)) out.push({ ...base, id: `c${m.tmdbId}`, date: cinema, release: 'cinema' });
    if (inWindow(digital)) out.push({ ...base, id: `d${m.tmdbId}`, date: digital, release: 'digital' });
    if (inWindow(physical) && !(digital && digital <= physical)) out.push({ ...base, id: `p${m.tmdbId}`, date: physical, release: 'physical' });
  }
  return out;
}

export const configured = () => Boolean(config.arrs.sonarr.url || config.arrs.radarr.url || config.arrs.radarr4k.url);

// Days are whole UTC days around today, padded by one on each side so every local day the page
// shows is complete whatever the panel's time zone. Cached briefly: the page asks on every visit.
const cache = new Map();
export async function calendar(back = 7, ahead = 21) {
  const b = Math.max(0, Math.min(Number(back) || 0, 31)), a = Math.max(1, Math.min(Number(ahead) || 1, 62));
  const key = `${b}:${a}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.data;

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const shift = (n) => new Date(today.getTime() + n * 86400000).toISOString();
  const start = shift(-b - 1), end = shift(a + 2);
  const { sonarr, radarr, radarr4k } = config.arrs;
  const ask = (svc, path, params) => (svc.url ? arr(svc, path, params) : Promise.resolve([]));
  const [tv, hd, uhd] = await Promise.allSettled([
    ask(sonarr, '/calendar', { start, end, includeSeries: 'true', unmonitored: 'false' }),
    ask(radarr, '/calendar', { start, end, unmonitored: 'false' }),
    ask(radarr4k, '/calendar', { start, end, unmonitored: 'false' }),
  ]);
  const errors = [];
  const take = (r, name) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`[calendar] ${name}: ${r.reason?.message || r.reason}`);
    errors.push(`${name} did not answer`);
    return [];
  };
  const events = [
    ...episodes(take(tv, 'Sonarr')),
    ...movies(take(hd, 'Radarr'), take(uhd, 'Radarr 4K'), day(start), day(end)),
  ];
  const data = { events, errors, services: { tv: Boolean(sonarr.url), movies: Boolean(radarr.url || radarr4k.url) } };
  // A partial answer is kept for a minute only, so a service that comes back shows up soon.
  cache.set(key, { at: errors.length ? Date.now() - 4 * 60000 : Date.now(), data });
  return data;
}
