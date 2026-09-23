// App shell: fixed 1920x1080 stage scaled to the screen, the walnut rail, a tiny router, and
// the playback rule: when the Apple TV starts playing the panel goes to Showtime by itself,
// and back to the Lobby when playback ends.

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html, Icon } from './lib/ui.mjs';
import { startLive, useStore, useEntity, clock, getState, setTheater, subscribe } from './lib/api.mjs';
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
  setTheme(params.theme);
  setAccent(params.accent);
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
// Theme: the settings page picks it (Display > Theme, arrives with the rest of /api/state);
// "#/lobby?theme=sofa" overrides it on this panel until "theme=" clears the override.
const THEMES = ['classic', 'sofa'];
let themeOverride = null;
let themeSetting = 'classic';
function applyTheme() {
  const t = themeOverride || themeSetting;
  for (const name of THEMES) document.documentElement.classList.toggle(`t-${name}`, t === name && name !== 'classic');
}
export function setTheme(value) {
  if (value === undefined) return;
  themeOverride = THEMES.includes(value) ? value : null;
  applyTheme();
}
subscribe(() => { const t = getState().ui?.theme; if (THEMES.includes(t) && t !== themeSetting) { themeSetting = t; applyTheme(); } });

// Holiday accent (server/accents.mjs): the server resolves the calendar and sends { id, glyph,
// glow, gold }; "?accent=halloween" tries one on this panel, "accent=" clears the override.
const ACCENT_IDS = ['halloween', 'thanksgiving', 'christmas', 'newyear', 'valentines', 'birthday'];
// Glyph and idle glow per accent, for a route override (the server sends these with its own pick).
const ACCENT_DEFS = {
  halloween: { id: 'halloween', name: 'Halloween', glyph: 'pumpkin', glow: 'Halloween Eyes' },
  thanksgiving: { id: 'thanksgiving', name: 'Thanksgiving', glyph: 'leaf', glow: 'Ember Ring' },
  christmas: { id: 'christmas', name: 'Christmas', glyph: 'snowflake', glow: 'Fairytwinkle' },
  newyear: { id: 'newyear', name: 'New Year', glyph: 'sparkle', glow: 'Fireworks Burst' },
  valentines: { id: 'valentines', name: "Valentine's", glyph: 'heart', glow: 'Heartbeat Pulse' },
  birthday: { id: 'birthday', name: 'Birthday', glyph: 'cake', glow: 'Confetti' },
};
let accentOverride = null;
let accentSetting = { id: 'none' };
const accentNow = () => (accentOverride ? { id: accentOverride } : accentSetting);
function applyAccent() {
  const id = accentNow().id;
  for (const a of ACCENT_IDS) document.documentElement.classList.toggle(`a-${a}`, id === a);
}
export function setAccent(value) {
  if (value === undefined) return;
  accentOverride = ACCENT_IDS.includes(value) ? value : null;
  applyAccent();
}
subscribe(() => { const a = getState().ui?.accent; if (a && a.id !== accentSetting.id) { accentSetting = a; applyAccent(); } });

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
  // The glow tracks the accents' brightness: 0.15 when they are barely on, 0.65 at full.
  const bright = Math.max(0, Math.min(1, (Number(accent?.attributes?.brightness) || 0) / 255));
  const glow = 0.15 + 0.5 * bright;
  const theater = useStore((s) => Boolean(s.theater?.active));
  const build = useStore((s) => s.build) || {};
  const ha = useStore((s) => ({ ok: s.haConnected, configured: s.haConfigured, live: s.connected }));
  // The holiday accent: its glow fills the rail while the accents are off, and its glyph sits
  // over the clock. An override from the route only knows the id, so look the rest up.
  const holiday = useStore((s) => s.ui?.accent);
  const hol = route.params.accent ? (ACCENT_DEFS[route.params.accent] || null) : holiday?.id && holiday.id !== 'none' ? holiday : null;
  const lightsOn = accent?.state === 'on';
  useEffect(() => { const t = setInterval(() => setNow(clock()), 15000); return () => clearInterval(t); }, []);
  return html`<nav class="rail tx-planks-rail" aria-label="Sections">
    <${RailGlow} name=${route.params.glow || (lightsOn ? accent.attributes?.effect : hol?.glow || null)} speed=${lightsOn ? speed : 0.3}
      opacity=${Number(route.params.glowop) || (theater ? glow * 0.4 : lightsOn ? glow : 0.3)} paused=${theater} />
    <div class="logo"><b>BC</b><span>Theater</span></div>
    ${NAV.map(([name, label, icon]) => html`<a href=${`#/${name}`} aria-current=${current === name ? 'page' : undefined}
      onClick=${(e) => { e.preventDefault(); go(name); }}><${Icon} name=${icon} size=${32} /><span>${label}</span></a>`)}
    <div class="grow"></div>
    ${ha.live === false ? html`<div class="offline">Server offline</div>` : ha.live && !ha.ok ? html`<div class="offline">${ha.configured ? 'HA offline' : 'HA not set up'}</div>` : null}
    <a href="#/showtime" class="to-showtime" onClick=${(e) => { e.preventDefault(); go('showtime'); }}><${Icon} name="moon" size=${30} /><span>Showtime</span></a>
    ${hol && html`<div class="glyph" title=${hol.who ? `${hol.who}'s birthday` : hol.name}><${Icon} name=${hol.glyph} size=${30} w=${1.8} />${hol.who && html`<span>${hol.who}</span>`}</div>`}
    <div class="clock">${now.hm}</div><div class="ampm">${now.ampm}</div>
    ${build.version && html`<div class="build" title=${build.time ? `built ${build.time}` : ''}>
      <span>${build.version.split('.').slice(0, 3).join('.')}</span>
      <span>${build.version.split('.').slice(3).join('.')}</span>
    </div>`}
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
setTheme(route.params.theme ?? '');
setAccent(route.params.accent ?? '');
startLive({ navigate: goRoute });
// Is Kiosk Satellite's theater mode reachable (directly, or relayed by the HA page around us)?
detectTheater().then((t) => {
  setTheater(t);
  if (t?.active && route.name !== 'showtime') go('showtime', { auto: true });
});
render(html`<${App} />`, document.getElementById('stage'));
