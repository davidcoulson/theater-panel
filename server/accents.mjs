// Holiday accents: a second axis on the panel's look, independent of the theme. A theme is the
// room (classic chocolate, or the couch's slate); an accent is what is on the mantelpiece this
// week. Each one only moves three things - the highlight colour, the rail's idle glow, and a
// small glyph by the clock - so any accent sits on any theme.
//
// ACCENT is 'auto' (by the calendar), 'none', or one of the ids below. BIRTHDAYS is a list of
// "Name=MM-DD"; on the day, the birthday accent wins over whatever holiday is running.

export const ACCENTS = [
  { id: 'halloween', name: 'Halloween', glyph: 'pumpkin', gold: '#E8731C', glow: 'Halloween Eyes' },
  { id: 'thanksgiving', name: 'Thanksgiving', glyph: 'leaf', gold: '#C8912E', glow: 'Ember Ring' },
  { id: 'christmas', name: 'Christmas', glyph: 'snowflake', gold: '#E3A865', glow: 'Fairytwinkle' },
  { id: 'newyear', name: 'New Year', glyph: 'sparkle', gold: '#F2D69B', glow: 'Fireworks Burst' },
  { id: 'valentines', name: "Valentine's", glyph: 'heart', gold: '#D9536F', glow: 'Heartbeat Pulse' },
  { id: 'birthday', name: 'Birthday', glyph: 'cake', gold: '#E3A865', glow: 'Confetti' },
];
export const IDS = ACCENTS.map((a) => a.id);

// "Name=MM-DD, Other=MM-DD" -> [{ name, month, day }]
export function parseBirthdays(text) {
  return String(text || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, date] = s.includes('=') ? s.split('=') : ['', s];
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(date.trim());
    return m ? { name: name.trim(), month: Number(m[1]), day: Number(m[2]) } : null;
  }).filter(Boolean);
}

// US Thanksgiving: the fourth Thursday of November.
function thanksgiving(year) {
  const first = new Date(year, 10, 1).getDay();           // 0 = Sunday
  return 1 + ((4 - first + 7) % 7) + 21;                  // day of month
}

// Which accent the calendar says, or 'none'. Windows are a week or so either side of the day,
// so the panel dresses up before and stays up through the day after.
export function byCalendar(now = new Date(), birthdays = []) {
  const m = now.getMonth() + 1, d = now.getDate(), y = now.getFullYear();
  const bday = birthdays.find((b) => b.month === m && b.day === d);
  if (bday) return { id: 'birthday', who: bday.name };
  if (m === 10 && d >= 24) return { id: 'halloween' };
  const tg = thanksgiving(y);
  if (m === 11 && d >= tg - 6 && d <= tg + 1) return { id: 'thanksgiving' };
  if (m === 12 && d >= 12 && d <= 26) return { id: 'christmas' };
  if ((m === 12 && d >= 27) || (m === 1 && d <= 2)) return { id: 'newyear' };
  if (m === 2 && d >= 10 && d <= 14) return { id: 'valentines' };
  return { id: 'none' };
}

// The accent in effect for a setting: a fixed id, 'auto' by the calendar, or nothing.
export function resolve(setting, birthdays = [], now = new Date()) {
  const pick = setting === 'auto' ? byCalendar(now, birthdays) : { id: IDS.includes(setting) ? setting : 'none' };
  const def = ACCENTS.find((a) => a.id === pick.id);
  return def ? { id: def.id, name: def.name, glyph: def.glyph, gold: def.gold, glow: def.glow, who: pick.who || '' } : { id: 'none' };
}
