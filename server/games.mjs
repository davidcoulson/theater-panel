// Games: pick a console or the gaming PC, show the PC's stats, and browse / launch the Steam
// library. Sources are described in config/games.json (see config/games.example.json):
//
//   via "switcher"  -> the projector goes to the switcher's HDMI input, then Home Assistant's
//                      select for the HDMI switcher (the orei_ukm integration) picks `option`.
//   via "projector" -> the projector goes straight to that source's input (the Windows VM).
//
// Everything goes through Home Assistant; the panel never talks to the hardware itself.
// Either kind may also run an HA script (wake a console, start Steam Big Picture...).

import { readFile, readdir } from 'node:fs/promises';
import { request } from 'node:https';
import { execFile } from 'node:child_process';
import { config, settings } from './config.mjs';

const file = process.env.GAMES_CONFIG || './config/games.json';
let active = null;          // id of the last projector-input source picked from the panel

// The Apple TV on HDMI 1 used to be built into the Projector card; older configs get it as an
// ordinary source (first, projector card only) so it can be edited like the others.
const APPLE_TV = { id: 'appletv', name: 'Apple TV', icon: 'tv', via: 'projector', projectorInput: 'HDMI 1', games: false };
function withAppleTv(g) {
  if (!g || g.sources?.some((s) => s.via === 'projector' && s.projectorInput === 'HDMI 1')) return g;
  const direct = (g.sources || []).filter((s) => s.via !== 'switcher');
  const switched = (g.sources || []).filter((s) => s.via === 'switcher');
  return { ...g, sources: [APPLE_TV, ...direct, ...switched] };
}

