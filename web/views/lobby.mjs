// Lobby: continue watching, scenes, projector, lights, just added and the pre-show music bar.

import { useState, useRef } from 'preact/hooks';
import { html, Icon, Play, Pause, Prev, Next, Poster, Seg, Range, Header, H2 } from '../lib/ui.mjs';
import { get, act, useLoad, useStore, useEntity, runtime, endsAt, toast } from '../lib/api.mjs';
import { go } from '../app.mjs';

const SCENES = [
  { name: 'pre_show', label: 'Pre-show', desc: 'Warm lights · music', icon: 'music' },
  { name: 'movie_time', label: 'Movie time', desc: 'Lights fade · projector on', icon: 'film' },
  { name: 'intermission', label: 'Intermission', desc: 'Pause · lights 30%', icon: 'cup' },
  { name: 'lights_up', label: 'Lights up', desc: 'Full bright · music off', icon: 'sun' },
];

export function Lobby() {
  const ents = useStore((s) => s.entities);
  const temp = useEntity(ents.temperature);
  const occ = useEntity(ents.occupancy);
  const tv = useEntity(ents.appleTv);
  const [requests] = useLoad(() => get('/api/seerr/requests?take=10').catch(() => null), []);
  const downloading = requests?.results?.filter((r) => r.label === 'Downloading').length || 0;
  const arrivals = useArrivals();
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const part = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening';

  return html`<main class="view">
    <${Header} title="Home Theater" kicker=${`${weekday} ${part}`}>
      ${arrivals.list.length > 0 && html`<button type="button" class="chip arrival" onClick=${() => go('watch', { item: arrivals.list[0].plexId })}>
        ${arrivals.list[0].poster && html`<img src=${arrivals.list[0].poster} alt="" />`}
        <span><b>Now in Plex</b> ${arrivals.list[0].title}</span>${arrivals.list.length > 1 && html`<span class="more">+${arrivals.list.length - 1}</span>`}
        <span class="x" role="button" aria-label="Dismiss" onClick=${(e) => { e.stopPropagation(); arrivals.dismiss(arrivals.list[0].id); }}>×</span></button>`}
      ${temp && html`<span class="chip"><${Icon} name="therm" size=${20} />${Math.round(Number(temp.state) * 10) / 10}°</span>`}
      ${occ && html`<span class="chip"><${Icon} name="user" size=${20} />${occ.state === 'on' ? 'Occupied' : 'Empty'}</span>`}
      ${tv && html`<span class="chip"><${Icon} name="screen" size=${20} />Apple TV · ${tv.state}</span>`}
      ${downloading > 0 && html`<button type="button" class="chip warn" onClick=${() => go('request')}><${Icon} name="dl" size=${20} />${downloading} downloading</button>`}
    <//>
    <div class="lobby-grid">
      <${Continue} />
      <${Scenes} />
      <${Projector} />
      <${Lights} />
      <div class="right-col">
        <${JustAdded} />
        <${MusicBar} />
      </div>
    </div>
  </main>`;
}

// Requested titles that landed in Plex in the last two days, newest first, minus ones dismissed on
// this panel.
function useArrivals() {
  const [all] = useLoad(() => get('/api/seerr/arrivals').catch(() => []), []);
  const [gone, setGone] = useState(() => { try { return JSON.parse(localStorage.getItem('tp-dismissed') || '[]'); } catch { return []; } });
  const dismiss = (id) => {
    const next = [...gone, id].slice(-50);
    setGone(next);
    try { localStorage.setItem('tp-dismissed', JSON.stringify(next)); } catch {}
  };
  return { list: (all || []).filter((a) => !gone.includes(a.id)), dismiss };
}

