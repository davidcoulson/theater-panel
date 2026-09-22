// Light effects: previews and grouping. The lights offer 54 (accents) to 216 (WLED) effects whose
// names come from the light itself, so each name is matched to a family and drawn with a small
// procedural animation — no images, no per-effect artwork to keep up to date.

import { useRef, useEffect } from 'preact/hooks';
import { html } from './ui.mjs';

// name -> family. First match wins, so put the specific ones first.
const FAMILIES = [
  [/hearth|ember|fire(?!fly)|flame|candle|lava|torch/i, 'fire'],
  [/pacifica|ocean|wave|water|lagoon|current|ripple|rain|drip/i, 'water'],
  [/aurora|noise drift|plasma|nebula|galaxy|sky/i, 'aurora'],
  [/twinkle|star|firefly|fairy|glitter|sparkle|confetti|snow/i, 'stars'],
  [/fog|cloud|smoke|mist|breathe|glow|soft/i, 'fog'],
  [/chase|scanner|comet|meteor|sinelon|running|wipe|radar|pinwheel|lighthouse|pac-?man|marquee|theater/i, 'chase'],
  [/rainbow|colorloop|party|disco|dance|strobe|fireworks|shockwave|halloween/i, 'party'],
  [/heartbeat|pulse|metronome|beat|flicker/i, 'pulse'],
];
export const familyOf = (name) => (FAMILIES.find(([re]) => re.test(name || ''))?.[1] || 'glow');

// Families grouped into moods for the long lists.
export const MOODS = [
  { id: 'calm', name: 'Calm', families: ['fog', 'glow', 'water'] },
  { id: 'fire', name: 'Fire', families: ['fire'] },
  { id: 'sky', name: 'Sky', families: ['aurora'] },
  { id: 'stars', name: 'Stars', families: ['stars'] },
  { id: 'motion', name: 'Motion', families: ['chase', 'pulse'] },
  { id: 'party', name: 'Party', families: ['party'] },
];
export const moodOf = (name) => MOODS.find((m) => m.families.includes(familyOf(name)))?.id || 'calm';
export const byMood = (effects) => MOODS.map((m) => ({ ...m, effects: effects.filter((e) => moodOf(e) === m.id) })).filter((m) => m.effects.length);

// ---------- the drawings ----------
// Each family paints one frame at time t (seconds) into a w x h canvas: a strip of LEDs seen
// end-on, which is what these effects look like on the accents and the WLED strip.

const PALETTE = {
  fire: ['#2A0E03', '#7A2D06', '#D2600F', '#F0A128', '#FFD98A'],
  water: ['#04141F', '#0A3A55', '#17708F', '#3FB0B8', '#9BE7DE'],
  aurora: ['#0B0A22', '#13324F', '#1C7A63', '#56D08A', '#B7F2C8'],
  stars: ['#050510', '#101a35', '#2b3d6b', '#8FA8E8', '#FFFFFF'],
  fog: ['#0A0A0C', '#23242A', '#3E4048', '#6E717C', '#A7ABB6'],
  chase: ['#12060A', '#3A1030', '#8A1E5C', '#E0567F', '#FFD0C0'],
  party: ['#120014', '#4B0F6B', '#B32079', '#F0662E', '#FFE04D'],
  pulse: ['#1A0405', '#5A0A12', '#A81428', '#E8434F', '#FFB0A8'],
  glow: ['#140D06', '#3A2413', '#7A4A1E', '#C1823B', '#F0C88A'],
};
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function ramp(family, v) {
  const cols = PALETTE[family] || PALETTE.glow;
  const x = Math.max(0, Math.min(0.999, v)) * (cols.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = hex(cols[i]), b = hex(cols[Math.min(cols.length - 1, i + 1)]);
  return `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(lerp(a[2], b[2], f))})`;
}
// Cheap repeatable noise so previews look the same on every panel.
const noise = (x) => (Math.sin(x * 12.9898) * 43758.5453) % 1;
const wave = (x, t, k, s) => 0.5 + 0.5 * Math.sin(x * k + t * s);

// Intensity of the strip at position x (0..1) for this family at time t.
function level(family, x, t) {
  switch (family) {
    case 'fire': return Math.min(1, 0.25 + 0.5 * wave(x, t, 9, 2.1) * wave(x, t, 21, -3.3) + 0.35 * Math.abs(noise(Math.floor(x * 40) + Math.floor(t * 8))));
    case 'water': return 0.2 + 0.5 * wave(x, t, 7, 1.1) + 0.3 * wave(x, t, 17, -0.7);
    case 'aurora': return 0.15 + 0.6 * wave(x, t, 3, 0.5) * wave(x, t, 5, 0.31) + 0.25 * wave(x, t, 11, 0.9);
    case 'stars': { const s = Math.abs(noise(Math.floor(x * 60) * 7.7)); const tw = 0.5 + 0.5 * Math.sin(t * 3 + s * 30); return s > 0.86 ? 0.35 + 0.65 * tw : 0.06; }
    case 'fog': return 0.25 + 0.45 * wave(x, t, 2.2, 0.35) + 0.2 * wave(x, t, 6, -0.22);
    case 'chase': { const head = (t * 0.45) % 1; const d = Math.min(Math.abs(x - head), 1 - Math.abs(x - head)); return Math.max(0.05, 1 - d * 7); }
    case 'party': return 0.3 + 0.7 * wave(x, t, 14, 3.4) * (0.5 + 0.5 * Math.sin(t * 5));
    case 'pulse': { const beat = (t % 1.1) / 1.1; const p = Math.exp(-8 * beat) + 0.6 * Math.exp(-8 * Math.abs(beat - 0.22)); return Math.min(1, 0.12 + p * (0.8 - 0.3 * Math.abs(x - 0.5))); }
    default: return 0.35 + 0.3 * wave(x, t, 1.5, 0.25);
  }
}

// The nav rail's ambient glow: the same families painted vertically as a soft gradient (no LED
// blocks), so the wood column feels lit by whatever the accents are doing.
function paintRail(ctx, family, w, h, t, speed = 0.5) {
  const tt = t * (0.2 + speed * 0.5);
  const steps = 40, bh = h / steps;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < steps; i++) {
    const y = i / (steps - 1);
    const v = Math.max(0, Math.min(1, level(family, y, tt)));
    ctx.fillStyle = ramp(family, v * 0.85);
    ctx.fillRect(0, i * bh - 1, w, bh + 2);
  }
}

