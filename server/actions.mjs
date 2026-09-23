// Everything the panel can make happen. The panel never calls arbitrary HA services: each
// action here maps to one allowlisted call, mostly the theater_* scripts in ha/theater.yaml,
// so the same behavior is available to Pico remotes, voice and automations too.

import { config } from './config.mjs';
import * as plex from './plex.mjs';
import { extImage } from './images.mjs';
import * as games from './games.mjs';

const SCENES = ['pre_show', 'movie_time', 'intermission', 'lights_up', 'all_off'];
const script = (ha, name, variables = {}) => ha.callService('script', 'turn_on', { variables }, { target: { entity_id: `script.theater_${name}` } });

export async function runAction(ha, body) {
  const e = config.entities;
  switch (body.action) {
    case 'scene': {
      if (!SCENES.includes(body.name)) throw new Error('Unknown scene');
      return script(ha, body.name);
    }

    case 'play': {
      // With a pre-roll configured, the swell starts on the theater speakers while the lights go
      // down and the film follows a few seconds later. Returns at once so the panel is not held
      // open for the length of the swell.
      if (config.preroll.url && !body.noPreroll) {
        await script(ha, 'preroll', { speaker: e.musicPlayers[0] || e.musicPlayer, url: config.preroll.url });
        setTimeout(() => runAction(ha, { ...body, noPreroll: true }).catch((err) => console.warn('[preroll] film did not start:', err.message)), config.preroll.seconds * 1000);
        return { preroll: config.preroll.seconds };
      }
      // Store the chosen tracks on the Plex part first, then hand over to HA, which wakes the
      // projector, opens Plex on the Apple TV, starts playback and runs Movie time.
      if (body.partId && (body.audioStreamID != null || body.subtitleStreamID != null)) {
        await plex.setStreams(body.partId, body).catch((err) => console.warn('[plex] setStreams', err.message));
      }
      plex.staleMovies(); // watched / in-progress state is about to change
      if (config.playTarget === 'plezy') {
        // Plezy resumes by itself, so Start over clears the saved position first.
        if (!body.offset) await plex.clearProgress(body.ratingKey).catch((err) => console.warn('[plex] start over', err.message));
        const id = `plezy_${await plex.machineId()}_${Number(body.ratingKey)}`;
        return script(ha, 'play_projector', {
          projector: e.projector, apple_tv: e.appleTv, package: config.plezyPackage,
          uri: `plezy://play?content_id=${id}`,
        });
      }
      if (config.playTarget === 'plex') {
        // The official Plex app on the projector: open it over ADB, then play through its Plex client.
        return script(ha, 'play_projector_plex', {
          projector: e.projector, apple_tv: e.appleTv, package: config.projectorPlexPackage,
          plex_player: e.projectorPlexPlayer,
          rating_key: String(body.ratingKey),
          media_type: body.type === 'episode' ? 'episode' : 'movie',
          offset: Math.round((body.offset || 0) / 1000),
        });
      }
      return script(ha, 'play_plex', {
        rating_key: String(body.ratingKey),
        media_type: body.type === 'episode' ? 'episode' : 'movie',
        offset: Math.round((body.offset || 0) / 1000),
        apple_tv: e.appleTv,
        plex_player: e.plexPlayer,
      });
    }

    // Light effects and their speed / intensity helpers (the picker on the Lights card).
    case 'light_effect': {
      if (!e.lights.includes(body.entity_id)) throw new Error('Unknown light');
      const effect = String(body.effect || '').slice(0, 64);
      if (!effect) throw new Error('No effect');
      return ha.callService('light', 'turn_on', { effect }, { target: { entity_id: body.entity_id } });
    }

    case 'light_number': {
      const allowed = [e.accentSpeed, e.accentIntensity].filter(Boolean);
      if (!allowed.includes(body.entity_id)) throw new Error('Unknown helper');
      return ha.callService('input_number', 'set_value', { value: clamp(Number(body.value), 0, 255) }, { target: { entity_id: body.entity_id } });
    }

    case 'transport': {
      const target = { entity_id: e.appleTv };
      const map = { play_pause: 'media_play_pause', play: 'media_play', pause: 'media_pause', stop: 'media_stop', vol_up: 'volume_up', vol_down: 'volume_down' };
      if (map[body.cmd]) return ha.callService('media_player', map[body.cmd], {}, { target });
      if (body.cmd === 'mute') return ha.callService('media_player', 'volume_mute', { is_volume_muted: Boolean(body.muted) }, { target });
      if (body.cmd === 'seek_rel') {
        const s = ha.states[e.appleTv]?.attributes || {};
        const pos = livePosition(s);
        if (pos == null) throw new Error('Position unknown');
        const to = Math.max(0, Math.min((s.media_duration || Infinity) - 1, pos + Number(body.seconds || 0)));
        return ha.callService('media_player', 'media_seek', { seek_position: to }, { target });
      }
      throw new Error('Unknown transport command');
    }

    case 'light': {
      if (!e.lights.includes(body.entity_id)) throw new Error('Unknown light');
      const target = { entity_id: body.entity_id };
      if (body.on === false) return ha.callService('light', 'turn_off', {}, { target });
      const data = {};
      if (body.brightness_pct != null) data.brightness_pct = clamp(body.brightness_pct, 1, 100);
      if (body.rgb_color) data.rgb_color = body.rgb_color.slice(0, 3).map((n) => clamp(n, 0, 255));
      if (body.color_temp_kelvin) data.color_temp_kelvin = clamp(body.color_temp_kelvin, 2000, 6500);
      return ha.callService('light', 'turn_on', data, { target });
    }

    case 'aisle_glow': return script(ha, 'aisle_glow');

    case 'projector': {
      const allowed = { power_on: [], power_off: [], source: ['source'], picture: ['mode'] };
      if (!(body.cmd in allowed)) throw new Error('Unknown projector command');
      const vars = { projector: e.projector, apple_tv: e.appleTv };
      for (const k of allowed[body.cmd]) vars[k] = String(body[k] || '');
      if (body.cmd === 'source' && vars.source === 'Apple TV') games.setActive('appletv');
      return script(ha, `projector_${body.cmd}`, vars);
    }

    case 'picture_next': {
      // Next picture mode; HA's automation applies it to the projector over ADB.
      if (!e.pictureMode) throw new Error('No picture mode entity set');
      return ha.callService('input_select', 'select_next', { cycle: true }, { target: { entity_id: e.pictureMode } });
    }

    case 'projector_app': {
      // Only apps listed in PROJECTOR_APPS; HA wakes the projector first if it is off.
      const app = config.projectorApps.find((a) => a.package === body.package);
      if (!app) throw new Error('Unknown projector app');
      games.setActive(null);
      return script(ha, 'projector_app', { projector: e.projector, apple_tv: e.appleTv, package: app.package });
    }

    case 'music': {
      const player = e.musicPlayers.includes(body.entity_id) ? body.entity_id : e.musicPlayer;
      const target = { entity_id: player };
      const simple = { play_pause: 'media_play_pause', next: 'media_next_track', previous: 'media_previous_track' };
      if (simple[body.cmd]) return ha.callService('media_player', simple[body.cmd], {}, { target });
      if (body.cmd === 'volume') return ha.callService('media_player', 'volume_set', { volume_level: clamp(body.level, 0, 1) }, { target });
      if (body.cmd === 'shuffle') return ha.callService('media_player', 'shuffle_set', { shuffle: Boolean(body.on) }, { target });
      if (body.cmd === 'repeat') return ha.callService('media_player', 'repeat_set', { repeat: ['off', 'all', 'one'].includes(body.mode) ? body.mode : 'off' }, { target });
      if (body.cmd === 'play_media') {
        return ha.callService('music_assistant', 'play_media', {
          media_id: String(body.uri), media_type: body.media_type, enqueue: body.enqueue || 'replace',
        }, { target });
      }
      if (body.cmd === 'transfer') {
        const to = e.musicPlayers.includes(body.to) ? body.to : null;
        if (!to) throw new Error('Unknown player');
        return ha.callService('music_assistant', 'transfer_queue', { source_player: player, auto_play: true }, { target: { entity_id: to } });
      }
      throw new Error('Unknown music command');
    }

    case 'game_source': return games.selectSource(ha, String(body.id));
    case 'game_pc_power': return games.pcPower(ha, body.on !== false);
    case 'game_launch': return games.launchSteamGame(ha, body.appid);

    default: throw new Error('Unknown action');
  }
}

