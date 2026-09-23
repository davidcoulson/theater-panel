// Weather over the lobby: snow, leaves, petals and confetti fall through the room and settle on
// the tops of the cards; hearts drift up, fireflies wander, bats cross the top of the screen.
// One canvas the size of the stage, redrawn at 20 fps, no blur filters and no transformed
// layers (the panel's GPU speckles on those). What has settled is remembered per ledge - the
// top edge of each card - and slowly clears, so it never buries the page.

import { useEffect, useRef } from 'preact/hooks';
import { html } from './ui.mjs';

const W = 1920, H = 1080;
const KINDS = {
  snow: { n: 90, vy: [26, 64], sway: 14, size: [2, 5], land: 'mound', colors: ['#FAF8F2'], men: true },
  // Christmas is snow with a sleigh that crosses now and then.
  xmas: { n: 90, vy: [26, 64], sway: 14, size: [2, 5], land: 'mound', colors: ['#FAF8F2'], men: true, sleigh: true },
  leaves: { n: 26, vy: [45, 100], sway: 40, size: [8, 13], land: 'scatter', colors: ['#C75E12', '#E8731C', '#8F4E1C', '#B3372B', '#E3A865'] },
  petals: { n: 34, vy: [30, 70], sway: 30, size: [5, 8], land: 'scatter', colors: ['#F2A0B2', '#F7C6D0', '#FBE7EC', '#E3A865'] },
  confetti: { n: 60, vy: [80, 160], sway: 36, size: [5, 8], land: 'scatter', colors: ['#D9536F', '#E3A865', '#4E7D3A', '#3F7FB5', '#F2D69B', '#E8731C'], rect: true },
  hearts: { n: 14, vy: [-34, -16], sway: 18, size: [7, 13], land: null, colors: ['#D9536F', '#F2A0B2'] },
  fireflies: { n: 22, land: null, wander: true, colors: ['#F2D69B'] },
  bats: { n: 3, land: null, bats: true },
};
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const COL = 6;                                 // width of one column of a snow mound
const MAX_MOUND = 16, MAX_SCATTER = 40;

function spawn(k, fresh) {
  const p = { x: rnd(0, W), size: rnd(...(k.size || [3, 6])), color: pick(k.colors || ['#fff']), phase: rnd(0, 6.28), rot: rnd(0, 6.28), spin: rnd(-2, 2) };
  if (k.wander) { p.y = rnd(80, H - 80); p.vx = rnd(-20, 20); p.vy = rnd(-14, 14); p.blink = rnd(0.4, 1.2); return p; }
  if (k.bats) { p.y = rnd(30, 260); p.x = -80 - rnd(0, W); p.vx = rnd(120, 200); p.size = rnd(22, 34); p.flap = rnd(6, 9); return p; }
  p.vy = rnd(...k.vy);
  if (p.vy < 0) { p.y = fresh ? rnd(0, H) : H + 20; p.alpha = 1; }   // rises from the bottom
  else p.y = fresh ? rnd(-H, 0) : -20;
  return p;
}

// The tops of the cards, in stage coordinates, as ledges things can land on.
function findLedges(canvas) {
  const stage = canvas.parentElement;
  const sr = stage.getBoundingClientRect();
  const z = sr.width / W || 1;
  const ledges = [];
  for (const el of stage.querySelectorAll('.card, .hero, .musicbar, .scene, .chip, .btn.primary, .proj .tile')) {
    const r = el.getBoundingClientRect();
    if (r.width < 60 * z || r.height < 24 * z) continue;
    const x0 = (r.left - sr.left) / z, x1 = (r.right - sr.left) / z, y = (r.top - sr.top) / z;
    if (y < 8 || y > H - 8) continue;
    ledges.push({ x0, x1, y, cols: new Float32Array(Math.ceil((x1 - x0) / COL)), items: [], men: [] });
  }
  ledges.push({ x0: 140, x1: W, y: H, cols: new Float32Array(Math.ceil((W - 140) / COL)), items: [], men: [] });   // the floor
  return ledges;
}

