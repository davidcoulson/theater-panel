// The soundbar: volume, the listening modes, the EQ mixer, the rear speakers and calibration,
// all through the JBL integration's entities (server/actions.mjs, "soundbar"). The sheet draws
// whatever Home Assistant knows; an entity the bar has not reported yet shows as waiting.

import { useState, useEffect } from 'preact/hooks';
import { html, Icon } from '../lib/ui.mjs';
import { act, useStore, useEntity, toast } from '../lib/api.mjs';

const BANDS = ['125', '250', '500', '1k', '2k', '4k', '8k'];
const CUSTOM = ['Low', 'Mid', 'High'];
const known = (e) => e && !['unknown', 'unavailable'].includes(e.state);

function useNumber(id) {
  const e = useEntity(id);
  return { e, value: known(e) ? Number(e.state) : null, min: Number(e?.attributes?.min ?? -6), max: Number(e?.attributes?.max ?? 6), step: Number(e?.attributes?.step ?? 1) };
}

export function SoundSheet({ onClose }) {
  const sb = useStore((s) => s.entities.soundbar);
  const knobs = useStore((s) => s.soundbar) || {};
  const states = useStore((s) => s.states);
  const volume = useNumber(sb?.volume);
  const night = useEntity(sb?.night);
  const pure = useEntity(sb?.pureVoice);
  const smart = useEntity(sb?.smart);
  const power = useEntity(sb?.power);
  const preset = useEntity(sb?.preset);
  const [pending, setPending] = useState({});          // sliders being dragged: id -> value
  const [calibrating, setCalibrating] = useState(0);
  useEffect(() => { if (!calibrating) return; const t = setTimeout(() => setCalibrating((n) => n - 1), 1000); return () => clearTimeout(t); }, [calibrating]);
  // THX: five seconds to sit down, then the Deep Note on the theater speaker.
  const [thx, setThx] = useState(0);
  useEffect(() => {
    if (!thx) return;
    if (thx === 1) { act({ action: 'thx' }).then((r) => { if (r) toast('The audience is listening'); }); setThx(0); return; }
    const t = setTimeout(() => setThx((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [thx]);
  if (!sb) return null;

  const sound = (body, note) => act({ action: 'soundbar', ...body }).then((r) => { if (r && note) toast(note); });
  const on = (e) => e?.state === 'on';
  const lateNight = on(night) && on(pure);
  const bandNumbers = sb.bands.map((id) => useNumber(id));
  const customNumbers = sb.custom.map((id) => useNumber(id));
  const points = [
    ...bandNumbers.map((n, i) => ({ id: sb.bands[i], label: BANDS[i], value: n.value, min: n.min, max: n.max, step: n.step, group: 0, onSet: (v) => sound({ cmd: 'band', index: i, value: v }) })),
    ...customNumbers.map((n, i) => ({ id: sb.custom[i], label: CUSTOM[i], value: n.value, min: n.min, max: n.max, step: n.step, group: 1, onSet: (v) => sound({ cmd: 'custom', index: i, value: v }) })),
  ];
  const rears = (sb.rears || []).map((r) => ({ ...r, battery: states[r.battery], charging: states[r.charging], docked: states[r.docked] }));
  const anyReported = Object.values(states).some((e) => e?.entity_id?.includes(sb.prefix));

  return html`<div class="mystery-sheet sound" role="dialog" aria-label="Sound">
    <div class="h">
      <div><div class="eyebrow">${anyReported ? (on(power) ? 'On' : 'Standing by') : 'Waiting for the bar'}</div><div class="t">Sound</div></div>
      <button type="button" class="icon-btn" style="width:46px;height:46px;background:rgba(0,0,0,.25)" aria-label="Close" onClick=${onClose}><${Icon} name="x" color="#F4F0E8" /></button>
    </div>
    ${!anyReported && html`<p class="hint">Home Assistant has not reported the soundbar yet. Once the JBL integration is set up and the name on the settings page matches, everything here comes alive.</p>`}
    <div class="body">
      <section class="volume">
        <button type="button" class="dbtn" aria-label="Volume down" onClick=${() => sound({ cmd: 'vol_down' })}><${Icon} name="volm" size=${36} w=${1.8} /></button>
        <div class="dial">
          <input class="range" type="range" min="0" max="100" step="1" value=${pending.volume ?? volume.value ?? 0} disabled=${volume.value == null}
            onInput=${(e) => setPending({ ...pending, volume: Number(e.target.value) })}
            onChange=${(e) => { const n = Number(e.target.value); setPending((p) => { const q = { ...p }; delete q.volume; return q; }); sound({ cmd: 'volume', value: n }); }} />
          <div class="n mono">${pending.volume ?? volume.value ?? '–'}</div>
        </div>
        <button type="button" class="dbtn" aria-label="Volume up" onClick=${() => sound({ cmd: 'vol_up' })}><${Icon} name="volp" size=${36} w=${1.8} /></button>
        <button type="button" class="dbtn" aria-label="Mute" onClick=${() => sound({ cmd: 'mute' })}><${Icon} name="mute" size=${32} w=${1.8} /><span class="s">Mute</span></button>
      </section>

      <section>
        <div class="lbl">Listening</div>
        <div class="chips">
          <button type="button" class="filter" aria-pressed=${lateNight ? 'true' : 'false'} onClick=${() => sound({ cmd: 'late_night', on: !lateNight }, lateNight ? 'Late night off' : 'Late night: quieter, clearer voices')}><${Icon} name="moon" size=${18} />Late night</button>
          <button type="button" class="filter" aria-pressed=${on(night) ? 'true' : 'false'} onClick=${() => sound({ cmd: 'night', on: !on(night) })}>Night mode</button>
          <button type="button" class="filter" aria-pressed=${on(pure) ? 'true' : 'false'} onClick=${() => sound({ cmd: 'purevoice', on: !on(pure) })}>PureVoice</button>
          <button type="button" class="filter" aria-pressed=${on(smart) ? 'true' : 'false'} onClick=${() => sound({ cmd: 'smart', on: !on(smart) })}>Smart mode</button>
          <button type="button" class="filter" onClick=${() => sound({ cmd: 'bass' }, 'Bass level stepped')}>Bass level</button>
          <button type="button" class="filter" onClick=${() => sound({ cmd: 'rear' }, 'Rear level stepped')}>Rear level</button>
          <button type="button" class="filter" onClick=${() => sound({ cmd: 'atmos' }, 'Atmos level stepped')}>Atmos level</button>
        </div>
        <p class="hint">Bass, Rear and Atmos step through the bar's levels the way its remote does; the bar shows the level on its display.</p>
      </section>

      <section>
        <div class="lbl">Equaliser</div>
        ${preset?.attributes?.options?.length > 0 && html`<div class="chips">${preset.attributes.options.map((o) => html`<button type="button" class="filter" aria-pressed=${preset.state === o ? 'true' : 'false'} onClick=${() => sound({ cmd: 'preset', option: o })}>${o}</button>`)}</div>`}
        <${Eq} points=${points} pending=${pending} setPending=${setPending} />
        <p class="hint">Drag a dot, or tap where it should be. Seven bands on the left are the graphic EQ; the three on the right are the bar's Custom preset.</p>
      </section>

      <section class="rears-cal">
        <div>
          <div class="lbl">Rear speakers</div>
          <div class="chips">${rears.map((r) => html`<span class=${`filter ${known(r.docked) && r.docked.state === 'off' ? 'warn' : ''}`} key=${r.channel}>
            ${r.channel[0].toUpperCase() + r.channel.slice(1)} · ${known(r.battery) ? `${Math.round(Number(r.battery.state))}%` : '–'}${known(r.charging) && r.charging.state === 'on' ? ' · charging' : ''}${known(r.docked) ? (r.docked.state === 'on' ? ' · docked' : ' · off its dock') : ''}</span>`)}</div>
        </div>
        ${knobs.thx && html`<div>
          <div class="lbl">THX</div>
          ${thx > 0
            ? html`<div class="cal"><b class="mono">${thx}</b><span>Sit down.</span></div>`
            : html`<button type="button" class="btn ghost" style="height:52px" onClick=${() => setThx(6)}><${Icon} name="spk" size=${20} color="#F4F0E8" />Deep Note</button>`}
        </div>`}
        <div>
          <div class="lbl">Calibration</div>
          ${calibrating > 0
            ? html`<div class="cal"><b class="mono">${calibrating}</b><span>Keep quiet: the bar is listening to the room.</span></div>`
            : html`<button type="button" class="btn ghost" style="height:52px" onClick=${() => sound({ cmd: 'calibrate' }).then((r) => { if (r) setCalibrating(knobs.calibrationSeconds || 45); })}><${Icon} name="spk" size=${20} color="#F4F0E8" />Calibrate the room</button>`}
        </div>
      </section>
    </div>
  </div>`;
}


// The equaliser as a graph rather than a rack of faders: a dot per band on a faint guide, a
// baseline at 0 dB, the value above and the band below, drawn in one SVG. Dragging a dot moves
// it along its guide; a tap anywhere on a column puts the dot there. The bar hears about it on
// release, not on every pixel.
const EQ_W = 1000, EQ_H = 190, EQ_TOP = 32, EQ_BOTTOM = 150;
function Eq({ points, pending, setPending }) {
  const [drag, setDrag] = useState(null);       // { id, min, max, step }
  const groups = points.filter((p) => p.group === 0).length;
  const gapAfter = groups - 1;
  const cols = points.length + 1;                // one column of air between the groups
  const xOf = (i) => 40 + ((i > gapAfter ? i + 1 : i) + 0.5) * ((EQ_W - 80) / cols);
  const yOf = (p, v) => EQ_BOTTOM - ((v - p.min) / (p.max - p.min || 1)) * (EQ_BOTTOM - EQ_TOP);
  const valueAt = (p, y) => { const raw = p.min + ((EQ_BOTTOM - y) / (EQ_BOTTOM - EQ_TOP)) * (p.max - p.min); const step = p.step || 1; return Math.max(p.min, Math.min(p.max, Math.round(raw / step) * step)); };
  const local = (e) => { const r = e.currentTarget.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * EQ_W, y: ((e.clientY - r.top) / r.height) * EQ_H }; };
  const nearest = (x) => points.map((p, i) => ({ p, d: Math.abs(xOf(i) - x) })).sort((a, b) => a.d - b.d)[0]?.p;
  const down = (e) => {
    const { x, y } = local(e);
    const p = nearest(x);
    if (!p || p.value == null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(p);
    setPending({ ...pending, [p.id]: valueAt(p, y) });
  };
  const move = (e) => { if (!drag) return; const { y } = local(e); setPending((q) => ({ ...q, [drag.id]: valueAt(drag, y) })); };
  const up = () => {
    if (!drag) return;
    const v = pending[drag.id];
    setPending((q) => { const r = { ...q }; delete r[drag.id]; return r; });
    if (v != null && v !== drag.value) drag.onSet(v);
    setDrag(null);
  };
  const zeroY = (p) => yOf(p, 0);
  return html`<svg class="eq" viewBox=${`0 0 ${EQ_W} ${EQ_H}`} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
    ${points.map((p, i) => { const x = xOf(i); const v = pending[p.id] ?? p.value; const known = v != null; const y = known ? yOf(p, v) : zeroY(p);
      return html`<g key=${p.id} class=${known ? '' : 'off'}>
        <line class="guide" x1=${x} y1=${EQ_TOP} x2=${x} y2=${EQ_BOTTOM} />
        <text class="v" x=${x} y=${18} text-anchor="middle">${known ? (v > 0 ? `+${v}` : `${v}`) : '–'}</text>
        <line class="tick" x1=${x - 6} y1=${zeroY(p)} x2=${x + 6} y2=${zeroY(p)} />
        <circle class=${`dot ${drag?.id === p.id ? 'on' : ''}`} cx=${x} cy=${y} r=${drag?.id === p.id ? 11 : 9} />
        <text class="l" x=${x} y=${EQ_H - 8} text-anchor="middle">${p.label}</text>
      </g>`; })}
    <line class="base" x1=${40} y1=${zeroY(points[0] || { min: -6, max: 6 })} x2=${EQ_W - 40} y2=${zeroY(points[0] || { min: -6, max: 6 })} />
    <text class="unit" x=${EQ_W - 8} y=${18} text-anchor="end">dB</text>
  </svg>`;
}