async function readGamesFile() {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[games] ${file}: ${e.message}`);
    return null;
  }
}

export async function loadGamesFile() { return withAppleTv(await readGamesFile()); }

// Games saved on the admin page win over the games.json file. Ones saved since every source
// became editable (v 2) are used as they are.
export async function loadGames() {
  const saved = settings().games;
  if (saved) return saved.v >= 2 ? saved : withAppleTv(saved);
  return loadGamesFile();
}

// A switcher source names its input by number (1-4); the option name is whatever the switcher's
// select calls that input in HA right now, so renaming it there needs no change here. Older
// configs name the option directly.
function switcherOption(ha, g, src) {
  if (src.input) return ha.states[g.switcher?.entity]?.attributes?.options?.[src.input - 1] || null;
  return src.option || null;
}

// Entities the Games screen shows live: the switcher's select, PC power and sensors.
export async function gameEntities() {
  const g = await loadGames();
  return [g?.switcher?.entity, g?.pc?.power, ...(g?.pc?.sensors || []).map((s) => s.entity), ...statEntities(g)].filter(Boolean);
}

// The Stats page's sensors: one entity per role, plus an optional list of per-core load sensors.
// Anything left out simply doesn't appear on the page.
export const STAT_ROLES = ['fps', 'fpsLow', 'game', 'gpuLoad', 'gpuTemp', 'gpuClock', 'gpuMemClock', 'gpuPower', 'gpuFan',
  'cpuLoad', 'cpuTemp', 'cpuClock', 'ramUsed', 'ramTotal', 'ramLoad', 'vramUsed', 'vramTotal', 'netDown', 'netUp', 'uptime', 'stream', 'downloads', 'updates'];
function statEntities(g) {
  const st = g?.pc?.stats || {};
  return [...STAT_ROLES.map((k) => st[k]), ...(st.cores || [])].filter((v) => typeof v === 'string');
}

// The Stats page's film strip: the last hour as one number every ten seconds - the busier of GPU
// and CPU load, in percent, or null for ten seconds with no reading (the PC was off). The page
// groups them into its 60 frames. Kept in memory, so it starts again with the server.
const SAMPLES = 360;
const hour = [];
let bucket = [];
export function recordStats(ha) {
  haRef = ha;
  const load = (id) => {
    const st = id && ha.states[id]?.state;
    const v = typeof st === 'string' ? Number(st) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  setInterval(async () => {
    const st = (await loadGames().catch(() => null))?.pc?.stats;
    if (!st) return;
    const gpu = load(st.gpuLoad), cpu = load(st.cpuLoad);
    if (gpu != null || cpu != null) bucket.push(Math.max(gpu ?? 0, cpu ?? 0));
  }, 5000).unref();
  setInterval(() => {
    hour.push(bucket.length ? Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length) : null);
    bucket = [];
    while (hour.length > SAMPLES) hour.shift();
  }, 10000).unref();
}

// A virtual machine can't see its processor's real clock (Windows reports the nominal speed), but
// the host can. When the PC is a VM on the machine this server runs on, pc.hostCpus lists the host
// CPUs its cores are pinned to, in the VM's core order, and this gives each one's clock and their
// average, in MHz, from /proc/cpuinfo - and the processor's temperature in °C from the kernel's
// hardware monitors (AMD's k10temp or Intel's coretemp), which a VM can't see either - and the
// whole processor's power draw in watts from its energy counter (RAPL), when the host lets this
// server read it (the counter is root-only unless the host makes it readable).
export async function hostClock() {
  const pc = (await loadGames().catch(() => null))?.pc;
  cachedPumpName = pc?.pumpSensor || null;
  cachedWaterProbe = [1, 2, 3, 4].includes(pc?.waterProbe) ? pc.waterProbe : 1;
  const cpus = pc?.hostCpus;
  if (!cpus?.length) return { mhz: null, cores: [], temp: null, watts: null, pump: await pumpRpm(), water: await waterTemp() };
  const text = await readFile('/proc/cpuinfo', 'utf8').catch(() => '');
  const byCpu = new Map();
  for (const block of text.split(/\n\s*\n/)) {
    const cpu = /^processor\s*:\s*(\d+)/m.exec(block), speed = /^cpu MHz\s*:\s*([\d.]+)/m.exec(block);
    if (cpu && speed) byCpu.set(Number(cpu[1]), Math.round(Number(speed[1])));
  }
  const cores = cpus.map((n) => byCpu.get(n) ?? null), known = cores.filter((v) => v != null);
  return { mhz: known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null, cores, temp: await hostCpuTemp(), watts: await hostCpuWatts(), pump: await pumpRpm(), water: await waterTemp() };
}

// The water loop's temperature in °C from an Aquacomputer controller on the host (Octo, Quadro,
// D5 Next...), whose kernel driver lists its probes as temp1..temp4; pc.waterProbe picks one
// (default 1). Nothing until such a controller is plugged in.
const AQUA = new Set(['octo', 'quadro', 'd5next', 'highflownext', 'aquaero', 'farbwerk360']);
let aquaDir;   // undefined: not looked yet; null: none found (looked again every minute)
let aquaLooked = 0;
async function waterTemp() {
  if (aquaDir === undefined || (aquaDir === null && Date.now() - aquaLooked > 60000)) {
    aquaLooked = Date.now(); aquaDir = null;
    for (const d of await readdir(HWMON).catch(() => [])) {
      const name = (await readFile(`${HWMON}/${d}/name`, 'utf8').catch(() => '')).trim();
      if (AQUA.has(name)) { aquaDir = `${HWMON}/${d}`; break; }
    }
  }
  if (!aquaDir) return null;
  const milli = Number(await readFile(`${aquaDir}/temp${cachedWaterProbe}_input`, 'utf8').catch(() => ''));
  return Number.isFinite(milli) && milli > 0 ? Math.round(milli / 100) / 10 : null;
}
let cachedWaterProbe = 1;

// The water pump's speed from the host's BMC, when the BMC device is mapped in and pc.pumpSensor
// names its fan header ("CPU_FAN2/WP"). Read at most every 10 s; the BMC is slow to answer.
let pumpCache = { at: 0, rpm: null };
function pumpRpm() {
  const name = cachedPumpName;
  if (!name) return null;
  if (Date.now() - pumpCache.at < 10000) return pumpCache.rpm;
  pumpCache.at = Date.now();
  return new Promise((resolve) => {
    // ipmitool sdr lines: "CPU_FAN2/WP      | 61h | ok  | 29.0 | 2700 RPM"
    execFile('ipmitool', ['sdr', 'type', 'Fan'], { timeout: 8000 }, (err, out) => {
      if (err) { resolve(pumpCache.rpm = null); return; }
      const row = String(out).split('\n').map((l) => l.split('|').map((c) => c.trim())).find((c) => c[0] === name);
      const rpm = row ? parseFloat(row[4]) : NaN;
      resolve(pumpCache.rpm = Number.isFinite(rpm) ? Math.round(rpm) : null);
    });
  });
}
let cachedPumpName = null;

// Watts are the energy counter's rise between two readings; it is read at most once a second and
// wraps at its maximum.
// Docker hides the counter's usual place from containers, so the host folder
// /sys/devices/virtual/powercap/intel-rapl is mapped in as /host/cpu-power (the package's own
// folder has a colon in its name, which a volume mapping can't carry).
const RAPL = ['/host/cpu-power/intel-rapl:0', '/sys/class/powercap/intel-rapl:0'];
let energy = null;   // { at, uj, watts }
let rapl;            // the folder that answered
async function hostCpuWatts() {
  const at = Date.now();
  if (energy && at - energy.at < 1000) return energy.watts;
  let uj = NaN;
  for (const dir of rapl ? [rapl] : RAPL) {
    uj = Number(await readFile(`${dir}/energy_uj`, 'utf8').catch(() => ''));
    if (Number.isFinite(uj) && uj > 0) { rapl = dir; break; }
  }
  if (!Number.isFinite(uj) || uj <= 0) return null;
  let watts = energy?.watts ?? null;
  if (energy && at - energy.at < 60000) {
    let rise = uj - energy.uj;
    if (rise < 0) rise += Number(await readFile(`${rapl}/max_energy_range_uj`, 'utf8').catch(() => '0')) || 0;
    if (rise >= 0) watts = Math.round(rise / 1e6 / ((at - energy.at) / 1000));
  }
  energy = { at, uj, watts };
  return watts;
}

const HWMON = '/sys/class/hwmon';
let cpuSensor;   // the monitor's folder once found; null when the host has none
async function hostCpuTemp() {
  if (cpuSensor === undefined) {
    cpuSensor = null;
    for (const d of await readdir(HWMON).catch(() => [])) {
      const name = (await readFile(`${HWMON}/${d}/name`, 'utf8').catch(() => '')).trim();
      if (name === 'k10temp' || name === 'coretemp') { cpuSensor = `${HWMON}/${d}`; break; }
    }
  }
  if (!cpuSensor) return null;
  const milli = Number(await readFile(`${cpuSensor}/temp1_input`, 'utf8').catch(() => ''));
  return Number.isFinite(milli) && milli > 0 ? Math.round(milli / 100) / 10 : null;
}

// What Steam says is being played right now (the profile's game details must be public): the
// game's id, proper name and artwork. Cached for 20 s.
let steamNowCache = null;
export async function steamNow() {
  if (!config.steam.apiKey || !config.steam.id) return null;
  if (steamNowCache && Date.now() - steamNowCache.t < 20000) return steamNowCache.v;
  const q = new URLSearchParams({ key: config.steam.apiKey, steamids: config.steam.id });
  const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?${q}`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  const p = r?.ok ? (await r.json().catch(() => null))?.response?.players?.[0] : null;
  const v = p?.gameid && /^\d+$/.test(p.gameid) ? { appid: Number(p.gameid), name: p.gameextrainfo || null, header: `/img/steam/${p.gameid}/header.jpg`, poster: `/img/steam/${p.gameid}/library_600x900.jpg` } : null;
  if (r?.ok) steamNowCache = { t: Date.now(), v };
  return steamNowCache?.v ?? null;
}

