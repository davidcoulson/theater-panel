// Game lights: while a game is on the wall, the edge lights follow the PC - their colour warms
// from amber to red with the GPU's temperature and they brighten with its load - and go back to
// how they were when the game ends. A switch on the Games page and on the panel's Home Assistant
// device turns it on and off (GAME_LIGHTS); GAME_LIGHTS_ENTITY is the light.
import { config } from './config.mjs';
import { loadGames, steamNow } from './games.mjs';

const SNAPSHOT = 'theater_game_lights_before';
let ha, lit = false, lastSent = '';

export function start(haNow) {
  ha = haNow;
  setInterval(() => tick().catch((e) => console.warn('[game lights]', e.message)), 15000).unref();
}

const clamp = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// The PC's game is on the projector: its source's input is what the projector shows.
async function gameOnTheWall() {
  const g = await loadGames().catch(() => null);
  const st = g?.pc?.stats;
  if (!st) return null;
  const pc = (g.sources || []).find((s) => s.via !== 'switcher' && /^(windows|steam|pc|gaming)/i.test(s.id));
  const showing = ha.states[config.entities.projectorShowing]?.state || '';
  if (!pc?.projectorInput || !showing.startsWith(pc.projectorInput)) return null;
  const playing = await steamNow();
  if (!playing) return null;
  const n = (id) => { const v = Number(ha.states[id]?.state); return Number.isFinite(v) ? v : null; };
  return { tempC: n(st.gpuTemp), load: n(st.gpuLoad) };
}

async function tick() {
  const { enabled, entity } = config.gameLights;
  const game = enabled && entity ? await gameOnTheWall() : null;
  if (!game) {
    if (lit) {
      lit = false; lastSent = '';
      await ha.callService('scene', 'turn_on', {}, { target: { entity_id: `scene.${SNAPSHOT}` } }).catch(() => {});
    }
    return;
  }
  if (!lit) {
    await ha.callService('scene', 'create', { scene_id: SNAPSHOT, snapshot_entities: [entity] });
    lit = true;
  }
  const heat = game.tempC != null ? clamp((game.tempC * 9 / 5 + 32 - 100) / 35) : 0;
  const rgb = heat < 0.5 ? mix([255, 160, 70], [255, 110, 30], heat * 2) : mix([255, 110, 30], [224, 50, 30], (heat - 0.5) * 2);
  const brightness = Math.round(110 + 145 * clamp((game.load ?? 50) / 100));
  const key = `${rgb.join(',')}/${brightness}`;
  if (key === lastSent) return;
  lastSent = key;
  await ha.callService('light', 'turn_on', { rgb_color: rgb, brightness, transition: 8 }, { target: { entity_id: entity } });
}
