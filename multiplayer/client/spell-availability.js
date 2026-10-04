import {SPELLS} from '../shared/spells.js';
import {depositCapacityUsed} from '../shared/resources.js';
import {ENT, ENT_SPELLS, entTargets} from '../shared/ents.js';
import {worldTrees} from '../shared/world-content.js';
import {planTerrainBake} from '../shared/terrain.js';
import {bloomLevel} from '../shared/bloom.js';
import {earthLineEdits} from '../shared/earth-spells.js';

// Presentation-only explanation of authoritative cast limits. The server still
// validates every command; this prevents a green preview promising an impossible cast.
// Mana is the only game rule once Bloom has unlocked a spell; the rest are malformed points and world capacity caps.
export function spellUnavailable(world,player,id,{point,lineCount=earthLineEdits(),trees}={}) {
  const spec=SPELLS.find(s=>s.id===id);if(!spec||!player||player.role!=='god')return 'God role required';
  if(bloomLevel(world.bloom)<(spec.bloom||0))return `Unlocks at Bloom ${spec.bloom}`;
  if((player.mana??0)<spec.cost)return 'Not enough mana';
  if(point&&(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||Math.abs(point[0])>55||Math.abs(point[2])>55||Math.abs(point[1])>1000))return 'Outside the world';
  const pending=world.pendingStarfalls?.length||0,needed=(spec.target==='line'?lineCount:1)+pending;
  // Authority folds old settled earthworks into the baked ground first; only unsettled ones count.
  const enemies=world.enemies?.length||0,edits=['raise','lower','sunder','wall','starfall'].includes(id)?(world.edits?.length||0)-planTerrainBake(world.edits,world.tick??0,needed).length:world.edits?.length||0;
  if(['skeleton','squad','golem'].includes(id)&&enemies+(id==='squad'?4:1)>64)return 'Creature limit reached';
  if(['grove','ring'].includes(id)&&(world.groves?.length||0)>=64)return 'Grove limit reached';
  if((['raise','lower','sunder','wall'].includes(id)&&edits+pending+(spec.target==='line'?lineCount:1)>64)||(id==='starfall'&&edits+pending>=64))return 'Terrain edit limit reached';
  if(ENT_SPELLS.includes(id)){
    if(point&&!(trees??entTargets(worldTrees(world),world.harvestedTrees,id,point)).length)return id==='awaken'?'Aim at a standing tree':'No standing trees in the circle';
    if((world.enemies||[]).filter(e=>e.kind==='ent').length>=ENT.maxAwake||enemies>=64)return 'Ent limit reached';
  }
  if(id==='starfall'&&pending>=8)return 'Meteor limit reached';
  if(['crystal','starfall'].includes(id)&&depositCapacityUsed(world)>=80)return 'Deposit limit reached';
  return '';
}
