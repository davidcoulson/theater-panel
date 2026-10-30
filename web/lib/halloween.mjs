// Halloween dressing for the whole panel: slow grey, green and purple fog, jack-o'-lanterns that
// flicker in the corner, and now and then a ghost, zombie, skeleton or witch that fades in somewhere, drifts through its
// frames and is gone. Everything is opacity or a stepped sprite frame - no blur, no transforms,
// which the panel's GPU dislikes. Sprite strips (six frames) come from tools/halloween-sprites.py.

import { useEffect, useState } from 'preact/hooks';
import { html } from './ui.mjs';

const FORCE = new URLSearchParams(location.search).get('hw');   // ?hw=witch|zombie|... shows that one at once
const FIRST_GHOST = FORCE ? [1000, 1000] : [8000, 15000];
const GHOST_EVERY = [20000, 50000];   // ms between apparitions
const GHOST_STAYS = 9000;

const KINDS = ['ghost', 'ghost', 'zombie', 'skeleton', 'witch'];   // what turns up next
const between = ([a, b]) => a + Math.random() * (b - a);

function useGhost() {
  const [ghost, setGhost] = useState(null);
  useEffect(() => {
    let timer;
    const next = (range = GHOST_EVERY) => { timer = setTimeout(() => {
      setGhost({ at: Date.now(), kind: FORCE || KINDS[Math.floor(Math.random() * KINDS.length)], x: 160 + Math.random() * 1300, y: 120 + Math.random() * 380, flip: Math.random() < 0.5 });
      timer = setTimeout(() => { setGhost(null); next(); }, GHOST_STAYS + 200);
    }, between(range)); };
    next(FIRST_GHOST);
    return () => clearTimeout(timer);
  }, []);
  return ghost;
}

export function HalloweenFx() {
  const ghost = useGhost();
  return html`<div class="hw" aria-hidden="true">
    <div class="hw-fog hw-fog-a"></div><div class="hw-fog hw-fog-b"></div><div class="hw-fog hw-fog-c"></div><div class="hw-fog hw-fog-low"></div>
    ${ghost && html`<div class=${`hw-ghost hw-${ghost.kind} ${ghost.flip ? 'flip' : ''}`} key=${ghost.at} style=${`left:${ghost.x}px;top:${ghost.y}px`}></div>`}
    <div class="hw-pumpkin hw-pumpkin-a"></div><div class="hw-pumpkin hw-pumpkin-b"></div>
  </div>`;
}
