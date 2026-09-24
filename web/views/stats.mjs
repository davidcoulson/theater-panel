// Gaming PC stats: six live panels (frames, GPU, CPU, memory, network, cooling) from the PC's
// Home Assistant sensors — LibreHardwareMonitor's integration or HASS.Agent, mapped to roles in
// games.json (pc.stats). Tap a panel to blow it up; swipe to go back. Swipe left/right moves
// between Games and Stats. #/stats?demo=1 fills it with made-up numbers to see the layout.

import { useState, useEffect, useRef } from 'preact/hooks';
import { html, Header, Icon } from '../lib/ui.mjs';
import { get, useStore, useLoad, runtime } from '../lib/api.mjs';
import { route, go } from '../app.mjs';

const HIST = 90;           // samples kept per metric (5 s each ≈ 7 minutes)
const SAMPLE = 5000;
const r0 = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const heat = (t) => (t >= 85 ? 'var(--hot)' : t >= 75 ? 'var(--warm)' : 'var(--cool)');

// ---------- values ----------

// Current numbers for every mapped role, plus a rolling history for the graphs.
function useStats(stats, demo) {
  // Only the mapped entities' raw states: the whole map is a new object on every HA update.
  const ids = Object.values(stats || {}).flat().filter((id) => typeof id === 'string');
  const states = useStore((s) => Object.fromEntries(ids.map((id) => [id, s.states[id]?.state])));
  const [hist, setHist] = useState({});
  const latest = useRef({});

  const num = (role) => {
    const id = stats?.[role];
    const v = id && Number(states[id]);
    return Number.isFinite(v) ? v : null;
  };
  const vals = demo ? demoValues() : {
    fps: num('fps'), fpsLow: num('fpsLow'),
    gpuLoad: num('gpuLoad'), gpuTemp: num('gpuTemp'), gpuClock: num('gpuClock'), gpuPower: num('gpuPower'), gpuFan: num('gpuFan'),
    cpuLoad: num('cpuLoad'), cpuTemp: num('cpuTemp'), cpuClock: num('cpuClock'),
    ramUsed: num('ramUsed'), ramTotal: num('ramTotal'), vramUsed: num('vramUsed'), vramTotal: num('vramTotal'),
    netDown: num('netDown'), netUp: num('netUp'),
    cores: (stats?.cores || []).map((id) => Number(states[id])).filter(Number.isFinite),
    game: gameName(states[stats?.game]),
    uptime: states[stats?.uptime],
  };
  latest.current = vals;

  // Demo mode starts with a few minutes of made-up history so the graphs aren't empty.
  useEffect(() => {
    if (!demo) return;
    const fake = (b, spread) => { let v = b; return Array.from({ length: HIST }, () => (v = Math.max(0, v + (b - v) * 0.25 + (Math.random() - 0.5) * spread))); };
    setHist({ fps: fake(118, 16), gpuLoad: fake(94, 8), gpuTemp: fake(74, 2), cpuLoad: fake(42, 14), cpuTemp: fake(71, 2), netDown: fake(28, 12), gpuPower: fake(318, 30), ramUsed: fake(21, 1), vramUsed: fake(13, 1) });
  }, [demo]);

  useEffect(() => {
    const tick = () => setHist((h) => {
      const next = { ...h };
      for (const k of ['fps', 'gpuLoad', 'gpuTemp', 'cpuLoad', 'cpuTemp', 'netDown', 'gpuPower', 'ramUsed', 'vramUsed']) {
        const v = latest.current[k];
        if (v != null) next[k] = [...(h[k] || []), v].slice(-HIST);
      }
      return next;
    });
    tick();
    const t = setInterval(tick, SAMPLE);
    return () => clearInterval(t);
  }, [demo]);

  return { ...vals, hist };
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
  const b = { fps: 118, fpsLow: 92, gpuLoad: 94, gpuTemp: 74, gpuClock: 2610, gpuPower: 318, gpuFan: 62, cpuLoad: 42, cpuTemp: 71, cpuClock: 4900, ramUsed: 21.4, ramTotal: 32, vramUsed: 13.1, vramTotal: 16, netDown: 28, netUp: 3.1 };
  demoState ??= { ...b, cores: Array.from({ length: 16 }, (_, i) => (i < 2 ? 88 : 40)) };
  const d = demoState;
  for (const k of Object.keys(b)) d[k] = walk(d[k], b[k], b[k] * 0.12, 0, b[k] * 2);
  d.cores = d.cores.map((c, i) => walk(c, i < 2 ? 88 : 40, 25, 0, 100));
  d.ramTotal = 32; d.vramTotal = 16;
  return { ...d, game: 'Cyberpunk 2077', uptime: null };
}

