// The snack bar parade for Intermission: a popcorn box, a hot dog, a soda and a candy bar march
// across the screen on stick legs, the way the drive-in snipes did in the fifties. Same canvas
// approach as the weather layer - flat shapes, no filters, 20 fps - so the panel's GPU stays
// happy. Drawn here, not fetched from anywhere: the 1957 reel is somebody else's film.

import { useEffect, useRef } from 'preact/hooks';
import { html } from './ui.mjs';

const W = 1920, H = 430;
const FPS = 20;

// ---------- dressing up ----------

// The parade follows the accent: Santa hats at Christmas, witch hats and a trick-or-treat
// bucket at Halloween, a party hat on a birthday, sunglasses in summer. Anything else marches
// as it is.
function hat(ctx, s, t, acc, y) {
  if (acc === 'christmas' || acc === 'winter') {
    ctx.fillStyle = acc === 'winter' ? '#3F7FB5' : '#C8322B';
    ctx.beginPath();
    ctx.moveTo(-s * 0.26, y); ctx.quadraticCurveTo(-s * 0.1, y - s * 0.4, s * 0.3, y - s * 0.26);
    ctx.quadraticCurveTo(s * 0.02, y - s * 0.12, s * 0.26, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FAF8F2';
    ctx.beginPath(); ctx.roundRect(-s * 0.3, y - s * 0.06, s * 0.6, s * 0.1, s * 0.05); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.3, y - s * 0.26, s * 0.08, 0, 6.29); ctx.fill();
    return;
  }
  if (acc === 'halloween') {
    ctx.fillStyle = '#2A1030';
    ctx.beginPath(); ctx.ellipse(0, y, s * 0.36, s * 0.07, 0, 0, 6.29); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, y); ctx.quadraticCurveTo(-s * 0.02, y - s * 0.46, s * 0.12, y - s * 0.5);
    ctx.quadraticCurveTo(s * 0.06, y - s * 0.2, s * 0.2, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#E8731C';
    ctx.fillRect(-s * 0.19, y - s * 0.1, s * 0.38, s * 0.05);
    return;
  }
  if (acc === 'birthday' || acc === 'newyear') {
    ctx.fillStyle = '#D9536F';
    ctx.beginPath(); ctx.moveTo(-s * 0.18, y); ctx.lineTo(0, y - s * 0.46); ctx.lineTo(s * 0.18, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#F2D69B';
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-s * 0.06 + i * s * 0.06, y - s * 0.1 - i * s * 0.1, s * 0.03, 0, 6.29); ctx.fill(); }
    ctx.fillStyle = '#FAF8F2';
    ctx.beginPath(); ctx.arc(0, y - s * 0.47, s * 0.07, 0, 6.29); ctx.fill();
  }
}

// The trick-or-treat bucket, swinging from whichever hand is forward. Drawn at twice the size
// of the first go, so it reads from the sofa; scaled about the hand so the handle stays in it.
const BUCKET = 2;
function bucket(ctx, s, x, y) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(BUCKET, BUCKET); ctx.translate(-x, -y);
  ctx.strokeStyle = '#2A1911'; ctx.lineWidth = s * 0.02;
  ctx.beginPath(); ctx.arc(x, y + s * 0.06, s * 0.07, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = '#E8731C';
  ctx.beginPath(); ctx.roundRect(x - s * 0.08, y + s * 0.06, s * 0.16, s * 0.13, s * 0.02); ctx.fill();
  ctx.fillStyle = '#2A1911';
  ctx.beginPath(); ctx.moveTo(x - s * 0.04, y + s * 0.11); ctx.lineTo(x - s * 0.01, y + s * 0.15); ctx.lineTo(x - s * 0.07, y + s * 0.15); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + s * 0.04, y + s * 0.11); ctx.lineTo(x + s * 0.07, y + s * 0.15); ctx.lineTo(x + s * 0.01, y + s * 0.15); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------- the cast ----------

function legs(ctx, s, t, phase) {
  const swing = Math.sin(t * 9 + phase);
  ctx.strokeStyle = '#2A1911'; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const x = side * s * 0.22, kick = side * swing * s * 0.18;
    ctx.beginPath();
    ctx.moveTo(x, s * 0.5);
    ctx.lineTo(x + kick, s * 0.78);
    ctx.stroke();
    ctx.fillStyle = '#2A1911';                                   // shoe
    ctx.beginPath(); ctx.ellipse(x + kick * 1.2, s * 0.8, s * 0.11, s * 0.05, 0, 0, 6.29); ctx.fill();
  }
}

