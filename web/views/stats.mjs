// Gaming PC stats as a bank of instruments: glowing needle dials for GPU and CPU load, each with
// its last minute drawn inside, fuel gauges for memory, lamps for the network and GPU draw, LED meters for the cores,
// and the last hour as a film strip. The page's accent warms from amber to red as the GPU heats
// up, and steam rises behind the instruments. Numbers come from the PC's Home Assistant
// sensors (LibreHardwareMonitor's integration or HASS.Agent), mapped to roles in games.json
// (pc.stats); the hour is recorded by the server. Swipe right for Games.
// #/stats?demo=1 fills it with made-up numbers to see the layout.

import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { html, Icon } from '../lib/ui.mjs';
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
  const names = useStore((s) => [stats?.gpuLoad, stats?.cpuLoad].map((id) => s.states[id]?.attributes?.friendly_name || '').join('\n')).split('\n');
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
    stream: streamAddress(states[stats?.stream]),
    gpuName: partName(names[0]), cpuName: partName(names[1]),
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

// The part's model, from its load sensor's name in Home Assistant: LibreHardwareMonitor's are like
// "[PC-NAME] NVIDIA GeForce RTX 4090 GPU Core Load" and "[PC-NAME] AMD Ryzen 9 7950X 16-Cores CPU
// Total Load". Anything that doesn't look like that gives no model.
function partName(friendly) {
  const m = /^(?:\[[^\]]*\]\s*)?(.+?)\s+(?:GPU|CPU)\s+(?:Core|Total)\b/.exec(friendly || '');
  // Without the maker, which the model already says: "GeForce RTX 4090", "Threadripper PRO 5995WX".
  return m ? m[1].replace(/\s+\d+-Cores?$/i, '').replace(/^(?:NVIDIA|AMD|Intel|ATI)(?:\(R\))?\s+/i, '').replace(/^Ryzen\s+(?=Threadripper)/i, '') : null;
}

// The streaming sensor gives the Moonlight client's address, or nothing.
const streamAddress = (v) => (v && !['unknown', 'unavailable', ''].includes(String(v).toLowerCase()) ? String(v) : null);

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
  return { ...d, game: 'Cyberpunk 2077', uptime: null, gpuName: 'GeForce RTX 4090', cpuName: 'Ryzen 7 9800X3D' };
}

const demoHour = () => Array.from({ length: 360 }, (_, k) => k / 6 | 0).map((i) => (i < 6 ? 6 : i < 9 ? 55 : i < 22 ? 78 + (i * 7) % 14 : i < 26 ? 32 : i < 44 ? 86 + (i * 5) % 13 : i < 47 ? 22 : 80 + (i * 11) % 19));

