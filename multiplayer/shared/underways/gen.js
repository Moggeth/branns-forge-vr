// The Underways: seeded dungeon generation. Pure and deterministic: no clocks, DOM, Math.random or saved state.
// Every peer regenerates the same dungeon from (seed, style, depth); saves keep only progress (shared/underways/rules.js).
//
// Pacing first, geometry second. A dungeon is a plan of beats along a spine with side branches:
//   entry (safe, sets the scene) > teach (the style's hazard, alone, low stakes) > fights that build (the hazard joins
//   in) > a breather with treasure on a side branch > the key on a guarded side branch > a locked gate on the spine >
//   a shrine to rest at > the finale (a crowned guardian, a hoard and the way out).
// Rooms are then fitted onto a tile grid in that order, each one a straight corridor away from the room before it, so
// the map reads like the plan: one way on, side doors are optional, the gate is in plain sight before its key.
//
// Local frame: metres from the dungeon's centre, x east, z south (tile i,j centre at ((i-G/2+.5)*TILE, (j-G/2+.5)*TILE)).
export const TILE = 2;           // metres per tile
export const GRID = 64;          // tiles per side (128 m)
export const HALF = GRID * TILE / 2;
export const UNDERWAY_STYLES = Object.freeze(['mine', 'crypt', 'keep']);

// ---- Deterministic randomness: a string hash seeds a small PRNG (sfc32). One stream per dungeon, in a fixed order.
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) for (const c of String(part) + '\u0001') { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
function rngFor(seed) {
  let a = hashSeed(seed, 'a'), b = hashSeed(seed, 'b'), c = hashSeed(seed, 'c'), d = hashSeed(seed, 'd');
  const next = () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = c << 21 | c >>> 11; d = d + 1 | 0; t = t + d | 0; c = c + t | 0; return (t >>> 0) / 4294967296; };
  for (let i = 0; i < 12; i++) next();
  const r = () => next();
  r.range = (lo, hi) => lo + (hi - lo) * next();
  r.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  r.pick = list => list[Math.floor(next() * list.length)];
  r.chance = p => next() < p;
  r.shuffle = list => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  return r;
}

// ---- Style data: shapes, sizes, foes, hazards, props and the words for its story.
export const STYLE = Object.freeze({
  mine: Object.freeze({
    label: 'Mine', corridor: 2, tunnelCeil: 3.4, roomCeil: [5.5, 8], drop: [.5, 1.1], cave: true,
    foes: Object.freeze({minor: 'skeleton', major: 'golem'}), hazards: Object.freeze(['rockfall', 'flame']),
    names: Object.freeze({first: ['Glimmer', 'Tinker', 'Rumble', 'Copperpot', 'Muddle', 'Biscuit', 'Dimwick', 'Pebblesnout'],
      second: ['Delve', 'Deep', 'Shaft', 'Diggings', 'Hollow', 'Workings'], number: true}),
  }),
  crypt: Object.freeze({
    label: 'Crypt', corridor: 2, tunnelCeil: 3.2, roomCeil: [4.6, 6.2], drop: [.6, 1], cave: false,
    foes: Object.freeze({minor: 'skeleton', major: 'golem'}), hazards: Object.freeze(['spikes', 'flame']),
    names: Object.freeze({first: ['Old Pell', 'Auntie Brindle', 'Sir Wobbles', 'the Mumbling Abbot', 'Lord Fennick', 'Granny Thimble'],
      second: ['Vaults', 'Catacombs', 'Crypt', 'Ossuary', 'Barrows']}),
  }),
  keep: Object.freeze({
    label: 'Sunken Keep', corridor: 3, tunnelCeil: 4.2, roomCeil: [6, 8], drop: [.3, .8], cave: false,
    foes: Object.freeze({minor: 'skeleton', major: 'golem'}), hazards: Object.freeze(['spikes', 'rockfall']),
    names: Object.freeze({first: ['Lady Marrow', 'King Bramblebeard', 'the Pudding Baron', 'Duchess Quill', 'Old King Cobble'],
      second: ['Sunken Keep', 'Drowned Hall', 'Rootbound Keep', 'Hollow Bastion']}),
  }),
});

// Room templates per beat: size range in tiles [w, h] and what the beat asks of the room.
const BEATS = Object.freeze({
  entry: {size: [[6, 7], [6, 7]]},
  teach: {size: [[7, 8], [9, 11]]},
  fight: {size: [[8, 10], [9, 11]]},
  brawl: {size: [[10, 12], [10, 12]]},
  treasure: {size: [[5, 6], [5, 6]]},
  key: {size: [[7, 8], [7, 8]]},
  rest: {size: [[6, 7], [6, 7]]},
  story: {size: [[6, 7], [6, 8]]},
  finale: {size: [[13, 14], [13, 15]]},
});
const DIRS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]); // north (toward -z), east, south, west