// ---------- drawing ----------

function Spark({ data = [], w = 560, h = 120, max, color = 'var(--gold)' }) {
  if (data.length < 2) return html`<div class="st-empty">waiting for data…</div>`;
  const m = max || Math.max(...data) * 1.15 || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - Math.min(1, v / m) * h]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return html`<svg class="spark" viewBox=${`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
    <path d=${`${d} L${w} ${h} L0 ${h} Z`} fill=${color} opacity=".14" />
    <path d=${d} stroke=${color} stroke-width="2.5" fill="none" /></svg>`;
}

const Cores = ({ loads }) => html`<div class="st-cores">${loads.map((l) => html`<i style=${`height:${Math.max(4, l)}%;background:${l > 85 ? 'var(--warm)' : 'var(--gold)'}`}></i>`)}</div>`;

const Bar = ({ label, value, max, text, color = 'var(--gold)' }) => html`<div class="st-bar">
  <div class="t"><span>${label}</span><b>${text}</b></div>
  <div class="b"><i style=${`width:${Math.min(100, (value / max) * 100)}%;background:${color}`}></i></div></div>`;

// ---------- the panels ----------

// Each panel: what it shows small, and what it becomes when blown up.
function panels(s) {
  const has = (v) => v != null;
  const out = [];
  if (has(s.fps)) out.push({
    id: 'frames', title: 'Frames', value: `${r0(s.fps)}`, unit: 'fps',
    sub: has(s.fpsLow) ? `1% low ${r0(s.fpsLow)}` : 'frames per second',
    hist: s.hist.fps, max: 180, big: true,
  });
  if (has(s.gpuLoad) || has(s.gpuTemp)) out.push({
    id: 'gpu', title: 'GPU', value: has(s.gpuLoad) ? `${r0(s.gpuLoad)}%` : `${r0(s.gpuTemp)}°`,
    sub: [has(s.gpuTemp) && `${r0(s.gpuTemp)}°`, has(s.gpuClock) && `${r0(s.gpuClock)} MHz`, has(s.gpuPower) && `${r0(s.gpuPower)} W`].filter(Boolean).join(' · '),
    hist: s.hist.gpuLoad || s.hist.gpuTemp, max: 100, color: has(s.gpuTemp) ? heat(s.gpuTemp) : undefined, big: true,
  });
  if (has(s.cpuLoad) || has(s.cpuTemp)) out.push({
    id: 'cpu', title: 'CPU', value: has(s.cpuLoad) ? `${r0(s.cpuLoad)}%` : `${r0(s.cpuTemp)}°`,
    sub: [has(s.cpuTemp) && `${r0(s.cpuTemp)}°`, has(s.cpuClock) && `${r0(s.cpuClock)} MHz`, s.cores.length && `${s.cores.length} cores`].filter(Boolean).join(' · '),
    hist: s.hist.cpuLoad || s.hist.cpuTemp, max: 100, color: has(s.cpuTemp) ? heat(s.cpuTemp) : undefined,
    body: s.cores.length ? html`<${Cores} loads=${s.cores} />` : null,
  });
  if (has(s.ramUsed) || has(s.vramUsed)) out.push({
    id: 'memory', title: 'Memory', value: has(s.ramUsed) ? `${s.ramUsed.toFixed(1)} GB` : `${s.vramUsed.toFixed(1)} GB`,
    sub: has(s.vramUsed) ? `VRAM ${s.vramUsed.toFixed(1)}${has(s.vramTotal) ? ` / ${r0(s.vramTotal)} GB` : ' GB'}` : 'system memory',
    hist: s.hist.ramUsed, max: s.ramTotal || undefined,
    body: html`<div class="stack">
      ${has(s.ramUsed) && has(s.ramTotal) && html`<${Bar} label="RAM" value=${s.ramUsed} max=${s.ramTotal} text=${`${r0((s.ramUsed / s.ramTotal) * 100)}%`} />`}
      ${has(s.vramUsed) && has(s.vramTotal) && html`<${Bar} label="VRAM" value=${s.vramUsed} max=${s.vramTotal} text=${`${r0((s.vramUsed / s.vramTotal) * 100)}%`} />`}
    </div>`,
  });
  if (has(s.netDown) || has(s.netUp)) out.push({
    id: 'network', title: 'Network', value: `↓ ${r0(s.netDown ?? 0)}`, unit: 'Mb/s',
    sub: has(s.netUp) ? `↑ ${s.netUp.toFixed(1)} Mb/s` : 'download',
    hist: s.hist.netDown,
  });
  if (has(s.gpuFan) || has(s.gpuTemp) || has(s.cpuTemp)) out.push({
    id: 'cooling', title: 'Cooling', value: has(s.gpuFan) ? `${r0(s.gpuFan)}%` : `${r0(s.gpuTemp ?? s.cpuTemp)}°`,
    sub: has(s.gpuFan) ? 'GPU fans' : 'temperatures',
    body: html`<div class="stack">
      ${has(s.cpuTemp) && html`<${Bar} label="CPU" value=${s.cpuTemp} max=${100} text=${`${r0(s.cpuTemp)}°`} color=${heat(s.cpuTemp)} />`}
      ${has(s.gpuTemp) && html`<${Bar} label="GPU" value=${s.gpuTemp} max=${100} text=${`${r0(s.gpuTemp)}°`} color=${heat(s.gpuTemp)} />`}
    </div>`,
  });
  return out;
}

// ---------- the page ----------

export function Stats() {
  const [g] = useLoad(() => get('/api/games').catch(() => null), []);
  const demo = route.params.demo === '1' || (g && !g.pc?.stats);
  const s = useStats(g?.pc?.stats, demo);
  const [open, setOpen] = useState(null);
  const swipe = useRef(null);

  // Swipe: left/right between Games and Stats, any swipe closes a blown-up panel.
  const down = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const st = swipe.current; swipe.current = null;
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.abs(dx) < 70 && Math.abs(dy) < 70) return;   // a tap, not a swipe
    if (open) { setOpen(null); return; }
    if (dx > 70 && Math.abs(dx) > Math.abs(dy)) go('games');
  };

  const list = panels(s);
  const shown = open ? list.filter((p) => p.id === open) : list;

  return html`<main class="view stats-view dark tx-suede" onPointerDown=${down} onPointerUp=${up}>
    <${Header} title=${g?.pc?.name || 'Gaming PC'} kicker=${demo ? 'Demo numbers · set pc.stats in games.json' : 'Live from Home Assistant'}>
      <span class="chip dark-chip"><span class=${`dot ${s.game ? 'on' : ''}`}></span>${s.game || 'Idle'}</span>
      <a href="#/games" class="chip dark-chip" onClick=${(e) => { e.preventDefault(); go('games'); }}><${Icon} name="left" size=${18} />Games</a>
    <//>
    ${!list.length ? html`<div class="empty" style="flex-grow:1;color:#C7B39E">No PC sensors yet. Add them under pc.stats in games.json.</div>`
      : html`<div class=${`st wall ${open ? 'one' : ''}`}>
        ${shown.map((p) => html`<${Panel} p=${p} open=${Boolean(open)} onClick=${() => setOpen(open ? null : p.id)} />`)}
      </div>`}
    ${open && html`<div class="st-hint">Swipe to go back</div>`}
  </main>`;
}

function Panel({ p, open, onClick }) {
  return html`<section class=${`p ${p.big ? 'wide' : ''} ${open ? 'blown' : ''}`} role="button" tabindex="0" onClick=${onClick}>
    <div class="h"><span>${p.title}</span><b>${p.value}${p.unit && html`<small>${p.unit}</small>`}</b></div>
    <div class="s">${p.sub}</div>
    ${p.body}
    ${p.hist && html`<${Spark} data=${p.hist} max=${p.max} color=${p.color} h=${open ? 320 : 120} />`}
  </section>`;
}
