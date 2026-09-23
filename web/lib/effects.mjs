// Light effects: previews and grouping. The lights offer 54 (accents) to 216 (WLED) effects whose
// names come from the light itself, so each name is matched to a family and drawn with a small
// procedural animation — no images, no per-effect artwork to keep up to date.

import { useRef, useEffect } from 'preact/hooks';
import { html } from './ui.mjs';

// name -> family. First match wins, so put the specific ones first.
const FAMILIES = [
  // WLED's particle-system effects ("PS ...", WLED 0.15+): things fall, bounce, spray and collide.
  [/^ps .*(geq|nova)|geq/i, 'geq'],
  [/^ps .*(waterfall|drip|spray|fountain|fuzzy)/i, 'spray'],
  [/^ps .*(box|hourglass|sand)/i, 'sand'],
  [/^ps .*(impact|pinball|collide|bounce)/i, 'impact'],
  [/^ps .*(ballpit|blob|bubble)/i, 'bubbles'],
  [/^ps .*(attractor|ghost rider|orbit|galaxy)/i, 'orbit'],
  [/^ps .*(dancing shadows|shadow)/i, 'shadows'],
  [/^ps .*(firework|rocket)/i, 'fireworks'],
  [/^ps .*(fire|flame)/i, 'fire'],
  [/^ps .*(sparkler|glitter|star)/i, 'stars'],
  [/^ps .*(chase|wrap)/i, 'chase'],
  [/^ps /i, 'party'],   // any other particle effect
  // The accents' own effects first, most specific first, then general Home Assistant / WLED names.
  [/pac-?man/i, 'pacman'],
  [/lighthouse/i, 'lighthouse'],
  [/pinwheel/i, 'pinwheel'],
  [/radar/i, 'radar'],
  [/shockwave/i, 'shockwave'],
  [/ripple/i, 'ripple'],
  [/bubble/i, 'bubbles'],
  [/chunchun|flock|bird/i, 'flock'],
  [/weather/i, 'weather'],
  [/disco|mirror ball/i, 'disco'],
  [/halloween|eyes/i, 'eyes'],
  [/firework/i, 'fireworks'],
  [/plasma/i, 'plasma'],
  [/confetti/i, 'confetti'],
  [/rainbow|colorloop/i, 'rainbow'],
  [/comet|meteor/i, 'comet'],
  [/sinelon/i, 'sinelon'],
  [/scanner|scan\b/i, 'scanner'],
  [/theater chase|marquee/i, 'marquee'],
  [/orbit/i, 'orbit'],
  [/firefly/i, 'firefly'],
  [/metronome/i, 'metronome'],
  [/radial flicker/i, 'flicker'],
  [/hearth|ember|fire(?!fly)|flame|candle|lava|torch/i, 'fire'],
  [/pacifica|ocean|wave|water|lagoon|current|rain|drip/i, 'water'],
  [/aurora|noise drift|nebula|galaxy|sky/i, 'aurora'],
  [/twinkle|star|fairy|glitter|sparkle|snow/i, 'stars'],
  [/fog|cloud|smoke|mist|breathe|glow|soft/i, 'fog'],
  [/chase|sweep|runner|running|wipe|saw|juggle|tetrix/i, 'chase'],
  [/party|dance|strobe|blink|colorful|random|dynamic|dissolve|noise|lake|police|traffic/i, 'party'],
  [/heartbeat|pulse|beat|flicker|blend|android/i, 'pulse'],
  [/solid|static|preset/i, 'glow'],
];

export const familyOf = (name) => (FAMILIES.find(([re]) => re.test(name || ''))?.[1] || 'glow');