/** The beat plan: spine beats in order and side branches hung off spine indices. */
export function pacingPlan(depth = 1) {
  const spine = ['entry', 'teach', 'fight'];
  for (let i = 1; i < depth; i++) spine.push('fight');
  spine.push('brawl', 'rest', 'finale');
  // The gate stands on the corridor into the rest shrine; the key branch hangs off the brawl before it, the treasure
  // breather off the teaching room, and a story room off the first fight.
  const gateBefore = spine.indexOf('rest');
  const branches = [{beat: 'treasure', from: 1}, {beat: 'story', from: 2}, {beat: 'key', from: gateBefore - 1}];
  if (depth >= 2) branches.push({beat: 'treasure', from: gateBefore - 2});
  return {spine, branches, gateBefore};
}

const cache = new Map();
/** The full dungeon for this seed. Cached: callers must treat the result as read-only. */
export function generateUnderway(seed, {style = 'mine', depth = 1} = {}) {
  if (!UNDERWAY_STYLES.includes(style)) style = 'mine';
  depth = Math.max(1, Math.min(4, Math.floor(depth) || 1));
  const key = `${seed}|${style}|${depth}`;
  if (cache.has(key)) return cache.get(key);
  let layout = null;
  for (let attempt = 0; attempt < 40 && !layout; attempt++) layout = tryGenerate(seed, style, depth, attempt);
  if (!layout) throw Error('Underway generation failed');
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  cache.set(key, layout);
  return layout;
}

