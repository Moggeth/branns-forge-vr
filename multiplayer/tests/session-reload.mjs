// Reload / reconnect sequencing and integrated-world codec exactness for client/session.js.
// Two real WorldSessions are wired through in-memory connections (no network), so the host's
// real applyCommand path and the guest's real receive path are both exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MATERIAL_KEYS, emptyMaterials} from '../shared/material-catalog.js';
import {WorldSession} from '../client/session.js';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {quantizeWire} from '../client/wire-quantize.js';
import {makeSave, parseSave} from '../client/world-saves.js';
import {SnapshotDeltaEncoder, SnapshotDeltaDecoder} from '../client/state-codec.js';

const storage = () => { const data = new Map(); return {getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k)}; };

class Room {
  constructor() { this.links = new Map(); this.roster = new Map(); }
}
class Link extends EventTarget {
  constructor(room, id, hostId = 'one') {
    super(); this.room = room; this.id = id; this.hostId = hostId; this.epoch = 1; this.peers = new Map(); this.sent = [];
    room.links.set(id, this);
  }
  get roster() { return this.room.roster; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  connect() {
    this.closed = false; // WorldSession.connect() calls stop() -> close() first.
    this.room.roster.set(this.id, {id: this.id, name: this.id, role: 'hero', online: true});
    const host = this.room.links.get(this.hostId);
    if (this.id !== this.hostId) { host.peers.set(this.id, {}); this.peers.set(this.hostId, {}); }
    this.emit('welcome', {room: 'ABCDEFGH', peerId: this.id, hostId: this.hostId, role: 'hero', peers: [...this.room.roster.values()]});
    if (this.id !== this.hostId) { host.emit('peer_joined', {id: this.id}); host.emit('peer_connected', {peerId: this.id}); this.emit('peer_connected', {peerId: this.hostId}); }
  }
  send(to, data) {
    this.sent.push({to, data});
    const target = this.room.links.get(to); if (!target || target.closed) return false;
    target.emit('message', {from: this.id, data: structuredClone(data)}); return true;
  }
  broadcast(data) { let n = 0; for (const id of this.peers.keys()) if (this.send(id, data)) n++; return n; }
  setCheckpoint(state, revision) { this.checkpoint = state; this.checkpointRevision = revision; }
  close() { this.closed = true; }
}

function room() {
  const r = new Room(), hostLink = new Link(r, 'one'), host = new WorldSession({connection: hostLink, storage: storage()});
  host.connect(); clearInterval(host.timer);
  return {r, hostLink, host};
}
function join(r, id) {
  const link = new Link(r, id), s = new WorldSession({connection: link, storage: storage()}), errors = [];
  s.addEventListener('error', e => errors.push(e.detail));
  s.connect(); clearInterval(s.timer); return {link, s, errors};
}
// A page reload: the old page's channel closes, the peer server keeps the seat, and a new page (no memory)
// is welcomed with the same peer id via the stored secret.
function reload(r, hostLink, old, id) {
  old.link.closed = true; old.s.dispose();
  return join(r, id);
}
const hostPlayer = (host, id) => host.simulation.adventureWorld().players.find(p => p.id === id);
const move = s => s.command('input', {move: {x: 0, z: -1}, yaw: 0});

test('reloaded guest: first new input is accepted immediately; zero duplicate_sequence', () => {
  const {r, hostLink, host} = room();
  const old = join(r, 'two');
  for (let i = 0; i < 500; i++) move(old.s);
  const oldSeq = hostPlayer(host, 'two').seq;
  assert.ok(oldSeq >= old.s.sequence - 0 && oldSeq > 0);
  // Legacy-style small counter on the old page reproduces the reported bug shape: host seq far above 0.
  const fresh = reload(r, hostLink, old, 'two');
  const sync = hostLink.sent.filter(m => m.to === 'two' && m.data.kind === 'sequence').at(-1);
  assert.equal(sync.data.seq, hostPlayer(host, 'two').seq, 'host announced the accepted floor on channel open');
  const before = hostPlayer(host, 'two').seq;
  assert.equal(move(fresh.s), true);
  assert.ok(hostPlayer(host, 'two').seq > before, 'first command after reload consumed by the host');
  assert.deepEqual(fresh.errors, []);
  // Old-page packets replayed after the reload are still refused and never lower the host seq.
  const top = hostPlayer(host, 'two').seq;
  host.receive({from: 'two', data: {kind: 'command', epoch: 1, message: {type: 'input', seq: oldSeq, move: {x: 1, z: 0}, yaw: 0}}});
  host.receive({from: 'two', data: {kind: 'command', epoch: 1, message: {type: 'input', seq: top, move: {x: 1, z: 0}, yaw: 0}}});
  assert.equal(hostPlayer(host, 'two').seq, top);
  assert.equal(fresh.errors.filter(e => e.code === 'duplicate_sequence').length, 2, 'replays rejected');
  host.dispose(); fresh.s.dispose();
});

test('clock floor alone (legacy host sends no sync) and rolled-back clock (error carries floor)', () => {
  // Legacy host: suppress the sequence message; the fresh page's clock floor still exceeds the old counter.
  {
    const {r, hostLink, host} = room();
    const old = join(r, 'two'); old.s.sequence = 0; for (let i = 0; i < 40; i++) move(old.s);
    const realSend = hostLink.send.bind(hostLink);
    hostLink.send = (to, data) => data.kind === 'sequence' ? true : realSend(to, data);
    const fresh = reload(r, hostLink, old, 'two');
    assert.ok(fresh.s.sequence >= Date.now() - 60_000);
    move(fresh.s); assert.deepEqual(fresh.errors, []);
    host.dispose(); fresh.s.dispose();
  }
  // Clock rolled back below the old counter and no sync: exactly one refusal, then accepted.
  {
    const {r, hostLink, host} = room();
    const old = join(r, 'two'); for (let i = 0; i < 10; i++) move(old.s);
    const realSend = hostLink.send.bind(hostLink);
    hostLink.send = (to, data) => data.kind === 'sequence' ? true : realSend(to, data);
    const fresh = reload(r, hostLink, old, 'two'); fresh.s.sequence = 3;
    move(fresh.s); const before = hostPlayer(host, 'two').seq; move(fresh.s);
    assert.equal(fresh.errors.length, 1); assert.equal(fresh.errors[0].code, 'duplicate_sequence');
    assert.ok(hostPlayer(host, 'two').seq > before);
    host.dispose(); fresh.s.dispose();
  }
});

test('expedition ledger above the sim seq is included in the floor', () => {
  const {r, hostLink, host} = room();
  const old = join(r, 'two'); move(old.s);
  host.simulation.adventureWorld().adventure.seqs.two = 9_000_000_000_000; // ledger ahead of p.seq (fresh re-add case)
  const fresh = reload(r, hostLink, old, 'two');
  assert.equal(fresh.s.sequence, 9_000_000_000_000);
  const res = fresh.s.command('adventure', {action: 'noop_probe'});
  assert.equal(res, true);
  assert.ok(!fresh.errors.some(e => e.code === 'duplicate_sequence'));
  host.dispose(); fresh.s.dispose();
});

test('transient reconnect (resume) keeps the counter; HP/tool/role preserved; pack conserved', () => {
  const {r, hostLink, host} = room();
  const g = join(r, 'two'); for (let i = 0; i < 20; i++) move(g.s);
  const p = hostPlayer(host, 'two'); p.hp = 37; p.tool = 'pick'; p.resources = {wood: 9, stone: 4, gems: 3};
  const seqBefore = g.s.sequence, total = () => {
    const w = host.simulation.adventureWorld(), t = {wood: 0, stone: 0, gems: 0};
    for (const q of w.pickups) t[q.kind] += q.amount; for (const q of w.players) for (const k in t) t[k] += q.resources[k] | 0;
    for (const e of host.parked.values()) for (const k in t) t[k] += e.record.resources[k] | 0; return t;
  };
  const t0 = total();
  r.roster.get('two').online = false; hostLink.emit('peer_left', {peerId: 'two'});
  assert.deepEqual(total(), t0, 'leaving conserves the pack (pickups + parked remainder)');
  r.roster.get('two').online = true; hostLink.emit('peer_joined', {id: 'two'});
  g.link.emit('welcome', {room: 'ABCDEFGH', peerId: 'two', hostId: 'one', role: 'hero', peers: [...r.roster.values()]});
  hostLink.emit('peer_connected', {peerId: 'two'});
  assert.equal(g.s.sequence, seqBefore, 'resume does not reseed');
  const back = hostPlayer(host, 'two');
  assert.equal(back.hp, 37); assert.equal(back.tool, 'pick');
  assert.deepEqual(back.resources, emptyMaterials(), 'dropped pack is not duplicated');
  assert.deepEqual(total(), t0);
  move(g.s); assert.deepEqual(g.errors, []);
  host.dispose(); g.s.dispose();
});

test('pickup cap full: undropped gems return with the hero (never lost, never doubled); role restored', () => {
  const {r, hostLink, host} = room();
  const g = join(r, 'two');
  const w = host.simulation.adventureWorld();
  const existingGems = w.pickups.filter(q => q.kind === 'gems').reduce((a, q) => a + q.amount, 0);
  while (w.pickups.length < 255) w.pickups.push({id: `fill${w.pickups.length}`, kind: 'wood', x: 0, z: 0, y: 0, amount: 1});
  const p = hostPlayer(host, 'two'); p.resources = {wood: 0, stone: 0, gems: 25}; p.role = 'god';
  r.roster.get('two').online = false; hostLink.emit('peer_left', {peerId: 'two'});
  const dropped = w.pickups.filter(q => q.kind === 'gems').reduce((a, q) => a + q.amount, 0);
  assert.equal(dropped - existingGems, 10);
  r.roster.get('two').online = true; hostLink.emit('peer_joined', {id: 'two'});
  const back = hostPlayer(host, 'two');
  assert.equal(back.resources.gems, 15); assert.equal(back.role, 'god');
  host.dispose(); g.s.dispose();
});

test('host migration and world reset keep guest commands accepted', () => {
  const {r, hostLink, host} = room();
  const a = join(r, 'two'), b = join(r, 'three');
  for (let i = 0; i < 30; i++) { move(a.s); move(b.s); }
  host.publish(true);
  const checkpoint = structuredClone(hostLink.checkpoint);
  // 'two' becomes host from the last checkpoint; 'three' re-opens its channel to it.
  hostLink.closed = true; host.dispose(); r.roster.delete('one');
  for (const l of [a.link, b.link]) { l.hostId = 'two'; l.epoch = 2; }
  a.link.peers = new Map([['three', {}]]); b.link.peers = new Map([['two', {}]]);
  a.link.emit('host_promoted', {checkpoint}); clearInterval(a.s.timer);
  assert.ok(a.s.simulation);
  assert.ok(a.s.sequence >= checkpoint.players.find(p => p.id === 'two').seq);
  b.link.emit('host_changed', {hostId: 'two'});
  a.link.emit('peer_connected', {peerId: 'three'});
  move(a.s); move(b.s);
  assert.deepEqual([a.errors, b.errors], [[], []]);
  // Reset: fresh simulation seq 0; existing guest counter is higher and is accepted.
  a.s.resetWorld(); move(b.s); move(a.s);
  assert.deepEqual([a.errors, b.errors], [[], []]);
  assert.ok(hostPlayer(a.s, 'three').seq > 0);
  a.s.dispose(); b.s.dispose();
});

test('integrated world: tree/log/adventure/fire snapshots decode exactly; save round-trips', () => {
  const s = createSimulation({room: 'ABCDEFGH', seed: 41});
  s.addPlayer({id: 'h'}); s.addPlayer({id: 'g', role: 'god'});
  const W = s.adventureWorld(), h = W.players.find(p => p.id === 'h');
  let seq = 0; const cmd = (id, m) => s.command(id, {seq: ++seq, ...m});
  const enc = new SnapshotDeltaEncoder(), dec = new SnapshotDeltaDecoder(); enc.enable('x');
  let frames = 0, deltas = 0;
  const publish = () => {
    const snap = s.snapshot(), wire = quantizeWire({...snap, projectiles: snap.projectiles.map(({trail, ...q}) => q)});
    enc.publish(wire); const f = enc.frame('x', 1); const out = dec.accept(structuredClone(f));
    assert.ok(out.snapshot, `frame ${frames} decoded`); assert.equal(JSON.stringify(out.snapshot), JSON.stringify(wire));
    frames++; if (f.p !== undefined) deltas++;
  };
  const steps = n => { for (let i = 0; i < n; i++) { s.step(); if (W.tick % 3 === 0) publish(); } };
  // Trees and logs: stand beside a real tree and chop it with real strike commands.
  const tree = worldTrees(W).find(t => Math.hypot(t.x, t.z) < 60) || worldTrees(W)[0];
  const floor = W.players && (s.snapshot().players[0].position[1]);
  assert.ok(Number.isFinite(floor));
  h.position = [tree.x + .9, h.position[1], tree.z]; h.yaw = Math.PI / 2; h.tool = 'axe';
  let chopped = 0;
  for (let i = 0; i < 3; i++) {
    steps(30); h.position = [tree.x + .9, h.position[1], tree.z]; h.yaw = Math.PI / 2;
    const y = h.position[1] + .2 + i * .01;
    const res = cmd('h', {type: 'action', action: 'strike', targetId: tree.id, point: [tree.x + .25, y, tree.z], normal: [1, 0, 0]});
    if (res.ok) chopped++;
  }
  steps(240);
  // Fire via the real flame + host contact path.
  cmd('h', {type: 'action', action: 'equip', tool: 'wyrmspout'});
  cmd('h', {type: 'action', action: 'flame', origin: [h.position[0], h.position[1] + .3, h.position[2]], direction: [0, -1, 0]});
  s.step(); s.step();
  const q = s.snapshot().projectiles[0];
  if (q) s.projectileContact({projectileId: q.id, targetId: 'world', part: 'torso', point: q.position, normal: [0, 1, 0], localPoint: q.position, localQuaternion: [0, 0, 0, 1]});
  // Expedition: the God starts it through the real adventure command.
  const started = cmd('g', {type: 'adventure', action: 'start'});
  steps(300);
  const snap = s.snapshot();
  assert.ok(snap.harvestedTrees.length > 0 && chopped > 0, `tree chopped (${chopped})`);
  assert.ok(snap.fireCells.length > 0, 'fire cells present');
  assert.ok(snap.adventure && typeof snap.adventure === 'object');
  assert.ok(frames > 150 && deltas > frames * .9, `frames ${frames} deltas ${deltas}`);
  // Save round trip on the same live world.
  const cp = s.checkpoint(), text = JSON.stringify(makeSave(cp, {id: 'w', name: 'Little Orchard'}));
  const back = loadSimulation(parseSave(text).checkpoint);
  // loadSimulation fills optional defaults (flaskLit, overheatUntil...), so compare against a direct load.
  assert.deepEqual(back.checkpoint(), loadSimulation(structuredClone(cp)).checkpoint());
  assert.deepEqual(JSON.parse(JSON.stringify(back.checkpoint())), back.checkpoint(), 'checkpoint is plain JSON');
  assert.deepEqual(back.snapshot(), s.snapshot());
  console.log(JSON.stringify({frames, deltas, chopped, harvested: snap.harvestedTrees.length, logs: snap.looseLogs.length,
    fireCells: snap.fireCells.length, adventureStart: started.ok ? 'ok' : started.code, stage: snap.adventure.stage}));
});

// All nine material types must survive the bounded pickup queue across departure/rejoin.
test('full pickup cap preserves every new metal and ore across reconnect', () => {
  const {r, hostLink, host} = room(), guest = join(r, 'two');
  const world = host.simulation.adventureWorld();
  while (world.pickups.length < 256) world.pickups.push({id:`cap${world.pickups.length}`,kind:'wood',x:0,z:0,y:0,amount:1});
  const pack = Object.fromEntries(MATERIAL_KEYS.map((key,i)=>[key,i+11]));
  hostPlayer(host,'two').resources = {...pack};
  r.roster.get('two').online=false; hostLink.emit('peer_left',{peerId:'two'});
  assert.deepEqual(host.parked.get('two').record.resources,pack);
  r.roster.get('two').online=true; hostLink.emit('peer_joined',{id:'two'});
  assert.deepEqual(hostPlayer(host,'two').resources,pack);
  assert.equal(world.pickups.length,256);
  host.dispose(); guest.s.dispose();
});
