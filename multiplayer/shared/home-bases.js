// Always-on home bases (battle v2): Dawnhold (party) in the south-west corner and
// Grumblekeep (rivals) in the north-east. Each sits under a shield dome held up by
// three pylons, with a heart forge, barracks, fountain, two crystal spires and two
// ballistas at its gate. Breaking every pylon drops the dome; smashing the heart wins
// the siege, and the fallen base rebuilds one level stronger.
// Pure simulation rules: fixed ticks, no clocks, rendering or random streams.

export const HOME = Object.freeze({
  domeRadius: 13.5, heartHp: 600, pylonHp: 300, levelCap: 5,
  shieldDownTicks: 90 * 60, rebuildTicks: 180 * 60, waveTicks: 60 * 60, firstWaveTicks: 20 * 60,
  fountainEvery: 30, fountainHeal: 5,
  turrets: Object.freeze({
    spire: Object.freeze({hp: 250, range: 9, cooldown: 90, damage: 14}),
    ballista: Object.freeze({hp: 300, range: 22, cooldown: 240, damage: 40, heroDamage: 20}),
  }),
  reward: Object.freeze({iron: 12, wood: 12, gems: 6, starOre: 3}),
});
export const HOME_NAMES = Object.freeze({party: 'Dawnhold', rivals: 'Grumblekeep'});
export const HOME_SITES = Object.freeze({party: Object.freeze([-36, -36]), rivals: Object.freeze([36, 36])});

// Base-local layout in metres: x is to the right of the gate, y points out of the
// gate toward the world centre. The client builds the same pieces from this table.
export const HOME_LAYOUT = Object.freeze({
  barracks: Object.freeze([-7, 3.4]), fountain: Object.freeze([5.2, 3.2]),
  pylons: Object.freeze([[6.6, 11.43], [-6.6, 11.43], [0, -13.2]].map(Object.freeze)),
  spires: Object.freeze([[-4, 16], [4, 16]].map(Object.freeze)),
  ballistas: Object.freeze([[-9.5, 14.5], [9.5, 14.5]].map(Object.freeze)),
  gate: Object.freeze([0, 13.5]), gatePillars: Object.freeze([[-2.6, 13.5], [2.6, 13.5]].map(Object.freeze)),
  // Boundary wards ring the dome every 22.5 degrees, leaving the gate and the three pylons clear.
  wards: Object.freeze([45, 67.5, 90, 112.5, 135, 157.5, -157.5, -135, -112.5, -90, -67.5, -45]
    .map(d => Object.freeze([+(Math.sin(d * Math.PI / 180) * 14).toFixed(3), +(Math.cos(d * Math.PI / 180) * 14).toFixed(3)]))),
  bellPost: Object.freeze([2.95, 2.75]), // in the barracks' own frame (three.js x, z)
});

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const sideKey = side => side === 'rivals' ? 'rivals' : 'party';

/** Unit vectors for a base: forward (out of the gate, toward the centre) and right. */
export function homeFrame(side) {
  const [x, z] = HOME_SITES[sideKey(side)], l = Math.hypot(x, z), f = [-x / l, -z / l];
  return {centre: [x, z], forward: f, right: [-f[1], f[0]]};
}
export function homePoint(side, [lx, ly]) {
  const {centre, forward, right} = homeFrame(side);
  return [centre[0] + right[0] * lx + forward[0] * ly, centre[1] + right[1] * lx + forward[1] * ly];
}

const partIds = side => {
  const id = `battle-base-${side}`;
  return [...HOME_LAYOUT.pylons.map((_, n) => [`${id}-pylon-${n}`, 'pylon', HOME_LAYOUT.pylons[n]]),
    ...HOME_LAYOUT.spires.map((_, n) => [`${id}-spire-${n}`, 'spire', HOME_LAYOUT.spires[n]]),
    ...HOME_LAYOUT.ballistas.map((_, n) => [`${id}-ballista-${n}`, 'ballista', HOME_LAYOUT.ballistas[n]])];
};
export const partMaxHp = kind => kind === 'pylon' ? HOME.pylonHp : HOME.turrets[kind].hp;

// Staggered first shots so the gate's four turrets never fire as one volley.
const firstShot = id => /-spire-1$/.test(id) ? 45 : /-ballista-0$/.test(id) ? 60 : /-ballista-1$/.test(id) ? 180 : 0;
function makePart(side, [id, kind, local], height) {
  const [x, z] = homePoint(side, local);
  return {id, kind, side, position: [x, height(x, z), z], hp: partMaxHp(kind), maxHp: partMaxHp(kind), ...(kind === 'pylon' ? {} : {readyTick: firstShot(id)})};
}