function heightAt(l, x) { const c = Math.floor((x - l.x0) / COL); return c >= 0 && c < l.cols.length ? l.cols[c] : 0; }

function land(k, l, p) {
  if (k.land === 'mound') {
    const c = Math.floor((p.x - l.x0) / COL);
    for (const [d, w] of [[0, 1.6], [-1, 0.8], [1, 0.8], [-2, 0.3], [2, 0.3]]) {
      const i = c + d; if (i >= 0 && i < l.cols.length) l.cols[i] = Math.min(MAX_MOUND, l.cols[i] + w);
    }
  } else {
    l.items.push({ x: p.x, y: l.y - heightAt(l, p.x) - 1, size: p.size, color: p.color, rot: rnd(-0.6, 0.6), rect: k.rect });
    if (l.items.length > MAX_SCATTER) l.items.shift();
  }
}

function drawHeart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.2, y, x - s * 0.6, y - s * 0.9, x, y - s * 0.3);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 0.9, x + s * 1.2, y, x, y + s * 0.9);
  ctx.fill();
}
function drawBat(ctx, x, y, s, t, flap) {
  const f = Math.sin(t * flap) * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - s * 0.5, y - s * (0.6 + f), x - s, y - s * 0.1);
  ctx.quadraticCurveTo(x - s * 0.7, y + s * 0.15, x - s * 0.5, y + s * 0.05);
  ctx.quadraticCurveTo(x - s * 0.25, y + s * 0.3, x, y + s * 0.15);
  ctx.quadraticCurveTo(x + s * 0.25, y + s * 0.3, x + s * 0.5, y + s * 0.05);
  ctx.quadraticCurveTo(x + s * 0.7, y + s * 0.15, x + s, y - s * 0.1);
  ctx.quadraticCurveTo(x + s * 0.5, y - s * (0.6 + f), x, y);
  ctx.fill();
}