// HA reports media_position as of media_position_updated_at; add the time since then when playing.
export function livePosition(a, state) {
  if (a.media_position == null) return null;
  let pos = a.media_position;
  if ((state ?? 'playing') === 'playing' && a.media_position_updated_at) {
    pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
  }
  return pos;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n)));

// ---------- Music Assistant data, read through HA's music_assistant actions ----------

let maEntry = null;
async function maEntryId(ha) {
  if (maEntry) return maEntry;
  const entries = await ha.request({ type: 'config_entries/get', domain: 'music_assistant' });
  maEntry = entries.find((x) => x.state === 'loaded')?.entry_id || entries[0]?.entry_id;
  if (!maEntry) throw new Error('Music Assistant integration not found in HA');
  return maEntry;
}

function mapMusic(i) {
  return {
    uri: i.uri,
    type: i.media_type,
    name: i.name,
    artist: (i.artists || []).map((a) => a.name).join(', ') || i.owner || undefined,
    album: i.album?.name,
    year: i.year,
    duration: i.duration,
    // MA's image proxy serves originals at size=0; ask for 512 (it accepts 80, 160, 256, 512, 1024).
    image: extImage(typeof i.image === 'string' ? i.image.replace(/([?&]size=)0\b/, '$1512') : i.image?.path),
  };
}