function arms(ctx, s, t, phase, acc, color = '#2A1911') {
  const swing = Math.sin(t * 9 + phase + Math.PI);
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.055; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * s * 0.32, -s * 0.05);
    ctx.lineTo(side * s * 0.5, -s * 0.05 + side * swing * s * 0.2);
    ctx.stroke();
    ctx.fillStyle = '#FAF8F2';                                   // white glove, like all cartoons
    const hx = side * s * 0.52, hy = -s * 0.05 + side * swing * s * 0.22;
    ctx.beginPath(); ctx.arc(hx, hy, s * 0.075, 0, 6.29); ctx.fill();
    if (acc === 'halloween' && side === 1) bucket(ctx, s, hx, hy);
  }
}

function face(ctx, s, t, y = -s * 0.12, blinkPhase = 0, acc = '') {
  const blink = Math.sin(t * 1.7 + blinkPhase) > 0.97 ? 0.15 : 1;
  ctx.fillStyle = '#FAF8F2';
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * s * 0.13, y, s * 0.1, s * 0.11 * blink, 0, 0, 6.29); ctx.fill(); }
  ctx.fillStyle = '#2A1911';
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * s * 0.13, y, s * 0.045, s * 0.05 * blink, 0, 0, 6.29); ctx.fill(); }
  if (acc === 'summer') {                                        // shades, for the July crowd
    ctx.fillStyle = '#2A1911';
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.roundRect(side * s * 0.13 - s * 0.11, y - s * 0.08, s * 0.22, s * 0.16, s * 0.04); ctx.fill(); }
    ctx.fillRect(-s * 0.04, y - s * 0.03, s * 0.08, s * 0.03);
  }
  ctx.strokeStyle = '#2A1911'; ctx.lineWidth = s * 0.035; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, y + s * 0.13, s * 0.11, 0.25, Math.PI - 0.25); ctx.stroke();   // grin
}

function popcorn(ctx, s, t, phase, acc) {
  legs(ctx, s, t, phase); arms(ctx, s, t, phase, acc);
  ctx.fillStyle = '#E8E2D6';                                     // the kernels behind the box
  for (const [dx, dy, r] of [[-0.24, -0.5, 0.11], [-0.05, -0.58, 0.13], [0.18, -0.5, 0.1], [0.04, -0.44, 0.1], [-0.15, -0.42, 0.09]]) {
    ctx.beginPath(); ctx.arc(dx * s, dy * s + Math.sin(t * 4 + dx * 9) * s * 0.02, r * s, 0, 6.29); ctx.fill();
  }
  ctx.fillStyle = '#C8322B';                                     // the striped box
  ctx.beginPath();
  ctx.moveTo(-s * 0.32, -s * 0.42); ctx.lineTo(s * 0.32, -s * 0.42);
  ctx.lineTo(s * 0.26, s * 0.5); ctx.lineTo(-s * 0.26, s * 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#FAF8F2';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * s * 0.12 - s * 0.03, -s * 0.42); ctx.lineTo(i * s * 0.12 + s * 0.03, -s * 0.42);
    ctx.lineTo(i * s * 0.1 + s * 0.025, s * 0.5); ctx.lineTo(i * s * 0.1 - s * 0.025, s * 0.5);
    ctx.closePath(); ctx.fill();
  }
  face(ctx, s, t, s * 0.05, phase, acc);
  hat(ctx, s, t, acc, -s * 0.54);
}

function hotdog(ctx, s, t, phase, acc) {
  legs(ctx, s, t, phase); arms(ctx, s, t, phase, acc);
  ctx.fillStyle = '#E3A865';                                     // bun
  ctx.beginPath(); ctx.roundRect(-s * 0.4, -s * 0.28, s * 0.8, s * 0.7, s * 0.3); ctx.fill();
  ctx.fillStyle = '#B3372B';                                     // sausage
  ctx.beginPath(); ctx.roundRect(-s * 0.44, -s * 0.34, s * 0.88, s * 0.34, s * 0.17); ctx.fill();
  ctx.strokeStyle = '#F2C94C'; ctx.lineWidth = s * 0.05; ctx.lineCap = 'round';   // mustard
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const x = -s * 0.36 + (i / 8) * s * 0.72;
    ctx[i ? 'lineTo' : 'moveTo'](x, -s * 0.2 + Math.sin(i * 1.5 + t * 2) * s * 0.05);
  }
  ctx.stroke();
  face(ctx, s, t, s * 0.08, phase + 1, acc);
  hat(ctx, s, t, acc, -s * 0.34);
}

