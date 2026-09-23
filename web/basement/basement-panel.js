// Basement panel: a Home Assistant custom card that is the whole screen of the 5" (1280x800)
// wall panel by the basement stairs. Two pages - Zones (a dial per light group: brightness on
// the left sweep, warmth on the right) and Moods (the accent strip's effects) - with the theater
// panel's rail down the left, glowing with whatever the accents are doing.
//
// Everything is authored at 426.67 x 266.67 and zoomed to the panel, so a 40px row here is
// about 1 cm on the wall. Built from the theater panel's pieces (see tools/basement-sync.mjs).
//
//   type: custom:basement-panel-card
//   zones:                       # optional; these are the defaults
//     - { name: Front,  entity: light.basement_front_center_lights }
//     - { name: Center, entity: light.basement_center_lights }
//     ...
//   accent: light.basement_accent_lights
//   accent_speed: input_number.basement_accent_speed

import { h, render } from './vendor/preact.mjs';
import { useState, useEffect, useRef } from './vendor/preact-hooks.mjs';
import { html, Icon } from './lib/ui.mjs';
import { EffectPreview, RailGlow, byMood } from './lib/effects.mjs';

const BASE = new URL('.', import.meta.url).href;
const W = 426.67, H = 266.67;

const DEFAULTS = {
  zones: [
    { name: 'Front', entity: 'light.basement_front_center_lights' },
    { name: 'Center', entity: 'light.basement_center_lights' },
    { name: 'Back', entity: 'light.basement_back_center_lights' },
    { name: 'Alley', entity: 'light.basement_alley_lights' },
    { name: 'Stairs', entity: 'light.basement_basement_stairs' },
    { name: 'Accents', entity: 'light.basement_accent_lights' },
  ],
  accent: 'light.basement_accent_lights',
  accent_speed: 'input_number.basement_accent_speed',
};

