// "Now showing": the idle screen. A slow, dim slideshow of what is in Plex and what is on its
// way, like a cinema lobby board. Kiosk Satellite can use it as its screensaver (Website mode,
// https://ht-kiosk.coulson.io/#/showing) or it can be opened like any other screen.

import { useState, useEffect } from 'preact/hooks';
import { html, Icon } from '../lib/ui.mjs';
import { get, useLoad, useStore, clock, runtime, christmasCountdown } from '../lib/api.mjs';
import { useStreams } from './streams.mjs';
import { route, currentAccent } from '../app.mjs';

const HOLD = 14000;   // ms per title

export function Showing() {
  // "?season=halloween" / "christmas" shows the holiday board out of season.
  const [loaded] = useLoad(() => get(`/api/showing${route.params.season ? `?season=${encodeURIComponent(route.params.season)}` : ''}`).catch(() => []), []);
  // Tonight's plan leads the slideshow while there is one: the poster, the time, the times.
  const plan = useStore((s) => s.tonight);
  const items = !loaded ? loaded : plan?.item ? [tonightSlide(plan), ...loaded.filter((x) => x.id !== 'tonight')] : loaded;
  const [i, setI] = useState(0);
  const [now, setNow] = useState(clock());
  const streams = useStreams();
  const hold = Number(route.params.hold) * 1000 || HOLD;

  useEffect(() => {
    const t = setInterval(() => setNow(clock()), 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!items?.length) return;
    const t = setInterval(() => setI((v) => (v + 1) % items.length), hold);
    return () => clearInterval(t);
  }, [items, hold]);

  if (!items) return html`<main class="showing"><div class="sh-clock">${now.hm}<small>${now.ampm}</small></div></main>`;
  if (!items.length) return html`<main class="showing"><div class="sh-clock">${now.hm}<small>${now.ampm}</small></div>
    <div class="sh-empty">Nothing to show yet</div></main>`;

  const cur = i % items.length;
  const it = items[cur];
  const board = it.kind === 'board';
  // Creature feature: at Halloween the lobby board turns into a drive-in B-movie card, green
  // and flickering, with the titles announced the way a 1958 double bill would have been.
  const creature = currentAccent()?.id === 'halloween';
  // Only three backdrops are in the DOM: the one fading out, the one on, and the next one
  // preloading. Kept in list order so the nodes never move and a running fade is not cut.
  const near = new Set([(cur + items.length - 1) % items.length, cur, (cur + 1) % items.length]);
  return html`<main class=${`showing ${creature ? 'creature' : ''}`}>
    ${items.map((m, k) => { if (!near.has(k)) return null; const art = m.art || m.items?.find((x) => x.art)?.art; return html`<div class=${`sh-art ${k === cur ? 'on' : ''}`} key=${m.id}
      style=${art ? `background-image:url('${art}')` : ''}></div>`; })}
    <div class="sh-veil"></div>
    <div class="sh-clock">${streams.length > 0 && html`<span class="t">${streams.length} stream${streams.length === 1 ? '' : 's'}</span><span class="dot-sep" aria-hidden="true"></span>`}${now.hm}<small>${now.ampm}</small></div>
    ${(() => { const c = christmasCountdown(new Date(), route.params.countdown === '1'); return c && html`<div class="sh-countdown"><${Icon} name="tree" size=${22} color="#7FB77E" />${c.text}</div>`; })()}
    ${creature && !board && html`<div class="creature-card"><span class="c1">Tonight's</span><span class="c2">Creature Feature</span><span class="c3">presented in Terror-Vision</span></div>`}
    ${board ? html`<${Board} it=${it} key=${it.id} />` : html`<div class="sh-body" key=${it.id}>
      ${it.poster && html`<img class="sh-poster" src=${it.poster} alt="" />`}
      <div class="sh-text">
        <div class="sh-label"><span class=${`dot ${it.kind === 'soon' ? '' : 'on'}`}></span>${it.label}</div>
        <h1 class="clamp2">${it.title}</h1>
        <div class="sh-meta">${[it.year, it.runtime && runtime(it.runtime), it.contentRating, ...(it.genres || []).slice(0, 2)].filter(Boolean).join(' · ')}</div>
        ${it.tagline || it.summary ? html`<p class="clamp3">${it.tagline || it.summary}</p>` : null}
        ${it.badges?.length ? html`<div class="sh-badges">${it.badges.map((b) => html`<span class="qb big">${b}</span>`)}</div>` : null}
      </div>
    </div>`}
    <div class="sh-dots">${items.map((m, k) => html`<i class=${k === cur ? 'on' : ''}></i>`)}</div>
    <div class="sh-hint"><${Icon} name="film" size=${18} color="#8C7866" />Touch to wake</div>
  </main>`;
}

// The evening's plan as a poster slide, in the same shape as a Now Showing title.
function tonightSlide(plan) {
  const at = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const it = plan.item;
  const label = plan.state === 'feature' ? 'Now showing' : plan.state === 'trailers' ? 'Coming attractions' : plan.at ? `Tonight at ${at(plan.at)}` : 'Tonight';
  const badges = [];
  if (plan.trailers?.length) badges.push(`${plan.trailers.length} trailer${plan.trailers.length === 1 ? '' : 's'} first`);
  if (plan.times?.intermission) badges.push(`Intermission ${at(plan.times.intermission)}`);
  if (plan.times?.ends) badges.push(`Ends ${at(plan.times.ends)}`);
  return { id: 'tonight', kind: 'tonight', label, title: it.title, year: it.year, runtime: it.duration, contentRating: it.contentRating, genres: it.genres, summary: it.summary, poster: it.poster, art: it.art, badges };
}

// A board between the posters: the holiday shelf, or Coming soon from the request queue. A row
// of posters under a marquee title, each with its year, or when it arrives.
function Board({ it }) {
  return html`<div class=${`sh-board ${it.board} ${it.season || ''}`}>
    <div class="sh-board-head"><div class="k">${it.kicker}</div><h1>${it.title}</h1></div>
    <div class="sh-board-row">
      ${it.items.map((p) => html`<figure key=${p.id}>
        <div class="pic">${p.poster ? html`<img src=${p.poster} alt="" />` : html`<div class="ph">${p.title}</div>`}${p.ribbon && html`<span class="ribbon">${p.ribbon}</span>`}</div>
        <figcaption><b class="ellipsis">${p.title}</b><span>${it.board === 'coming' ? p.when : p.year || ''}</span></figcaption>
      </figure>`)}
    </div>
  </div>`;
}