export function createHomeBase(side, height, level = 1) {
  const [x, z] = HOME_SITES[side];
  return {id: `battle-base-${side}`, side, position: [x, height(x, z), z], hp: HOME.heartHp, maxHp: HOME.heartHp,
    level, shieldDownUntil: 0, fallenUntil: 0, parts: partIds(side).map(p => makePart(side, p, height))};
}

export const homeBattle = state => state.battle?.v === 2 && state.battle.status === 'running';
export const baseFallen = (state, base) => base.fallenUntil > state.tick;
export const pylonsDown = base => base.parts.every(p => p.kind !== 'pylon' || p.hp <= 0);
/** The dome stands while the base is up and at least one pylon holds. */
export const shieldUp = (state, base) => !baseFallen(state, base) && !pylonsDown(base);

/** Live objects the given side may strike: enemy pylons and turrets, and an exposed enemy heart. */
export function siegeTargets(state, side) {
  if (!homeBattle(state)) return [];
  const out = [];
  for (const base of state.battle.bases) {
    if (base.side === side || baseFallen(state, base)) continue;
    for (const part of base.parts) if (part.hp > 0) out.push(part);
    if (!shieldUp(state, base) && base.hp > 0) out.push(base);
  }
  return out;
}
export function findHomeTarget(state, id) {
  if (state.battle?.v !== 2) return null;
  for (const base of state.battle.bases) {
    if (base.id === id) return {base, target: base};
    const part = base.parts.find(p => p.id === id);
    if (part) return {base, target: part};
  }
  return null;
}

/** Applies damage to a heart, pylon or turret. Returns true when it landed. */
export function damageHome(state, id, amount, side, events) {
  const found = findHomeTarget(state, id);
  if (!homeBattle(state) || !found || !Number.isFinite(amount) || amount <= 0 || amount > 1000) return false;
  const {base, target} = found;
  if (base.side === side || !['party', 'rivals'].includes(side) || baseFallen(state, base) || target.hp <= 0) return false;
  if (target === base && shieldUp(state, base)) {
    events.push({kind: 'home_shield_block', id, side: base.side, position: [...base.position]});
    return false;
  }
  target.hp = Math.max(0, target.hp - amount);
  events.push({kind: target === base ? 'battle_base_hit' : 'home_part_hit', id, part: target.kind || 'heart', side: base.side, hp: target.hp, position: [...target.position]});
  if (target.hp > 0) return true;
  if (target.kind === 'pylon') {
    events.push({kind: 'home_part_broken', id, part: 'pylon', side: base.side, position: [...target.position]});
    if (pylonsDown(base)) {
      base.shieldDownUntil = state.tick + HOME.shieldDownTicks;
      events.push({kind: 'home_shield_down', id: base.id, side: base.side, until: base.shieldDownUntil, position: [...base.position]});
    }
  } else if (target !== base) {
    events.push({kind: 'home_part_broken', id, part: target.kind, side: base.side, position: [...target.position]});
  } else {
    // Siege won: the heart falls, the winners are paid, the base rebuilds a level stronger.
    const winner = base.side === 'party' ? 'rivals' : 'party', stock = state.inventions?.stockpiles?.[winner], reward = {};
    for (const [k, n] of Object.entries(HOME.reward)) {
      const amountWon = n * base.level;
      reward[k] = amountWon;
      if (stock) stock[k] = Math.min(999, (stock[k] || 0) + amountWon);
    }
    base.fallenUntil = state.tick + HOME.rebuildTicks;
    base.shieldDownUntil = 0;
    for (const part of base.parts) part.hp = 0;
    state.battle.winner = winner;
    state.battle.sieges = Math.min(1e9, (state.battle.sieges || 0) + 1);
    events.push({kind: 'home_siege_won', winner, fallen: base.side, level: base.level, reward, position: [...base.position], rebuildTick: base.fallenUntil});
  }
  return true;
}

