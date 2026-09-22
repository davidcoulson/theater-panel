// Seerr (Overseerr/Jellyseerr) API: search, discovery rows, title details, making requests and
// the request queue with Radarr/Sonarr download progress. Posters come from TMDB via our proxy.

import { config } from './config.mjs';
import { tmdbImage } from './images.mjs';
import { BRANDS, brandById } from './networks.mjs';

// Seerr media status codes.
const STATUS = { 1: 'unknown', 2: 'pending', 3: 'processing', 4: 'partial', 5: 'available', 6: 'deleted' };
const REQUEST_STATUS = { 1: 'pending', 2: 'approved', 3: 'declined', 4: 'failed', 5: 'completed' };

async function seerr(path, { method = 'GET', body, params } = {}) {
  if (!config.seerr.url) throw new Error('SEERR_URL is not set');
  const q = params ? `?${new URLSearchParams(params)}` : '';
  const headers = { 'X-Api-Key': config.seerr.apiKey, Accept: 'application/json' };
  if (config.seerr.userId) headers['X-Api-User'] = String(config.seerr.userId);
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${config.seerr.url}/api/v1${path}${q}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let msg = `Seerr ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function mapResult(r) {
  const type = r.mediaType || (r.firstAirDate !== undefined ? 'tv' : 'movie');
  const date = r.releaseDate || r.firstAirDate || '';
  return {
    id: r.id,
    mediaType: type,
    title: r.title || r.name,
    year: date ? Number(date.slice(0, 4)) : undefined,
    releaseDate: date || null,
    overview: r.overview,
    rating: r.voteAverage,
    poster: tmdbImage(r.posterPath, 'w342'),
    backdrop: tmdbImage(r.backdropPath, 'w780'),
    status: STATUS[r.mediaInfo?.status] || 'none',
    status4k: STATUS[r.mediaInfo?.status4k] || 'none',
    plexKey: r.mediaInfo?.ratingKey || null,
  };
}

const keep = (r) => r.mediaType === 'movie' || r.mediaType === 'tv';

// Seerr validates the query strictly: encode it ourselves (spaces as %20, and the characters
// encodeURIComponent leaves alone) rather than letting URLSearchParams turn spaces into '+'.
const encodeQuery = (q) => encodeURIComponent(q).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export async function search(query, page = 1) {
  const d = await seerr(`/search?query=${encodeQuery(query)}&page=${Number(page) || 1}`);
  return { page: d.page, totalPages: d.totalPages, results: d.results.filter(keep).map(mapResult) };
}

const DISCOVER = {
  trending: ['/discover/trending', null],
  movies: ['/discover/movies/upcoming', 'movie'],
  tv: ['/discover/tv/upcoming', 'tv'],
};
export async function discover(kind = 'trending', page = 1) {
  const [path, fixedType] = DISCOVER[kind] || DISCOVER.trending;
  const d = await seerr(path, { params: { page } });
  const results = d.results.map((r) => ({ ...r, mediaType: r.mediaType || fixedType })).filter(keep).map(mapResult);
  return { page: d.page, totalPages: d.totalPages, results };
}

// "Streaming on <brand>": TMDB watch providers for the region, movies or shows.
export async function byProvider(brandId, mediaType = 'movie', page = 1) {
  const brand = brandById(brandId);
  if (!brand) throw new Error('Unknown network');
  const path = mediaType === 'tv' ? '/discover/tv' : '/discover/movies';
  const d = await seerr(path, { params: { watchProviders: brand.provider, watchRegion: config.seerr.region, page } });
  const results = d.results.map((r) => ({ ...r, mediaType })).map(mapResult);
  return { page: d.page, totalPages: d.totalPages, results };
}

// Brand list with TMDB logos (fetched once through Seerr's network endpoint).
let logos = null;
export async function networks() {
  if (!logos) {
    logos = {};
    await Promise.all(BRANDS.map(async (b) => {
      const n = await seerr(`/network/${b.network}`).catch(() => null);
      logos[b.id] = n?.logoPath ? tmdbImage(n.logoPath, 'w300') : null;
    }));
  }
  return BRANDS.map((b) => ({ id: b.id, name: b.name, short: b.short, logo: logos[b.id] }));
}

const detailCache = new Map();
export async function details(mediaType, id) {
  const key = `${mediaType}:${id}`;
  const hit = detailCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.v;
  const d = await seerr(`/${mediaType}/${id}`);
  const v = {
    ...mapResult({ ...d, mediaType }),
    runtime: d.runtime,
    genres: (d.genres || []).map((g) => g.name).slice(0, 3),
    seasons: mediaType === 'tv'
      ? (d.seasons || []).filter((s) => s.seasonNumber > 0).map((s) => ({
          number: s.seasonNumber, episodes: s.episodeCount,
          status: STATUS[d.mediaInfo?.seasons?.find((x) => x.seasonNumber === s.seasonNumber)?.status] || 'none',
        }))
      : undefined,
  };
  detailCache.set(key, { t: Date.now(), v });
  return v;
}

// seasons: 'all' or [1, 2]; is4k needs a 4K Radarr/Sonarr configured in Seerr.
async function requestOne({ mediaType, mediaId, seasons, is4k = false }) {
  const body = { mediaType, mediaId: Number(mediaId), is4k: Boolean(is4k) };
  if (mediaType === 'tv') body.seasons = seasons || 'all';
  const r = await seerr('/request', { method: 'POST', body });
  detailCache.delete(`${mediaType}:${mediaId}`);
  return { id: r.id, status: REQUEST_STATUS[r.status] || 'pending' };
}

// Movies are requested in both qualities at once (the 1080p copy for phones, the 4K one for the
// projector), skipping whichever Seerr already has. Fails only if every request fails.
export async function request(opts) {
  if (opts.mediaType !== 'movie') return requestOne(opts);
  const d = await details('movie', opts.mediaId).catch(() => null);
  const wanted = [false, true].filter((is4k) => !d || (is4k ? d.status4k : d.status) === 'none' || (is4k ? d.status4k : d.status) === 'unknown');
  if (!wanted.length) throw new Error('Already requested in 1080p and 4K');
  const results = await Promise.allSettled(wanted.map((is4k) => requestOne({ ...opts, is4k })));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw results[0].reason;
  results.forEach((r, i) => r.status === 'rejected' && console.warn(`[seerr] ${wanted[i] ? '4K' : '1080p'} request:`, r.reason.message));
  return { ...ok[0], qualities: wanted.filter((_, i) => results[i].status === 'fulfilled').map((k) => (k ? '4K' : '1080p')) };
}

export async function requests(take = 8) {
  const d = await seerr('/request', { params: { take, skip: 0, filter: 'all', sort: 'added' } });
  const out = await Promise.all(d.results.map(async (r) => {
    const m = r.media || {};
    const info = await details(m.mediaType || r.type, m.tmdbId).catch(() => null);
    const dl = (m.downloadStatus || [])[0] || (m.downloadStatus4k || [])[0];
    const progress = dl && dl.size ? Math.round((1 - dl.sizeLeft / dl.size) * 100) : null;
    const media = STATUS[m.status];
    let label = media === 'available' ? 'Available'
      : dl ? 'Downloading'
      : REQUEST_STATUS[r.status] === 'pending' ? 'Waiting for approval'
      : REQUEST_STATUS[r.status] === 'declined' ? 'Declined'
      : REQUEST_STATUS[r.status] === 'failed' ? 'Failed'
      : media === 'partial' ? 'Partly available'
      : 'Searching';
    return {
      id: r.id,
      title: info?.title || `TMDB ${m.tmdbId}`,
      year: info?.year,
      mediaType: m.mediaType || r.type,
      poster: info?.poster,
      label,
      progress,
      eta: dl?.estimatedCompletionTime || null,
      requestedBy: r.requestedBy?.displayName,
      createdAt: r.createdAt,
      is4k: r.is4k,
    };
  }));
  return { total: d.pageInfo?.results ?? out.length, results: out };
}

export async function counts() {
  return seerr('/request/count');
}