// Families grouped into moods for the long lists.
export const MOODS = [
  { id: 'calm', name: 'Calm', families: ['fog', 'glow', 'water', 'ripple', 'bubbles', 'weather'] },
  { id: 'fire', name: 'Fire', families: ['fire', 'flicker'] },
  { id: 'sky', name: 'Sky', families: ['aurora', 'plasma'] },
  { id: 'stars', name: 'Stars', families: ['stars', 'firefly', 'orbit', 'flock'] },
  { id: 'motion', name: 'Motion', families: ['chase', 'comet', 'sinelon', 'scanner', 'marquee', 'radar', 'lighthouse', 'pinwheel', 'shockwave', 'pulse', 'metronome', 'pacman'] },
  { id: 'party', name: 'Party', families: ['party', 'disco', 'confetti', 'fireworks', 'rainbow', 'eyes'] },
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
  plasma: ['#12042A', '#4B1178', '#9B1FA8', '#E24E8E', '#FFC7E0'],
  bubbles: ['#03121C', '#0B3346', '#166C86', '#63C4D6', '#DFF7FB'],
  flock: ['#0B0F16', '#1E2A3A', '#3F5A73', '#8FB0C9', '#E6F0F7'],
  weather: ['#0A1016', '#1B2B38', '#39566B', '#7FA0B4', '#DCE9F0'],
  disco: ['#0A0A12', '#2B1150', '#7A2AA8', '#DD62C8', '#FFFFFF'],
  eyes: ['#0B0402', '#2A0A06', '#7A1208', '#D93B14', '#FFB169'],
  fireworks: ['#07030F', '#2C1046', '#9B2C7A', '#F5A43C', '#FFF3C4'],
  pacman: ['#060608', '#1A1A28', '#3A3A12', '#C9C31E', '#FFF89B'],
  lighthouse: ['#050810', '#132139', '#2E4C77', '#8FB6E8', '#FFFFFF'],
  pinwheel: ['#0B0714', '#33125A', '#8A2C86', '#E06BA0', '#FFD9E8'],
  radar: ['#020C06', '#0A2C18', '#14683A', '#3FC97A', '#CFF8DF'],
  shockwave: ['#04101A', '#0C3550', '#1E7391', '#65C6D8', '#EAFBFF'],
  ripple: ['#041018', '#0D3044', '#1A6B84', '#5FBCCB', '#E4F8FC'],
  comet: ['#05060F', '#171B3A', '#3B4590', '#8FA0E8', '#FFFFFF'],
  sinelon: ['#12030B', '#3F0A2A', '#9B1C55', '#E8578C', '#FFD4E4'],
  scanner: ['#100303', '#3D0808', '#8F1212', '#E63C3C', '#FFC2C2'],
  marquee: ['#120C02', '#3E2A06', '#8A5F0F', '#E0A62A', '#FFE7A8'],
  orbit: ['#04040C', '#131436', '#2F3170', '#7C80D8', '#F2F3FF'],
  firefly: ['#060A04', '#16240C', '#38571A', '#87C23A', '#E8FFB0'],
  metronome: ['#0C0A06', '#2E2614', '#6B5A2A', '#C0A64F', '#FFEFC0'],
  flicker: ['#160603', '#4A1206', '#96300B', '#DE6E1E', '#FFD79B'],
  geq: ['#06060E', '#141A40', '#2E7A6B', '#9CD24A', '#FFF07A'],
  spray: ['#03141C', '#0B3A4C', '#177C93', '#5FC3D6', '#F0FCFF'],
  sand: ['#100B04', '#33240E', '#6E5222', '#C09A4A', '#F5E3B8'],
  impact: ['#120407', '#3D0E1C', '#8C2340', '#E05C72', '#FFD3D8'],
  shadows: ['#06070A', '#181C26', '#3A4457', '#7C8AA3', '#D8E0EC'],
  rainbow: ['#000000'],   // drawn from hue instead of a ramp
  confetti: ['#000000'],
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
    // The accents' own effects, each with its own movement.
    case 'plasma': return 0.2 + 0.4 * wave(x, t, 5, 0.9) + 0.4 * wave(x, t, 13, -1.4) * wave(x, t, 3, 0.5);
    case 'bubbles': { let v = 0.08; for (let k = 0; k < 4; k++) { const b = (noise(k * 3.3) + t * (0.12 + k * 0.05)) % 1; const d = Math.abs(x - Math.abs(b)); v = Math.max(v, 1 - d * 16); } return v; }
    case 'flock': { let v = 0.07; for (let k = 0; k < 5; k++) { const p = ((t * 0.35 + k * 0.17) % 1.2) - 0.1; const d = Math.abs(x - p); v = Math.max(v, (1 - d * 22) * (0.6 + 0.4 * Math.sin(t * 6 + k))); } return v; }
    case 'weather': return 0.18 + 0.35 * wave(x, t, 1.8, 0.2) + 0.3 * (Math.abs(noise(Math.floor(x * 50) + Math.floor(t * 6))) > 0.8 ? 1 : 0);
    case 'disco': { const s2 = Math.abs(noise(Math.floor(x * 30 + t * 3) * 5.1)); return s2 > 0.8 ? 1 : 0.12 + 0.15 * wave(x, t, 8, 2); }
    case 'eyes': { const pair = Math.floor(x * 5); const open = Math.sin(t * 1.3 + pair * 2.1) > 0.3 ? 1 : 0.05; const near = Math.abs((x * 5) % 1 - 0.5) < 0.22 ? 1 : 0.08; return Math.min(1, open * near); }
    case 'fireworks': { const burst = (t * 0.6) % 1; const centre = Math.abs(noise(Math.floor(t * 0.6) * 7.7)); const r = burst * 0.7; const d = Math.abs(x - centre); return Math.max(0.05, (1 - Math.abs(d - r) * 18) * (1 - burst)); }
    case 'pacman': { const head = (t * 0.4) % 1.1 - 0.05; const mouth = 0.6 + 0.4 * Math.abs(Math.sin(t * 9)); const d = x - head; if (Math.abs(d) < 0.05 * mouth) return 1; return d > 0.02 && Math.abs((x * 22) % 1 - 0.5) < 0.12 ? 0.55 : 0.05; }
    case 'lighthouse': { const beam = (t * 0.22) % 1; const d = Math.min(Math.abs(x - beam), 1 - Math.abs(x - beam)); return Math.max(0.05, Math.pow(Math.max(0, 1 - d * 6), 2)); }
    case 'pinwheel': { const a = (x * 4 + t * 0.7) % 1; return 0.08 + 0.92 * Math.pow(Math.max(0, Math.cos(a * Math.PI * 2)), 6); }
    case 'radar': { const sweep = (t * 0.3) % 1; const behind = (x - sweep + 1) % 1; return Math.max(0.06, 1 - behind * 3.2); }
    case 'shockwave': { const r = (t * 0.35) % 1; const d = Math.abs(Math.abs(x - 0.5) * 2 - r); return Math.max(0.05, (1 - d * 10) * (1 - r * 0.6)); }
    case 'ripple': { const r = (t * 0.28) % 1; const d = Math.abs(Math.abs(x - 0.5) * 2 - r); return Math.max(0.1, 0.25 + 0.75 * (1 - Math.min(1, d * 8)) * (1 - r)); }
    case 'comet': { const head = (t * 0.5) % 1.2 - 0.1; const behind = head - x; return behind >= 0 ? Math.max(0.04, 1 - behind * 5) : Math.max(0.04, 1 - (x - head) * 40); }
    case 'sinelon': { const p = 0.5 + 0.45 * Math.sin(t * 1.6); const d = Math.abs(x - p); return Math.max(0.06, 1 - d * 12); }
    case 'scanner': { const p = 0.5 + 0.45 * Math.sin(t * 2.4); const d = Math.abs(x - p); return Math.max(0.05, 1 - d * 9); }
    case 'marquee': { const step = Math.floor(x * 24 - t * 3); return step % 3 === 0 ? 1 : 0.08; }
    case 'orbit': { const p = (t * 0.12) % 1; const d = Math.min(Math.abs(x - p), 1 - Math.abs(x - p)); return Math.max(0.08, 1 - d * 10); }
    case 'firefly': { const s3 = Math.abs(noise(Math.floor(x * 24) * 9.1)); const blink = 0.5 + 0.5 * Math.sin(t * 2 + s3 * 20); return s3 > 0.7 ? 0.2 + 0.8 * Math.pow(blink, 3) : 0.05; }
    case 'metronome': { const p = 0.5 + 0.42 * Math.sin(t * 3.2); const d = Math.abs(x - p); return Math.max(0.05, 1 - d * 14); }
    case 'geq': { const band = Math.floor(x * 12); const h2 = 0.25 + 0.75 * Math.abs(Math.sin(t * (1.4 + band * 0.27) + band)); return Math.abs((x * 12) % 1 - 0.5) < 0.38 ? h2 : 0.05; }
    case 'spray': { let v = 0.06; for (let k = 0; k < 6; k++) { const born = (t * 0.5 + k * 0.17) % 1; const p = 0.08 + born * 0.9; const d = Math.abs(x - p); v = Math.max(v, (1 - d * 26) * (1 - born * 0.8)); } return v; }
    case 'sand': { const fill = 0.5 + 0.45 * Math.sin(t * 0.5); const settled = x < fill ? 0.85 : 0.08; const grain = 0.15 * Math.abs(noise(Math.floor(x * 40) + Math.floor(t * 4))); return Math.min(1, settled + grain); }
    case 'impact': { const hit = (t * 0.8) % 1; const p = Math.abs(Math.sin(t * 1.7)); const d = Math.abs(x - p); return Math.max(0.05, (1 - d * 14) * (0.4 + 0.6 * Math.exp(-6 * hit))); }
    case 'shadows': { const a = wave(x, t, 2.5, 0.5) * wave(x, t, 7, -0.8); return 0.12 + 0.7 * a; }
    case 'flicker': { const n = Math.abs(noise(Math.floor(t * 12) + Math.floor(x * 8))); return 0.2 + 0.8 * n * (0.6 + 0.4 * wave(x, t, 4, 1.2)); }
    default: return 0.35 + 0.3 * wave(x, t, 1.5, 0.25);
  }
}