function tryGenerate(seed, style, depth, attempt) {
  const S = STYLE[style], r = rngFor(`${seed}|${style}|${depth}|${attempt}`), plan = pacingPlan(depth);
  const rooms = [], corridors = [];
  const overlaps = (a, pad) => rooms.some(b => a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.y0 - pad <= b.y1 && a.y1 + pad >= b.y0);
  const corridorHits = (c, skip) => rooms.some(b => !skip.includes(b) && c.x0 <= b.x1 + 1 && c.x1 >= b.x0 - 1 && c.y0 <= b.y1 + 1 && c.y1 >= b.y0 - 1)
    || corridors.some(o => c.x0 <= o.x1 + 1 && c.x1 >= o.x0 - 1 && c.y0 <= o.y1 + 1 && c.y1 >= o.y0 - 1);
  const inside = a => a.x0 >= 2 && a.y0 >= 2 && a.x1 <= GRID - 3 && a.y1 <= GRID - 3;
  const sizeOf = beat => { const [[w0, w1], [h0, h1]] = BEATS[beat].size; return [r.int(w0, w1), r.int(h0, h1)]; };

  // Entry near the south edge, facing north into the dungeon.
  {
    const [w, h] = sizeOf('entry'), x0 = Math.floor(GRID / 2 - w / 2) + r.int(-6, 6), y0 = GRID - 4 - h;
    rooms.push(room(0, 'entry', x0, y0, w, h, -1, true)); rooms[0].spineIndex = 0;
  }
  // Grow a room off `from` through one of its sides; returns the new room or null.
  const attach = (from, beat, spine, prefer) => {
    const [w, h] = sizeOf(beat), w2 = Math.max(S.corridor, 2);
    const dirs = prefer ? [prefer, ...r.shuffle(DIRS.filter(d => d !== prefer))] : r.shuffle(DIRS);
    for (const dir of dirs) for (let tries = 0; tries < 6; tries++) {
      if (from.doors.some(d => d.dir === DIRS.indexOf(dir))) break; // one door per side keeps walls readable
      const len = r.int(spine ? 3 : 2, spine ? 7 : 5), [dx, dy] = dir;
      let x0, y0, cx0, cy0, cx1, cy1;
      if (dx === 0) { // north/south: corridor runs along y
        const lo = Math.max(from.x0 + 1, 0), hi = from.x1 - w2; if (hi < lo) continue;
        const cx = r.int(lo, hi); cx0 = cx; cx1 = cx + w2 - 1;
        if (dy < 0) { cy1 = from.y0 - 1; cy0 = cy1 - len + 1; y0 = cy0 - h; } else { cy0 = from.y1 + 1; cy1 = cy0 + len - 1; y0 = cy1 + 1; }
        x0 = r.int(cx1 - w + 2, cx0 - 1);
      } else {
        const lo = from.y0 + 1, hi = from.y1 - w2; if (hi < lo) continue;
        const cy = r.int(lo, hi); cy0 = cy; cy1 = cy + w2 - 1;
        if (dx < 0) { cx1 = from.x0 - 1; cx0 = cx1 - len + 1; x0 = cx0 - w; } else { cx0 = from.x1 + 1; cx1 = cx0 + len - 1; x0 = cx1 + 1; }
        y0 = r.int(cy1 - h + 2, cy0 - 1);
      }
      const cand = {x0, y0, x1: x0 + w - 1, y1: y0 + h - 1};
      const corr = {x0: cx0, y0: cy0, x1: cx1, y1: cy1};
      if (!inside(cand) || overlaps(cand, 2) || corridorHits(corr, [from])) continue;
      const next = room(rooms.length, beat, x0, y0, w, h, from.id, spine);
      const c = {id: corridors.length, a: from.id, b: next.id, ...corr, dir: DIRS.indexOf(dir), axis: dx === 0 ? 'z' : 'x', len};
      from.doors.push({dir: DIRS.indexOf(dir), to: next.id, corridor: c.id});
      next.doors.push({dir: (DIRS.indexOf(dir) + 2) % 4, to: from.id, corridor: c.id});
      rooms.push(next); corridors.push(c);
      return next;
    }
    return null;
  };
  // Spine: head generally north (away from the entrance), wandering east and west.
  let heading = DIRS[0];
  for (let i = 1; i < plan.spine.length; i++) {
    const beat = plan.spine[i], prev = rooms.find(q => q.spineIndex === i - 1);
    const prefer = r.chance(.55) ? DIRS[0] : heading;
    const next = attach(prev, beat, true, prefer);
    if (!next) return null;
    next.spineIndex = i;
    heading = r.chance(.5) ? DIRS[r.pick([1, 3])] : DIRS[0];
  }
  for (const b of plan.branches) {
    const host = rooms.find(q => q.spineIndex === b.from);
    const next = attach(host, b.beat, false, null);
    if (!next) return null;
  }

  // ---- Tiles: 0 rock, 1 floor. Rooms fill their rect (caves get a ragged ellipse), corridors their strip.
  const tiles = new Uint8Array(GRID * GRID), roomOf = new Int16Array(GRID * GRID).fill(-1), corrOf = new Int16Array(GRID * GRID).fill(-1);
  const at = (i, j) => j * GRID + i;
  for (const q of rooms) {
    const cave = S.cave && q.beat !== 'entry';
    const cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2, rx = (q.x1 - q.x0) / 2 + .5, ry = (q.y1 - q.y0) / 2 + .5, phase = r() * 6.283, wob = r.range(.12, .2);
    for (let j = q.y0; j <= q.y1; j++) for (let i = q.x0; i <= q.x1; i++) {
      if (cave) {
        const dx = (i - cx) / rx, dy = (j - cy) / ry, a = Math.atan2(dy, dx), rad = 1 - wob * (.6 + .4 * Math.sin(a * 3 + phase) * Math.cos(a * 2 - phase * .7));
        if (Math.hypot(dx, dy) > rad + .18) continue;
      }
      tiles[at(i, j)] = 1; roomOf[at(i, j)] = q.id;
    }
  }
  for (const c of corridors) for (let j = c.y0; j <= c.y1; j++) for (let i = c.x0; i <= c.x1; i++) { tiles[at(i, j)] = 1; if (roomOf[at(i, j)] < 0) corrOf[at(i, j)] = c.id; }
  // A cave's ragged edge can leave a corridor mouth short of the floor: carve from each mouth to the room's centre.
  if (S.cave) for (const c of corridors) for (const id of [c.a, c.b]) {
    const q = rooms[id], cx = Math.round((q.x0 + q.x1) / 2), cy = Math.round((q.y0 + q.y1) / 2);
    const mx = c.axis === 'z' ? c.x0 : (id === c.a) === (c.dir === 1) ? (c.dir === 1 ? c.x0 - 1 : c.x1 + 1) : (c.dir === 1 ? c.x1 + 1 : c.x0 - 1);
    const my = c.axis === 'x' ? c.y0 : (id === c.a) === (c.dir === 2) ? (c.dir === 2 ? c.y0 - 1 : c.y1 + 1) : (c.dir === 2 ? c.y1 + 1 : c.y0 - 1);
    const width = c.axis === 'z' ? c.x1 - c.x0 + 1 : c.y1 - c.y0 + 1;
    let i = mx, j = my;
    for (let guard = 0; guard < 40 && !(Math.abs(i - cx) <= 1 && Math.abs(j - cy) <= 1); guard++) {
      for (let w = 0; w < width; w++) { const ti = c.axis === 'z' ? i + w : i, tj = c.axis === 'x' ? j + w : j; if (ti >= q.x0 && ti <= q.x1 && tj >= q.y0 && tj <= q.y1 && !tiles[at(ti, tj)]) { tiles[at(ti, tj)] = 1; roomOf[at(ti, tj)] = q.id; } }
      if (Math.abs(i - cx) > Math.abs(j - cy)) i += Math.sign(cx - i); else j += Math.sign(cy - j);
    }
  }

  // ---- Heights: the spine descends room by room; branches sit near their host; corridors ramp between their ends.
  for (const q of rooms) {
    if (q.id === 0) { q.floor = 0; continue; }
    const host = rooms[q.parent];
    q.floor = q.spine ? host.floor - r.range(...S.drop) : host.floor + r.range(-.35, .35);
    if (q.beat === 'finale') q.floor = host.floor - S.drop[1] * 1.4;
    q.ceil = r.range(...S.roomCeil) + (q.beat === 'finale' ? 2.5 : q.beat === 'brawl' ? 1 : 0);
  }
  rooms[0].ceil = r.range(...S.roomCeil);
  for (const q of rooms) q.floor = Math.round(q.floor * 100) / 100, q.ceil = Math.round(q.ceil * 100) / 100;
  for (const c of corridors) { c.floorA = rooms[c.a].floor; c.floorB = rooms[c.b].floor; c.ceil = S.tunnelCeil; }

  const dungeon = {
    seed, style, depth, grid: GRID, tile: TILE, tiles, roomOf, corrOf, rooms, corridors, plan,
    name: nameFor(S, r), gate: null, key: null, encounters: [], hazards: [], chests: [], props: [], vignettes: [], lights: [], colliders: [],
  };
  dungeon.entry = entrySpot(dungeon);
  dress(dungeon, r);
  Object.freeze(dungeon.rooms); Object.freeze(dungeon.corridors);
  return dungeon;
}

