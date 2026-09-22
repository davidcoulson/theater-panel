// Gaming PC stats (MOCKUP): three layouts to choose from, fed by simulated sensors until the
// VM's HASS.Agent / LibreHardwareMonitor entities exist. #/stats?v=cockpit|hero|wall&mode=game|idle

import { useState, useEffect } from 'preact/hooks';
import { html, Header } from '../lib/ui.mjs';
import { route } from '../app.mjs';

// ---------- simulated sensors (random walks, 2 s updates like HASS.Agent) ----------
const HIST = 90;
function useSim(mode) {
  const game = mode !== 'idle';
  const base = game
    ? { fps: 118, low: 92, cpu: 46, cpuT: 71, gpu: 94, gpuT: 74, gpuClk: 2610, memClk: 10501, vram: 13.1, vramMax: 16, ram: 21.4, ramMax: 32, gpuW: 318, fan: 62, up: 3.1, down: 28, cores: 16 }
    : { fps: 0, low: 0, cpu: 4, cpuT: 42, gpu: 2, gpuT: 38, gpuClk: 210, memClk: 405, vram: 1.2, vramMax: 16, ram: 9.8, ramMax: 32, gpuW: 21, fan: 0, up: 0.2, down: 0.6, cores: 16 };
  // Start with 3 minutes of made-up history so the graphs aren't empty.
  const fake = (b, spread) => { let v = b; return Array.from({ length: HIST }, () => (v = Math.max(0, v + (b - v) * 0.25 + (Math.random() - 0.5) * spread))); };
  const [s, setS] = useState(() => ({ ...base, coreLoads: Array.from({ length: base.cores }, (_, i) => (i < 2 && game ? 88 : base.cpu)),
    hist: { fps: fake(base.fps, 14), gpuT: fake(base.gpuT, 1.5), cpuT: fake(base.cpuT, 2), gpu: fake(base.gpu, 6), cpu: fake(base.cpu, 12), gpuW: fake(base.gpuW, 18), down: fake(base.down, 10) } }));
  useEffect(() => {
    const walk = (v, b, spread, lo, hi) => Math.min(hi, Math.max(lo, v + (b - v) * 0.25 + (Math.random() - 0.5) * spread));
    const t = setInterval(() => setS((p) => {
      const n = {
        ...p,
        fps: game ? walk(p.fps, base.fps, 14, 60, 165) : 0,
        cpu: walk(p.cpu, base.cpu, game ? 12 : 3, 1, 100),
        gpu: walk(p.gpu, base.gpu, game ? 6 : 2, 0, 100),
        cpuT: walk(p.cpuT, base.cpuT, 2, 30, 95), gpuT: walk(p.gpuT, base.gpuT, 1.5, 30, 90),
        gpuClk: walk(p.gpuClk, base.gpuClk, game ? 40 : 30, 180, 2800),
        gpuW: walk(p.gpuW, base.gpuW, game ? 18 : 3, 10, 450),
        vram: walk(p.vram, base.vram, 0.2, 0.5, 16), ram: walk(p.ram, base.ram, 0.2, 4, 32),
        down: walk(p.down, base.down, game ? 10 : 0.5, 0, 120), up: walk(p.up, base.up, 1, 0, 40),
        coreLoads: p.coreLoads.map((c, i) => walk(c, i < 2 && game ? 88 : base.cpu, game ? 20 : 4, 0, 100)),
      };
      n.low = game ? Math.min(n.fps - 8, walk(p.low || 90, base.low, 10, 40, 160)) : 0;
      const push = (k) => [...p.hist[k], n[k]].slice(-HIST);
      n.hist = Object.fromEntries(Object.keys(p.hist).map((k) => [k, push(k)]));
      return n;
    }), 2000);
    return () => clearInterval(t);
  }, [mode]);
  return s;
}

// ---------- pieces ----------
const heat = (t) => (t >= 85 ? 'var(--hot)' : t >= 75 ? 'var(--warm)' : 'var(--cool)');
const r0 = (v) => Math.round(v);

