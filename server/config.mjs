// Settings come from the environment (see .env.example), overlaid with whatever was saved on the
// admin page (settings.json next to the image cache, so it lives in the container's /data volume).
// Entity ids live here, not in the HA package, so the HA scripts stay generic and this file is
// the single place to rename things.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

export const SETTINGS_FILE = process.env.SETTINGS_FILE || join(dirname(process.env.CACHE_DIR || './cache'), 'settings.json');

// { vars: { HA_URL: ..., ... }, games: {...} }. Saved vars win over the environment.
let saved = { vars: {}, games: null };
try { saved = { vars: {}, games: null, ...JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) }; }
catch (e) { if (e.code !== 'ENOENT') console.warn(`[settings] ${SETTINGS_FILE}: ${e.message}`); }

export const settings = () => saved;

// Secrets the panel generates for itself when none are configured, kept with the settings so they
// survive restarts. Without a panel key anyone who can reach the panel can drive the room, so one
// is made on first run unless ALLOW_OPEN=1 says the network is trusted.
function ensureSecrets(vars) {
  let changed = false;
  const need = (key, make) => {
    if (process.env[key] || vars[key]) return;
    vars[key] = make();
    changed = true;
  };
  need('IMAGE_SECRET', () => randomBytes(24).toString('hex'));
  if (process.env.ALLOW_OPEN !== '1') need('PANEL_KEY', () => randomBytes(12).toString('base64url'));
  if (changed) {
    try {
      mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
      writeFileSync(SETTINGS_FILE, JSON.stringify({ ...saved, vars }, null, 2), { mode: 0o600 });
    } catch (e) { console.warn(`[settings] could not save generated secrets: ${e.message}`); }
  }
  return vars;
}
export const effectiveVars = () => ({ ...process.env, ...Object.fromEntries(Object.entries(ensureSecrets(saved.vars)).filter(([, v]) => v !== '' && v != null)) });

// Replace the saved settings and apply them to the live config object (every module reads
// config at call time, so nothing needs a restart except the HA connection, which the caller
// reconnects).
export function saveSettings(next) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, SETTINGS_FILE);
  saved = next;
  const fresh = build(effectiveVars());
  for (const k of Object.keys(fresh)) config[k] = fresh[k];
}