function room(id, beat, x0, y0, w, h, parent, spine) {
  return {id, beat, x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, w, h, parent, spine, doors: [], floor: 0, ceil: 5};
}
const center = q => [((q.x0 + q.x1 + 1) / 2 - GRID / 2) * TILE, ((q.y0 + q.y1 + 1) / 2 - GRID / 2) * TILE];
export const roomCenter = center;
/** Local metres of a tile centre. */
export const tileCenter = (i, j) => [(i - GRID / 2 + .5) * TILE, (j - GRID / 2 + .5) * TILE];
/** Tile under a local point (may be off-grid). */
export const tileAt = (x, z) => [Math.floor(x / TILE + GRID / 2), Math.floor(z / TILE + GRID / 2)];
export const roomBounds = q => ({x0: (q.x0 - GRID / 2) * TILE, z0: (q.y0 - GRID / 2) * TILE, x1: (q.x1 + 1 - GRID / 2) * TILE, z1: (q.y1 + 1 - GRID / 2) * TILE});

/** Is the local tile floor? (Doors and gates are handled by the rules.) */
export function floorTile(d, i, j) { return i >= 0 && j >= 0 && i < GRID && j < GRID && d.tiles[j * GRID + i] === 1; }

/** Walking height at a local point: flat rooms, corridors ramp linearly from one end to the other. */
export function floorHeight(d, x, z) {
  const [i, j] = tileAt(x, z);
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 0;
  const k = j * GRID + i, ro = d.roomOf[k];
  if (ro >= 0) return d.rooms[ro].floor;
  const co = d.corrOf[k];
  if (co >= 0) return corridorHeight(d.corridors[co], x, z);
  // Rock: the nearest floor's height (walkers never stand here; renderers may sample it at wall feet).
  for (let rad = 1; rad < 4; rad++) for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
    const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GRID || jj >= GRID) continue;
    const kk = jj * GRID + ii; if (d.roomOf[kk] >= 0) return d.rooms[d.roomOf[kk]].floor; if (d.corrOf[kk] >= 0) return corridorHeight(d.corridors[d.corrOf[kk]], x, z);
  }
  return 0;
}
function corridorHeight(c, x, z) {
  // Along the corridor from end a (the room it grew from) to end b, eased so the ramp meets each floor level.
  const lo = c.axis === 'z' ? (c.y0 - GRID / 2) * TILE : (c.x0 - GRID / 2) * TILE, hi = c.axis === 'z' ? (c.y1 + 1 - GRID / 2) * TILE : (c.x1 + 1 - GRID / 2) * TILE;
  const s = c.axis === 'z' ? z : x;
  let t = Math.max(0, Math.min(1, (s - lo) / (hi - lo)));
  if (c.dir === 0 || c.dir === 3) t = 1 - t; // grew toward -z or -x: end a is at the high coordinate
  t = t * t * (3 - 2 * t);
  return c.floorA + (c.floorB - c.floorA) * t;
}
/** Ceiling height above the floor at a local point. */
export function ceilingAt(d, x, z) {
  const [i, j] = tileAt(x, z);
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 3;
  const k = j * GRID + i;
  if (d.roomOf[k] >= 0) return d.rooms[d.roomOf[k]].ceil;
  if (d.corrOf[k] >= 0) return d.corridors[d.corrOf[k]].ceil;
  return 3;
}

function entrySpot(d) {
  const q = d.rooms[0], [cx, cz] = center(q);
  return {x: cx, z: cz + (q.h / 2 - 1.5) * TILE, yaw: 0}; // near the south wall, looking north (yaw 0 faces -z)
}

function nameFor(S, r) {
  const N = S.names, first = r.pick(N.first), second = r.pick(N.second);
  if (N.number) return `${first} ${second} No. ${r.int(2, 19)}`;
  return `The ${second} of ${first}`;
}

