// Talking to the panel server: JSON fetches, actions, and a live store fed by the SSE stream.

import { useEffect, useRef, useState } from 'preact/hooks';

export async function get(path) {
  const r = await fetch(path);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

export async function post(path, data) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

// Fire an action; failures surface as a toast instead of throwing into the UI.
export async function act(data) {
  try { return await post('/api/action', data); }
  catch (e) { toast(e.message, true); return null; }
}

// ---------- live store ----------

let state = { vote: null, sleep: null, preroll: {}, streams: [], connected: null, haConnected: false, haConfigured: true, states: {}, sessions: [], entities: {}, ui: {}, theater: null, toast: null };
const listeners = new Set();
function set(patch) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
export const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
// Re-render only when the selected slice changes (compared shallowly by JSON for objects).
export function useStore(select = (s) => s) {
  const [, force] = useState(0);
  const last = useRef();
  const sel = useRef(select);
  sel.current = select;           // the selector changes when its inputs do (useEntity(id))
  const value = select(state);
  last.current = value;
  useEffect(() => subscribe(() => {
    const next = sel.current(state);
    if (next === last.current) return;                       // same object: nothing to do
    if (typeof next === 'object' && next !== null && JSON.stringify(next) === JSON.stringify(last.current)) return;
    force((x) => x + 1);
  }), []);
  return value;
}
export const getState = () => state;
// Theater mode availability/state, set by app.mjs once Kiosk Satellite answers (or not).
export const setTheater = (theater) => set({ theater });
// Something worth a cheer just happened (a request landed): the app throws confetti.
export const celebrate = () => set({ celebrateAt: Date.now() });

let toastTimer;
export function toast(text, err = false) {
  clearTimeout(toastTimer);
  set({ toast: { text, err } });
  toastTimer = setTimeout(() => set({ toast: null }), 3500);
}

let onNavigate = null;
export async function startLive({ navigate } = {}) {
  onNavigate = navigate;
  // Open the live stream before anything else so it gets a connection ahead of the posters.
  const es = new EventSource('/api/events');
  const loadSettings = () => get('/api/state').then((s) => set({ entities: s.entities, services: s.services, ui: s.ui || {}, projectorApps: s.projectorApps || [], effectFavourites: s.effectFavourites || [], build: s.build || {}, idleMinutes: s.idleMinutes ?? 8, sleep: s.sleep || null, preroll: s.preroll || {} })).catch(() => {});
  loadSettings();
  es.addEventListener('hello', (e) => {
    const d = JSON.parse(e.data);
    set({ connected: true, haConnected: d.ha.connected, haConfigured: d.ha.configured, states: d.ha.states, sessions: d.sessions, streams: d.streams || [] });
  });
  es.addEventListener('states', (e) => {
    const changed = JSON.parse(e.data);
    const states = { ...state.states };
    for (const [id, s] of Object.entries(changed)) { if (s) states[id] = s; else delete states[id]; }
    set({ states });
  });
  es.addEventListener('ha', (e) => set({ haConnected: JSON.parse(e.data).connected }));
  es.addEventListener('sessions', (e) => set({ sessions: JSON.parse(e.data) }));
  // Everything playing on the Plex server, behind the "N streams" pill.
  es.addEventListener('streams', (e) => set({ streams: JSON.parse(e.data) }));
  // Saved on the admin page: pick up the new entities, apps and display options.
  es.addEventListener('settings', loadSettings);
  // The sleep timer, armed from Showtime and counted down by the server.
  es.addEventListener('sleep', (e) => {
    const d = JSON.parse(e.data);
    set({ sleep: d.mode ? d : null });
    if (d.fired) toast(`Room off ${d.fired}`);
  });
  // Movie night: the shortlist and the running tally.
  es.addEventListener('vote', (e) => set({ vote: JSON.parse(e.data) }));
  // Home Assistant (or anything with access to the panel's API) can move the panel to a route.
  es.addEventListener('navigate', (e) => { const d = JSON.parse(e.data); onNavigate?.(d.route); });
  // EventSource reconnects by itself; only call it offline if that has not worked after 8 s.
  let offlineTimer;
  es.onerror = () => { clearTimeout(offlineTimer); offlineTimer = setTimeout(() => { if (es.readyState !== 1) set({ connected: false }); }, 8000); };
  es.onopen = () => { clearTimeout(offlineTimer); set({ connected: true }); };
}

export const useEntity = (id) => useStore((s) => (id ? s.states[id] : undefined));

// Load data once per key; returns [data, error, reload].
export function useLoad(fn, deps) {
  const [res, setRes] = useState({ data: undefined, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setRes((r) => ({ data: r.data, error: null }));
    fn().then((data) => live && setRes({ data, error: null }), (error) => live && setRes({ data: null, error }));
    return () => { live = false; };
  }, [...deps, n]);
  return [res.data, res.error, () => setN((x) => x + 1)];
}

// ---------- small helpers ----------

export const clock = (d = new Date()) => {
  const h = d.getHours() % 12 || 12;
  return { hm: `${h}:${String(d.getMinutes()).padStart(2, '0')}`, ampm: d.getHours() < 12 ? 'AM' : 'PM' };
};
export const endsAt = (remainingMs) => { const c = clock(new Date(Date.now() + remainingMs)); return `${c.hm} ${c.ampm}`; };
export const runtime = (ms) => {
  if (!ms) return '';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
export const mmss = (sec) => {
  if (sec == null || Number.isNaN(sec)) return '';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// HA's media_position is as of media_position_updated_at; extrapolate while playing.
export function livePosition(st) {
  const a = st?.attributes || {};
  if (a.media_position == null) return null;
  let pos = a.media_position;
  if (st.state === 'playing' && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
  return Math.min(pos, a.media_duration || pos);
}
