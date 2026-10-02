// Real-command Forge Expedition acceptance. Gameplay state changes ONLY through createSimulation().command(),
// .step(), .addPlayer/.removePlayer and checkpoint()->loadSimulation() round trips. The harness reads the live
// state through adventureWorld() strictly read-only (asserted by a hash check around every bot decision is too
// costly; instead every resource is reconciled against a command ledger after every command and step).
// Usage: node tests/expedition-real-play.mjs [hero|god|mixed|retry|all]   Logs: out/<scenario>.jsonl
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// EXPEDITION_SHARED selects the module copy under test (default ../shared; fixes/shared for patched proposals).
const BASE = new URL(process.env.EXPEDITION_SHARED ? `file:///${path.resolve(process.env.EXPEDITION_SHARED).replace(/\\/g, '/')}/` : '../shared/', import.meta.url);
const {createSimulation, loadSimulation, terrainHeight} = await import(new URL('simulation.js', BASE));
const {partPosition} = await import(new URL('combat.js', BASE));
const {worldTrees} = await import(new URL('world-content.js', BASE));
const {trunkRadius, treeScale, isFelled} = await import(new URL('trees.js', BASE));
const {adventureView} = await import(new URL('adventure.js', BASE));

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.env.EXPEDITION_OUT || path.join(ROOT, 'logs', 'expedition-real-play'); fs.mkdirSync(OUT, {recursive: true}); void ROOT;
const HZ = 60, SIM_CAP = 20 * 60 * HZ; // twenty simulated minutes hard cap per scenario
const LOGGED = new Set(['tree_fell', 'tree_land', 'grab', 'pickup', 'ore_break', 'death', 'detach', 'armor_break', 'adventure_stage',
  'adventure_deposit', 'adventure_support', 'adventure_star_impact', 'adventure_foe_down', 'adventure_reward', 'adventure_rekindled', 'adventure_telegraph', 'spell']);
const sub = (a, b) => [a[0] - b[0], a[2] - b[2]];
const len2 = v => Math.hypot(v[0], v[1]);
const yawToward = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));

