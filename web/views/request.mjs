// Request: search Seerr (or browse trending / upcoming), request titles, and follow the queue.

import { useState } from 'preact/hooks';
import { html, Icon, Play, Poster, Seg, Header, H2, useDebounced } from '../lib/ui.mjs';
import { get, post, useLoad, toast } from '../lib/api.mjs';
import { go, route } from '../app.mjs';
import { useNetworks, NetworkPicker } from './networks.mjs';

const STATUS_LABEL = { available: 'In library', partial: 'Partly in library', processing: 'Downloading', pending: 'Requested' };

export function Request() {
  const [mode, setMode] = useState(route.params.mode || (route.params.brand ? 'networks' : 'trending'));
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 450);
  const [picked, setPicked] = useState(null);
  const [reqs, , reloadReqs] = useLoad(() => get('/api/seerr/requests?take=6'), []);

  const [brand, setBrand] = useState(route.params.brand || null);
  const networks = useNetworks();
  const picking = !q && mode === 'networks' && !brand;
  const src = q ? `/api/seerr/search?q=${encodeURIComponent(q)}`
    : mode === 'networks' ? (brand ? `provider:${brand}:${kind}` : null)
    : `/api/seerr/discover/${mode === 'upcoming' ? (kind === 'tv' ? 'tv' : 'movies') : 'trending'}`;
  const [data, err] = useLoad(() => {
    if (!src) return Promise.resolve({ results: [] });
    if (!src.startsWith('provider:')) return get(src);
    // "Streaming on" a network: movies, shows, or both interleaved.
    const types = kind === 'all' ? ['movie', 'tv'] : [kind];
    return Promise.all(types.map((t) => get(`/api/seerr/provider/${brand}?type=${t}`))).then((rs) => {
      const lists = rs.map((r) => r.results); const out = [];
      for (let i = 0; i < 20; i++) for (const l of lists) if (l[i]) out.push(l[i]);
      return { results: out };
    });
  }, [src]);
  const results = (data?.results || []).filter((r) => kind === 'all' || r.mediaType === kind).slice(0, 16);

  return html`<main class="view">
    <${Header} title="Request" kicker="Seerr · Radarr · Sonarr">
      <div style="width:620px"><${Seg} cls="tall" options=${[{ value: 'trending', label: 'Trending' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'networks', label: 'Networks' }]} value=${q ? null : mode} onChange=${(v) => { setQuery(''); setMode(v); setBrand(null); }} /></div>
    <//>
    <div style="display:flex;gap:16px;align-items:center">
      <label class="search strong" style="flex-grow:1"><${Icon} name="search" size=${28} /><span class="sr">Search movies and shows</span>
        <input type="search" placeholder="Search for a movie or show" value=${query} onInput=${(e) => setQuery(e.target.value)} />
        ${query && html`<button type="button" class="icon-btn" aria-label="Clear search" style="width:44px;height:44px" onClick=${() => setQuery('')}><${Icon} name="x" /></button>`}
      </label>
      <div style="width:340px"><${Seg} cls="tall" options=${[{ value: 'all', label: 'All' }, { value: 'movie', label: 'Movies' }, { value: 'tv', label: 'TV' }]} value=${kind} onChange=${setKind} /></div>
    </div>
    <div class="req-body">
      ${picking ? html`<div class="scroll" style="flex-grow:1;min-width:0"><${NetworkPicker} networks=${networks} onPick=${setBrand} hint="What's streaming on each service right now. Request anything you don't have yet." /></div>` : html`
      <div class="req-grid scroll">
        ${mode === 'networks' && brand && !q && html`<div style="grid-column:1/-1;display:flex;align-items:center;gap:14px">
          <button type="button" class="filter" onClick=${() => setBrand(null)}><${Icon} name="left" size=${18} />All networks</button>
          <span style="font-size:19px;font-weight:600">Streaming on ${networks.find((n) => n.id === brand)?.name}</span></div>`}
        ${err ? html`<div class="empty" style="grid-column:1/-1">${err.message}</div>`
          : !data ? html`<div class="empty" style="grid-column:1/-1">Loading…</div>`
          : !results.length ? html`<div class="empty" style="grid-column:1/-1">No results</div>`
          : results.map((r) => html`<${ResultCard} key=${r.id} r=${r} selected=${picked?.id === r.id} onPick=${() => setPicked(r)} />`)}
      </div>`}
      <div class="req-side">
        ${picked ? html`<${Sheet} r=${picked} key=${picked.id} onClose=${() => setPicked(null)} onDone=${() => { setPicked(null); reloadReqs(); }} />`
          : html`<div class="dark tx-suede" style="padding:26px"><div class="eyebrow">How it works</div>
              <div style="font-size:19px;line-height:1.5;margin-top:8px;color:var(--on-choc)">Tap a poster to request it. Movies go to Radarr and shows to Sonarr, and they appear in Plex when the download finishes.</div></div>`}
        <section class="card scroll" style="flex-grow:1">
          <${H2} title="Your requests"><span class="aside">${reqs ? `${reqs.total} total` : ''}</span><//>
          <div style="margin-top:8px">
            ${(reqs?.results || []).map((r) => html`<div class="qrow">
              ${r.poster ? html`<img src=${r.poster} alt="" loading="lazy" />` : html`<div style="width:56px;height:84px"></div>`}
              <div style="flex-grow:1;min-width:0;display:flex;flex-direction:column;gap:8px">
                <div style="display:flex;justify-content:space-between;gap:12px"><span class="ellipsis" style="font-size:19px;font-weight:600">${r.title} <span class="muted" style="font-weight:400">${r.year ? `(${r.year})` : ''}</span></span>
                  <span class=${`st ${r.label === 'Available' ? 'ok' : ''}`}>${r.label}</span></div>
                ${r.progress != null && html`<div class="bar light"><i style=${`width:${r.progress}%`}></i></div>`}
                <div class="muted" style="font-size:15px">${r.mediaType === 'tv' ? 'Sonarr' : 'Radarr'}${r.is4k ? ' · 4K' : ''}${r.requestedBy ? ` · ${r.requestedBy}` : ''}${r.progress != null ? ` · ${r.progress}%` : ''}</div>
              </div>
            </div>`)}
          </div>
        </section>
      </div>
    </div>
  </main>`;
}

