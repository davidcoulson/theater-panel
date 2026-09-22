// Settings come from the environment (see .env.example), overlaid with whatever was saved on the
// admin page (settings.json next to the image cache, so it lives in the container's /data volume).
// Entity ids live here, not in the HA package, so the HA scripts stay generic and this file is
// the single place to rename things.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

export const SETTINGS_FILE = process.env.SETTINGS_FILE || join(dirname(process.env.CACHE_DIR || './cache'), 'settings.json');

// { vars: { HA_URL: ..., ... }, games: {...} }. Saved vars win over the environment.
let saved = { vars: {}, games: null };
try { saved = { vars: {}, games: null, ...JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) }; }
catch (e) { if (e.code !== 'ENOENT') console.warn(`[settings] ${SETTINGS_FILE}: ${e.message}`); }

export const settings = () => saved;
export const effectiveVars = () => ({ ...process.env, ...Object.fromEntries(Object.entries(saved.vars).filter(([, v]) => v !== '' && v != null)) });

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
  panelKey: env.PANEL_KEY || '',
  cacheDir: env.CACHE_DIR || './cache',
  imageCacheMb: Number(env.IMAGE_CACHE_MB || 512),

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
    // Picture mode helper (input_select) the projector card shows and cycles.
    pictureMode: env.ENTITY_PICTURE_MODE || 'input_select.projector_picture_mode',
  },
  // Where "Play on projector" plays: the Apple TV's Plex app, or the Plex client on the projector
  // itself (Plezy, opened over ADB with a plezy://play link).
  playTarget: env.PLAY_TARGET === 'projector' ? 'projector' : 'appletv',
  projectorPlexPackage: env.PROJECTOR_PLEX_PACKAGE || 'com.edde746.plezy',
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
  // Steam library on the Games screen (Steam Web API key and 64-bit SteamID).
  steam: { apiKey: env.STEAM_API_KEY || '', id: env.STEAM_ID || '' },
  // Which build this is: stamped into the image by `npm run push`.
  build: { version: env.BUILD_VERSION || 'dev', time: env.BUILD_TIME || '' },
  // Favourite light effects shown first in the Moods sheet (up to 8, in order).
  effectFavourites: list(env.ACCENT_FAVOURITES, []).slice(0, 8),
  // Poster labels. Network is off by default because Plex posters decorated by Kometa already
  // carry the network; the detail pane always shows it.
  ui: {
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
    e.appleTv, e.appleTvRemote, e.plexPlayer, ...e.musicPlayers, e.projector,
    ...e.lights, e.temperature, e.occupancy, e.tautulli, e.pictureMode, e.accentSpeed, e.accentIntensity,
    'input_select.theater_scene',
  ].filter(Boolean);
}