function Continue() {
  const [deck] = useLoad(() => get('/api/plex/ondeck?size=8'), []);
  const [i, setI] = useState(0);
  const [drag, setDrag] = useState(0);
  const swipe = useRef(null);
  const swallowUntil = useRef(0);
  if (!deck) return html`<section class="hero dark tx-suede"><div class="empty" style="flex-grow:1">Loading Plex…</div></section>`;
  if (!deck.length) return html`<section class="hero dark tx-suede"><div class="empty" style="flex-grow:1;color:#C7B39E">Nothing in progress. Pick something from Watch.</div></section>`;
  const it = deck[i % deck.length];
  const pct = it.duration ? Math.round((it.viewOffset / it.duration) * 100) : 0;
  const left = (it.duration || 0) - (it.viewOffset || 0);
  const name = it.showTitle || it.title;
  const n = deck.length;
  const at = i % n;

  // Swipe left/right to move through the deck. A swipe never counts as a tap on the buttons.
  const down = (e) => { if (n > 1) swipe.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const move = (e) => {
    const s = swipe.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(e.clientY - s.y)) s.moved = true;
    if (s.moved) setDrag(dx);
  };
  const up = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s?.moved) return;
    const dx = e.clientX - s.x;
    if (dx < -70) setI((at + 1) % n);
    else if (dx > 70) setI((at - 1 + n) % n);
    setDrag(0);
    swallowUntil.current = Date.now() + 400; // the click that ends a drag is not a tap
  };
  const guard = (e) => { if (Date.now() < swallowUntil.current) { e.stopPropagation(); e.preventDefault(); } };
  const cancel = () => { swipe.current = null; setDrag(0); };

  return html`<section class="hero dark tx-suede swipe" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${cancel} onPointerLeave=${cancel} onClickCapture=${guard}>
    <div class="slide" key=${it.id} style=${drag ? `transform:translateX(${drag * 0.6}px);opacity:${Math.max(0.35, 1 - Math.abs(drag) / 500)};transition:none` : ''}>
    <div class="art">
      <img src=${it.art || it.still} alt="" draggable="false" />
      ${n > 1 && html`<span class="count">${at + 1} / ${n}</span>`}
      <div class="name">${name}</div>
    </div>
    <div class="body">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="eyebrow" style="white-space:nowrap">Continue watching</div>

      </div>
      <div class="title">${it.title}</div>
      ${it.showTitle && html`<div class="sub">Season ${it.season}, Episode ${it.episode}</div>`}
      <p>${it.summary}</p>
      <div style="flex-grow:1"></div>
      <div>
        <div class="bar"><i style=${`width:${pct}%`}></i></div>
        <div class="times"><span>${[it.year, it.viewOffset ? `${runtime(left)} left` : runtime(left)].filter(Boolean).join(' · ')}</span><span>ends ${endsAt(left)}</span></div>
      </div>
      <div style="display:flex;gap:12px">
        <button type="button" class="btn primary" style="height:66px;flex-grow:1" onClick=${() => play(it, true)}><${Play} />${it.viewOffset ? 'Resume' : 'Play'}</button>
        ${it.viewOffset > 0 && html`<button type="button" class="btn ghost" style="height:66px;width:66px;padding:0;flex-shrink:0" aria-label="Start over" title="Start over" onClick=${() => play(it, false)}><${Icon} name="back" size=${28} color="#F4F0E8" /></button>`}
      </div>
    </div>
    </div>
  </section>`;
}

export async function play(item, resume = true, extra = {}) {
  const r = await act({ action: 'play', ratingKey: item.id, type: item.type, offset: resume ? item.viewOffset : 0, ...extra });
  if (r) { toast(`Starting ${item.showTitle ? `${item.showTitle}: ` : ''}${item.title}`); go('showtime'); }
}

function Scenes() {
  const scene = useEntity('input_select.theater_scene')?.state;
  const map = { 'Pre-show': 'pre_show', 'Movie time': 'movie_time', Intermission: 'intermission', 'Lights up': 'lights_up' };
  const active = map[scene];
  return html`<section class="scenes tx-maple" aria-label="Scenes">
    <div class="grid">
      ${SCENES.map((s) => html`<button type="button" class="scene" aria-pressed=${s.name === active ? 'true' : 'false'} onClick=${() => act({ action: 'scene', name: s.name })}>
        <${Icon} name=${s.icon} size=${30} color=${s.name === active ? 'var(--gold)' : 'var(--acc)'} />
        <span><span class="n">${s.label}</span><br /><span class="d">${s.desc}</span></span>
      </button>`)}
    </div>
  </section>`;
}

// Sources: the Apple TV, then what is wired straight to the projector (the Unraid VM), then the
// consoles on the HDMI switcher, all from games.json. Apps open on the projector's own Android.
const SOURCE_ICONS = { tv: 'tv', pad: 'pad', joystick: 'joystick', remote: 'remote', monitor: 'server', server: 'server', steam: 'playc' };
const APP_ICONS = [[/plex|plezy/i, 'plex'], [/you ?tube|smarttube/i, 'youtube'], [/moonlight|parsec|steam link/i, 'pad']];
const appIcon = (a) => a.icon || APP_ICONS.find(([re]) => re.test(a.name))?.[1] || 'app';

// What is on screen: the theater's Plex session (when PLEX_PLAYER_NAME pins it down), else the
// Apple TV's own now-playing when it is the source.
function useNowPlaying(on, current, tv) {
  const sessions = useStore((s) => s.sessions);
  const own = useStore((s) => s.ui?.theaterSessions);
  if (!on) return null;
  const s = own && sessions?.[0];
  if (s) {
    const left = (s.duration || 0) - (s.viewOffset || 0);
    const name = s.type === 'episode' ? `${s.showTitle} S${s.season}·E${s.episode}` : s.title;
    return `${s.state === 'paused' ? 'Paused · ' : ''}${name}${left > 0 ? ` · ${runtime(left)} left` : ''}`;
  }
  if (current === 'appletv' && tv && ['playing', 'paused'].includes(tv.state) && tv.attributes?.media_title) {
    const a = tv.attributes;
    return `${tv.state === 'paused' ? 'Paused · ' : ''}${a.media_series_title ? `${a.media_series_title} · ` : ''}${a.media_title}`;
  }
  return null;
}

