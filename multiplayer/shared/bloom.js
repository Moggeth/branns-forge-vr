// Bloom: how much life the world holds. Groves, fruit eaten and foes the Heroes fell make it rise;
// each level unlocks more God spells. Pure and deterministic (authority state only, no clock or RNG).
export const BLOOM = Object.freeze({
  levels: [30, 90, 180], max: 999,
  grove: 2, wave: 3, apple: 3, skeleton: 1, golem: 3,
  // Every 30 s each living grove adds a point, up to 8.
  passiveTicks: 1800, passiveCap: 8,
  spring: {radius: 3, hpPerSecond: 4, ticks: 3600, cap: 8},
});

export const bloomLevel = points => BLOOM.levels.filter(n => (points || 0) >= n).length;
/** Points needed for the next level, or 0 when every level is open. */
export const nextBloom = points => BLOOM.levels.find(n => (points || 0) < n) || 0;

export function addBloom(state, amount, events, position = null) {
  if (!(amount > 0)) return;
  const before = state.bloom || 0, after = Math.min(BLOOM.max, before + Math.floor(amount));
  state.bloom = after;
  const level = bloomLevel(after);
  if (level > bloomLevel(before)) events?.push({kind: 'bloom_level', level, points: after, ...(position ? {position: [...position]} : {})});
}

/** Per tick: groves breathe Bloom, Life Springs heal the Heroes standing in them and dry up on time. */
export function stepBloom(state, events) {
  if (state.tick % BLOOM.passiveTicks === 0 && state.groves.length) addBloom(state, Math.min(BLOOM.passiveCap, state.groves.length), events);
  if (!state.springs?.length) return;
  const live = state.springs.filter(s => s.expireTick > state.tick);
  if (live.length !== state.springs.length) state.springs = live;
  for (const hero of state.players) {
    if (hero.role !== 'hero' || hero.hp >= 100) continue;
    if (live.some(s => Math.hypot(hero.position[0] - s.x, hero.position[2] - s.z) <= BLOOM.spring.radius)) hero.hp = Math.min(100, hero.hp + BLOOM.spring.hpPerSecond / 60);
  }
}

/** Save and snapshot restore. Older saves have neither field. */
export function restoreBloom(saved, ids) {
  const bloom = saved.bloom ?? 0, springs = saved.springs ?? [];
  if (!Number.isSafeInteger(bloom) || bloom < 0 || bloom > BLOOM.max) throw Error('Invalid Bloom');
  if (!Array.isArray(springs) || springs.length > BLOOM.spring.cap) throw Error('Invalid Life Springs');
  for (const s of springs) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.id) || ids.has(s.id) ||
        ![s.x, s.z].every(n => Number.isFinite(n) && Math.abs(n) <= 55) ||
        !Number.isSafeInteger(s.expireTick) || s.expireTick <= saved.tick || s.expireTick > saved.tick + BLOOM.spring.ticks) throw Error('Invalid Life Spring');
    ids.add(s.id);
  }
  return {bloom, springs: springs.map(({id, x, z, expireTick}) => ({id, x, z, expireTick}))};
}
