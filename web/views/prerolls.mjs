// The pre-roll picker, a section of the Sound sheet: NeXroll's categories, the one on air, what
// Plex has queued, and each pre-roll's resolution / HDR / audio badges. Tapping a category
// applies it to Plex, when the settings allow it (NEXROLL_ALLOW_PICK or NEXROLL_AUTOSWITCH).

import { useState, useEffect } from 'preact/hooks';
import { html } from '../lib/ui.mjs';
import { get, post, toast } from '../lib/api.mjs';

export function Prerolls() {
  const [data, setData] = useState(null);
  const [shown, setShown] = useState(null);     // category id whose pre-rolls are listed
  const [err, setErr] = useState('');
  const load = () => get('/api/nexroll').then((d) => { setData(d); setErr(''); setShown((s) => s ?? d.categories.find((c) => c.active)?.id ?? d.categories[0]?.id); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return html`<section><div class="lbl">Pre-roll</div><p class="hint">NeXroll: ${err}</p></section>`;
  if (!data) return html`<section><div class="lbl">Pre-roll</div><p class="hint">Asking NeXroll…</p></section>`;
  const cat = data.categories.find((c) => c.id === shown);
  const pick = (c) => post('/api/nexroll/pick', { id: c.id }).then(() => { toast(`${c.name} is on for tonight`); load(); }).catch((e) => toast(e.message, true));
  return html`<section class="prerolls">
    <div class="lbl">Pre-roll${data.queued.length ? ` · queued: ${data.queued.join(', ')}${data.mode ? ` (${data.mode})` : ''}` : ''}</div>
    <div class="chips">${data.categories.map((c) => html`<button type="button" class="filter" key=${c.id} aria-pressed=${c.id === shown ? 'true' : 'false'} onClick=${() => setShown(c.id)}>${c.name}${c.active ? ' · on air' : ''}</button>`)}</div>
    ${cat && html`<div class="chips">${cat.prerolls.map((p) => html`<span class="filter" key=${p.id}>${p.name}${p.badges.length ? ` · ${p.badges.join(' · ')}` : ''}</span>`)}${!cat.prerolls.length && html`<span class="hint">Nothing in this category yet.</span>`}</div>
      ${data.canPick && !cat.active && html`<div><button type="button" class="btn ghost" style="height:46px" onClick=${() => pick(cat)}>Use ${cat.name} tonight</button></div>`}`}
  </section>`;
}