class Room {
  constructor(name, seed = 41) {
    this.name = name; this.game = createSimulation({room: name.toUpperCase(), seed});
    this.lines = []; this.counts = {}; this.milestones = []; this.wall0 = performance.now();
    this.ledger = {}; this.stageDeposits = {wood: 0, stone: 0, gems: 0}; this.notPlaytested = [];
    this.logsBorn = 0; this.logsStowed = 0; this.oreYield = {stone: 0, gems: 0}; this.pickedUp = {stone: 0, gems: 0, wood: 0};
    this.prevStage = 'idle'; this.prevAdv = null; this.reloads = 0;
  }
  get S() { return this.game.adventureWorld(); } // read-only live view
  get adv() { return this.S.adventure; }
  get t() { return this.S.tick; }
  player(id) { return this.S.players.find(p => p.id === id); }
  write(o) { this.lines.push(JSON.stringify({tick: this.t, sim: +(this.t / HZ).toFixed(2), ...o})); }
  mark(label, extra = {}) { const m = {label, sim: +(this.t / HZ).toFixed(1), wallMs: Math.round(performance.now() - this.wall0), ...extra}; this.milestones.push(m); this.write({milestone: label, ...extra}); console.log(`  [${this.name}] ${m.sim}s ${label}`, Object.keys(extra).length ? JSON.stringify(extra) : ''); }
  join(id, role) { const r = this.game.addPlayer({id, name: id, role}); assert.equal(r.ok, true); this.ledger[id] = {wood: 0, stone: 0, gems: 0}; this.write({join: id, role}); return r; }
  events(list, source, pid) {
    for (const e of list) {
      this.counts[e.kind] = (this.counts[e.kind] || 0) + 1;
      if (e.kind === 'tree_land') this.logsBorn += e.logs;
      if (e.kind === 'death' && this.ledger[e.id]) { this.heroDeaths = (this.heroDeaths || 0) + 1; this.write({heroDeath: e.id, at: e.position}); }
      if (e.kind === 'adventure_deposit') { this.ledger[e.id][e.resource] -= e.amount; this.stageDeposits[e.resource] += e.amount; }
      if (e.kind === 'adventure_stage') { this.mark(`stage:${e.stage}`); this.stageDeposits = {wood: 0, stone: 0, gems: 0}; }
      if (LOGGED.has(e.kind)) this.write({event: e.kind, source, id: e.id, ...(e.stage ? {stage: e.stage} : {}), ...(e.resource ? {resource: e.resource, amount: e.amount} : {}), ...(e.spell ? {spell: e.spell, phase: e.phase} : {})});
    }
  }
  cmd(pid, msg) {
    const before = msg.action === 'interact' ? new Map(this.S.pickups.map(q => [q.id, {...q}])) : null;
    const held = msg.action === 'interact' ? this.S.looseLogs.find(l => l.heldBy === pid) : null;
    const brokenBefore = new Set(this.S.deposits.filter(d => d.depleted).map(d => d.id));
    const r = this.game.command(pid, msg);
    if (msg.type !== 'input') this.write({cmd: pid, msg: {...msg, seq: undefined}, ok: r.ok, code: r.code, ev: r.events.map(e => e.kind)});
    for (const e of r.events) if (e.kind === 'pickup') {
      if (held && e.id === held.id) { this.ledger[pid].wood++; this.logsStowed++; }
      else { const q = before.get(e.id); assert.ok(q, 'pickup event without a pre-existing pickup'); if (q.kind !== 'apple') { this.ledger[pid][q.kind] += q.amount; this.pickedUp[q.kind] += q.amount; } }
    }
    for (const d of this.S.deposits) if (d.depleted && !brokenBefore.has(d.id)) this.oreYield[d.kind === 'meteor' ? 'gems' : 'stone'] += 2;
    this.events(r.events, 'cmd', pid);
    this.check();
    return r;
  }
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      if (this.t >= SIM_CAP) throw Error(`${this.name}: simulated time cap reached in stage ${this.adv.stage}`);
      const a = this.adv; const snap = {stage: a.stage, stock: {...a.stock}, need: {...a.need}, charge: a.star.charge, flame: a.flame, waveIndex: a.waveIndex, rekindled: a.rekindled, foes: a.foes.length};
      this.events(this.game.step(), 'step');
      this.transitionCheck(snap);
      if (this.t % 30 === 0) this.check();
    }
  }
  transitionCheck(prev) {
    const now = this.adv.stage; if (now === prev.stage) return;
    // No progress without goals: every forward transition is justified by the state on the preceding tick.
    if (prev.stage === 'camp' && now === 'star') assert.ok(prev.stock.wood >= prev.need.wood && prev.stock.stone >= prev.need.stone, `camp->star without goals ${JSON.stringify(prev)}`);
    if (prev.stage === 'star' && now === 'rekindle') assert.ok(prev.charge >= prev.need.star && prev.need.star > 0, `star->rekindle without gems ${JSON.stringify(prev)}`);
    if (now === 'victory') { assert.ok(prev.stage === 'rekindle' && this.adv.rekindled && this.adv.waveIndex >= 3 && !this.adv.foes.length && !this.S.enemies.some(e => e.id.startsWith(`xv${this.adv.run}`)), `victory without goals ${JSON.stringify(prev)}`); this.victoryBy = this.counts.adventure_foe_down ? 'kills' : 'none'; }
  }
  check() {
    for (const p of this.S.players) {
      const l = this.ledger[p.id]; if (!l) continue;
      assert.deepEqual({...p.resources}, l, `${this.name}: ${p.id} inventory diverged from command ledger at tick ${this.t}`);
    }
    const a = this.adv;
    if (a.stage === 'camp') assert.equal(a.stock.wood + a.stock.stone, this.stageDeposits.wood + this.stageDeposits.stone + a.supportUsed, 'camp stock = hero deposits + God tithes');
    if (a.stage === 'star') assert.ok(a.star.charge <= this.stageDeposits.gems + a.supportUsed, 'star charge without gems');
    // World conservation: every log born is either loose or stowed; every ore yield is a pickup or collected.
    assert.equal(this.logsBorn, this.S.looseLogs.length + this.logsStowed, 'log conservation');
    const loose = k => this.S.pickups.filter(q => q.kind === k).reduce((n, q) => n + q.amount, 0);
    assert.equal(this.oreYield.stone, loose('stone') + this.pickedUp.stone, 'stone conservation');
    assert.equal(this.oreYield.gems, loose('gems') + this.pickedUp.gems, 'gem conservation');
  }
  reload(reason) { // Host restart / reconnect: JSON round trip through the real validator.
    const text = JSON.stringify(this.game.checkpoint());
    this.game = loadSimulation(JSON.parse(text)); this.reloads++;
    this.mark(`checkpoint-reload:${reason}`, {bytes: text.length}); this.check();
  }
  flush(extra) {
    fs.writeFileSync(path.join(OUT, `${this.name}.jsonl`), this.lines.join('\n') + '\n', 'utf8');
    return {scenario: this.name, simSeconds: +(this.t / HZ).toFixed(1), wallMs: Math.round(performance.now() - this.wall0), stage: this.adv.stage, reloads: this.reloads, milestones: this.milestones, counts: this.counts, notPlaytested: this.notPlaytested, ...extra};
  }
}