function ResultCard({ r, selected, onPick }) {
  const inLib = r.status === 'available';
  return html`<div class="req-card">
    <button type="button" class="poster-btn" aria-pressed=${selected ? 'true' : 'false'} onClick=${onPick} aria-label=${`${r.title} (${r.year || ''})`}>
      <${Poster} src=${r.poster} title=${r.title}>
        ${r.status !== 'none' && r.status !== 'unknown' && html`<span class=${`status ${r.status}`}>${inLib && html`<${Icon} name="check" size=${15} />`}${STATUS_LABEL[r.status] || r.status}</span>`}
        ${upcoming(r.releaseDate)
          ? html`<span class="kind soon">${r.mediaType === 'tv' ? 'TV' : 'Movie'} · Releasing ${fmtDate(r.releaseDate)}</span>`
          : html`<span class="kind">${r.mediaType === 'tv' ? 'TV' : 'Movie'}${r.year ? ` · ${r.year}` : ''}</span>`}
      <//>
    </button>
    ${inLib && r.plexKey
      ? html`<button type="button" class="btn sm" onClick=${() => go('watch', { item: String(r.plexKey) })}><${Play} size=${18} />Open in Watch</button>`
      : html`<button type="button" class=${`btn sm ${r.status === 'none' ? 'primary' : ''}`} onClick=${onPick}>${r.status === 'none' ? 'Request' : 'Details'}</button>`}
  </div>`;
}

