// Admin page: the panel's settings, editable from a laptop. Saves to the container's /data
// volume; the panel picks changes up live. Secrets are write-only.

import { h, render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);
const ICONS = ['pad', 'joystick', 'remote', 'server', 'monitor', 'steam'];
const INPUTS = ['HDMI 1', 'HDMI 2', 'HDMI 3', 'HDMI 4'];

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

function App() {
  const [session, setSession] = useState(null);
  const check = () => api('/api/admin/session').then(setSession).catch((e) => setSession({ error: e.message }));
  useEffect(() => { check(); }, []);
  if (!session) return null;
  if (session.error) return html`<${Shell}><p class="err">${session.error}</p><//>`;
  if (!session.configured) return html`<${Shell}><section class="card"><h2>Admin is off</h2>
    <p>Set <code>ADMIN_PASSWORD</code> on the theater-panel container (Unraid: Edit, Advanced view), then reload this page.</p></section><//>`;
  if (!session.admin) return html`<${Shell}><${Login} onDone=${check} /><//>`;
  return html`<${Shell} signOut=${() => api('/api/admin/logout', {}).then(check)}><${Settings} /><//>`;
}

function Shell({ children, signOut }) {
  return html`<header class="top"><div class="brand"><img src="/assets/icon.png" alt="" /><div><b>Theater panel</b><span>Settings</span></div></div>
    <nav>${signOut && html`<a href="/" target="_blank" rel="noopener">Open panel</a><button type="button" class="link" onClick=${signOut}>Sign out</button>`}</nav></header>
    <main>${children}</main>`;
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('/api/admin/login', { password: pw }); onDone(); } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  return html`<form class="card login" onSubmit=${submit}>
    <h2>Sign in</h2>
    <label>Admin password<input type="password" autocomplete="current-password" value=${pw} onInput=${(e) => setPw(e.target.value)} autofocus /></label>
    ${err && html`<p class="err">${err}</p>`}
    <button type="submit" class="primary" disabled=${busy || !pw}>${busy ? 'Signing in…' : 'Sign in'}</button>
  </form>`;
}

function Settings() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});        // key -> string (secrets: new value or '')
  const [clear, setClear] = useState({});        // secret key -> true to remove the saved one
  const [games, setGames] = useState(null);
  const [gamesDirty, setGamesDirty] = useState(false);
  const [entities, setEntities] = useState([]);
  const [status, setStatus] = useState(null);    // { ok, text }
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api('/api/admin/settings');
    setData(d);
    setDraft(Object.fromEntries(d.fields.map((f) => [f.key, f.type === 'secret' ? '' : d.values[f.key].saved])));
    setClear({});
    setGames(structuredClone(d.games)); setGamesDirty(false);
  }
  useEffect(() => { load().catch((e) => setStatus({ ok: false, text: e.message })); }, []);
  useEffect(() => { api('/api/admin/entities').then(setEntities).catch(() => setEntities([])); }, []);

  const dirty = useMemo(() => {
    if (!data) return false;
    if (gamesDirty || Object.values(clear).some(Boolean)) return true;
    return data.fields.some((f) => (f.type === 'secret' ? draft[f.key] !== '' : draft[f.key] !== data.values[f.key].saved));
  }, [data, draft, clear, gamesDirty]);

  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!data) return html`<p class="muted">${status?.text || 'Loading…'}</p>`;

  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const groups = [...new Set(data.fields.map((f) => f.group))];

  async function save() {
    setBusy(true); setStatus(null);
    const values = {};
    for (const f of data.fields) {
      if (f.type === 'secret') { if (clear[f.key]) values[f.key] = null; else if (draft[f.key]) values[f.key] = draft[f.key]; }
      else values[f.key] = draft[f.key];
    }
    try {
      await api('/api/admin/settings', { values, ...(gamesDirty ? { games } : {}) });
      await load();
      setStatus({ ok: true, text: 'Saved. The panel picks it up right away.' });
    } catch (e) { setStatus({ ok: false, text: e.message }); }
    setBusy(false);
  }

  async function importAll() {
    if (!confirm(`Copy ${data.fromContainer.length} setting(s)${data.gamesSource === 'file' ? ' and the games.json sources' : ''} from the container into this page?`)) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/import', {});
      await load();
      setStatus({ ok: true, text: `Copied ${r.copied.length} setting(s). You can now delete them from the container (keep ADMIN_PASSWORD).` });
    } catch (e) { setStatus({ ok: false, text: e.message }); }
    setBusy(false);
  }
  const pending = data.fromContainer.length > 0 || data.gamesSource === 'file';

  return html`
    <p class="intro">Values here override the container's settings. Leave a field blank to use the container's value, shown in grey.</p>
    ${pending && html`<section class="card import"><div><b>${data.fromContainer.length} setting(s)${data.gamesSource === 'file' ? ' and the game sources' : ''} still come from the container.</b>
      <small>Import copies them here, tokens included, so you can delete the container's variables afterwards. Keep ADMIN_PASSWORD on the container.</small></div>
      <button type="button" class="primary" disabled=${busy || dirty} onClick=${importAll}>Import from container</button></section>`}
    ${!pending && html`<p class="intro ok">Everything is saved here. The container only needs ADMIN_PASSWORD.</p>`}
    ${groups.map((g) => html`<section class="card" id=${g.toLowerCase().replace(/\W+/g, '-')}>
      <div class="card-head"><h2>${g}</h2>${TESTS[g] && html`<${Test} service=${TESTS[g]} draft=${draft} />`}</div>
      ${data.fields.filter((f) => f.group === g).map((f) => html`<${Field} f=${f} value=${draft[f.key]} base=${data.values[f.key]} entities=${entities}
        cleared=${clear[f.key]} onClear=${(v) => setClear({ ...clear, [f.key]: v })} onChange=${(v) => set(f.key, v)} />`)}
      ${g === 'Games' && html`<${GamesEditor} games=${games} source=${data.gamesSource} entities=${entities} onChange=${(v) => { setGames(v); setGamesDirty(true); }} />`}
    </section>`)}
    <div class=${`savebar ${dirty ? 'show' : ''}`}>
      <span class=${status ? (status.ok ? 'ok' : 'err') : 'muted'}>${status ? status.text : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <span class="grow"></span>
      <button type="button" disabled=${!dirty || busy} onClick=${load}>Discard</button>
      <button type="button" class="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>
    </div>`;
}