// Families whose colour comes from a hue sweep rather than a palette.
function hueShade(family, x, t) {
  if (family === 'rainbow') return `hsl(${Math.round(((x * 300 + t * 40) % 360))} 85% ${Math.round(38 + 22 * wave(x, t, 6, 1.4))}%)`;
  // confetti: bright specks of random hue on near-black
  const cell = Math.floor(x * 26);
  const seed = Math.abs(noise(cell * 4.7 + Math.floor(t * 1.5) * 13.1));
  return seed > 0.72 ? `hsl(${Math.round(seed * 1440 % 360)} 90% ${Math.round(45 + 25 * Math.abs(Math.sin(t * 5 + cell)))}%)` : '#0A0710';
}
const HUE_FAMILIES = new Set(['rainbow', 'confetti']);

// The colour of one point of the strip.
function shade(family, x, t) {
  return HUE_FAMILIES.has(family) ? hueShade(family, x, t) : ramp(family, Math.max(0, Math.min(1, level(family, x, t))));
}

// The nav rail's ambient glow: the same families painted vertically as a soft gradient (no LED
// blocks), so the wood column feels lit by whatever the accents are doing.
function paintRail(ctx, family, w, h, t, speed = 0.5) {
  const tt = t * (0.26 + speed * 0.65);   // ~25% quicker than the first pass
  const steps = 60, bh = h / steps;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < steps; i++) {
    const y = i / (steps - 1);
    // A floor under the pattern, so the whole column stays lit rather than going dark in bands,
    // and a push towards the bright end of the palette so the colour actually reads on the wood.
    ctx.fillStyle = HUE_FAMILIES.has(family) ? hueShade(family, y, tt)
      : ramp(family, Math.min(1, 0.5 + 0.7 * Math.max(0, Math.min(1, level(family, y, tt)))));
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
    ctx.fillStyle = shade(family, x, tt);
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