class Bot {
  constructor(room, id) { this.room = room; this.id = id; this.seq = 0; this.lastInput = -99; this.deaths = 0; this.stuckReports = []; }
  get me() { return this.room.player(this.id); }
  get pos() { return this.me.position; }
  send(msg) { return this.room.cmd(this.id, {...msg, seq: ++this.seq}); }
  input(move, yaw) { this.lastInput = this.room.t; return this.send({type: 'input', move: {x: move[0], z: move[1]}, yaw}); }
  face(target) { this.input([0, 0], yawToward(this.pos, target)); }
  idle(ticks) { this.room.step(ticks); }
  equip(tool) { if (this.me.tool !== tool) assert.equal(this.send({type: 'action', action: 'equip', tool}).ok, true); }
  adventure(action, extra = {}) { return this.send({type: 'adventure', action, ...extra}); }
  enemiesNear(r) { return this.room.S.enemies.map(e => [e, len2(sub(e.position, this.pos))]).filter(x => x[1] <= r).sort((a, b) => a[1] - b[1]); }
  steer(target) {
    const p = this.pos, d = sub([target[0], 0, target[1]], p), dist = len2(d); let v = [d[0] / dist, d[1] / dist];
    const cuts = new Map(this.room.S.harvestedTrees.map(h => [h.id, h]));
    for (const tree of this.trees()) { // Simple trunk avoidance: lateral push away from trunks just ahead.
      const o = [tree.x - p[0], tree.z - p[2]], od = len2(o); if (od > 1.8 || od < 1e-3 || (isFelled(cuts.get(tree.id)) && tree.id !== this.ignoreTree)) continue;
      const ahead = (o[0] * v[0] + o[1] * v[1]) / od; if (ahead < .2) continue;
      const side = o[0] * v[1] - o[1] * v[0] >= 0 ? 1 : -1; v = [v[0] - side * -v[1] * 1.2 / od, v[1] - side * v[0] * 1.2 / od];
    }
    const n = len2(v) || 1; return [v[0] / n, v[1] / n];
  }
  trees() { return this._trees ||= worldTrees(this.room.S); }
  walkTo(target, radius = .6, {fight = true, maxTicks = 60 * 60} = {}) {
    const start = this.room.t; let check = {t: start, p: [...this.pos]}, detour = 0, detourDir = 1;
    while (len2(sub([target[0], 0, target[1]], this.pos)) > radius) {
      if (this.room.t - start > maxTicks) { this.stuckReports.push({target, at: [...this.pos], tick: this.room.t}); this.room.write({stuck: this.id, target, at: this.pos}); return false; }
      if (fight && this.me.role === 'hero' && this.enemiesNear(6).length) this.fight(9);
      let dir = this.steer(target);
      if (detour > 0) { dir = [-dir[1] * detourDir, dir[0] * detourDir]; detour--; }
      if (this.room.t - this.lastInput >= 6 || detour) this.input(dir, Math.atan2(-dir[0], -dir[1]));
      this.room.step(1);
      if (this.room.t - check.t >= 45) { // stuck: moved < 40 cm in .75 s while walking
        if (len2(sub(this.pos, check.p)) < .4 && !this.enemiesNear(3).length) { detour = 30; detourDir *= -1; this.room.write({detour: this.id, at: this.pos, target}); }
        check = {t: this.room.t, p: [...this.pos]};
      }
    }
    this.input([0, 0], this.me.yaw); return true;
  }
  // Melee with the actual strike validator: precise head contact at partPosition(), range/facing from the server.
  fight(radius = 9, maxTicks = 60 * 60) {
    const start = this.room.t, hpStart = this.me.hp;
    for (let near = this.enemiesNear(radius); near.length; near = this.enemiesNear(radius)) {
      if (this.room.t - start > maxTicks) { this.room.write({fightTimeout: this.id}); return false; }
      const [e, d] = near[0];
      if (d > 2.0) { const dir = sub(e.position, this.pos), n = len2(dir); this.input([dir[0] / n, dir[1] / n], yawToward(this.pos, e.position)); this.room.step(1); continue; }
      const tool = e.kind === 'golem' && (e.armor ?? 0) > 0 ? 'pick' : 'hammer'; this.equip(tool);
      const cd = {pick: 29, hammer: 40}[tool];
      if (this.room.t - this.me.attackTick < cd) { this.face(e.position); this.room.step(Math.min(6, cd - (this.room.t - this.me.attackTick))); continue; }
      this.face(e.position);
      const part = e.missingParts.includes('head') ? 'torso' : 'head', point = partPosition(e, part), n = sub(this.pos, e.position), nn = len2(n) || 1;
      const r = this.send({type: 'action', action: 'strike', tool, targetId: e.id, part, point, normal: [n[0] / nn, 0, n[1] / nn]});
      if (!r.ok || !r.events.some(ev => ev.kind === 'hit' || ev.kind === 'headshot')) this.room.write({missedStrike: this.id, code: r.code, d});
      this.room.step(1);
    }
    return true;
  }
  chop(tree) {
    this.ignoreTree = null;
    const floor = terrainHeight(this.room.S, tree.x, tree.z), standOff = 1.5;
    const from = sub(this.pos, [tree.x, 0, tree.z]), fn = len2(from) || 1, side = [from[0] / fn, from[1] / fn];
    assert.ok(this.walkTo([tree.x + side[0] * standOff, tree.z + side[1] * standOff], .35), `could not reach ${tree.id}`);
    this.equip('axe');
    for (let cut = 1; cut <= 3; cut++) {
      while (this.room.t - this.me.attackTick < 27) this.room.step(1);
      if (this.enemiesNear(6).length) { this.fight(9); cut--; this.walkTo([tree.x + side[0] * standOff, tree.z + side[1] * standOff], .35); this.equip('axe'); continue; }
      const toHero = sub(this.pos, [tree.x, 0, tree.z]), hn = len2(toHero), u = [toHero[0] / hn, toHero[1] / hn], h = 1.0 * treeScale(tree);
      const r = trunkRadius(tree, h), point = [tree.x + u[0] * r, floor + h, tree.z + u[1] * r];
      this.face([tree.x, 0, tree.z]);
      const res = this.send({type: 'action', action: 'strike', tool: 'axe', targetId: tree.id, point, normal: [u[0], 0, u[1]]});
      const hit = res.events.find(e => e.kind === 'wood_hit');
      assert.ok(res.ok && hit && hit.cuts === cut, `chop ${tree.id} cut ${cut}: ${JSON.stringify(res)}`);
    }
    this.room.mark(`felled:${tree.id}`);
  }
  collectLogs(tree) {
    let waited = 0; while (!this.room.S.harvestedTrees.find(h => h.id === tree.id)?.landed) { if (this.enemiesNear(6).length) this.fight(9); this.room.step(1); assert.ok(++waited < 60 * 30, 'tree never landed'); }
    this.ignoreTree = tree.id; let got = 0;
    for (;;) {
      const log = this.room.S.looseLogs.filter(l => l.sourceId === tree.id && !l.heldBy).sort((a, b) => len2(sub(a.position, this.pos)) - len2(sub(b.position, this.pos)))[0];
      if (!log) break;
      if (!this.walkTo([log.position[0], log.position[2]], .9)) { this.room.write({unreachableLog: log.id}); break; }
      const g = this.send({type: 'action', action: 'grab', id: log.id});
      if (!g.ok) { this.room.write({grabFail: log.id, code: g.code, dist: len2(sub(log.position, this.pos))}); this.walkTo([log.position[0], log.position[2]], .3); assert.equal(this.send({type: 'action', action: 'grab', id: log.id}).ok, true, 'grab retry'); }
      const s = this.send({type: 'action', action: 'interact'}); assert.ok(s.ok && s.events.some(e => e.kind === 'pickup'), 'stow failed'); got++;
    }
    this.ignoreTree = null; return got;
  }
  mine(ore) {
    const from = sub(this.pos, [ore.x, 0, ore.z]), fn = len2(from) || 1, at = [ore.x + from[0] / fn * 1.6, ore.z + from[1] / fn * 1.6];
    assert.ok(this.walkTo(at, .35), `could not reach ${ore.id}`);
    this.equip('pick');
    let guard = 0;
    while (!this.room.S.deposits.find(d => d.id === ore.id).depleted) {
      assert.ok(++guard < 4000, `mining ${ore.id} never finished`);
      if (this.enemiesNear(6).length) { this.fight(9); this.walkTo(at, .35); this.equip('pick'); continue; }
      if (this.room.t - this.me.attackTick < 29) { this.room.step(1); continue; }
      const g = terrainHeight(this.room.S, ore.x, ore.z), u = sub(this.pos, [ore.x, 0, ore.z]), un = len2(u) || 1;
      this.face([ore.x, 0, ore.z]);
      const r = this.send({type: 'action', action: 'strike', tool: 'pick', targetId: ore.id, point: [ore.x + u[0] / un * .45, g + .35, ore.z + u[1] / un * .45], normal: [u[0] / un, 0, u[1] / un]});
      assert.ok(r.ok && r.events.some(e => e.kind === 'stone_hit'), `pick ${ore.id}: ${JSON.stringify(r)} d=${un}`);
      this.room.step(1);
    }
    // Pick up the yield (pickup lies at the ore centre).
    const before = this.room.S.pickups.length;
    this.walkTo([ore.x, ore.z], 1.2);
    const r = this.send({type: 'action', action: 'interact'}); assert.ok(r.ok && r.events.some(e => e.kind === 'pickup'), `collect ${ore.id}`);
    assert.equal(this.room.S.pickups.length, before - 1);
    this.room.mark(`mined:${ore.id}`, {inv: {...this.me.resources}});
  }
  deposit(kind, amount) {
    this.walkTo([0, 4], 1.5);
    const r = this.adventure('deposit', {kind, amount}); this.room.write({deposit: kind, amount, ok: r.ok, code: r.code}); return r;
  }
}

