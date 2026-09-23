// Holiday emblems: small filled illustrations for the rail, drawn in the panel's own palette
// rather than emoji, so they sit with the wood and plaster. One per accent in
// server/accents.mjs. Each is a 64 x 64 drawing; size scales it.

import { html } from './ui.mjs';

const P = { ink: '#2A1911', cream: '#F4F0E8', gold: '#E3A865', copper: '#8F4E1C', rust: '#B75A2A', red: '#C8322B', rose: '#D9536F', blush: '#F2A0B2', skin: '#F4D2B8', green: '#4E7D3A', orange: '#E8731C', ember: '#C75E12', navy: '#333C3F' };

const ART = {
  // jack-o'-lantern
  halloween: html`
    <path d="M30 14c-1-5 2-8 6-9-1 3-1 5 0 9z" fill=${P.green} />
    <ellipse cx="32" cy="38" rx="26" ry="21" fill=${P.orange} />
    <ellipse cx="20" cy="38" rx="9" ry="21" fill="none" stroke=${P.ember} stroke-width="2.5" />
    <ellipse cx="32" cy="38" rx="9" ry="21" fill="none" stroke=${P.ember} stroke-width="2.5" />
    <ellipse cx="44" cy="38" rx="9" ry="21" fill="none" stroke=${P.ember} stroke-width="2.5" />
    <path d="M18 34l8-4 1 8zM46 34l-8-4-1 8z" fill=${P.ink} />
    <path d="M17 44c4 6 10 8 15 8s11-2 15-8l-5 2-3-3-3 3-4-3-4 3-3-3-3 3z" fill=${P.ink} />`,
  // turkey: fan of tail feathers behind a round body
  thanksgiving: html`
    ${[-52, -26, 0, 26, 52].map((a, i) => html`<ellipse cx="32" cy="24" rx="7" ry="20" transform=${`rotate(${a} 32 40)`} fill=${[P.rust, P.gold, P.copper, P.gold, P.rust][i]} />`)}
    <circle cx="32" cy="42" r="15" fill=${P.copper} />
    <circle cx="32" cy="42" r="10" fill=${P.rust} />
    <circle cx="32" cy="28" r="7" fill=${P.copper} />
    <path d="M32 30l6 3-6 3z" fill=${P.gold} />
    <path d="M30 34c-3 1-4 4-2 7 1-3 3-4 2-7z" fill=${P.red} />
    <circle cx="30" cy="26.5" r="1.4" fill=${P.ink} />
    <path d="M27 57l1-6M37 57l-1-6" stroke=${P.gold} stroke-width="2.5" stroke-linecap="round" />`,
  // Santa
  christmas: html`
    <path d="M14 30c2-14 12-20 20-20 10 0 16 6 18 12l-4 3H16z" fill=${P.red} />
    <path d="M12 30h40a4 4 0 0 1 0 8H12a4 4 0 0 1 0-8z" fill=${P.cream} />
    <circle cx="52" cy="22" r="5" fill=${P.cream} />
    <path d="M18 38h28v6c0 4-3 8-7 8H25c-4 0-7-4-7-8z" fill=${P.skin} />
    <path d="M14 44c0 10 8 16 18 16s18-6 18-16c-3 5-6 7-9 6l-2 4-3-3-4 3-4-3-3 3-2-4c-3 1-6-1-9-6z" fill=${P.cream} />
    <circle cx="26" cy="42" r="1.6" fill=${P.ink} /><circle cx="38" cy="42" r="1.6" fill=${P.ink} />
    <circle cx="32" cy="47" r="2.4" fill=${P.blush} />
    <path d="M28 50c2 1.5 6 1.5 8 0" fill="none" stroke=${P.ink} stroke-width="1.2" stroke-linecap="round" />`,
  // champagne and a burst
  newyear: html`
    <path d="M22 8h16l-2 18c-1 5-4 8-6 8s-5-3-6-8z" fill=${P.gold} opacity=".9" />
    <path d="M23 8h14l-1 8H24z" fill=${P.cream} opacity=".8" />
    <path d="M30 34v14M22 50h16" stroke=${P.gold} stroke-width="3" stroke-linecap="round" />
    <circle cx="27" cy="20" r="1.3" fill=${P.cream} /><circle cx="32" cy="24" r="1.1" fill=${P.cream} /><circle cx="29" cy="28" r="1" fill=${P.cream} />
    <path d="M50 8v10M45 13h10M46.5 9.5l7 7M53.5 9.5l-7 7" stroke=${P.cream} stroke-width="2" stroke-linecap="round" />
    <path d="M48 32v6M45 35h6" stroke=${P.gold} stroke-width="2" stroke-linecap="round" />
    <path d="M14 40v5M11.5 42.5h5" stroke=${P.gold} stroke-width="2" stroke-linecap="round" />`,
  // two hearts
  valentines: html`
    <path d="M40 54s-16-10-16-22a9 9 0 0 1 16-5 9 9 0 0 1 16 5c0 12-16 22-16 22z" fill=${P.rose} />
    <path d="M22 44s-12-8-12-17a7 7 0 0 1 12-4 7 7 0 0 1 12 4c0 9-12 17-12 17z" fill=${P.blush} />
    <path d="M30 30c-2-4-1-7 2-8" fill="none" stroke=${P.cream} stroke-width="2" stroke-linecap="round" opacity=".8" />`,
  // cake with candles
  birthday: html`
    <path d="M12 40h40v12a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z" fill=${P.copper} />
    <path d="M12 36h40v6c-3 3-6 3-8 0-3 3-6 3-8 0-3 3-6 3-8 0-3 3-6 3-8 0-3 3-6 3-8 0z" fill=${P.blush} />
    <path d="M14 36h36v-8H14z" fill=${P.rust} />
    ${[20, 32, 44].map((x) => html`<rect x=${x - 2} y="16" width="4" height="12" rx="1" fill=${P.cream} />
      <path d=${`M${x} 8c-2.5 3-2.5 6 0 8 2.5-2 2.5-5 0-8z`} fill=${P.orange} />`)}
    <path d="M14 45h36" stroke=${P.gold} stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round" />`,
};

export const Emblem = ({ id, size = 64 }) => (ART[id]
  ? html`<svg width=${size} height=${size} viewBox="0 0 64 64" aria-hidden="true" style="overflow:visible">${ART[id]}</svg>`
  : null);
