import {createSimulation, loadSimulation, HZ, MAX_PLAYERS} from '../shared/simulation.js';
import {PeerRoomConnection} from '../peer/browser.js';
import {makeSave, parseSave, WorldSaves} from './world-saves.js';
import {quantizeWire} from './wire-quantize.js';

// A dropped guest's hero (hp, inventory, tool, cooldowns) is parked on the host and restored if the
// same peer id reconnects. Bounded by count and age; never written into saves.
const PARK_MS = 120_000;

// One owner for simulation scheduling, peer authority and recovery. No UI dependency.
export class WorldSession extends EventTarget {
  constructor({url, connection, storage} = {}) {
    super();
    this.connection = connection || new PeerRoomConnection({url});
    this.saves = new WorldSaves(storage);
    this.simulation = null; this.identity = null; this.latest = null; this.sequence = 0;
    this.running = false; this.worldId = crypto.randomUUID(); this.name = 'Little Orchard';
    this.accumulator = 0; this.last = 0; this.lastSave = 0; this.lastCheckpoint = 0;
    this.metrics = {steps:0, overruns:0, maxStepMs:0};
    this.parked = new Map();
    this.listeners = [];
    const on = (type, handler) => {
      this.connection.addEventListener(type, handler);
      this.listeners.push(() => this.connection.removeEventListener(type, handler));
    };
    on('welcome', ({detail:d}) => {
      const resume = this.identity?.peerId === d.peerId && this.identity?.room === d.room;
      this.identity = d; if (!resume) this.sequence = 0;
      this.emit('welcome', d);
      if (d.hostId === d.peerId) this.promote(resume ? this.latest : this.initialCheckpoint);
    });
    on('message', ({detail}) => this.receive(detail));
    on('peer_connected', () => { if (this.simulation) { this.reconcile(); this.publish(true); } });
    on('peer_joined', () => { if (this.simulation) this.reconcile(); });
    on('peer_left', () => { if (this.simulation) this.reconcile(); });
    on('host_promoted', ({detail:d}) => this.promote(d.checkpoint));
    on('host_changed', ({detail:d}) => {
      if (d.hostId !== this.identity?.peerId) this.simulation = null;
      this.emit('host_changed', d);
    });
    on('checkpoint', ({detail:d}) => {
      this.latest = d.state || d.checkpoint;
      if (this.latest) this.autoSave();
    });
    for (const type of ['owner_lost','continue_world_offer']) on(type, ({detail}) => {
      this.simulation = null; this.autoSave(true); this.emit(type, detail);
    });
    for (const type of ['continue_offer_expired','world_waiting','peer_connection_state']) on(type,({detail})=>this.emit(type,detail));
    on('status', ({detail}) => {
      if (['disconnected','reconnecting','closed'].includes(detail.state)) { this.simulation = null; this.autoSave(true); }
      this.emit('status', detail);
    });
    on('error', ({detail}) => this.emit('error', detail));
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  connect(options = {}) {
    this.stop(); this.identity = null; this.latest = null; this.sequence = 0; this.parked.clear();
    this.lastSave = 0; this.lastCheckpoint = 0;
    this.initialCheckpoint = options.save?.checkpoint || null;
    this.worldId = options.save?.id || crypto.randomUUID(); this.name = options.save?.name || 'Little Orchard';
    if (this.initialCheckpoint) loadSimulation(this.initialCheckpoint); // Reject corrupt saves before joining.
    this.running = true; this.last = performance.now(); this.accumulator = 0;
    this.timer = setInterval(() => this.tick(), 8);
    this.connection.connect(options);
  }
  roster() {
    const peers = this.connection.roster;
    const list = peers instanceof Map ? [...peers.values()] : Array.isArray(peers) ? peers : this.identity?.peers || [];
    return list.filter(p => p.online !== false);
  }
  reconcile() {
    if (!this.simulation || !this.identity) return;
    const roster = this.roster();
    if (!roster.some(p => (p.peerId || p.id) === this.identity.peerId)) roster.push(this.identity);
    const ids = new Set(roster.map(p => p.peerId || p.id));
    const now = Date.now();
    for (const [id, entry] of this.parked) if (now - entry.at > PARK_MS) this.parked.delete(id);
    const leaving = this.simulation.snapshot().players.filter(player => !ids.has(player.id));
    if (leaving.length) {
      const saved = this.simulation.checkpoint().players;
      for (const player of leaving) {
        const record = saved.find(p => p.id === player.id);
        this.simulation.removePlayer(player.id); // Releases any held part into the world first.
        if (record) { this.parked.delete(player.id); this.parked.set(player.id, {record, at:now}); }
      }
      while (this.parked.size > MAX_PLAYERS) this.parked.delete(this.parked.keys().next().value);
    }
    const existing = new Set(this.simulation.snapshot().players.map(p => p.id));
    const returning = [];
    for (const p of roster) {
      const id = p.peerId || p.id;
      if (existing.has(id)) continue;
      if (this.parked.has(id)) returning.push(id);
      else this.simulation.addPlayer({id,name:p.name,role:p.role || 'hero'});
    }
    if (returning.length) this.restoreParked(returning, roster);
  }
  restoreParked(ids, roster) {
    const checkpoint = this.simulation.checkpoint();
    for (const id of ids) {
      const record = this.parked.get(id).record; this.parked.delete(id);
      if (checkpoint.players.length >= MAX_PLAYERS) break;
      const clampTick = n => Math.min(n, checkpoint.tick);
      // removePlayer already dropped the carried pack into the world as pickups, so the hero returns empty-handed (no duplication).
      checkpoint.players.push({...record, resources:{wood:0,stone:0,gems:0}, move:[0,0], vy:0, inputTick:clampTick(record.inputTick), attackTick:clampTick(record.attackTick),
        castTick:clampTick(record.castTick), roleTick:clampTick(record.roleTick),
        ...(record.specialTick !== undefined ? {specialTick:clampTick(record.specialTick)} : {})});
    }
    try { this.simulation = loadSimulation(checkpoint); }
    catch { /* A record that no longer fits this world rejoins fresh rather than blocking the room. */ }
    const present = new Set(this.simulation.snapshot().players.map(p => p.id));
    for (const p of roster) {
      const id = p.peerId || p.id;
      if (ids.includes(id) && !present.has(id)) this.simulation.addPlayer({id,name:p.name,role:p.role || 'hero'});
    }
  }
  promote(checkpoint) {
    if (!this.identity) return;
    try {
      this.simulation = checkpoint ? loadSimulation({...checkpoint,room:this.identity.room}) : createSimulation({room:this.identity.room,seed:41});
      this.reconcile(); this.last = performance.now(); this.accumulator = 0;
      const own = this.simulation.checkpoint().players?.find(p => p.id === this.identity.peerId);
      this.sequence = Math.max(this.sequence, own?.seq || 0, own?.lastSeq || 0);
      this.publish(true); this.emit('hosting',{hz:HZ});
    } catch(error) { this.simulation = null; this.emit('error',{message:`Cannot recover this world: ${error.message}`}); }
  }
  command(type, payload = {}) {
    if (!this.identity || !this.running) return false;
    const message = {...payload, type, seq:++this.sequence};
    if (this.simulation) this.applyCommand(this.identity.peerId, message);
    else this.connection.send(this.connection.hostId, {kind:'command',epoch:this.connection.epoch,message});
    return true;
  }
  applyCommand(id, message) {
    const result = this.simulation.command(id,message);
    if (!result.ok) {
      const detail = {code:result.code,message:result.code.replaceAll('_',' ')};
      if (id === this.identity.peerId) this.emit('error',detail);
      else this.connection.send(id,{kind:'command_error',epoch:this.connection.epoch,...detail});
    }
    for (const event of result.events || []) this.event(event);
  }
  projectileContact(hit) {
    // Geometry contacts originate only in this host's renderer. They never enter
    // the peer command route, including contacts for arrows fired by a guest.
    if (!this.running || !this.simulation || !this.identity || this.connection.hostId !== this.identity.peerId)
      return {ok:false,code:'host_required',events:[]};
    const result = this.simulation.projectileContact(hit);
    for (const event of result.events || []) this.event(event);
    // The normal 20 Hz publication carries the resulting embed/detached state.
    return result;
  }
  receive({from,data}) {
    if (!data || typeof data !== 'object' || data.epoch !== this.connection.epoch) return;
    if (this.simulation && data.kind === 'command' && this.roster().some(p => (p.peerId || p.id) === from)) {
      try { this.applyCommand(from,data.message); } catch { /* A malformed remote command cannot stop the host. */ }
    } else if (from === this.connection.hostId && !this.simulation) {
      if (data.kind === 'snapshot') {
        this.emit('snapshot', data.snapshot);
        const self = data.snapshot.players?.find(p => p.id === this.identity?.peerId);
        if (self) this.identity.role = self.role;
      } else if (data.kind === 'event') this.emit('event',data.event);
      else if (data.kind === 'command_error') this.emit('error',data);
    }
  }
  event(event) {
    this.emit('event',event);
    this.connection.broadcast({kind:'event',epoch:this.connection.epoch,event});
  }
  tick() {
    const now = performance.now(), elapsed = Math.max(0, Math.min(100,now-this.last)); this.last = now;
    if (!this.running || !this.simulation) return;
    this.accumulator += elapsed;
    let steps = 0;
    while(this.accumulator >= 1000/HZ && steps < 6) {
      const start = performance.now();
      for(const event of this.simulation.step()) this.event(event);
      this.metrics.maxStepMs = Math.max(this.metrics.maxStepMs,performance.now()-start);
      this.metrics.steps++; this.accumulator -= 1000/HZ; steps++;
      if(this.metrics.steps % 3 === 0) this.publish();
    }
    if(this.accumulator >= 1000/HZ) { this.metrics.overruns++; this.accumulator = 0; }
  }
  publish(force = false) {
    if(!this.simulation) return;
    const snapshot = this.simulation.snapshot();
    const self = snapshot.players.find(p => p.id === this.identity?.peerId);
    if (self) this.identity.role = self.role;
    this.emit('snapshot',snapshot);
    // Exact sweep history is host-only; guests need current flight state, not16 old poses.
    // Millimetre rounding keeps the same JSON shape; checkpoints below stay exact.
    const wireSnapshot=quantizeWire({...snapshot,projectiles:snapshot.projectiles.map(({trail,...shot})=>shot)});
    this.connection.broadcast({kind:'snapshot',epoch:this.connection.epoch,snapshot:wireSnapshot});
    const now = performance.now();
    if(force || now-this.lastCheckpoint > 500) {
      this.latest = this.simulation.checkpoint();
      // Revision is monotonic even when a confirmed reset starts simulation tick 0.
      const revision = Math.max(0, (this.connection.checkpointRevision ?? -1) + 1);
      this.connection.setCheckpoint(this.latest,revision); this.lastCheckpoint = now;
      this.autoSave();
    }
  }
  autoSave(force = false) {
    if(!this.latest || (!force && Date.now()-this.lastSave < 10000)) return;
    try { this.saves.put(this.exportSave()); this.lastSave = Date.now(); this.emit('saved',{at:this.lastSave}); }
    catch(error) { this.lastSave = Date.now(); this.emit('error',{code:'save_failed',message:error.message}); }
  }
  exportSave() { return makeSave(this.simulation?.checkpoint() || this.latest,{id:this.worldId,name:this.name}); }
  importSave(text) { const save = parseSave(text); loadSimulation(save.checkpoint); return this.saves.put(save); }
  continueWorld() { this.connection.continueWorld(); }
  retryWorld() { this.connection.retryWorld(); }
  declineWorld() { this.connection.declineWorld(); }
  transferHost(id) { this.connection.transferHost(id); }
  resetWorld() {
    if (!this.simulation) throw new Error('Only the current host can reset the world.');
    this.autoSave(true);
    this.worldId = crypto.randomUUID(); this.latest = null; this.lastSave = 0; this.parked.clear();
    this.simulation = createSimulation({room:this.identity.room,seed:41});
    this.reconcile(); this.publish(true);
  }
  stop() { this.autoSave(true); this.running=false; clearInterval(this.timer); this.simulation=null; this.connection.close(); }
  dispose() { this.stop(); this.listeners.forEach(remove=>remove()); }
}
