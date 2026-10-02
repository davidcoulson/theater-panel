// Music: Music Assistant now playing, library browsing and search, and which player to use.

import { useState } from 'preact/hooks';
import { html, Icon, Play, Pause, Prev, Next, Seg, Range, Header, H2, useDebounced } from '../lib/ui.mjs';
import { get, act, useLoad, useStore, useEntity, livePosition, mmss } from '../lib/api.mjs';

const TABS = [
  { value: 'album', label: 'Albums' },
  { value: 'playlist', label: 'Playlists' },
  { value: 'artist', label: 'Artists' },
  { value: 'radio', label: 'Radio' },
];

export function Music() {
  const players = useStore((s) => s.entities.musicPlayers || []);
  const [player, setPlayer] = useState(players[0]);
  const [tab, setTab] = useState('album');
  const [query, setQuery] = useState('');
  // Where to look: everything Music Assistant has, its library, or one provider (Apple Music,
  // SoundCloud...). A provider is searched; only the library can be browsed without a search.
  const [source, setSource] = useState('');
  const [providers] = useLoad(() => get('/api/music/providers').catch(() => []), []);
  const sources = [{ value: '', label: 'All' }, ...(providers || []).map((p) => ({ value: p.id, label: p.name }))];
  const sourceName = (providers || []).find((p) => p.id === source)?.name;
  const browsing = !source || source === 'library';
  const q = useDebounced(query.trim(), 450);
  const [lib, err] = useLoad(() => (q ? get(`/api/music/search?q=${encodeURIComponent(q)}${source ? `&provider=${encodeURIComponent(source)}` : ''}`).then((r) => [...r.albums, ...r.playlists, ...r.artists, ...r.tracks, ...r.radio].slice(0, source ? 36 : 18))
    : browsing ? get(`/api/music/library?type=${tab}&limit=18`) : Promise.resolve(null)), [tab, q, source]);
  const id = player || players[0];

  return html`<main class="view">
    <${Header} title="Music" kicker="Music Assistant">
      <label class="search" style="width:420px"><${Icon} name="search" color="var(--muted)" /><span class="sr">Search music</span>
        <input type="search" placeholder=${`Search ${sourceName || 'everything'}`} value=${query} onInput=${(e) => setQuery(e.target.value)} /></label>
    <//>
    <div class="music-body">
      <${NowPlaying} id=${id} />
      <div style="flex-grow:1;min-width:0;display:flex;flex-direction:column;gap:20px">
        ${sources.length > 1 && html`<div style="max-width:100%;overflow-x:auto"><${Seg} options=${sources} value=${source} onChange=${(v) => setSource(v)} /></div>`}
        ${browsing && html`<div style="width:640px"><${Seg} options=${TABS} value=${q ? null : tab} onChange=${(v) => { setQuery(''); setTab(v); }} /></div>`}
        <div class="album-grid scroll" style="max-height:560px;padding:4px">
          ${err ? html`<div class="empty" style="grid-column:1/-1">${err.message}</div>`
            : !q && !browsing ? html`<div class="empty" style="grid-column:1/-1">Search ${sourceName} for an artist, album, song or playlist</div>`
            : !lib ? html`<div class="empty" style="grid-column:1/-1">Loading…</div>`
            : !lib.length ? html`<div class="empty" style="grid-column:1/-1">${q ? `Nothing for “${q}”${sourceName ? ` on ${sourceName}` : ''}` : 'Nothing here'}</div>`
            : lib.map((m) => html`<button type="button" class="album" key=${m.uri} aria-label=${`Play ${m.name}`} onClick=${() => act({ action: 'music', cmd: 'play_media', uri: m.uri, media_type: m.type, entity_id: id })}>
                ${m.image ? html`<img src=${m.image} alt="" loading="lazy" onError=${(e) => { e.target.style.visibility = 'hidden'; }} />` : html`<div class="ph"></div>`}
                <span class="t ellipsis">${m.name}</span><span class="a ellipsis">${[m.artist || m.type, !source && q && m.providerName].filter(Boolean).join(' · ')}</span></button>`)}
        </div>
        <div style="flex-grow:1;display:flex;gap:22px;min-height:0">
          <${UpNext} id=${id} />
          <section class="card" style="width:420px;flex-shrink:0;display:flex;flex-direction:column;gap:10px">
            <${H2} title="Play on" />
            ${players.map((p) => html`<${PlayerButton} id=${p} active=${p === id} onPick=${() => setPlayer(p)} />`)}
          </section>
        </div>
      </div>
    </div>
  </main>`;
}

function PlayerButton({ id, active, onPick }) {
  const st = useEntity(id);
  return html`<button type="button" class="player-btn" aria-pressed=${active ? 'true' : 'false'} onClick=${onPick}>
    <${Icon} name="spk" size=${26} color=${active ? 'var(--acc)' : 'var(--muted)'} />
    <span style="flex-grow:1" class="ellipsis">${(st?.attributes?.friendly_name || id).replace(/ player$/i, '').replace(/\s*\([^)]*\)$/, '')}</span>
    <span class="muted" style="font-size:15px;font-weight:500">${st?.state || 'unknown'}</span>
  </button>`;
}

