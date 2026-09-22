// Lobby: continue watching, scenes, projector, lights, just added and the pre-show music bar.

import { useState } from 'preact/hooks';
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
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const part = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening';

  return html`<main class="view">
    <${Header} title="Home Theater" kicker=${`${weekday} ${part}`}>
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

function Continue() {
  const [deck] = useLoad(() => get('/api/plex/ondeck?size=8'), []);
  const [i, setI] = useState(0);
  if (!deck) return html`<section class="hero dark tx-suede"><div class="empty" style="flex-grow:1">Loading Plex…</div></section>`;
  if (!deck.length) return html`<section class="hero dark tx-suede"><div class="empty" style="flex-grow:1;color:#C7B39E">Nothing in progress. Pick something from Watch.</div></section>`;
  const it = deck[i % deck.length];
  const pct = it.duration ? Math.round((it.viewOffset / it.duration) * 100) : 0;
  const left = (it.duration || 0) - (it.viewOffset || 0);
  const name = it.showTitle || it.title;
  return html`<section class="hero dark tx-suede">
    <div class="art">
      <img src=${it.art || it.still} alt="" />
      <div class="name">${name}</div>
    </div>
    <div class="body">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="eyebrow" style="white-space:nowrap">Continue watching${deck.length > 1 ? ` · ${(i % deck.length) + 1}/${deck.length}` : ''}</div>
        ${deck.length > 1 && html`<div class="deck">
          <button type="button" aria-label="Previous" onClick=${() => setI((i - 1 + deck.length) % deck.length)}><${Icon} name="left" size=${20} /></button>
          <button type="button" aria-label="Next" onClick=${() => setI(i + 1)}><${Icon} name="chev" size=${20} /></button>
        </div>`}
      </div>
      <div class="title">${it.title}</div>
      <div class="sub">${it.showTitle ? `Season ${it.season}, Episode ${it.episode}` : it.year}${it.year && it.showTitle ? ` · ${it.year}` : ''}</div>
      <p>${it.summary}</p>
      <div style="flex-grow:1"></div>
      <div>
        <div class="bar"><i style=${`width:${pct}%`}></i></div>
        <div class="times"><span>${it.viewOffset ? `${runtime(it.viewOffset)} watched` : 'Not started'}</span><span>${runtime(left)} left · ends ${endsAt(left)}</span></div>
      </div>
      <div style="display:flex;gap:12px">
        <button type="button" class="btn primary" style="height:66px" onClick=${() => play(it, true)}><${Play} />${it.viewOffset ? 'Resume on projector' : 'Play on projector'}</button>
        ${it.viewOffset > 0 && html`<button type="button" class="btn ghost" style="height:66px" onClick=${() => play(it, false)}>Start over</button>`}
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
  return html`<section class="scenes tx-maple">
    <${H2} title="Scenes">${scene && html`<span class="aside">${scene}</span>`}<//>
    <div class="grid">
      ${SCENES.map((s) => html`<button type="button" class="scene" aria-pressed=${s.name === active ? 'true' : 'false'} onClick=${() => act({ action: 'scene', name: s.name })}>
        <${Icon} name=${s.icon} size=${30} color=${s.name === active ? 'var(--gold)' : 'var(--acc)'} />
        <span><span class="n">${s.label}</span><br /><span class="d">${s.desc}</span></span>
      </button>`)}
    </div>
  </section>`;
}

function Projector() {
  const ents = useStore((s) => s.entities);
  const proj = useEntity(ents.projector);
  const tv = useEntity(ents.appleTv);
  const hasProj = Boolean(ents.projector);
  // Until the projector's own entity exists, the Apple TV's power state stands in for it (CEC).
  const on = hasProj ? proj && !['off', 'standby', 'unavailable'].includes(proj.state) : tv && !['off', 'standby', 'unavailable'].includes(tv.state);
  const source = proj?.attributes?.source;
  return html`<section class="card proj">
    <${H2} title="Projector"><span class="aside"><span class=${`dot ${on ? 'on' : ''}`}></span>${on ? 'On' : 'Standby'}</span><//>
    <div class="row">
      <button type="button" class=${`power ${on ? 'on' : ''}`} aria-label=${on ? 'Turn projector off' : 'Turn projector on'}
        onClick=${() => act({ action: 'projector', cmd: on ? 'power_off' : 'power_on' })}>
        <${Icon} name="power" size=${40} color=${on ? '#fff' : 'var(--acc)'} w=${2.4} />
      </button>
      <div><div style="font-size:21px;font-weight:600">NexiGo Aurora Pro</div>
      <div class="muted" style="font-size:16px">${hasProj ? (source || 'Source unknown') : 'Power via Apple TV (HDMI-CEC)'}</div></div>
    </div>
    <div class="label" style="margin:18px 0 8px">Source</div>
    <${Seg} options=${['Apple TV', 'HDMI 2', 'HDMI 3'].map((v) => ({ value: v, label: v, disabled: !hasProj }))} value=${source || 'Apple TV'}
      onChange=${(v) => act({ action: 'projector', cmd: 'source', source: v })} />
    <div class="label" style="margin:16px 0 8px">Picture</div>
    <${Seg} options=${['Cinema', 'Standard', 'Brightest'].map((v) => ({ value: v, label: v, disabled: !hasProj }))} value=${proj?.attributes?.picture_mode || 'Cinema'}
      onChange=${(v) => act({ action: 'projector', cmd: 'picture', mode: v })} />
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