function Projector() {
  const ents = useStore((s) => s.entities);
  const apps = useStore((s) => s.projectorApps) || [];
  const proj = useEntity(ents.projector);
  const tv = useEntity(ents.appleTv);
  const [games, , reload] = useLoad(() => get('/api/games').catch(() => null), []);
  const [picked, setPicked] = useState(null);
  const hasProj = Boolean(ents.projector);
  // Until the projector's own entity exists, the Apple TV's power state stands in for it (CEC).
  const on = hasProj ? proj && !['off', 'standby', 'unavailable'].includes(proj.state) : tv && !['off', 'standby', 'unavailable'].includes(tv.state);
  const appId = on ? proj?.attributes?.app_id : null;
  const runningApp = apps.find((a) => a.package === appId);

  // In the order set on the admin page.
  const sources = (games?.sources || []).map((s) => ({ ...s, icon: s.icon?.includes(':') ? s.icon : SOURCE_ICONS[s.icon] || (s.via === 'switcher' ? 'pad' : 'screen') }));
  const current = runningApp ? null : picked || games?.active;
  const picture = useEntity(ents.pictureMode)?.state;
  const nowPlaying = useNowPlaying(on, current, tv);

  async function pickSource(s) {
    setPicked(s.id);
    const ok = await act({ action: 'game_source', id: s.id });
    if (ok) toast(`Projector: ${s.name}`);
    setPicked(null);
    reload();
  }
  async function openApp(a) {
    if (await act({ action: 'projector_app', package: a.package })) toast(on ? `Opening ${a.name}` : `Waking the projector for ${a.name}`);
    reload();
  }

  return html`<section class="card proj">
    <${H2} title="Projector">${on && picture && !['unknown', 'unavailable'].includes(picture)
      ? html`<button type="button" class="aside mode" title="Next picture mode" onClick=${() => act({ action: 'picture_next' })}><span class="dot on"></span>${picture}</button>`
      : html`<span class="aside"><span class=${`dot ${on ? 'on' : ''}`}></span>${on ? 'On' : 'Standby'}</span>`}<//>
    <div class="row">
      <button type="button" class=${`power ${on ? 'on' : ''}`} aria-label=${on ? 'Turn projector off' : 'Turn projector on'}
        onClick=${() => act({ action: 'projector', cmd: on ? 'power_off' : 'power_on' })}>
        <${Icon} name="power" size=${40} color=${on ? '#fff' : 'var(--acc)'} w=${2.4} />
      </button>
      <div style="min-width:0;flex:1"><div style="font-size:21px;font-weight:600">NexiGo Aurora Pro</div>
      <div class="muted ellipsis" style="font-size:16px">${!on ? 'Tap a source or app to start' : nowPlaying || 'Nothing playing'}</div></div>
    </div>
    <div class="label" style="margin:18px 0 8px">Source</div>
    <div class="tiles">${sources.map((s) => html`<button type="button" class="tile" aria-pressed=${current === s.id ? 'true' : 'false'} disabled=${!hasProj} onClick=${() => pickSource(s)}>
      <${Icon} name=${s.icon} size=${30} /><span>${s.name}</span></button>`)}</div>
    ${apps.length > 0 && html`<div class="label" style="margin:16px 0 8px">Apps</div>
    <div class="tiles">${apps.map((a) => html`<button type="button" class="tile" aria-pressed=${runningApp === a ? 'true' : 'false'} disabled=${!hasProj} onClick=${() => openApp(a)}>
      <${Icon} name=${appIcon(a)} size=${30} /><span>${a.name}</span></button>`)}</div>`}
  </section>`;
}

const LIGHT_META = {
  'light.media_room_downlights': { name: 'Downlights', fill: '#B8792F' },
  'light.home_theater_accent_lights': { name: 'Accent lights', fill: '#C9772F' },
  'light.home_theater_wled': { name: 'LED strip', fill: '#9C4A1E' },
};

function Lights() {
  const ids = useStore((s) => s.entities.lights || []);
  return html`<section class="card">
    <${H2} title="Lights"><button type="button" class="link" onClick=${() => act({ action: 'aisle_glow' })}>Aisle glow</button><//>
    <div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
      ${ids.map((id) => html`<${LightRow} id=${id} />`)}
    </div>
  </section>`;
}

