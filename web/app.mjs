// App shell: fixed 1920x1080 stage scaled to the screen, the walnut rail, a tiny router, and
// the playback rule: when the Apple TV starts playing the panel goes to Showtime by itself,
// and back to the Lobby when playback ends.

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html, Icon } from './lib/ui.mjs';
import { startLive, useStore, useEntity, clock, getState, setTheater } from './lib/api.mjs';
import { RailGlow } from './lib/effects.mjs';
import { onTheater, detectTheater } from './lib/ks.mjs';
import { Lobby } from './views/lobby.mjs';
import { Watch } from './views/watch.mjs';
import { Request } from './views/request.mjs';
import { Music } from './views/music.mjs';
import { Showtime } from './views/showtime.mjs';
import { Games } from './views/games.mjs';
import { Stats } from './views/stats.mjs';
import { Showing } from './views/showing.mjs';
import { Pick } from './views/pick.mjs';

const VIEWS = { lobby: Lobby, watch: Watch, request: Request, music: Music, games: Games, showtime: Showtime, stats: Stats, showing: Showing, pick: Pick };
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
  setRender(params.render);
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
//
// At exactly 1:1 (the panel) the stage is drawn in place with no transform: a transformed
// full-screen layer made the panel's Android WebView sprinkle black specks along shadows. Other
// sizes use CSS zoom (real layout at that size, no scaled layer); render=transform brings back
// the old scaled layer.
//
// Render switches for chasing GPU glitches on the panel, set from HA without a redeploy:
// rest_command.theater_panel_navigate with route "#/lobby?render=noshadow,notex" (comma list of
// transform, noshadow, notex, noanim). They stick until another render= arrives; "render=" clears them.
let renderFlags = new Set();
export function setRender(value) {
  if (value === undefined) return;
  renderFlags = new Set(String(value).split(',').map((x) => x.trim()).filter(Boolean));
  for (const f of ['noshadow', 'notex', 'noanim', 'shadows']) document.documentElement.classList.toggle(`r-${f}`, renderFlags.has(f));
  fit();
}
// The panel's GPU sprinkles specks along blurred box-shadows (confirmed with render=noshadow),
// and a crisp 2px version still speckled on pages that repaint often, so on the panel every
// blurred shadow is dropped and only hairlines (0 blur) and inset shadows are kept.
// render=shadows puts them back for testing.
const SHADOW_PART = /((?:[^,(]|\([^)]*\))+)/g;
function flatShadow(value) {
  const keep = value.match(SHADOW_PART).map((p) => p.trim()).filter((part) => {
    if (/inset/.test(part)) return true;
    const color = (part.match(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b|var\([^)]*\)/i) || [''])[0];
    const lengths = part.replace(color, '').match(/-?[\d.]+/g)?.map(Number) || [];
    return lengths.length < 3 || lengths[2] === 0;   // no blur radius
  });
  return keep.length ? keep.join(', ') : 'none';
}
let crisped = false;
function crispShadows() {
  if (crisped || !onPanel || renderFlags.has('shadows')) return;
  crisped = true;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) if (r.style?.boxShadow && r.style.boxShadow !== 'none') r.style.boxShadow = flatShadow(r.style.boxShadow);
  }
}

function fit() {
  document.documentElement.classList.toggle('r-panel', onPanel);
  crispShadows();
  const s = Math.min(innerWidth / 1920, innerHeight / 1080, onPanel ? Infinity : 1);
  const st = document.getElementById('stage');
  const legacy = renderFlags.has('transform');
  document.documentElement.classList.toggle('r-zoom', !legacy);
  st.style.transform = legacy ? `translate(-50%, -50%) scale(${s})` : '';
  st.style.zoom = legacy || s === 1 ? '' : String(s);
}
addEventListener('resize', fit);
addEventListener('hashchange', () => {
  const r = parseHash();
  if (r.name !== route.name || JSON.stringify(r.params) !== JSON.stringify(route.params)) go(r.name, r.params);
});

function Rail({ current }) {
  const [now, setNow] = useState(clock());
  // The rail glows with whatever the accent lights are doing (see lib/effects.mjs).
  const ents = useStore((s) => s.entities);
  const accent = useEntity(ents.lights?.find((id) => /accent/.test(id)) || '');
  const speedEnt = useEntity(ents.accentSpeed);
  const speed = Math.max(0.05, Math.min(1, (Number(speedEnt?.state) || 128) / 255));
  const theater = useStore((s) => Boolean(s.theater?.active));
  const build = useStore((s) => s.build) || {};
  const ha = useStore((s) => ({ ok: s.haConnected, configured: s.haConfigured, live: s.connected }));
  useEffect(() => { const t = setInterval(() => setNow(clock()), 15000); return () => clearInterval(t); }, []);
  return html`<nav class="rail tx-planks-rail" aria-label="Sections">
    <${RailGlow} name=${route.params.glow || (accent?.state === 'on' ? accent.attributes?.effect : null)} speed=${speed} opacity=${Number(route.params.glowop) || (theater ? 0.25 : 0.65)} />
    <div class="logo"><b>BC</b><span>Theater</span></div>
    ${NAV.map(([name, label, icon]) => html`<a href=${`#/${name}`} aria-current=${current === name ? 'page' : undefined}
      onClick=${(e) => { e.preventDefault(); go(name); }}><${Icon} name=${icon} size=${32} /><span>${label}</span></a>`)}
    <div class="grow"></div>
    ${ha.live === false ? html`<div class="offline">Server offline</div>` : ha.live && !ha.ok ? html`<div class="offline">${ha.configured ? 'HA offline' : 'HA not set up'}</div>` : null}
    <a href="#/showtime" class="to-showtime" onClick=${(e) => { e.preventDefault(); go('showtime'); }}><${Icon} name="moon" size=${30} /><span>Showtime</span></a>
    <div class="clock">${now.hm}</div><div class="ampm">${now.ampm}</div>
    <div class="build" title=${build.time ? `built ${build.time}` : ''}>${build.version || ''}</div>
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
  // Untouched for a while: drift to the Now Showing screen (a cinema lobby board). Any touch
  // brings the panel straight back to Home. Nothing happens during Showtime.
  useEffect(() => {
    const t = setInterval(() => {
      const idleMin = getState().idleMinutes ?? 8;
      if (idleMin > 0 && route.name !== 'showtime' && route.name !== 'showing' && Date.now() - lastManual > idleMin * 60000) go('showing', { auto: true });
    }, 15000);
    const back = () => { if (route.name === 'showing') go('lobby'); };
    addEventListener('pointerdown', back, true);
    return () => { clearInterval(t); removeEventListener('pointerdown', back, true); };
  }, []);

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
  // Showtime and the idle screen fill the panel on their own.
  if (r.name === 'showtime' || r.name === 'showing') return html`<${View} key=${r.name} />${toast && html`<div class=${`toast ${toast.err ? 'err' : ''}`}>${toast.text}</div>`}`;
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

setRender(route.params.render ?? '');
startLive({ navigate: goRoute });
// Is Kiosk Satellite's theater mode reachable (directly, or relayed by the HA page around us)?
detectTheater().then((t) => {
  setTheater(t);
  if (t?.active && route.name !== 'showtime') go('showtime', { auto: true });
});
render(html`<${App} />`, document.getElementById('stage'));
