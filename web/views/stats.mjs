// Gaming PC stats, dressed as the projection booth's instruments: brass needle dials for GPU and
// CPU load, fuel gauges for memory, lamps for the network and GPU draw, LED meters for the cores, and the last hour as
// a film strip. The page's accent warms from amber to red as the GPU works harder. Numbers come
// from the PC's Home Assistant sensors (LibreHardwareMonitor's integration or HASS.Agent), mapped
// to roles in games.json (pc.stats); the hour is recorded by the server. Swipe right for Games.
// #/stats?demo=1 fills it with made-up numbers to see the layout.

import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { html, Header, Icon } from '../lib/ui.mjs';
import { get, useStore, useLoad, runtime } from '../lib/api.mjs';
import { route, go } from '../app.mjs';

const r0 = (v) => (Number.isFinite(v) ? Math.round(v) : null);
// Temperatures are kept in °C (the heat scale) and shown in °F.
const degF = (c) => (Number.isFinite(c) ? `${Math.round(c * 9 / 5 + 32)}°F` : '—');

// ---------- values ----------

// Current numbers for every mapped role.
function useStats(stats, demo) {
  // Only the mapped entities' raw states: the whole map is a new object on every HA update.
  const ids = Object.values(stats || {}).flat().filter((id) => typeof id === 'string');
  const states = useStore((s) => Object.fromEntries(ids.map((id) => [id, s.states[id]?.state])));
  const units = useStore((s) => Object.fromEntries(ids.map((id) => [id, s.states[id]?.attributes?.unit_of_measurement])));
  const num = (role) => {
    const id = stats?.[role];
    const v = id && Number(states[id]);
    return Number.isFinite(v) ? inPanelUnits(role, v, units[id]) : null;
  };
  const vals = demo ? demoValues() : {
    fps: num('fps'), fpsLow: num('fpsLow'),
    gpuLoad: num('gpuLoad'), gpuTemp: num('gpuTemp'), gpuClock: num('gpuClock'), gpuMemClock: num('gpuMemClock'), gpuPower: num('gpuPower'), gpuFan: num('gpuFan'),
    cpuLoad: num('cpuLoad'), cpuTemp: num('cpuTemp'), cpuClock: num('cpuClock'),
    ramUsed: num('ramUsed'), ramTotal: num('ramTotal'), ramLoad: num('ramLoad'), vramUsed: num('vramUsed'), vramTotal: num('vramTotal'),
    netDown: num('netDown'), netUp: num('netUp'),
    cores: (stats?.cores || []).map((id) => Number(states[id])).filter(Number.isFinite),
    game: gameName(states[stats?.game]),
    uptime: states[stats?.uptime],
  };
  return vals;
}

// LibreHardwareMonitor reports memory in MB and network in KB/s, HASS.Agent temperatures in the
// house's unit; the panels work in GB, Mb/s and °C (temperatures are shown in °F).
const NET = { 'B/s': 8 / 1e6, 'KB/s': 8 * 1024 / 1e6, 'kB/s': 8 / 1e3, 'MB/s': 8 * 1024 * 1024 / 1e6, 'GB/s': 8 * 1024 ** 3 / 1e6,
  'bit/s': 1e-6, 'kbit/s': 1e-3, 'Mbit/s': 1, 'Gbit/s': 1e3 };
function inPanelUnits(role, v, unit) {
  if (role === 'ramUsed' || role === 'ramTotal' || role === 'vramUsed' || role === 'vramTotal') {
    return unit === 'MB' || unit === 'MiB' ? v / 1024 : unit === 'KB' || unit === 'kB' ? v / 1024 ** 2 : unit === 'TB' ? v * 1024 : v;
  }
  if (role === 'netDown' || role === 'netUp') return NET[unit] ? v * NET[unit] : v;
  if ((role === 'gpuTemp' || role === 'cpuTemp') && unit === '°F') return (v - 32) * 5 / 9;
  return v;
}