// The last minute of a value, sampled every 1.5 s, for a dial's history line and range band.
const TRAIL = 40;
function useTrail(value) {
  const [trail, setTrail] = useState([]);
  const now = useRef(value); now.current = value;
  useEffect(() => {
    const t = setInterval(() => { if (now.current != null) setTrail((h) => [...h, now.current].slice(-TRAIL)); }, 1500);
    return () => clearInterval(t);
  }, []);
  return trail;
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
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(' ')})`;
const pt = (cx, cy, r, deg) => { const a = deg * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
const arc = (cx, cy, r, a0, a1) => { const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
const AMBER = '#E3A865', RED = '#E0432B', DIM = '#5A4636', TRACK = '#241811', PALE = '#F4ECE0';

// A load dial, 0-100, on a dark face. Load is drawn in cool colours - a glowing teal band fills
// round to the reading, with a soft light where it ends; the ticks it has passed light up; a faint
// inner band marks the last minute's range - so that heat can have the warm ones: a thin ring round
// the outside is a fixed scale from warm (yellow) through orange to hot (red), lit up to a glowing
// bead that shows where the part is (heat is 0-1) and dim beyond it. Under the hub, lit softly
// from behind, are the reading and the last minute as a line. The needle, band, bead and both
// glows move with CSS transitions. Drawn on a 400 grid, scaled down a little so the bead has room
// outside the ring.
const SWEEP = 135, DIAL_TOP = 85;
const TEAL = '#5DBFAE', ICE = '#DDF7F0';
const dialAngle = (v) => -SWEEP + 2 * SWEEP * clamp(v / 100);
const heatColour = (h) => (h < 0.5 ? mix([236, 210, 130], [240, 140, 44], h * 2) : mix([240, 140, 44], [224, 60, 36], (h - 0.5) * 2));
const HEAT_STEPS = 45;
function Dial({ id, value, heat, trail = [], label = 'Load' }) {
  const c = 200, rim = 175;
  const v = clamp(value / 100) * 100;
  const full = arc(c, c, rim, -SWEEP, SWEEP);
  const lo = trail.length ? Math.min(...trail, v) : v, hi = trail.length ? Math.max(...trail, v) : v;
  // The line is stretched to the range it covers (at least 12 points of load), so small changes show.
  const mid = (lo + hi) / 2, span = Math.max(12, hi - lo);
  const line = trail.length > 1 ? trail.map((t, i) => `${i ? 'L' : 'M'}${(c - 76 + (i / (trail.length - 1)) * 152).toFixed(1)} ${(c + 144 - ((t - mid) / span) * 24).toFixed(1)}`).join(' ') : null;
  // The ring beyond the bead is dimmed, so where the bead is reads at a glance.
  const scale = Array.from({ length: HEAT_STEPS }, (_, i) => html`<path
    d=${arc(c, c, 196, dialAngle((i / HEAT_STEPS) * 100), dialAngle(((i + 1) / HEAT_STEPS) * 100) + 0.6)} stroke=${heatColour((i + 0.5) / HEAT_STEPS)} stroke-width="7" fill="none" opacity=${(i + 0.5) / HEAT_STEPS <= heat ? 1 : 0.35} />`);
  return html`<svg class="dial" viewBox="0 0 400 400" role="img" aria-label=${`${label} ${r0(value)} percent`}>
    <defs>
      <radialGradient id=${`dk${id}`} cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#2A1D15" /><stop offset="1" stop-color="#120B07" /></radialGradient>
      <radialGradient id=${`gl${id}`}><stop offset="0" stop-color=${ICE} stop-opacity=".9" /><stop offset=".35" stop-color=${TEAL} stop-opacity=".45" /><stop offset="1" stop-color=${TEAL} stop-opacity="0" /></radialGradient>
      <radialGradient id=${`gv${id}`}><stop offset="0" stop-color=${TEAL} stop-opacity=".3" /><stop offset="1" stop-color=${TEAL} stop-opacity="0" /></radialGradient>
      ${heat != null && html`<radialGradient id=${`gh${id}`}><stop offset="0" stop-color="#FFF5DC" stop-opacity=".8" /><stop offset=".3" stop-color=${heatColour(heat)} stop-opacity=".45" /><stop offset="1" stop-color=${heatColour(heat)} stop-opacity="0" /></radialGradient>`}
      <linearGradient id=${`ld${id}`} gradientUnits="userSpaceOnUse" x1="50" y1="350" x2="350" y2="60"><stop offset="0" stop-color="#3C9C8E" /><stop offset=".6" stop-color="#7FD6C4" /><stop offset="1" stop-color=${ICE} /></linearGradient>
    </defs>
    <g transform="translate(200 200) scale(.935) translate(-200 -200)">
    <circle cx=${c} cy=${c} r="188" fill=${`url(#dk${id})`} stroke="#3A2A1D" stroke-width="1.5" />
    <ellipse cx=${c} cy=${c + 66} rx="92" ry="58" fill=${`url(#gv${id})`} />
    ${v >= 0.5 && html`<g class="turn" style=${`transform:rotate(${dialAngle(value)}deg)`}><circle cx=${c} cy=${c - rim} r="68" fill=${`url(#gl${id})`} /></g>`}
    ${heat != null && html`<g class="turn" style=${`transform:rotate(${dialAngle(heat * 100)}deg)`}><circle cx=${c} cy=${c - 196} r="60" fill=${`url(#gh${id})`} /></g>`}
    ${heat != null && scale}
    <path d=${full} stroke=${TRACK} stroke-width="11" fill="none" stroke-linecap="round" />
    ${v >= 0.5 && html`<path class="band glow" d=${full} pathLength="100" stroke-dasharray=${`${v} 100`} stroke=${`url(#ld${id})`} stroke-width="24" fill="none" stroke-linecap="round" />
      <path class="band" d=${full} pathLength="100" stroke-dasharray=${`${v} 100`} stroke=${`url(#ld${id})`} stroke-width="11" fill="none" stroke-linecap="round" />`}
    ${hi - lo >= 1 && html`<path d=${arc(c, c, 140, dialAngle(lo), dialAngle(hi))} stroke=${TEAL} stroke-opacity=".26" stroke-width="12" fill="none" />`}
    ${Array.from({ length: 51 }, (_, i) => {
      const t = i * 2, major = i % 5 === 0, a = dialAngle(t), col = t > v ? DIM : t >= DIAL_TOP ? ICE : TEAL;
      const [x0, y0] = pt(c, c, 163, a), [x1, y1] = pt(c, c, major ? 148 : 155, a), [tx, ty] = pt(c, c, 125, a);
      return html`<line x1=${x0} y1=${y0} x2=${x1} y2=${y1} stroke=${col} stroke-width=${major ? 2.8 : 1.4} stroke-linecap="round" />
        ${t % 20 === 0 && html`<text x=${tx} y=${ty} class="num" fill="#9C8672">${t}</text>`}`;
    })}
    <g class="turn needle" style=${`transform:rotate(${dialAngle(value)}deg)`}>
      <line x1=${c} y1=${c + 22} x2=${c} y2=${c - 144} stroke=${ICE} stroke-opacity=".16" stroke-width="16" stroke-linecap="round" />
      <line x1=${c} y1=${c + 22} x2=${c} y2=${c - 144} stroke=${ICE} stroke-opacity=".3" stroke-width="8" stroke-linecap="round" />
      <line x1=${c} y1=${c + 22} x2=${c} y2=${c - 144} stroke=${PALE} stroke-width="3.6" stroke-linecap="round" />
    </g>
    <circle cx=${c} cy=${c} r="10.5" fill="#17100B" stroke=${TEAL} stroke-width="2.6" />
    ${heat != null && html`<g class="turn" style=${`transform:rotate(${dialAngle(heat * 100)}deg)`}>
      <circle class="halo" cx=${c} cy=${c - 196} r="14" fill=${heatColour(heat)} opacity=".35" />
      <circle cx=${c} cy=${c - 196} r="7.5" fill="#FFF5DC" stroke=${heatColour(heat)} stroke-width="3" /></g>`}
    <text x=${c} y=${c + 70} class="val">${r0(value)}<tspan class="unit">%</tspan></text>
    <line x1=${c - 76} y1=${c + 160} x2=${c + 76} y2=${c + 160} stroke=${TRACK} stroke-width="1.5" />
    ${line && html`<path d=${line} stroke=${TEAL} stroke-width="2.4" fill="none" stroke-linejoin="round" stroke-linecap="round" />`}
    </g>
  </svg>`;
}

// A fuel gauge in the same dress: a scale from empty to full, amber warming to red, bright up to the
// reading and dim beyond it,
// on a 0-100 % scale whose ticks light up to the reading, with a glowing needle and a soft light
// where the band ends; the reading sits under it, lit softly.
// The memory scale: amber, warming to red over the last stretch.
const FUEL_STEPS = 30;
const fuelColour = (t) => (t < 0.7 ? mix([227, 168, 101], [232, 140, 60], t / 0.7) : mix([232, 140, 60], [224, 67, 43], (t - 0.7) / 0.3));
function Fuel({ label, value, max, children }) {
  const id = `f${label}`;
  const w = 260, h = 150, cx = w / 2, cy = 134, r = 92, HALF = 75;
  const f = max > 0 ? clamp(value / max) : 0, ang = (x) => -HALF + 2 * HALF * x;
  const full = arc(cx, cy, r, -HALF, HALF), col = fuelColour(f);
  return html`<figure class="fuel">
    <svg viewBox=${`0 0 ${w} ${h}`} aria-hidden="true">
      <defs><radialGradient id=${`g${id}`}><stop offset="0" stop-color="#FFF2DC" stop-opacity=".85" /><stop offset=".35" stop-color=${col} stop-opacity=".45" /><stop offset="1" stop-color=${col} stop-opacity="0" /></radialGradient></defs>
      <rect x="1" y="1" width=${w - 2} height=${h - 2} rx="18" fill="#17100B" stroke="#3A2A1D" stroke-width="2" />
      ${f > 0.005 && html`<g class="turn" style=${`transform-origin:${cx}px ${cy}px;transform:rotate(${ang(f)}deg)`}><circle cx=${cx} cy=${cy - r} r="46" fill=${`url(#g${id})`} /></g>`}
      ${f > 0.005 && html`<path class="band glow" d=${full} pathLength="100" stroke-dasharray=${`${f * 100} 100`} stroke=${col} stroke-width="22" fill="none" stroke-linecap="round" />`}
      ${Array.from({ length: FUEL_STEPS }, (_, i) => html`<path d=${arc(cx, cy, r, ang(i / FUEL_STEPS), ang((i + 1) / FUEL_STEPS) + 0.6)}
        stroke=${fuelColour((i + 0.5) / FUEL_STEPS)} stroke-width="10" fill="none" opacity=${(i + 0.5) / FUEL_STEPS <= f ? 1 : 0.3} />`)}
      ${Array.from({ length: 11 }, (_, i) => {
        const t = i / 10, major = i % 5 === 0, a = ang(t), on = t <= f + 0.001;
        const [x0, y0] = pt(cx, cy, r - 12, a), [x1, y1] = pt(cx, cy, r - (major ? 24 : 19), a), [tx, ty] = pt(cx, cy, r - 38, a);
        return html`<line x1=${x0} y1=${y0} x2=${x1} y2=${y1} stroke=${on ? (t >= 0.875 ? RED : AMBER) : DIM} stroke-width=${major ? 2.6 : 1.4} stroke-linecap="round" />
          ${major && html`<text x=${tx} y=${ty} class="num" fill=${t >= 0.875 ? '#E0674A' : '#9C8672'}>${i * 10}</text>`}`;
      })}
      <text x=${cx} y="26" class="lbl">${label}</text>
      ${max > 0 && html`<g class="turn needle" style=${`transform-origin:${cx}px ${cy}px;transform:rotate(${ang(f)}deg)`}>
        <line x1=${cx} y1=${cy} x2=${cx} y2=${cy - r + 16} stroke=${col} stroke-opacity=".18" stroke-width="14" stroke-linecap="round" />
        <line x1=${cx} y1=${cy} x2=${cx} y2=${cy - r + 16} stroke=${col} stroke-opacity=".35" stroke-width="7" stroke-linecap="round" />
        <line x1=${cx} y1=${cy} x2=${cx} y2=${cy - r + 16} stroke=${PALE} stroke-width="3.2" stroke-linecap="round" /></g>`}
      <circle cx=${cx} cy=${cy} r="8" fill="#17100B" stroke=${AMBER} stroke-width="2.4" />
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
    })}</div><span>${clocks[i] > 0 ? html`${(clocks[i] / 1000).toFixed(1)}<small> GHz</small>` : i + 1}</span></div>`)}</div>`;
}

// A row of lamps with its reading. With nothing lit the first lamp glows dimly, as a pilot light.
const LAMPS = 18;
// A glowing bar lights its lamps softly, the last lit one brightest, and lights its reading.
const LampBar = ({ label, lit, glow = false, children }) => html`<div class=${`net ${glow ? 'glow' : ''}`}><span>${label}</span>
  <div class="lamps">${Array.from({ length: LAMPS }, (_, k) => html`<i class=${k < lit ? (k === lit - 1 ? 'on tip' : 'on') : k === 0 ? 'pilot' : ''}></i>`)}</div>
  <b>${children}</b></div>`;
// Power draw as a glowing band against the most the part pulls: the graphics card's, and the whole processor's as
// the host measures it.
const GPU_WATTS = 600, CPU_WATTS = 350;
const PowerBar = ({ label, value, max }) => {
  const f = clamp(value / max);
  return html`<div class="pbar"><span>${label}</span>
    <div class="track"><i class="fill" style=${`width:${(f * 100).toFixed(1)}%`}></i></div>
    <b>${r0(value)}<small> W</small></b></div>`;
};
// Network as one glowing bar like the power bars, in a cool tone: traffic both ways together, on a
// square-root scale to 1 Gb/s so a stream's few megabits still show.
const NetBar = ({ value }) => html`<div class="pbar net"><span>Net</span>
  <div class="track">${value > 0.05 && html`<i class="fill" style=${`width:${(Math.sqrt(clamp(value / 1000)) * 100).toFixed(1)}%`}></i>`}</div>
  <b>${rate(value)}</b></div>`;
// The water pump as a bar in the dials' teal, against a D5's full speed.
const PUMP_RPM = 4800;
const PumpBar = ({ rpm }) => html`<div class="pbar pump"><span>Pump</span>
  <div class="track"><i class="fill" style=${`width:${(clamp(rpm / PUMP_RPM) * 100).toFixed(1)}%`}></i></div>
  <b>${rpm}<small> rpm</small></b></div>`;
// The loop's water temperature in °F, from cool (77 °F) to hot (113 °F), in the heat ring's colours.
const WATER_F = [77, 113];
const WaterBar = ({ c }) => {
  const f = c * 9 / 5 + 32, t = clamp((f - WATER_F[0]) / (WATER_F[1] - WATER_F[0]));
  return html`<div class="pbar water" style=${`--hc:${heatColour(t)}`}><span>Water</span>
    <div class="track"><i class="fill" style=${`width:${Math.max(3, t * 100).toFixed(1)}%`}></i></div>
    <b>${Math.round(f)}<small> °F</small></b></div>`;
};
// Network as a line of text: megabits, or kilobits when under one.
const rate = (v) => (v < 1 ? html`${Math.round(v * 1000)}<small> kb/s</small>` : html`${v >= 10 ? r0(v) : v.toFixed(1)}<small> Mb/s</small>`);

// The PC's recent load as a film strip of 60 frames: brighter is busier, red is flat out; an idle
// frame is a faint amber and one with no reading (the PC was off) stays dark. The server keeps a
// sample every ten seconds for an hour. A strip that has only just started shows ten seconds a
// frame, so it fills in ten minutes; as the recording grows each frame covers more, up to a
// minute a frame for the whole hour.
function frameStyle(v) {
  if (v == null) return '';
  const f = clamp(v / 100);
  const col = f > 0.9 ? `rgb(232,${Math.round(96 - 30 * f)},40)` : `rgb(${Math.round(104 + 126 * f)},${Math.round(66 + 100 * f)},${Math.round(30 + 50 * f)})`;
  return `background:${col};opacity:${(0.5 + 0.5 * f).toFixed(2)}`;
}
const FRAMES = 60;
function FilmStrip({ samples }) {
  const first = samples.findIndex((v) => v != null);
  const live = first < 0 ? [] : samples.slice(first);          // the recording, from its first reading
  const per = Math.min(6, Math.max(1, Math.ceil(live.length / FRAMES)));   // samples in a frame
  const shown = live.slice(-FRAMES * per);
  const pad = FRAMES * per - shown.length;
  const frames = Array.from({ length: FRAMES }, (_, f) => {
    const vals = shown.slice(Math.max(0, f * per - pad), Math.max(0, (f + 1) * per - pad)).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  const minutes = per * 10, mark = (f) => `${+(minutes * f).toFixed(1)}`;
  return html`<h3>${per === 6 ? 'The last hour' : `The last ${minutes} minutes`} <small>${per === 6 ? 'one frame a minute' : `one frame every ${per * 10} seconds`} · brighter is busier</small></h3>
    <div class="film">${frames.map((v) => html`<i><b style=${frameStyle(v)}></b></i>`)}</div>
    <div class="ax"><span>${minutes} min ago</span><span>${mark(0.75)}</span><span>${mark(0.5)}</span><span>${mark(0.25)}</span><span>now</span></div>`;
}

// Steam behind the instruments once the PC is working: a few dozen soft puffs that rise, swell and
// fade, drawn on a small canvas stretched over the page so they cost almost nothing. The hotter
// the PC runs, the more of them, the faster they rise and the thicker they are. Off when cool.
const STEAM_W = 240, STEAM_H = 135;
let puff = null;   // the soft round sprite, made once
function puffSprite() {
  if (puff) return puff;
  puff = document.createElement('canvas'); puff.width = puff.height = 64;
  const c = puff.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(236,228,218,.55)'); g.addColorStop(0.5, 'rgba(226,216,204,.2)'); g.addColorStop(1, 'rgba(220,210,200,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return puff;
}
function Steam({ heat }) {
  const ref = useRef(null);
  const level = useRef(heat); level.current = heat;
  const lit = heat > 0;
  useEffect(() => {
    if (!lit) return undefined;
    const ctx = ref.current.getContext('2d'), sprite = puffSprite();
    const puffs = [];
    let started = false;
    const t = setInterval(() => {
      const l = level.current, want = 4 + 52 * l;
      // The first frame starts with the air already full, each puff part-way through its rise.
      for (let n = 0, most = started ? 3 : want; n < most && puffs.length < want; n++) {
        const p = { x: Math.random() * STEAM_W, y: STEAM_H + 12, vy: -(0.5 + Math.random() * 0.8) * (0.5 + l), r: 10 + Math.random() * 16, age: 0, life: 130 + Math.random() * 130, seed: Math.random() * 9 };
        if (!started) { p.age = Math.floor(Math.random() * p.life * 0.8); p.y += p.vy * p.age; p.r += 0.07 * p.age; }
        puffs.push(p);
      }
      started = true;
      ctx.clearRect(0, 0, STEAM_W, STEAM_H);
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.age++; p.y += p.vy; p.x += Math.sin(p.age * 0.05 + p.seed) * 0.25; p.r += 0.07;
        if (p.age > p.life || p.y < -40) { puffs.splice(i, 1); continue; }
        ctx.globalAlpha = (0.3 + 0.5 * l) * (1 - p.age / p.life) * Math.min(1, p.age / 25);
        ctx.drawImage(sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
    }, 50);
    return () => clearInterval(t);
  }, [lit]);
  return html`<canvas class="steam" ref=${ref} width=${STEAM_W} height=${STEAM_H} style=${`opacity:${lit ? 1 : 0}`} aria-hidden="true"></canvas>`;
}

// ---------- the page ----------

// How hot the PC is running, 0 to 1: the GPU's temperature from 100 °F to 135 °F (it climbs and
// cools slowly, so the steam builds and lingers like the real thing). Without a temperature
// sensor, load from 50% to 90% stands in.
const warmth = (c, fromF, toF) => (c != null ? clamp((c * 9 / 5 + 32 - fromF) / (toF - fromF)) : null);
const heatOf = (s) => (s.gpuTemp != null ? clamp((s.gpuTemp * 9 / 5 + 32 - 100) / 35) : clamp(((s.gpuLoad ?? s.cpuLoad ?? 0) - 50) / 40));

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
    const t = setInterval(() => get('/api/games').then((n) => setHour(n?.pc?.hour || null)).catch(() => {}), 10000);
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
  const cpuWatts = demo ? 96 + s.cpuLoad : host?.watts;
  const pump = demo ? 2700 : host?.pump;
  const water = demo ? 33.5 : host?.water;
  const cpuClock = s.cpuClock || host?.mhz, cpuTemp = s.cpuTemp > 0 ? s.cpuTemp : demo ? s.cpuTemp : host?.temp;
  const coreClocks = demo ? s.cores.map((l) => 3200 + l * 14) : host?.cores || [];

  // Swipe right for Games.
  const down = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const st = swipe.current; swipe.current = null;
    if (st && e.clientX - st.x > 70 && Math.abs(e.clientX - st.x) > Math.abs(e.clientY - st.y)) go('games');
  };

  const has = (v) => v != null;
  // Steam's word on what is running: the game's proper name and art (the sensor only knows the program).
  const playing = demo ? { name: 'Cyberpunk 2077', header: '/img/steam/1091500/header.jpg' } : (s.game || s.fps > 0) ? g?.pc?.playing : null;
  const streamingTo = s.stream ? (g?.pc?.streamClients?.[s.stream] || s.stream) : null;
  // The card's own name (the sensor only knows the chip) can be set as pc.gpuName, the CPU's as pc.cpuName.
  const gpuName = g?.pc?.gpuName || s.gpuName, cpuName = g?.pc?.cpuName || s.cpuName;
  const gpuTrail = useTrail(s.gpuLoad), cpuTrail = useTrail(s.cpuLoad);
  const heat = heatOf(s);
  const ramTotal = s.ramTotal ?? (has(s.ramUsed) && s.ramLoad > 0 ? s.ramUsed / (s.ramLoad / 100) : null);
  const busiest = s.cores.length ? Math.max(...s.cores) : null;
  const any = has(s.gpuLoad) || has(s.cpuLoad) || has(s.ramUsed) || has(s.vramUsed) || has(s.netDown) || has(s.netUp) || s.cores.length;
  const readout = (list) => html`<div class="sub">${list.filter(Boolean).map(([k, v]) => html`<div><b>${v}</b><span>${k}</span></div>`)}</div>`;
  const style = `--heat:${heat.toFixed(2)};--acc:${mix([184, 118, 58], [224, 88, 43], heat)};--edge:${mix([42, 28, 18], [90, 36, 20], heat)}`;

  return html`<main class="view stats-view dark" style=${style} onPointerDown=${down} onPointerUp=${up}>
    <${Steam} heat=${heat} />
    <header class="top">
      <div class="title">
        <div><h1>${g?.pc?.name || 'Gaming PC'}</h1>
          <div class=${`playing ${s.game || playing ? 'on' : ''}`}>${demo ? 'Demo numbers · ' : ''}${playing?.name || s.game || 'Idle'}${streamingTo ? ` · streaming to ${streamingTo}` : ''}</div></div>
        ${playing && html`<img class="art" src=${playing.header} alt="" />`}
      </div>
      <div class="right">
      ${s.fps >= 1 && html`<span class="fps"><b>${r0(s.fps)}</b>fps${s.fpsLow >= 1 ? html`<small>1% low ${r0(s.fpsLow)}</small>` : ''}</span>`}
      <a href="#/games" class="chip dark-chip" onClick=${(e) => { e.preventDefault(); go('games'); }}><${Icon} name="left" size=${18} />Games</a>
      </div>
    </header>
    ${!any ? html`<div class="empty" style="flex-grow:1;color:#C7B39E">${g?.pc?.stats ? `${g.pc.name || 'The PC'} is off. The gauges come back when it starts.` : 'No PC sensors yet. Add them under pc.stats in games.json.'}</div>` : html`
    <div class="st-row dials">
      ${has(s.cpuLoad) && html`<section class="tile big"><h3 class="lead">CPU${cpuName && html`<small>${cpuName}</small>`}</h3><${Dial} id="c" value=${s.cpuLoad} heat=${warmth(cpuTemp, 125, 175)} trail=${cpuTrail} />
        ${readout([cpuClock > 0 && ['Clock', `${(cpuClock / 1000).toFixed(1)} GHz`], s.cores.length && ['Cores', s.cores.length], has(busiest) && ['Busiest', `${r0(busiest)}%`]])}</section>`}
      ${has(s.gpuLoad) && html`<section class="tile big"><h3 class="lead">GPU${gpuName && html`<small>${gpuName}</small>`}</h3><${Dial} id="g" value=${s.gpuLoad} heat=${warmth(s.gpuTemp, 100, 135)} trail=${gpuTrail} />
        ${readout([has(s.gpuClock) && [has(s.gpuMemClock) ? 'Core' : 'Clock', `${r0(s.gpuClock)} MHz`], has(s.gpuMemClock) && ['Memory', `${r0(s.gpuMemClock)} MHz`]])}</section>`}
      <section class="tile side">
        ${(has(s.ramUsed) || has(s.vramUsed)) && html`<h3 class="lead">Memory</h3><div class="fuels">
          ${has(s.ramUsed) && html`<${Fuel} label="RAM" value=${s.ramUsed} max=${ramTotal}>${s.ramUsed.toFixed(1)}<small> ${ramTotal ? `/ ${r0(ramTotal)} ` : ''}GB</small><//>`}
          ${has(s.vramUsed) && html`<${Fuel} label="VRAM" value=${s.vramUsed} max=${s.vramTotal}>${s.vramUsed.toFixed(1)}<small> ${s.vramTotal ? `/ ${r0(s.vramTotal)} ` : ''}GB</small><//>`}
        </div>`}
        ${(has(s.gpuPower) || has(cpuWatts)) && html`<h3>Power ${has(s.gpuPower) && has(cpuWatts) && html`<small>${r0(s.gpuPower + cpuWatts)} W in all</small>`}</h3>
          ${has(cpuWatts) && html`<${PowerBar} label="CPU" value=${cpuWatts} max=${CPU_WATTS} />`}
          ${has(s.gpuPower) && html`<${PowerBar} label="GPU" value=${s.gpuPower} max=${GPU_WATTS} />`}`}
        ${(has(s.netDown) || has(s.netUp)) && html`<${NetBar} value=${(s.netDown || 0) + (s.netUp || 0)} />`}
        ${pump > 0 && html`<${PumpBar} rpm=${pump} />`}
        ${water > 0 && html`<${WaterBar} c=${water} />`}
      </section>
    </div>
    ${s.cores.length > 0 && html`<section class="tile"><h3>CPU cores</h3><${CoreMeters} loads=${s.cores} clocks=${coreClocks} /></section>`}
    ${hour && html`<section class="tile strip"><${FilmStrip} samples=${hour} /></section>`}`}
  </main>`;
}