function NowPlaying({ id }) {
  const st = useEntity(id);
  const a = st?.attributes || {};
  const playing = st?.state === 'playing';
  const pos = livePosition(st);
  const dur = a.media_duration;
  const unavailable = !st || st.state === 'unavailable';
  const cmd = (c, extra = {}) => act({ action: 'music', cmd: c, entity_id: id, ...extra });
  return html`<section class="nowplaying dark tx-suede">
    ${a.entity_picture ? html`<img class="cover" src=${`/api/ha-image?e=${encodeURIComponent(id)}&v=${encodeURIComponent(a.entity_picture)}`} alt="" />` : html`<div class="cover"></div>`}
    <div style="align-self:stretch;text-align:center">
      <div class="ellipsis" style="font-size:30px;font-weight:700">${a.media_title || (unavailable ? 'Player unavailable' : 'Nothing playing')}</div>
      <div class="ellipsis" style="font-size:19px;color:var(--on-choc2)">${[a.media_artist, a.media_album_name].filter(Boolean).join(' · ') || (a.friendly_name || '')}</div>
    </div>
    <div style="align-self:stretch">
      <div class="bar"><i style=${`width:${dur && pos ? (pos / dur) * 100 : 0}%`}></i></div>
      <div class="mono" style="display:flex;justify-content:space-between;font-size:15px;color:var(--on-choc2);margin-top:8px"><span>${mmss(pos)}</span><span>${dur && pos != null ? `-${mmss(dur - pos)}` : ''}</span></div>
    </div>
    <div style="align-self:stretch;display:flex;align-items:center;justify-content:space-between">
      <button type="button" class="icon-btn" style="width:64px;height:64px" aria-label="Shuffle" aria-pressed=${a.shuffle ? 'true' : 'false'} disabled=${unavailable} onClick=${() => cmd('shuffle', { on: !a.shuffle })}><${Icon} name="shuffle" size=${28} color=${a.shuffle ? 'var(--gold)' : 'var(--on-choc2)'} /></button>
      <button type="button" class="icon-btn" style="width:72px;height:72px" aria-label="Previous" disabled=${unavailable} onClick=${() => cmd('previous')}><${Prev} size=${34} color="#F4F0E8" /></button>
      <button type="button" class="icon-btn" style="width:100px;height:100px;background:var(--gold)" aria-label=${playing ? 'Pause' : 'Play'} disabled=${unavailable} onClick=${() => cmd('play_pause')}>
        ${playing ? html`<${Pause} size=${40} color="var(--choc2)" />` : html`<${Play} size=${40} color="var(--choc2)" />`}</button>
      <button type="button" class="icon-btn" style="width:72px;height:72px" aria-label="Next" disabled=${unavailable} onClick=${() => cmd('next')}><${Next} size=${34} color="#F4F0E8" /></button>
      <button type="button" class="icon-btn" style="width:64px;height:64px" aria-label="Repeat" disabled=${unavailable} onClick=${() => cmd('repeat', { mode: a.repeat === 'off' ? 'all' : a.repeat === 'all' ? 'one' : 'off' })}><${Icon} name="repeat" size=${28} color=${a.repeat && a.repeat !== 'off' ? 'var(--gold)' : 'var(--on-choc2)'} /></button>
    </div>
    <div style="align-self:stretch;display:flex;align-items:center;gap:14px">
      <${Icon} name="volm" size=${26} color="var(--on-choc2)" />
      <${Range} cls="thin" value=${Math.round((a.volume_level || 0) * 100)} label="Volume" fill="var(--gold)" rest="rgba(0,0,0,.35)" onCommit=${(v) => cmd('volume', { level: v / 100 })} />
      <${Icon} name="volp" size=${26} color="var(--on-choc2)" />
    </div>
  </section>`;
}

function UpNext({ id }) {
  const title = useEntity(id)?.attributes?.media_title;
  const [q] = useLoad(() => get(`/api/music/queue?entity_id=${encodeURIComponent(id)}`).catch(() => null), [id, title]);
  const rows = [q?.current && { ...q.current, now: true }, q?.next].filter(Boolean);
  return html`<section class="card" style="flex-grow:1;min-width:0">
    <${H2} title="Queue"><span class="aside">${q?.count ? `${q.count} tracks` : ''}</span><//>
    <div style="margin-top:8px">
      ${q?.unavailable ? html`<div class="empty">This player is unavailable in Home Assistant.</div>`
        : !rows.length ? html`<div class="empty">Queue is empty</div>`
        : rows.map((r) => html`<div class="qrow" style="padding:10px 0">
            ${r.image ? html`<img src=${r.image} alt="" style="width:48px;height:48px" />` : html`<div style="width:48px;height:48px"></div>`}
            <div style="flex-grow:1;min-width:0"><div class="ellipsis" style="font-size:18px;font-weight:600">${r.name}</div><div class="muted ellipsis" style="font-size:15px">${r.artist || ''}</div></div>
            <span class=${`st ${r.now ? 'ok' : ''}`}>${r.now ? 'Now' : 'Next'}</span></div>`)}
    </div>
  </section>`;
}
