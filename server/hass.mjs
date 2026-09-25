// The panel as a Home Assistant device. Through esphome-device the panel speaks the ESPHome
// native API, so HA's own ESPHome integration adds it like a board: the look (theme, accent,
// weather), cinema mode and pre-roll as switches, the sleep timer and the scenes as controls,
// what is playing as sensors, the build as an update entity, and play/navigate/voice as actions
// (esphome.theater_panel_play and friends), which retire the rest_commands in ha/theater.yaml.
//
// Everything here maps onto what the panel already does over HTTP; nothing decides anything new.

import { Device, macFromName } from 'esphome-device';
import { config } from './config.mjs';
import * as accents from './accents.mjs';
import * as sleep from './sleep.mjs';
import * as taste from './taste.mjs';
import { versions } from './version.mjs';

let ctx = null;          // { ha, broadcast, run, save, applySettings, panels }
let dev = null;
let ent = {};
let running = null;      // the options the device was started with
let last = { sessions: [], streams: [] };

const SLEEP_OPTIONS = ['Off', 'After this film', '30 minutes', '60 minutes', '90 minutes', '120 minutes'];
const SCENES = [['pre_show', 'Pre-show', 'mdi:curtains'], ['movie_time', 'Movie time', 'mdi:movie-open'], ['intermission', 'Intermission', 'mdi:popcorn'], ['lights_up', 'Lights up', 'mdi:lightbulb-on'], ['all_off', 'All off', 'mdi:power']];

const accentNow = () => accents.resolve(config.ui.accent, accents.parseBirthdays(config.ui.birthdays));
const accentName = (id) => accents.ACCENTS?.find?.((a) => a.id === id)?.name || id;
const settingsOf = () => ({ enabled: config.hass.enabled, port: config.hass.port, name: config.hass.name, noiseKey: config.hass.noiseKey });

export function init(context) { ctx = context; }

// Start (or restart after a settings change) the device. Safe to call at any time.
export async function apply() {
  const want = settingsOf();
  if (dev && JSON.stringify(want) === JSON.stringify(running)) { refresh(); return; }
  await stop();
  if (!want.enabled) return;
  try {
    dev = build(want);
    await dev.start();
    running = want;
    refresh();
  } catch (e) {
    console.warn('[hass] could not start the ESPHome device:', e.message);
    dev = null;
  }
}

export async function stop() {
  if (!dev) return;
  const d = dev; dev = null; ent = {}; running = null;
  await d.stop().catch(() => {});
}