export async function musicLibrary(ha, { type = 'album', order = 'timestamp_added_desc', limit = 24, favorite } = {}) {
  const res = await ha.callService('music_assistant', 'get_library', {
    config_entry_id: await maEntryId(ha), media_type: type, order_by: order, limit: Number(limit),
    ...(favorite ? { favorite: true } : {}),
  }, { returnResponse: true });
  return (res?.items || []).map(mapMusic);
}

export async function musicSearch(ha, query) {
  const res = await ha.callService('music_assistant', 'search', {
    config_entry_id: await maEntryId(ha), name: String(query), limit: 12,
  }, { returnResponse: true });
  const out = {};
  for (const k of ['artists', 'albums', 'tracks', 'playlists', 'radio']) out[k] = (res?.[k] || []).map(mapMusic);
  return out;
}

export async function musicQueue(ha, entityId) {
  const player = config.entities.musicPlayers.includes(entityId) ? entityId : config.entities.musicPlayer;
  const state = ha.states[player]?.state;
  if (!state || state === 'unavailable') return { player, unavailable: true };
  const res = await ha.callService('music_assistant', 'get_queue', {}, { target: { entity_id: player }, returnResponse: true }).catch(() => null);
  const q = res?.[player];
  if (!q) return null;
  const item = (x) => x && ({
    id: x.queue_item_id, name: x.name, duration: x.duration,
    ...(x.media_item ? mapMusic(x.media_item) : {}),
  });
  return {
    player, name: q.display_name || q.name, shuffle: q.shuffle_enabled, repeat: q.repeat_mode,
    elapsed: q.elapsed_time, current: item(q.current_item), next: item(q.next_item),
    // get_queue returns the current and next item only; items is the queue length.
    count: typeof q.items === 'number' ? q.items : (q.items || []).length,
  };
}
