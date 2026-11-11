// Hero progression: XP, levels and weapon talents. Pure and deterministic (no clock, no RNG); the host owns every
// change, and snapshots carry xp, talents and the derived maxHp to everyone else.
//
// Levels come fast: a couple of skeletons reach level 2. Each level adds healthPerLevel to max health and
// damagePerLevel to every hero weapon hit, and earns one talent point to spend on any weapon's specialty.
import {itemBonus, validItems} from './hero-items.js';
export const HERO_LEVEL = Object.freeze({max: 10, baseHp: 100, healthPerLevel: .2, damagePerLevel: .2, ledger: 64});

// XP to climb from `level` to the next one: 30, 50, 70 … 190 (990 XP to reach level 10).
export const xpToNext = level => 30 + 20 * (level - 1);
const START = [0, 0];
for (let l = 2; l <= HERO_LEVEL.max; l++) START[l] = START[l - 1] + xpToNext(l - 1);
export const xpForLevel = level => START[Math.max(1, Math.min(HERO_LEVEL.max, level | 0))];
export const XP_MAX = xpForLevel(HERO_LEVEL.max);

// What a hero earns. Kills are credited to whoever landed the killing blow; harvest to whoever swung.
export const XP_REWARD = Object.freeze({skeleton: 20, golem: 60, ent: 45, stumpling: 8, kettlebelly: 30, bramblehog: 25, kegtoter: 18, tree: 10, ore: 6, meteor: 15});

