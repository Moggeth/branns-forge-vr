// Browser-authoritative, deterministic 60 Hz room simulation. No DOM, sockets, or secrets.
export const HZ = 60;
export const MAX_PLAYERS = 8;
const BOUND = 55, MAX_WORLD = 64;
const COST = {skeleton: 15, raise: 12, grove: 10, starfall: 25};
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const copy = value => structuredClone(value);
const fail = code => ({ok: false, code, events: []});
const ok = (events = []) => ({ok: true, events});
const safeSeq = n => Number.isSafeInteger(n) && n > 0;
const cleanName = value => (typeof value === 'string' ? value : 'Guest').trim().replace(/[\r\n\t]/g, ' ').slice(0, 24) || 'Guest';
const validPoint = p => Array.isArray(p) && p.length === 3 && p.every(finite) && Math.abs(p[0]) <= BOUND && Math.abs(p[2]) <= BOUND && Math.abs(p[1]) <= 1000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const validPosition = p => Array.isArray(p) && p.length === 3 && p.every(finite) &&
  Math.abs(p[0]) <= BOUND && Math.abs(p[2]) <= BOUND && Math.abs(p[1]) <= 200;
const validTick = (n, current, minimum = -1000, future = 0) => Number.isSafeInteger(n) && n >= minimum && n <= current + future;

function pose(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.position) || value.position.length !== 3 ||
      !value.position.every(n => finite(n) && Math.abs(n) <= 2.5) || Math.hypot(...value.position) > 2.5 ||
      !Array.isArray(value.quaternion) || value.quaternion.length !== 4 ||
      !value.quaternion.every(n => finite(n) && Math.abs(n) <= 1.01)) return null;
  const length = Math.hypot(...value.quaternion);
  if (length * length < 0.5 || length * length > 1.5) return null;
  return {position: [...value.position], quaternion: value.quaternion.map(n => n / length)};
}

function baseHeight(x, z) { return 0.45 * Math.sin(x * 0.09) * Math.cos(z * 0.07); }
export function terrainHeight(state, x, z) {
  let y = baseHeight(x, z);
  for (const edit of state.edits) {
    const t = clamp(1 - Math.hypot(x - edit.x, z - edit.z) / edit.radius, 0, 1);
    y += edit.height * t * t * (3 - 2 * t);
  }
  return y;
}

function spawn(state, ignored = '') {
  let best = [0, 0, 8], clearance = -1;
  for (let i = 0; i < 128; i++) {
    const theta = i * 2.3999632297, radius = 2.8 * Math.sqrt(i);
    const candidate = [clamp(Math.cos(theta) * radius, -BOUND, BOUND), 0, clamp(8 + Math.sin(theta) * radius, -BOUND, BOUND)];
    const others = [...state.players.filter(p => p.role === 'hero' && p.id !== ignored), ...state.enemies];
    const space = others.length ? Math.min(...others.map(p => distance(candidate, p.position))) : 10000;
    if (space > clearance) { best = candidate; clearance = space; }
    if (space >= 2.5) break;
  }
  best[1] = terrainHeight(state, best[0], best[2]);
  return best;
}

function event(kind, position, id) { return {kind, position: [...position], id}; }
function nextId(state, prefix) { return `${prefix}${++state.idCounter}`; }
function damageEnemy(state, enemy, amount, events) {
  enemy.hp -= amount;
  events.push(event('hit', enemy.position, enemy.id));
  if (enemy.hp <= 0) {
    events.push(event('death', enemy.position, enemy.id));
    state.enemies.splice(state.enemies.indexOf(enemy), 1);
  }
}
function damageHero(state, hero, amount, events) {
  hero.hp -= amount;
  events.push(event('hit', hero.position, hero.id));
  if (hero.hp <= 0) {
    events.push(event('death', hero.position, hero.id));
    hero.hp = 100; hero.position = spawn(state, hero.id); hero.vy = 0; hero.move = [0, 0];
  }
}