// ---------- the PC as an Unraid VM ----------

// Unraid's GraphQL API: the VM's state, and start / stop (stop asks Windows to shut down).
// Unraid answers on HTTPS with a certificate for its unraid.net name, not its address, so the
// request is made with node:https and the certificate is not checked: the key, not the
// certificate, is what proves we are talking to the right server on the house network.
function unraid(query, variables) {
  const { url, apiKey } = config.unraid;
  const target = new URL('/graphql', url.startsWith('http') ? url : `https://${url}`);
  if (target.protocol === 'http:') target.protocol = 'https:';
  const body = JSON.stringify({ query, variables });
  return new Promise((resolve, reject) => {
    const req = request(target, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-api-key': apiKey }, rejectUnauthorized: false, timeout: 8000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(text); } catch {}
        if (res.statusCode !== 200 || j.errors?.length) reject(new Error(j.errors?.[0]?.message || `Unraid API ${res.statusCode}`));
        else resolve(j.data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Unraid API timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
const vmConfigured = () => Boolean(config.unraid.url && config.unraid.apiKey && config.unraid.vm);
let vmCache = null;   // { at, vm: { id, state } }
export const vmNow = async () => { const g = await loadGames().catch(() => null); return { ...(await vmState()), streamingTo: streamingTo(g), downloads: steamDownloads(g), housekeeping: housekeeping(g) }; };
export async function vmState() {
  if (!vmConfigured()) return null;
  if (vmCache && Date.now() - vmCache.at < 4000) return vmCache.vm;
  const d = await unraid('{ vms { domain { id name state } } }');
  const dom = d?.vms?.domain?.find((v) => v.name === config.unraid.vm);
  const vm = dom ? { id: dom.id, state: String(dom.state || '').toLowerCase() } : { id: null, state: 'missing' };
  vmCache = { at: Date.now(), vm };
  return vm;
}
const VM_OPS = { start: 'starting', stop: 'shutting down', reboot: 'restarting', forceStop: 'shutting down' };
export async function vmPower(op) {
  if (!VM_OPS[op]) throw new Error('Unknown VM operation');
  const vm = await vmState();
  if (!vm?.id) throw new Error(`No VM called ${config.unraid.vm} on the Unraid server`);
  await unraid(`mutation ($id: PrefixedID!) { vm { ${op}(id: $id) } }`, { id: vm.id });
  vmCache = null;
  return { state: VM_OPS[op] };
}

const sensorText = (g, role) => { const id = g?.pc?.stats?.[role], v = id && haRef?.states?.[id]?.state; return v && !['unknown', 'unavailable'].includes(String(v).toLowerCase()) ? String(v) : ''; };
function steamDownloads(g) {
  return sensorText(g, 'downloads').split(';').filter(Boolean).map((line) => {
    const [name, pct, mb] = line.split('|');
    return { name, percent: Number(pct) || 0, mbLeft: Number(mb) || 0 };
  });
}
// "reboot", "N updates", "ok" or "" (no sensor).
function housekeeping(g) {
  const v = sensorText(g, 'updates');
  if (!v || v === 'ok' || v === 'unknown') return null;
  if (v === 'reboot') return { kind: 'reboot', text: 'Windows is waiting to restart' };
  const n = Number(v.split(' ')[0]);
  return n > 0 ? { kind: 'updates', text: `${n} Windows update${n === 1 ? '' : 's'} waiting` } : null;
}

// The Moonlight client the PC is streaming to, by name when known, from the stream role's sensor.
function streamingTo(g) {
  const id = g?.pc?.stats?.stream, v = id && haRef?.states?.[id]?.state;
  if (!v || ['unknown', 'unavailable', ''].includes(String(v).toLowerCase())) return null;
  return g.pc.streamClients?.[v] || String(v);
}
let haRef = null;

export async function gamesState() {
  const g = await loadGames();
  if (!g) return { configured: false };
  return {
    configured: true,
    active,
    // The panel reads the switcher's live input from this HA entity's state.
    switcher: g.switcher?.entity ? { entity: g.switcher.entity, projectorInput: g.switcher.projectorInput || null } : null,
    // games: false keeps a source (the Apple TV) off the Games screen; it stays on the projector card.
    sources: (g.sources || []).map(({ id, name, icon, via, option, input, projectorInput, games }) => ({ id, name, icon, via, option, input, projectorInput, games: games !== false })),
    pc: g.pc ? {
      name: g.pc.name || 'Gaming PC', power: g.pc.power || null, sensors: g.pc.sensors || [],
      canLaunch: Boolean(g.pc.launchScript),
      stats: g.pc.stats || null,
      hour: g.pc.stats ? [...hour] : null,
      hostClock: Boolean(g.pc.hostCpus?.length),
      vm: vmConfigured() ? await vmState().catch((e) => ({ state: 'unknown', error: e.message })) : null,
      playing: await steamNow(),
      // Steam downloads in progress (name, percent, MB left) and Windows housekeeping, from the VM's sensors.
      downloads: steamDownloads(g), housekeeping: housekeeping(g),
      streamingTo: streamingTo(g),
      // What to call the parts on the Stats page; without these it reads the models from the sensors' names.
      gpuName: g.pc.gpuName || null, cpuName: g.pc.cpuName || null,
      // Names for the addresses Moonlight clients stream from (the stream role's sensor gives the address).
      streamClients: g.pc.streamClients || {},
    } : null,
    steam: Boolean(config.steam.apiKey && config.steam.id),
  };
}

// The Projector card's Apple TV button goes through the projector action, not a game source.
export const setActive = (id) => { active = id; };

export async function selectSource(ha, id) {
  const g = await loadGames();
  const src = g?.sources?.find((s) => s.id === id);
  if (!src) throw new Error('Unknown game source');
  if (src.via === 'switcher') {
    const option = switcherOption(ha, g, src);
    if (!g.switcher?.entity || !option) throw new Error(`Set the HDMI switcher and ${src.name}'s input on the settings page`);
    // Switch first: if the console is off the switch refuses, and the projector stays put.
    await ha.callService('select', 'select_option', { option }, { target: { entity_id: g.switcher.entity } });
  }
  const input = src.via === 'switcher' ? g.switcher.projectorInput : src.projectorInput;
  if (input) {
    await ha.callService('script', 'turn_on', { variables: { source: input, projector: config.entities.projector, apple_tv: config.entities.appleTv } },
      { target: { entity_id: 'script.theater_projector_source' } });
  }
  if (src.haScript) await ha.callService('script', 'turn_on', {}, { target: { entity_id: src.haScript } });
  active = id;
  return { active };
}

// Is the house's admin at this panel? Restart and force-off are only for them.
export const adminHere = (ha) => {
  const { adminRoomSensor, adminRoom } = config.entities;
  if (!adminRoomSensor || !adminRoom) return false;
  return String(ha.states[adminRoomSensor]?.state || '').toLowerCase() === adminRoom.toLowerCase();
};
// "Windows desktop": the PC on the projector with the room lit for working, not for a film -
// start the VM if it is off, the projector to the PC's input, lights up. Only for the admin.
export async function pcDesktop(ha) {
  if (!adminHere(ha)) throw Object.assign(new Error('Only when the admin is in the room'), { status: 403 });
  const g = await loadGames();
  const src = (g?.sources || []).find((s) => s.via !== 'switcher' && /^(windows|steam|pc|gaming)/i.test(s.id));
  if (!src) throw new Error('No PC source on the Games page');
  if (vmConfigured()) { const vm = await vmState(); if (vm?.state === 'shutoff') await vmPower('start'); }
  await selectSource(ha, src.id);
  await ha.callService('script', 'turn_on', {}, { target: { entity_id: 'script.theater_lights_bright' } }).catch(() => {});
  return { ok: true };
}
export async function pcPower(ha, op) {
  if ((op === 'reboot' || op === 'forceStop') && !adminHere(ha)) throw Object.assign(new Error('Only when the admin is in the room'), { status: 403 });
  const g = await loadGames();
  if (!g?.pc?.power && vmConfigured()) return vmPower(op);
  if (!g?.pc?.power) throw new Error('No PC power entity set in games.json');
  if (op === 'reboot' || op === 'forceStop') throw new Error('Only a VM on Unraid can be restarted from here');
  return ha.callService('homeassistant', op === 'start' ? 'turn_on' : 'turn_off', {}, { target: { entity_id: g.pc.power } });
}

export async function launchSteamGame(ha, appid) {
  const g = await loadGames();
  if (!g?.pc?.launchScript) throw new Error('No launch script set in games.json (pc.launchScript)');
  return ha.callService('script', 'turn_on', { variables: { appid: String(Number(appid)) } }, { target: { entity_id: g.pc.launchScript } });
}

// Steam library via the Steam Web API, most recently played first. Cached for 30 minutes.
let steamCache = null;
export async function steamLibrary() {
  if (!config.steam.apiKey || !config.steam.id) return { configured: false, games: [] };
  if (steamCache && Date.now() - steamCache.t < 30 * 60 * 1000) return steamCache.v;
  const q = new URLSearchParams({ key: config.steam.apiKey, steamid: config.steam.id, include_appinfo: '1', include_played_free_games: '1', format: 'json' });
  const r = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${q}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Steam ${r.status}`);
  const games = ((await r.json()).response?.games || [])
    .sort((a, b) => (b.rtime_last_played || 0) - (a.rtime_last_played || 0) || (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .map((x) => ({
      appid: x.appid, name: x.name,
      hours: Math.round((x.playtime_forever || 0) / 60),
      lastPlayed: x.rtime_last_played ? new Date(x.rtime_last_played * 1000).toISOString() : null,
      poster: `/img/steam/${x.appid}/library_600x900.jpg`,
      header: `/img/steam/${x.appid}/header.jpg`,
    }));
  steamCache = { t: Date.now(), v: { configured: true, games } };
  return steamCache.v;
}