// ---- Dressing: encounters, hazards, gate and key, chests, story vignettes, props and light sources.
const LORE = Object.freeze({
  mine: Object.freeze({
    entry: ['A brass sign: "MIND YOUR HEAD. MIND YOUR TOES. MIND YOUR MANNERS." Someone has added "MIND THE GOLEMS."',
      'Chalked on a beam: "Day 41. Struck crystal. Struck it again. It struck back."'],
    story: ['A lost miner\'s camp: a cold kettle, a bedroll and a half-written letter. "Dear Mum, the rocks here have opinions."',
      'Twelve tiny pickaxes hang on hooks, smallest to largest. The thirteenth hook is empty and very, very big.'],
    treasure: ['A strongbox stamped GLIMMER & SONS. The lock was picked from the inside.'],
    key: ['The foreman\'s office. A ledger reads: "Gate key kept by the Big Lad. Do NOT wake the Big Lad."'],
    rest: ['A miners\' chapel to the Lantern Saint. The candles relight themselves when you are kind to them.'],
    finale: ['The mother lode. It glitters. It grumbles. It stands up.'],
  }),
  crypt: Object.freeze({
    entry: ['A welcome mat. It says "WIPE YOUR BONES."', 'A carved notice: "Visiting hours: forever. Please do not feed the dead."'],
    story: ['A banquet table set for twelve. Eleven skeletons sit very politely. One chair is pushed back, as if someone just left to look for you.',
      'A choir loft. The hymn books are open at "Rattle Me Gently".'],
    treasure: ['Grave goods, neatly labelled: "Mine." "Also mine." "Ask first."'],
    key: ['The sexton\'s lodge. A note on the hook: "Gate key: with the Warden. The Warden does not share."'],
    rest: ['A quiet chapel. A stone angel holds out a bowl of warm light.'],
    finale: ['The founder\'s tomb. The lid is already off.'],
  }),
  keep: Object.freeze({
    entry: ['The keep sank in a single afternoon. The bell is still ringing for supper.', 'A portrait of a very proud baron, hung upside down by the roots.'],
    story: ['The great kitchen. A pudding the size of a cart has set like stone. It has been set for three hundred years.',
      'The armoury. Every helmet has a name painted inside. Most of them are "Gerald".'],
    treasure: ['The treasury, flooded to the ankles. The coins are shy and hide under the water.'],
    key: ['The castellan\'s study. "Gate key on the Warden\'s belt. Mind the belt; it bites."'],
    rest: ['A garden courtyard where roots have broken the roof. A shaft of old daylight falls on a stone bench.'],
    finale: ['The throne room. Something on the throne has been waiting very patiently.'],
  }),
});