function newState({room = 'LOCAL', seed = 41} = {}) {
  if (typeof room !== 'string' || !room || room.length > 64 || !Number.isSafeInteger(seed)) throw Error('Invalid room or seed');
  return {version: 1, room, seed, tick: 0, idCounter: 0, players: [], enemies: [], edits: [], groves: [],
    pendingStarfalls: [], shrine: {position: [0, baseHeight(0, 0), 0], hp: 100, maxHp: 100, disabledUntil: 0}};
}

function instantiate(state) {
  const player = id => state.players.find(p => p.id === id);
  const api = {
    addPlayer({id, name = 'Guest', role = 'hero'} = {}) {
      if (!validId(id) || player(id)) return fail('invalid_player');
      if (!['hero', 'god'].includes(role)) return fail('invalid_role');
      if (state.players.length >= MAX_PLAYERS) return fail('room_full');
      const position = spawn(state);
      state.players.push({id, name: cleanName(name), role, position, yaw: 0, hp: 100, mana: 100,
        move: [0, 0], vy: 0, inputTick: -1000, attackTick: -1000, castTick: -1000,
        roleTick: -1000, seq: 0});
      return ok([event('join', position, id)]);
    },
    removePlayer(id) {
      const p = player(id); if (!p) return fail('not_joined');
      state.players.splice(state.players.indexOf(p), 1);
      return ok([event('leave', p.position, id)]);
    },
    command(id, message) {
      const p = player(id);
      if (!p) return fail('not_joined');
      if (!message || typeof message !== 'object') return fail('invalid_message');
      if (message.type === 'role') {
        if (!['hero', 'god'].includes(message.role)) return fail('invalid_role');
        if (state.tick - p.roleTick < 120) return fail('cooldown');
        if (p.role !== message.role) {
          p.role = message.role; p.roleTick = state.tick; p.move = [0, 0]; p.vy = 0;
          if (p.role === 'hero') p.position = spawn(state, p.id);
        }
        return ok();
      }
      if (!['input', 'action', 'cast'].includes(message.type)) return fail('unknown_message');
      if (!safeSeq(message.seq)) return fail('invalid_sequence');
      if (message.seq <= p.seq) return fail('duplicate_sequence');
      p.seq = message.seq; // Even a rejected payload consumes a valid sequence.
      if (message.type === 'input') {
        const m = message.move;
        if (!m || !finite(m.x) || !finite(m.z) || !finite(message.yaw) || Math.abs(message.yaw) > 100000 ||
            (message.head !== undefined && !pose(message.head)) ||
            (message.hands !== undefined && (!Array.isArray(message.hands) || message.hands.length > 2 || !message.hands.every(h => pose(h))))) return fail('invalid_input');
        let x = clamp(m.x, -1, 1), z = clamp(m.z, -1, 1), size = Math.hypot(x, z);
        if (size > 1) { x /= size; z /= size; }
        p.move = p.role === 'hero' ? [x, z] : [0, 0];
        p.yaw = ((message.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        p.inputTick = state.tick;
        if (message.jump === true && p.role === 'hero' && p.vy === 0) p.vy = 5.5;
        if (message.head !== undefined) p.head = pose(message.head);
        if (message.hands !== undefined) p.hands = message.hands.map(pose);
        return ok();
      }
      if (message.type === 'action') {
        if (message.action !== 'strike' || p.role !== 'hero') return fail('invalid_action');
        if (state.tick - p.attackTick < 27) return fail('cooldown');
        p.attackTick = state.tick;
        const facing = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
        const inReach = target => {
          const dx = target.position[0] - p.position[0], dz = target.position[2] - p.position[2];
          const d = Math.hypot(dx, dz);
          return Math.abs(target.position[1] - p.position[1]) <= 2.5 && d <= 2.8 &&
            (d < 0.5 || (facing[0] * dx + facing[1] * dz) / d >= 0.45) ? d : Infinity;
        };
        const enemy = state.enemies.map(e => [e, inReach(e)]).sort((a, b) => a[1] - b[1])[0];
        const events = [];
        if (enemy && Number.isFinite(enemy[1])) damageEnemy(state, enemy[0], 34, events);
        else if (state.shrine.hp > 0 && inReach(state.shrine) < Infinity) {
          state.shrine.hp = Math.max(0, state.shrine.hp - 25);
          events.push(event('hit', state.shrine.position, 'shrine'));
          if (!state.shrine.hp) {
            state.shrine.disabledUntil = state.tick + 480;
            events.push(event('death', state.shrine.position, 'shrine'));
          }
        }
        return ok(events);
      }
      if (p.role !== 'god') return fail('role_required');
      const spell = message.spell, point = message.point;
      if (!Object.hasOwn(COST, spell) || !validPoint(point)) return fail('invalid_cast');
      if (state.shrine.hp <= 0) return fail('shrine_disabled');
      if (state.tick - p.castTick < 45) return fail('cooldown');
      if (p.mana < COST[spell]) return fail('insufficient_mana');
      if ((spell === 'skeleton' && state.enemies.length >= MAX_WORLD) ||
          (spell === 'grove' && state.groves.length >= MAX_WORLD) ||
          (spell === 'raise' && state.edits.length + state.pendingStarfalls.length >= MAX_WORLD) ||
          (spell === 'starfall' && state.edits.length + state.pendingStarfalls.length >= MAX_WORLD) ||
          (spell === 'starfall' && state.pendingStarfalls.length >= 8)) return fail('world_limit');
      p.mana -= COST[spell]; p.castTick = state.tick;
      const idNew = nextId(state, spell[0]);
      const x = point[0], z = point[2], at = [x, terrainHeight(state, x, z), z], events = [event('cast', at, idNew)];
      if (spell === 'skeleton') state.enemies.push({id: idNew, position: at, yaw: 0, hp: 100, attackTick: -1000});
      if (spell === 'grove') state.groves.push({id: idNew, x, z});
      if (spell === 'raise') {
        state.edits.push({id: idNew, kind: 'raise', x, z, radius: 6, height: 2});
        liftActors(state);
      }
      if (spell === 'starfall') state.pendingStarfalls.push({id: idNew, x, z, radius: 5, impactTick: state.tick + 48});
      return ok(events);
    },
    step() {
      state.tick++;
      const events = [];
      if (state.shrine.hp === 0 && state.tick >= state.shrine.disabledUntil) state.shrine.hp = 100;
      for (const p of state.players) {
        p.mana = Math.min(100, p.mana + 3 / HZ);
        if (state.tick - p.inputTick > 18) p.move = [0, 0];
        if (p.role === 'hero') {
          p.position[0] = clamp(p.position[0] + p.move[0] * 5 / HZ, -BOUND, BOUND);
          p.position[2] = clamp(p.position[2] + p.move[1] * 5 / HZ, -BOUND, BOUND);
        }
        p.vy -= 15 / HZ; p.position[1] += p.vy / HZ;
        const floor = terrainHeight(state, p.position[0], p.position[2]);
        if (p.position[1] <= floor) { p.position[1] = floor; p.vy = 0; }
      }
      for (const pending of [...state.pendingStarfalls]) {
        if (pending.impactTick > state.tick) continue;
        state.pendingStarfalls.splice(state.pendingStarfalls.indexOf(pending), 1);
        const at = [pending.x, terrainHeight(state, pending.x, pending.z), pending.z];
        for (const e of [...state.enemies]) if (distance(at, e.position) <= 6) damageEnemy(state, e, 90, events);
        for (const p of state.players) if (p.role === 'hero' && distance(at, p.position) <= 5) damageHero(state, p, 18, events);
        state.edits.push({id: pending.id, kind: 'starfall', x: pending.x, z: pending.z, radius: 5, height: -1});
        liftActors(state); events.push(event('cast', at, pending.id));
      }
      for (const enemy of state.enemies) {
        const targets = state.players.filter(p => p.role === 'hero');
        if (!targets.length) continue;
        targets.sort((a, b) => distance(enemy.position, a.position) - distance(enemy.position, b.position));
        const target = targets[0], d = distance(enemy.position, target.position);
        const dx = target.position[0] - enemy.position[0], dz = target.position[2] - enemy.position[2];
        if (d > 0.0001) {
          enemy.yaw = Math.atan2(-dx, -dz);
          if (d > 1.5) {
            const stride = Math.min(2 / HZ, d - 1.5);
            enemy.position[0] = clamp(enemy.position[0] + dx / d * stride, -BOUND, BOUND);
            enemy.position[2] = clamp(enemy.position[2] + dz / d * stride, -BOUND, BOUND);
          }
        }
        // Keep enemies out of the hero's camera, including at the world edge.
        for (const hero of targets) {
          const gap = distance(enemy.position, hero.position);
          if (gap < 1 && Math.abs(enemy.position[1] - hero.position[1]) <= 2.5) {
            const ux = gap > 0.001 ? (enemy.position[0] - hero.position[0]) / gap : 1;
            const uz = gap > 0.001 ? (enemy.position[2] - hero.position[2]) / gap : 0;
            enemy.position[0] = clamp(hero.position[0] + ux, -BOUND, BOUND);
            enemy.position[2] = clamp(hero.position[2] + uz, -BOUND, BOUND);
          }
        }
        enemy.position[1] = terrainHeight(state, enemy.position[0], enemy.position[2]);
        if (d < 1.8 && state.tick - enemy.attackTick > 60) {
          enemy.attackTick = state.tick; damageHero(state, target, 10, events);
        }
      }
      return events;
    },
    snapshot() {
      return copy({tick: state.tick, time: state.tick / HZ, seed: state.seed, room: state.room,
        players: state.players.map(({id, name, role, position, yaw, hp, mana, head, hands}) =>
          ({id, name, role, position, yaw, hp, mana, ...(head ? {head} : {}), ...(hands ? {hands} : {})})),
        enemies: state.enemies.map(({id, position, yaw, hp}) => ({id, position, yaw, hp})),
        edits: state.edits, groves: state.groves, pendingStarfalls: state.pendingStarfalls,
        shrine: state.shrine, maxPlayers: MAX_PLAYERS});
    },
    checkpoint() { return copy(state); },
  };
  return api;
}

function liftActors(state) {
  for (const actor of [...state.players, ...state.enemies])
    actor.position[1] = Math.max(actor.position[1], terrainHeight(state, actor.position[0], actor.position[2]));
}

export function createSimulation(options) { return instantiate(newState(options)); }
export function loadSimulation(saved) {
  // Validate every nested gameplay field before it can enter the simulation loop.
  if (!record(saved) || saved.version !== 1 || !Number.isSafeInteger(saved.tick) || saved.tick < 0 ||
      !Number.isSafeInteger(saved.idCounter) || saved.idCounter < 0 ||
      !Array.isArray(saved.players) || !Array.isArray(saved.enemies) || !Array.isArray(saved.edits) ||
      !Array.isArray(saved.groves) || !Array.isArray(saved.pendingStarfalls) ||
      saved.players.length > MAX_PLAYERS || saved.enemies.length > MAX_WORLD ||
      saved.edits.length + saved.pendingStarfalls.length > MAX_WORLD || saved.groves.length > MAX_WORLD ||
      saved.pendingStarfalls.length > 8)
    throw Error('Invalid simulation checkpoint');
  const ids = new Set();
  const unique = id => { if (!validId(id) || id === 'shrine' || ids.has(id)) return false; ids.add(id); return true; };
  const validXZ = item => finite(item.x) && finite(item.z) && Math.abs(item.x) <= BOUND && Math.abs(item.z) <= BOUND;
  for (const p of saved.players) {
    if (!record(p) || !unique(p.id) || typeof p.name !== 'string' || !p.name || p.name.length > 24 ||
        !['hero', 'god'].includes(p.role) || !validPosition(p.position) || !finite(p.yaw) || Math.abs(p.yaw) > Math.PI + 0.000001 ||
        !finite(p.hp) || p.hp <= 0 || p.hp > 100 || !finite(p.mana) || p.mana < 0 || p.mana > 100 ||
        !Array.isArray(p.move) || p.move.length !== 2 || !p.move.every(n => finite(n) && Math.abs(n) <= 1) ||
        Math.hypot(...p.move) > 1.000001 || (p.role === 'god' && Math.hypot(...p.move) > 0) ||
        !finite(p.vy) || Math.abs(p.vy) > 100 ||
        !validTick(p.inputTick, saved.tick) || !validTick(p.attackTick, saved.tick) ||
        !validTick(p.castTick, saved.tick) || !validTick(p.roleTick, saved.tick) ||
        !Number.isSafeInteger(p.seq) || p.seq < 0 ||
        (p.head !== undefined && !pose(p.head)) ||
        (p.hands !== undefined && (!Array.isArray(p.hands) || p.hands.length > 2 || !p.hands.every(h => pose(h)))))
      throw Error('Invalid simulation player');
  }
  for (const e of saved.enemies) {
    if (!record(e) || !unique(e.id) || !validPosition(e.position) || !finite(e.yaw) || Math.abs(e.yaw) > Math.PI + 0.000001 ||
        !finite(e.hp) || e.hp <= 0 || e.hp > 100 || !validTick(e.attackTick, saved.tick))
      throw Error('Invalid simulation enemy');
  }
  for (const e of saved.edits) {
    if (!record(e) || !unique(e.id) || !validXZ(e) ||
        !((e.kind === 'raise' && e.radius === 6 && e.height === 2) ||
          (e.kind === 'starfall' && e.radius === 5 && e.height === -1)))
      throw Error('Invalid simulation edit');
  }
  for (const g of saved.groves) {
    if (!record(g) || !unique(g.id) || !validXZ(g)) throw Error('Invalid simulation grove');
  }
  for (const pending of saved.pendingStarfalls) {
    if (!record(pending) || !unique(pending.id) || !validXZ(pending) || pending.radius !== 5 ||
        !validTick(pending.impactTick, saved.tick, saved.tick + 1, 48) || pending.impactTick <= saved.tick)
      throw Error('Invalid simulation Starfall');
  }
  const shrine = saved.shrine;
  if (!record(shrine) || !validPosition(shrine.position) || shrine.position[0] !== 0 || shrine.position[2] !== 0 ||
      shrine.position[1] !== baseHeight(0, 0) || shrine.maxHp !== 100 || !finite(shrine.hp) ||
      shrine.hp < 0 || shrine.hp > 100 || !validTick(shrine.disabledUntil, saved.tick, 0, 480) ||
      (shrine.hp === 0 && shrine.disabledUntil <= saved.tick))
    throw Error('Invalid simulation shrine');
  const state = newState({room: saved.room, seed: saved.seed});
  state.tick = saved.tick;
  state.idCounter = saved.idCounter;
  state.players = copy(saved.players).map(p => ({id: p.id, name: p.name, role: p.role, position: p.position,
    yaw: p.yaw, hp: p.hp, mana: p.mana, move: p.move, vy: p.vy, inputTick: p.inputTick,
    attackTick: p.attackTick, castTick: p.castTick, roleTick: p.roleTick, seq: p.seq,
    ...(p.head ? {head: p.head} : {}), ...(p.hands ? {hands: p.hands} : {})}));
  state.enemies = copy(saved.enemies).map(({id, position, yaw, hp, attackTick}) => ({id, position, yaw, hp, attackTick}));
  state.edits = copy(saved.edits); state.groves = copy(saved.groves);
  state.pendingStarfalls = copy(saved.pendingStarfalls);
  state.shrine = copy(saved.shrine); // Includes break/restore timer.
  return instantiate(state);
}
