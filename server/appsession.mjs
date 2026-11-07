// What a non-Plex app on the projector (SmartTube, YouTube) is playing. The ADB media_player only
// knows the app's package, but Android keeps each app's media session (title, play state,
// position), so `dumpsys media_session` over ADB reads it. HA's adb_command leaves the output in
// the entity's adb_response attribute rather than returning it.
import { config } from './config.mjs';
import { extImage } from './images.mjs';

let current = null, poll = null, send = null;
const thumbs = new Map();   // "title|channel" -> { u: a proxied thumbnail URL or null when nothing matched, at }; the last 50 videos, a miss tried again after 5 min

const words = (t) => new Set(String(t).toLowerCase().match(/[a-z0-9]+/g) || []);
const overlap = (a, b) => { const x = words(a), y = words(b); let n = 0; for (const w of x) if (y.has(w)) n++; return n / (x.size + y.size - n || 1); };

// The video id is not in the media session, so search YouTube for the title and channel and take
// the first result from that channel whose title reads like it. SmartTube may show a rewritten
// title (DeArrow), so the match is by word overlap rather than equal.
// shortcut: scrapes the results page, move to the Data API if YouTube changes it.
async function findThumb(title, channel) {
  const get = (u) => fetch(u, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'en' }, signal: AbortSignal.timeout(5000) });
  const page = await (await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${channel}`)}`)).text();
  const ids = [...new Set([...page.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))].slice(0, 5);
  let best = null, top = 0.3;
  for (const id of ids) {
    const o = await (await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`)).json().catch(() => null);
    if (!o || (channel && o.author_name !== channel)) continue;
    const sc = overlap(title, o.title);
    if (sc > top) { top = sc; best = id; }
  }
  return best ? extImage(`https://i.ytimg.com/vi/${best}/hqdefault.jpg`) : null;
}
export const get = () => current;

// A play/pause press shows at once and is read back a moment later, rather than at the next tick.
export function nudge(cmd) {
  if (!current || !send) return;
  const state = cmd === 'pause' ? 'paused' : cmd === 'play' ? 'playing' : current.state === 'playing' ? 'paused' : 'playing';
  current = { ...current, state };
  send('appsession', current);
  for (const ms of [800, 3000]) setTimeout(() => poll?.(), ms).unref?.();   // the second catches a key that landed late
}

// "description=Title, Channel • 41K views • 7 months ago, null": a title may hold commas, the
// channel line is the one with the bullets.
// shortcut: a title that itself contains " • " is cut short, read the real title key if one turns up.
export function parse(out, pkg) {
  const block = out.split(/(?:^|\n)\s*package=/).find((b) => b.split('\n')[0].trim() === pkg);
  if (!block) return null;
  const st = block.match(/state=(\d+), position=(-?\d+)/);
  const desc = block.match(/description=(.*)/)?.[1];
  if (!st || !desc || desc === 'null') return null;
  const parts = desc.split(', ');
  const bullet = parts.findIndex((p) => p.includes(' • '));
  const title = (bullet > 0 ? parts.slice(0, bullet) : parts.slice(0, -2).length ? parts.slice(0, -2) : parts).join(', ');
  const channel = bullet > 0 ? parts[bullet].split(' • ')[0] : '';
  return { title, channel, state: ['3', '6'].includes(st[1]) ? 'playing' : st[1] === '2' ? 'paused' : 'idle', position: Number(st[2]) };
}

export function start({ ha, broadcast, active, onTick }) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    if (!active()) {   // nobody looking and nothing on the projector: forget the last reading
      if (current) { current = null; broadcast('appsession', null); }
      onTick?.();
      return;
    }
    busy = true;
    try {
      const id = config.entities.projector;
      const st = ha.states[id];
      const pkg = st?.attributes?.app_id;
      let next = null;
      if (id && pkg && ['playing', 'paused'].includes(st.state) && !/plezy|plexapp/.test(pkg)) {
        await ha.callService('androidtv', 'adb_command', { command: 'dumpsys media_session | grep -E "package=|state=PlaybackState|metadata:"' }, { target: { entity_id: id } });
        await new Promise((r) => setTimeout(r, 1500));
        const out = ha.states[id]?.attributes?.adb_response || '';
        // Another ADB command (a key press, the trailer launch) may have replaced the dump: keep what we had.
        if (!out.includes('metadata:')) return;
        const s = parse(out, pkg);
        if (s && s.state !== 'idle') {
          next = { ...s, app: pkg, at: Date.now() };
          const key = `${s.title}|${s.channel}`;
          const known = thumbs.get(key);
          if (!known || (!known.u && Date.now() - known.at > 300e3)) {
            thumbs.delete(key);
            thumbs.set(key, { u: null, at: Date.now() });
            if (thumbs.size > 50) thumbs.delete(thumbs.keys().next().value);
            findThumb(s.title, s.channel).then((u) => {
              thumbs.set(key, { u, at: Date.now() });
              if (u && current && `${current.title}|${current.channel}` === key) { current = { ...current, thumb: u }; broadcast('appsession', current); }
            }).catch(() => { thumbs.delete(key); });   // offline: try again at the next tick
          }
          if (thumbs.get(key)?.u) next.thumb = thumbs.get(key).u;
        }
      }
      if (JSON.stringify(next && { ...next, at: 0 }) !== JSON.stringify(current && { ...current, at: 0 })) { current = next; broadcast('appsession', current); }
    } catch { /* ADB or HA unreachable: keep the last reading until the next tick */ }
    finally { busy = false; onTick?.(); }
  };
  poll = tick; send = broadcast;
  setInterval(tick, 10000).unref?.();
}
