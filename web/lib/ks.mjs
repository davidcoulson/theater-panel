// Kiosk Satellite theater mode (the fork's docs/theater.md), however the panel is loaded:
//
// - Inside Home Assistant's Webpage dashboard (the normal setup, so Voice Satellite runs in
//   the HA page around us): frames never get window.kioskSatellite, so calls go to the HA page
//   with postMessage and it relays theater methods only, and only when KS's "Page allowed from
//   a frame" setting is exactly this origin.
// - As a top-level page (KS custom start page): the bridge methods are called directly.
//
// Either way a refused or unavailable call resolves null, so availability is decided by the
// result of getTheaterMode on load, not by whether a function exists.
//
// With theater mode the app does all the dimming (backlight at minimum plus a native black
// wash, first touch swallowed to peek) and restores brightness itself, even after a crash.
// Without it (ordinary browser, older KS), Showtime just dims its own controls. The old
// setBrightness save/restore is gone on purpose: it wrote the persisted default brightness.

const RELAY_TIMEOUT = 3000;
const inFrame = window.parent !== window;
const bridge = () => window.kioskSatellite;

// One theater call: {active, overlayOpacity...} for setTheaterMode, {} for getTheaterMode,
// {seconds} for theaterPeek. Resolves the bridge's result, or null when refused/unavailable.
function call(method, params = {}) {
  if (!inFrame) {
    const ks = bridge();
    if (!ks || typeof ks[method] !== 'function') return Promise.resolve(null);
    const args = method === 'setTheaterMode' ? [params.active, withoutActive(params)]
      : method === 'theaterPeek' ? [params.seconds]
      : [];
    return Promise.resolve(ks[method](...args)).catch(() => null);
  }
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const done = (r) => { removeEventListener('message', on); clearTimeout(timer); resolve(r ?? null); };
    const on = (e) => { if (e.source === window.parent && e.data?.ksTheater === 1 && e.data.id === id) done(e.data.result); };
    addEventListener('message', on);
    window.parent.postMessage({ ksTheater: 1, id, method, params }, '*');
    const timer = setTimeout(() => done(null), RELAY_TIMEOUT);
  });
}

function withoutActive(p) { const { active, ...rest } = p; return rest; }

// Resolved once at startup: the current theater state, or null when there is no theater mode.
// In a frame this first call also subscribes us to later theatermode events.
let available = null;
export const detectTheater = () => (available ??= call('getTheaterMode'));

export const enterTheater = (options = {}) => call('setTheaterMode', { active: true, overlayOpacity: 0.6, peekSeconds: 8, ...options });
export const exitTheater = () => call('setTheaterMode', { active: false });
export const theaterPeek = (seconds) => call('theaterPeek', seconds ? { seconds } : {});

// Phase changes, from the bridge's CustomEvent (top level) or the HA page's relay (frame).
// Returns an unsubscribe function.
export function onTheater(callback) {
  const onCustom = (e) => callback(e.detail || {});
  const onMessage = (e) => {
    if (e.source === window.parent && e.data?.ksTheater === 1 && e.data.event === 'theatermode') callback(e.data.detail || {});
  };
  addEventListener('kiosksatellite:theatermode', onCustom);
  if (inFrame) addEventListener('message', onMessage);
  return () => { removeEventListener('kiosksatellite:theatermode', onCustom); removeEventListener('message', onMessage); };
}

// A tap wakes the panel if the screensaver or display-off took over. Only possible at top
// level; in a frame the HA page and the app handle wake themselves.
export function wake() {
  if (inFrame) return;
  bridge()?.stopScreensaver?.();
  bridge()?.screenOn?.();
}
