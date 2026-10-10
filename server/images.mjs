// Image proxy with a disk cache. Posters and backdrops are fetched once at the size the panel
// draws them and then served from disk, so scrolling the poster grid never touches Plex, TMDB
// or Home Assistant. Upstream tokens stay on the server.
//
// Three sources:
//   /img/plex/<w>x<h>?p=<plex image path>   resized by Plex's own transcoder
//   /img/tmdb/<size>/<file>                  TMDB CDN (posters for titles not in Plex)
//   /img/steam/<appid>/<file>                Steam CDN (library capsules for the Games screen)
//   /img/ext?u=<url>&s=<sig>                 any other URL the server itself handed out
//                                            (Music Assistant art, HA entity pictures);
//                                            signed so the proxy cannot be used to reach
//                                            arbitrary hosts on the LAN.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from './config.mjs';

// Stable across restarts (so image links in an open page keep working), derived from the
// configured secrets unless IMAGE_SECRET is set.
// IMAGE_SECRET is generated on first run (see config.mjs) so /img/ext links can't be forged.
const secret = createHash('sha256').update(process.env.IMAGE_SECRET || config.imageSecret || randomBytes(32).toString('hex')).digest();
const dir = join(config.cacheDir, 'img');
let writesSincePrune = 0;
let writeSeq = 0;

export async function initImageCache() {
  await mkdir(dir, { recursive: true });
  prune().catch(() => {});
}

export function plexImage(path, w, h) {
  if (!path) return null;
  return `/img/plex/${w}x${h}?p=${encodeURIComponent(path)}`;
}
export function tmdbImage(file, size = 'w342') {
  return file ? `/img/tmdb/${size}${file}` : null;
}
export function extImage(url) {
  if (!url) return null;
  return `/img/ext?u=${encodeURIComponent(url)}&s=${sign(url)}`;
}
const sign = (url) => createHmac('sha256', secret).update(url).digest('hex').slice(0, 24);

