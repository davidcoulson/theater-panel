// The panel's own settings sheet: seven taps on the version number in the rail open it. Only
// the harmless knobs live here (server/admin.mjs decides which): the Mystery box rules, the
// look, the pre-roll timing. Anything that connects to something stays on the admin page.

import { useState } from 'preact/hooks';
import { html, Icon } from '../lib/ui.mjs';
import { get, post, useLoad, toast } from '../lib/api.mjs';

const ORDER = ['Mystery box', 'Display', 'Projector apps', 'Year in review'];
const TITLES = { 'Projector apps': 'Pre-roll and intermission', 'Year in review': 'December' };

export function TweaksSheet({ onClose }) {
  const [data, err] = useLoad(() => get('/api/tweaks'), []);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const values = draft || Object.fromEntries((data?.fields || []).map((f) => [f.key, f.value]));
  const put = (k, v) => setDraft({ ...values, [k]: v });
  async function save() {
    setBusy(true);
    try { await post('/api/tweaks', { values }); toast('Saved'); onClose(); }
    catch (e) { toast(e.message, true); }
    finally { setBusy(false); }
  }
  const groups = ORDER.filter((g) => data?.fields.some((f) => f.group === g));
  return html`<div class="mystery-sheet tweaks" role="dialog" aria-label="Panel settings">
    <div class="h">
      <div><div class="eyebrow">Behind the panel</div><div class="t">Settings</div></div>
      <button type="button" class="icon-btn" style="width:46px;height:46px;background:rgba(0,0,0,.25)" aria-label="Close" onClick=${onClose}><${Icon} name="x" color="#F4F0E8" /></button>
    </div>
    ${err ? html`<div class="empty" style="flex-grow:1;color:#C7B39E">${err.message}</div>`
      : !data ? html`<div class="empty" style="flex-grow:1">Loading…</div>`
      : html`<div class="body">${groups.map((g) => html`<section key=${g}>
          <h3>${TITLES[g] || g}</h3>
          ${data.fields.filter((f) => f.group === g).map((f) => html`<${Row} key=${f.key} f=${f} value=${values[f.key]} libraries=${data.libraries} onChange=${(v) => put(f.key, v)} />`)}
        </section>`)}</div>
        <div class="acts">
          <button type="button" class="btn primary big" style="flex-grow:1" disabled=${busy || !draft} onClick=${save}>Save</button>
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
