// The sleep timer. "Stop after this" turns the room off when playback ends; a timed sleep stops
// it after so many minutes. The server holds the timer (server/sleep.mjs), so it keeps its word
// whatever the panel does afterwards - falling to the idle screen, reloading, or being switched
// off entirely.

import { html, Icon } from '../lib/ui.mjs';
import { post, useStore, toast } from '../lib/api.mjs';

const OPTIONS = [
  { mode: 'end', label: 'After this', desc: 'When the film ends' },
  { mode: 'timer', minutes: 30, label: '30 min' },
  { mode: 'timer', minutes: 60, label: '60 min' },
  { mode: 'timer', minutes: 90, label: '90 min' },
];

export const sleepLabel = (s) => (!s ? '' : s.mode === 'end' ? 'After this' : `${Math.max(1, Math.round((s.in || 0) / 60000))} min`);

async function arm(opt) {
  try {
    const r = await post('/api/sleep', opt);
    toast(r.mode ? (r.mode === 'end' ? 'Room off when the film ends' : `Room off in ${r.minutes} minutes`) : 'Sleep timer off');
  } catch (e) { toast(e.message, true); }
}
export const cancelSleep = () => arm({ mode: 'off' });

// Lobby: only there when something is armed, and tapping it calls the whole thing off.
export function SleepChip() {
  const sleep = useStore((s) => s.sleep);
  if (!sleep) return null;
  return html`<button type="button" class="chip warn" onClick=${cancelSleep} title="Cancel the sleep timer">
    <${Icon} name="moon" size=${20} />Sleep · ${sleepLabel(sleep)}<span class="x">×</span></button>`;
}

// Showtime: one dark button, and the choices under it.
export function SleepPicker({ onClose }) {
  const sleep = useStore((s) => s.sleep);
  const pick = (opt) => { arm(opt); onClose(); };
  return html`<div class="sleep-picker" role="dialog" aria-label="Sleep timer">
    <div class="h"><span class="lbl">Turn the room off</span>
      <button type="button" class="icon-btn" style="width:44px;height:44px;background:rgba(0,0,0,.4)" aria-label="Close" onClick=${onClose}><${Icon} name="x" color="var(--d-text)" /></button></div>
    <div class="opts">
      ${OPTIONS.map((o) => html`<button type="button" class="dbtn" aria-pressed=${sleep?.mode === o.mode && sleep?.minutes === (o.minutes ?? null) ? 'true' : 'false'} onClick=${() => pick(o)}>
        <span class="big">${o.label}</span>${o.desc && html`<span class="s">${o.desc}</span>`}</button>`)}
    </div>
    ${sleep && html`<button type="button" class="dbtn wide" onClick=${() => pick({ mode: 'off' })}><${Icon} name="x" size=${28} w=${1.8} /><span class="s">Cancel · ${sleepLabel(sleep)}</span></button>`}
  </div>`;
}