// Returns { upstreamUrl, headers } for a request path, or null when the request is not allowed.
function resolve(url) {
  const u = new URL(url, 'http://x');
  let m;
  if ((m = u.pathname.match(/^\/img\/plex\/(\d{2,4})x(\d{2,4})$/))) {
    const p = u.searchParams.get('p');
    // Only Plex's own media paths: "//host/x" would make Plex fetch somewhere else entirely.
    if (!p || !/^\/(library|photo|metadata)\/[^/]/.test(p) || !config.plex.url) return null;
    const q = new URLSearchParams({
      url: p, width: m[1], height: m[2], minSize: '1', upscale: '1', format: 'jpeg', quality: '80',
      'X-Plex-Token': config.plex.token,
    });
    return { upstream: `${config.plex.url}/photo/:/transcode?${q}` };
  }
  if ((m = u.pathname.match(/^\/img\/tmdb\/(w\d{2,4}|original)(\/[A-Za-z0-9_-]+\.(?:jpg|png))$/))) {
    return { upstream: `https://image.tmdb.org/t/p/${m[1]}${m[2]}` };
  }
  if ((m = u.pathname.match(/^\/img\/steam\/(\d{1,9})\/(library_600x900\.jpg|header\.jpg|library_hero\.jpg|logo\.png)$/))) {
    return { upstream: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${m[1]}/${m[2]}` };
  }
  if (u.pathname === '/img/ext') {
    const target = u.searchParams.get('u');
    // Only URLs this server signed itself: the proxy cannot be pointed at an arbitrary host.
    const given = Buffer.from(u.searchParams.get('s') || ''); const want = Buffer.from(target ? sign(target) : '');
    if (!target || given.length !== want.length || !timingSafeEqual(given, want)) return null;
    return { upstream: target, checked: true };
  }
  return null;
}

// Concurrent misses for the same image share one upstream fetch.
const inflight = new Map();   // cache key -> Promise<Buffer>
const MAX_BYTES = 15 * 1024 * 1024;

export async function serveImage(req, res) {
  const r = resolve(req.url);
  if (!r) { res.writeHead(404).end(); return; }
  const key = createHash('sha1').update(r.upstream.replace(/X-Plex-Token=[^&]+/, '')).digest('hex');
  const file = join(dir, key);
  try {
    const body = await readFile(file);
    if (sniff(body)) return send(res, body);
    unlink(file).catch(() => {});   // something that is not an image got cached once: drop it
  } catch {}
  let job = inflight.get(key);
  if (!job) {
    job = (r.checked ? fetchChecked(r.upstream) : fetchImage(r.upstream)).finally(() => inflight.delete(key));
    inflight.set(key, job);
    job.then((body) => store(file, body)).catch(() => {});
  }
  try {
    send(res, await job);
  } catch (e) {
    if (!res.headersSent) res.writeHead(e.status || 502).end();
  }
}

// Where a signed /img/ext URL may lead. A signature only proves this server handed the URL out; the
// URL itself came from Home Assistant or Music Assistant. So: http(s) only, Home Assistant's own
// host (where Music Assistant's image proxy lives too) may be on the LAN, and anything else must
// resolve to a public address - checked on every redirect, so a public host can't bounce the
// proxy onto the LAN, a router or a cloud metadata address.
const isPrivate = (ip) => {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
};
async function allowed(url) {
  let u; try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const haHost = (() => { try { return new URL(config.ha.url).hostname; } catch { return null; } })();
  if (haHost && host === haHost) return true;
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  return addrs.length > 0 && !addrs.some(isPrivate);
}
async function fetchChecked(url) {
  for (let hop = 0; hop < 4; hop++) {
    if (!(await allowed(url))) throw Object.assign(new Error('destination not allowed'), { status: 403 });
    const up = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const next = up.status >= 300 && up.status < 400 && up.headers.get('location');
    if (!next) return readImage(up);
    url = new URL(next, url).href;
  }
  throw Object.assign(new Error('too many redirects'), { status: 502 });
}

// The upstream image, refused unless it really is an image and of a sane size: an error page
// answered with 200 must never be cached and served as a poster for a year.
async function fetchImage(url) {
  return readImage(await fetch(url, { signal: AbortSignal.timeout(15000) }));
}
async function readImage(up) {
  if (!up.ok) throw Object.assign(new Error(`upstream ${up.status}`), { status: up.status === 404 ? 404 : 502 });
  if (Number(up.headers.get('content-length')) > MAX_BYTES) throw Object.assign(new Error('too large'), { status: 502 });
  const body = Buffer.from(await up.arrayBuffer());
  if (body.length > MAX_BYTES || !sniff(body)) throw Object.assign(new Error('not an image'), { status: 502 });
  return body;
}

// Written under a temporary name and renamed into place, so a request arriving mid-write reads
// either nothing (and fetches for itself) or the whole file, never a truncated poster that the
// browser would then keep for a year.
async function store(file, body) {
  const tmp = `${file}.${process.pid}.${++writeSeq}.tmp`;
  try {
    await writeFile(tmp, body);
    await rename(tmp, file);
  } catch (e) {
    unlink(tmp).catch(() => {});
    return console.warn('[img] cache write failed:', e.message);
  }
  if (++writesSincePrune > 200) { writesSincePrune = 0; prune().catch(() => {}); }
}

function send(res, body) {
  const type = sniff(body);
  res.writeHead(200, {
    'content-type': type,
    // An SVG is a document: it may draw, never run anything, even if opened on its own.
    ...(type === 'image/svg+xml' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    'content-length': body.length,
    // Posters, backdrops and logos are effectively permanent, and each URL carries its own
    // identifiers, so the panel's browser can keep them for a year and never re-ask.
    'cache-control': 'public, max-age=31536000, immutable',
  });
  res.end(body);
}
// The image type from its first bytes, or null when it is not an image at all.
function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (b.toString('latin1', 4, 12) === 'ftypavif') return 'image/avif';
  // SVG (station and provider logos): text that opens with <svg, or an XML prolog before it.
  const head = b.toString('utf8', 0, 1024).replace(/^\uFEFF/, '').trimStart();
  if (/^<svg[\s>]/i.test(head) || (/^<\?xml/i.test(head) && /<svg[\s>]/i.test(head))) return 'image/svg+xml';
  return null;
}

// Keep the cache under IMAGE_CACHE_MB by deleting the least recently written files.
async function prune() {
  const names = await readdir(dir);
  const files = await Promise.all(names.map(async (n) => {
    const s = await stat(join(dir, n)); return { n, size: s.size, t: s.mtimeMs };
  }));
  let total = files.reduce((a, f) => a + f.size, 0);
  const cap = config.imageCacheMb * 1024 * 1024;
  if (total <= cap) return;
  files.sort((a, b) => a.t - b.t);
  for (const f of files) {
    if (total <= cap * 0.9) break;
    await unlink(join(dir, f.n)).catch(() => {});
    total -= f.size;
  }
}
