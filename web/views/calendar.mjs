// Calendar: what Sonarr and Radarr expect around today, one column per day. Seven days fit on
// screen (three back, today, three ahead); the strip scrolls two weeks back and four ahead.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, Icon, Play, Seg, Header } from '../lib/ui.mjs';
import { get, useLoad, toast } from '../lib/api.mjs';
import { play } from './lobby.mjs';

const BACK = 14, AHEAD = 28, BEFORE_TODAY = 3;
const COL = 232, GAP = 12;

const pad = (n) => String(n).padStart(2, '0');
export const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const RELEASE = { cinema: 'In cinemas' };

// Episodes of one show on one day become one entry ("S2 · E1-6"), so a season drop is one card.
export function group(events, kind) {
  const days = new Map();
  const add = (day, item) => { if (!days.has(day)) days.set(day, []); days.get(day).push(item); };
  const shows = new Map();
  for (const e of events) {
    if (kind === 'ours' ? !e.pick : kind !== 'all' && e.kind !== kind) continue;
    if (e.kind === 'movie') { add(e.date, e); continue; }
    const day = localDay(new Date(e.at));
    const key = `${day}:${e.seriesId}`;
    const s = shows.get(key);
    if (s) { s.eps.push(e); continue; }
    const show = { ...e, id: key, eps: [e] };
    shows.set(key, show);
    add(day, show);
  }
  for (const s of shows.values()) s.eps.sort((a, b) => a.season - b.season || a.episode - b.episode);
  // What the house follows first; then films (they have no time of day), then shows by air time.
  const rank = (x) => (x.pick ? 0 : 1);
  for (const list of days.values()) {
    list.sort((a, b) => rank(a) - rank(b) || (a.kind === b.kind ? (a.at || '').localeCompare(b.at || '') || a.title.localeCompare(b.title) : a.kind === 'movie' ? -1 : 1));
  }
  return days;
}

function epLabel(eps) {
  const first = eps[0], last = eps[eps.length - 1];
  if (eps.length === 1) return `S${first.season} · E${first.episode}`;
  if (first.season === last.season) return `S${first.season} · E${first.episode}–${last.episode}`;
  return `${eps.length} episodes`;
}

export function Show({ s, now }) {
  const aired = new Date(s.at).getTime() <= now;
  const got = s.eps.filter((e) => e.hasFile).length;
  const st = got === s.eps.length ? null : aired ? ['miss', got ? `${got} of ${s.eps.length}` : 'Missing'] : ['soon', timeOf(s.at)];
  const flag = s.eps.some((e) => e.finale) ? 'Finale' : s.eps.some((e) => e.premiere) ? (s.eps[0].season === 1 ? 'New show' : 'Premiere') : null;
  const named = s.eps.length === 1 && s.name;
  const bare = !flag && !st && !(s.network && !aired);
  return html`<div class=${`cal-item ${s.pick ? 'picked' : ''}`}>
    <${Thumb} src=${s.poster} title=${s.title} />
    <div class="txt">
      <div class="t">${s.title}</div>
      <div class="sub">${epLabel(s.eps)}${named && !bare ? html` · <span>${s.name}</span>` : ''}</div>
      ${named && bare && html`<div class="sub"><span>${s.name}</span></div>`}
      ${!bare && html`<div class="tags">${flag && html`<span class="pill flag">${flag}</span>`}${st && html`<span class=${`pill ${st[0]}`}>${st[1]}</span>`}${s.network && !aired ? html`<span class="net">${s.network}</span>` : ''}</div>`}
    </div>
  </div>`;
}

export function Movie({ m, today }) {
  const out = m.date <= today;
  const st = m.hasFile ? null : out && m.release !== 'cinema' ? ['miss', 'Missing'] : null;
  return html`<div class=${`cal-item ${m.release === 'cinema' && !m.hasFile ? 'dim' : ''} ${m.pick ? 'picked' : ''}`}>
    <${Thumb} src=${m.poster} title=${m.title} />
    <div class="txt">
      <div class="t">${m.title}</div>
      <div class="sub">Movie${m.year ? ` · ${m.year}` : ''}</div>
      <div class="tags">${m.release === 'cinema' && html`<span class=${`pill rel ${m.release}`}>${RELEASE[m.release]}</span>`}${st && html`<span class=${`pill ${st[0]}`}>${st[1]}</span>`}${m.in4k && html`<span class=${`pill k4 ${m.has4k ? 'ok' : ''}`}>4K</span>`}</div>
    </div>
  </div>`;
}

