// Intermission: the drive-in snack bar takes the wall while the room has its break. The scene
// (lights to 30%, playback paused) is Home Assistant's; this screen is the fun part - a marquee,
// a countdown, and the concessions marching past on stick legs. It comes up by itself whenever
// the theater scene becomes Intermission, from the panel, a remote or voice.

import { useState, useEffect } from 'preact/hooks';
import { html, Icon, Play } from '../lib/ui.mjs';
import { act, useStore, clock } from '../lib/api.mjs';
import { SnackParade } from '../lib/snacks.mjs';
import { go, route, currentAccent } from '../app.mjs';

const MARQUEE = 14;   // bulbs along each side of the frame

export function Intermission() {
  const setting = useStore((s) => s.intermission?.minutes);
  const minutes = Math.max(1, Math.min(60, Number(route.params.minutes) || setting || 15));
  const [left, setLeft] = useState(minutes * 60);

  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const back = () => {
    act({ action: 'transport', cmd: 'play' });
    act({ action: 'scene', name: 'movie_time' });
    go('showtime');
  };

  return html`<div class="lobby-screen">
    <div class="sky"></div>
    <${SnackParade} accent=${currentAccent()?.id || ''} />
    <div class="marquee">
      ${[...Array(MARQUEE)].map((_, i) => html`<span class="bulb" style=${`--i:${i}`}></span>`)}
      <div class="inner">
        <div class="eyebrow">${minutes} minutes, folks</div>
        <h1>Let's all go<br />to the lobby</h1>
        <div class="count ${left === 0 ? 'done' : ''}">${left === 0 ? 'Back to the show' : `${mm}:${ss}`}</div>
      </div>
    </div>
    <div class="acts">
      <button type="button" class="btn primary big" onClick=${back}><${Play} size=${28} />Back to the show</button>
      <button type="button" class="btn big ghost" onClick=${() => setLeft((s) => s + 300)}><${Icon} name="cup" size=${26} color="#F4F0E8" />Five more minutes</button>
      <button type="button" class="btn big ghost" onClick=${() => go('lobby', { manual: true })}>Full controls</button>
    </div>
    <div class="clock mono">${clock().hm} <span>${clock().ampm}</span></div>
  </div>`;
}
