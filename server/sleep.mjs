// What happens when the film ends. "Stop after this" shuts the room down; a timed sleep does it
// after so many minutes; and with nothing armed at all the lights still come up slowly, the way
// a cinema's do. The server holds all of it, not the panel, so it survives the panel reloading,
// drifting to the idle screen or being switched off in the middle of the film.

import { config } from './config.mjs';

// { mode: 'end' | 'timer', at: epoch ms | null, armedAt }
let timer = null;
let state = null;
let ctx = null;
let sawPlayback = false;
let idleSince = 0;

// How long everything has to stay stopped before "after this" counts as the end: long enough to
// ride out the gap while a player changes titles or the Apple TV blinks through idle.
const GRACE = 45e3;

export function init(context) {
  ctx = context;
  ctx.ha.on('states', check);
  setInterval(check, 15e3).unref();
}

export const get = () => (state ? { ...state, in: state.at ? Math.max(0, state.at - Date.now()) : null } : null);

export function set({ mode, minutes }) {
  clearTimeout(timer);
  if (mode !== 'end' && mode !== 'timer') { state = null; publish(); return get(); }
  if (mode === 'timer') {
    const m = Math.max(5, Math.min(240, Number(minutes) || 60));
    state = { mode, minutes: m, at: Date.now() + m * 60e3, armedAt: Date.now() };
    timer = setTimeout(() => fire(`after ${m} minutes`), m * 60e3);
    timer.unref?.();
  } else {
    state = { mode, minutes: null, at: null, armedAt: Date.now() };
    sawPlayback = playing();
    idleSince = sawPlayback ? 0 : Date.now();
  }
  publish();
  return get();
}

// The players that count as "the film is running": whichever of them this room plays through.
const watched = () => {
  const e = config.entities;
  return [e.appleTv, e.projector, e.projectorPlexPlayer, e.plexPlayer].filter(Boolean);
};
const playing = () => watched().some((id) => ['playing', 'paused', 'buffering'].includes(ctx?.ha.states[id]?.state));

function check() {
  if (!ctx) return;
  if (playing()) { sawPlayback = true; idleSince = 0; return; }
  if (!sawPlayback) return;                       // nothing has played yet: nothing to end
  if (!idleSince) { idleSince = Date.now(); return; }
  if (Date.now() - idleSince < GRACE) return;
  sawPlayback = false;                            // this ending is dealt with either way
  idleSince = 0;
  if (state?.mode === 'end') { fire('when the film ended'); return; }
  curtain();
}

// Nothing armed: bring the house lights up over a minute and a half. The HA script decides
// whether the room is still set for a movie, so this is safe to call whenever playback stops.
function curtain() {
  if (!config.curtainSeconds) return;
  ctx.script('curtain', { seconds: config.curtainSeconds })
    .then(() => console.log('[curtain] house lights up over', config.curtainSeconds, 's'))
    .catch((e) => console.warn('[curtain]', e.message));
}

// Wind the room down: stop whatever is still playing, then All off (projector, lights, music).
async function fire(why) {
  const armed = state;
  clearTimeout(timer);
  state = null;
  sawPlayback = false;
  publish({ fired: why });
  if (!armed || !ctx) return;
  try {
    if (armed.mode === 'timer') await ctx.run({ action: 'transport', cmd: 'stop' }).catch(() => {});
    await ctx.run({ action: 'scene', name: 'all_off' });
    console.log(`[sleep] room off ${why}`);
  } catch (e) { console.warn('[sleep] could not shut down:', e.message); }
}

function publish(extra = {}) { ctx?.broadcast('sleep', { ...(get() || { mode: null }), ...extra }); }
