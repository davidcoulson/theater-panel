// Games: pick a console or the gaming PC, show the PC's stats, and browse / launch the Steam
// library. Sources are described in config/games.json (see config/games.example.json):
//
//   via "switcher"  -> the projector goes to the switcher's HDMI input, then Home Assistant's
//                      select for the HDMI switcher (the orei_ukm integration) picks `option`.
//   via "projector" -> the projector goes straight to that source's input (the Windows VM).
//
// Everything goes through Home Assistant; the panel never talks to the hardware itself.
// Either kind may also run an HA script (wake a console, start Steam Big Picture...).

import { readFile } from 'node:fs/promises';
import { config, settings } from './config.mjs';

const file = process.env.GAMES_CONFIG || './config/games.json';
let active = null;          // id of the last projector-input source picked from the panel

// The Apple TV on HDMI 1 used to be built into the Projector card; older configs get it as an
// ordinary source (first, projector card only) so it can be edited like the others.
const APPLE_TV = { id: 'appletv', name: 'Apple TV', icon: 'tv', via: 'projector', projectorInput: 'HDMI 1', games: false };
function withAppleTv(g) {
  if (!g || g.sources?.some((s) => s.via === 'projector' && s.projectorInput === 'HDMI 1')) return g;
  const direct = (g.sources || []).filter((s) => s.via !== 'switcher');
  const switched = (g.sources || []).filter((s) => s.via === 'switcher');
  return { ...g, sources: [APPLE_TV, ...direct, ...switched] };
}

async function readGamesFile() {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[games] ${file}: ${e.message}`);
    return null;
  }
}

export async function loadGamesFile() { return withAppleTv(await readGamesFile()); }

// Games saved on the admin page win over the games.json file. Ones saved since every source
// became editable (v 2) are used as they are.
export async function loadGames() {
  const saved = settings().games;
  if (saved) return saved.v >= 2 ? saved : withAppleTv(saved);
  return loadGamesFile();
}

// A switcher source names its input by number (1-4); the option name is whatever the switcher's
// select calls that input in HA right now, so renaming it there needs no change here. Older
// configs name the option directly.
function switcherOption(ha, g, src) {
  if (src.input) return ha.states[g.switcher?.entity]?.attributes?.options?.[src.input - 1] || null;
  return src.option || null;
}

// Entities the Games screen shows live: the switcher's select, PC power and sensors.
export async function gameEntities() {
  const g = await loadGames();
  return [g?.switcher?.entity, g?.pc?.power, ...(g?.pc?.sensors || []).map((s) => s.entity), ...statEntities(g)].filter(Boolean);
}

// The Stats page's sensors: one entity per role, plus an optional list of per-core load sensors.
// Anything left out simply doesn't appear on the page.
export const STAT_ROLES = ['fps', 'fpsLow', 'game', 'gpuLoad', 'gpuTemp', 'gpuClock', 'gpuPower', 'gpuFan',
  'cpuLoad', 'cpuTemp', 'cpuClock', 'ramUsed', 'ramTotal', 'vramUsed', 'vramTotal', 'netDown', 'netUp', 'uptime'];
function statEntities(g) {
  const st = g?.pc?.stats || {};
  return [...STAT_ROLES.map((k) => st[k]), ...(st.cores || [])].filter((v) => typeof v === 'string');
}

export async function gamesState() {
  const g = await loadGames();
  if (!g) return { configured: false };
  return {
    configured: true,
    active,
    // The panel reads the switcher's live input from this HA entity's state.
    switcher: g.switcher?.entity ? { entity: g.switcher.entity } : null,
    // games: false keeps a source (the Apple TV) off the Games screen; it stays on the projector card.
    sources: (g.sources || []).map(({ id, name, icon, via, option, input, games }) => ({ id, name, icon, via, option, input, games: games !== false })),
    pc: g.pc ? {
      name: g.pc.name || 'Gaming PC', power: g.pc.power || null, sensors: g.pc.sensors || [],
      canLaunch: Boolean(g.pc.launchScript),
      stats: g.pc.stats || null,
    } : null,
    steam: Boolean(config.steam.apiKey && config.steam.id),
  };
}

// The Projector card's Apple TV button goes through the projector action, not a game source.
export const setActive = (id) => { active = id; };

export async function selectSource(ha, id) {
  const g = await loadGames();
  const src = g?.sources?.find((s) => s.id === id);
  if (!src) throw new Error('Unknown game source');
  if (src.via === 'switcher') {
    const option = switcherOption(ha, g, src);
    if (!g.switcher?.entity || !option) throw new Error(`Set the HDMI switcher and ${src.name}'s input on the settings page`);
    // Switch first: if the console is off the switch refuses, and the projector stays put.
    await ha.callService('select', 'select_option', { option }, { target: { entity_id: g.switcher.entity } });
  }
  const input = src.via === 'switcher' ? g.switcher.projectorInput : src.projectorInput;
  if (input) {
    await ha.callService('script', 'turn_on', { variables: { source: input, projector: config.entities.projector, apple_tv: config.entities.appleTv } },
      { target: { entity_id: 'script.theater_projector_source' } });
  }
  if (src.haScript) await ha.callService('script', 'turn_on', {}, { target: { entity_id: src.haScript } });
  active = id;
  return { active };
}

export async function pcPower(ha, on) {
  const g = await loadGames();
  if (!g?.pc?.power) throw new Error('No PC power entity set in games.json');
  return ha.callService('homeassistant', on ? 'turn_on' : 'turn_off', {}, { target: { entity_id: g.pc.power } });
}

export async function launchSteamGame(ha, appid) {
  const g = await loadGames();
  if (!g?.pc?.launchScript) throw new Error('No launch script set in games.json (pc.launchScript)');
  return ha.callService('script', 'turn_on', { variables: { appid: String(Number(appid)) } }, { target: { entity_id: g.pc.launchScript } });
}

// Steam library via the Steam Web API, most recently played first. Cached for 30 minutes.
let steamCache = null;
export async function steamLibrary() {
  if (!config.steam.apiKey || !config.steam.id) return { configured: false, games: [] };
  if (steamCache && Date.now() - steamCache.t < 30 * 60 * 1000) return steamCache.v;
  const q = new URLSearchParams({ key: config.steam.apiKey, steamid: config.steam.id, include_appinfo: '1', include_played_free_games: '1', format: 'json' });
  const r = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${q}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Steam ${r.status}`);
  const games = ((await r.json()).response?.games || [])
    .sort((a, b) => (b.rtime_last_played || 0) - (a.rtime_last_played || 0) || (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .map((x) => ({
      appid: x.appid, name: x.name,
      hours: Math.round((x.playtime_forever || 0) / 60),
      lastPlayed: x.rtime_last_played ? new Date(x.rtime_last_played * 1000).toISOString() : null,
      poster: `/img/steam/${x.appid}/library_600x900.jpg`,
      header: `/img/steam/${x.appid}/header.jpg`,
    }));
  steamCache = { t: Date.now(), v: { configured: true, games } };
  return steamCache.v;
}