function dress(d, r) {
  const S = STYLE[d.style], lore = LORE[d.style];
  const local = (i, j) => tileCenter(i, j);
  const floorTiles = q => { const out = []; for (let j = q.y0; j <= q.y1; j++) for (let i = q.x0; i <= q.x1; i++) if (d.roomOf[j * GRID + i] === q.id) out.push([i, j]); return out; };
  // Tiles at least `m` tiles away from rock and from door mouths: safe spots for things that must not block the way.
  const interior = (q, m = 1) => floorTiles(q).filter(([i, j]) => {
    for (let dj = -m; dj <= m; dj++) for (let di = -m; di <= m; di++) if (!floorTile(d, i + di, j + dj)) return false;
    return true;
  });
  // The walking line through a room: from the door it was entered by to the door it is left by (or its centre).
  const doorPoint = (q, door) => {
    const c = d.corridors[door.corridor], w = (c.axis === 'z' ? c.x1 - c.x0 + 1 : c.y1 - c.y0 + 1) * TILE;
    const [mx0, mz0] = tileCenter(c.x0, c.y0), mx = mx0 + (c.axis === 'z' ? w / 2 - TILE / 2 : 0), mz = mz0 + (c.axis === 'x' ? w / 2 - TILE / 2 : 0);
    const b = roomBounds(q);
    if (door.dir === 0) return [mx, b.z0]; if (door.dir === 2) return [mx, b.z1]; if (door.dir === 1) return [b.x1, mz]; return [b.x0, mz];
  };
  d.doorPoint = (roomId, door) => doorPoint(d.rooms[roomId], door);
  let n = 0;
  const id = prefix => `${prefix}${n++}`;
  const usedSpots = [];
  const clear = (x, z, rad) => usedSpots.every(([ux, uz, ur]) => Math.hypot(ux - x, uz - z) > ur + rad);
  const claim = (x, z, rad) => usedSpots.push([x, z, rad]);
  // Keep every door's walking lane clear of solid props.
  for (const q of d.rooms) for (const door of q.doors) { const [x, z] = doorPoint(q, door); claim(x, z, 2.6); }

  const depthScale = 1 + (d.depth - 1) * .35;
  for (const q of d.rooms) {
    const [cx, cz] = center(q), inner = interior(q, 1), spots = r.shuffle(inner);
    const take = (rad = 1) => { for (const [i, j] of spots) { const [x, z] = local(i, j); if (clear(x, z, rad)) { claim(x, z, rad); return [x, z]; } } return null; };
    const inDoor = q.doors.find(dr => dr.to === q.parent), outDoor = q.doors.find(dr => dr.to !== q.parent && d.rooms[dr.to].spine) || q.doors.find(dr => dr.to !== q.parent);
    const pIn = inDoor ? doorPoint(q, inDoor) : [cx, cz + q.h], pOut = outDoor ? doorPoint(q, outDoor) : [cx, cz];
    q.path = [pIn, [cx, cz], pOut];
    q.lore = lore[q.beat] ? r.pick(lore[q.beat]) : null;

    // Encounters: who wakes when a Hero steps in. Counts climb along the spine and with depth.
    const wave = [];
    if (q.beat === 'teach') wave.push(...Array(1).fill(S.foes.minor));
    if (q.beat === 'fight') wave.push(...Array(Math.round((2 + (q.spineIndex > 2 ? 1 : 0)) * depthScale)).fill(S.foes.minor));
    if (q.beat === 'brawl') { wave.push(S.foes.major); wave.push(...Array(Math.round(3 * depthScale)).fill(S.foes.minor)); }
    if (q.beat === 'key') { wave.push(S.foes.major); wave.push(...Array(Math.round(1 * depthScale)).fill(S.foes.minor)); }
    if (q.beat === 'treasure' && r.chance(.5)) wave.push(S.foes.minor);
    for (const kind of wave) { const p = take(kind === 'golem' ? 1.4 : .9); if (p) d.encounters.push({id: id('foe'), room: q.id, kind, x: p[0], z: p[1], yaw: Math.atan2(-(pIn[0] - p[0]), -(pIn[1] - p[1])), guard: q.beat === 'key'}); }
    if (q.beat === 'finale') {
      // The crowned guardian waits mid-room facing the way in; its retinue wakes in two waves as it weakens.
      const bz = cz - q.h * .1 * TILE;
      d.encounters.push({id: id('boss'), room: q.id, kind: 'golem', x: cx, z: bz, yaw: Math.atan2(-(pIn[0] - cx), -(pIn[1] - bz)), boss: true});
      claim(cx, bz, 3);
      for (const w of [1, 2]) for (let k = 0; k < Math.round((1 + w) * depthScale); k++) { const p = take(.9); if (p) d.encounters.push({id: id('add'), room: q.id, kind: S.foes.minor, x: p[0], z: p[1], yaw: 0, wave: w}); }
    }

    // Hazards: the teaching room lays the style's first hazard across the way through on an even, readable rhythm.
    const hazardRoom = q.beat === 'teach' ? S.hazards[0] : q.beat === 'fight' && q.spineIndex >= 2 ? S.hazards[1] : q.beat === 'brawl' ? S.hazards[0] : q.beat === 'finale' ? S.hazards[1] : null;
    if (hazardRoom) layHazards(d, q, hazardRoom, r, id, {interior: inner, claim, clear, teach: q.beat === 'teach'});

    // Chests, key, rest shrine and the hoard.
    if (q.beat === 'treasure') { const p = take(1.2) || [cx, cz]; d.chests.push({id: id('chest'), room: q.id, x: p[0], z: p[1], yaw: Math.atan2(-(pIn[0] - p[0]), -(pIn[1] - p[1])), tier: 1}); for (let k = 0; k < 3; k++) { const u = take(.6); if (u) d.chests.push({id: id('urn'), room: q.id, x: u[0], z: u[1], yaw: r() * 6.28, tier: 0}); } }
    if (q.beat === 'story' || q.beat === 'fight') for (let k = 0; k < (q.beat === 'story' ? 2 : 1); k++) { const u = take(.6); if (u) d.chests.push({id: id('urn'), room: q.id, x: u[0], z: u[1], yaw: r() * 6.28, tier: 0}); }
    if (q.beat === 'key') { claim(cx, cz, 1.2); d.key = {id: 'key', room: q.id, x: cx, z: cz}; }
    if (q.beat === 'rest') { claim(cx, cz, 1.4); d.shrine = {id: 'shrine', room: q.id, x: cx, z: cz}; }
    if (q.beat === 'finale') {
      const back = outDoor ? null : farWall(q, pIn), hx = back ? back[0] : cx, hz = back ? back[1] : cz - q.h * .35 * TILE;
      claim(hx, hz, 2);
      d.hoard = {id: 'hoard', room: q.id, x: hx, z: hz, yaw: Math.atan2(-(cx - hx), -(cz - hz))};
      d.exit = {id: 'exit', room: q.id, x: (hx + cx) / 2, z: (hz + cz) / 2 + 1.5};
    }
    if (q.beat === 'story') { const p = take(1.6) || [cx, cz]; d.vignettes.push({id: id('tale'), room: q.id, kind: `${d.style}-${r.int(0, 1)}`, x: p[0], z: p[1], yaw: r() * 6.28, lore: q.lore}); }
    if (q.beat === 'entry') d.vignettes.push({id: id('sign'), room: q.id, kind: `${d.style}-sign`, x: cx + (q.w / 2 - 1.2) * TILE * (r.chance(.5) ? 1 : -1), z: cz + (q.h / 2 - 1.6) * TILE, yaw: 0, lore: q.lore});

    propsFor(d, q, r, {interior: inner, claim, clear, take, id});
  }
  // The gate: across the corridor into the rest shrine (the first corridor past the key branch).
  const rest = d.rooms.find(q => q.beat === 'rest'), gc = d.corridors.find(c => c.b === rest.id);
  const [gx0, gz0] = tileCenter(gc.x0, gc.y0), [gx1, gz1] = tileCenter(gc.x1, gc.y1);
  d.gate = {id: 'gate', corridor: gc.id, axis: gc.axis, x: (gx0 + gx1) / 2, z: (gz0 + gz1) / 2, width: (gc.axis === 'z' ? gc.x1 - gc.x0 + 1 : gc.y1 - gc.y0 + 1) * TILE};
  // Gate bars sit at the corridor's middle; walkers on either side are blocked by a thin slab across it.
  d.gate.half = gc.axis === 'z' ? [d.gate.width / 2, .3] : [.3, d.gate.width / 2];
}

