// Thanksgiving and Christmas dressing, the way halloween.mjs does Halloween: now and then a
// sprite (atlas from tools/halloween-sprites.py) walks across the bottom of the screen and is
// gone. Opacity, margin and stepped frames only. "?roam=elf|turkey|..." shows one at once.

import { useEffect, useState } from 'preact/hooks';
import { html } from './ui.mjs';

const FORCE = new URLSearchParams(location.search).get('roam');
const KINDS = {
  thanksgiving: ['turkey'],
  christmas: ['elf', 'reindeer', 'thief', 'santa'],
  diehard: ['bear', 'vent', 'vent'],
};
const between = (a, b) => a + Math.random() * (b - a);

export function SeasonFx({ accent, style }) {
  const [roamer, setRoamer] = useState(null);
  const kinds = KINDS[accent === 'christmas' && style === 'diehard' ? 'diehard' : accent] || [];
  useEffect(() => {
    let timer;
    const next = (first) => { timer = setTimeout(() => {
      setRoamer({ at: Date.now(), kind: FORCE || kinds[Math.floor(Math.random() * kinds.length)] });
      timer = setTimeout(() => { setRoamer(null); next(); }, 12200);
    }, FORCE ? 1000 : first ? between(8000, 15000) : between(25000, 60000)); };
    if (kinds.length) next(true);
    return () => clearTimeout(timer);
  }, [accent, style]);
  return html`<div class="sf" aria-hidden="true">
    ${roamer && html`<div class=${`sf-roam sf-${roamer.kind}`} key=${roamer.at}></div>`}
  </div>`;
}