function LightRow({ id }) {
  const st = useEntity(id);
  const meta = LIGHT_META[id] || { name: st?.attributes?.friendly_name || id, fill: '#B8792F' };
  const on = st?.state === 'on';
  const pct = on ? Math.round(((st.attributes.brightness || 0) / 255) * 100) : 0;
  const rgb = st?.attributes?.rgb_color;
  const detail = !st ? 'Unavailable' : !on ? 'Off'
    : st.attributes.effect && st.attributes.effect !== 'Solid' ? `${pct}% · ${st.attributes.effect}`
    : st.attributes.color_mode === 'color_temp' ? `${pct}% · ${st.attributes.color_temp_kelvin}K` : `${pct}%`;
  return html`<div class="light">
    <div class="head">
      <button type="button" class="name" onClick=${() => act({ action: 'light', entity_id: id, on: !on })} aria-label=${`${meta.name}: turn ${on ? 'off' : 'on'}`}>
        ${rgb && on && html`<span class="swatch" style=${`background:rgb(${rgb.join(',')})`}></span>`}${meta.name}
      </button>
      <span class="mono muted" style="font-size:15px">${detail}</span>
    </div>
    <${Range} value=${pct} label=${`${meta.name} brightness`} fill=${meta.fill}
      onCommit=${(v) => act({ action: 'light', entity_id: id, ...(v === 0 ? { on: false } : { brightness_pct: v }) })} />
  </div>`;
}

function JustAdded() {
  const [items] = useLoad(() => get('/api/plex/recent?size=14'), []);
  // One card per movie or show: collapse episodes into their show.
  const seen = new Set();
  const list = (items || []).filter((m) => {
    const k = m.showTitle || m.id;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 6);
  return html`<section class="card">
    <${H2} title="Just added"><button type="button" class="link" onClick=${() => go('watch')}>Browse library</button><//>
    <div class="shelf">
      ${list.map((m) => html`<button type="button" class="poster-btn" style="width:130px" onClick=${() => go('watch', { item: m.id })} aria-label=${m.showTitle || m.title}>
        <div class="framed"><${Poster} src=${m.poster} title=${m.showTitle || m.title} /></div>
      </button>`)}
    </div>
  </section>`;
}

function MusicBar() {
  const players = useStore((s) => s.entities.musicPlayers || []);
  const id = players[0];
  const st = useEntity(id);
  const a = st?.attributes || {};
  const playing = st?.state === 'playing';
  const vol = Math.round((a.volume_level || 0) * 100);
  const unavailable = !st || st.state === 'unavailable';
  return html`<section class="musicbar dark tx-suede">
    ${a.entity_picture ? html`<img class="cover" src=${`/api/ha-image?e=${encodeURIComponent(id)}&v=${encodeURIComponent(a.entity_picture)}`} alt="" />` : html`<div class="cover"></div>`}
    <div style="flex-grow:1;min-width:0;display:flex;flex-direction:column;gap:4px">
      <div class="eyebrow" style="font-size:14px">${unavailable ? 'Music Assistant player unavailable' : `Music · ${a.friendly_name || 'Home Theater'}`}</div>
      <div class="ellipsis" style="font-size:23px;font-weight:600">${a.media_title || (unavailable ? 'Check the Music Assistant player' : 'Nothing playing')}</div>
      <div class="ellipsis" style="font-size:17px;color:var(--on-choc2)">${[a.media_artist, a.media_album_name].filter(Boolean).join(' · ')}</div>
    </div>
    <button type="button" class="icon-btn" style="width:60px;height:60px" aria-label="Previous" disabled=${unavailable} onClick=${() => act({ action: 'music', cmd: 'previous', entity_id: id })}><${Prev} size=${26} color="#F4F0E8" /></button>
    <button type="button" class="icon-btn" style="width:76px;height:76px;background:var(--gold)" aria-label=${playing ? 'Pause' : 'Play'} disabled=${unavailable} onClick=${() => act({ action: 'music', cmd: 'play_pause', entity_id: id })}>
      ${playing ? html`<${Pause} size=${30} color="var(--choc2)" />` : html`<${Play} size=${30} color="var(--choc2)" />`}
    </button>
    <button type="button" class="icon-btn" style="width:60px;height:60px" aria-label="Next" disabled=${unavailable} onClick=${() => act({ action: 'music', cmd: 'next', entity_id: id })}><${Next} size=${26} color="#F4F0E8" /></button>
    <div style="width:150px"><${Range} cls="thin" value=${vol} label="Music volume" fill="var(--gold)" rest="rgba(0,0,0,.35)" onCommit=${(v) => act({ action: 'music', cmd: 'volume', level: v / 100, entity_id: id })} /></div>
  </section>`;
}