function farWall(q, from) {
  const [cx, cz] = center(q), dx = cx - from[0], dz = cz - from[1], l = Math.hypot(dx, dz) || 1;
  return [cx + dx / l * (Math.min(q.w, q.h) / 2 - 1.6) * TILE, cz + dz / l * (Math.min(q.w, q.h) / 2 - 1.6) * TILE];
}

// Hazard layouts. All are periodic on the shared tick (rules decide damage), so every peer sees the same rhythm.
//   spikes: plates in a row across the walking line; each pops for `on` ticks every `period`, staggered so a wave runs
//           across the row and there is always a gap to time.
//   flame:  vents in the floor along the walls that roar up in turn.
//   rockfall: marked patches of loose roof that drop rocks on a slow cycle (shadow and dust warn first).
function layHazards(d, q, type, r, id, {interior, claim}) {
  const [ax, az] = q.path[0], [bx, bz] = q.path[2], len = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / len, uz = (bz - az) / len;
  const near = (x, z) => interior.some(([i, j]) => { const [tx, tz] = tileCenter(i, j); return Math.abs(tx - x) < 1.01 && Math.abs(tz - z) < 1.01; });
  if (type === 'spikes') {
    const rows = q.beat === 'teach' ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      const t = (row + 1) / (rows + 1), mx = ax + (bx - ax) * t, mz = az + (bz - az) * t, period = r.pick([150, 180]), cells = [];
      for (let k = -6; k <= 6; k++) { const x = mx - uz * k * TILE, z = mz + ux * k * TILE; if (near(x, z)) cells.push([x, z, k]); }
      cells.forEach(([x, z, k], n) => { d.hazards.push({id: id('spike'), room: q.id, type, x, z, half: 1, period, on: 50, offset: Math.round(((k + 6) / 12) * period * .7) + row * 40}); claim(x, z, .9); void n; });
    }
  } else if (type === 'flame') {
    const count = q.beat === 'teach' ? 3 : 4, period = 200;
    const edge = interior.filter(([i, j]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => !floorTile(d, i + di * 2, j + dj * 2)));
    const picks = r.shuffle(edge).slice(0, count * 3);
    let placed = 0;
    for (const [i, j] of picks) {
      if (placed >= count) break;
      const [x, z] = tileCenter(i, j);
      if (d.hazards.some(h => h.room === q.id && Math.hypot(h.x - x, h.z - z) < 4)) continue;
      d.hazards.push({id: id('vent'), room: q.id, type, x, z, radius: 1.1, period, on: 70, offset: Math.round(placed / count * period)});
      claim(x, z, 1.2); placed++;
    }
  } else if (type === 'rockfall') {
    const count = q.beat === 'teach' ? 3 : 4, period = 300;
    for (let k = 0; k < count; k++) {
      const t = (k + 1) / (count + 1), side = (k % 2 ? 1 : -1) * r.range(1, 2.6);
      const x = ax + (bx - ax) * t - uz * side, z = az + (bz - az) * t + ux * side;
      if (!near(x, z)) continue;
      d.hazards.push({id: id('fall'), room: q.id, type, x, z, radius: 1.5, period, on: 12, warn: 80, offset: Math.round(k / count * period)});
      claim(x, z, 1.6);
    }
  }
}

