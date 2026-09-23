// "N streams": what the Plex server is serving right now, and to whom — the detail Tautulli shows,
// without leaving the panel. Used by the Home header and the idle screen.

import { html, Icon, Poster } from '../lib/ui.mjs';
import { useStore, runtime } from '../lib/api.mjs';

// #/lobby?streams=demo fills the pill with example streams, to check the layout when the server
// is quiet.
const DEMO = [
  { key: 'd1', title: 'Avatar: Fire and Ash', type: 'movie', year: 2025, user: 'David', player: 'AURORA PRO', product: 'Plezy', state: 'playing', viewOffset: 2469133, duration: 11400000, source: '4K · HEVC · DV', audio: 'TRUEHD 8ch', decision: 'Direct play', bandwidth: 78000, location: 'lan' },
  { key: 'd2', showTitle: 'The Office', season: 3, episode: 12, title: 'Traveling Salesmen', type: 'episode', user: 'Eilee', player: 'iPhone', product: 'Plex for iOS', state: 'playing', viewOffset: 540000, duration: 1320000, source: '1080p · H264', audio: 'AAC 2ch', decision: 'Transcode', hw: true, bandwidth: 4200, location: 'wan' },
  { key: 'd3', title: 'Band of Brothers', showTitle: 'Band of Brothers', season: 1, episode: 2, type: 'episode', user: 'Jack', player: 'Roku Ultra', product: 'Plex for Roku', state: 'paused', viewOffset: 1500000, duration: 3300000, source: '1080p · H264', audio: 'EAC3 6ch', decision: 'Direct stream', bandwidth: 12000, location: 'lan' },
];

export const useStreams = () => {
  const live = useStore((s) => s.streams) || [];
  return new URLSearchParams(location.hash.split('?')[1] || '').get('streams') === 'demo' ? DEMO : live;
};

// The pill itself. Quiet when nothing is playing.
export function StreamsChip({ onClick, dark = false }) {
  const streams = useStreams();
  const n = streams.length;
  return html`<button type="button" class=${`chip ${dark ? 'dark-chip' : ''} ${n ? 'live' : ''}`} onClick=${onClick}
    aria-label=${`${n} Plex stream${n === 1 ? '' : 's'}`}>
    <span class=${`dot ${n ? 'on' : ''}`}></span>${n} stream${n === 1 ? '' : 's'}
  </button>`;
}

const pct = (s) => (s.duration ? Math.min(100, Math.round((s.viewOffset / s.duration) * 100)) : 0);
const mbps = (kbps) => (kbps ? `${(kbps / 1000).toFixed(1)} Mbps` : null);

// The popup: one row per stream, like Tautulli's activity page.
export function StreamsSheet({ onClose }) {
  const streams = useStreams();
  const total = streams.reduce((a, s) => a + (s.bandwidth || 0), 0);
  return html`<div class="streams-sheet" role="dialog" aria-label="Plex streams">
    <div class="h">
      <div><div class="eyebrow">Plex server</div>
        <div class="t">${streams.length} stream${streams.length === 1 ? '' : 's'}${total ? ` · ${mbps(total)}` : ''}</div></div>
      <button type="button" class="icon-btn" style="width:46px;height:46px;background:rgba(0,0,0,.25)" aria-label="Close" onClick=${onClose}>
        <${Icon} name="x" color="#F4F0E8" /></button>
    </div>
    <div class="rows scroll">
      ${!streams.length && html`<div class="empty" style="color:#C7B39E">Nobody is watching anything.</div>`}
      ${streams.map((s) => html`<div class="row" key=${s.key}>
        <div class="art"><${Poster} src=${s.poster} title=${s.showTitle || s.title} /></div>
        <div class="info">
          <div class="t ellipsis">${s.showTitle ? `${s.showTitle} · S${s.season}E${s.episode}` : s.title}</div>
          <div class="who ellipsis">${s.user} · ${s.player}${s.product ? ` (${s.product})` : ''}</div>
          <div class="bar"><i style=${`width:${pct(s)}%`}></i></div>
          <div class="meta">
            <span class=${`tag ${s.decision === 'Transcode' ? 'warn' : 'ok'}`}>${s.decision}${s.hw ? ' (hw)' : ''}</span>
            ${s.source && html`<span>${s.source}</span>`}
            ${s.audio && html`<span>${s.audio}</span>`}
            ${mbps(s.bandwidth) && html`<span>${mbps(s.bandwidth)}</span>`}
            <span>${s.location === 'lan' ? 'Local' : 'Remote'}</span>
          </div>
        </div>
        <div class="time">
          <div class="state">${s.state === 'paused' ? 'Paused' : 'Playing'}</div>
          <div class="left">${runtime(Math.max(0, (s.duration || 0) - (s.viewOffset || 0)))} left</div>
        </div>
      </div>`)}
    </div>
  </div>`;
}