function Thumb({ src, title }) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]);
  return src && ok ? html`<img class="thumb" src=${src} alt="" loading="lazy" decoding="async" onError=${() => setOk(false)} />`
    : html`<div class="thumb none">${title.slice(0, 1)}</div>`;
}

export function Calendar() {
  const [kind, setKind] = useState('all');
  const [data, err] = useLoad(() => get(`/api/calendar?back=${BACK}&ahead=${AHEAD}`), []);
  const strip = useRef(null);
  // The day changes under a panel left on this page overnight; check every few minutes.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5 * 60000); return () => clearInterval(t); }, []);
  const today = localDay(new Date(now));

  const days = useMemo(() => {
    const out = [], base = new Date(now);
    for (let i = -BACK; i <= AHEAD; i++) out.push(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
    return out;
  }, [today]);
  const byDay = useMemo(() => group(data?.events || [], kind), [data, kind]);

  const toToday = (smooth) => strip.current?.scrollTo({ left: (BACK - BEFORE_TODAY) * (COL + GAP), behavior: smooth ? 'smooth' : 'auto' });
  useEffect(() => toToday(false), [today, Boolean(data)]);
  const page = (n) => strip.current?.scrollBy({ left: n * 7 * (COL + GAP), behavior: 'smooth' });

  const services = data?.services || {};
  const kinds = [{ value: 'all', label: 'All' }, { value: 'ours', label: 'Ours' }, { value: 'tv', label: 'TV', disabled: services.tv === false }, { value: 'movie', label: 'Movies', disabled: services.movies === false }];
  return html`<main class="view cal-view">
    <${Header} title="Calendar" kicker="Sonarr · Radarr">
      <div style="width:520px"><${Seg} cls="tall" options=${kinds} value=${kind} onChange=${setKind} /></div>
      <button type="button" class="filter" aria-label="Previous week" onClick=${() => page(-1)}><${Icon} name="left" size=${20} /></button>
      <button type="button" class="filter" onClick=${() => toToday(true)}>Today</button>
      <button type="button" class="filter" aria-label="Next week" onClick=${() => page(1)}><span style="display:inline-flex;transform:scaleX(-1)"><${Icon} name="left" size=${20} /></span></button>
    <//>
    ${data?.errors?.length ? html`<div class="cal-note">${data.errors.join(' · ')}. Showing what the rest sent.</div>` : null}
    ${err && !data ? html`<div class="empty" style="flex-grow:1">${err.message}</div>`
      : !data ? html`<div class="empty" style="flex-grow:1">Loading…</div>`
      : html`<div class="cal-strip" ref=${strip}>
        ${days.map((d) => {
          const key = localDay(d), items = byDay.get(key) || [];
          const rel = key === today ? 'Today' : null;
          const first = d.getDate() === 1 || key === localDay(days[0]);
          return html`<section key=${key} class=${`cal-day ${key === today ? 'today' : key < today ? 'past' : ''}`}>
            <div class="cal-head">
              <span class="wd">${rel || d.toLocaleDateString([], { weekday: 'short' })}</span>
              <span class="dn">${first ? d.toLocaleDateString([], { month: 'short' }) + ' ' : ''}${d.getDate()}</span>
            </div>
            <div class="cal-list scroll">
              ${items.length ? items.map((it) => (it.kind === 'movie' ? html`<${Movie} key=${it.id} m=${it} today=${today} />` : html`<${Show} key=${it.id} s=${it} now=${now} />`))
                : html`<div class="cal-none">Nothing</div>`}
            </div>
          </section>`;
        })}
      </div>`}
  </main>`;
}

// One show on the lobby card, laid out like the hero: poster, title, season and episode, year and
// length, and a play button that finds the episode in Plex. Nothing downloaded yet dims the row.
function seasonLabel(eps) {
  const first = eps[0], last = eps[eps.length - 1];
  if (eps.length === 1) return `Season ${first.season}, Episode ${first.episode}`;
  if (first.season === last.season) return `Season ${first.season}, Episodes ${first.episode}–${last.episode}`;
  return `${eps.length} episodes`;
}
function DayShow({ s, now }) {
  const [busy, setBusy] = useState(false);
  const aired = new Date(s.at).getTime() <= now;
  const got = s.eps.filter((e) => e.hasFile).length;
  const gone = aired && got === 0;
  const note = got === s.eps.length ? null : gone ? 'Missing' : aired ? `${got} of ${s.eps.length}` : timeOf(s.at);
  const facts = [s.year, s.runtime && `${s.runtime}m`].filter(Boolean).join(' · ');
  const start = async () => {
    const ep = s.eps.find((e) => e.hasFile) || s.eps[0];
    setBusy(true);
    try {
      const it = await get(`/api/plex/episode?tmdb=${s.tmdbId}&season=${ep.season}&episode=${ep.episode}`);
      if (!it) { toast(`${s.title} isn't in Plex yet`); return; }
      await play(it, true);
    } catch (e) { toast(e.message || 'Could not start it'); }
    finally { setBusy(false); }
  };
  return html`<div class=${`day-item ${gone ? 'gone' : ''}`}>
    <${Thumb} src=${s.poster} title=${s.title} />
    <div class="body">
      <div class="t">${s.title}</div>
      <div class="sub">${seasonLabel(s.eps)}${note && html` <span class="pill">${note}</span>`}</div>
      ${facts && html`<div class="times">${facts}</div>`}
    </div>
    ${!gone && s.tmdbId && html`<button type="button" class="btn primary play" aria-label=${`Play ${s.title}`} disabled=${busy} onClick=${start}><${Play} size=${30} color="#fff" /></button>`}
  </div>`;
}

// The lobby's card: what the house follows around tonight. Opens on last night, since that is what
// is usually being watched; the arrows step on to tonight and tomorrow.
const DAYS = [{ label: 'Last night', offset: -1 }, { label: 'Tonight', offset: 0 }, { label: 'Tomorrow', offset: 1 }];

export function DayCard() {
  const [data, err] = useLoad(() => get('/api/calendar?back=1&ahead=1'), []);
  const [at, setAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5 * 60000); return () => clearInterval(t); }, []);
  const today = localDay(new Date(now));
  const byDay = useMemo(() => group(data?.events || [], 'ours'), [data]);
  const day = DAYS[at];
  const d = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + day.offset);
  const items = byDay.get(localDay(d)) || [];
  return html`<section class="day-card dark tx-suede">
    <div class="day-nav">
      <button type="button" class="filter" aria-label="Earlier" disabled=${at === 0} onClick=${() => setAt(at - 1)}><${Icon} name="left" size=${22} /></button>
      <div class="day-title"><b>${day.label}</b><span>${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</span></div>
      <button type="button" class="filter" aria-label="Later" disabled=${at === DAYS.length - 1} onClick=${() => setAt(at + 1)}><span style="display:inline-flex;transform:scaleX(-1)"><${Icon} name="left" size=${22} /></span></button>
    </div>
    <div class="day-list scroll">
      ${err && !data ? html`<div class="cal-none">${err.message}</div>`
        : !data ? html`<div class="cal-none">Loading…</div>`
        : items.length ? items.map((it) => (it.kind === 'movie' ? html`<${Movie} key=${it.id} m=${it} today=${today} />` : html`<${DayShow} key=${it.id} s=${it} now=${now} />`))
        : html`<div class="cal-none">Nothing on the list</div>`}
    </div>
    <div class="day-dots">${DAYS.map((x, i) => html`<i class=${i === at ? 'on' : ''}></i>`)}</div>
  </section>`;
}