class God {
  constructor(room, id) { this.room = room; this.id = id; this.seq = 0; }
  get me() { return this.room.player(this.id); }
  send(msg) { return this.room.cmd(this.id, {...msg, seq: ++this.seq}); }
  cast(spell, point, extra = {}) {
    const {SPELL_COST} = God; let waited = 0;
    while (this.me.mana < SPELL_COST[spell] || this.room.t - this.me.castTick < 45) { this.room.step(1); assert.ok(++waited < 60 * 60, `mana wait ${spell}`); }
    return this.send({type: 'cast', spell, point: [point[0], 0, point[1]], ...extra});
  }
  adventure(action, extra = {}) { const stage = this.room.adv.stage; let w = 0; while (this.me.mana < 31 || this.room.adv.tick - (this.room.adv.cool[this.id] ?? -1e9) < 120) { this.room.step(1); if (++w > 3600) break; } if (this.room.adv.stage !== stage) return {ok: true, skipped: 'stage_advanced'}; return this.send({type: 'adventure', action, ...extra}); }
  // Kill foes by real Lightning (80 dmg, 3 m) aimed at their current position.
  smite(filter = () => true, max = 40) {
    for (let i = 0; i < max; i++) { const e = this.room.S.enemies.find(filter); if (!e) return true; const r = this.cast('lightning', [e.position[0], e.position[2]]); assert.equal(r.ok, true, `lightning ${r.code}`); this.room.step(1); }
    return false;
  }
}
God.SPELL_COST = {lightning: 22, raise: 12, grove: 10, skeleton: 15, starfall: 25, heal: 18, wall: 14, frost: 20};

