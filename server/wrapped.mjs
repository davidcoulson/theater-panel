// The December "Wrapped": the year's numbers, sent to the family's phones through Home
// Assistant on the day the settings page names. The message is built from the same review the
// Year in review screen shows; a marker file keeps it to once a year.

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';
import * as taste from './taste.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The message, from the review. Plain sentences: notification text has no room for a table.
export async function message(year = new Date().getFullYear()) {
  const r = await taste.review({ year });
  const top = r.top.slice(0, 3).map((t) => t.title).join(', ');
  const who = r.people[0];
  const busiest = MONTHS[r.months.indexOf(Math.max(...r.months))];
  const lines = [
    `About ${r.hours.toLocaleString()} hours in front of a screen, across ${r.plays.toLocaleString()} plays and ${r.distinct} different titles.`,
    top ? `The house kept coming back to ${top}.` : null,
    who ? `${who.name} watched the most: ${who.plays.toLocaleString()} plays.` : null,
    busiest ? `${busiest} was the busiest month.` : null,
    r.binge ? `Longest sitting: ${r.binge.plays} episodes of ${r.binge.title} in one day.` : null,
  ].filter(Boolean);
  return { title: `${year} at the theater`, message: lines.join(' '), year };
}

const marker = (year) => join(config.cacheDir, `wrapped-${year}.sent`);

// Send it now, to the configured notify entities (or the ones given).
export async function send(ha, targets = config.wrapped.notify, { year = new Date().getFullYear(), test = false } = {}) {
  if (!targets.length) throw new Error('No notify entities set for the Wrapped message');
  const m = await message(year);
  await ha.callService('notify', 'send_message', { title: test ? `${m.title} (test)` : m.title, message: m.message }, { target: { entity_id: targets } });
  if (!test) { mkdirSync(config.cacheDir, { recursive: true }); writeFileSync(marker(year), new Date().toISOString()); }
  return { sent: targets, ...m };
}

// Once a day, see whether it is the day.
export function schedule(ha) {
  const tick = () => {
    const now = new Date();
    const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (today !== config.wrapped.date || now.getHours() < 9 || !config.wrapped.notify.length) return;
    if (existsSync(marker(now.getFullYear()))) return;
    send(ha).then((r) => console.log('[wrapped] sent to', r.sent.join(', '))).catch((e) => console.warn('[wrapped]', e.message));
  };
  setInterval(tick, 30 * 60e3).unref?.();
  setTimeout(tick, 60e3).unref?.();
}
