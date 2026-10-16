// Shared catalogue: the tray and authoritative cast validation use one vocabulary.
import {ENT} from './ents.js';
import {RAISE_WALL,SUNDER} from './terrain.js';
// The four schools of God magic, in spell-bar order. Each spell belongs to exactly one.
export const SPELL_SCHOOLS = Object.freeze([
  {id:'grow',label:'Grow',job:'Make the world alive and feed the Heroes',spells:['grove','ring','wave','heal','spring','blessing']},
  {id:'shape',label:'Shape',job:'Move the land: paths, cover and ore',spells:['raise','lower','wall','sunder','crystal','quake']},
  {id:'summon',label:'Summon',job:'Call creatures: foes that drop loot, and allies',spells:['skeleton','squad','golem','awaken','wildwake','rabble']},
  {id:'sky',label:'Sky',job:'Instant strikes and weather',spells:['lightning','frost','starfall','rainfall']},
].map(s=>Object.freeze({...s,spells:Object.freeze(s.spells)})));
const SCHOOL_OF = Object.fromEntries(SPELL_SCHOOLS.flatMap(s=>s.spells.map(id=>[id,s.id])));
export const SPELLS = Object.freeze([
  {id:'skeleton',label:'Skeleton',cost:15,target:'point',icon:'☠'},
  {id:'squad',label:'Skeleton Squad',cost:38,target:'point',icon:'☠'},
  {id:'golem',label:'Stone Golem',cost:45,target:'point',icon:'◆'},
  {id:'rabble',label:'Rabble',cost:30,target:'point',icon:'✺'}, // one of the shared/critters.js rabble, picked by the cast id
  {id:'raise',label:'Raise Earth',cost:12,target:'point',icon:'▲'},
  {id:'lower',label:'Lower Earth',cost:12,target:'point',icon:'▼'},
  {id:'sunder',label:'Sunder',cost:14,target:'line',icon:'ϟ'},
  {id:'wall',label:'Raise Wall',cost:14,target:'line',icon:'▰'},
  {id:'grove',label:'Grove',cost:10,target:'point',icon:'♣'},
  {id:'ring',label:'Tree Ring',cost:12,target:'point',icon:'◉'},
  {id:'starfall',label:'Starfall',cost:25,target:'point',icon:'☄'},
  {id:'crystal',label:'Crystal Bloom',cost:20,target:'point',icon:'♦'},
  {id:'heal',label:'Healing Rain',cost:18,target:'point',icon:'✚'},
  {id:'lightning',label:'Lightning',cost:22,target:'point',icon:'ϟ'},
  {id:'frost',label:'Frost Nova',cost:20,target:'point',icon:'❄'},
  {id:'awaken',label:'Awaken',cost:18,target:'point',icon:'❦'},
  {id:'wildwake',label:'Wild Awakening',cost:40,target:'point',icon:'✤'},
  // Growth Wave: drag a band and a rectangle of trees rises along it (shared/grove-growth.js).
  {id:'wave',label:'Growth Wave',cost:30,target:'line',icon:'⁂'},
  {id:'rainfall',label:'Rainfall',cost:30,target:'point',icon:'☂'}, // world-wide rain: groves bloom faster, Heroes mend
  // Bloom spells open as the world fills with life (shared/bloom.js).
  {id:'spring',label:'Life Spring',cost:16,target:'point',icon:'❀',bloom:1},
  {id:'blessing',label:'Blessing',cost:20,target:'point',icon:'✦',bloom:2},
  {id:'quake',label:'Quake',cost:24,target:'point',icon:'≋',bloom:3},
].map(s=>Object.freeze({bloom:0,...s,school:SCHOOL_OF[s.id],cooldown:0})));  // Mana is the only gate on casting once a spell is unlocked.
export const SPELL_BLOOM = Object.freeze(Object.fromEntries(SPELLS.map(s=>[s.id,s.bloom])));
export const SPELL_COST = Object.freeze(Object.fromEntries(SPELLS.map(s=>[s.id,s.cost])));
export const WEAPONS = Object.freeze([
  {id:'axe',label:'Axe',slot:1,cooldown:27}, {id:'pick',label:'Pick',slot:2,cooldown:29},
  {id:'hammer',label:'War Hammer',slot:3,cooldown:40}, {id:'crossbow',label:'Siegebird',slot:4,cooldown:60},
  {id:'bow',label:'Emberwing',slot:5,cooldown:33}, {id:'limb',label:'Held Limb',slot:6,cooldown:32},
  {id:'wyrmspout',label:'Wyrmspout',slot:7,cooldown:5}, {id:'flask',label:'Emberdew',slot:8,cooldown:60},
  {id:'staff',label:'Sunthread',slot:9,cooldown:30},
].map(Object.freeze));