// HASS.Agent's active-window sensor gives a window title; keep it short and drop "idle" states.
function gameName(v) {
  if (!v || ['unknown', 'unavailable', 'idle', ''].includes(String(v).toLowerCase())) return null;
  return String(v).split(/\s+[-–|]\s+/)[0].slice(0, 40);
}

// Demo numbers: a slow random walk, so the layout can be judged before the VM is wired up.
let demoState = null;
function demoValues() {
  const walk = (v, b, s, lo, hi) => Math.min(hi, Math.max(lo, v + (b - v) * 0.25 + (Math.random() - 0.5) * s));
  const b = { fps: 118, fpsLow: 92, gpuLoad: 94, gpuTemp: 74, gpuClock: 2610, gpuMemClock: 12002, gpuPower: 318, gpuFan: 62, cpuLoad: 42, cpuTemp: 71, cpuClock: 4900, ramUsed: 21.4, ramTotal: 32, vramUsed: 13.1, vramTotal: 24, netDown: 28, netUp: 3.1 };
  demoState ??= { ...b, cores: Array.from({ length: 16 }, (_, i) => (i < 2 ? 88 : 40)) };
  const d = demoState;
  for (const k of Object.keys(b)) d[k] = walk(d[k], b[k], b[k] * 0.12, 0, k.endsWith('Load') ? 100 : b[k] * 2);
  d.cores = d.cores.map((c, i) => walk(c, i < 2 ? 88 : 40, 25, 0, 100));
  d.ramTotal = 32; d.vramTotal = 24;
  return { ...d, game: 'Cyberpunk 2077', uptime: null };
}

const demoHour = () => Array.from({ length: 60 }, (_, i) => (i < 6 ? 6 : i < 9 ? 55 : i < 22 ? 78 + (i * 7) % 14 : i < 26 ? 32 : i < 44 ? 86 + (i * 5) % 13 : i < 47 ? 22 : 80 + (i * 11) % 19));

// The highest value seen in the last minute, for the dials' red marker.
function usePeak(value, ms = 60000) {
  const seen = useRef([]);
  if (value != null) {
    const now = Date.now();
    seen.current = [...seen.current.filter((p) => now - p.t < ms), { t: now, v: value }];
  }
  return seen.current.length ? Math.max(...seen.current.map((p) => p.v)) : null;
}

// Peak-hold for the core meters: a peak jumps up with its meter and falls a segment at a time.
function usePeaks(lit, segs) {
  const [peaks, setPeaks] = useState([]);
  const now = useRef(lit); now.current = lit;
  useEffect(() => {
    const t = setInterval(() => setPeaks((p) => now.current.map((l, i) => Math.max(l, (p[i] ?? 0) - 1))), 1500);
    return () => clearInterval(t);
  }, []);
  return lit.map((l, i) => Math.min(segs, Math.max(l, peaks[i] ?? 0)));
}

// ---------- drawing ----------