// Props and light sources: what makes each style read at a glance. Solid ones add colliders (circles, local metres).
function propsFor(d, q, r, {interior, take, claim}) {
  const style = d.style, [cx, cz] = center(q), b = roomBounds(q);
  const add = (type, x, z, yaw = 0, scale = 1, extra = {}) => d.props.push({type, room: q.id, x, z, yaw, scale, ...extra});
  const solid = (x, z, rad) => d.colliders.push({x, z, r: rad});
  const light = (x, y, z, color, power = 1) => d.lights.push({x, y, z, color, power, room: q.id});
  const wallSpots = () => interior.filter(([i, j]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => !floorTile(d, i + di * 2, j + dj * 2)));
  const facingIn = (x, z) => Math.atan2(-(cx - x), -(cz - z));
  // Pillars in halls large enough to want them (crypt and keep): a symmetric double row.
  if (!STYLE[style].cave && q.w >= 8 && q.h >= 8 && ['fight', 'brawl', 'finale', 'story'].includes(q.beat)) {
    const ox = (q.w / 2 - 2.2) * TILE, oz = (q.h / 2 - 2.2) * TILE, rows = q.h >= 12 ? 3 : 2;
    for (const sx of [-1, 1]) for (let k = 0; k < rows; k++) {
      const x = cx + sx * ox, z = cz - oz + (2 * oz) * (rows === 1 ? .5 : k / (rows - 1));
      if (d.hazards.some(h => Math.hypot(h.x - x, h.z - z) < 1.6)) continue;
      add('pillar', x, z, 0, 1, {height: q.ceil}); solid(x, z, .62); claim(x, z, 1);
    }
  }
  // Wall lights: torches (crypt), lanterns on posts (mine), braziers (keep). A few per room, never in a doorway.
  const lights = r.shuffle(wallSpots()).filter(([i, j]) => { const [x, z] = tileCenter(i, j); return q.doors.every(dr => { const p = d.doorPoint(q.id, dr); return Math.hypot(p[0] - x, p[1] - z) > 3; }); });
  const want = Math.max(2, Math.round((q.w * q.h) / 22));
  const placed = [];
  for (const [i, j] of lights) {
    if (placed.length >= want) break;
    const [x, z] = tileCenter(i, j);
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 5)) continue;
    placed.push([x, z]);
    // push to the wall: toward the nearest rock
    let wx = x, wz = z; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const [ti, tj] = [i + di * 2, j + dj * 2]; if (!floorTile(d, ti, tj) && floorTile(d, i + di, j + dj)) { wx = x + di * TILE * .85; wz = z + dj * TILE * .85; break; } else if (!floorTile(d, i + di, j + dj)) { wx = x + di * TILE * .4; wz = z + dj * TILE * .4; break; } }
    const yaw = facingIn(wx, wz);
    if (style === 'crypt') { add('torch', wx, wz, yaw); light(wx, q.floor + 2.3, wz, 0xffa04a, 1); }
    else if (style === 'mine') { add('lantern', wx, wz, yaw); light(wx, q.floor + 2.1, wz, 0xffc070, .9); }
    else { add('brazier', wx, wz, yaw); light(wx, q.floor + 1.4, wz, 0xff9a50, 1.2); solid(wx, wz, .35); }
  }
  // Style dressing.
  if (style === 'mine') {
    // Crystal clusters glow along the cave walls; a cart and rails sit in the bigger caverns.
    const crystals = r.shuffle(wallSpots()).slice(0, Math.round(q.w * q.h / 14));
    for (const [i, j] of crystals) { const [x, z] = tileCenter(i, j); if (d.hazards.some(h => Math.hypot(h.x - x, h.z - z) < 1.8)) continue; const hue = r.pick([0x7fd9ff, 0xb48cff, 0x7fffd0]); add('crystal', x, z, r() * 6.28, r.range(.7, 1.5), {color: hue}); if (r.chance(.4)) light(x, q.floor + .8, z, hue, .5); }
    if (q.w * q.h >= 80) { const p = take(1.3); if (p) { add('cart', p[0], p[1], r.pick([0, Math.PI / 2])); solid(p[0], p[1], .9); } }
    for (let k = 0; k < 3; k++) { const p = take(.5); if (p) add(r.pick(['barrel', 'crate', 'rubble']), p[0], p[1], r() * 6.28, r.range(.85, 1.15)); }
    if (q.beat !== 'entry') for (let k = 0; k < 2; k++) { const p = take(.4); if (p) add('mushroom', p[0], p[1], r() * 6.28, r.range(.7, 1.3)); }
  } else if (style === 'crypt') {
    // Sarcophagi along the side walls of tomb rooms; candles in clusters; banners above the doors.
    if (['fight', 'teach', 'story', 'finale'].includes(q.beat)) for (const [i, j] of r.shuffle(wallSpots()).slice(0, 3)) { const [x, z] = tileCenter(i, j); if (d.hazards.some(h => Math.hypot(h.x - x, h.z - z) < 2)) continue; const yaw = facingIn(x, z); add('sarcophagus', x, z, yaw); solid(x, z, .8); claim(x, z, 1.2); }
    for (let k = 0; k < 3; k++) { const p = take(.4); if (p) { add('candles', p[0], p[1], r() * 6.28, r.range(.8, 1.2)); light(p[0], q.floor + .4, p[1], 0xffc068, .35); } }
    for (let k = 0; k < 2; k++) { const p = take(.4); if (p) add(r.pick(['bones', 'urnpile', 'rubble']), p[0], p[1], r() * 6.28); }
  } else {
    // Roots through the ceiling, banners, fallen masonry; the rest courtyard gets its shaft of daylight.
    for (let k = 0; k < Math.round(q.w * q.h / 30); k++) { const p = take(.5); if (p) add('roots', p[0], p[1], r() * 6.28, r.range(.8, 1.4), {height: q.ceil}); }
    for (let k = 0; k < 2; k++) { const p = take(.6); if (p) { add('masonry', p[0], p[1], r() * 6.28, r.range(.8, 1.2)); solid(p[0], p[1], .55); } }
    for (const [i, j] of r.shuffle(wallSpots()).slice(0, 2)) { const [x, z] = tileCenter(i, j); add('banner', x, z, facingIn(x, z)); }
    if (q.beat === 'rest') add('skyshaft', cx, cz, 0, 1, {height: q.ceil});
  }
  void b;
}