/** Per tick: rebuilds, pylon recovery, fountains and turret fire. */
export function stepHomeBases(state, ctx, events) {
  if (!homeBattle(state)) return;
  const heroes = state.players.filter(p => p.role === 'hero' && p.hp > 0);
  for (const base of state.battle.bases) {
    base.position[1] = ctx.terrainHeight(state, base.position[0], base.position[2]);
    for (const part of base.parts) part.position[1] = ctx.terrainHeight(state, part.position[0], part.position[2]);
    if (base.fallenUntil && state.tick >= base.fallenUntil) {
      base.fallenUntil = 0; base.level = Math.min(HOME.levelCap, base.level + 1); base.hp = base.maxHp;
      for (const part of base.parts) { part.hp = part.maxHp; if (part.readyTick !== undefined) part.readyTick = state.tick + 60 + firstShot(part.id); }
      events.push({kind: 'home_rebuilt', id: base.id, side: base.side, level: base.level, position: [...base.position]});
    }
    if (baseFallen(state, base)) continue;
    if (base.shieldDownUntil && state.tick >= base.shieldDownUntil) {
      base.shieldDownUntil = 0;
      for (const part of base.parts) if (part.kind === 'pylon') part.hp = part.maxHp;
      events.push({kind: 'home_shield_up', id: base.id, side: base.side, position: [...base.position]});
    }
    // The fountain mends its own side inside the dome footprint.
    if (state.tick % HOME.fountainEvery === 0) {
      for (const hero of heroes) if (sideKey(hero.side) === base.side && hero.hp < 100 && flat(hero.position, base.position) <= HOME.domeRadius) hero.hp = Math.min(100, hero.hp + HOME.fountainHeal);
      for (const bot of state.enemies) if (bot.battleRun !== undefined && bot.side === base.side && bot.hp > 0 && flat(bot.position, base.position) <= HOME.domeRadius) bot.hp = Math.min(bot.kind === 'golem' ? 320 : 100, bot.hp + HOME.fountainHeal);
    }
    for (const turret of base.parts) {
      if (turret.kind === 'pylon' || turret.hp <= 0 || state.tick < turret.readyTick) continue;
      const spec = HOME.turrets[turret.kind];
      let best = null, range = spec.range;
      for (const bot of state.enemies) if (bot.hp > 0 && bot.battleRun !== undefined && bot.side !== base.side) { const d = flat(bot.position, turret.position); if (d <= range) { range = d; best = bot; } }
      // Troops draw fire first, so heroes pushing behind their own squad are covered.
      if (!best) for (const hero of heroes) if (sideKey(hero.side) !== base.side && (hero.protectedUntil ?? 0) <= state.tick) { const d = flat(hero.position, turret.position); if (d <= range) { range = d; best = hero; } }
      if (!best) continue;
      turret.readyTick = state.tick + spec.cooldown;
      const hero = heroes.includes(best);
      events.push({kind: 'home_turret_fire', id: turret.id, turret: turret.kind, side: base.side, targetId: best.id, from: [...turret.position], to: [...best.position], tick: state.tick});
      if (hero) ctx.damageHero(state, best, spec.heroDamage ?? spec.damage, events);
      else ctx.damageEnemy(best, spec.damage, events, base.side);
    }
  }
}

/** Keeps hostile bodies outside a standing dome. Mutates position in place. */
export function resolveHomeDomes(state, position, side, radius = .3) {
  if (!homeBattle(state)) return position;
  for (const base of state.battle.bases) {
    if (side === base.side || !shieldUp(state, base)) continue;
    const dx = position[0] - base.position[0], dz = position[2] - base.position[2], d = Math.hypot(dx, dz), min = HOME.domeRadius + radius;
    if (d >= min) continue;
    const x = d > 1e-4 ? dx / d : base.side === 'party' ? 1 : -1, z = d > 1e-4 ? dz / d : base.side === 'party' ? 1 : -1;
    position[0] = base.position[0] + x * min; position[2] = base.position[2] + z * min;
  }
  return position;
}