function Sheet({ r, onClose, onDone }) {
  const [d] = useLoad(() => get(`/api/seerr/${r.mediaType}/${r.id}`), [r.id]);
  const [allSeasons, setAllSeasons] = useState(true);
  const [is4k, set4k] = useState(false);
  const [busy, setBusy] = useState(false);
  const info = d || r;
  const missingQ = (st) => st === 'none' || st === 'unknown';
  const requestable = missingQ(info.status) || (r.mediaType === 'tv' ? info.status === 'partial' : missingQ(info.status4k));
  const missing = (d?.seasons || []).filter((s) => s.status === 'none' || s.status === 'unknown').map((s) => s.number);

  async function send() {
    setBusy(true);
    try {
      await post('/api/seerr/request', {
        mediaType: r.mediaType, mediaId: r.id, is4k: r.mediaType === 'tv' ? is4k : undefined,
        seasons: r.mediaType === 'tv' ? (allSeasons ? (missing.length ? missing : 'all') : [1]) : undefined,
      });
      toast(`Requested ${r.title}`);
      onDone();
    } catch (e) { toast(e.message, true); }
    setBusy(false);
  }

  return html`<div class="sheet dark tx-suede">
    <div class="framed" style="width:150px;align-self:flex-start"><${Poster} src=${r.poster} title=${r.title} /></div>
    <div style="flex-grow:1;min-width:0;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;gap:12px">
        <div style="min-width:0"><div class="eyebrow" style="font-size:14px">${r.mediaType === 'tv' ? 'Series' : 'Movie'} · ${r.mediaType === 'tv' ? 'Sonarr' : 'Radarr'}</div>
          <div class="clamp2" style="font-family:var(--disp);font-weight:800;font-size:40px;line-height:1;text-transform:uppercase">${r.title}</div>
          <div style="font-size:16px;color:var(--on-choc2)">${[info.year, info.runtime && `${info.runtime} min`, ...(d?.genres || [])].filter(Boolean).join(' · ')}</div></div>
        <button type="button" class="icon-btn" aria-label="Close" style="width:52px;height:52px;background:rgba(0,0,0,.3);flex-shrink:0" onClick=${onClose}><${Icon} name="x" color="#F4F0E8" /></button>
      </div>
      <div class="clamp3" style="font-size:16px;line-height:1.45;color:var(--on-choc)">${info.overview}</div>
      ${requestable ? html`
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${r.mediaType === 'tv' && html`<button type="button" class="pill" aria-pressed=${allSeasons ? 'true' : 'false'} onClick=${() => setAllSeasons(true)}>${missing.length && info.status === 'partial' ? `Missing seasons (${missing.length})` : 'All seasons'}</button>
            <button type="button" class="pill" aria-pressed=${!allSeasons ? 'true' : 'false'} onClick=${() => setAllSeasons(false)}>Season 1</button>`}
          ${r.mediaType === 'tv' && html`<button type="button" class="pill" aria-pressed=${!is4k ? 'true' : 'false'} onClick=${() => set4k(false)}>1080p</button>
            <button type="button" class="pill" aria-pressed=${is4k ? 'true' : 'false'} onClick=${() => set4k(true)}>4K</button>`}
        </div>
        ${r.mediaType === 'movie' && html`<div style="font-size:15px;color:var(--on-choc2)">Requests ${missingQ(info.status) && missingQ(info.status4k) ? '1080p and 4K' : missingQ(info.status) ? '1080p (4K is already in Plex or on its way)' : '4K (1080p is already in Plex or on its way)'}</div>`}
        <button type="button" class="btn primary" style="height:66px" disabled=${busy} onClick=${send}><${Icon} name="dl" />${busy ? 'Requesting…' : r.mediaType === 'tv' ? `Request in ${is4k ? '4K' : '1080p'}` : 'Request'}</button>
      ` : html`<div class="chip" style="align-self:flex-start">${STATUS_LABEL[info.status] || info.status}</div>`}
    </div>
  </div>`;
}

// Release dates: "Releasing Oct 3" for anything still to come; the year otherwise.
const upcoming = (d) => Boolean(d) && new Date(`${d}T00:00:00`) > new Date();
function fmtDate(d, withYear = false) {
  const dt = new Date(`${d}T00:00:00`);
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear || !sameYear ? { year: 'numeric' } : {}) });
}
