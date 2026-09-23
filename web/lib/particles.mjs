// Weather over the lobby: snow, leaves, petals and confetti fall through the room and settle on
// the tops of the cards; hearts drift up, fireflies wander, bats cross the top of the screen.
// One canvas the size of the stage, redrawn at 20 fps, no blur filters and no transformed
// layers (the panel's GPU speckles on those). What has settled is remembered per ledge - the
// top edge of each card - and slowly clears, so it never buries the page.

import { useEffect, useRef } from 'preact/hooks';
import { html } from './ui.mjs';

const W = 1920, H = 1080;
const KINDS = {
  snow: { n: 90, vy: [26, 64], sway: 14, size: [2, 5], land: 'mound', colors: ['#FAF8F2'] },
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
    ledges.push({ x0, x1, y, cols: new Float32Array(Math.ceil((x1 - x0) / COL)), items: [] });
  }
  ledges.push({ x0: 140, x1: W, y: H, cols: new Float32Array(Math.ceil((W - 140) / COL)), items: [] });   // the floor
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

function drawSettled(ctx, k, ledges) {
  for (const l of ledges) {
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

export function Particles({ kind, paused = false }) {
  const ref = useRef();
  useEffect(() => {
    const cv = ref.current, k = KINDS[kind];
    if (!cv || !k) return;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    let ps = Array.from({ length: k.n }, () => spawn(k, true));
    let ledges = k.land ? findLedges(cv) : [];
    let live = true, last = performance.now(), t = 0, sinceLedges = 0, sinceMelt = 0;
    const frame = () => {
      if (!live) return;
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (paused || document.hidden) { setTimeout(() => requestAnimationFrame(frame), 500); return; }
      t += dt; sinceLedges += dt; sinceMelt += dt;
      if (k.land && sinceLedges > 3) { sinceLedges = 0; const fresh = findLedges(cv); if (fresh.length !== ledges.length) ledges = fresh; }
      // what has settled clears slowly, so an evening of snow does not bury the buttons
      if (k.land && sinceMelt > 60) {
        sinceMelt = 0;
        for (const l of ledges) { for (let i = 0; i < l.cols.length; i++) l.cols[i] *= 0.8; l.items.splice(0, Math.ceil(l.items.length * 0.25)); }
      }
      ctx.clearRect(0, 0, W, H);
      drawSettled(ctx, k, ledges);
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
  }, [kind, paused]);
  return html`<canvas class="fx-layer" ref=${ref} aria-hidden="true"></canvas>`;
}
