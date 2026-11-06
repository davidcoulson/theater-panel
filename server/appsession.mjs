// What a non-Plex app on the projector (SmartTube, YouTube) is playing. The ADB media_player only
// knows the app's package, but Android keeps each app's media session (title, play state,
// position), so `dumpsys media_session` over ADB reads it. HA's adb_command leaves the output in
// the entity's adb_response attribute rather than returning it.
import { config } from './config.mjs';

let current = null;
export const get = () => current;

// "description=Title, Channel • 41K views • 7 months ago, null": a title may hold commas, the
// channel line is the one with the bullets.
// shortcut: a title that itself contains " • " is cut short, read the real title key if one turns up.
export function parse(out, pkg) {
  const at = out.indexOf(`package=${pkg}`);
  if (at < 0) return null;
  const block = out.slice(at).split(/\n\s*package=/)[0];
  const st = block.match(/state=(\d+), position=(-?\d+)/);
  const desc = block.match(/description=(.*)/)?.[1];
  if (!st || !desc || desc === 'null') return null;
  const parts = desc.split(', ');
  const bullet = parts.findIndex((p) => p.includes(' • '));
  const title = (bullet > 0 ? parts.slice(0, bullet) : parts.slice(0, -2).length ? parts.slice(0, -2) : parts).join(', ');
  return { title, state: st[1] === '3' ? 'playing' : st[1] === '2' ? 'paused' : 'idle', position: Number(st[2]) };
}

export function start({ ha, broadcast, active }) {
  let busy = false;
  const tick = async () => {
    if (busy || !active()) return;
    busy = true;
    try {
      const id = config.entities.projector;
      const st = ha.states[id];
      const pkg = st?.attributes?.app_id;
      let next = null;
      if (id && pkg && ['playing', 'paused'].includes(st.state) && !/plezy|plexapp/.test(pkg)) {
        await ha.callService('androidtv', 'adb_command', { command: 'dumpsys media_session | grep -E "package=|state=PlaybackState|metadata:"' }, { target: { entity_id: id } });
        await new Promise((r) => setTimeout(r, 1500));
        const s = parse(ha.states[id]?.attributes?.adb_response || '', pkg);
        if (s) next = { ...s, app: pkg, at: Date.now() };
      }
      if (JSON.stringify(next && { ...next, at: 0 }) !== JSON.stringify(current && { ...current, at: 0 })) { current = next; broadcast('appsession', current); }
    } catch { /* ADB or HA unreachable: keep the last reading until the next tick */ }
    finally { busy = false; }
  };
  setInterval(tick, 10000).unref?.();
}
