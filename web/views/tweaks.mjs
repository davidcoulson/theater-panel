// The panel's own settings sheet: seven taps on the version number in the rail open it. Only
// the harmless knobs live here (server/admin.mjs decides which): the Mystery box rules, the
// look, the pre-roll timing. Anything that connects to something stays on the admin page.

import { useState } from 'preact/hooks';
import { html, Icon } from '../lib/ui.mjs';
import { get, post, useLoad, toast } from '../lib/api.mjs';

const ORDER = ['Mystery box', 'Tonight', 'Display', 'Projector apps', 'Year in review'];
const TITLES = { 'Projector apps': 'Pre-roll', 'Year in review': 'December' };

export function TweaksSheet({ onClose }) {
  const [data, err] = useLoad(() => get('/api/tweaks'), []);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  // "Draw ten": the saved rules, run ten times, listed instead of the settings until dismissed.
  const [preview, setPreview] = useState(null);
  // One group at a time, on tabs, so nothing needs a long scroll on the wall.
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('tp-tweaks-tab') || ''; } catch { return ''; } });
  const pickTab = (g) => { setTab(g); try { localStorage.setItem('tp-tweaks-tab', g); } catch {} };
  async function drawTen() {
    setPreview([]);
    try { setPreview(await get('/api/mystery/preview?n=10')); } catch (e) { toast(e.message, true); setPreview(null); }
  }
  const values = draft || Object.fromEntries((data?.fields || []).map((f) => [f.key, f.value]));
  const put = (k, v) => setDraft({ ...values, [k]: v });
  async function save() {
    setBusy(true);
    try { await post('/api/tweaks', { values }); toast('Saved'); onClose(); }
    catch (e) { toast(e.message, true); }
    finally { setBusy(false); }
  }
  const groups = ORDER.filter((g) => data?.fields.some((f) => f.group === g));
  const current = groups.includes(tab) ? tab : groups[0];
  return html`<div class="mystery-sheet tweaks" role="dialog" aria-label="Panel settings">
    <div class="h">
      <div><div class="eyebrow">Behind the panel</div><div class="t">Settings</div></div>
      <button type="button" class="icon-btn" style="width:46px;height:46px;background:rgba(0,0,0,.25)" aria-label="Close" onClick=${onClose}><${Icon} name="x" color="#F4F0E8" /></button>
    </div>
    ${err ? html`<div class="empty" style="flex-grow:1;color:#C7B39E">${err.message}</div>`
      : !data ? html`<div class="empty" style="flex-grow:1">Loading…</div>`
      : preview ? html`<div class="body preview">
          ${!preview.length ? html`<div class="empty">Drawing ten…</div>` : preview.map((p, i) => html`<div class="pick" key=${p.id}>
            <span class="n mono">${i + 1}</span>
            <div class="what"><b>${p.title}</b> <span class="mono">${p.year}</span>
              <div class="meta mono">${[p.rating ? `${p.rating.toFixed(1)}★` : null, p.minutes ? `${p.minutes} min` : null, p.contentRating, p.res, p.hdr ? 'HDR' : null, p.studio, p.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}</div>
              <div class="why">${p.why}</div></div>
          </div>`)}
        </div>
        <div class="acts">
          <button type="button" class="btn big ghost" onClick=${drawTen} disabled=${!preview.length}><${Icon} name="dice" size=${24} color="#F4F0E8" />Again</button>
          <button type="button" class="btn primary big" style="flex-grow:1" onClick=${() => setPreview(null)}>Back to settings</button>
        </div>`
      : html`<div class="tabs">${groups.map((g) => html`<button type="button" class="filter" aria-pressed=${g === current ? 'true' : 'false'} onClick=${() => pickTab(g)}>${TITLES[g] || g}</button>`)}</div>
        <div class="body">${current && html`<section key=${current}>
          ${data.fields.filter((f) => f.group === current).map((f) => html`<${Row} key=${f.key} f=${f} value=${values[f.key]} libraries=${data.libraries} onChange=${(v) => put(f.key, v)} />`)}
        </section>`}</div>
        <div class="acts">
          <button type="button" class="btn primary big" style="flex-grow:1" disabled=${busy || !draft} onClick=${save}>Save</button>
          <button type="button" class="btn big ghost" title="Ten Mystery box draws under the saved rules" onClick=${drawTen}><${Icon} name="dice" size=${24} color="#F4F0E8" />Draw ten</button>
          <button type="button" class="btn big ghost" onClick=${onClose}>Cancel</button>
        </div>`}
  </div>`;
}

// One setting, drawn for a finger rather than a keyboard wherever the type allows: switches
// and choices are chips, libraries are chips, numbers and names are the only typing.
function Row({ f, value, libraries, onChange }) {
  const v = value ?? '';
  let control;
  if (f.type === 'bool') {
    const on = (v === '' ? String(f.default) : v) === 'true';
    control = html`<button type="button" class="filter" aria-pressed=${on ? 'true' : 'false'} onClick=${() => onChange(on ? 'false' : 'true')}>${on ? 'On' : 'Off'}</button>`;
  } else if (f.type === 'select') {
    const cur = v || f.options[0][0];
    control = html`<div class="chips">${f.options.map(([id, label]) => html`<button type="button" class="filter" aria-pressed=${cur === id ? 'true' : 'false'} onClick=${() => onChange(id)}>${label}</button>`)}</div>`;
  } else if (f.type === 'range') {
    const cur = v === '' ? f.default : Number(v);
    control = html`<div class="rangerow"><input class="range" type="range" min=${f.min} max=${f.max} step=${f.step} value=${cur} onInput=${(e) => onChange(e.target.value)} /><span class="mono">${cur}</span></div>`;
  } else if (f.type === 'libraries') {
    const set = new Set(v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
    control = html`<div class="chips">${libraries.map((t) => html`<button type="button" class="filter" aria-pressed=${set.has(t) ? 'true' : 'false'} onClick=${() => { if (set.has(t)) set.delete(t); else set.add(t); onChange([...set].join(',')); }}>${t}</button>`)}${!libraries.length && html`<span class="hint">Plex not reachable</span>`}</div>`;
  } else {
    control = html`<input type="text" value=${v} placeholder=${f.placeholder ? `Default ${f.placeholder}` : 'Default'} onInput=${(e) => onChange(e.target.value)} />`;
  }
  return html`<div class="row"><div class="lbl"><div>${f.label}</div>${f.help && html`<small>${f.help}</small>`}</div>${control}</div>`;
}