function Gauge({ value, max = 100, size = 380, label, big, unit, sub, color = 'var(--gold)' }) {
  // 270° arc, value as the sweep.
  const r = size / 2 - 22, c = size / 2, sweep = 270, start = 135;
  const pt = (a) => [c + r * Math.cos((a * Math.PI) / 180), c + r * Math.sin((a * Math.PI) / 180)];
  const arc = (a0, a1) => { const [x0, y0] = pt(a0); const [x1, y1] = pt(a1); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  const f = Math.max(0.001, Math.min(1, value / max));
  return html`<div class="st-gauge" style=${`width:${size}px;height:${size}px`}>
    <svg viewBox=${`0 0 ${size} ${size}`} width=${size} height=${size}>
      <path d=${arc(start, start + sweep)} stroke="rgba(244,236,224,.10)" stroke-width="22" fill="none" stroke-linecap="round" />
      <path d=${arc(start, start + sweep * f)} stroke=${color} stroke-width="22" fill="none" stroke-linecap="round" style="transition:all 1.8s ease" />
    </svg>
    <div class="in"><div class="l">${label}</div><div class="n">${big}<small>${unit}</small></div><div class="s">${sub}</div></div>
  </div>`;
}

function Spark({ data, w = 300, h = 60, max, color = 'var(--gold)', fill = true }) {
  if (data.length < 2) return html`<svg width=${w} height=${h}></svg>`;
  const m = max || Math.max(...data) * 1.15 || 1;
  const pts = data.map((v, i) => [(i / (HIST - 1)) * w, h - (v / m) * h]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return html`<svg class="spark" width=${w} height=${h} viewBox=${`0 0 ${w} ${h}`} preserveAspectRatio="none">
    ${fill && html`<path d=${`${d} L${pts[pts.length - 1][0]} ${h} L${pts[0][0]} ${h} Z`} fill=${color} opacity=".14" />`}
    <path d=${d} stroke=${color} stroke-width="2.5" fill="none" /></svg>`;
}

function Bar({ label, value, max, text, color = 'var(--gold)' }) {
  return html`<div class="st-bar"><div class="t"><span>${label}</span><b>${text}</b></div><div class="b"><i style=${`width:${Math.min(100, (value / max) * 100)}%;background:${color}`}></i></div></div>`;
}

function Cores({ loads }) {
  return html`<div class="st-cores">${loads.map((l) => html`<i style=${`height:${Math.max(4, l)}%;background:${l > 85 ? 'var(--warm)' : 'var(--gold)'}`}></i>`)}</div>`;
}

// ---------- the three layouts ----------
function Cockpit({ s, game }) {
  return html`<div class="st cockpit">
    <${Gauge} label="CPU" value=${s.cpu} big=${r0(s.cpuT)} unit="°" sub=${`${r0(s.cpu)}% load`} color=${heat(s.cpuT)} />
    <div class="mid">
      ${game ? html`<div class="fps"><div class="l">FPS</div><div class="n">${r0(s.fps)}</div><div class="s">1% low ${r0(s.low)}</div></div>
        <${Spark} data=${s.hist.fps} w=${520} h=${110} max=${180} />`
        : html`<div class="fps idle"><div class="l">Idle</div><div class="n">${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div><div class="s">Unraid VM · up 3 d 4 h</div></div>`}
      <${Cores} loads=${s.coreLoads} />
    </div>
    <${Gauge} label="GPU" value=${s.gpu} big=${r0(s.gpuT)} unit="°" sub=${`${r0(s.gpu)}% · ${r0(s.gpuClk)} MHz`} color=${heat(s.gpuT)} />
    <div class="strip">
      <div><span>VRAM</span><b>${s.vram.toFixed(1)}<small>/${s.vramMax} GB</small></b></div>
      <div><span>RAM</span><b>${s.ram.toFixed(1)}<small>/${s.ramMax} GB</small></b></div>
      <div><span>GPU power</span><b>${r0(s.gpuW)}<small> W</small></b></div>
      <div><span>Mem clock</span><b>${r0(s.memClk)}<small> MHz</small></b></div>
      <div><span>Fans</span><b>${r0(s.fan)}<small>%</small></b></div>
      <div><span>Network</span><b>↓${r0(s.down)}<small> Mb/s</small></b></div>
    </div>
  </div>`;
}

function Hero({ s, game }) {
  const heroVal = game ? r0(s.fps) : r0(s.gpuT);
  return html`<div class="st hero">
    <div class="big">
      <div class="bg"><${Spark} data=${game ? s.hist.fps : s.hist.gpuT} w=${1000} h=${520} max=${game ? 180 : 100} /></div>
      <div class="l">${game ? 'Frames per second' : 'GPU temperature'}</div>
      <div class="n">${heroVal}<small>${game ? '' : '°'}</small></div>
      <div class="s">${game ? `1% low ${r0(s.low)} · avg ${r0(s.hist.fps.reduce((a, b) => a + b, 0) / Math.max(1, s.hist.fps.length))}` : 'Idle · nothing running'}</div>
    </div>
    <div class="col">
      ${[
        ['GPU', `${r0(s.gpu)}%`, `${r0(s.gpuT)}° · ${r0(s.gpuClk)} MHz`, s.gpu, 100, heat(s.gpuT), s.hist.gpu],
        ['CPU', `${r0(s.cpu)}%`, `${r0(s.cpuT)}°`, s.cpu, 100, heat(s.cpuT), s.hist.cpu],
        ['VRAM', `${s.vram.toFixed(1)} GB`, `of ${s.vramMax} GB`, s.vram, s.vramMax, 'var(--gold)', null],
        ['RAM', `${s.ram.toFixed(1)} GB`, `of ${s.ramMax} GB`, s.ram, s.ramMax, 'var(--gold)', null],
        ['Power', `${r0(s.gpuW)} W`, 'GPU board power', s.gpuW, 450, 'var(--gold)', s.hist.gpuW],
      ].map(([l, v, sub, val, max, col, hist]) => html`<div class="row">
        <div><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>
        ${hist ? html`<${Spark} data=${hist} w=${220} h=${56} max=${max} color=${col} />` : html`<div class="mini"><i style=${`width:${(val / max) * 100}%`}></i></div>`}
      </div>`)}
    </div>
  </div>`;
}

function Wall({ s, game }) {
  const panel = (title, value, sub, body, cls = '') => html`<section class=${`p ${cls}`}><div class="h"><span>${title}</span><b>${value}</b></div><div class="s">${sub}</div>${body}</section>`;
  return html`<div class=${`st wall ${game ? 'game' : ''}`}>
    ${panel('Frames', game ? r0(s.fps) : '—', game ? `1% low ${r0(s.low)}` : 'No game running', html`<${Spark} data=${s.hist.fps} w=${560} h=${120} max=${180} />`, 'frames')}
    ${panel('GPU', `${r0(s.gpu)}%`, `${r0(s.gpuT)}° · ${r0(s.gpuClk)} MHz · ${r0(s.gpuW)} W`, html`<${Spark} data=${s.hist.gpuT} w=${560} h=${120} max=${100} color=${heat(s.gpuT)} />`, 'gpu')}
    ${panel('CPU', `${r0(s.cpu)}%`, `${r0(s.cpuT)}° · 16 threads`, html`<${Cores} loads=${s.coreLoads} />`)}
    ${panel('Memory', `${s.ram.toFixed(1)} GB`, `VRAM ${s.vram.toFixed(1)} / ${s.vramMax} GB`, html`<div class="stack"><${Bar} label="RAM" value=${s.ram} max=${s.ramMax} text=${`${r0((s.ram / s.ramMax) * 100)}%`} /><${Bar} label="VRAM" value=${s.vram} max=${s.vramMax} text=${`${r0((s.vram / s.vramMax) * 100)}%`} /></div>`)}
    ${panel('Network', `↓ ${r0(s.down)} Mb/s`, `↑ ${s.up.toFixed(1)} Mb/s`, html`<${Spark} data=${s.hist.down} w=${400} h=${90} />`)}
    ${panel('Cooling', `${r0(s.fan)}%`, 'GPU fans', html`<div class="stack"><${Bar} label="CPU" value=${s.cpuT} max=${100} text=${`${r0(s.cpuT)}°`} color=${heat(s.cpuT)} /><${Bar} label="GPU" value=${s.gpuT} max=${100} text=${`${r0(s.gpuT)}°`} color=${heat(s.gpuT)} /></div>`)}
  </div>`;
}

const LAYOUTS = { cockpit: ['Cockpit', Cockpit], hero: ['Big number', Hero], wall: ['Telemetry wall', Wall] };

export function Stats() {
  const v = LAYOUTS[route.params.v] ? route.params.v : 'cockpit';
  const mode = route.params.mode === 'idle' ? 'idle' : 'game';
  const s = useSim(mode);
  const [name, View] = LAYOUTS[v];
  return html`<main class="view stats-view dark tx-suede">
    <${Header} title="Gaming PC" kicker=${`Mockup · ${name} · ${mode === 'game' ? 'In game' : 'Idle'}`}>
      <span class="chip dark-chip"><span class="dot on"></span>${mode === 'game' ? 'Cyberpunk 2077' : 'Idle'}</span>
    <//>
    <${View} s=${s} game=${mode === 'game'} />
  </main>`;
}
