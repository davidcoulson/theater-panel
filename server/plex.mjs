// Plex Media Server API. Everything the Watch board needs: libraries, filtered listings, item
// details with tracks, on deck, recently added, search and the live sessions used by Showtime.
// Items are reduced to the fields the panel draws, with image URLs pointing at our proxy.

import { config } from './config.mjs';
import { plexImage } from './images.mjs';
import { BRANDS, brandById, brandForName } from './networks.mjs';

const FAMILY_RATINGS = ['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG'];
const SORTS = {
  added: 'addedAt:desc', title: 'titleSort', year: 'year:desc',
  rating: 'audienceRating:desc', random: 'random', released: 'originallyAvailableAt:desc',
};

async function plex(path, params = {}, method = 'GET') {
  if (!config.plex.url) throw new Error('PLEX_URL is not set');
  const q = new URLSearchParams({ ...params, 'X-Plex-Token': config.plex.token });
  const res = await fetch(`${config.plex.url}${path}${path.includes('?') ? '&' : '?'}${q}`, {
    method,
    headers: { Accept: 'application/json', 'X-Plex-Client-Identifier': 'theater-panel', 'X-Plex-Product': 'Theater Panel' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Plex ${res.status} for ${path}`);
  const text = await res.text();
  return text ? JSON.parse(text).MediaContainer : {};
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
let index = null; let indexAt = 0; let building = null;
function buildIndex() {
  building ??= (async () => {
    const movies = (await sections()).filter((l) => l.type === 'movie');
    const rows = new Map();
    for (const lib of movies) {
      const [mc, hdr] = await Promise.all([
        plex(`/library/sections/${lib.id}/all`, { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': '50000' }),
        hdrKeys(lib.id).catch(() => new Set()),
      ]);
      for (const m of mc.Metadata || []) {
        const k = m.guid || `movie:${m.title}:${m.year}`;
        const prev = rows.get(k);
        const watched = (m.viewCount || 0) > 0 || !!prev?.watched;
        if (prev && resRank(m) <= prev.rank) { prev.watched = watched; continue; }
        const it = mapItem(m);
        if (it.quality) it.quality.hdr = hdr.has(m.ratingKey);
        rows.set(k, { it, rank: resRank(m), watched, titleSort: (m.titleSort || m.title || '').toLowerCase(), released: m.originallyAvailableAt || '' });
      }
    }
    for (const r of rows.values()) r.it.watched = r.watched;
    index = [...rows.values()]; indexAt = Date.now();
    return index;
  })().catch((e) => {
    indexAt = Date.now();   // don't hammer Plex while it is down; try again after the TTL
    throw e;
  }).finally(() => { building = null; });
  return building;
}
async function movieIndex() {
  if (!index) return buildIndex();
  if (Date.now() - indexAt > INDEX_TTL) buildIndex().catch((e) => console.warn('[plex] movie index:', e.message));
  return index;
}
// Warm the index at startup so the first visit to Watch is quick.
export const warmMovies = () => movieIndex().catch((e) => console.warn('[plex] movie index:', e.message));
// After playback: refresh in the background so watched state catches up.
export const staleMovies = () => { indexAt = 0; };

const MERGED_SORTS = {
  added: (a, b) => (b.it.addedAt || 0) - (a.it.addedAt || 0),
  title: (a, b) => a.titleSort.localeCompare(b.titleSort),
  year: (a, b) => (b.it.year || 0) - (a.it.year || 0),
  rating: (a, b) => (b.it.rating ?? -1) - (a.it.rating ?? -1),
  released: (a, b) => b.released.localeCompare(a.released),
};

async function listMerged({ filters = [], brand, sort = 'added', start = 0, size = 60 }) {
  let rows = await movieIndex();
  if (filters.includes('unwatched')) rows = rows.filter((r) => !r.watched);
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
    const mc = await plex(`/library/sections/${sectionId}/all`, { hdr: '1', 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': '50000' });
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
  const mc = await plex(`/library/metadata/${id}`);
  const m = mc.Metadata?.[0];
  if (!m) throw new Error('Not found');
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
  out.brand = m.type === 'movie' ? brandForName(m.studio)
    : m.type === 'show' ? (await showBrands(m.librarySectionID).catch(() => new Map())).get(String(id)) : undefined;
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
    const seasons = m.type === 'show' ? await plex(`/library/metadata/${id}/children`) : null;
    out.seasons = (seasons?.Metadata || []).map((s) => ({ id: s.ratingKey, title: s.title, index: s.index, leafCount: s.leafCount, viewedLeafCount: s.viewedLeafCount }));
    // The episode to play next: Plex's own on-deck choice for this show.
    const deck = await plex(`/library/metadata/${id}`, { includeOnDeck: '1' }).catch(() => null);
    const od = deck?.Metadata?.[0]?.OnDeck?.Metadata?.[0];
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
  const mc = await plex(`/library/metadata/${seasonId}/children`);
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
  await plex(`/library/parts/${partId}`, p, 'PUT');
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
export async function history({ size = 200, accounts = [] } = {}) {
  const mc = await plex('/status/sessions/history/all', {
    sort: 'viewedAt:desc', 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(Math.min(Number(size) || 200, 500)),
  });
  const only = accounts.map(Number).filter(Number.isFinite);
  const out = new Map();
  for (const m of mc.Metadata || []) {
    if (only.length && !only.includes(m.accountID)) continue;
    const isEp = m.type === 'episode';
    // History rows name the show by its key, not a ratingKey of its own.
    const key = String(isEp ? (m.grandparentKey || '').split('/').pop() : m.ratingKey || '');
    if (!key || out.has(key)) continue;
    out.set(key, {
      key,
      type: isEp ? 'show' : 'movie',
      title: (isEp ? m.grandparentTitle : m.title) || '',
      viewedAt: m.viewedAt ? m.viewedAt * 1000 : null,
      account: m.accountID,
    });
  }
  return [...out.values()];
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
