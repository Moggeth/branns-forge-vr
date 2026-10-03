import {WEAPONS} from '../shared/spells.js';

export function actionError(code,{world={},player={},command={}}={}){
 const tick=world.tick||0,wait=(last,duration)=>Math.max(.1,(duration-(tick-(last??-1000)))/60).toFixed(1);
 if(code==='cooldown'){
  if(command.type==='role')return `Perspective switch is recovering: ${wait(player.roleTick,120)}s.`;
  if(command.type==='cast')return `Magic is recovering: ${wait(player.castTick,45)}s.`;
  if(command.action==='forgeEncounter')return `The next raid is ready in ${Math.max(.1,((world.settlement?.cooldownUntil||tick)-tick)/60).toFixed(1)}s.`;
  const special=command.action==='special';
  return `${special?'Special':'Attack'} is recovering: ${wait(special?player.specialTick:player.attackTick,special?(player.tool==='wyrmspout'?120:240):(WEAPONS.find(w=>w.id===player.tool)?.cooldown||30))}s.`;
 }
 if(code==='shrine_disabled')return `The forge was damaged. Repair it with timber, or wait ${Math.max(0,Math.ceil(((world.shrine?.disabledUntil||tick)-tick)/60))}s for recovery.`;
 if(code==='projectile_limit')return 'Too many projectiles are still in flight. Let them land before firing again (up to 8s).';
 if(code==='world_limit'){
  if(['fire','flame','pour'].includes(command.action))return 'The projectile limit is reached. Let the current shots land before firing again (up to 8s).';
  if((world.pickups?.length||0)>=256)return 'Too many loose resources are on the ground. Collect a few before breaking another deposit.';
  if(command.action==='buildBridge')return 'The world already has 32 bridges. This world cannot accept another bridge.';
  if((world.enemies?.length||0)>=61&&['skeleton','squad','golem'].includes(command.spell))return 'The world has reached its creature limit. Defeat some enemies before summoning more.';
  if((world.groves?.length||0)>=64&&['grove','ring'].includes(command.spell))return 'The grove limit is reached. This world cannot accept another grove.';
  if((world.pendingStarfalls?.length||0)>=8&&command.spell==='starfall')return 'Eight meteors are already descending. Wait for an impact before calling another.';
  if((world.deposits?.length||0)+(world.pendingStarfalls?.length||0)>=80)return 'Too many mineral sites are reserved. Finish mining existing deposits before creating more.';
  return `Terrain storage is full (${world.edits?.length||0} edits). Mine crystal walls to clear space, or save and reset this world. Waiting does not clear terrain.`;
 }
 if(code==='rate_limited')return 'Too many network requests arrived together. Wait up to a minute before creating or joining another room.';
 if(code==='busy')return 'The connection is processing another request. Retry shortly; if this persists, reconnect from Menu.';
 return null;
}
