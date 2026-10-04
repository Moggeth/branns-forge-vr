// Shared catalogue: the tray and authoritative cast validation use one vocabulary.
import {ENT} from './ents.js';
export const SPELLS = Object.freeze([
  {id:'skeleton',label:'Skeleton',cost:15,target:'point',icon:'☠'},
  {id:'squad',label:'Skeleton Squad',cost:38,target:'point',icon:'☠'},
  {id:'golem',label:'Stone Golem',cost:45,target:'point',icon:'◆'},
  {id:'raise',label:'Raise Earth',cost:12,target:'point',icon:'▲'},
  {id:'lower',label:'Lower Earth',cost:12,target:'point',icon:'▼'},
  {id:'sunder',label:'Sunder',cost:14,target:'line',icon:'ϟ'},
  {id:'wall',label:'Stone Wall',cost:14,target:'line',icon:'▰'},
  {id:'grove',label:'Grove',cost:10,target:'point',icon:'♣'},
  {id:'ring',label:'Tree Ring',cost:12,target:'point',icon:'◉'},
  {id:'starfall',label:'Starfall',cost:25,target:'point',icon:'☄'},
  {id:'crystal',label:'Crystal Bloom',cost:20,target:'point',icon:'♦'},
  {id:'heal',label:'Healing Rain',cost:18,target:'point',icon:'✚'},
  {id:'lightning',label:'Lightning',cost:22,target:'point',icon:'ϟ'},
  {id:'frost',label:'Frost Nova',cost:20,target:'point',icon:'❄'},
  {id:'awaken',label:'Awaken',cost:18,target:'point',icon:'❦'},
  {id:'wildwake',label:'Wild Awakening',cost:40,target:'point',icon:'✤'},
  // Bloom spells open as the world fills with life (shared/bloom.js).
  {id:'spring',label:'Life Spring',cost:16,target:'point',icon:'❀',bloom:1},
  {id:'blessing',label:'Blessing',cost:20,target:'point',icon:'✦',bloom:2},
  {id:'quake',label:'Quake',cost:24,target:'point',icon:'≋',bloom:3},
].map(s=>Object.freeze({bloom:0,...s,cooldown:0})));  // Mana is the only gate on casting once a spell is unlocked.
export const SPELL_BLOOM = Object.freeze(Object.fromEntries(SPELLS.map(s=>[s.id,s.bloom])));
export const SPELL_COST = Object.freeze(Object.fromEntries(SPELLS.map(s=>[s.id,s.cost])));
export const WEAPONS = Object.freeze([
  {id:'axe',label:'Axe',slot:1,cooldown:27}, {id:'pick',label:'Pick',slot:2,cooldown:29},
  {id:'hammer',label:'War Hammer',slot:3,cooldown:40}, {id:'crossbow',label:'Siegebird',slot:4,cooldown:60},
  {id:'bow',label:'Emberwing',slot:5,cooldown:33}, {id:'limb',label:'Held Limb',slot:6,cooldown:32},
  {id:'wyrmspout',label:'Wyrmspout',slot:7,cooldown:6}, {id:'flask',label:'Emberdew',slot:8,cooldown:60},
].map(Object.freeze));

// Placement rules move a cast to the nearest allowed spot; they never refuse it.
// Creatures, trees and crystal stay off the forge apron (wider during an
// expedition for creatures), and trees keep room inside the mountain wall.
export const FORGE_APRON = 7, EXPEDITION_KEEP_OUT = 12, GROVE_EDGE = 51;
const APRON_SPELLS = ['grove','ring','crystal','skeleton','squad','golem'], SUMMONS = ['skeleton','squad','golem'];
export function settleCastPoint(spell, point, {expedition = false} = {}) {
  let [x, y, z] = point;
  if (spell === 'grove' || spell === 'ring') { x = Math.max(-GROVE_EDGE, Math.min(GROVE_EDGE, x)); z = Math.max(-GROVE_EDGE, Math.min(GROVE_EDGE, z)); }
  const apron = expedition && SUMMONS.includes(spell) ? EXPEDITION_KEEP_OUT : APRON_SPELLS.includes(spell) ? FORGE_APRON : 0, d = Math.hypot(x, z);
  if (apron && d < apron) { if (d < 1e-6) { x = 0; z = apron; } else { x = x / d * apron; z = z / d * apron; } }
  return [x, y, z];
}

// Spatial preview dimensions mirror authoritative spell effects and world-content tree sites.
export const SPELL_TARGET_SHAPES = Object.freeze({
  skeleton: { r: 2 }, squad: { r: 2.6, spawns: [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] }, golem: { r: 2.6 },
  raise: { r: 6, h: 2 }, lower: { r: 6, h: -2 },
  sunder: { line: true, kr: 2.5, kh: -1.5 }, wall: { line: true, kr: 2.5, kh: 1.5 },
  grove: { r: 4, trees: Array.from({length:5},(_,i)=>[+(Math.cos(i*Math.PI*2/5)*2.5).toFixed(3),+(Math.sin(i*Math.PI*2/5)*2.5).toFixed(3)]) }, ring: { r: 4.5, treeRing: 4, trees: 8 },
  starfall: { r: 5 }, crystal: { r: 2.6 }, heal: { r: 7 }, lightning: { r: 3 }, frost: { r: 7 },
  spring: { r: 3 }, blessing: { r: 6 }, quake: { r: 8 },
  // Ents wake standing trees: Awaken snaps to the nearest tree within reach; Wild Awakening takes up to three in its circle.
  awaken: { r: 1.5, reach: ENT.awakenRadius, count: 1 }, wildwake: { r: ENT.wildRadius, count: ENT.wildCount },
});