// Solid footprints (base-local circles and the barracks box) so nobody walks through the buildings.
const SOLIDS = Object.freeze([
  {at: [0, 0], r: 3.3}, {at: HOME_LAYOUT.fountain, r: 2.0},
  ...HOME_LAYOUT.pylons.map(at => ({at, r: .9})), ...HOME_LAYOUT.spires.map(at => ({at, r: 1.1})), ...HOME_LAYOUT.ballistas.map(at => ({at, r: .95})),
  ...HOME_LAYOUT.gatePillars.map(at => ({at, r: .85})), ...HOME_LAYOUT.wards.map(at => ({at, r: .45})),
]);
const BARRACKS = Object.freeze({half: [3.2, 2.2], yaw: .55});
/** World yaw (three.js, about +Y) of a base's gate; local +Z of a piece points out of the gate. */
export const gateYaw = side => { const {forward} = homeFrame(side); return Math.atan2(forward[0], forward[1]); };
export const barracksYaw = side => gateYaw(side) + (side === 'rivals' ? BARRACKS.yaw : -BARRACKS.yaw);
export function resolveHomeStructures(state, position, radius = .3) {
  if (!homeBattle(state)) return position;
  for (const side of ['party', 'rivals']) {
    const [cx, cz] = HOME_SITES[side];
    if (Math.abs(position[0] - cx) > 20 || Math.abs(position[2] - cz) > 20) continue;
    for (const {at, r} of SOLIDS) {
      const [x, z] = homePoint(side, at), dx = position[0] - x, dz = position[2] - z, d = Math.hypot(dx, dz), min = r + radius;
      if (d >= min) continue;
      const k = d > 1e-4 ? min / d : 0;
      position[0] = d > 1e-4 ? x + dx * k : x + min; position[2] = d > 1e-4 ? z + dz * k : z;
    }
    // Barracks: the same oriented box the client draws (three.js yaw about +Y).
    const [bx, bz] = homePoint(side, HOME_LAYOUT.barracks), t = barracksYaw(side), c = Math.cos(t), sn = Math.sin(t);
    const dx = position[0] - bx, dz = position[2] - bz, u = dx * c - dz * sn, v = dx * sn + dz * c, hu = BARRACKS.half[0] + radius, hv = BARRACKS.half[1] + radius;
    if (Math.abs(u) < hu && Math.abs(v) < hv) {
      let nu = u, nv = v;
      if (hu - Math.abs(u) < hv - Math.abs(v)) nu = Math.sign(u || 1) * hu; else nv = Math.sign(v || 1) * hv;
      position[0] = bx + nu * c + nv * sn; position[2] = bz - nu * sn + nv * c;
    }
    const [px, pz] = HOME_LAYOUT.bellPost, postX = bx + px * c + pz * sn, postZ = bz - px * sn + pz * c, ex = position[0] - postX, ez = position[2] - postZ, ed = Math.hypot(ex, ez), em = .3 + radius;
    if (ed < em && ed > 1e-4) { position[0] = postX + ex / ed * em; position[2] = postZ + ez / ed * em; }
  }
  return position;
}

/** Squad for one barracks wave: forgeling-style allies for Dawnhold, skeletons then golems for Grumblekeep. */
export function squadFor(base) {
  const n = Math.min(6, 2 + base.level);
  return Array.from({length: n}, (_, i) => base.level >= 2 && i === n - 1 ? 'golem' : 'skeleton');
}

const int = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b;
const num = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
const vec = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

export function restoreHomeBases(bases, tick) {
  const bad = () => { throw Error('Invalid home bases'); };
  if (!Array.isArray(bases) || bases.length !== 2) bad();
  return ['party', 'rivals'].map((side, i) => {
    const b = bases[i], ids = partIds(side);
    if (!b || b.id !== `battle-base-${side}` || b.side !== side || b.maxHp !== HOME.heartHp || !num(b.hp, 0, HOME.heartHp) || !vec(b.position)
      || b.position[0] !== HOME_SITES[side][0] || b.position[2] !== HOME_SITES[side][1] || Math.abs(b.position[1]) > 200 || !int(b.level, 1, HOME.levelCap)
      || !num(b.shieldDownUntil, 0, tick + HOME.shieldDownTicks) || !num(b.fallenUntil, 0, tick + HOME.rebuildTicks) || !Array.isArray(b.parts) || b.parts.length !== ids.length) bad();
    const parts = ids.map(([id, kind], n) => {
      const p = b.parts[n];
      if (!p || p.id !== id || p.kind !== kind || p.side !== side || p.maxHp !== partMaxHp(kind) || !num(p.hp, 0, p.maxHp) || !vec(p.position) || Math.abs(p.position[1]) > 200
        || (kind !== 'pylon' && !num(p.readyTick, 0, tick + 600))) bad();
      return {id, kind, side, position: [...p.position], hp: p.hp, maxHp: p.maxHp, ...(kind === 'pylon' ? {} : {readyTick: p.readyTick})};
    });
    return {id: b.id, side, position: [...b.position], hp: b.hp, maxHp: b.maxHp, level: b.level, shieldDownUntil: b.shieldDownUntil, fallenUntil: b.fallenUntil, parts};
  });
}