// Placement rules move a cast to the nearest allowed spot; they never refuse it.
// Creatures, trees and crystal stay off the forge apron (wider during an
// expedition for creatures), and trees keep room inside the mountain wall.
export const FORGE_APRON = 7, EXPEDITION_KEEP_OUT = 12, GROVE_EDGE = 51;
const APRON_SPELLS = ['grove','ring','crystal','skeleton','squad','golem','rabble'], SUMMONS = ['skeleton','squad','golem','rabble'];
export function settleCastPoint(spell, point, {expedition = false} = {}) {
  let [x, y, z] = point;
  if (spell === 'grove' || spell === 'ring') { x = Math.max(-GROVE_EDGE, Math.min(GROVE_EDGE, x)); z = Math.max(-GROVE_EDGE, Math.min(GROVE_EDGE, z)); }
  const apron = expedition && SUMMONS.includes(spell) ? EXPEDITION_KEEP_OUT : APRON_SPELLS.includes(spell) ? FORGE_APRON : 0, d = Math.hypot(x, z);
  if (apron && d < apron) { if (d < 1e-6) { x = 0; z = apron; } else { x = x / d * apron; z = z / d * apron; } }
  return [x, y, z];
}

// Spatial preview dimensions mirror authoritative spell effects and world-content tree sites.
export const SPELL_TARGET_SHAPES = Object.freeze({
  skeleton: { r: 2 }, squad: { r: 2.6, spawns: [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] }, golem: { r: 2.6 }, rabble: { r: 2.2 },
  raise: { r: 6, h: 2 }, lower: { r: 6, h: -2 },
  // Earth lines: kr is the trench lip / wall foot half-width, kh the full depth/height, bank the chasm's outer spoil edge.
  sunder: { line: true, kr: SUNDER.width, kh: -SUNDER.depth, bank: SUNDER.bankOut }, wall: { line: true, kr: RAISE_WALL.width, kh: RAISE_WALL.peak },
  // Growth spells: the reticle marks the exact sites the authority will plant (grove-growth.js growthPlan); these are the open-ground pattern.
  grove: { r: 6.4, sites: true, trees: Array.from({length:5},(_,i)=>[+(Math.cos(i*Math.PI*2/5)*3.9).toFixed(3),+(Math.sin(i*Math.PI*2/5)*3.9).toFixed(3)]) }, ring: { r: 7, treeRing: 5.9, trees: 8, sites: true },
  wave: { line: true, band: 3, sites: true },
  starfall: { r: 5 }, crystal: { r: 2.6 }, heal: { r: 7 }, lightning: { r: 3 }, frost: { r: 7 },
  spring: { r: 3 }, blessing: { r: 6 }, quake: { r: 8 }, rainfall: { r: 9 },
  // Ents wake standing trees: Awaken snaps to the nearest tree within reach; Wild Awakening takes up to three in its circle.
  awaken: { r: 1.5, reach: ENT.awakenRadius, count: 1 }, wildwake: { r: ENT.wildRadius, count: ENT.wildCount },
});
