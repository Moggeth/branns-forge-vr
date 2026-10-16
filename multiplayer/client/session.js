import {createSimulation, loadSimulation, HZ, MAX_PLAYERS} from '../shared/simulation.js';
import {restoreWorldDescriptor} from '../shared/worldgen/registry.js';
import {PRESETS} from '../shared/worldgen/presets.js';
const worldTitle = w => `${{wilds:'The Great Wilds',expedition:'Expedition',underways:'The Underways'}[w.kind]} · ${PRESETS[w.preset]?.name || ''} · ${w.seed}`.slice(0, 60);
import {MATERIAL_KEYS, emptyMaterials} from '../shared/material-catalog.js';
import {PeerRoomConnection} from '../peer/browser.js';
import {makeSave, parseSave, WorldSaves} from './world-saves.js';
import {quantizeWire} from './wire-quantize.js';
import {SnapshotDeltaEncoder, SnapshotDeltaDecoder, codecHello, supportsCodec} from './state-codec.js';

// A dropped guest's hero (hp, inventory, tool, cooldowns) is parked on the host and restored if the
// same peer id reconnects. Bounded by count and age; never written into saves.
const PARK_MS = 120_000;
// The host rejects any command whose seq is not above the player's last accepted seq (sim and expedition).
// A reloaded page cannot remember its old counter, so a fresh identity starts at a millisecond clock floor
// (old counters advance far slower than 1 per ms) and the host also tells each (re)opened channel its exact
// floor. Replayed or stale packets still fail: the host never lowers a player's seq.
const SEQ_MAX = 2 ** 52;
const PACK = MATERIAL_KEYS;
const pickupTotals = simulation => {
  const totals = emptyMaterials();
  for (const p of simulation.adventureWorld?.().pickups || []) if (p.kind in totals) totals[p.kind] += p.amount | 0;
  return totals;
};
const sequenceFloor = () => Math.min(SEQ_MAX, Math.max(0, Math.floor(Date.now())));

