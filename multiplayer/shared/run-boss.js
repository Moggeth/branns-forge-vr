// An Expedition Roguelite Heart guardian (shared/expedition-run.js) is a crowned golem: bigger, tougher and slower to
// dismember. Only plain-number imports, so combat, enemy behaviour and the client all read the same numbers.
export const BOSS = Object.freeze({scale: 1.75, hp: 5, parts: 3, armor: 6, damage: 1.4, speed: .85});
// Two crowned golems share the boss field: the Roguelite's Heart guardian (boss = its id) and the Underways' finale
// guardian (boss === true, shared/underways/constants.js). Each keeps its own size and toughness.
import {BOSS_HP, BOSS_SCALE} from './underways/constants.js';
export const underwayBoss = e => e?.boss === true;
export const bossScale = e => !e?.boss || e.kind !== 'golem' ? 1 : e.boss === true ? BOSS_SCALE : BOSS.scale;
export {BOSS_HP, BOSS_SCALE};