function build(opts) {
  const d = new Device({
    name: opts.name,
    friendlyName: config.hass.friendlyName,
    mac: macFromName(`theater-panel:${opts.name}`),
    port: opts.port,
    noiseKey: opts.noiseKey || undefined,
    project: { name: 'davidcoulson.theater-panel', version: config.build.version },
    model: 'Theater panel', manufacturer: 'davidcoulson',
    esphomeVersion: config.hass.esphomeVersion,
    area: config.hass.area,
    mdns: config.hass.mdns,
    log: { info: (m) => console.log(m), warn: (m) => console.warn(m), debug: () => {} },
  });
  const look = (key, value) => ctx.save({ values: { [key]: String(value) } }).then(() => ctx.applySettings());

  ent = {
    theme: d.select({ name: 'Theme', options: ['classic', 'sofa'], icon: 'mdi:palette', category: 'config' }, (v) => look('THEME', v)),
    accent: d.select({ name: 'Holiday accent', options: ['auto', 'none', ...accents.IDS], icon: 'mdi:party-popper', category: 'config' }, (v) => look('ACCENT', v)),
    weather: d.number({ name: 'Accent weather', min: 0, max: 100, step: 5, unit: '%', mode: 'slider', icon: 'mdi:weather-snowy', category: 'config' }, (v) => look('ACCENT_INTENSITY', Math.round(v))),
    cinema: d.switch({ name: 'Cinema mode', icon: 'mdi:theater', category: 'config' }, (on) => look('CINEMA_MODE', on ? 'true' : 'false')),
    preroll: d.switch({ name: 'Pre-roll', icon: 'mdi:volume-high', category: 'config' }, (on) => look('PREROLL_ENABLED', on ? 'true' : 'false')),
    sleep: d.select({ name: 'Sleep timer', options: SLEEP_OPTIONS, icon: 'mdi:sleep' }, (v) => {
      if (v === 'Off') sleep.set({ mode: null });
      else if (v === 'After this film') sleep.set({ mode: 'end' });
      else sleep.set({ mode: 'timer', minutes: parseInt(v, 10) });
      return sleepOption();
    }),
    mystery: d.button({ name: 'Mystery box', icon: 'mdi:gift' }, async () => {
      const pick = await taste.mystery();
      ctx.broadcast('mystery', pick);
      ctx.broadcast('navigate', { route: '#/lobby' });
    }),
    surprise: d.button({ name: 'Surprise me', icon: 'mdi:shuffle-variant' }, async () => {
      const pick = await taste.mystery();
      await ctx.run({ action: 'play', ratingKey: pick.item.id, type: pick.item.type });
    }),
    nowPlaying: d.textSensor({ name: 'Now playing', icon: 'mdi:movie-open-play' }),
    tonight: d.textSensor({ name: 'Tonight', icon: 'mdi:ticket-confirmation' }),
    progress: d.sensor({ name: 'Playback progress', unit: '%', accuracyDecimals: 0, icon: 'mdi:progress-clock' }),
    playing: d.binarySensor({ name: 'Film playing', deviceClass: 'running' }),
    online: d.binarySensor({ name: 'Panel online', deviceClass: 'connectivity', category: 'diagnostic' }),
    panels: d.sensor({ name: 'Panels open', accuracyDecimals: 0, icon: 'mdi:tablet', category: 'diagnostic' }),
    streams: d.sensor({ name: 'Plex streams', accuracyDecimals: 0, icon: 'mdi:play-network', stateClass: 'measurement' }),
    activeAccent: d.textSensor({ name: 'Active accent', icon: 'mdi:calendar-star', category: 'diagnostic' }),
    build: d.textSensor({ name: 'Build', icon: 'mdi:tag', category: 'diagnostic', state: config.build.version }),
    // An ESPHome action returns nothing, so the sentence a voice intent should speak is published
    // here: HA's intent_script calls esphome.theater_panel_voice, waits for this to change, and
    // reads it. It is cleared to "…" first so the same answer twice still counts as a change.
    voiceAnswer: d.textSensor({ name: 'Voice answer', icon: 'mdi:message-reply-text', category: 'diagnostic', state: '' }),
    update: d.update({ name: 'Panel image', title: 'Theater panel', category: 'diagnostic' }, async (what) => {
      // The image is pulled by Unraid, not by the panel: hand the request to HA as an event so an
      // automation can run the container update, and re-check GHCR either way.
      if (what === 'install') d.fireEvent('theater_panel_update_requested', { image: (await versions()).image });
      await pushVersion(true);
    }),
    picked: d.event({ name: 'Mystery box pick', eventTypes: ['picked', 'started'], icon: 'mdi:gift-open' }),
  };
  for (const [name, label, icon] of SCENES) {
    ent[`scene_${name}`] = d.button({ name: label, id: `scene_${name}`, icon }, () => ctx.run({ action: 'scene', name }));
  }

  d.service({ name: 'play', args: { rating_key: 'string', part_id: 'string', preroll: 'bool' } }, ({ rating_key, part_id, preroll }) =>
    ctx.run({ action: 'play', ratingKey: rating_key, partId: part_id || undefined, ...(preroll ? { preroll: true } : {}) }));
  d.service({ name: 'navigate', args: { route: 'string' } }, ({ route }) => {
    if (!/^#?\/?[a-z]+(\?[\w=&%.,-]*)?$/i.test(route)) throw new Error('Bad route');
    ctx.broadcast('navigate', { route });
  });
  d.service({ name: 'voice', args: { intent: 'string', query: 'string', name: 'string', route: 'string' } }, async (args) => {
    ent.voiceAnswer.set('…');
    ent.voiceAnswer.set(await voiceSentence(args));
  });
  d.service({ name: 'scene', args: { name: 'string' } }, ({ name }) => ctx.run({ action: 'scene', name }));

  return d;
}

// What the intent should say, from what /api/voice answers: the same sentences HA's intent
// scripts used to build from the rest_command's response.
async function voiceSentence(args) {
  const intent = String(args.intent || '').toLowerCase();
  let r;
  try { r = await ctx.voice(args); } catch (e) { return e.message || 'Something went wrong'; }
  if (intent === 'play') return r.ok ? `Starting ${r.spoken}` : r.spoken;
  if (intent === 'mystery' || intent === 'surprise') return r.spoken ? `Tonight you are watching ${r.spoken}` : 'I could not find anything to watch';
  if (intent === 'navigate') return `Showing ${r.spoken}`;
  if (intent === 'scene') return r.spoken.charAt(0).toUpperCase() + r.spoken.slice(1);
  return r.spoken || 'Done';
}

const sleepOption = () => {
  const s = sleep.get();
  if (!s) return 'Off';
  if (s.mode === 'end') return 'After this film';
  const m = SLEEP_OPTIONS.find((o) => parseInt(o, 10) === s.minutes);
  return m || `${s.minutes} minutes`;
};

// Push the panel's current state into every entity. Cheap: only changes go out.
export function refresh() {
  if (!dev) return;
  ent.theme.set(config.ui.theme);
  ent.accent.set(config.ui.accent);
  ent.weather.set(config.ui.accentIntensity);
  ent.cinema.set(config.ui.cinema);
  ent.preroll.set(Boolean(config.preroll.url) && config.preroll.enabled);
  ent.sleep.set(sleepOption());
  ent.activeAccent.set(accentName(accentNow().id));
  ent.build.set(config.build.version);
  ent.online.set(ctx.panels() > 0);
  ent.panels.set(ctx.panels());
  ent.streams.set(last.streams.length);
  const s = last.sessions[0];
  const state = s?.state || ctx.ha.states[config.entities.appleTv]?.state;
  ent.playing.set(['playing', 'paused', 'buffering'].includes(state));
  ent.nowPlaying.set(s ? (s.type === 'episode' && s.showTitle ? `${s.showTitle} · ${s.title}` : s.title) : (state === 'playing' || state === 'paused' ? 'Apple TV' : ''));
  ent.progress.set(s?.duration ? Math.round((s.viewOffset / s.duration) * 100) : 0);
  pushVersion();
}

let versionAt = 0;
async function pushVersion(force = false) {
  if (!dev || (!force && Date.now() - versionAt < 60e3)) return;
  versionAt = Date.now();
  try {
    const v = await versions();
    ent.update?.set({ current: v.installed, latest: v.update ? v.latest : v.installed, title: 'Theater panel', url: 'https://github.com/davidcoulson/theater-panel' });
  } catch { /* GHCR unreachable: keep what we had */ }
}

// Hooks from the server: sessions and streams from the Plex poll, the sleep timer, HA states.
export function sessions(sessionsNow, streamsNow) { last = { sessions: sessionsNow, streams: streamsNow }; refresh(); }
// The evening's plan for any dashboard outside the room: "Title · 8:00 PM", "Title · now", or blank.
let tonightText = '';
export function tonight(plan) {
  const when = !plan ? '' : plan.at ? new Date(plan.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : plan.state === 'done' ? 'finished' : 'now';
  tonightText = plan ? `${plan.item.title} · ${when}` : '';
  if (dev) ent.tonight.set(tonightText);
}
export function panelsChanged() { if (dev) { ent.online.set(ctx.panels() > 0); ent.panels.set(ctx.panels()); } }
// Every event the server broadcasts to the panels passes through here too.
export function observe(event) {
  if (!dev) return;
  if (event === 'sleep') ent.sleep.set(sleepOption());
  else if (event === 'mystery') ent.picked.fire('picked');
  else if (event === 'states' || event === 'settings') refresh();
}
