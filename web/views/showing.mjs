// "Now showing": the idle screen. A slow, dim slideshow of what is in Plex and what is on its
// way, like a cinema lobby board. Kiosk Satellite can use it as its screensaver (Website mode,
// https://ht-kiosk.coulson.io/#/showing) or it can be opened like any other screen.

import { useState, useEffect } from 'preact/hooks';
import { html, Icon } from '../lib/ui.mjs';
import { get, useLoad, useStore, clock, runtime } from '../lib/api.mjs';
import { useStreams } from './streams.mjs';
import { route, currentAccent } from '../app.mjs';

const HOLD = 14000;   // ms per title

export function Showing() {
  const [items] = useLoad(() => get('/api/showing').catch(() => []), []);
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

  const it = items[i % items.length];
  // Creature feature: at Halloween the lobby board turns into a drive-in B-movie card, green
  // and flickering, with the titles announced the way a 1958 double bill would have been.
  const creature = currentAccent()?.id === 'halloween';
  return html`<main class=${`showing ${creature ? 'creature' : ''}`}>
    ${items.map((m, k) => html`<div class=${`sh-art ${k === i % items.length ? 'on' : ''}`} key=${m.id}
      style=${m.art ? `background-image:url('${m.art}')` : ''}></div>`)}
    <div class="sh-veil"></div>
    <div class="sh-clock">${now.hm}<small>${now.ampm}</small>${streams.length > 0 && html`<span class="t">${streams.length} stream${streams.length === 1 ? '' : 's'}</span>`}</div>
    ${creature && html`<div class="creature-card"><span class="c1">Tonight's</span><span class="c2">Creature Feature</span><span class="c3">presented in Terror-Vision</span></div>`}
    <div class="sh-body" key=${it.id}>
      ${it.poster && html`<img class="sh-poster" src=${it.poster} alt="" />`}
      <div class="sh-text">
        <div class="sh-label"><span class=${`dot ${it.kind === 'soon' ? '' : 'on'}`}></span>${it.label}</div>
        <h1 class="clamp2">${it.title}</h1>
        <div class="sh-meta">${[it.year, it.runtime && runtime(it.runtime), it.contentRating, ...(it.genres || []).slice(0, 2)].filter(Boolean).join(' · ')}</div>
        ${it.tagline || it.summary ? html`<p class="clamp3">${it.tagline || it.summary}</p>` : null}
        ${it.badges?.length ? html`<div class="sh-badges">${it.badges.map((b) => html`<span class="qb big">${b}</span>`)}</div>` : null}
      </div>
    </div>
    <div class="sh-dots">${items.map((m, k) => html`<i class=${k === i % items.length ? 'on' : ''}></i>`)}</div>
    <div class="sh-hint"><${Icon} name="film" size=${18} color="#8C7866" />Touch to wake</div>
  </main>`;
}
