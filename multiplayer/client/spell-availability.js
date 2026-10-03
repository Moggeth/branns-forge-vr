import {SPELLS} from '../shared/spells.js';
import {adventureCastGate} from '../shared/adventure.js';
import {depositCapacityUsed} from '../shared/resources.js';

// Presentation-only explanation of authoritative cast limits. The server still
// validates every command; this prevents a green preview promising an impossible cast.
export function spellUnavailable(world,player,id,{point,lineCount=3}={}) {
  const spec=SPELLS.find(s=>s.id===id);if(!spec||!player||player.role!=='god')return 'God role required';
  if((world.shrine?.hp??100)<=0)return 'Forge recovering';
  if((world.tick??0)-(player.castTick??-1000)<45)return 'Recharging';
  if((player.mana??0)<spec.cost)return 'Not enough mana';
  if(point&&(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||Math.abs(point[0])>55||Math.abs(point[2])>55||Math.abs(point[1])>1000))return 'Outside the world';
  if(point&&['grove','ring'].includes(id)&&(Math.abs(point[0])>51||Math.abs(point[2])>51))return 'Leave room for trees';
  const enemies=world.enemies?.length||0,edits=world.edits?.length||0,pending=world.pendingStarfalls?.length||0;
  if(['skeleton','squad','golem'].includes(id)&&enemies+(id==='squad'?4:1)>64)return 'Creature limit reached';
  if(['grove','ring'].includes(id)&&(world.groves?.length||0)>=64)return 'Grove limit reached';
  if((['raise','lower','sunder','wall'].includes(id)&&edits+pending+(spec.target==='line'?lineCount:1)>64)||(id==='starfall'&&edits+pending>=64))return 'Terrain edit limit reached';
  if(id==='starfall'&&pending>=8)return 'Meteor limit reached';
  if(['crystal','starfall'].includes(id)&&depositCapacityUsed(world)>=80)return 'Deposit limit reached';
  if(point&&world.adventure){
    // Gate reserves a scalar challenge budget. A shallow copy keeps previews pure.
    const gate=adventureCastGate({...world.adventure},player.id,{spell:id,point},world);
    if(!gate.ok)return ({expedition_no_heroes:'This expedition needs a Hero',expedition_keep_out:'Keep threats away from the forge',expedition_too_close:'Leave Heroes room to react',expedition_challenge_spent:'Expedition challenge budget spent'})[gate.code]||'Invalid placement';
  }
  return '';
}