// Ghosts and ghouls: only when the weather is turned up. They drift across slowly, half
// see-through, bobbing; a ghoul is the greener, grinning kind.
function spawnGhost(fresh) {
  const slimer = Math.random() < 0.6;                                   // the green, greedy kind
  return { slimer, x: fresh ? rnd(200, W - 200) : (Math.random() < 0.5 ? -140 : W + 140), y: rnd(120, H - 260), vx: rnd(18, 34) * (Math.random() < 0.5 ? 1 : -1),
    size: rnd(95, 140), phase: rnd(0, 6.28), bob: rnd(0.6, 1.1), life: 0, span: rnd(18, 30),
    // each one fades away and materialises again on its own slow cycle, about 8-13 seconds
    ghostly: rnd(0.48, 0.8), ghostlyPhase: rnd(0, 6.28) };
}
// A blobby little spook: Slimer's cousin, drawn green with a fat belly, stubby arms and a tongue
// out, or the classic sheet ghost. Solid enough to read across the room, still see-through.
function drawGhost(ctx, g, t) {
  const s = g.size, x = g.x, y = g.y + Math.sin(t * g.bob + g.phase) * 10;
  const fade = Math.min(1, g.life / 3, (g.span - g.life) / 3);
  const wob = Math.sin(t * 2 + g.phase) * s * 0.02;
  // Materialising: mostly gone, swelling up to solid and sinking away again, so one appears out
  // of nowhere in the middle of the room rather than simply sliding in from the edge.
  const shimmer = Math.pow(0.5 + 0.5 * Math.sin(t * g.ghostly + g.ghostlyPhase), 1.8);
  const alpha = Math.max(0, fade) * (g.slimer ? 0.72 : 0.64) * shimmer;
  if (alpha < 0.015) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (g.vx < 0) ctx.scale(-1, 1);

  if (g.slimer) {
    // body: a pear of a thing, wider at the belly, with a trailing wisp
    ctx.fillStyle = '#7FB63C';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.bezierCurveTo(s * 0.44, -s * 0.5, s * 0.5, -s * 0.02, s * 0.36, s * 0.2);
    ctx.bezierCurveTo(s * 0.5, s * 0.34 + wob, s * 0.22, s * 0.58, 0, s * 0.46);
    ctx.bezierCurveTo(-s * 0.24, s * 0.6, -s * 0.5, s * 0.32 - wob, -s * 0.36, s * 0.2);
    ctx.bezierCurveTo(-s * 0.5, -s * 0.02, -s * 0.44, -s * 0.5, 0, -s * 0.5);
    ctx.fill();
    // stubby arms
    ctx.beginPath();
    ctx.ellipse(-s * 0.42, s * 0.04, s * 0.16, s * 0.1, -0.5 + wob * 0.04, 0, 6.29);
    ctx.ellipse(s * 0.42, s * 0.04, s * 0.16, s * 0.1, 0.5 - wob * 0.04, 0, 6.29);
    ctx.fill();
    // a lighter belly, so he reads as round rather than a flat blob
    ctx.fillStyle = '#9BD155';
    ctx.beginPath(); ctx.ellipse(0, s * 0.18, s * 0.26, s * 0.2, 0, 0, 6.29); ctx.fill();
    // eyes: whites with pupils, one lid heavier than the other
    ctx.fillStyle = '#F7F4EA';
    ctx.beginPath(); ctx.ellipse(-s * 0.15, -s * 0.24, s * 0.13, s * 0.15, -0.1, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.17, -s * 0.25, s * 0.11, s * 0.13, 0.1, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#1B1210';
    ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.22, s * 0.055, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.19, -s * 0.23, s * 0.05, 0, 6.29); ctx.fill();
    // open mouth and tongue
    ctx.fillStyle = '#2A1911';
    ctx.beginPath(); ctx.ellipse(s * 0.02, s * 0.02, s * 0.17, s * 0.13, 0.08, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#E2708C';
    ctx.beginPath(); ctx.ellipse(s * 0.04, s * 0.09 + wob, s * 0.1, s * 0.07, 0.1, 0, 6.29); ctx.fill();
  } else {
    ctx.fillStyle = '#F7F4EA';
    ctx.beginPath();
    ctx.arc(0, -s * 0.15, s * 0.42, Math.PI, 0);                        // head
    ctx.lineTo(s * 0.42, s * 0.45);
    for (let i = 4; i >= 0; i--) {                                      // wavy hem
      const hx = -s * 0.42 + (s * 0.84 * i) / 4;
      ctx.quadraticCurveTo(hx + s * 0.105, s * 0.45 + (i % 2 ? -1 : 1) * s * 0.12 + Math.sin(t * 3 + i) * 3, hx, s * 0.45);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1B1210';
    ctx.beginPath(); ctx.ellipse(-s * 0.14, -s * 0.2, s * 0.07, s * 0.1, 0, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.14, -s * 0.2, s * 0.07, s * 0.1, 0, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, s * 0.06, s * 0.07, s * 0.1, 0, 0, 6.29); ctx.fill();   // "oooo"
  }
  ctx.restore();
}

// A snowman builds himself out of a deep enough drift, and melts away with it.
function drawSnowman(ctx, x, base, h) {
  const r1 = h * 0.26, r2 = h * 0.2, r3 = h * 0.15;
  const y1 = base - r1, y2 = y1 - r1 * 0.75 - r2 * 0.75, y3 = y2 - r2 * 0.7 - r3 * 0.7;
  ctx.strokeStyle = '#6B4A2A'; ctx.lineWidth = Math.max(1, h * 0.035); ctx.lineCap = 'round';
  ctx.beginPath();                                                     // stick arms
  ctx.moveTo(x - r2 * 0.9, y2); ctx.lineTo(x - r2 * 2, y2 - r2 * 0.7);
  ctx.moveTo(x + r2 * 0.9, y2); ctx.lineTo(x + r2 * 2, y2 - r2 * 0.5);
  ctx.stroke();
  ctx.fillStyle = '#FAF8F2';
  for (const [cy, r] of [[y1, r1], [y2, r2], [y3, r3]]) { ctx.beginPath(); ctx.arc(x, cy, r, 0, 6.29); ctx.fill(); }
  ctx.fillStyle = '#2A1911';
  ctx.beginPath(); ctx.arc(x - r3 * 0.35, y3 - r3 * 0.2, h * 0.022, 0, 6.29); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r3 * 0.35, y3 - r3 * 0.2, h * 0.022, 0, 6.29); ctx.fill();
  for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(x, y2 - r2 * 0.3 + i * r2 * 0.6, h * 0.022, 0, 6.29); ctx.fill(); }
  ctx.fillRect(x - r3 * 1.1, y3 - r3 * 1.05, r3 * 2.2, h * 0.03);      // hat brim
  ctx.fillRect(x - r3 * 0.6, y3 - r3 * 1.05 - h * 0.11, r3 * 1.2, h * 0.11);
  ctx.fillStyle = '#E8731C';                                            // carrot
  ctx.beginPath(); ctx.moveTo(x, y3 - h * 0.01); ctx.lineTo(x + r3 * 1.1, y3 + h * 0.01); ctx.lineTo(x, y3 + h * 0.035); ctx.fill();
}