const clamp = (v) => Math.min(1, Math.max(0, v));
const pt = (cx, cy, r, deg) => { const a = deg * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
const arc = (cx, cy, r, a0, a1) => { const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
const INK = '#2A1911', RED = '#A5321E';

// A needle dial, 0-100 with the red zone from 85: brass bezel, cream face, the reading in a window
// and a dot at the last minute's peak. Drawn on a 400 grid; the needle turns with a CSS transition.
const SWEEP = 125, DIAL_RED = 85;
const dialAngle = (v) => -SWEEP + 2 * SWEEP * clamp(v / 100);
function Dial({ id, value, peak, label = 'Load' }) {
  const c = 200, R = 194, f = 172;
  const face = useMemo(() => Array.from({ length: 51 }, (_, i) => {
    const v = i * 2, major = i % 5 === 0, a = dialAngle(v), col = v >= DIAL_RED ? RED : INK;
    const [x0, y0] = pt(c, c, f * 0.93, a), [x1, y1] = pt(c, c, f * (major ? 0.80 : 0.87), a), [tx, ty] = pt(c, c, f * 0.68, a);
    return html`<line x1=${x0} y1=${y0} x2=${x1} y2=${y1} stroke=${col} stroke-width=${major ? 3.6 : 1.6} stroke-linecap="round" />
      ${major && html`<text x=${tx} y=${ty} class="num" fill=${col}>${v}</text>`}`;
  }), []);
  return html`<svg class="dial" viewBox="0 0 400 400" role="img" aria-label=${`${label} ${r0(value)} percent`}>
    <defs>
      <radialGradient id=${`bz${id}`} cx="35%" cy="28%" r="85%"><stop offset="0" stop-color="#F3D9A0" /><stop offset=".35" stop-color="#B88A45" /><stop offset=".7" stop-color="#6E4B1E" /><stop offset="1" stop-color="#3B2710" /></radialGradient>
      <radialGradient id=${`fc${id}`} cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#F6EEDC" /><stop offset=".75" stop-color="#E6D8BC" /><stop offset="1" stop-color="#C9B892" /></radialGradient>
      <radialGradient id=${`gl${id}`} cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#fff" stop-opacity=".34" /><stop offset=".55" stop-color="#fff" stop-opacity="0" /></radialGradient>
    </defs>
    <circle cx=${c} cy=${c} r=${R} fill=${`url(#bz${id})`} stroke="#1a110a" stroke-width="2" />
    <circle cx=${c} cy=${c} r=${f} fill=${`url(#fc${id})`} stroke=${INK} stroke-width="2" />
    <path d=${arc(c, c, f * 0.955, dialAngle(DIAL_RED), dialAngle(100))} stroke=${RED} stroke-width="9" fill="none" opacity=".9" />
    ${face}
    <text x=${c} y=${c - f * 0.30} class="lbl">${label}</text>
    <rect x=${c - 60} y=${c + 62} width="120" height="50" rx="6" fill="#17100B" stroke="#6E4B1E" stroke-width="2" />
    <text x=${c} y=${c + 89} class="val">${r0(value)}<tspan class="unit"> %</tspan></text>
    ${peak != null && html`<g class="turn" style=${`transform:rotate(${dialAngle(peak)}deg)`}><circle cx=${c} cy=${c - f * 0.96} r="4.5" fill=${RED} /></g>`}
    <g class="turn needle" style=${`transform:rotate(${dialAngle(value)}deg)`}>
      <line x1=${c + 4} y1=${c + f * 0.16 + 6} x2=${c + 4} y2=${c - f * 0.84 + 6} stroke="#000" stroke-opacity=".25" stroke-width="8" stroke-linecap="round" />
      <line x1=${c} y1=${c + f * 0.16} x2=${c} y2=${c - f * 0.84} stroke="#B3261B" stroke-width="5.2" stroke-linecap="round" />
    </g>
    <circle cx=${c} cy=${c} r="20" fill=${`url(#bz${id})`} stroke="#1a110a" stroke-width="1.5" />
    <circle cx=${c} cy=${c} r=${f} fill=${`url(#gl${id})`} />
  </svg>`;
}

// A fuel gauge, empty to full with the last eighth in red; the reading sits under it.
function Fuel({ id, label, value, max, children }) {
  const w = 260, h = 161, cx = w / 2, cy = h * 0.92, r = w * 0.44, ang = (f) => -75 + 150 * clamp(f);
  const [ex, ey] = pt(cx, cy, r * 0.66, ang(0)), [fx, fy] = pt(cx, cy, r * 0.66, ang(1));
  return html`<figure class="fuel">
    <svg viewBox=${`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id=${`ff${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6EEDC" /><stop offset="1" stop-color="#D9C9A6" /></linearGradient>
        <linearGradient id=${`fb${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3D9A0" /><stop offset=".5" stop-color="#8A6430" /><stop offset="1" stop-color="#3B2710" /></linearGradient>
      </defs>
      <rect x="3" y="3" width=${w - 6} height=${h - 6} rx="18" fill=${`url(#ff${id})`} stroke=${`url(#fb${id})`} stroke-width="6" />
      <path d=${arc(cx, cy, r, ang(0.875), ang(1))} stroke=${RED} stroke-width="7" fill="none" />
      ${Array.from({ length: 9 }, (_, i) => {
        const a = ang(i / 8), [x0, y0] = pt(cx, cy, r * 0.97, a), [x1, y1] = pt(cx, cy, r * (i % 2 ? 0.90 : 0.84), a);
        return html`<line x1=${x0} y1=${y0} x2=${x1} y2=${y1} stroke=${i >= 7 ? RED : INK} stroke-width=${i % 2 ? 2 : 4} stroke-linecap="round" />`;
      })}
      <text x=${ex} y=${ey} class="num" fill=${INK}>E</text><text x=${fx} y=${fy} class="num" fill=${RED}>F</text>
      <text x=${cx} y="27" class="lbl">${label}</text>
      ${max > 0 && html`<g class="turn needle" style=${`transform-origin:${cx}px ${cy}px;transform:rotate(${ang(value / max)}deg)`}>
        <line x1=${cx} y1=${cy} x2=${cx} y2=${cy - r * 0.86} stroke="#B3261B" stroke-width="5" stroke-linecap="round" /></g>`}
      <circle cx=${cx} cy=${cy} r="11" fill="#3B2710" stroke="#B88A45" stroke-width="2" />
    </svg>
    <figcaption>${children}</figcaption>
  </figure>`;
}

// One LED meter per core, green to amber to red, with a peak segment that hangs and falls. The
// bottom segment stays lit, so an idle PC reads as idle and not as broken. Under each meter is the
// core's clock in GHz when the host reports it, or else its number.
const SEGS = 10;
function CoreMeters({ loads, clocks = [] }) {
  const lit = loads.map((l) => Math.max(1, Math.round(clamp(l / 100) * SEGS)));
  const peaks = usePeaks(lit, SEGS);
  return html`<div class="vu">${loads.map((_, i) => html`<div class="col">
    <div class="segs">${Array.from({ length: SEGS }, (_, k) => {
      const zone = k >= SEGS * 0.85 ? 'r' : k >= SEGS * 0.65 ? 'a' : 'g';
      return html`<i class=${`${zone} ${k < lit[i] || k === peaks[i] - 1 ? 'on' : ''}`}></i>`;
    })}</div><span>${clocks[i] > 0 ? (clocks[i] / 1000).toFixed(1) : i + 1}</span></div>`)}</div>`;
}

// A row of lamps with its reading. With nothing lit the first lamp glows dimly, as a pilot light.
const LAMPS = 18;
const LampBar = ({ label, lit, children }) => html`<div class="net"><span>${label}</span>
  <div class="lamps">${Array.from({ length: LAMPS }, (_, k) => html`<i class=${k < lit ? 'on' : k === 0 ? 'pilot' : ''}></i>`)}</div>
  <b>${children}</b></div>`;
// Network on a square-root scale to 1 Gb/s, so a stream's few megabits still show.
const NetBar = ({ label, value }) => html`<${LampBar} label=${label} lit=${value > 0.05 ? Math.max(1, Math.round(Math.sqrt(clamp(value / 1000)) * LAMPS)) : 0}>
  ${value < 1 ? html`${Math.round(value * 1000)}<small> kb/s</small>` : html`${value >= 10 ? r0(value) : value.toFixed(1)}<small> Mb/s</small>`}<//>`;
// GPU power draw against the most the card pulls.
const GPU_WATTS = 600;
const PowerBar = ({ value }) => html`<${LampBar} label="GPU" lit=${Math.round(clamp(value / GPU_WATTS) * LAMPS)}>${r0(value)}<small> W</small><//>`;

// The last hour as a film strip: one frame a minute, brighter is busier, red is flat out; an idle
// minute is a faint amber and a minute with no reading (the PC was off) stays dark.
function frameStyle(v) {
  if (v == null) return '';
  const f = clamp(v / 100);
  const col = f > 0.9 ? `rgb(232,${Math.round(96 - 30 * f)},40)` : `rgb(${Math.round(104 + 126 * f)},${Math.round(66 + 100 * f)},${Math.round(30 + 50 * f)})`;
  return `background:${col};opacity:${(0.5 + 0.5 * f).toFixed(2)}`;
}
function FilmStrip({ hour }) {
  const frames = [...Array(Math.max(0, 60 - hour.length)).fill(null), ...hour.slice(-60)];
  return html`<div class="film">${frames.map((v) => html`<i><b style=${frameStyle(v)}></b></i>`)}</div>
    <div class="ax"><span>60 min ago</span><span>45</span><span>30</span><span>15</span><span>now</span></div>`;
}

// ---------- the page ----------

// How hard the PC is working, 0 (idle) to 1 (flat out): GPU load, or its temperature if hotter.
const heatOf = (s) => Math.max(clamp(((s.gpuLoad ?? s.cpuLoad ?? 0) - 55) / 40), s.gpuTemp != null ? clamp((s.gpuTemp - 62) / 22) : 0);
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(' ')})`;

export function Stats() {
  const [g] = useLoad(() => get('/api/games').catch(() => null), []);
  const demo = route.params.demo === '1' || (g && !g.pc?.stats);
  const s = useStats(g?.pc?.stats, demo);
  const swipe = useRef(null);

  // The hour comes from the server, which records it whether or not this page is open.
  const [hour, setHour] = useState(null);
  useEffect(() => {
    if (demo) { setHour(demoHour()); return undefined; }
    setHour(g?.pc?.hour || null);
    const t = setInterval(() => get('/api/games').then((n) => setHour(n?.pc?.hour || null)).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, [g, demo]);

  // A VM's real processor clock, from the host the server runs on (see hostClock in games.mjs).
  const [host, setHost] = useState(null);
  useEffect(() => {
    if (demo || !g?.pc?.hostClock) return undefined;
    const read = () => get('/api/games/clock').then((c) => setHost(c || null)).catch(() => {});
    read();
    const t = setInterval(read, 5000);
    return () => clearInterval(t);
  }, [g, demo]);
  const cpuClock = s.cpuClock || host?.mhz;
  const coreClocks = demo ? s.cores.map((l) => 3200 + l * 14) : host?.cores || [];

  // Swipe right for Games.
  const down = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const st = swipe.current; swipe.current = null;
    if (st && e.clientX - st.x > 70 && Math.abs(e.clientX - st.x) > Math.abs(e.clientY - st.y)) go('games');
  };

  const has = (v) => v != null;
  const gpuPeak = usePeak(s.gpuLoad), cpuPeak = usePeak(s.cpuLoad);
  const heat = heatOf(s);
  const ramTotal = s.ramTotal ?? (has(s.ramUsed) && s.ramLoad > 0 ? s.ramUsed / (s.ramLoad / 100) : null);
  const busiest = s.cores.length ? Math.max(...s.cores) : null;
  const any = has(s.gpuLoad) || has(s.cpuLoad) || has(s.ramUsed) || has(s.vramUsed) || has(s.netDown) || has(s.netUp) || s.cores.length;
  const readout = (list) => html`<div class="sub">${list.filter(Boolean).map(([k, v]) => html`<div><b>${v}</b><span>${k}</span></div>`)}</div>`;
  const style = `--heat:${heat.toFixed(2)};--acc:${mix([184, 118, 58], [224, 88, 43], heat)};--edge:${mix([42, 28, 18], [90, 36, 20], heat)}`;

  return html`<main class="view stats-view dark" style=${style} onPointerDown=${down} onPointerUp=${up}>
    <${Header} title=${g?.pc?.name || 'Gaming PC'} kicker=${demo ? 'Demo numbers · set pc.stats in games.json' : null}>
      ${s.fps >= 1 && html`<span class="fps"><b>${r0(s.fps)}</b>fps${s.fpsLow >= 1 ? html`<small>1% low ${r0(s.fpsLow)}</small>` : ''}</span>`}
      ${heat >= 0.75 && html`<span class="chip dark-chip hot"><span class="dot"></span>Running hot</span>`}
      <span class="chip dark-chip"><span class=${`dot ${s.game ? 'on' : ''}`}></span>${s.game || 'Idle'}</span>
      <a href="#/games" class="chip dark-chip" onClick=${(e) => { e.preventDefault(); go('games'); }}><${Icon} name="left" size=${18} />Games</a>
    <//>
    ${!any ? html`<div class="empty" style="flex-grow:1;color:#C7B39E">${g?.pc?.stats ? `${g.pc.name || 'The PC'} is off. The gauges come back when it starts.` : 'No PC sensors yet. Add them under pc.stats in games.json.'}</div>` : html`
    <div class="st-row dials">
      ${has(s.gpuLoad) && html`<section class="tile big"><h3>GPU</h3><${Dial} id="g" value=${s.gpuLoad} peak=${gpuPeak} />
        ${readout([has(s.gpuTemp) && ['Temp', degF(s.gpuTemp)], has(s.gpuClock) && [has(s.gpuMemClock) ? 'Core' : 'Clock', `${r0(s.gpuClock)} MHz`], has(s.gpuMemClock) && ['Memory', `${r0(s.gpuMemClock)} MHz`]])}</section>`}
      ${has(s.cpuLoad) && html`<section class="tile big"><h3>CPU</h3><${Dial} id="c" value=${s.cpuLoad} peak=${cpuPeak} />
        ${readout([has(s.cpuTemp) && ['Temp', degF(s.cpuTemp)], cpuClock > 0 && ['Clock', `${r0(cpuClock)} MHz`], s.cores.length && ['Cores', s.cores.length], has(busiest) && ['Busiest', `${r0(busiest)}%`]])}</section>`}
      <section class="tile side">
        ${(has(s.ramUsed) || has(s.vramUsed)) && html`<h3>Memory</h3><div class="fuels">
          ${has(s.ramUsed) && html`<${Fuel} id="m" label="RAM" value=${s.ramUsed} max=${ramTotal}>${s.ramUsed.toFixed(1)}<small> ${ramTotal ? `/ ${r0(ramTotal)} ` : ''}GB</small><//>`}
          ${has(s.vramUsed) && html`<${Fuel} id="v" label="VRAM" value=${s.vramUsed} max=${s.vramTotal}>${s.vramUsed.toFixed(1)}<small> ${s.vramTotal ? `/ ${r0(s.vramTotal)} ` : ''}GB</small><//>`}
        </div>`}
        ${(has(s.netDown) || has(s.netUp)) && html`<h3>Network</h3>
          ${has(s.netDown) && html`<${NetBar} label="Down" value=${s.netDown} />`}
          ${has(s.netUp) && html`<${NetBar} label="Up" value=${s.netUp} />`}`}
        ${has(s.gpuPower) && html`<h3>Power</h3><${PowerBar} value=${s.gpuPower} />`}
      </section>
    </div>
    ${s.cores.length > 0 && html`<section class="tile"><h3>CPU cores <small>${coreClocks.length ? 'load, with each core\'s clock in GHz' : 'peak hold'}</small></h3><${CoreMeters} loads=${s.cores} clocks=${coreClocks} /></section>`}
    ${hour && html`<section class="tile strip"><h3>The last hour <small>one frame a minute · brighter is busier</small></h3><${FilmStrip} hour=${hour} /></section>`}`}
  </main>`;
}
