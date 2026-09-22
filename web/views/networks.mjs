// Streaming networks: the logo picker used by Watch and Request, and the small labels drawn on
// posters (network chip, 4K / HDR / Atmos badges).

import { html } from '../lib/ui.mjs';
import { get, useLoad, useStore } from '../lib/api.mjs';

let cachedNetworks;
export function useNetworks() {
  const [list] = useLoad(() => (cachedNetworks ? Promise.resolve(cachedNetworks) : get('/api/networks').then((l) => (cachedNetworks = l))), []);
  return list || [];
}

export function NetworkPicker({ networks, onPick, hint }) {
  return html`<div class="net-picker">
    ${hint && html`<div class="muted" style="font-size:18px;grid-column:1/-1">${hint}</div>`}
    ${networks.map((n) => html`<button type="button" class="net-tile" onClick=${() => onPick(n.id)} aria-label=${n.name}>
      ${n.logo ? html`<img src=${n.logo} alt="" />` : html`<span class="net-name">${n.name}</span>`}
      <span class="net-label">${n.name}</span>
    </button>`)}
  </div>`;
}

const SHORT = { netflix: 'Netflix', prime: 'Prime', max: 'Max', apple: 'Apple TV+', disney: 'Disney+', hulu: 'Hulu', peacock: 'Peacock', paramount: 'Paramount+' };

// Network chip (top left) and quality badges (bottom left) for a poster.
export function PosterLabels({ brand, quality, lifted, forceBrand }) {
  const ui = useStore((s) => s.ui || {});
  const q = quality || {};
  const badges = ui.qualityBadges === false ? [] : [q.res, q.hdr && 'HDR', q.audio].filter(Boolean);
  if (!(ui.networkBadges || forceBrand)) brand = null;
  return html`
    ${brand && html`<span class=${`brand-chip b-${brand}`}>${SHORT[brand] || brand}</span>`}
    ${badges.length > 0 && html`<span class="badges" style=${lifted ? 'bottom:20px' : ''}>${badges.map((b) => html`<span class="qb">${b}</span>`)}</span>`}`;
}
