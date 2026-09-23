// Which build is running, and which one is waiting on GHCR. The published image carries its
// BUILD_VERSION in the image config, so the answer needs no registry account and no extra service.

import { config } from './config.mjs';

const IMAGE = process.env.IMAGE_REPO || 'davidcoulson/theater-panel';
const TAG = process.env.IMAGE_TAG || 'latest';
const TTL = 6 * 3600e3;
let cached = { t: 0, latest: null };

const ACCEPT = [
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
].join(', ');

async function ghcr(path, token, accept = ACCEPT) {
  const r = await fetch(`https://ghcr.io/v2/${IMAGE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`ghcr ${r.status} for ${path}`);
  return r.json();
}

// The BUILD_VERSION baked into the published image.
async function latestVersion() {
  const tok = await fetch(`https://ghcr.io/token?scope=repository:${IMAGE}:pull`, { signal: AbortSignal.timeout(12000) })
    .then((r) => r.json()).then((d) => d.token);
  let manifest = await ghcr(`/manifests/${TAG}`, tok);
  if (manifest.manifests) {                      // a multi-arch index: any image will do
    const pick = manifest.manifests.find((m) => m.platform?.architecture === 'amd64') || manifest.manifests[0];
    manifest = await ghcr(`/manifests/${pick.digest}`, tok);
  }
  const cfg = await ghcr(`/blobs/${manifest.config.digest}`, tok, 'application/json');
  const env = cfg?.config?.Env || [];
  return (env.find((e) => e.startsWith('BUILD_VERSION=')) || '').split('=')[1] || null;
}

export async function versions() {
  const installed = config.build.version;
  if (Date.now() - cached.t > TTL) {
    try { cached = { t: Date.now(), latest: await latestVersion() }; }
    catch (e) { console.warn('[version] could not read GHCR:', e.message); cached = { t: Date.now(), latest: cached.latest }; }
  }
  const latest = cached.latest || installed;
  return {
    installed,
    latest,
    // "dev" and local builds never count as out of date.
    update: Boolean(cached.latest) && installed !== latest && !/local|dev/.test(installed),
    built: config.build.time || null,
    image: `ghcr.io/${IMAGE}:${TAG}`,
  };
}