const TESTS = { 'Home Assistant': 'ha', Plex: 'plex', Seerr: 'seerr' };

// Tries the connection with the values on screen, saved or not.
function Test({ service, draft }) {
  const [r, setR] = useState(null);
  async function run() {
    setR({ busy: true });
    try { setR(await api('/api/admin/test', { service, values: draft })); } catch (e) { setR({ ok: false, detail: e.message }); }
  }
  return html`<div class="test">${r && !r.busy && html`<span class=${r.ok ? 'ok' : 'err'}>${r.ok ? '✓' : '✕'} ${r.detail}</span>`}
    <button type="button" class="small" disabled=${r?.busy} onClick=${run}>${r?.busy ? 'Testing…' : 'Test connection'}</button></div>`;
}

function Field({ f, value, base, entities, cleared, onClear, onChange }) {
  const id = `f-${f.key}`;
  const note = f.help && html`<small>${f.help}</small>`;
  const label = html`<span class="lbl">${f.label}<code>${f.key}</code></span>`;

  if (f.type === 'secret') {
    const has = base.saved ? 'saved here' : base.container ? 'set on the container' : null;
    return html`<div class="field"><label for=${id}>${label}</label>
      <div class="row"><input id=${id} type="password" autocomplete="new-password" placeholder=${cleared ? 'Will be removed' : has ? `•••••••• (${has})` : 'Not set'} value=${value} onInput=${(e) => onChange(e.target.value)} />
      ${base.saved && html`<button type="button" class="small" onClick=${() => onClear(!cleared)}>${cleared ? 'Keep' : 'Remove'}</button>`}</div>${note}</div>`;
  }
  if (f.type === 'bool') {
    const eff = value === '' ? (base.container === '' ? String(f.default) : base.container) : value;
    return html`<div class="field check"><label><input type="checkbox" checked=${eff === 'true'} onChange=${(e) => onChange(String(e.target.checked))} />${label}</label>
      ${value !== '' && html`<button type="button" class="link" onClick=${() => onChange('')}>Use container value</button>`}${note}</div>`;
  }
  if (f.type === 'libraries') return html`<div class="field">${label}<${LibraryPicker} value=${value} base=${base.container} onChange=${onChange} />${note}</div>`;
  if (f.type === 'apps') return html`<div class="field">${label}<${AppsEditor} value=${value || base.container} onChange=${onChange} />${note}</div>`;
  if (f.type === 'list' && f.domain) {
    return html`<div class="field">${label}<${EntityList} value=${value} base=${base.container} domain=${f.domain} entities=${entities} onChange=${onChange} />${note}</div>`;
  }
  const list = f.type === 'entity' ? `dl-${f.domain}` : undefined;
  return html`<div class="field"><label for=${id}>${label}</label>
    <input id=${id} type="text" spellcheck="false" list=${list} placeholder=${base.container || f.placeholder || ''} value=${value} onInput=${(e) => onChange(e.target.value)} />
    ${list && html`<${EntityOptions} id=${list} domain=${f.domain} entities=${entities} />`}
    ${f.type === 'entity' && value && entities.length > 0 && !entities.some((x) => x.id === value) && html`<small class="err">Home Assistant has no ${value}</small>`}
    ${note}</div>`;
}

