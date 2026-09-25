// The guest remote: a link on a phone for the evening, with the basics only - pause, volume,
// the break, the lights - and nothing that needs the panel key. One token at a time, kept in
// memory; it dies at its hour or when the panel ends it, whichever comes first.

import { randomBytes } from 'node:crypto';

let guest = null;   // { token, created, expires }

export function start(hours = 6) {
  guest = { token: randomBytes(9).toString('base64url'), created: Date.now(), expires: Date.now() + Math.max(1, Math.min(24, hours)) * 3600e3 };
  return state();
}

export function end() { guest = null; }

export function state() {
  if (!guest) return null;
  if (Date.now() > guest.expires) { guest = null; return null; }
  return { token: guest.token, expires: guest.expires };
}

export function valid(token) {
  const g = state();
  return Boolean(g && token && token.length === g.token.length && token === g.token);
}