// ---------- light helpers ----------
const st = (hass, id) => hass?.states?.[id];
const isOn = (s) => s?.state === 'on';
const pctOf = (s) => (isOn(s) ? Math.round(((s.attributes?.brightness || 0) / 255) * 100) : 0);
const dims = (s) => (s?.attributes?.supported_color_modes || []).some((m) => m !== 'onoff');
const hasTemp = (s) => (s?.attributes?.supported_color_modes || []).includes('color_temp');
const kelvinRange = (s) => [s?.attributes?.min_color_temp_kelvin || 2700, s?.attributes?.max_color_temp_kelvin || 6500];
const kelvinOf = (s) => s?.attributes?.color_temp_kelvin || kelvinRange(s)[0];
// 0 at the coolest end of the sweep (top), 1 at the warmest (bottom)
const warmOf = (s) => { const [lo, hi] = kelvinRange(s); return hi === lo ? 1 : 1 - (kelvinOf(s) - lo) / (hi - lo); };
const clock = () => { const d = new Date(); let hh = d.getHours() % 12 || 12; return `${hh}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ---------- dial geometry (from the mockup) ----------
const CX = 108, CY = 100, R = 76;
const B0 = 135, B1 = 265, W0 = 275, W1 = 405;   // degrees clockwise from 3 o'clock; 405 = 45
const pt = (deg, r = R) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];
const arc = (a0, a1, r = R) => { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
const len = (a0, a1) => ((a1 - a0) * Math.PI / 180) * R;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (stops, t) => {
  const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1))), f = t * (stops.length - 1) - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
};
const WARM = ['#D7E6F0', '#F1D9A8', '#E39A3E'], BRIGHT = ['#8F4E1C', '#F0B76A'];
const Pin = ({ deg, fill }) => { const [x, y] = pt(deg); return html`<g transform=${`translate(${x} ${y}) rotate(${deg - 90})`}>
  <path d="M0 -17 C5.5 -8 7.5 -1 7.5 3 A7.5 7.5 0 0 1 -7.5 3 C-7.5 -1 -5.5 -8 0 -17z" fill=${fill} stroke="#FFF8EE" stroke-width="1.6" /></g>`; };
const Tick = ({ a, label }) => { const [x0, y0] = pt(a, R + 13), [x1, y1] = pt(a, R + 19), [lx, ly] = pt(a, R + 29); return html`
  <line x1=${x0} y1=${y0} x2=${x1} y2=${y1} stroke="rgba(244,236,224,.45)" stroke-width="1.5" />
  ${label && html`<text x=${lx} y=${ly} class="tk" text-anchor="middle" dominant-baseline="middle">${label}</text>`}`; };

// Where a touch lands on the ring: which sweep, and how far along it (0..1). Null off the ring.
function hit(x, y) {
  const dx = x - CX, dy = y - CY, r = Math.hypot(dx, dy);
  if (r < R - 26 || r > R + 30) return null;
  let a = (Math.atan2(dy, dx) * 180) / Math.PI; if (a < 0) a += 360;       // 0..360 from 3 o'clock
  if (a >= B0 - 6 && a <= B1 + 4) return { sweep: 'bright', t: Math.max(0, Math.min(1, (a - B0) / (B1 - B0))) };
  const w = a < 90 ? a + 360 : a;                                            // the right sweep crosses 0
  if (w >= W0 - 4 && w <= W1 + 6) return { sweep: 'warm', t: Math.max(0, Math.min(1, (w - W0) / (W1 - W0))) };
  return null;
}

// ---------- the dial ----------
function Dial({ hass, zone }) {
  const s = st(hass, zone.entity);
  const on = isOn(s), dim = dims(s), temp = hasTemp(s);
  const [drag, setDrag] = useState(null);           // { sweep, t } while a finger is on the ring
  const svg = useRef();
  const last = useRef(0);
  const pct = drag?.sweep === 'bright' ? Math.round(drag.t * 100) : pctOf(s);
  const warm = drag?.sweep === 'warm' ? drag.t : warmOf(s);
  const [lo, hi] = kelvinRange(s);
  const kelvin = Math.round(hi - warm * (hi - lo));

  const send = (d, final) => {
    const now = performance.now();
    if (!final && now - last.current < 220) return;
    last.current = now;
    if (d.sweep === 'bright') {
      const p = Math.round(d.t * 100);
      hass.callService('light', p ? 'turn_on' : 'turn_off', { entity_id: zone.entity, ...(p ? { brightness_pct: p } : {}) });
    } else hass.callService('light', 'turn_on', { entity_id: zone.entity, color_temp_kelvin: Math.round(hi - d.t * (hi - lo)) });
  };
  const local = (e) => { const b = svg.current.getBoundingClientRect(); return [((e.clientX - b.left) / b.width) * 216, ((e.clientY - b.top) / b.height) * 192]; };
  const down = (e) => {
    const d = hit(...local(e));
    if (!d || (d.sweep === 'bright' && !dim) || (d.sweep === 'warm' && !temp)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(d); send(d, false);
  };
  const move = (e) => {
    if (!drag) return;
    const d = hit(...local(e));
    if (!d || d.sweep !== drag.sweep) return;
    setDrag(d); send(d, false);
  };
  const up = () => { if (drag) { send(drag, true); setTimeout(() => setDrag(null), 400); } };
  const step = (n) => hass.callService('light', 'turn_on', { entity_id: zone.entity, brightness_step_pct: n });
  const toggle = () => hass.callService('light', 'toggle', { entity_id: zone.entity });

  return html`<div class="dialcard">
    <button type="button" class=${`pwr ${on ? 'on' : ''}`} onClick=${toggle} aria-label="Power"><${Icon} name="power" size=${20} w=${2.5} /></button>
    <svg ref=${svg} width="216" height="192" viewBox="0 0 216 192" class="dial" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
      <defs>
        <linearGradient id="warm" gradientUnits="userSpaceOnUse" x1=${pt(W0)[0]} y1=${pt(W0)[1]} x2=${pt(W1)[0]} y2=${pt(W1)[1]}>
          <stop offset="0" stop-color="#D7E6F0" /><stop offset=".5" stop-color="#F1D9A8" /><stop offset="1" stop-color="#E39A3E" /></linearGradient>
        <linearGradient id="bright" gradientUnits="userSpaceOnUse" x1=${pt(B0)[0]} y1=${pt(B0)[1]} x2=${pt(B1)[0]} y2=${pt(B1)[1]}>
          <stop offset="0" stop-color="#8F4E1C" /><stop offset="1" stop-color="#F0B76A" /></linearGradient>
      </defs>
      ${dim && html`
        <path d=${arc(B0, B1)} fill="none" stroke="#E3A865" stroke-width="28" stroke-linecap="round" opacity=".10" />
        <path d=${arc(B0, B1)} fill="none" stroke="rgba(244,236,224,.14)" stroke-width="13" stroke-linecap="round" />
        <path d=${arc(B0, B1)} fill="none" stroke="url(#bright)" stroke-width="13" stroke-linecap="round" stroke-dasharray=${`${(len(B0, B1) * pct) / 100} ${len(B0, B1) * 2}`} />
        <${Tick} a=${B0} label="0" /><${Tick} a=${(B0 + B1) / 2} label="50" /><${Tick} a=${B1} />
        <${Pin} deg=${B0 + ((B1 - B0) * pct) / 100} fill=${mix(BRIGHT, pct / 100)} />`}
      ${temp && html`
        <path d=${arc(W0, W1)} fill="none" stroke="#F1D9A8" stroke-width="28" stroke-linecap="round" opacity=".10" />
        <path d=${arc(W0, W1)} fill="none" stroke="url(#warm)" stroke-width="13" stroke-linecap="round" opacity=".35" />
        <path d=${arc(W0, W1)} fill="none" stroke="url(#warm)" stroke-width="13" stroke-linecap="round" stroke-dasharray=${`${len(W0, W1) * warm} ${len(W0, W1) * 2}`} />
        <${Tick} a=${W0} /><${Tick} a=${(W0 + W1) / 2} label=${String(Math.round((lo + hi) / 2 / 100) * 100)} /><${Tick} a=${W1} label=${String(lo)} />
        <${Pin} deg=${W0 + (W1 - W0) * warm} fill=${mix(WARM, warm)} />`}
      ${!dim && html`<path d=${arc(B0, W1)} fill="none" stroke="rgba(244,236,224,.10)" stroke-width="13" stroke-linecap="round" />`}
      ${dim
        ? html`<text x=${CX + 2} y=${CY + 16} class="big" text-anchor="middle">${on ? pct : 'OFF'}${on && html`<tspan class="pc">%</tspan>`}</text>`
        : html`<text x=${CX} y=${CY + 16} class="big" text-anchor="middle">${s?.state === 'unavailable' ? '—' : on ? 'ON' : 'OFF'}</text>`}
      ${temp && on && html`<text x=${CX} y=${CY + 36} class="kv" text-anchor="middle">${kelvin} K</text>`}
      ${!temp && dim && html`<text x=${CX} y=${CY + 36} class="kv" text-anchor="middle">${zone.name}</text>`}
      ${dim && html`
        <g class="stp" onClick=${() => step(-10)}><circle cx=${CX - 30} cy=${CY + 68} r="15" /><text x=${CX - 30} y=${CY + 69} text-anchor="middle" dominant-baseline="middle">−</text></g>
        <g class="stp" onClick=${() => step(10)}><circle cx=${CX + 30} cy=${CY + 68} r="15" /><text x=${CX + 30} y=${CY + 69} text-anchor="middle" dominant-baseline="middle">+</text></g>`}
    </svg>
  </div>`;
}

// ---------- pages ----------
function Zones({ hass, config, sel, setSel }) {
  const zone = config.zones[sel] || config.zones[0];
  return html`<main class="page">
    <div class="zlist">
      ${config.zones.map((z, i) => {
        const s = st(hass, z.entity);
        const v = s?.state === 'unavailable' ? '—' : dims(s) ? (isOn(s) ? `${pctOf(s)}%` : 'Off') : isOn(s) ? 'On' : 'Off';
        return html`<button type="button" class=${`zpick ${i === sel ? 'on' : ''} ${isOn(s) ? 'lit' : ''}`} onClick=${() => setSel(i)}>${z.name}<span class="v">${v}</span></button>`;
      })}
    </div>
    <${Dial} hass=${hass} zone=${zone} key=${zone.entity} />
  </main>`;
}

function Moods({ hass, config }) {
  const s = st(hass, config.accent);
  const on = isOn(s), pct = pctOf(s);
  const current = on ? s?.attributes?.effect : null;
  const list = (s?.attributes?.effect_list || []).filter((e) => e && e !== 'None');
  const groups = byMood(list);
  const pick = (effect) => hass.callService('light', 'turn_on', { entity_id: config.accent, effect, ...(on ? {} : { brightness_pct: 60 }) });
  const bar = useRef();
  const setLevel = (e) => {
    const b = bar.current.getBoundingClientRect();
    const p = Math.round(Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * 100);
    hass.callService('light', p ? 'turn_on' : 'turn_off', { entity_id: config.accent, ...(p ? { brightness_pct: p } : {}) });
  };
  return html`<main class="page moods">
    <div class="mhead">
      <div ref=${bar} class=${`lrow ${on ? 'on' : ''}`} onPointerUp=${setLevel}>
        <div class="fill" style=${`width:${pct}%`}></div>
        <${Icon} name="sun" size=${18} /><span class="nm">Accents</span><span class="val">${on ? `${pct}%` : 'OFF'}</span>
      </div>
      <button type="button" class=${`pwr static ${on ? 'on' : ''}`} onClick=${() => hass.callService('light', 'toggle', { entity_id: config.accent })} aria-label="Accents power"><${Icon} name="power" size=${20} w=${2.5} /></button>
    </div>
    <div class="mscroll">
      ${groups.map((g) => html`<div class="mgroup">
        <div class="mlabel">${g.name}</div>
        <div class="mgrid">
          ${g.effects.map((name) => html`<button type="button" class=${`mtile ${name === current ? 'sel' : ''}`} onClick=${() => pick(name)}>
            <${EffectPreview} name=${name} h=${40} round=${8} />
            <span class="mn">${name}</span></button>`)}
        </div>
      </div>`)}
      ${!list.length && html`<div class="empty">No effects on ${config.accent}</div>`}
    </div>
  </main>`;
}

function App({ hass, config }) {
  const [page, setPage] = useState(config.page || 'zones');
  const [sel, setSel] = useState(0);
  const [now, setNow] = useState(clock());
  useEffect(() => { const t = setInterval(() => setNow(clock()), 15000); return () => clearInterval(t); }, []);
  const acc = st(hass, config.accent);
  const speedEnt = st(hass, config.accent_speed);
  const speed = Math.max(0.05, Math.min(1, (Number(speedEnt?.state) || 128) / 255));
  const bright = Math.max(0, Math.min(1, (acc?.attributes?.brightness || 0) / 255));
  return html`<div class="stage">
    <nav class="rail">
      <${RailGlow} name=${isOn(acc) ? acc.attributes?.effect : null} speed=${speed} opacity=${0.15 + 0.5 * bright} />
      ${[['zones', 'Zones', 'bulb'], ['moods', 'Moods', 'moon']].map(([id, label, icon]) => html`
        <button type="button" class=${page === id ? 'on' : ''} onClick=${() => setPage(id)}><${Icon} name=${icon} size=${22} />${label}</button>`)}
      <div class="grow"></div>
      <div class="clock">${now}</div>
    </nav>
    ${page === 'moods' ? html`<${Moods} hass=${hass} config=${config} />` : html`<${Zones} hass=${hass} config=${config} sel=${sel} setSel=${setSel} />`}
  </div>`;
}

// ---------- styles ----------
const FONT_FACES = `
@font-face { font-family: 'Big Shoulders Display'; font-weight: 700; font-display: swap; src: url(${BASE}fonts/big-shoulders-display-latin-700-normal.woff2) format('woff2'); }
@font-face { font-family: 'Big Shoulders Display'; font-weight: 800; font-display: swap; src: url(${BASE}fonts/big-shoulders-display-latin-800-normal.woff2) format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 500; font-display: swap; src: url(${BASE}fonts/ibm-plex-sans-latin-500-normal.woff2) format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 600; font-display: swap; src: url(${BASE}fonts/ibm-plex-sans-latin-600-normal.woff2) format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 700; font-display: swap; src: url(${BASE}fonts/ibm-plex-sans-latin-700-normal.woff2) format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-weight: 600; font-display: swap; src: url(${BASE}fonts/ibm-plex-mono-latin-600-normal.woff2) format('woff2'); }`;

const STYLE = `
:host { display: block; width: 100%; height: 100vh; height: 100dvh; background: #0d0907; overflow: hidden; }
* { box-sizing: border-box; }
.wrap { width: 100%; height: 100%; display: grid; place-items: center; }
.stage { width: ${W}px; height: ${H}px; display: flex; overflow: hidden; flex-shrink: 0;
  --card: #F4F0E8; --line: #D6CCC0; --ink: #25170F; --muted: #5F5249; --track: #E4DCD2; --acc: #8F4E1C; --gold: #E3A865; --choc: #3A2419;
  --disp: 'Big Shoulders Display', 'Arial Narrow', sans-serif; --sans: 'IBM Plex Sans', system-ui, sans-serif; --mono: 'IBM Plex Mono', ui-monospace, monospace;
  font-family: var(--sans); color: var(--ink); -webkit-font-smoothing: antialiased; user-select: none; -webkit-tap-highlight-color: transparent;
  background: #D3CBC2 url(${BASE}assets/plaster.jpg) center / cover; }
button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; }
canvas { display: block; } canvas.fx { width: 100%; }

.rail { position: relative; width: 62px; flex-shrink: 0; padding: 10px 6px; display: flex; flex-direction: column; align-items: center; gap: 6px; z-index: 2;
  border-right: 2px solid #F1EDE4; box-shadow: 1px 0 0 #C9BFB2, 2px 0 7px rgba(20,10,5,.35);
  background: linear-gradient(rgba(28,24,20,.34), rgba(28,24,20,.34)), #6F6760 url(${BASE}assets/planks-rail.jpg) center / cover; }
.rail-glow { position: absolute; inset: -8px 0; width: 100%; height: calc(100% + 16px); mix-blend-mode: screen; filter: blur(6px) saturate(1.5); pointer-events: none; z-index: 0; }
.rail > *:not(.rail-glow) { position: relative; z-index: 1; }
.rail button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; width: 50px; height: 52px; border-radius: 13px;
  color: #FFF8EE; text-shadow: 0 1px 2px rgba(0,0,0,.75); font-size: 11px; font-weight: 700; letter-spacing: .3px; }
.rail button.on { background: rgba(143,78,28,.9); color: #fff; text-shadow: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 2px 5px rgba(0,0,0,.35); }
.rail .grow { flex-grow: 1; }
.rail .clock { font-family: var(--mono); font-size: 13px; font-weight: 600; color: #FFF8EE; text-shadow: 0 1px 2px rgba(0,0,0,.7); }

.page { flex-grow: 1; min-width: 0; height: ${H}px; padding: 9px 10px 10px; display: grid; grid-template-columns: 104px 1fr; gap: 9px; }
.zlist { display: flex; flex-direction: column; gap: 5px; min-height: 0; }
.zpick { flex-grow: 1; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 10px; border-radius: 12px; min-height: 0;
  background: var(--card); border: 1px solid var(--line); font-size: 15px; font-weight: 700; text-align: left; }
.zpick.on { background: var(--choc); border-color: var(--choc); color: #F4ECE0; }
.zpick .v { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--muted); }
.zpick.lit .v { color: #8F4E1C; } .zpick.on .v { color: var(--gold); }

.dialcard { position: relative; min-width: 0; overflow: hidden; border-radius: 14px; border: 1px solid #241710; padding: 6px; display: flex; align-items: center; justify-content: center;
  background: #3A2419 url(${BASE}assets/suede.jpg) center / cover; color: #F4ECE0; box-shadow: 0 1px 0 rgba(255,255,255,.08) inset, 0 3px 8px rgba(58,36,25,.2); }
.dial { overflow: visible; flex-shrink: 0; touch-action: none; }
.dial .tk { fill: rgba(244,236,224,.55); font-size: 8px; font-family: var(--mono); font-weight: 600; }
.dial .big { fill: #F4ECE0; font-size: 60px; font-family: var(--disp); font-weight: 800; }
.dial .big .pc { font-size: 22px; fill: #E3A865; }
.dial .kv { fill: rgba(244,236,224,.7); font-size: 12px; font-family: var(--mono); font-weight: 600; }
.dial .stp { cursor: pointer; } .dial .stp circle { fill: rgba(0,0,0,.35); stroke: rgba(227,168,101,.5); stroke-width: 1.5; }
.dial .stp text { fill: #E3A865; font-size: 22px; font-family: var(--sans); font-weight: 600; }
.pwr { position: absolute; top: 8px; right: 8px; width: 36px; height: 36px; border-radius: 18px; display: grid; place-items: center;
  background: rgba(0,0,0,.35); border: 1.5px solid rgba(244,236,224,.3); color: rgba(244,236,224,.7); z-index: 1; }
.pwr.on { background: var(--acc); border-color: var(--gold); color: #fff; box-shadow: 0 0 0 3px rgba(227,168,101,.22); }
.pwr.static { position: static; flex-shrink: 0; }

.moods { grid-template-columns: 1fr; grid-template-rows: auto 1fr; gap: 8px; }
.mhead { display: flex; gap: 8px; align-items: center; }
.lrow { position: relative; flex-grow: 1; height: 36px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); overflow: hidden;
  display: flex; align-items: center; gap: 8px; padding: 0 12px; touch-action: none; }
.lrow .fill { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #C07A34, #EDBD7C); }
.lrow > :not(.fill) { position: relative; }
.lrow .nm { font-family: var(--disp); font-weight: 800; font-size: 20px; text-transform: uppercase; line-height: 1; flex-grow: 1; }
.lrow .val { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--muted); } .lrow.on .val { color: #4A3520; }
.mscroll { overflow-y: auto; min-height: 0; padding-right: 2px; scrollbar-width: none; } .mscroll::-webkit-scrollbar { display: none; }
.mgroup { margin-bottom: 8px; }
.mlabel { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); margin: 2px 0 5px 2px; }
.mgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.mtile { border-radius: 12px; border: 1px solid #241710; padding: 6px 7px; display: flex; flex-direction: column; gap: 5px; text-align: left; min-width: 0;
  background: #3A2419 url(${BASE}assets/suede.jpg) center / cover; color: #E9DCCB; }
.mtile.sel { border-color: var(--gold); box-shadow: inset 0 0 0 2px var(--gold); }
.mtile .mn { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.empty { padding: 20px; color: var(--muted); font-size: 14px; }`;

// ---------- the card ----------
const TRACK_ATTRS = ['brightness', 'color_temp_kelvin', 'effect', 'supported_color_modes'];
class BasementPanelCard extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    this._ids = [...this._config.zones.map((z) => z.entity), this._config.accent, this._config.accent_speed];
    this._paint();
  }
  set hass(hass) {
    // HA hands us every state change in the house; only redraw for the lights we show.
    const sig = this._ids.map((id) => { const s = hass.states[id]; return s ? `${s.state}|${TRACK_ATTRS.map((a) => JSON.stringify(s.attributes[a])).join(',')}` : '?'; }).join(';');
    this._hass = hass;
    if (sig === this._sig) return;
    this._sig = sig;
    this._paint();
  }
  getCardSize() { return 12; }
  connectedCallback() {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = STYLE; root.appendChild(style);
      this._wrap = document.createElement('div'); this._wrap.className = 'wrap'; root.appendChild(this._wrap);
      if (!document.getElementById('basement-panel-fonts')) {   // @font-face has to live in the document
        const f = document.createElement('style'); f.id = 'basement-panel-fonts'; f.textContent = FONT_FACES; document.head.appendChild(f);
      }
      this._ro = new ResizeObserver(() => this._fit()); this._ro.observe(this);
    }
    this._fit(); this._paint();
  }
  disconnectedCallback() { this._ro?.disconnect(); }
  // Zoom to the panel's height and let the stage take the panel's width, so a 16:9 screen gets
  // a wider dial card instead of bars down the sides; a narrower screen is fitted by width.
  _fit() {
    const stage = this._wrap?.querySelector('.stage'); if (!stage) return;
    const z = Math.min(this.clientWidth / W, this.clientHeight / H) || 1;
    stage.style.zoom = String(z);
    stage.style.width = `${Math.max(W, this.clientWidth / z)}px`;
  }
  _paint() {
    if (!this._wrap || !this._config) return;
    render(h(App, { hass: this._hass || { states: {}, callService() {} }, config: this._config }), this._wrap);
    this._fit();
  }
}
customElements.define('basement-panel-card', BasementPanelCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'basement-panel-card', name: 'Basement panel', description: 'Full-screen lights panel for the basement stairs (zones dial + accent moods).' });
