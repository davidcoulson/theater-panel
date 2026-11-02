// A film left paused for a long time: warn on the panel, then put the projector in standby (picture
// off, Apple TV asleep - the same path as the Off button) and leave the Plex session paused.
// Pressing play brings the picture back. Timed on Plex's own session state for this room: the
// projector's androidtv entity says "paused" for the whole HDMI input, so it can't be trusted.

import { config } from './config.mjs';

const WARN = 2 * 60e3;            // the countdown the panel shows before the picture goes
let ctx = null, since = 0, standby = false;

export function init(context) { ctx = context; }

const limit = () => Math.max(0, Number(config.pauseStandbyMin) || 0) * 60e3;
export const get = () => (since && !standby && limit() && since + limit() - Date.now() <= WARN ? { at: since + limit() } : null);

function publish() { ctx?.broadcast('pausewarn', get() || { at: null }); }

// Called after every Plex poll with this room's sessions.
export function observe(mine) {
  const s = mine[0]?.state;
  if (s !== 'paused') {
    // Play after a standby: picture back on. A stopped session stays dark; the next Play does it.
    if (standby && s === 'playing') ctx.run({ action: 'projector', cmd: 'light_on' }).catch((e) => console.warn('[pause-standby] picture on:', e.message));
    if (since || standby) { since = 0; standby = false; publish(); }
    return;
  }
  if (!limit() || standby) return;
  if (!since) since = Date.now();
  const left = since + limit() - Date.now();
  if (left <= 0) {
    standby = true;
    publish();
    console.log('[pause-standby] paused too long: projector to standby');
    ctx.run({ action: 'projector', cmd: 'power_off' }).catch((e) => console.warn('[pause-standby]', e.message));
  } else if (left <= WARN) publish();
}

// "Keep on": start the clock again from now (only while a pause is being timed).
export function keepOn() { if (since && !standby) { since = Date.now(); publish(); } return { ok: true }; }