function EntityOptions({ id, domain, entities }) {
  return html`<datalist id=${id}>${entities.filter((e) => e.id.startsWith(`${domain}.`)).map((e) => html`<option value=${e.id}>${e.name}</option>`)}</datalist>`;
}

// Entity lists as chips; blank means the container's list.
function EntityList({ value, base, domain, entities, onChange }) {
  const [add, setAdd] = useState('');
  const own = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const shown = own || (base ? base.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const put = (arr) => onChange(arr.join(','));
  const name = (id) => entities.find((e) => e.id === id)?.name;
  return html`<div class="chips">
    ${shown.map((id, i) => html`<span class=${`chip ${own ? '' : 'inherited'}`}>${name(id) ? html`${name(id)} <code>${id}</code>` : html`<code>${id}</code>`}
      <button type="button" aria-label=${`Remove ${id}`} onClick=${() => put(shown.filter((_, k) => k !== i))}>×</button></span>`)}
    <form class="row" onSubmit=${(e) => { e.preventDefault(); if (add.trim()) { put([...shown, add.trim()]); setAdd(''); } }}>
      <input type="text" spellcheck="false" list=${`dl-${domain}`} placeholder=${`Add a ${domain}`} value=${add} onInput=${(e) => setAdd(e.target.value)} />
      <${EntityOptions} id=${`dl-${domain}`} domain=${domain} entities=${entities} />
      <button type="submit" class="small">Add</button>
      ${own && html`<button type="button" class="link" onClick=${() => onChange('')}>Use container value</button>`}
    </form>
    ${!own && shown.length > 0 && html`<small>From the container. Changing it saves your own list here.</small>`}
  </div>`;
}

// Plex libraries as ordered chips, added from a dropdown of the server's libraries.
function LibraryPicker({ value, base, onChange }) {
  const [libs, setLibs] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/admin/plex-libraries').then(setLibs).catch((e) => { setLibs([]); setErr(e.message); }); }, []);
  const split = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const own = value ? split(value) : null;
  const shown = own || split(base);
  const put = (arr) => onChange(arr.join(','));
  const move = (i, d) => { const n = [...shown]; [n[i], n[i + d]] = [n[i + d], n[i]]; put(n); };
  const type = (t) => libs?.find((l) => l.title === t)?.type;
  const left = (libs || []).filter((l) => !shown.includes(l.title));
  return html`<div class="chips">
    ${shown.length === 0 && html`<span class="muted">Every movie and TV library</span>`}
    ${shown.map((t, i) => html`<span class=${`chip ${own ? '' : 'inherited'}`}>${t}${type(t) && html` <code>${type(t) === 'show' ? 'TV' : 'movies'}</code>`}
      ${libs && !type(t) && html` <code class="err">not in Plex</code>`}
      <button type="button" aria-label=${`Move ${t} left`} disabled=${i === 0} onClick=${() => move(i, -1)}>‹</button>
      <button type="button" aria-label=${`Move ${t} right`} disabled=${i === shown.length - 1} onClick=${() => move(i, 1)}>›</button>
      <button type="button" aria-label=${`Remove ${t}`} onClick=${() => put(shown.filter((_, k) => k !== i))}>×</button></span>`)}
    <div class="row">
      <select value="" disabled=${!left.length} onChange=${(e) => { if (e.target.value) put([...shown, e.target.value]); e.target.value = ''; }}>
        <option value="">${libs === null ? 'Loading libraries…' : left.length ? 'Add a library…' : 'All libraries added'}</option>
        ${left.map((l) => html`<option value=${l.title}>${l.title} (${l.type === 'show' ? 'TV' : 'movies'})</option>`)}
      </select>
      ${own && html`<button type="button" class="link" onClick=${() => onChange('')}>Use container value</button>`}
    </div>
    ${err && html`<small class="err">${err}</small>`}
    ${!own && shown.length > 0 && html`<small>From the container. Changing it saves your own list here.</small>`}
  </div>`;
}

function AppsEditor({ value, onChange }) {
  const rows = (value || '').split(',').map((p) => p.split('=').map((x) => x.trim())).filter((r) => r[0] || r[1]);
  const put = (rs) => onChange(rs.filter((r) => r[0] && r[1]).map((r) => `${r[0]}=${r[1]}`).join(','));
  const [draft, setDraft] = useState(rows);
  useEffect(() => setDraft(rows), [value]);
  const edit = (i, k, v) => { const n = draft.map((r) => [...r]); n[i][k] = v; setDraft(n); put(n); };
  const move = (i, d) => { const n = [...draft]; [n[i], n[i + d]] = [n[i + d], n[i]]; setDraft(n); put(n); };
  return html`<table class="grid"><thead><tr><th>Name</th><th>Android package</th><th></th></tr></thead><tbody>
    ${draft.map((r, i) => html`<tr>
      <td><input type="text" value=${r[0]} onInput=${(e) => edit(i, 0, e.target.value)} /></td>
      <td><input type="text" spellcheck="false" value=${r[1]} placeholder="com.example.app" onInput=${(e) => edit(i, 1, e.target.value)} /></td>
      <td class="actions"><${RowActions} i=${i} n=${draft.length} move=${move} remove=${() => { const n = draft.filter((_, k) => k !== i); setDraft(n); put(n); }} /></td></tr>`)}
    </tbody></table>
    <button type="button" class="small" onClick=${() => setDraft([...draft, ['', '']])}>Add app</button>`;
}

function RowActions({ i, n, move, remove }) {
  return html`<button type="button" class="icon" aria-label="Move up" disabled=${i === 0} onClick=${() => move(i, -1)}>↑</button>
    <button type="button" class="icon" aria-label="Move down" disabled=${i === n - 1} onClick=${() => move(i, 1)}>↓</button>
    <button type="button" class="icon" aria-label="Remove" onClick=${remove}>×</button>`;
}

// Sources on the projector card and the Games screen: inputs wired straight to the projector,
// and consoles on the HDMI switcher (a select entity in HA, e.g. the ESP32 node or OREI integration).
function GamesEditor({ games, source, entities, onChange }) {
  const g = games || { switcher: {}, sources: [] };
  const put = (patch) => onChange({ ...g, ...patch });
  const edit = (i, patch) => put({ sources: g.sources.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const move = (i, d) => { const n = [...g.sources]; [n[i], n[i + d]] = [n[i + d], n[i]]; put({ sources: n }); };
  return html`<div class="games">
    <h3>Sources</h3>
    ${source === 'file' && html`<small>Loaded from games.json. Saving here stores them with the other settings, and games.json is then ignored.</small>`}
    <div class="two">
      <label>HDMI switcher (select entity)<input type="text" spellcheck="false" list="dl-select" value=${g.switcher?.entity || ''} onInput=${(e) => put({ switcher: { ...g.switcher, entity: e.target.value } })} /></label>
      <${EntityOptions} id="dl-select" domain="select" entities=${entities} />
      <label>Switcher's projector input<select value=${g.switcher?.projectorInput || 'HDMI 3'} onChange=${(e) => put({ switcher: { ...g.switcher, projectorInput: e.target.value } })}>${INPUTS.map((x) => html`<option>${x}</option>`)}</select></label>
    </div>
    <table class="grid"><thead><tr><th>Name</th><th>Connected to</th><th>Input / switcher option</th><th>Icon</th><th></th></tr></thead><tbody>
      ${g.sources.map((s, i) => html`<tr>
        <td><input type="text" value=${s.name} onInput=${(e) => edit(i, { name: e.target.value })} /></td>
        <td><select value=${s.via} onChange=${(e) => edit(i, { via: e.target.value })}><option value="projector">Projector</option><option value="switcher">HDMI switcher</option></select></td>
        <td>${s.via === 'switcher'
          ? html`<input type="text" value=${s.option || ''} placeholder=${s.name} onInput=${(e) => edit(i, { option: e.target.value })} />`
          : html`<select value=${s.projectorInput || 'HDMI 2'} onChange=${(e) => edit(i, { projectorInput: e.target.value })}>${INPUTS.map((x) => html`<option>${x}</option>`)}</select>`}</td>
        <td><select value=${s.icon || 'pad'} onChange=${(e) => edit(i, { icon: e.target.value })}>${ICONS.map((x) => html`<option>${x}</option>`)}</select></td>
        <td class="actions"><${RowActions} i=${i} n=${g.sources.length} move=${move} remove=${() => put({ sources: g.sources.filter((_, k) => k !== i) })} /></td></tr>`)}
    </tbody></table>
    <button type="button" class="small" onClick=${() => put({ sources: [...g.sources, { name: '', via: 'switcher', icon: 'pad' }] })}>Add source</button>
    <small>The Apple TV is always first on the projector card. Switcher option names must match the options of the switcher's select entity.</small>
  </div>`;
}

render(html`<${App} />`, document.getElementById('admin'));