// Two specialties per weapon (the hammer is not in yet). `ready: false` lists a specialty without letting anyone buy
// it yet (its weapon's thread turns it on when the effect ships).
export const TALENTS = Object.freeze({
  axe: Object.freeze({
    limbsplitter: Object.freeze({name: 'Limbsplitter', text: 'Every swing that lands on an arm, leg or head lops it clean off.'}),
    whirlwind: Object.freeze({name: 'Whirlwind', text: 'Your cleave becomes a full spin with 30% more reach, and recharges in 4 seconds instead of 6.'}),
  }),
  pick: Object.freeze({
    motherlode: Object.freeze({name: 'Motherlode', text: 'Ore cracks one strike sooner and drops twice as much.'}),
    geode: Object.freeze({name: 'Geode Burst', text: 'When your crystal wall ends it bursts into shards that hurt and hurl every foe beside it.'}),
  }),
  crossbow: Object.freeze({
    flock: Object.freeze({name: 'Golden Flock', text: 'The golden songbird comes three times as often.'}),
    skewer: Object.freeze({name: 'Skewer', text: 'Every bolt punches clean through up to three foes.'}),
  }),
  bow: Object.freeze({
    volley: Object.freeze({name: 'Ember Volley', text: 'A full draw looses three arrows in a fan.'}),
    firestorm: Object.freeze({name: 'Firestorm', text: 'Phoenix Flare recharges twice as fast and its blaze covers twice the ground.'}),
  }),
  flask: Object.freeze({
    firebomb: Object.freeze({name: 'Firebomb', text: 'A lit flask explodes where it lands, burning and throwing back every foe nearby.'}),
    tar: Object.freeze({name: 'Tar Pit', text: 'Spills are far bigger and slow every foe that wades through them.'}),
  }),
  wyrmspout: Object.freeze({
    flood: Object.freeze({name: 'Wyrmflood', text: 'A longer, bigger burst: more sticky fire per tank, thrown further.'}),
    cling: Object.freeze({name: 'Clinging Fire', text: 'Sticky fire clings to foes, burns twice as long and splashes onto their friends when they fall.'}),
  }),
});
export const TALENT_WEAPONS = Object.freeze(Object.keys(TALENTS));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function heroLevel(xp = 0) {
  let level = 1;
  while (level < HERO_LEVEL.max && xp >= START[level + 1]) level++;
  return level;
}
export const levelOf = p => heroLevel(p?.xp || 0);
export const heroMaxHp = p => Math.round(HERO_LEVEL.baseHp * (1 + HERO_LEVEL.healthPerLevel * (levelOf(p) - 1)) + itemBonus(p, 'hp'));
// God-cast damage is never scaled: a player's level belongs to their hero.
// Quartermaster items add their own share on top (shared/hero-items.js).
export const damageScale = p => p?.role === 'hero' ? (1 + HERO_LEVEL.damagePerLevel * (levelOf(p) - 1)) * (1 + itemBonus(p, 'damage')) : 1;
export const hasTalent = (p, weapon, id) => !!p?.talents?.[weapon]?.includes(id);
export const spentPoints = p => Object.values(p?.talents || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
export const talentPoints = p => Math.max(0, levelOf(p) - 1 - spentPoints(p));
/** Progress inside the current level, 0..1 (1 at the cap). */
export function levelProgress(xp = 0) {
  const level = heroLevel(xp);
  if (level >= HERO_LEVEL.max) return 1;
  return Math.max(0, Math.min(1, (xp - START[level]) / xpToNext(level)));
}

// World ledger: progress survives leaving and rejoining (and a resumed save, whose peers have new ids) by hero name.
const ledgerKey = name => { const k = typeof name === 'string' ? name.trim().toLowerCase().slice(0, 24) : ''; return k === '__proto__' ? '' : k; };
function remember(state, p) {
  const key = ledgerKey(p.name); if (!key) return;
  const ledger = state.heroLedger ??= {};
  if (!Object.hasOwn(ledger, key) && Object.keys(ledger).length >= HERO_LEVEL.ledger) {
    // Forget the least experienced hero who is not here.
    const here = new Set(state.players.map(q => ledgerKey(q.name)));
    const drop = Object.entries(ledger).filter(([k]) => !here.has(k)).sort((a, b) => a[1].xp - b[1].xp)[0];
    if (!drop) return; delete ledger[drop[0]];
  }
  ledger[key] = {xp: p.xp || 0, talents: structuredClone(p.talents || {}), ...(p.items?.length ? {items: [...p.items]} : {})};
}
/** A joining hero picks up the progress last recorded under their name, unless someone here already wears it. */
export function adoptProgress(state, p) {
  const key = ledgerKey(p.name), entry = key && state.heroLedger?.[key];
  p.xp = 0; p.talents = {}; p.items = [];
  if (!entry || state.players.some(q => q !== p && ledgerKey(q.name) === key)) return;
  p.xp = entry.xp; p.talents = structuredClone(entry.talents); p.items = [...(entry.items || [])];
}

/** Award XP to a hero. Emits level_up (with the new level) for each level crossed. */
export function grantXp(state, p, amount, events, position) {
  if (!p || p.role !== 'hero' || !finite(amount) || amount <= 0) return 0;
  const before = levelOf(p), xp = Math.min(XP_MAX, (p.xp || 0) + Math.round(amount));
  if (xp === (p.xp || 0)) return 0;
  p.xp = xp;
  const after = levelOf(p);
  if (after > before) {
    // Levelling up restores the hero to their new, larger health.
    p.hp = heroMaxHp(p);
    events?.push({kind: 'level_up', id: p.id, level: after, points: talentPoints(p), maxHp: p.hp, position: [...(position || p.position)]});
  }
  remember(state, p);
  return after - before;
}
export const killXp = enemy => XP_REWARD[enemy?.kind] ?? XP_REWARD.skeleton;

/** {action:'talent', weapon, talent} learns one specialty; {action:'talent', reset:true} refunds every point. */
export function talentAction(state, p, m) {
  const fail = code => ({ok: false, code, events: []});
  if (p.role !== 'hero') return fail('role_required');
  if (m.reset === true) {
    if (!spentPoints(p)) return fail('not_needed');
    p.talents = {}; remember(state, p);
    return {ok: true, events: [{kind: 'talent_reset', id: p.id, position: [...p.position]}]};
  }
  const spec = TALENTS[m.weapon]?.[m.talent];
  if (!spec || !Object.hasOwn(TALENTS, m.weapon) || !Object.hasOwn(TALENTS[m.weapon], m.talent)) return fail('invalid_talent');
  if (spec.ready === false) return fail('talent_coming_soon');
  if (hasTalent(p, m.weapon, m.talent)) return fail('already_learned');
  if (talentPoints(p) < 1) return fail('no_talent_points');
  (p.talents ??= {})[m.weapon] = [...(p.talents[m.weapon] || []), m.talent];
  remember(state, p);
  return {ok: true, events: [{kind: 'talent_learned', id: p.id, weapon: m.weapon, talent: m.talent, position: [...p.position]}]};
}

function validTalents(t, xp) {
  if (!record(t)) return false;
  let spent = 0;
  for (const [weapon, list] of Object.entries(t)) {
    if (!Object.hasOwn(TALENTS, weapon) || !Array.isArray(list) || new Set(list).size !== list.length ||
        !list.every(id => typeof id === 'string' && Object.hasOwn(TALENTS[weapon], id))) return false;
    spent += list.length;
  }
  return spent <= heroLevel(xp) - 1;
}
export const validXp = xp => Number.isSafeInteger(xp) && xp >= 0 && xp <= XP_MAX;
/** Save validation for a player's progress fields (both optional: older saves have neither). */
export const validProgress = p => (p.xp === undefined || validXp(p.xp)) && (p.talents === undefined || validTalents(p.talents, p.xp || 0)) && (p.items === undefined || validItems(p.items));
export const restoreProgress = p => ({xp: p.xp || 0, talents: Object.fromEntries(Object.entries(p.talents || {}).filter(([, l]) => l.length).map(([w, l]) => [w, [...l]])), items: [...(p.items || [])]});
export function restoreLedger(saved) {
  const ledger = saved.heroLedger;
  if (ledger === undefined) return {};
  if (!record(ledger) || Object.keys(ledger).length > HERO_LEVEL.ledger) throw Error('Invalid hero ledger');
  const out = {};
  for (const [key, entry] of Object.entries(ledger)) {
    if (!key || key.length > 24 || key !== ledgerKey(key) || !record(entry) || !validXp(entry.xp) || !validTalents(entry.talents, entry.xp) || (entry.items !== undefined && !validItems(entry.items))) throw Error('Invalid hero ledger');
    out[key] = restoreProgress(entry);
  }
  return out;
}