// Santa's sleigh: red and gold, a stack of presents in the back, two reindeer in harness with
// Rudolph up front, and a wake of glitter that fades behind them.
const GIFTS = ['#C8322B', '#2F5E2A', '#3F7FB5', '#E2708C', '#F2C94C'];
const SPARKS = ['#F2D69B', '#FFFDF5', '#CFE0EC', '#E3A865'];
function drawSleigh(ctx, x, y, s, t, dir) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const bob = Math.sin(t * 3) * s * 0.05;

  // ---- sleigh ----
  ctx.strokeStyle = '#E3A865'; ctx.lineWidth = s * 0.07;               // gold runner
  ctx.beginPath();
  ctx.moveTo(-s * 1.05, s * 0.36 + bob); ctx.lineTo(-s * 0.3, s * 0.36 + bob);
  ctx.quadraticCurveTo(-s * 0.12, s * 0.36 + bob, -s * 0.16, s * 0.18 + bob);
  ctx.stroke();
  ctx.fillStyle = '#C8322B';                                           // body
  ctx.beginPath();
  ctx.moveTo(-s * 1.0, s * 0.3 + bob); ctx.lineTo(-s * 1.0, -s * 0.05 + bob);
  ctx.quadraticCurveTo(-s * 0.6, -s * 0.1 + bob, -s * 0.3, -s * 0.02 + bob);
  ctx.lineTo(-s * 0.3, s * 0.3 + bob); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#E3A865'; ctx.lineWidth = s * 0.04; ctx.stroke();  // gold trim

  // ---- presents in the back ----
  const boxes = [[-s * 0.86, -s * 0.16, s * 0.26], [-s * 0.58, -s * 0.13, s * 0.2], [-s * 0.74, -s * 0.36, s * 0.18]];
  boxes.forEach(([bx, by, bw], i) => {
    ctx.fillStyle = GIFTS[i % GIFTS.length];
    ctx.fillRect(bx - bw / 2, by + bob - bw, bw, bw);
    ctx.strokeStyle = '#F2D69B'; ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(bx, by + bob - bw); ctx.lineTo(bx, by + bob);
    ctx.moveTo(bx - bw / 2, by + bob - bw / 2); ctx.lineTo(bx + bw / 2, by + bob - bw / 2);
    ctx.stroke();
  });

  // ---- driver ----
  ctx.fillStyle = '#C8322B';
  ctx.beginPath(); ctx.ellipse(-s * 0.4, -s * 0.06 + bob, s * 0.17, s * 0.15, -0.3, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#F4D2B8';
  ctx.beginPath(); ctx.arc(-s * 0.34, -s * 0.26 + bob, s * 0.11, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#F7F4EA';                                            // beard and hat trim
  ctx.beginPath(); ctx.arc(-s * 0.3, -s * 0.2 + bob, s * 0.09, -0.4, 2.6); ctx.fill();
  ctx.fillStyle = '#C8322B';
  ctx.beginPath();
  ctx.moveTo(-s * 0.46, -s * 0.33 + bob); ctx.quadraticCurveTo(-s * 0.34, -s * 0.52 + bob, -s * 0.2, -s * 0.36 + bob);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#F7F4EA';
  ctx.beginPath(); ctx.arc(-s * 0.19, -s * 0.37 + bob, s * 0.04, 0, 6.29); ctx.fill();

  // ---- harness ----
  ctx.strokeStyle = '#6B4526'; ctx.lineWidth = s * 0.035;
  ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.06 + bob); ctx.lineTo(s * 1.9, s * 0.02); ctx.stroke();

  // ---- reindeer: i = 1 is the lead, and has the nose ----
  for (let i = 0; i < 2; i++) {
    const rx = s * (0.75 + i * 1.0), ry = Math.sin(t * 3 + i * 0.8) * s * 0.05;
    ctx.strokeStyle = '#5A3A1E'; ctx.lineWidth = s * 0.05;              // antlers
    ctx.beginPath();
    ctx.moveTo(rx + s * 0.5, ry - s * 0.32); ctx.lineTo(rx + s * 0.44, ry - s * 0.56);
    ctx.moveTo(rx + s * 0.46, ry - s * 0.46); ctx.lineTo(rx + s * 0.32, ry - s * 0.54);
    ctx.moveTo(rx + s * 0.58, ry - s * 0.3); ctx.lineTo(rx + s * 0.66, ry - s * 0.54);
    ctx.moveTo(rx + s * 0.62, ry - s * 0.44); ctx.lineTo(rx + s * 0.76, ry - s * 0.5);
    ctx.stroke();
    ctx.strokeStyle = '#6B4526'; ctx.lineWidth = s * 0.055;             // legs mid-gallop
    ctx.beginPath();
    for (let leg = 0; leg < 4; leg++) {
      const lx = rx - s * 0.24 + leg * s * 0.17, swing = Math.sin(t * 9 + i * 1.3 + leg * 1.7) * s * 0.16;
      ctx.moveTo(lx, ry + s * 0.14); ctx.lineTo(lx + swing, ry + s * 0.42);
    }
    ctx.stroke();
    ctx.fillStyle = '#8A5A2B';                                          // body, neck, head
    ctx.beginPath(); ctx.ellipse(rx, ry, s * 0.34, s * 0.19, 0, 0, 6.29); ctx.fill();
    ctx.strokeStyle = '#8A5A2B'; ctx.lineWidth = s * 0.14;
    ctx.beginPath(); ctx.moveTo(rx + s * 0.2, ry - s * 0.06); ctx.lineTo(rx + s * 0.42, ry - s * 0.22); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(rx + s * 0.46, ry - s * 0.24, s * 0.16, s * 0.1, -0.5, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#C49A6C';                                          // pale belly and muzzle
    ctx.beginPath(); ctx.ellipse(rx - s * 0.04, ry + s * 0.1, s * 0.2, s * 0.07, 0, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.ellipse(rx + s * 0.55, ry - s * 0.29, s * 0.08, s * 0.06, -0.5, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#1B1210';
    ctx.beginPath(); ctx.arc(rx + s * 0.45, ry - s * 0.3, s * 0.028, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.moveTo(rx - s * 0.33, ry - s * 0.06); ctx.lineTo(rx - s * 0.5, ry - s * 0.2); ctx.lineTo(rx - s * 0.3, ry + s * 0.06); ctx.fill();
    if (i === 1) {                                                      // Rudolph
      ctx.fillStyle = '#E24B4B';
      ctx.beginPath(); ctx.arc(rx + s * 0.62, ry - s * 0.32, s * 0.055, 0, 6.29); ctx.fill();
    }
  }
  ctx.restore();
}

// The glitter they leave behind, brightest where it was dropped.
function drawTrail(ctx, trail) {
  for (const p of trail) {
    const life = 1 - p.age / p.span;
    if (life <= 0) continue;
    ctx.globalAlpha = life * 0.9;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + life * 0.6), 0, 6.29); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const newSleigh = () => ({ x: 0, dir: 1, size: rnd(34, 46), y: rnd(60, 220), wait: rnd(20, 60), flying: false, trail: [] });

function drawSettled(ctx, k, ledges) {
  for (const l of ledges) {
    // Snowmen stand whether or not this ledge has gathered any snow.
    for (const m of l.men) drawSnowman(ctx, m.x, l.y - heightAt(l, m.x) + 1, m.h * m.scale);
    if (k.land === 'mound') {
      if (!l.cols.some((h) => h > 0.5)) continue;
      ctx.fillStyle = '#FAF8F2';
      ctx.beginPath(); ctx.moveTo(l.x0, l.y);
      for (let i = 0; i < l.cols.length; i++) {
        const x = l.x0 + i * COL + COL / 2, h = l.cols[i];
        const nx = l.x0 + (i + 1) * COL, nh = l.cols[Math.min(i + 1, l.cols.length - 1)];
        ctx.quadraticCurveTo(x, l.y - h, nx, l.y - (h + nh) / 2);
      }
      ctx.lineTo(l.x1, l.y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(160,185,200,.35)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      for (const it of l.items) {
        ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.rot); ctx.fillStyle = it.color;
        if (it.rect) ctx.fillRect(-it.size / 2, -it.size / 4, it.size, it.size / 2);
        else { ctx.beginPath(); ctx.ellipse(0, 0, it.size / 2, it.size / 3.2, 0, 0, 6.29); ctx.fill(); }
        ctx.restore();
      }
    }
  }
}

// intensity: 1 is the usual amount, 2 twice as much, 0.5 half.
export function Particles({ kind, intensity = 1, decor = '', paused = false }) {
  const ref = useRef();
  useEffect(() => {
    const cv = ref.current, k = KINDS[kind];
    if (!cv || !k) return;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const count = Math.max(1, Math.round(k.n * intensity));
    let ps = Array.from({ length: count }, () => spawn(k, true));
    // Halloween at 50% and up brings out the ghosts: one more for every notch of the slider.
    const ghosts = k.bats ? Array.from({ length: Math.max(0, Math.floor(intensity) - 1) }, () => spawnGhost(true)) : [];
    let ledges = k.land ? findLedges(cv) : [];
    const sleigh = k.sleigh ? { ...newSleigh(), wait: rnd(10, 22) } : null;
    let live = true, last = performance.now(), t = 0, sinceLedges = 0, sinceMelt = 0, sinceMen = 0;
    const frame = () => {
      if (!live) return;
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (paused || document.hidden) { setTimeout(() => requestAnimationFrame(frame), 500); return; }
      t += dt; sinceLedges += dt; sinceMelt += dt; sinceMen += dt;
      if (k.land && sinceLedges > 3) { sinceLedges = 0; const fresh = findLedges(cv); if (fresh.length !== ledges.length) ledges = fresh; }
      // what has settled clears slowly, so an evening of snow does not bury the buttons
      if (k.land && sinceMelt > 60) {
        sinceMelt = 0;
        for (const l of ledges) {
          for (let i = 0; i < l.cols.length; i++) l.cols[i] *= 0.8;
          l.items.splice(0, Math.ceil(l.items.length * 0.25));
          for (const m of l.men) m.scale *= 0.82;
          l.men = l.men.filter((m) => m.scale > 0.4);
        }
      }
      // Snowmen stand on the floor at the bottom of the room, big enough to read from the sofa.
      // They are not gated on drift depth: nearly every flake lands on a card long before it
      // reaches the floor, so the floor never gets deep, and they would never appear.
      if (k.men && sinceMen > 20) {
        sinceMen = 0;
        const floor = ledges[ledges.length - 1];
        if (floor && floor.men.length < 3) {
          const spots = [];
          for (let x = 260; x < W - 160; x += 40) if (floor.men.every((m) => Math.abs(m.x - x) > 360)) spots.push(x);
          if (spots.length) floor.men.push({ x: pick(spots), h: rnd(180, 250), scale: 1 });
        }
      }
      if (sleigh) {
        if (sleigh.flying) {
          sleigh.x += 150 * sleigh.dir * dt;
          const tailX = sleigh.x - sleigh.dir * sleigh.size * 1.1;
          for (let i = 0; i < 3; i++) sleigh.trail.push({ x: tailX + rnd(-14, 14), y: sleigh.y + rnd(-10, 18), r: rnd(1.4, 3.4), color: pick(SPARKS), age: 0, span: rnd(1.1, 2.4), vy: rnd(4, 16) });
          if (sleigh.trail.length > 260) sleigh.trail.splice(0, sleigh.trail.length - 260);
          if (sleigh.x < -300 || sleigh.x > W + 300) Object.assign(sleigh, newSleigh());
        } else if ((sleigh.wait -= dt) <= 0) {
          sleigh.flying = true;
          sleigh.dir = Math.random() < 0.5 ? 1 : -1;
          sleigh.x = sleigh.dir > 0 ? -280 : W + 280;
        }
      }
      ctx.clearRect(0, 0, W, H);
      drawSettled(ctx, k, ledges);
      if (decor === 'tree') drawTree(ctx, W - 210, H - 40, 300, t);
      if (sleigh?.trail.length) {
        for (const p of sleigh.trail) { p.age += dt; p.y += p.vy * dt; }
        sleigh.trail = sleigh.trail.filter((p) => p.age < p.span);
        drawTrail(ctx, sleigh.trail);
      }
      if (sleigh?.flying) drawSleigh(ctx, sleigh.x, sleigh.y, sleigh.size, t, sleigh.dir);   // snow falls in front of it
      for (let i = 0; i < ghosts.length; i++) {
        const g = ghosts[i];
        g.x += g.vx * dt; g.life += dt;
        if (g.life > g.span || g.x < -160 || g.x > W + 160) { ghosts[i] = spawnGhost(false); continue; }
        drawGhost(ctx, g, t);
      }
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (k.wander) {
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (Math.random() < 0.02) { p.vx = rnd(-20, 20); p.vy = rnd(-14, 14); }
          if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) { ps[i] = spawn(k, true); continue; }
          const a = Math.max(0, Math.sin(t * p.blink * 3 + p.phase));
          ctx.fillStyle = `rgba(242,214,155,${(a * 0.85).toFixed(2)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2 + a * 2.5, 0, 6.29); ctx.fill();
          continue;
        }
        if (k.bats) {
          p.x += p.vx * dt; p.y += Math.sin(t * 2 + p.phase) * 25 * dt;
          if (p.x > W + 80) { ps[i] = spawn(k, false); continue; }
          ctx.fillStyle = '#1B1210'; drawBat(ctx, p.x, p.y, p.size, t, p.flap);
          continue;
        }
        const prevY = p.y;
        p.y += p.vy * dt;
        p.x += Math.sin(t * 1.3 + p.phase) * k.sway * dt;
        p.rot += p.spin * dt;
        if (p.vy < 0) {                                  // hearts: float up and fade out
          p.alpha = Math.max(0, Math.min(1, (p.y - 60) / 200));
          if (p.y < 40) { ps[i] = spawn(k, false); continue; }
          ctx.fillStyle = p.color; ctx.globalAlpha = p.alpha; drawHeart(ctx, p.x, p.y, p.size); ctx.globalAlpha = 1;
          continue;
        }
        let landed = false;
        for (const l of ledges) {
          if (p.x < l.x0 || p.x > l.x1) continue;
          const top = l.y - heightAt(l, p.x);
          if (prevY < top && p.y >= top - p.size / 3) { land(k, l, p); landed = true; break; }
        }
        if (landed || p.y > H + 20 || p.x < -20 || p.x > W + 20) { ps[i] = spawn(k, false); continue; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.fillStyle = p.color;
        if (kind === 'snow') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, 6.29); ctx.fill(); }
        else { ctx.rotate(p.rot); if (k.rect) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); else { ctx.beginPath(); ctx.ellipse(0, 0, p.size / 2, p.size / 3.2, 0, 0, 6.29); ctx.fill(); } }
        ctx.restore();
      }
      setTimeout(() => requestAnimationFrame(frame), 50);
    };
    frame();
    return () => { live = false; };
  }, [kind, intensity, decor, paused]);
  return html`<canvas class="fx-layer" ref=${ref} aria-hidden="true"></canvas>`;
}
