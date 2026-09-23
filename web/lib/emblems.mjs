// Holiday and season emblems for the rail: little cartoons with an ink outline, drawn in the
// panel's own palette so they sit with the wood rather than looking like emoji. One per accent
// in server/accents.mjs. Each is a 64 x 64 drawing; size scales it. The class names on parts
// (wag, flame, bubble, blink, pom) are what styles.css animates.

import { html } from './ui.mjs';

const P = { ink: '#2A1911', cream: '#F4F0E8', gold: '#E3A865', copper: '#8F4E1C', rust: '#B75A2A', red: '#C8322B', rose: '#D9536F', blush: '#F2A0B2', skin: '#F4D2B8', green: '#4E7D3A', orange: '#E8731C', ember: '#C75E12', sky: '#CFE0EC', sun: '#F2C94C', leaf: '#6FA24B' };
const O = { stroke: P.ink, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

const ART = {
  // jack-o'-lantern with a big grin; the eyes flicker like the candle inside
  halloween: html`
    <path d="M30 13c-2-5 1-9 6-10-1 3-1 6 0 10z" fill=${P.green} ...${O} />
    <ellipse cx="32" cy="38" rx="27" ry="22" fill=${P.orange} ...${O} />
    <path d="M18 18c-4 6-4 34 0 40M46 18c4 6 4 34 0 40M32 16v44" fill="none" stroke=${P.ember} stroke-width="2.5" stroke-linecap="round" />
    <g class="flame"><path d="M15 33l10-5 2 10zM49 33l-10-5-2 10z" fill=${P.sun} ...${O} /></g>
    <path d="M16 44c4 8 10 11 16 11s12-3 16-11l-5 2-4-4-3 4-4-4-4 4-3-4-4 4z" fill=${P.sun} ...${O} />
    <circle cx="24" cy="26" r="1.8" fill=${P.cream} opacity=".6" />`,
  // turkey with a fan tail that wags, big eyes, goofy grin
  thanksgiving: html`
    <g class="wag">${[-58, -29, 0, 29, 58].map((a, i) => html`<ellipse cx="32" cy="22" rx="7.5" ry="21" transform=${`rotate(${a} 32 42)`} fill=${[P.rust, P.gold, P.copper, P.gold, P.rust][i]} ...${O} />`)}</g>
    <circle cx="32" cy="43" r="16" fill=${P.copper} ...${O} />
    <circle cx="32" cy="45" r="9" fill=${P.rust} />
    <circle cx="32" cy="28" r="9" fill=${P.copper} ...${O} />
    <circle cx="28.5" cy="26" r="3" fill=${P.cream} /><circle cx="35.5" cy="26" r="3" fill=${P.cream} />
    <g class="blink"><circle cx="29" cy="26.5" r="1.5" fill=${P.ink} /><circle cx="36" cy="26.5" r="1.5" fill=${P.ink} /></g>
    <path d="M32 30l7 3-7 3z" fill=${P.sun} ...${O} />
    <path d="M30 35c-3 2-3 5-1 8 2-3 3-5 1-8z" fill=${P.red} ...${O} />
    <path d="M26 59l1-5M38 59l-1-5M23 59h6M35 59h6" stroke=${P.sun} stroke-width="2.6" stroke-linecap="round" />`,
  // Santa: bobbing, with a pom that swings
  christmas: html`
    <path d="M13 31c2-15 12-22 21-22 10 0 17 7 19 14l-3 5H15z" fill=${P.red} ...${O} />
    <path d="M12 30h40a4.5 4.5 0 0 1 0 9H12a4.5 4.5 0 0 1 0-9z" fill=${P.cream} ...${O} />
    <circle class="pom" cx="54" cy="21" r="5.5" fill=${P.cream} ...${O} />
    <path d="M17 39h30v6c0 5-3 9-8 9H25c-5 0-8-4-8-9z" fill=${P.skin} ...${O} />
    <path d="M13 44c0 11 8 17 19 17s19-6 19-17c-3 5-6 7-9 6l-2 4-3-3-5 3-5-3-3 3-2-4c-3 1-6-1-9-6z" fill=${P.cream} ...${O} />
    <g class="blink"><circle cx="26" cy="43" r="2" fill=${P.ink} /><circle cx="38" cy="43" r="2" fill=${P.ink} /></g>
    <circle cx="21" cy="47" r="2.5" fill=${P.blush} /><circle cx="43" cy="47" r="2.5" fill=${P.blush} />
    <circle cx="32" cy="48" r="3" fill=${P.rose} ...${O} />
    <path d="M27 52c2 2 8 2 10 0" fill="none" stroke=${P.ink} stroke-width="1.6" stroke-linecap="round" />`,
  // champagne with bubbles rising, and a burst
  newyear: html`
    <path d="M21 7h18l-2 19c-1 6-4 9-7 9s-6-3-7-9z" fill=${P.gold} ...${O} />
    <path d="M23 8h14l-1 8H24z" fill=${P.cream} opacity=".7" />
    <path d="M30 35v14M22 51h16" stroke=${P.ink} stroke-width="3" stroke-linecap="round" />
    <path d="M30 35v13M23 50h14" stroke=${P.gold} stroke-width="1.6" stroke-linecap="round" />
    <circle class="bubble" cx="27" cy="26" r="1.6" fill=${P.cream} /><circle class="bubble" cx="32" cy="28" r="1.3" fill=${P.cream} /><circle class="bubble" cx="29" cy="30" r="1.2" fill=${P.cream} />
    <path d="M51 6v12M45 12h12M46.8 7.8l8.4 8.4M55.2 7.8l-8.4 8.4" stroke=${P.sun} stroke-width="2.4" stroke-linecap="round" />
    <path d="M49 32v7M45.5 35.5h7" stroke=${P.gold} stroke-width="2.2" stroke-linecap="round" />
    <path d="M13 40v6M10 43h6" stroke=${P.gold} stroke-width="2.2" stroke-linecap="round" />`,
  // two hearts, the big one beating
  valentines: html`
    <path d="M40 56s-17-11-17-23a9.5 9.5 0 0 1 17-5 9.5 9.5 0 0 1 17 5c0 12-17 23-17 23z" fill=${P.rose} ...${O} />
    <path d="M21 44s-12-8-12-17a7 7 0 0 1 12-4 7 7 0 0 1 12 4c0 9-12 17-12 17z" fill=${P.blush} ...${O} />
    <path d="M30 30c-2-4-1-7 2-8" fill="none" stroke=${P.cream} stroke-width="2.4" stroke-linecap="round" opacity=".85" />
    <circle cx="36" cy="38" r="1.6" fill=${P.ink} /><circle cx="44" cy="38" r="1.6" fill=${P.ink} />
    <path d="M37 43c2 2 5 2 7 0" fill="none" stroke=${P.ink} stroke-width="1.5" stroke-linecap="round" />`,
  // birthday cake, candles flickering
  birthday: html`
    <path d="M11 40h42v12a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4z" fill=${P.copper} ...${O} />
    <path d="M11 35h42v7c-3 3-6 3-8.5 0-3 3-6 3-8.5 0-3 3-6 3-8.5 0-3 3-6 3-8.5 0-3 3-6 3-8 0z" fill=${P.blush} ...${O} />
    <path d="M14 35h36v-8H14z" fill=${P.rust} ...${O} />
    ${[20, 32, 44].map((x, i) => html`<rect x=${x - 2.5} y="15" width="5" height="12" rx="1.5" fill=${[P.sky, P.cream, P.sun][i]} ...${O} />
      <path class="flame" d=${`M${x} 5c-3 3.5-3 7 0 9.5 3-2.5 3-6 0-9.5z`} fill=${P.orange} ...${O} />`)}
    <path d="M14 45h36" stroke=${P.gold} stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round" />`,
  // winter: a snowman
  winter: html`
    <circle cx="32" cy="45" r="16" fill=${P.cream} ...${O} />
    <circle cx="32" cy="24" r="11" fill=${P.cream} ...${O} />
    <path d="M22 10h20v5H22zM25 4h14v6H25z" fill=${P.ink} />
    <path d="M20 33c6 3 18 3 24 0" fill="none" stroke=${P.red} stroke-width="4" stroke-linecap="round" />
    <path d="M42 33l2 8" stroke=${P.red} stroke-width="4" stroke-linecap="round" />
    <g class="blink"><circle cx="28" cy="22" r="1.7" fill=${P.ink} /><circle cx="36" cy="22" r="1.7" fill=${P.ink} /></g>
    <path d="M32 25l9 2-9 2z" fill=${P.orange} ...${O} />
    <circle cx="32" cy="42" r="1.6" fill=${P.ink} /><circle cx="32" cy="49" r="1.6" fill=${P.ink} />
    <path d="M16 40l-8-4M48 40l8-4" stroke=${P.copper} stroke-width="2.6" stroke-linecap="round" />`,
  // spring: a tulip with a couple of friends
  spring: html`
    <path d="M32 58V34M20 58V42M44 58V42" stroke=${P.leaf} stroke-width="3" stroke-linecap="round" />
    <path d="M32 44c-6-2-9-6-9-12 3 1 5 3 6 6 0-4 1-7 3-9 2 2 3 5 3 9 1-3 3-5 6-6 0 6-3 10-9 12z" fill=${P.leaf} ...${O} />
    <path d="M23 36c0-7 3-11 9-14 6 3 9 7 9 14a9 9 0 0 1-18 0z" fill=${P.rose} ...${O} />
    <path d="M27 30c1-5 3-8 5-8s4 3 5 8" fill="none" stroke=${P.ink} stroke-width="1.6" stroke-linecap="round" />
    <path d="M14 44c0-5 2-8 6-10 4 2 6 5 6 10a6 6 0 0 1-12 0z" fill=${P.sun} ...${O} />
    <path d="M38 44c0-5 2-8 6-10 4 2 6 5 6 10a6 6 0 0 1-12 0z" fill=${P.blush} ...${O} />`,
  // summer: a sun in sunglasses, turning slowly
  summer: html`
    ${Array.from({ length: 10 }, (_, i) => html`<path d="M32 4l4 8h-8z" transform=${`rotate(${i * 36} 32 32)`} fill=${P.sun} ...${O} />`)}
    <circle cx="32" cy="32" r="16" fill=${P.sun} ...${O} />
    <path d="M18 28h10a4 4 0 0 1 4 4 4 4 0 0 1 4-4h10v3l-3 1a5 5 0 0 1-5 6h-2a5 5 0 0 1-4-5 5 5 0 0 1-4 5h-2a5 5 0 0 1-5-6l-3-1z" fill=${P.ink} />
    <path d="M25 41c3 4 11 4 14 0" fill="none" stroke=${P.ink} stroke-width="2" stroke-linecap="round" />`,
  // fall: a maple leaf on the turn
  fall: html`
    <path d="M32 8l5 10 8-5-2 10 10 2-8 7 7 8-11-1 1 11-10-7-10 7 1-11-11 1 7-8-8-7 10-2-2-10 8 5z" fill=${P.orange} ...${O} />
    <path d="M32 18v30M32 30l-8-6M32 30l8-6M32 40l-9-3M32 40l9-3" fill="none" stroke=${P.ember} stroke-width="1.8" stroke-linecap="round" />
    <path d="M32 48l-3 12" stroke=${P.copper} stroke-width="3" stroke-linecap="round" />
    <path d="M22 22l-4-3M42 22l4-3" stroke=${P.red} stroke-width="0" />`,
};

export const Emblem = ({ id, size = 64 }) => (ART[id]
  ? html`<svg class=${`emb emb-${id}`} width=${size} height=${size} viewBox="0 0 64 64" aria-hidden="true">${ART[id]}</svg>`
  : null);
