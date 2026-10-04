// The six skeleton warband archetypes, derived from the enemy id so host, peers and saves always agree
// (presentation: client/skeleton-look.js). The shield is the only archetype trait with gameplay weight:
// how much punishment it soaks before it splinters. Points: arrow 1, bolt 2; a golden bolt shatters any.
export const SKELETON_KINDS = Object.freeze(['mossward', 'rustguard', 'thornhood', 'oldbones', 'bloomcaller', 'antlerbound']);
export const SKELETON_SHIELDS = Object.freeze([
  {name: 'Shield_Kite', hp: 6, material: 'wood'},
  {name: 'Shield_Round', hp: 8, material: 'iron'},
  {name: 'Shield_Heater', hp: 6, material: 'wood'},
  {name: 'Shield_Buckler', hp: 4, material: 'wood'},
  {name: 'Shield_Living', hp: 6, material: 'wood'},
  {name: 'Shield_Tower', hp: 10, material: 'iron'},
]);
export function idHash(id) {
  let h = 0x811c9dc5;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
export const skeletonKindIndex = id => idHash(id) % SKELETON_KINDS.length;
export const skeletonShield = id => SKELETON_SHIELDS[skeletonKindIndex(id)];
