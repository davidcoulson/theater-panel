// All settings come from the environment (see .env.example). Entity ids live here, not in the
// HA package, so the HA scripts stay generic and this file is the single place to rename things.

const env = process.env;
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

export const config = {
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
  },
  // The Plex client's name as Plex reports it (Settings > Plex Web > Devices), used to pick the
  // theater's session out of /status/sessions. Empty = the first playing session.
  plexPlayerName: env.PLEX_PLAYER_NAME || '',
  // Steam library on the Games screen (Steam Web API key and 64-bit SteamID).
  steam: { apiKey: env.STEAM_API_KEY || '', id: env.STEAM_ID || '' },
  // Poster labels. Network is off by default because Plex posters decorated by Kometa already
  // carry the network; the detail pane always shows it.
  ui: {
    qualityBadges: env.SHOW_QUALITY_BADGES !== 'false',
    networkBadges: env.SHOW_NETWORK_BADGES === 'true',
  },
};

// Every entity the panel shows; the HA subscription is limited to these.
if (!config.entities.musicPlayers.length) config.entities.musicPlayers = [config.entities.musicPlayer];

export function watchedEntities() {
  const e = config.entities;
  return [
    e.appleTv, e.appleTvRemote, e.plexPlayer, ...e.musicPlayers, e.projector,
    ...e.lights, e.temperature, e.occupancy, e.tautulli,
    'input_select.theater_scene',
  ].filter(Boolean);
}