// One owner for simulation scheduling, peer authority and recovery. No UI dependency.
const runWorldName = run => `${run.format === 'daily' ? 'Daily Expedition' : 'Expedition'} ${run.seed}`;
// A run may carry a generated-world descriptor (run.world); the simulation takes it as its own option.
const runSimOptions=(room,run)=>{if(!run)return {room,seed:41};const {world,...options}=run;return {room,seed:41,run:options,...(world?{world}:{})};};
export class WorldSession extends EventTarget {
  constructor({url, connection, storage} = {}) {
    super();
    this.connection = connection || new PeerRoomConnection({url});
    // Recovery readiness means loadable simulation state, not merely valid transport JSON.
    this.connection.validateCheckpoint = checkpoint => { loadSimulation(checkpoint); };
    this.saves = new WorldSaves(storage);
    this.simulation = null; this.identity = null; this.latest = null; this.sequence = 0;
    this.running = false; this.worldId = crypto.randomUUID(); this.name = 'Little Orchard';
    this.accumulator = 0; this.last = 0; this.lastSave = 0; this.lastCheckpoint = 0;
    this.metrics = {steps:0, overruns:0, maxStepMs:0, rejectedCheckpoints:0, maxCheckpointValidationMs:0};
    this.lastRecoveryErrorAt = -Infinity;
    this.parked = new Map();
    this.autoContinue = true;
    // Delta snapshot stream (state-codec.js): one encoder while hosting, one decoder while a guest.
    this.codec = new SnapshotDeltaEncoder(); this.decoder = new SnapshotDeltaDecoder(); this.helloAt = 0;
    this.listeners = [];
    const on = (type, handler) => {
      this.connection.addEventListener(type, handler);
      this.listeners.push(() => this.connection.removeEventListener(type, handler));
    };
    on('welcome', ({detail:d}) => {
      const resume = this.identity?.peerId === d.peerId && this.identity?.room === d.room;
      this.identity = d; if (!resume) { this.sequence = sequenceFloor(); this.decoder.reset(); }
      this.emit('welcome', d);
      if (d.hostId === d.peerId && !(resume && d.resume && this.simulation)) this.promote(resume ? this.latest : this.initialCheckpoint, {restoringSave:!resume && !!this.initialCheckpoint});
      else if (d.hostId !== d.peerId && this.simulation) this.simulation = null;
    });
    on('message', ({detail}) => this.receive(detail));
    on('peer_connected', ({detail:d}) => {
      // A reopened channel may be a reloaded (older) client: it must announce the codec again.
      this.codec.forget(d?.peerId);
      if (this.simulation) {
        this.reconcile();
        // Sent before the snapshot on the same ordered channel, so a reloaded guest's first input is accepted.
        if (d?.peerId && d.peerId !== this.identity?.peerId) this.connection.send(d.peerId, {kind:'sequence',epoch:this.connection.epoch,seq:this.acceptedSequence(d.peerId)});
        this.publish(true);
      }
      else if (d?.peerId === this.connection.hostId) { this.decoder.reset(); this.helloAt = 0; }
    });
    on('peer_joined', () => { if (this.simulation) this.reconcile(); });
    on('peer_left', ({detail:d}) => { this.codec.forget(d?.peerId); if (this.simulation) this.reconcile(); });
    on('host_promoted', ({detail:d}) => this.promote(d.checkpoint));
    on('host_changed', ({detail:d}) => {
      if (d.hostId !== this.identity?.peerId) { this.simulation = null; this.decoder.reset(); this.helloAt = 0; }
      this.emit('host_changed', d);
    });
    on('checkpoint', ({detail:d}) => {
      this.latest = d.state || d.checkpoint;
      if (this.latest) this.autoSave();
    });
    for (const type of ['owner_lost','continue_world_offer']) on(type, ({detail}) => {
      this.simulation = null;
      const recoverySaved = this.autoSave(true);
      this.emit(type, {...detail, recoverySaved, recoveryAvailable:!!this.latest});
      // Take the world over at once so nobody has to press anything. A page in the background
      // could not run it, so it passes and the room offers the next player instead.
      if (type === 'continue_world_offer' && this.autoContinue) {
        if (globalThis.document?.hidden) this.declineWorld(); else this.continueWorld();
      }
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
    // A new generated world (world-creation menu): only the descriptor travels; every peer regenerates the land.
    this.newWorld = options.save ? null : restoreWorldDescriptor(options.world) || null;
    this.worldId = options.save?.id || crypto.randomUUID(); this.name = options.save?.name || (this.newWorld ? worldTitle(this.newWorld) : this.connection.local?'Solo Orchard':'Little Orchard');
    // Expedition Roguelite (shared/expedition-run.js): a new world created with run options starts as a run.
    this.runOptions = !options.save && options.run ? {...options.run} : null;
    if (this.runOptions) this.name = runWorldName(this.runOptions);
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
        const record = saved.find(p => p.id === player.id), before = pickupTotals(this.simulation);
        this.simulation.removePlayer(player.id); // Releases any held part and drops the pack as pickups first.
        if (record) {
          // The record keeps only what could not be dropped (pickup cap), so nothing is duplicated or lost.
          const after = pickupTotals(this.simulation), carried = {...record.resources};
          // removePlayer first folds the held ore into the pack before dropping it.
          // Include it in this balance too, otherwise the parked held slot duplicates
          // a dropped ore. Keep a held remainder separate from a possibly full pack.
          const heldOre = record.heldOre;
          if (heldOre) carried[heldOre] = (carried[heldOre] || 0) + 1;
          record.resources = Object.fromEntries(PACK.map(k => [k, Math.max(0, (carried[k] | 0) - (after[k] - before[k]))]));
          if (heldOre && record.resources[heldOre] > 0) record.resources[heldOre]--;
          else delete record.heldOre;
          this.parked.delete(player.id); this.parked.set(player.id, {record, at:now});
        }
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
      // removePlayer already dropped the carried pack into the world as pickups; record.resources is only the undropped rest.
      checkpoint.players.push({...record, move:[0,0], vy:0, inputTick:clampTick(record.inputTick), attackTick:clampTick(record.attackTick),
        castTick:clampTick(record.castTick), roleTick:clampTick(record.roleTick),
        ...(record.protectedUntil!==undefined?{protectedUntil:Math.min(record.protectedUntil,checkpoint.tick+180)}:{}),
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
  promote(checkpoint, {restoringSave = false} = {}) {
    if (!this.identity) return;
    try {
      this.codec = new SnapshotDeltaEncoder(); // New stream id; guests re-announce after one legacy snapshot.
      this.simulation = checkpoint ? loadSimulation({...checkpoint,room:this.identity.room}) : createSimulation(this.runOptions ? runSimOptions(this.identity.room,this.runOptions) : {room:this.identity.room,seed:41,...(this.newWorld?{world:this.newWorld}:{})});
      this.reconcile(); this.last = performance.now(); this.accumulator = 0;
      let recovery;
      if (restoringSave && [...this.parked.values()].some(({record}) => record.heldOre || PACK.some(k => record.resources?.[k] > 0))) {
        // A newly created room has new peer IDs. Undropped packs parked under the
        // old IDs cannot be claimed, and autosave would otherwise erase them.
        // Preserve the original checkpoint before publishing the resumed world.
        try { recovery = this.saves.put(makeSave(checkpoint, {name:`${this.name.slice(0,43)} (inventory recovery)`})); }
        catch {
          throw Object.assign(new Error('Could not save the inventory recovery copy. Download your original save, free browser storage, then retry.'), {code:'resume_backup_failed'});
        }
      }
      const own = this.simulation.checkpoint().players?.find(p => p.id === this.identity.peerId);
      this.sequence = Math.max(this.sequence, own?.seq || 0, own?.lastSeq || 0);
      this.publish(true); this.emit('hosting',{hz:HZ});
      if (recovery) this.emit('error', {code:'inventory_recovery_saved',reason:`The ground pickup limit left some supplies in your recovery copy, not your new pack. Download "${recovery.name}" from Saved Worlds to keep them.`,recoveryId:recovery.id});
    } catch(error) {
      this.simulation = null;
      if (error.code === 'resume_backup_failed') { this.running = false; clearInterval(this.timer); this.connection.close(); }
      this.emit('error',{...(error.code ? {code:error.code,reason:error.message} : {}),message:`Cannot recover this world: ${error.message}`});
    }
  }
  command(type, payload = {}) {
    if (!this.identity || !this.running) return false;
    const message = {...payload, type, seq:++this.sequence};
    if (this.simulation) this.applyCommand(this.identity.peerId, message);
    else this.connection.send(this.connection.hostId, {kind:'command',epoch:this.connection.epoch,message});
    return true;
  }
  get battleCompatible() { return this.connection.local === true || this.connection.maxPeers >= MAX_PLAYERS; }
  applyCommand(id, message) {
    if (message?.type === 'battle' && ['start','stop','reset'].includes(message.action) && id !== this.connection.hostId) {
      const detail={code:'host_required',message:'Only the world host can change battle mode. Ask the host to start or reset the battle.'};
      if (id===this.identity?.peerId) this.emit('error',detail);
      else this.connection.send(id,{kind:'command_error',epoch:this.connection.epoch,...detail});
      return;
    }
    if (message?.type==='battle' && ['start','reset'].includes(message.action) && !this.battleCompatible) {
      const detail={code:'client_update_required',message:'Everyone in this world must refresh the game before starting Battle mode. Older players can leave instead; ordinary exploration remains available.'};
      if (id===this.identity?.peerId) this.emit('error',detail);
      else this.connection.send(id,{kind:'command_error',epoch:this.connection.epoch,...detail});
      return;
    }
    const result = this.simulation.command(id,message);
    if (!result.ok) {
      const detail = {code:result.code,message:result.code.replaceAll('_',' '),...(typeof result.reason==='string'?{reason:result.reason.slice(0,280)}:{}),...(result.missing?{missing:result.missing}:{}),...(result.obstacle?{obstacle:result.obstacle}:{})};
      if (id === this.identity.peerId) this.emit('error',detail);
      // A stale counter learns the accepted floor at once instead of being refused until it catches up.
      else this.connection.send(id,{kind:'command_error',epoch:this.connection.epoch,...detail,
        ...(result.code === 'duplicate_sequence' ? {seq:this.acceptedSequence(id)} : {})});
    }
    for (const event of result.events || []) this.event(event);
  }
  // Highest seq the host has consumed for this player, across the simulation and the expedition ledger.
  acceptedSequence(id) {
    const world = this.simulation?.adventureWorld?.();
    const seq = world?.players?.find(p => p.id === id)?.seq, ledger = world?.adventure?.seqs?.[id];
    return Math.max(Number.isSafeInteger(seq) ? seq : 0, Number.isSafeInteger(ledger) ? ledger : 0);
  }
  adoptSequence(seq) {
    if (Number.isSafeInteger(seq) && seq > this.sequence && seq <= SEQ_MAX) this.sequence = seq;
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
    if (this.simulation && data.kind === 'snapshot_codec' && this.roster().some(p => (p.peerId || p.id) === from)) {
      if (supportsCodec(data)) this.codec.enable(from); // Hello or resync request: next frame is a keyframe.
    } else if (this.simulation && data.kind === 'command' && this.roster().some(p => (p.peerId || p.id) === from)) {
      try { this.applyCommand(from,data.message); } catch { /* A malformed remote command cannot stop the host. */ }
    } else if (from === this.connection.hostId && !this.simulation) {
      if (data.kind === 'snapshot') {
        this.guestSnapshot(data.snapshot);
        // Legacy full snapshots mean the host has not enabled deltas for us yet (or is an older client).
        const now = Date.now();
        if (now - this.helloAt >= 2000) { this.helloAt = now; this.sendCodec(codecHello()); }
      } else if (data.kind === 'snapshot_delta') {
        const result = this.decoder.accept(data);
        if (result.request) this.sendCodec(result.request);
        if (result.snapshot) this.guestSnapshot(result.snapshot);
      } else if (data.kind === 'sequence') this.adoptSequence(data.seq);
      else if (data.kind === 'event') this.emit('event',data.event);
      else if (data.kind === 'command_error') { this.adoptSequence(data.seq); this.emit('error',data); }
    }
  }
  guestSnapshot(snapshot) {
    this.emit('snapshot', snapshot);
    const self = snapshot.players?.find(p => p.id === this.identity?.peerId);
    if (self) this.identity.role = self.role;
  }
  sendCodec(message) { this.connection.send(this.connection.hostId, {...message, epoch:this.connection.epoch}); }
  event(event) {
    this.emit('event',event);
    this.connection.broadcast({kind:'event',epoch:this.connection.epoch,event});
  }
  tick() {
    const now = performance.now(), elapsed = Math.max(0, Math.min(100,now-this.last)); this.last = now;
    if (!this.running || !this.simulation) return;
    this.accumulator += elapsed;
    let steps = 0, publishDue = false;
    while(this.accumulator >= 1000/HZ && steps < 6) {
      const start = performance.now();
      for(const event of this.simulation.step()) this.event(event);
      this.metrics.maxStepMs = Math.max(this.metrics.maxStepMs,performance.now()-start);
      this.metrics.steps++; this.accumulator -= 1000/HZ; steps++;
      if(this.metrics.steps % 3 === 0) publishDue = true;
    }
    // Keep every 60 Hz simulation step/event, but don't serialize obsolete intermediate
    // states when catching up after a delayed browser timer. Publish the freshest state once.
    if (publishDue) this.publish();
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
    const peers = this.connection.peers;
    if(!this.connection.local && (!(peers instanceof Map) || peers.size)){
    const wireSnapshot=quantizeWire({...snapshot,projectiles:snapshot.projectiles.map(({trail,...shot})=>shot)});
    const legacy = {kind:'snapshot',epoch:this.connection.epoch,snapshot:wireSnapshot};
    if (!this.codec.size || !(peers instanceof Map)) this.connection.broadcast(legacy);
    else {
      // Capable peers get a delta against the frame they last received (or a keyframe); others stay legacy.
      let encoded = true; try { this.codec.publish(wireSnapshot); } catch { encoded = false; }
      const prepared = new Map(), canPrepare = typeof this.connection.prepareMessage === 'function' && typeof this.connection.sendPrepared === 'function';
      for (const id of peers.keys()) {
        const frame = encoded ? this.codec.frame(id, this.connection.epoch) : null;
        let sent;
        if (canPrepare) {
          // Within one publication all keyframes are identical, as are all deltas.
          // Preserve each peer's base bookkeeping while encoding each payload just once.
          const key = frame ? frame.b : 'legacy';
          if (!prepared.has(key)) prepared.set(key, this.connection.prepareMessage(frame || legacy));
          sent = this.connection.sendPrepared(id, prepared.get(key));
        } else sent = this.connection.send(id, frame || legacy);
        if (frame && !sent) this.codec.resync(id);
      }
    }
    }
    const now = performance.now();
    if(force || now-this.lastCheckpoint > 500) {
      const checkpoint = this.simulation.checkpoint(), started = performance.now();
      try { this.connection.validateCheckpoint(checkpoint); }
      catch {
        this.metrics.rejectedCheckpoints++;
        if (started-this.lastRecoveryErrorAt >= 10_000) {
          this.lastRecoveryErrorAt = started;
          this.emit('error',{code:'checkpoint_rejected',message:'This world produced an invalid recovery update. Your last working backup is kept. Download it from Saved Worlds before reloading.'});
        }
        this.lastCheckpoint = now; // Do not repeat an expensive failed validation every frame.
        return;
      } finally { this.metrics.maxCheckpointValidationMs = Math.max(this.metrics.maxCheckpointValidationMs,performance.now()-started); }
      this.latest = checkpoint;
      // Revision is monotonic even when a confirmed reset starts simulation tick 0.
      const revision = Math.max(0, (this.connection.checkpointRevision ?? -1) + 1);
      this.connection.setCheckpoint(this.latest,revision); this.lastCheckpoint = now;
      this.autoSave();
    }
  }
  autoSave(force = false) {
    if(!this.latest || (!force && Date.now()-this.lastSave < 10000)) return false;
    try { this.saves.put(makeSave(this.latest,{id:this.worldId,name:this.name})); this.lastSave = Date.now(); this.emit('saved',{at:this.lastSave}); return true; }
    catch(error) { this.lastSave = Date.now(); this.emit('error',{code:'save_failed',message:error.message}); return false; }
  }
  exportSave() { return makeSave(this.simulation?.checkpoint() || this.latest,{id:this.worldId,name:this.name}); }
  importSave(text) { const save = parseSave(text); loadSimulation(save.checkpoint); return this.saves.put(save); }
  continueWorld() { this.connection.continueWorld(); }
  retryWorld() { this.connection.retryWorld(); }
  declineWorld() { this.connection.declineWorld(); }
  transferHost(id) { this.connection.transferHost(id); }
  // Pass the world on while this host can still speak (closing, or a hidden tab whose timers
  // are about to be throttled). A fresh recovery point goes out first so nothing rolls back.
  handOver() {
    if (!this.simulation || this.connection.local || !this.identity || this.connection.hostId !== this.identity.peerId) return false;
    const successor = this.connection.successor?.();
    if (!successor) return false;
    this.publish(true);
    return this.connection.transferHost(successor) !== false;
  }
  resetWorld() {
    if (!this.simulation) throw new Error('Only the current host can reset the world.');
    // A failed recovery write must abort reset; the confirmation promises a backup.
    this.saves.put(this.exportSave());
    this.worldId = crypto.randomUUID(); this.latest = null; this.lastSave = 0; this.parked.clear();
    // Reset keeps the world type: the one this room was created with, else the loaded save's or the predecessor's own.
    const current = this.simulation.snapshot().world, world = this.newWorld || (current && current.kind !== 'expedition' ? current : null);
    this.simulation = createSimulation({room:this.identity.room,seed:41,...(world?{world}:{})}); this.codec.reset();
    this.reconcile(); this.publish(true);
  }
  /** Host only: replace this world with a fresh Expedition Roguelite run (a run world needs no sandbox backup). */
  startRun(run) {
    if (!this.simulation) throw new Error('Only the current host can start a new run.');
    const fresh = createSimulation(runSimOptions(this.identity.room,run));
    this.runOptions = {...run}; this.name = runWorldName(run);
    this.worldId = crypto.randomUUID(); this.latest = null; this.lastSave = 0; this.parked.clear();
    this.simulation = fresh; this.codec.reset();
    this.reconcile(); this.publish(true);
  }
  stop() { if (this.running && this.simulation) try { this.publish(true); } catch { /* closing */ }
    this.autoSave(true); this.running=false; clearInterval(this.timer); this.simulation=null; this.connection.close(); }
  dispose() { this.stop(); this.listeners.forEach(remove=>remove()); }
}
