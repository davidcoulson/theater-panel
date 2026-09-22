// Home Assistant websocket client. One connection, subscribed only to the entities the panel
// shows (subscribe_entities with an entity_ids filter), so HA streams a few dozen entities
// instead of the whole house. Uses Node's built-in WebSocket; no dependencies.

import { EventEmitter } from 'node:events';

export class HomeAssistant extends EventEmitter {
  constructor({ url, token, entities }) {
    super();
    this.url = url;
    this.token = token;
    this.entities = entities;
    this.states = {};          // entity_id -> { state, attributes, last_changed }
    this.connected = false;
    this.nextId = 1;
    this.pending = new Map();  // id -> { resolve, reject, timer }
    this.retryMs = 1000;
    this.ws = null;
  }

  get configured() { return Boolean(this.url && this.token); }

  start() {
    if (!this.configured) {
      console.warn('[ha] HA_URL / HA_TOKEN not set; room control is disabled');
      return;
    }
    this.#connect();
  }

  #connect() {
    const wsUrl = this.url.replace(/^http/, 'ws') + '/api/websocket';
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    ws.addEventListener('message', (ev) => this.#onMessage(JSON.parse(ev.data)));
    ws.addEventListener('close', () => this.#onClose());
    ws.addEventListener('error', (e) => console.warn('[ha] socket error', e.message || ''));
  }

  #onClose() {
    const was = this.connected;
    this.connected = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('HA disconnected')); }
    this.pending.clear();
    if (was) this.emit('status', false);
    setTimeout(() => this.#connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  #send(msg) { this.ws.send(JSON.stringify(msg)); }

  #onMessage(msg) {
    if (msg.type === 'auth_required') return this.#send({ type: 'auth', access_token: this.token });
    if (msg.type === 'auth_invalid') { console.error('[ha] auth rejected:', msg.message); this.ws.close(); return; }
    if (msg.type === 'auth_ok') {
      this.connected = true;
      this.retryMs = 1000;
      this.states = {};
      this.subId = this.nextId++;
      this.#send({ id: this.subId, type: 'subscribe_entities', entity_ids: this.entities });
      this.emit('status', true);
      return;
    }
    if (msg.type === 'event' && msg.id === this.subId) return this.#applyEntityEvent(msg.event);
    if (msg.type === 'result') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      msg.success ? p.resolve(msg.result) : p.reject(new Error(msg.error?.message || 'HA error'));
    }
  }

  // subscribe_entities sends a compressed diff: a = added (full), c = changed (+/-), r = removed.
  #applyEntityEvent(ev) {
    const changed = [];
    for (const [id, s] of Object.entries(ev.a || {})) {
      this.states[id] = { state: s.s, attributes: s.a || {}, last_changed: toIso(s.lc) };
      changed.push(id);
    }
    for (const [id, d] of Object.entries(ev.c || {})) {
      const cur = this.states[id] || { state: null, attributes: {}, last_changed: null };
      const plus = d['+'] || {};
      if ('s' in plus) cur.state = plus.s;
      if (plus.a) cur.attributes = { ...cur.attributes, ...plus.a };
      if (plus.lc) cur.last_changed = toIso(plus.lc);
      for (const k of d['-']?.a || []) delete cur.attributes[k];
      this.states[id] = cur;
      changed.push(id);
    }
    for (const id of ev.r || []) { delete this.states[id]; changed.push(id); }
    if (changed.length) this.emit('states', Object.fromEntries(changed.map((id) => [id, this.states[id] || null])));
  }

  request(msg, timeoutMs = 15000) {
    if (!this.connected) return Promise.reject(new Error('Home Assistant is not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('HA request timed out')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#send({ id, ...msg });
    });
  }

  // returnResponse: for actions that return data (music_assistant.search, script responses).
  async callService(domain, service, data = {}, { target, returnResponse = false, timeoutMs } = {}) {
    const res = await this.request({
      type: 'call_service', domain, service, service_data: data,
      ...(target ? { target } : {}),
      ...(returnResponse ? { return_response: true } : {}),
    }, timeoutMs);
    return returnResponse ? res?.response : res;
  }
}

function toIso(ts) { return ts ? new Date(ts * 1000).toISOString() : null; }
