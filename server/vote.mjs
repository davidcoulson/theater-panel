// Movie night: the panel picks a shortlist, everyone votes from their phones. One round at a
// time, kept in memory — a vote is a bit of fun, not something to store.

import { randomBytes, timingSafeEqual } from 'node:crypto';

const ROUND_MS = 20 * 60e3;     // a round is forgotten after this long
let round = null;               // { id, token, created, items: [{id,title,year,poster,plexId}], votes: Map<voter, itemId> }

export function start(items) {
  // The token rides the QR the panel shows: only phones that scanned it can see or vote in the round.
  round = { id: randomBytes(4).toString('hex'), token: randomBytes(12).toString('base64url'), created: Date.now(), items, votes: new Map() };
  return state();
}

export function clear() { round = null; }

export function state() {
  if (!round) return null;
  if (Date.now() - round.created > ROUND_MS) { round = null; return null; }
  const tally = Object.fromEntries(round.items.map((i) => [i.id, 0]));
  for (const choice of round.votes.values()) if (choice in tally) tally[choice] += 1;
  return { id: round.id, token: round.token, items: round.items, tally, voters: round.votes.size };
}

// The round as a phone sees it: everything but the token.
export function publicState() {
  const s = state();
  if (!s) return null;
  const { token, ...rest } = s;
  return rest;
}

// Whether a phone's token is this round's (constant time, byte lengths compared first).
export function validToken(t) {
  const s = state();
  if (!s || !t) return false;
  const a = Buffer.from(String(t)), b = Buffer.from(s.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// One vote per phone: the voter id is a random value the phone keeps, so a second tap changes
// that phone's vote instead of adding another.
const MAX_VOTERS = 60;      // a living room, not an election

export function vote(roundId, voter, itemId) {
  if (!round || round.id !== roundId) throw Object.assign(new Error('That vote has finished'), { status: 409 });
  if (!round.items.some((i) => i.id === String(itemId))) throw Object.assign(new Error('Unknown choice'), { status: 400 });
  const id = String(voter).slice(0, 64);
  if (!round.votes.has(id) && round.votes.size >= MAX_VOTERS) throw new Error('Too many voters');
  round.votes.set(id, String(itemId));
  return state();
}

// The winner, or null on a tie with no clear lead.
export function winner() {
  const s = state();
  if (!s || !s.voters) return null;
  const sorted = Object.entries(s.tally).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
  return s.items.find((i) => i.id === sorted[0][0]) || null;
}
