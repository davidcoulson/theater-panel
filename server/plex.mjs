// Plex Media Server API. Everything the Watch board needs: libraries, filtered listings, item
// details with tracks, on deck, recently added, search and the live sessions used by Showtime.
// Items are reduced to the fields the panel draws, with image URLs pointing at our proxy.

import { config } from './config.mjs';
import { plexImage, extImage } from './images.mjs';
import { BRANDS, brandById, brandForName } from './networks.mjs';
import { httpError } from './admin.mjs';

const FAMILY_RATINGS = ['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG'];
const SORTS = {
  added: 'addedAt:desc', title: 'titleSort', year: 'year:desc',
  rating: 'audienceRating:desc', random: 'random', released: 'originallyAvailableAt:desc',
};

async function plex(path, params = {}, { method = 'GET', timeoutMs = 15000 } = {}) {
  if (!config.plex.url) throw new Error('PLEX_URL is not set');
  const q = new URLSearchParams({ ...params, 'X-Plex-Token': config.plex.token });
  const res = await fetch(`${config.plex.url}${path}${path.includes('?') ? '&' : '?'}${q}`, {
    method,
    headers: { Accept: 'application/json', 'X-Plex-Client-Identifier': 'theater-panel', 'X-Plex-Product': 'Theater Panel' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // An item Plex no longer has is the caller's 404; anything else is Plex misbehaving.
  if (!res.ok) throw httpError(res.status === 404 ? 404 : 502, `Plex ${res.status} for ${path}`);
  const text = await res.text();
  return text ? JSON.parse(text).MediaContainer : {};
}

// Ids that end up as path segments on the Plex server. Anything but digits could walk out of
// /library/metadata into another endpoint with the owner's token.
function plexId(v, what) {
  const s = String(v ?? '');
  if (!/^\d+$/.test(s)) throw httpError(400, `Bad ${what}`);
  return s;
}

const tags = (arr, n = 99) => (arr || []).slice(0, n).map((t) => t.tag);

function versionLabel(m) {
  const res = m.videoResolution === '4k' ? '4K' : m.videoResolution ? `${m.videoResolution}p`.replace('pp', 'p') : '';
  const hdr = (m.Part?.[0]?.Stream || []).some((s) => s.streamType === 1 && (s.DOVIPresent || /hdr|pq|hlg/i.test(s.colorTrc || '')));
  const dv = (m.Part?.[0]?.Stream || []).some((s) => s.streamType === 1 && s.DOVIPresent);
  return [res.replace('sdp', 'SD'), dv ? 'Dolby Vision' : hdr ? 'HDR' : ''].filter(Boolean).join(' ');
}

export function mapItem(m, { poster = [300, 450] } = {}) {
  const media = m.Media?.[0];
  const isEp = m.type === 'episode';
  return {
    id: m.ratingKey,
    type: m.type,
    title: m.title,
    year: m.year,
    showTitle: isEp ? m.grandparentTitle : m.type === 'season' ? m.parentTitle : undefined,
    season: isEp ? m.parentIndex : m.type === 'season' ? m.index : undefined,
    episode: isEp ? m.index : undefined,
    summary: m.summary,
    duration: m.duration,
    viewOffset: m.viewOffset || 0,
    watched: m.type === 'show' ? m.viewedLeafCount >= m.leafCount : (m.viewCount || 0) > 0,
    leafCount: m.leafCount, viewedLeafCount: m.viewedLeafCount,
    contentRating: m.contentRating,
    rating: m.audienceRating ?? m.rating,
    genres: tags(m.Genre, 3),
    addedAt: m.addedAt,
    is4k: media?.videoResolution === '4k',
    // Grid badges. HDR is not in listings; listLibrary fills it in from Plex's hdr filter.
    quality: media ? {
      res: media.videoResolution === '4k' ? '4K' : null,
      audio: /atmos/i.test(media.audioProfile || '') ? 'Atmos' : /dts:x/i.test(media.audioProfile || '') ? 'DTS:X' : null,
      hdr: false,
    } : null,
    // Movies carry their studio; shows get their network from listLibrary (Plex lists omit it).
    brand: m.type === 'movie' ? brandForName(m.studio) : undefined,
    poster: plexImage(isEp ? (m.grandparentThumb || m.parentThumb || m.thumb) : m.thumb, ...poster),
    still: isEp ? plexImage(m.thumb, 640, 360) : undefined,
    art: plexImage(m.art || m.grandparentArt, 1280, 720),
  };
}

// The libraries picked in PLEX_LIBRARIES, as Plex has them.
async function sections() {
  const mc = await plex('/library/sections');
  let libs = (mc.Directory || [])
    .filter((d) => d.type === 'movie' || d.type === 'show')
    .map((d) => ({ id: d.key, title: d.title, type: d.type }));
  const wanted = config.plex.libraries;
  if (wanted.length) {
    libs = wanted.map((t) => libs.find((l) => l.title.toLowerCase() === t.toLowerCase())).filter(Boolean);
  }
  return libs;
}

// The panel's tabs. Several movie libraries (4K Movies + Movies) become one "Movies" tab, placed
// where the first of them was. Plex keeps them apart so phones never get a 4K file to transcode;
// on the projector each film should appear once, as its best copy.
export const MERGED = 'movies';
// Tab labels: Plex's own library names, tidied for the panel.
const LABELS = { 'tv shows': 'Shows', 'tv series': 'Shows' };
const label = (title) => LABELS[title.toLowerCase()] || title;

export async function libraries() {
  const libs = await sections();
  const movies = libs.filter((l) => l.type === 'movie');
  if (movies.length < 2) return libs.map((l) => ({ ...l, title: label(l.title) }));
  const at = libs.indexOf(movies[0]);
  const rest = libs.filter((l) => l.type !== 'movie');
  rest.splice(at, 0, { id: MERGED, title: 'Movies', type: 'movie' });
  return rest.map((l) => ({ ...l, title: label(l.title) }));
}

// Copies of one film share Plex's agent guid (plex://movie/...). Higher resolution wins.
const RES_RANK = { '4k': 5, 1080: 4, 720: 3, 576: 2, 480: 1, sd: 0 };
const resRank = (m) => RES_RANK[m.Media?.[0]?.videoResolution] ?? 0;
function bestCopies(list) {
  const best = new Map();
  for (const m of list) {
    const k = m.guid || `${m.type}:${m.title}:${m.year}`;
    const prev = best.get(k);
    if (!prev || resRank(m) > resRank(prev)) best.set(k, m);
  }
  return [...best.values()];
}

// Every film across the movie libraries, one row per film, rebuilt in the background every few
// minutes (the full listing is ~35 MB, so it is not fetched per page). A film counts as watched
// when any copy is.
const INDEX_TTL = 30 * 60e3;   // the full listing is ~35 MB, so rebuild it rarely (play invalidates it)
const INDEX_RETRY = 60e3;      // after a failed build, wait this long before asking Plex again
const INDEX_TIMEOUT = 60e3;    // the ~35 MB listing can take far longer than an ordinary call
let index = null; let indexAt = 0; let retryAt = 0; let building = null;
function buildIndex() {
  building ??= (async () => {
    const movies = (await sections()).filter((l) => l.type === 'movie');
    const rows = new Map();
    for (const lib of movies) {
      const [mc, hdr] = await Promise.all([
        // includeGuids: the TMDB id rides along, so a TMDB list can be matched to what is owned.
        plex(`/library/sections/${lib.id}/all`, { includeGuids: '1', 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': '50000' }, { timeoutMs: INDEX_TIMEOUT }),
        hdrKeys(lib.id).catch(() => new Set()),
      ]);
      for (const m of mc.Metadata || []) {
        const k = m.guid || `movie:${m.title}:${m.year}`;
        const prev = rows.get(k);
        const watched = (m.viewCount || 0) > 0 || !!prev?.watched;
        if (prev && resRank(m) <= prev.rank) { prev.watched = watched; continue; }
        const it = mapItem(m);
        if (it.quality) it.quality.hdr = hdr.has(m.ratingKey);
        const tmdb = (m.Guid || []).map((g) => g.id).find((id) => id.startsWith('tmdb://'));
        if (tmdb) it.tmdb = Number(tmdb.slice(7));
        // The house's own star rating (the "How was it?" card writes it), 1-10.
        if (m.userRating != null) it.userRating = Number(m.userRating);
        rows.set(k, { it, rank: resRank(m), watched, titleSort: (m.titleSort || m.title || '').toLowerCase(), released: m.originallyAvailableAt || '' });
      }
    }
    for (const r of rows.values()) r.it.watched = r.watched;
    index = [...rows.values()]; indexAt = Date.now();
    return index;
  })().catch((e) => {
    // Don't hammer Plex while it is down: whether or not an older index exists, the next attempt
    // waits INDEX_RETRY. Without this a failed first build would re-download the listing on every
    // request to the Movies tab.
    retryAt = Date.now() + INDEX_RETRY;
    throw e;
  }).finally(() => { building = null; });
  return building;
}
async function movieIndex() {
  const fresh = index && Date.now() - indexAt <= INDEX_TTL;
  if (fresh) return index;
  if (Date.now() < retryAt && !building) {
    if (index) return index;
    throw httpError(502, 'Plex movie listing is unavailable; retrying shortly');
  }
  if (!index) return buildIndex();
  buildIndex().catch((e) => console.warn('[plex] movie index:', e.message));
  return index;
}
// Warm the index at startup so the first visit to Watch is quick.
export const warmMovies = () => movieIndex().catch((e) => console.warn('[plex] movie index:', e.message));
// The owned films among a list of TMDB ids, in the list's order (a TMDB list, matched to the
// library). Each film once, as its best copy.
export async function byTmdb(ids) {
  const rows = await movieIndex();
  const have = new Map();
  for (const r of rows) if (r.it.tmdb && !have.has(r.it.tmdb)) have.set(r.it.tmdb, r.it);
  return ids.map((id) => have.get(Number(id))).filter(Boolean);
}
// Every film the house has given a star rating, off the index.
export async function ratedMovies() {
  const rows = await movieIndex();
  return rows.filter((r) => r.it.userRating != null).map((r) => r.it);
}
// After playback: refresh in the background so watched state catches up.
export const staleMovies = () => { indexAt = 0; };

const MERGED_SORTS = {
  added: (a, b) => (b.it.addedAt || 0) - (a.it.addedAt || 0),
  title: (a, b) => a.titleSort.localeCompare(b.titleSort),
  year: (a, b) => (b.it.year || 0) - (a.it.year || 0),
  rating: (a, b) => (b.it.rating ?? -1) - (a.it.rating ?? -1),
  released: (a, b) => b.released.localeCompare(a.released),
};

// The "recent" and "rated" filters, sized by the Mystery box settings: released within the last
// so many years, and an audience rating of at least the floor (Plex's 0-10 scale; a film with no
// rating does not qualify). Either at 0 lets everything through.
export const RECENT_FROM = () => new Date().getFullYear() - config.mystery.years;
export const RATED_MIN = () => config.mystery.minRating;

async function listMerged({ filters = [], brand, sort = 'added', start = 0, size = 60 }) {
  let rows = await movieIndex();
  if (filters.includes('unwatched')) rows = rows.filter((r) => !r.watched);
  if (filters.includes('recent') && config.mystery.years) rows = rows.filter((r) => (r.it.year || 0) >= RECENT_FROM());
  if (filters.includes('rated') && config.mystery.minRating) rows = rows.filter((r) => (r.it.rating ?? 0) >= RATED_MIN());
  if (filters.includes('short')) rows = rows.filter((r) => r.it.duration && r.it.duration < 7200000);
  if (filters.includes('family')) rows = rows.filter((r) => FAMILY_RATINGS.includes(r.it.contentRating));
  if (filters.includes('4k')) rows = rows.filter((r) => r.it.is4k);
  if (filters.includes('hdr')) rows = rows.filter((r) => r.it.quality?.hdr);
  if (brand) rows = rows.filter((r) => r.it.brand === brand);
  rows = sort === 'random' ? shuffle(rows) : [...rows].sort(MERGED_SORTS[sort] || MERGED_SORTS.added);
  return { total: rows.length, items: rows.slice(start, start + size).map((r) => r.it) };
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Everything from one brand across the panel's tabs, newest first. Movies come from the merged
// Movies tab, so each film appears once, as its best copy.
export async function brandBrowse(brandId, { filters = [], size = 60 } = {}) {
  const libs = await libraries();
  const lists = await Promise.all(libs.map((l) => listLibrary(l.id, { filters: filters.filter((f) => f === 'unwatched'), brand: brandId, sort: 'added', size })
    .then((r) => r.items).catch(() => [])));
  const seen = new Map();
  for (const it of lists.flat()) {
    const k = `${it.type}:${it.title.toLowerCase()}:${it.year}`;
    const prev = seen.get(k);
    if (!prev || (it.is4k && !prev.is4k)) seen.set(k, it);
  }
  const items = [...seen.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, size);
  return { total: items.length, items };
}

export async function genres(sectionId) {
  const mc = await plex(`/library/sections/${sectionId}/genre`);
  return (mc.Directory || []).map((g) => ({ id: g.key, title: g.title }));
}

// Small in-memory cache for lookups that are expensive and change slowly.
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

async function sectionType(sectionId) {
  const libs = await cached('libs', 3600e3, () => plex('/library/sections'));
  return (libs.Directory || []).find((d) => String(d.key) === String(sectionId))?.type;
}

// Plex ids of this brand's networks (TV) or studios (movies) in a section, comma-joined.
async function brandFilter(sectionId, brandId) {
  const brand = brandById(brandId);
  if (!brand) return null;
  const field = (await sectionType(sectionId)) === 'show' ? 'network' : 'studio';
  const dir = await cached(`dir:${sectionId}:${field}`, 3600e3, () => plex(`/library/sections/${sectionId}/${field}`));
  const ids = (dir.Directory || []).filter((d) => brand.plex.includes(d.title.toLowerCase())).map((d) => d.key);
  return ids.length ? { field, ids: ids.join(',') } : null;
}

// Which items in a movie section are HDR (Plex can filter on it but doesn't list it).
function hdrKeys(sectionId) {
  return cached(`hdr:${sectionId}`, 1800e3, async () => {
    const mc = await plex(`/library/sections/${sectionId}/all`, { hdr: '1', 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': '50000' }, { timeoutMs: INDEX_TIMEOUT });
    return new Set((mc.Metadata || []).map((m) => m.ratingKey));
  });
}

// Show ratingKey -> brand id for a TV section, built from the network filter per brand.
function showBrands(sectionId) {
  return cached(`brands:${sectionId}`, 1800e3, async () => {
    const map = new Map();
    for (const b of BRANDS) {
      const f = await brandFilter(sectionId, b.id);
      if (!f) continue;
      const mc = await plex(`/library/sections/${sectionId}/all`, { [f.field]: f.ids, 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': '3000' });
      for (const m of mc.Metadata || []) if (!map.has(m.ratingKey)) map.set(m.ratingKey, b.id);
    }
    return map;
  });
}

async function decorate(sectionId, items) {
  const type = await sectionType(sectionId);
  if (type === 'movie') {
    const hdr = await hdrKeys(sectionId).catch(() => new Set());
    for (const it of items) if (it.quality) it.quality.hdr = hdr.has(it.id);
  } else if (type === 'show') {
    const brands = await showBrands(sectionId).catch(() => new Map());
    for (const it of items) it.brand = brands.get(it.id);
  }
  return items;
}

// filters: unwatched, short (movies under 2h), family (G/PG/TV-G...), 4k, hdr, genre=<id>, brand=<id>
export async function listLibrary(sectionId, { filters = [], genre, brand, sort = 'added', start = 0, size = 60 } = {}) {
  if (sectionId === MERGED) return listMerged({ filters, brand, sort, start, size });
  const p = {
    sort: SORTS[sort] || SORTS.added,
    'X-Plex-Container-Start': String(start),
    'X-Plex-Container-Size': String(size),
  };
  if (filters.includes('unwatched')) p.unwatched = '1';
  if (filters.includes('recent') && config.mystery.years) p['year>>='] = String(RECENT_FROM());
  if (filters.includes('rated') && config.mystery.minRating) p['audienceRating>>='] = String(RATED_MIN());
  if (filters.includes('short')) p['duration<<'] = '7200000';
  if (filters.includes('family')) p.contentRating = FAMILY_RATINGS.join(',');
  if (filters.includes('4k')) p.resolution = '4k';
  if (filters.includes('hdr')) p.hdr = '1';
  if (genre) p.genre = genre;
  if (brand) {
    const f = await brandFilter(sectionId, brand);
    if (!f) return { total: 0, items: [] };
    p[f.field] = f.ids;
  }
  const mc = await plex(`/library/sections/${sectionId}/all`, p);
  const items = await decorate(sectionId, (mc.Metadata || []).map((m) => mapItem(m)));
  return { total: mc.totalSize ?? mc.size ?? 0, items };
}

export async function item(id) {
  id = plexId(id, 'item id');
  // includeOnDeck answers the "what plays next" question for a show in the same call.
  const mc = await plex(`/library/metadata/${id}`, { includeOnDeck: '1' });
  const m = mc.Metadata?.[0];
  if (!m) throw httpError(404, 'Not found');
  const out = {
    ...mapItem(m, { poster: [400, 600] }),
    directors: tags(m.Director, 2),
    cast: tags(m.Role, 4),
    studio: m.studio,
    tagline: m.tagline,
    genres: tags(m.Genre, 4),
    versions: (m.Media || []).map((v, i) => ({ index: i, id: v.id, label: versionLabel(v) || `Version ${i + 1}` })),
  };
  const media = m.Media?.[0];
  if (media) {
    // Detail badges: resolution, Dolby Vision / HDR (from the video stream), Atmos / DTS:X.
    const video = (media.Part?.[0]?.Stream || []).find((x) => x.streamType === 1) || {};
    const hdr = video.DOVIPresent ? 'Dolby Vision' : /smpte2084|pq/i.test(video.colorTrc || '') ? 'HDR10' : /hlg|arib/i.test(video.colorTrc || '') ? 'HLG' : null;
    out.badges = [
      media.videoResolution === '4k' ? '4K' : media.videoResolution ? `${media.videoResolution}p`.replace(/^sdp$/, 'SD') : null,
      hdr,
      /atmos/i.test(media.audioProfile || '') ? 'Dolby Atmos' : /dts:x/i.test(media.audioProfile || '') ? 'DTS:X' : null,
    ].filter(Boolean);
  }
  // For a show, its network and its seasons are independent lookups; ask for both at once.
  const [brands, seasons] = m.type === 'show'
    ? await Promise.all([showBrands(m.librarySectionID).catch(() => new Map()), plex(`/library/metadata/${id}/children`)])
    : [null, null];
  out.brand = m.type === 'movie' ? brandForName(m.studio) : m.type === 'show' ? brands.get(String(id)) : undefined;
  const part = m.Media?.[0]?.Part?.[0];
  if (part) {
    const streams = part.Stream || [];
    out.partId = part.id;
    out.audio = streams.filter((s) => s.streamType === 2).map((s) => ({ id: s.id, label: s.displayTitle || s.language, selected: !!s.selected }));
    // Label with the track title when there is one ("English SDH"), else the language.
    out.subtitles = streams.filter((s) => s.streamType === 3).map((s) => ({
      id: s.id, language: s.language, label: [s.language || s.displayTitle, s.title].filter(Boolean).join(' '),
      selected: !!s.selected, forced: !!s.forced || /forced/i.test(s.title || ''),
    }));
  }
  if (m.type === 'show' || m.type === 'season') {
    out.seasons = (seasons?.Metadata || []).map((s) => ({ id: s.ratingKey, title: s.title, index: s.index, leafCount: s.leafCount, viewedLeafCount: s.viewedLeafCount }));
    // The episode to play next: Plex's own on-deck choice for this show.
    const od = m.OnDeck?.Metadata?.[0];
    if (od) out.next = mapItem(od);
    else {
      // Nothing in progress: start at the first unwatched episode (or the first one).
      const leaves = await plex(`/library/metadata/${id}/allLeaves`).catch(() => null);
      const eps = (leaves?.Metadata || []).filter((e) => e.parentIndex !== 0);
      const first = eps.find((e) => !e.viewCount) || eps[0];
      if (first) out.next = mapItem(first);
    }
  }
  return out;
}

export async function episodes(seasonId) {
  const mc = await plex(`/library/metadata/${plexId(seasonId, 'season id')}/children`);
  return (mc.Metadata || []).map((m) => mapItem(m));
}

export async function onDeck(size = 12) {
  const mc = await plex('/library/onDeck', { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(size) });
  return (mc.Metadata || []).map((m) => mapItem(m));
}

export async function recentlyAdded(size = 16) {
  const libs = await sections();
  const lists = await Promise.all(libs.map((l) =>
    plex(`/library/sections/${l.id}/recentlyAdded`, { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(size) })
      .then((mc) => mc.Metadata || []).catch(() => [])));
  return bestCopies(lists.flat())
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
    .slice(0, size)
    .map((m) => mapItem(m));
}

// The idle screen's list: what is in progress, what just arrived, and what is on its way.
export async function showing(size = 10) {
  const [deck, recent] = await Promise.all([onDeck(6).catch(() => []), recentlyAdded(size).catch(() => [])]);
  const out = [];
  const seen = new Set();
  const key = (m) => `${m.showTitle || m.title}`.toLowerCase();
  for (const m of deck) {
    if (seen.has(key(m))) continue;
    seen.add(key(m));
    out.push({ ...m, id: `deck-${m.id}`, kind: 'deck', label: m.viewOffset ? 'Continue watching' : 'Up next' });
  }
  for (const m of recent) {
    if (seen.has(key(m))) continue;
    seen.add(key(m));
    out.push({ ...m, id: `new-${m.id}`, kind: 'new', label: 'Just added' });
  }
  return out;
}

export async function search(query, size = 30) {
  const mc = await plex('/hubs/search', { query, limit: String(size) });
  const out = [];
  for (const hub of mc.Hub || []) {
    if (!['movie', 'show', 'episode'].includes(hub.type)) continue;
    out.push(...(hub.type === 'movie' ? bestCopies(hub.Metadata || []) : hub.Metadata || []));
  }
  return out.map((m) => mapItem(m));
}

// The server's machine identifier (Plezy's play links name the server by it).
export const machineId = () => cached('identity', 3600e3, async () => (await plex('/identity')).machineIdentifier);

// "Start over" for a client that always resumes: clear the saved position first. Only for items
// not yet watched, so a rewatch never loses its watched state.
export async function clearProgress(ratingKey) {
  ratingKey = plexId(ratingKey, 'ratingKey');
  const m = (await plex(`/library/metadata/${ratingKey}`)).Metadata?.[0];
  if (m?.viewOffset && !m.viewCount) {
    await plex('/:/unscrobble', { key: String(ratingKey), identifier: 'com.plexapp.plugins.library' });
  }
}

// Chosen audio/subtitle tracks are stored on the part, so the Apple TV picks them up when it
// starts playing. subtitleStreamID=0 turns subtitles off.
export async function setStreams(partId, { audioStreamID, subtitleStreamID }) {
  const p = { allParts: '1' };
  if (audioStreamID != null) p.audioStreamID = String(audioStreamID);
  if (subtitleStreamID != null) p.subtitleStreamID = String(subtitleStreamID);
  await plex(`/library/parts/${plexId(partId, 'partId')}`, p, { method: 'PUT' });
}

// One call to /status/sessions, read two ways: `sessions` for Showtime (what the theater is
// playing) and `streams` for the "N streams" pill (everything, with Tautulli-style detail).
export async function activity() {
  const mc = await plex('/status/sessions');
  const md = mc.Metadata || [];
  return { sessions: md.map(mapSession), streams: md.map(mapStream) };
}

function mapStream(m) {
  const media = m.Media?.[0] || {};
  const part = media.Part?.[0] || {};
  const ts = m.TranscodeSession || null;
  const stream = (part.Stream || []).find((x) => x.streamType === 1) || {};
  const decision = ts ? (ts.videoDecision === 'transcode' ? 'Transcode' : ts.videoDecision === 'copy' ? 'Direct stream' : 'Direct play') : 'Direct play';
  return {
    key: m.sessionKey || `${m.ratingKey}-${m.Player?.machineIdentifier}`,
    title: m.title,
    showTitle: m.grandparentTitle || null,
    season: m.parentIndex ?? null,
    episode: m.index ?? null,
    type: m.type,
    year: m.year,
    poster: plexImage(m.type === 'episode' ? (m.grandparentThumb || m.thumb) : m.thumb, 160, 240),
    user: m.User?.title || 'Someone',
    player: m.Player?.title || 'Unknown player',
    product: m.Player?.product || '',
    local: m.Player?.local === '1' || m.Player?.local === true,
    state: m.Player?.state || 'playing',
    viewOffset: m.viewOffset || 0,
    duration: m.duration || 0,
    // What the file is, and what the viewer is actually getting.
    source: [media.videoResolution === '4k' ? '4K' : media.videoResolution ? `${media.videoResolution}p` : null,
      (media.videoCodec || '').toUpperCase(), stream.DOVIPresent ? 'DV' : /pq|smpte2084/i.test(stream.colorTrc || '') ? 'HDR' : null].filter(Boolean).join(' · '),
    audio: [(media.audioCodec || '').toUpperCase(), media.audioChannels ? `${media.audioChannels}ch` : null].filter(Boolean).join(' '),
    decision,
    hw: Boolean(ts?.transcodeHwEncoding || ts?.transcodeHwDecoding),
    throttled: Boolean(ts?.throttled),
    bitrate: media.bitrate || null,           // kbps of the source
    bandwidth: m.Session?.bandwidth || null,  // kbps Plex reserves for this stream
    location: m.Session?.location || (m.Player?.local ? 'lan' : 'wan'),
  };
}

// What is playing right now, from Plex's point of view. Richer than the Apple TV entity:
// artwork, exact position and whether the stream is being transcoded.
export async function sessions() {
  const mc = await plex('/status/sessions');
  return (mc.Metadata || []).map(mapSession);
}

function mapSession(m) {
  return ({
    ...mapItem(m),
    player: m.Player?.title,
    product: m.Player?.product,
    state: m.Player?.state,
    transcoding: (m.TranscodeSession?.videoDecision || 'directplay') === 'transcode',
    decision: m.TranscodeSession ? m.TranscodeSession.videoDecision : 'directplay',
    user: m.User?.title,
  });
}

// ---------- Watch history ----------

// Plex keeps its own history, so "because you watched" needs no Tautulli and no Trakt account.
// One row per title, newest first: a week of one series is a single seed, not twenty episodes.
// accounts (Plex account ids) narrows it to whoever's taste should drive the panel; empty is
// the whole house.
export async function history({ size = 200, accounts = [], since = null, dedupe = true } = {}) {
  const mc = await plex('/status/sessions/history/all', {
    sort: 'viewedAt:desc', 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(Math.min(Number(size) || 200, 6000)),
    ...(since ? { 'viewedAt>': String(Math.floor(since / 1000)) } : {}),
  });
  const only = accounts.map(Number).filter(Number.isFinite);
  const out = new Map();
  const all = [];
  for (const m of mc.Metadata || []) {
    if (only.length && !only.includes(m.accountID)) continue;
    const isEp = m.type === 'episode';
    // History rows name the show by its key, not a ratingKey of its own.
    const key = String(isEp ? (m.grandparentKey || '').split('/').pop() : m.ratingKey || '');
    if (!key) continue;
    const row = {
      key,
      type: isEp ? 'show' : 'movie',
      title: (isEp ? m.grandparentTitle : m.title) || '',
      episode: isEp ? m.title : undefined,
      viewedAt: m.viewedAt ? m.viewedAt * 1000 : null,
      account: m.accountID,
    };
    if (!dedupe) { all.push(row); continue; }
    if (!out.has(key)) out.set(key, row);
  }
  return dedupe ? [...out.values()] : all;
}

// Metadata for a pile of ratingKeys at once (Plex takes a comma-separated list), for the numbers
// on the Year in review screen. A show's duration is its typical episode length, which is what
// turns "412 episodes" into "about 300 hours".
export async function metaBatch(keys) {
  const out = new Map();
  const list = [...new Set(keys.map(String))];
  for (let i = 0; i < list.length; i += 40) {
    const mc = await plex(`/library/metadata/${list.slice(i, i + 40).join(',')}`).catch(() => null);
    for (const m of mc?.Metadata || []) {
      out.set(String(m.ratingKey), {
        title: m.title, type: m.type, year: m.year, duration: m.duration || 0,
        poster: plexImage(m.thumb, 200, 300),
      });
    }
  }
  return out;
}

// The Plex accounts that have watched anything, for the settings page's "whose taste" field.
export const accounts = () => cached('accounts', 3600e3, async () => {
  const mc = await plex('/accounts');
  return (mc.Account || []).filter((a) => a.name).map((a) => ({ id: Number(a.id), name: a.name }));
});

// What a history row needs to become a recommendation seed: its TMDB id (Plex stores it as a
// guid) and its genres. Cached for the day - neither changes.
export const seedDetails = (ratingKey) => cached(`seed:${ratingKey}`, 12 * 3600e3, async () => {
  const m = (await plex(`/library/metadata/${ratingKey}`, { includeGuids: '1' })).Metadata?.[0];
  if (!m) return null;
  const tmdb = (m.Guid || []).map((g) => g.id).find((id) => id.startsWith('tmdb://'));
  return {
    id: String(m.ratingKey), type: m.type, title: m.title, year: m.year,
    poster: plexImage(m.thumb, 200, 300),
    genres: tags(m.Genre, 5),
    tmdbId: tmdb ? Number(tmdb.slice(7)) : null,
  };
});

// A star rating back to Plex (1-10, or -1 to clear it). Plex stores it as userRating on the
// item, which is what the panel's popcorn boxes write after a film.
export async function rate(ratingKey, rating) {
  const r = Math.max(-1, Math.min(10, Number(rating)));
  await plex('/:/rate', { key: Number(ratingKey), identifier: 'com.plexapp.plugins.library', rating: r }, 'PUT');
  staleMovies();
  return { ratingKey: String(ratingKey), rating: r };
}

// Every film in the movie libraries' collections whose title matches - Kometa's seasonal
// collections ("Halloween.", "Christmas.") for the holiday shelves. One entry per film, as its
// best copy, like the merged Movies tab.
export const collectionItems = (re) => cached(`coll:${re}`, 6 * 3600e3, async () => {
  const libs = (await sections()).filter((l) => l.type === 'movie');
  const lists = await Promise.all(libs.map(async (l) => {
    const c = await plex(`/library/sections/${l.id}/collections`).catch(() => null);
    const hits = (c?.Metadata || []).filter((m) => re.test(m.title));
    const kids = await Promise.all(hits.map((h) => plex(`/library/collections/${h.ratingKey}/children`).then((r) => r.Metadata || []).catch(() => [])));
    return kids.flat();
  }));
  // All the genres, not mapItem's first three: the holiday shelves check for Horror, which is
  // often listed after Comedy or Fantasy.
  return bestCopies(lists.flat().filter((m) => m.type === 'movie')).map((m) => ({ ...mapItem(m), allGenres: tags(m.Genre) }));
});

// ---------- the watchlist ----------

// plex.tv's own endpoints: an account token, and the client identity the token was made under.
const PLEX_TV = { 'X-Plex-Client-Identifier': 'theater-panel', 'X-Plex-Product': 'Theater Panel', 'X-Plex-Version': '1.0', Accept: 'application/json' };
async function plexTv(url, { method = 'GET', token = config.plex.accountToken, body } = {}) {
  const res = await fetch(url, { method, headers: { ...PLEX_TV, ...(token ? { 'X-Plex-Token': token } : {}), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(res.status === 401 ? 'plex.tv refused the account token' : `plex.tv ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// The account's watchlist, matched to the library: what is owned carries the key that plays it,
// the rest carries its TMDB id for a request. Ten minutes between looks.
export const watchlist = () => cached('watchlist', 10 * 60e3, async () => {
  if (!config.plex.accountToken) return null;
  // plex.tv hands the watchlist out twenty at a time and refuses a page size, so walk it by
  // start offset until the container says there is no more (capped at ten pages).
  const all = [];
  for (let start = 0, pages = 0; pages < 10; pages += 1) {
    const d = await plexTv(`https://discover.provider.plex.tv/library/sections/watchlist/all?includeGuids=1&X-Plex-Container-Start=${start}`);
    const page = d.MediaContainer?.Metadata || [];
    all.push(...page);
    start += page.length;
    if (!page.length || start >= (d.MediaContainer?.totalSize || 0)) break;
  }
  const rows = await movieIndex().catch(() => []);
  const owned = new Map();
  for (const r of rows) if (r.it.tmdb && !owned.has(r.it.tmdb)) owned.set(r.it.tmdb, r.it);
  return all.map((m) => {
    const tmdb = (m.Guid || []).map((g) => g.id).find((id) => id.startsWith('tmdb://'));
    const tmdbId = tmdb ? Number(tmdb.slice(7)) : null;
    const have = m.type === 'movie' && tmdbId ? owned.get(tmdbId) : null;
    return {
      tmdbId, mediaType: m.type === 'show' ? 'tv' : 'movie', title: m.title, year: m.year,
      owned: Boolean(have), id: have?.id, watched: have?.watched, duration: have?.duration,
      poster: have?.poster || extImage(m.thumb), addedAt: m.addedAt,
    };
  }).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
});

// Signing in to plex.tv for the watchlist, without the panel ever seeing a password: plex.tv
// hands out a PIN, the person approves it on plex.tv, and the token arrives on the next poll.
export async function pinStart() {
  const d = await plexTv('https://plex.tv/api/v2/pins', { method: 'POST', token: '', body: 'strong=true' });
  const url = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(PLEX_TV['X-Plex-Client-Identifier'])}&code=${encodeURIComponent(d.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PLEX_TV['X-Plex-Product'])}`;
  return { id: d.id, code: d.code, url, expiresAt: d.expiresAt };
}
export async function pinCheck(id) {
  const d = await plexTv(`https://plex.tv/api/v2/pins/${Number(id)}`, { token: '' });
  return d.authToken || null;
}
// Who the account token belongs to (the settings page shows it).
export async function account(token = config.plex.accountToken) {
  if (!token) return null;
  const u = await plexTv('https://plex.tv/api/v2/user', { token });
  return { username: u.username, title: u.title || u.friendlyName };
}