// ---------------- Scenarios ----------------
function heroCamp(room, hero, {extraTrees = 1} = {}) {
  const S = room.S, a = room.adv;
  const trees = worldTrees(S).filter(t => t.id.startsWith('tree') && !S.harvestedTrees.some(h => h.id === t.id)).sort((x, y) => len2(sub([x.x, 0, x.z], hero.pos)) - len2(sub([y.x, 0, y.z], hero.pos)));
  const woodTrees = Math.ceil(Math.max(0, a.need.wood - a.stock.wood - hero.me.resources.wood) / 3) + extraTrees;
  for (const tree of trees.slice(0, woodTrees)) {
    hero.chop(tree); const got = hero.collectLogs(tree);
    room.mark(`stowed:${tree.id}`, {logs: got, inv: {...hero.me.resources}});
    if (room.adv.stock.wood < room.adv.need.wood && hero.me.resources.wood >= 3) { const r = hero.deposit('wood', Math.min(hero.me.resources.wood, room.adv.need.wood - room.adv.stock.wood)); assert.equal(r.ok, true, `deposit wood ${r.code}`); }
    if (!room.firstDonate && room.adv.stock.wood > 0) { room.firstDonate = true; room.mark('first-gather-donate', {stock: {...room.adv.stock}}); }
  }
  const ores = S.deposits.filter(d => d.kind === 'stone' && !d.depleted).sort((x, y) => len2(sub([x.x, 0, x.z], hero.pos)) - len2(sub([y.x, 0, y.z], hero.pos)));
  for (const ore of ores) {
    if (room.adv.stage !== 'camp' && hero.me.resources.stone >= 4) break;
    hero.mine(ore);
    if (room.adv.stage === 'camp' && room.adv.stock.stone < room.adv.need.stone) { const r = hero.deposit('stone', Math.min(hero.me.resources.stone, room.adv.need.stone - room.adv.stock.stone)); assert.equal(r.ok, true, `deposit stone ${r.code}`); }
  }
  if (room.adv.stage === 'camp' && room.adv.stock.wood < room.adv.need.wood) { const r = hero.deposit('wood', room.adv.need.wood - room.adv.stock.wood); assert.equal(r.ok, true); }
  // Over-deposit must be refused, not silently burned.
  if (room.adv.stage === 'camp' && room.adv.stock.stone >= room.adv.need.stone && hero.me.resources.stone) { const r = hero.deposit('stone', 1); assert.equal(r.code, 'not_needed'); }
}

