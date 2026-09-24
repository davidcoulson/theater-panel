// The Mystery box: one unwatched film from the library, chosen with an eye on what the house has
// been watching (server/taste.mjs), revealed with a bit of ceremony and then started by itself.
// The countdown is the point - nobody has to decide anything - but it can always be waved off.

import { useState, useEffect, useRef } from 'preact/hooks';
import { html, Icon, Play, Poster } from '../lib/ui.mjs';
import { get, useStore, runtime, endsAt, toast } from '../lib/api.mjs';
import { play } from './lobby.mjs';

const COUNTDOWN = 10;      // seconds between the reveal and the film starting
const SUSPENSE = 1200;     // the shuffle runs at least this long, however fast Plex answers

export function MysterySheet({ onClose, filters = [], initial = null }) {
  const [pick, setPick] = useState(initial);
  const [err, setErr] = useState(null);
  const [left, setLeft] = useState(COUNTDOWN);
  const seen = useRef([]);
  const preroll = useStore((s) => s.preroll) || {};

  async function roll() {
    setPick(null); setErr(null); setLeft(COUNTDOWN);
    const started = Date.now();
    try {
      const q = [filters.length ? `filters=${filters.join(',')}` : '', seen.current.length ? `not=${seen.current.join(',')}` : ''].filter(Boolean).join('&');
      const r = await get(`/api/mystery${q ? `?${q}` : ''}`);
      await new Promise((go2) => setTimeout(go2, Math.max(0, SUSPENSE - (Date.now() - started))));
      seen.current = [...seen.current, r.item.id].slice(-20);
      setPick(r);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { if (!initial) roll(); }, []);

  // Count down to the film, then start it. Any button stops the clock first.
  useEffect(() => {
    if (!pick) return;
    if (left <= 0) { start(); return; }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [pick, left]);

  const start = () => { if (pick) { onClose(); play(pick.item, true); } };
  const it = pick?.item;
  const meta = it ? [it.year, runtime(it.duration), it.rating ? `${it.rating.toFixed(1)}★` : null, ...(it.genres || []).slice(0, 2)].filter(Boolean).join(' · ') : '';

  return html`<div class="mystery-sheet" role="dialog" aria-label="Mystery box">
    <div class="h">
      <div><div class="eyebrow">Mystery box</div><div class="t">${it ? "Tonight you're watching" : 'Shuffling the library'}</div></div>
      <button type="button" class="icon-btn" style="width:46px;height:46px;background:rgba(0,0,0,.25)" aria-label="Close" onClick=${onClose}><${Icon} name="x" color="#F4F0E8" /></button>
    </div>

    ${err ? html`<div class="empty" style="flex-grow:1;color:#C7B39E">${err}</div>`
      : !it ? html`<div class="reels">${[0, 1, 2, 3, 4].map((i) => html`<span class="reel" style=${`animation-delay:${i * 90}ms`}></span>`)}</div>`
      : html`<div class="reveal">
        <div class="art"><${Poster} src=${it.poster} title=${it.title} /></div>
        <div class="info">
          <div class="why"><${Icon} name="sparkle" size=${22} color="var(--gold)" />${pick.why}</div>
          <h2>${it.title}</h2>
          <div class="mono meta">${meta}</div>
          ${(it.quality?.res || it.quality?.hdr || it.quality?.audio) && html`<div class="detail-badges">
            ${[it.quality.res, it.quality.hdr, it.quality.audio].filter(Boolean).map((b) => html`<span class="qb big">${b}</span>`)}</div>`}
          <p class="clamp3">${it.summary}</p>
          <div class="endsat dark"><${Icon} name="moon" color="var(--gold)" />Starts now, ends at ${endsAt(it.duration || 0)}${preroll.enabled ? ` · swell first` : ''}</div>
          <div style="flex-grow:1"></div>
          <div class="count"><i style=${`width:${(left / COUNTDOWN) * 100}%`}></i></div>
          <div class="acts">
            <button type="button" class="btn primary big" style="flex-grow:1" onClick=${start}><${Play} size=${28} />Play now${left > 0 ? ` · ${left}` : ''}</button>
            <button type="button" class="btn big ghost" onClick=${() => roll()}><${Icon} name="dice" size=${26} color="#F4F0E8" />Something else</button>
            <button type="button" class="btn big ghost" onClick=${() => { onClose(); toast('Maybe tomorrow'); }}>Not tonight</button>
          </div>
        </div>
      </div>`}
  </div>`;
}