function build(env) {
  const c = {
  port: Number(env.PORT || 8787),
  // Optional shared key. When set, a client must present it once (?key=...) and gets a cookie.
  // ALLOW_OPEN=1 means "this network is trusted": no key is generated, and a key generated earlier
  // stops being enforced (it stays in settings, so turning this off again restores it).
  panelKey: process.env.ALLOW_OPEN === '1' ? '' : env.PANEL_KEY || '',
  // Addresses that skip the panel key (the wall panel, the house LAN). Anything else still needs it.
  trustedNetworks: list(env.TRUST_NETWORKS, []),
  // Proxies whose X-Forwarded-For may be believed. Docker's own networks by default; add the
  // address of Traefik or the k3s ingress if the panel is reached through one, or a client on a
  // trusted network will look like the proxy instead of itself.
  trustedProxies: list(env.TRUSTED_PROXIES, ['127.0.0.1', '::1', '172.16.0.0/12']),
  imageSecret: env.IMAGE_SECRET || '',
  cacheDir: env.CACHE_DIR || './cache',
  imageCacheMb: Number(env.IMAGE_CACHE_MB || 2048),   // posters are small and never change; keep plenty

  ha: {
    url: (env.HA_URL || '').replace(/\/$/, ''),
    token: env.HA_TOKEN || '',
  },
  plex: {
    url: (env.PLEX_URL || '').replace(/\/$/, ''),
    token: env.PLEX_TOKEN || '',
    // Library section titles shown as tabs, in order. Empty = every movie and show library.
    libraries: list(env.PLEX_LIBRARIES, []),
  },
  seerr: {
    url: (env.SEERR_URL || '').replace(/\/$/, ''),
    apiKey: env.SEERR_API_KEY || '',
    // Optional Seerr user id so requests show as made by that user instead of the key's owner.
    userId: env.SEERR_USER_ID || '',
    // Region for "streaming on" lookups (TMDB watch providers).
    region: env.SEERR_REGION || 'US',
  },

  entities: {
    appleTv: env.ENTITY_APPLE_TV || 'media_player.home_theater',
    appleTvRemote: env.ENTITY_APPLE_TV_REMOTE || 'remote.home_theater',
    // The Plex client entity HA creates for the Apple TV once "Advertise as player" is on.
    plexPlayer: env.ENTITY_PLEX_PLAYER || '',
    // The projector's own Plex client, as HA's Plex integration names it.
    projectorPlexPlayer: env.ENTITY_PROJECTOR_PLEX_PLAYER || '',
    musicPlayer: env.ENTITY_MUSIC_PLAYER || 'media_player.home_theater_2',
    // Music Assistant players offered under "Play on"; the first is the theater's own.
    musicPlayers: list(env.ENTITY_MUSIC_PLAYERS, []),
    // Android Debug Bridge media_player for the projector. Empty until ADB is tested.
    projector: env.ENTITY_PROJECTOR || '',
    lights: list(env.ENTITY_LIGHTS, [
      'light.media_room_downlights',
      'light.home_theater_accent_lights',
      'light.home_theater_wled',
    ]),
    temperature: env.ENTITY_TEMPERATURE || 'sensor.media_room_temperature',
    occupancy: env.ENTITY_OCCUPANCY || 'binary_sensor.media_room_occupancy',
    tautulli: env.ENTITY_TAUTULLI || 'sensor.tautulli_watching',
    // Accent-light effect speed and intensity helpers (input_number), shown in the effect picker.
    accentSpeed: env.ENTITY_ACCENT_SPEED || 'input_number.home_theater_accent_speed',
    accentIntensity: env.ENTITY_ACCENT_INTENSITY || 'input_number.home_theater_accent_intensity',
    // "The dog is at the door": UniFi's barking and animal detections on the deck camera, and
    // the camera itself for the snapshot. Empty turns the alert off.
    dogSensors: list(env.ENTITY_DOG_SENSORS, []),
    dogCamera: env.ENTITY_DOG_CAMERA || '',
    dogName: env.DOG_NAME || 'The dog',
    // Picture mode helper (input_select) the projector card shows and cycles.
    pictureMode: env.ENTITY_PICTURE_MODE || 'input_select.projector_picture_mode',
  },
  // Where Play sends a title:
  //   appletv  - the Apple TV's Plex app (HA's Plex client for it)
  //   plezy    - Plezy on the projector, opened with a plezy://play link over ADB
  //   plex     - the official Plex app on the projector, driven as a Plex client
  // "projector" is the old name for plezy.
  playTarget: ['plezy', 'plex', 'projector'].includes(env.PLAY_TARGET) ? (env.PLAY_TARGET === 'projector' ? 'plezy' : env.PLAY_TARGET) : 'appletv',
  plezyPackage: env.PLEZY_PACKAGE || 'com.edde746.plezy',
  projectorPlexPackage: env.PROJECTOR_PLEX_PACKAGE || 'com.plexapp.android',
  // The Plex client's name as Plex reports it (Settings > Plex Web > Devices), used to pick the
  // theater's session out of /status/sessions. Empty = the first playing session.
  plexPlayerName: env.PLEX_PLAYER_NAME || '',
  // Apps the Projector card can open on the projector itself (Android, over ADB), as
  // "Name=package" or "Name=package=icon" (e.g. YouTube=org.smarttube.stable=mdi:youtube). The projector is woken first if it is off.
  projectorApps: list(env.PROJECTOR_APPS, ['Plex=com.plexapp.android']).map((pair) => {
    const [name, pkg, icon] = pair.split('=').map((x) => x.trim());
    if (!pkg || !/^[\w.]+$/.test(pkg)) return null;
    return { name, package: pkg, ...(icon && /^[a-z0-9-]+:[a-z0-9-]+$|^[a-z]+$/.test(icon) ? { icon } : {}) };
  }).filter(Boolean),
  // Pre-roll: a deep swell on the theater speakers while the lights go down, before the film
  // starts. The URL has to be one the speaker itself can fetch (the panel serves the sound at
  // /assets/preroll.mp3, which needs no key); blank turns the whole thing off.
  preroll: {
    url: env.PREROLL_URL || '',
    seconds: Math.max(3, Math.min(60, Number(env.PREROLL_SECONDS || 16))),
    // A swell before a film is an event; before the fourth episode of a sitcom it is a delay.
    // Movies only by default; the Play button offers it either way when it is configured.
    moviesOnly: env.PREROLL_MOVIES_ONLY !== 'false',
  },
  // Whose taste drives "You'll love this" and the Mystery box: Plex account names (or ids) from
  // the server's own history. Empty means the whole house.
  historyAccounts: list(env.HISTORY_ACCOUNTS, []),
  // Steam library on the Games screen (Steam Web API key and 64-bit SteamID).
  steam: { apiKey: env.STEAM_API_KEY || '', id: env.STEAM_ID || '' },
  // How far back the "Now in Plex" chip looks for requests that arrived.
  arrivalHours: Math.min(Number(env.ARRIVAL_HOURS) || 48, 24 * 14),
  // Minutes without a touch before the panel drifts to the Now Showing screen (0 = never).
  idleMinutes: Number(env.IDLE_MINUTES ?? 8),
  // Which build this is: stamped into the image by `npm run push`.
  build: { version: env.BUILD_VERSION || 'dev', time: env.BUILD_TIME || '' },
  // Favourite light effects shown first in the Moods sheet (up to 8, in order).
  effectFavourites: list(env.ACCENT_FAVOURITES, []).slice(0, 8),
  // Poster labels. Network is off by default because Plex posters decorated by Kometa already
  // carry the network; the detail pane always shows it.
  ui: {
    // 'classic' is the room as built (chocolate, copper); 'sofa' re-skins the dark surfaces in the
    // couch's slate tweed. The panel can still try one with #/lobby?theme=sofa.
    theme: env.THEME === 'sofa' ? 'sofa' : 'classic',
    // Holiday accent on top of the theme: 'auto' follows the calendar (see accents.mjs).
    accent: env.ACCENT || 'auto',
    // 0..100: how much weather the accent puts over the lobby (25 is the original amount).
    accentIntensity: Math.max(0, Math.min(100, Number(env.ACCENT_INTENSITY ?? 50) || 0)),
    birthdays: env.BIRTHDAYS || '',
    qualityBadges: env.SHOW_QUALITY_BADGES !== 'false',
    networkBadges: env.SHOW_NETWORK_BADGES === 'true',
    // Plex sessions are only the theater's own when the player name is set.
    theaterSessions: Boolean(env.PLEX_PLAYER_NAME),
  },
  // Extra origins allowed to embed the panel (the HA dashboard), space- or comma-separated.
  frameAncestors: (env.FRAME_ANCESTORS || '').split(/[\s,]+/).filter((o) => /^https?:\/\/[\w.-]+(:\d+)?$/.test(o)),
  // The admin page's password; only from the environment, so the page can't lock itself open.
  adminPassword: process.env.ADMIN_PASSWORD || '',
  };
  if (!c.entities.musicPlayers.length) c.entities.musicPlayers = [c.entities.musicPlayer];
  return c;
}

export const config = build(effectiveVars());

export function watchedEntities() {
  const e = config.entities;
  return [
    e.appleTv, e.appleTvRemote, e.plexPlayer, e.projectorPlexPlayer, ...e.musicPlayers, e.projector,
    ...e.lights, e.temperature, e.occupancy, e.tautulli, e.pictureMode, e.accentSpeed, e.accentIntensity,
    ...e.dogSensors,
    'input_select.theater_scene',
  ].filter(Boolean);
}