function heroStar(room, hero) {
  let w = 0; while (room.adv.stage === 'camp') { if (hero.enemiesNear(6).length) hero.fight(9); room.step(1); assert.ok(++w < 60 * 30, 'camp never advanced'); }
  assert.equal(room.adv.stage, 'star');
  const view = adventureView(room.adv, room.S, hero.id), site = [view.star.x, view.star.z];
  room.mark('star-objective', {site, need: room.adv.need.star});
  // Approach but stay outside the 5 m impact radius until it lands.
  const approach = [site[0] * .78, site[1] * .78]; hero.walkTo(approach, 1);
  while (!room.adv.star.landed) room.step(1);
  // Guardians wake 3 s after impact at site+3z: fight them first (they come to us).
  room.step(3 * HZ + 5); hero.fight(14, 60 * 120);
  room.mark('guardians-cleared', {hp: hero.me.hp, heroDeaths: room.heroDeaths});
  const shards = room.S.deposits.filter(d => d.kind === 'meteor' && d.id.startsWith(`xv${room.adv.run}s`));
  for (const ore of shards) if (!ore.depleted) hero.mine(ore);
  hero.walkTo([0, 6], 3);
  const r = hero.deposit('gems', hero.me.resources.gems); assert.equal(r.ok, true, `deposit gems ${r.code}`);
}

function heroRekindle(room, hero) {
  for (let w = 0; room.adv.stage === 'star'; w++) { room.step(1); assert.ok(w < 600); }
  assert.equal(room.adv.stage, 'rekindle'); room.mark('rekindle-begin', {flame: room.adv.flame});
  // Leftover fuel into the flame (real deposit, real conversion).
  for (const k of ['wood', 'stone', 'gems']) if (hero.me.resources[k]) { const r = hero.deposit(k, hero.me.resources[k]); room.write({fuel: k, ok: r.ok, code: r.code}); }
  room.mark('fuel-deposited', {flame: +room.adv.flame.toFixed(1)});
  // Guard a post between forge and the telegraphed gate; fight whatever approaches.
  let w = 0;
  while (room.adv.stage === 'rekindle') {
    const tg = room.adv.telegraphs.find(t => t.kind === 'gate');
    if (hero.enemiesNear(30).length) hero.fight(30, 60 * 60);
    else if (tg) hero.walkTo([tg.x * .35, tg.z * .35], 1.5, {maxTicks: 600});
    room.step(1);
    assert.ok(++w < 20000, 'rekindle loop');
  }
}

function scenarioHero() {
  const room = new Room('hero-solo'), hero = new Bot(room, 'hero1');
  room.join('hero1', 'hero'); room.mark('spawn', {at: hero.pos});
  // Walk-input acceptance: move north 2 s with real input, verify displacement ~5 m/s.
  const p0 = [...hero.pos]; for (let i = 0; i < 12; i++) { hero.input([1, 0], -Math.PI / 2); room.step(10); }
  const moved = len2(sub(hero.pos, p0)); assert.ok(moved > 9 && moved < 10.5, `walk speed: ${moved} m in 2 s`); room.mark('walk-input-ok', {moved: +moved.toFixed(2)});
  assert.equal(hero.adventure('deposit', {kind: 'wood', amount: 1}).code, 'invalid_stage');
  assert.equal(hero.adventure('start').ok, true);
  heroCamp(room, hero); heroStar(room, hero); heroRekindle(room, hero);
  assert.equal(room.adv.stage, 'victory', 'hero solo did not win');
  room.mark('victory', {renown: room.adv.renown, retries: room.adv.retries, kills: room.adv.deeds.kills, heroDeaths: room.heroDeaths || 0});
  return room.flush({stuck: hero.stuckReports});
}

