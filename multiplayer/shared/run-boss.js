// An Expedition Roguelite Heart guardian (shared/expedition-run.js) is a crowned golem: bigger, tougher and slower to
// dismember. No imports, so combat, enemy behaviour and the client all read the same numbers.
export const BOSS = Object.freeze({scale: 1.75, hp: 5, parts: 3, armor: 6, damage: 1.4, speed: .85});
export const bossScale = e => e?.boss && e.kind === 'golem' ? BOSS.scale : 1;
