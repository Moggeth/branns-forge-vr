// Expedition Roguelite progression that persists between runs, kept on this device (localStorage):
// banked Forge Embers, Hall of Embers unlock levels, the codex of things discovered, best runs and daily bests.
// Nothing here changes a run by itself: the Hall levels are sent to the run's host, which clamps and applies them.
import {HALL, HALL_IDS, cleanHall} from '../shared/run-boons.js';

const KEY = 'branns-forge.runs.v1';
const blank = () => ({embers: 0, lifetime: 0, hall: {}, credited: [], best: null, daily: {}, codex: {kinds: [], bosses: [], boons: []}, history: []});
const safeStore = {
  get() { try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; } },
  set(v) { try { globalThis.localStorage?.setItem(KEY, v); return true; } catch { return false; } },
};
const uniq = (list, add, max) => [...new Set([...(Array.isArray(list) ? list : []), ...add])].filter(v => typeof v === 'string').slice(-max);

export function loadRunMeta(store = safeStore) {
  try {
    const raw = JSON.parse(store.get() || 'null'); if (!raw || typeof raw !== 'object') return blank();
    const m = blank();
    m.embers = Number.isSafeInteger(raw.embers) && raw.embers >= 0 ? raw.embers : 0;
    m.lifetime = Number.isSafeInteger(raw.lifetime) && raw.lifetime >= 0 ? raw.lifetime : m.embers;
    m.hall = cleanHall(raw.hall);
    m.credited = uniq(raw.credited, [], 64);
    m.best = raw.best && typeof raw.best === 'object' ? raw.best : null;
    m.daily = raw.daily && typeof raw.daily === 'object' ? Object.fromEntries(Object.entries(raw.daily).slice(-30)) : {};
    for (const k of ['kinds', 'bosses', 'boons']) m.codex[k] = uniq(raw.codex?.[k], [], 64);
    m.history = Array.isArray(raw.history) ? raw.history.slice(-20) : [];
    return m;
  } catch { return blank(); }
}
export const saveRunMeta = (meta, store = safeStore) => store.set(JSON.stringify(meta));

/** Next Hall level's cost for an unlock, or null at the cap. */
export const hallCost = (meta, id) => { const lv = meta.hall[id] || 0; return lv < HALL[id].max ? HALL[id].costs[lv] : null; };
export function buyHall(meta, id) {
  if (!HALL_IDS.includes(id)) return {ok: false, code: 'unknown'};
  const cost = hallCost(meta, id);
  if (cost === null) return {ok: false, code: 'maxed'};
  if (meta.embers < cost) return {ok: false, code: 'too_poor', need: cost - meta.embers};
  meta.embers -= cost; meta.hall[id] = (meta.hall[id] || 0) + 1;
  return {ok: true, level: meta.hall[id], cost};
}

/** A stable id for one finished run, so a reload or a second end screen never pays the same run twice. */
export const runKey = (run, roomStart = '') => `${run.format}:${run.seed}:${run.result?.outcome}:${run.result?.time}:${run.result?.haul}:${roomStart}`.slice(0, 96);
/**
 * Banks a finished run's Embers once. `boons` are the viewer's run upgrades (for the codex).
 * Returns {credited, amount, newBest, dailyBest}.
 */
export function creditRun(meta, run, {boons = [], key = runKey(run)} = {}) {
  const r = run?.result;
  if (!r || meta.credited.includes(key)) return {credited: false, amount: 0};
  meta.credited = uniq(meta.credited, [key], 64);
  meta.embers = Math.min(1e9, meta.embers + r.banked); meta.lifetime = Math.min(1e9, meta.lifetime + r.banked);
  meta.codex.kinds = uniq(meta.codex.kinds, r.path, 64);
  if (r.outcome === 'won' || r.path.includes('heart')) meta.codex.bosses = uniq(meta.codex.bosses, [run.boss], 64);
  meta.codex.boons = uniq(meta.codex.boons, boons, 64);
  const entry = {format: run.format, seed: run.seed, daily: run.daily || '', outcome: r.outcome, banked: r.banked, tier: r.tier, time: r.time, kills: r.kills};
  meta.history = [...meta.history, entry].slice(-20);
  const newBest = !meta.best || r.banked > meta.best.banked;
  if (newBest) meta.best = entry;
  let dailyBest = false;
  if (run.format === 'daily' && run.daily) { const prev = meta.daily[run.daily]; if (!prev || r.banked > prev.banked) { meta.daily[run.daily] = entry; dailyBest = true; } }
  return {credited: true, amount: r.banked, newBest, dailyBest};
}
/** Today's date for the Daily Expedition, in UTC so every player shares the same seed. */
export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);