// A strip of LED-ish blocks; speed 0..1 stretches time, so the preview follows the speed slider.
function paint(ctx, family, w, h, t, speed = 0.5) {
  const leds = Math.max(12, Math.round(w / 14));
  const tt = t * (0.35 + speed * 1.3);
  const gap = Math.max(1, Math.round(w / leds / 8));
  const bw = w / leds;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < leds; i++) {
    const x = i / (leds - 1);
    const v = Math.max(0, Math.min(1, level(family, x, tt)));
    ctx.fillStyle = ramp(family, v);
    ctx.fillRect(i * bw, 0, bw - gap, h);
  }
}

// ---------- components ----------

// Animated preview of one effect. Runs at 12 fps (the panel's GPU dislikes busy canvases) and
// only while on screen.
export function EffectPreview({ name, family, speed = 0.5, h = 46, round = 10, still = false, cls = '' }) {
  const ref = useRef();
  const fam = family || familyOf(name);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const size = () => { const r = cv.getBoundingClientRect(); cv.width = Math.max(40, Math.round(r.width)); cv.height = Math.round(r.height || h); };
    size();
    if (still) { paint(ctx, fam, cv.width, cv.height, 3, speed); return; }
    let live = true, t0 = performance.now();
    const loop = () => {
      if (!live) return;
      paint(ctx, fam, cv.width, cv.height, (performance.now() - t0) / 1000, speed);
      setTimeout(() => requestAnimationFrame(loop), 83);
    };
    loop();
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    return () => { live = false; ro.disconnect(); };
  }, [fam, speed, still]);
  return html`<canvas class=${`fx ${cls}`} ref=${ref} style=${`height:${h}px;border-radius:${round}px`} aria-hidden="true"></canvas>`;
}

// Ambient glow down the nav rail. Silent when nothing is running, and blended into the wood.
export function RailGlow({ name, speed = 0.4, opacity = 0.55 }) {
  const ref = useRef();
  const fam = name ? familyOf(name) : null;
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !fam) return;
    const ctx = cv.getContext('2d');
    cv.width = 70; cv.height = 360;      // upscaled by CSS: cheap and soft
    let live = true; const t0 = performance.now();
    const loop = () => {
      if (!live) return;
      paintRail(ctx, fam, cv.width, cv.height, (performance.now() - t0) / 1000, speed);
      setTimeout(() => requestAnimationFrame(loop), 125);
    };
    loop();
    return () => { live = false; };
  }, [fam, speed]);
  if (!fam) return null;
  return html`<canvas class="rail-glow" ref=${ref} style=${`opacity:${opacity}`} aria-hidden="true"></canvas>`;
}

// A tile: preview with the effect's name under it.
export const EffectTile = ({ name, speed, active, onPick, h = 54 }) => html`
  <button type="button" class=${`fx-tile ${active ? 'on' : ''}`} aria-pressed=${active ? 'true' : 'false'} onClick=${() => onPick(name)}>
    <${EffectPreview} name=${name} speed=${speed} h=${h} />
    <span class="ellipsis">${name}</span>
  </button>`;