function soda(ctx, s, t, phase, acc) {
  legs(ctx, s, t, phase); arms(ctx, s, t, phase, acc);
  ctx.strokeStyle = '#FAF8F2'; ctx.lineWidth = s * 0.05;         // straw
  ctx.beginPath(); ctx.moveTo(s * 0.06, -s * 0.42); ctx.lineTo(s * 0.22, -s * 0.72); ctx.stroke();
  ctx.fillStyle = '#3F7FB5';
  ctx.beginPath();
  ctx.moveTo(-s * 0.3, -s * 0.42); ctx.lineTo(s * 0.3, -s * 0.42);
  ctx.lineTo(s * 0.22, s * 0.5); ctx.lineTo(-s * 0.22, s * 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#FAF8F2';
  ctx.fillRect(-s * 0.31, -s * 0.46, s * 0.62, s * 0.09);        // lid
  ctx.fillStyle = 'rgba(250,248,242,.85)';                       // a band to write on
  ctx.fillRect(-s * 0.27, -s * 0.12, s * 0.54, s * 0.14);
  face(ctx, s, t, s * 0.16, phase + 2, acc);
  hat(ctx, s, t, acc, -s * 0.46);
}

function candy(ctx, s, t, phase, acc) {
  legs(ctx, s, t, phase); arms(ctx, s, t, phase, acc);
  ctx.save();
  ctx.rotate(Math.sin(t * 4 + phase) * 0.05);
  ctx.fillStyle = '#4E2A16';
  ctx.beginPath(); ctx.roundRect(-s * 0.34, -s * 0.44, s * 0.68, s * 0.92, s * 0.06); ctx.fill();
  ctx.fillStyle = '#F2C94C';                                     // wrapper
  ctx.beginPath(); ctx.roundRect(-s * 0.36, -s * 0.2, s * 0.72, s * 0.42, s * 0.04); ctx.fill();
  ctx.restore();
  face(ctx, s, t, -s * 0.3, phase + 3, acc);
  hat(ctx, s, t, acc, -s * 0.44);
}

const CAST = [popcorn, hotdog, soda, candy];

// ---------- the parade ----------

export function SnackParade({ paused = false, accent = '' }) {
  const ref = useRef();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const marchers = CAST.map((draw, i) => ({
      draw, x: 200 + i * 430, s: 152 + (i % 2) * 16, phase: i * 1.7, speed: 62,
    }));
    const notes = [];
    let live = true, last = performance.now(), t = 0;

    const frame = (now) => {
      if (!live) return;
      setTimeout(() => requestAnimationFrame(frame), 1000 / FPS);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (paused) return;
      t += dt;

      ctx.clearRect(0, 0, W, H);

      // the boardwalk they march along
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(0, H - 54, W, 54);

      for (const m of marchers) {
        m.x += m.speed * dt;
        if (m.x > W + 200) m.x = -200;
        const bob = Math.abs(Math.sin(t * 4.5 + m.phase)) * 10;
        ctx.save();
        ctx.translate(m.x, H - 150 - bob);
        // a soft shadow on the boardwalk, drawn flat (no blur filters on this panel)
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath(); ctx.ellipse(0, m.s * 0.86 + bob, m.s * 0.42, m.s * 0.08, 0, 0, 6.29); ctx.fill();
        m.draw(ctx, m.s, t, m.phase, accent);
        ctx.restore();
      }

      // musical notes drifting up out of the parade
      if (Math.random() < dt * 3) notes.push({ x: Math.random() * W, y: H - 150, vy: -34 - Math.random() * 20, age: 0, s: 16 + Math.random() * 12, sway: Math.random() * 6.28 });
      ctx.fillStyle = '#F2D69B';
      for (const n of notes) {
        n.age += dt; n.y += n.vy * dt;
        ctx.globalAlpha = Math.max(0, 1 - n.age / 3.4);
        const x = n.x + Math.sin(t * 2 + n.sway) * 14;
        ctx.beginPath(); ctx.ellipse(x, n.y, n.s * 0.42, n.s * 0.32, -0.4, 0, 6.29); ctx.fill();
        ctx.fillRect(x + n.s * 0.3, n.y - n.s, n.s * 0.1, n.s);
        ctx.fillRect(x + n.s * 0.3, n.y - n.s, n.s * 0.45, n.s * 0.16);
      }
      ctx.globalAlpha = 1;
      for (let i = notes.length - 1; i >= 0; i--) if (notes[i].age > 3.4) notes.splice(i, 1);
    };
    requestAnimationFrame(frame);
    return () => { live = false; };
  }, [paused, accent]);

  return html`<canvas class="snacks" ref=${ref} width=${W} height=${H} aria-hidden="true"></canvas>`;
}