function scenarioGod({letDie = false} = {}) {
  const room = new Room(letDie ? 'god-retry' : 'god-solo'), god = new God(room, 'god1');
  room.join('god1', 'god');
  assert.equal(god.send({type: 'adventure', action: 'start'}).ok, true);
  // Camp: God must shape and plant (deeds), tithe covers all resources when no hero can gather.
  assert.equal(god.cast('raise', [8, -8]).ok, true);
  assert.equal(god.cast('grove', [-14, -4]).ok, true);
  assert.equal(god.cast('skeleton', [20, 20]).code, 'expedition_no_heroes');
  let tithes = 0;
  while (room.adv.stage === 'camp') {
    const kind = room.adv.stock.wood < room.adv.need.wood ? 'wood' : 'stone';
    if (room.adv.stock[kind] >= room.adv.need[kind]) { room.step(10); continue; }
    const r = god.adventure('tithe', {kind}); assert.equal(r.ok, true, `tithe ${r.code}`); tithes++;
  }
  room.mark('god-camp-done', {tithes});
  while (!room.adv.star.landed) room.step(1);
  assert.equal(god.adventure('lodestar', {point: [room.S.enemies[0]?.position[0] ?? 0, 0, 0]}).code, room.adv.foes.length ? 'too_far' : 'too_far');
  room.step(3 * HZ + 2);
  const site = adventureView(room.adv, room.S, 'god1').star;
  const guarded = god.adventure('lodestar', {point: [site.x, 0, site.z]}); assert.equal(guarded.code, 'guarded');
  assert.ok(god.smite(e => e.id.includes('g_')), 'god could not clear guardians');
  room.mark('god-guardians-cleared');
  while (room.adv.stage === 'star') { const r = god.adventure('lodestar', {point: [site.x, 0, site.z]}); assert.equal(r.ok, true, `lodestar ${r.code}`); }
  room.mark('god-star-done');
  let w = 0;
  while (room.adv.stage === 'rekindle') {
    if (!letDie || room.adv.retries > 0) {
      if (room.S.enemies.length) god.smite(() => true, 4);
      else if (room.adv.flame < 96 && room.adv.supportUsed < 100 && god.me.mana >= 31) { const r = god.adventure('tithe'); if (!r.ok) room.write({titheRefused: r.code}); }
      else room.step(10);
    } else room.step(30);
    if (room.adv.stage === 'defeat') {
      room.mark('defeat', {retries: room.adv.retries, flame: room.adv.flame});
      assert.equal(room.S.enemies.length, 0, 'defeat should despawn foes');
      assert.equal(god.send({type: 'adventure', action: 'retry'}).ok, true); room.mark('retry');
    }
    assert.ok(++w < 50000);
  }
  assert.equal(room.adv.stage, 'victory'); room.mark('victory', {retries: room.adv.retries, renown: room.adv.renown});
  room.notPlaytested.push('God-only camp has no physical gathering: tithes are the authored path (supportCap = total when no Heroes).');
  return room.flush();
}

function scenarioMixed() {
  const room = new Room('mixed'), hero = new Bot(room, 'p1'), god = new God(room, 'p2');
  room.join('p1', 'hero'); room.join('p2', 'god');
  assert.equal(hero.adventure('start').ok, true);
  // Gate/refund checks with real casts.
  assert.equal(god.cast('skeleton', [3, 3]).code, 'expedition_keep_out');
  const drained = room.adv.hostileUsed;
  assert.equal(god.cast('raise', [6, -6]).ok, true); // shape deed
  // Spend mana to force a sim-side rejection after the gate reserved budget.
  assert.equal(god.cast('grove', [-14, -6]).ok, true); // plant deed
  while (god.me.mana >= 15) { room.step(45); if (god.me.mana < 15) break; const r = god.cast('heal', [0, 6]); if (!r.ok) break; }
  room.step(45);
  const r = god.send({type: 'cast', spell: 'golem', point: [30, 0, -30]}); // 45 mana: should fail on mana and refund the budget
  room.write({refundProbe: r.code, hostileUsed: room.adv.hostileUsed});
  if (r.code === 'insufficient_mana') { assert.equal(room.adv.hostileUsed, drained, 'challenge budget not refunded'); room.mark('refund-ok'); }
  // Hero gathers; mid-camp the host restarts from a checkpoint (reconnect) and play resumes with the same sequences.
  const trees = worldTrees(room.S).filter(t => t.id.startsWith('tree'));
  hero.chop(trees[1]); hero.collectLogs(trees[1]);
  const seqBefore = room.player('p1').seq; room.reload('host-restart-mid-camp'); assert.equal(room.player('p1').seq, seqBefore);
  assert.equal(hero.deposit('wood', 3).ok, true);
  // God switches to Hero mid-camp to help gather (role switch; no inventory transfer).
  assert.equal(god.send({type: 'role', role: 'hero'}).ok, true);
  const helper = new Bot(room, 'p2'); helper.seq = god.seq;
  room.mark('role-switch:p2->hero');
  heroCamp(room, hero, {extraTrees: 0});
  // Helper contributes real stone only if any ore remains.
  const ore = room.S.deposits.find(d => d.kind === 'stone' && !d.depleted);
  if (ore && room.adv.stage === 'camp') { helper.mine(ore); const d = helper.deposit('stone', helper.me.resources.stone); room.write({helperDeposit: d.code || 'ok'}); }
  else room.notPlaytested.push('Helper gather skipped: camp finished before a free deposit remained.');
  god.seq = helper.seq;
  room.step(125);
  assert.equal(god.send({type: 'role', role: 'god'}).ok, true); room.mark('role-switch:p2->god');
  room.reload('reconnect-before-star');
  heroStar(room, hero); heroRekindle(room, hero);
  assert.equal(room.adv.stage, 'victory'); room.mark('victory', {renown: room.adv.renown});
  return room.flush({stuck: [...hero.stuckReports, ...helper.stuckReports]});
}

