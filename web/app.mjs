// App shell: fixed 1920x1080 stage scaled to the screen, the walnut rail, a tiny router, and
// the playback rule: when the Apple TV starts playing the panel goes to Showtime by itself,
// and back to the Lobby when playback ends.

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html, Icon } from './lib/ui.mjs';
import { startLive, useStore, clock, getState, setTheater } from './lib/api.mjs';
import { onTheater, detectTheater } from './lib/ks.mjs';
import { Lobby } from './views/lobby.mjs';
import { Watch } from './views/watch.mjs';
import { Request } from './views/request.mjs';
import { Music } from './views/music.mjs';
import { Showtime } from './views/showtime.mjs';
import { Games } from './views/games.mjs';

const VIEWS = { lobby: Lobby, watch: Watch, request: Request, music: Music, games: Games, showtime: Showtime };
const NAV = [['lobby', 'Home', 'home'], ['watch', 'Watch', 'film'], ['request', 'Request', 'plus'], ['music', 'Music', 'music'], ['games', 'Games', 'pad']];

// Hash routes, with optional query params: #/watch?lib=networks&brand=netflix
function parseHash() {
  const [name, qs] = location.hash.slice(2).split('?');
  return { name: name || 'lobby', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const route = parseHash();
let setRoute = () => {};
let lastManual = 0;
export function go(name, params = {}) {
  route.name = VIEWS[name] ? name : 'lobby';
  route.params = params;
  if (!params.auto) lastManual = Date.now();
  const qs = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== 'auto' && k !== 'manual' && typeof v === 'string')).toString();
  history.replaceState(null, '', `#/${route.name}${qs ? `?${qs}` : ''}`);
  setRoute({ ...route });
}

// Scale the stage to fit whatever screen we are on (exactly 1:1 on the 1920x1080 panel).
// On the wall panel (Kiosk Satellite, or framed in HA's dashboard) the stage fills the screen.
// In an ordinary browser it never grows past 100%, so a big monitor shows it at the panel's own
// size; ?fit=1 scales it to the window anyway.
const onPanel = Boolean(window.kioskSatellite) || window.parent !== window || new URLSearchParams(location.search).has('fit');
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080, onPanel ? Infinity : 1);
  document.getElementById('stage').style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fit);
addEventListener('hashchange', () => {
  const r = parseHash();
  if (r.name !== route.name || JSON.stringify(r.params) !== JSON.stringify(route.params)) go(r.name, r.params);
});

function Rail({ current }) {
  const [now, setNow] = useState(clock());
  const ha = useStore((s) => ({ ok: s.haConnected, configured: s.haConfigured, live: s.connected }));
  useEffect(() => { const t = setInterval(() => setNow(clock()), 15000); return () => clearInterval(t); }, []);
  return html`<nav class="rail tx-planks-rail" aria-label="Sections">
    <div class="logo"><b>HT</b><span>Theater</span></div>
    ${NAV.map(([name, label, icon]) => html`<a href=${`#/${name}`} aria-current=${current === name ? 'page' : undefined}
      onClick=${(e) => { e.preventDefault(); go(name); }}><${Icon} name=${icon} size=${32} /><span>${label}</span></a>`)}
    <div class="grow"></div>
    ${ha.live === false ? html`<div class="offline">Server offline</div>` : ha.live && !ha.ok ? html`<div class="offline">${ha.configured ? 'HA offline' : 'HA not set up'}</div>` : null}
    <a href="#/showtime" class="to-showtime" onClick=${(e) => { e.preventDefault(); go('showtime'); }}><${Icon} name="moon" size=${30} /><span>Showtime</span></a>
    <div class="clock">${now.hm}</div><div class="ampm">${now.ampm}</div>
  </nav>`;
}

function App() {
  const [r, setR] = useState(route);
  setRoute = setR;
  const tvState = useStore((s) => s.states[s.entities.appleTv]?.state);
  const toast = useStore((s) => s.toast);

  // Playback drives the screen: start playing -> Showtime; stop -> Lobby. If someone leaves
  // Showtime while a movie plays, return there after 90 s without a touch.
  useEffect(() => {
    if (tvState === 'playing' && route.name !== 'showtime' && Date.now() - lastManual > 90000) go('showtime', { auto: true });
    if (['idle', 'off', 'standby'].includes(tvState) && route.name === 'showtime') go('lobby', { auto: true });
  }, [tvState]);
  useEffect(() => {
    const t = setInterval(() => {
      const st = getState().states[getState().entities.appleTv]?.state;
      if (st === 'playing' && route.name !== 'showtime' && Date.now() - lastManual > 90000) go('showtime', { auto: true });
    }, 5000);
    // Theater mode switched on from HA, a ks:// link or a reload mid-film: show Showtime.
    const offTheater = onTheater((d) => { if (d.active && route.name !== 'showtime') go('showtime', { auto: true }); });
    const touch = () => { lastManual = Date.now(); };
    addEventListener('pointerdown', touch, true);
    return () => { clearInterval(t); offTheater(); removeEventListener('pointerdown', touch, true); };
  }, []);

  const View = VIEWS[r.name] || Lobby;
  if (r.name === 'showtime') return html`<${View} key="showtime" />${toast && html`<div class=${`toast ${toast.err ? 'err' : ''}`}>${toast.text}</div>`}`;
  return html`<div class="app tx-plaster">
    <${Rail} current=${r.name} />
    <${View} key=${r.name + JSON.stringify(r.params)} />
    ${toast && html`<div class=${`toast ${toast.err ? 'err' : ''}`}>${toast.text}</div>`}
  </div>`;
}

// "#/watch?brand=netflix" or "watch?brand=netflix" -> go('watch', {brand: 'netflix'})
function goRoute(r) {
  const [name, qs] = String(r || '').replace(/^#?\/?/, '').split('?');
  go(name || 'lobby', Object.fromEntries(new URLSearchParams(qs || '')));
}

fit();
startLive({ navigate: goRoute });
// Is Kiosk Satellite's theater mode reachable (directly, or relayed by the HA page around us)?
detectTheater().then((t) => {
  setTheater(t);
  if (t?.active && route.name !== 'showtime') go('showtime', { auto: true });
});
render(html`<${App} />`, document.getElementById('stage'));