// Four Heroes, no God: mine every stone ore in the world with real strikes and deposit everything.
function scenarioFourHeroStone() {
  const room = new Room('four-hero-stone' + (process.env.EXPEDITION_SHARED ? '-fixed' : '')), bots = ['h1', 'h2', 'h3', 'h4'].map(id => { room.join(id, 'hero'); return new Bot(room, id); });
  assert.equal(bots[0].adventure('start').ok, true);
  const need = {...room.adv.need}, worldStone = room.S.deposits.filter(d => d.kind === 'stone').length * 2;
  room.mark('needs', {need, worldStone});
  // Wood: h1..h3 chop (3 trees each would be slow; one tree each plus h1 extra until wood is met).
  for (const ore of room.S.deposits.filter(d => d.kind === 'stone')) { const b = bots[3]; b.mine(ore); const r = b.deposit('stone', b.me.resources.stone); room.write({stoneDeposit: r.code || 'ok'}); }
  const trees = worldTrees(room.S).filter(t => t.id.startsWith('tree'));
  for (let i = 0; room.adv.stage === 'camp' && room.adv.stock.wood < room.adv.need.wood && i < trees.length; i++) { const b = bots[i % 3]; b.chop(trees[i]); b.collectLogs(trees[i]); const r = b.deposit('wood', Math.min(b.me.resources.wood, room.adv.need.wood - room.adv.stock.wood)); room.write({woodDeposit: r.code || 'ok'}); }
  room.step(10 * HZ);
  room.mark('after-all-stone', {stage: room.adv.stage, stock: {...room.adv.stock}, need: room.adv.need, oresLeft: room.S.deposits.filter(d => d.kind === 'stone' && !d.depleted).length});
  return room.flush({blocked: room.adv.stage === 'camp', stock: {...room.adv.stock}, need, worldStone});
}
// Rematch in a Hero-only room: run 1 to real victory, then start run 2 and try to gather again from what the world holds.
function scenarioRematch() {
  const room = new Room('rematch' + (process.env.EXPEDITION_SHARED ? '-fixed' : '')), hero = new Bot(room, 'hero1');
  room.join('hero1', 'hero'); assert.equal(hero.adventure('start').ok, true);
  heroCamp(room, hero, {extraTrees: 0}); heroStar(room, hero); heroRekindle(room, hero);
  assert.equal(room.adv.stage, 'victory'); room.mark('run1-victory');
  assert.equal(hero.adventure('start').ok, true);
  const stoneLeft = room.S.deposits.filter(d => d.kind === 'stone' && !d.depleted).length * 2 + hero.me.resources.stone;
  room.mark('run2-camp', {need: {...room.adv.need}, mineableStone: stoneLeft});
  let error = null; try { heroCamp(room, hero, {extraTrees: 0}); room.step(10 * HZ); } catch (e) { error = String(e.message).slice(0, 120); }
  room.mark('run2-result', {stage: room.adv.stage, stock: {...room.adv.stock}, error});
  return room.flush({blocked: room.adv.stage === 'camp', stoneLeft});
}
const which = process.argv[2] || 'all';
const results = [];
const run = (name, fn) => { const t0 = performance.now(); try { results.push({ok: true, ...fn()}); } catch (e) { results.push({scenario: name, ok: false, error: String(e.stack || e).split('\n').slice(0, 4).join(' | ')}); } console.log(`${name}: ${results.at(-1).ok ? 'PASS' : 'FAIL'} (${Math.round(performance.now() - t0)} ms wall)`); };
if (['hero', 'all'].includes(which)) run('hero-solo', scenarioHero);
if (['god', 'all'].includes(which)) run('god-solo', () => scenarioGod());
if (['retry', 'all'].includes(which)) run('god-retry', () => scenarioGod({letDie: true}));
if (['mixed', 'all'].includes(which)) run('mixed', scenarioMixed);
if (['stone4', 'all', 'blockers'].includes(which)) run('four-hero-stone', scenarioFourHeroStone);
if (['rematch', 'all', 'blockers'].includes(which)) run('rematch', scenarioRematch);
fs.writeFileSync(path.join(OUT, `summary-${which}${process.env.EXPEDITION_SHARED ? '-fixed' : ''}.json`), JSON.stringify(results, null, 1), 'utf8');
// Blocker scenarios: the integrated shared/ includes the stone restock, so they must not block.
// EXPEDITION_EXPECT_BLOCKED=1 checks a pre-fix module copy still reproduces the soft-lock.
const FIXED = !process.env.EXPEDITION_EXPECT_BLOCKED;
for (const r of results) if (r.ok && 'blocked' in r) { const want = !FIXED; console.log(`  ${r.scenario}: ${r.blocked ? 'BLOCKED (soft-lock reproduced)' : 'not blocked'}`); if (r.blocked !== want) { r.ok = false; r.error = `expected blocked=${want}`; } }
for (const r of results) if (!r.ok) console.log(`FAIL ${r.scenario}: ${r.error}`);
process.exitCode = results.every(r => r.ok) ? 0 : 1;
