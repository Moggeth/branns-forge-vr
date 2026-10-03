import {WEAPONS} from '../shared/spells.js';

const RECOVERY = {
 "out_of_reach": "That target is beyond reach. Move closer and aim at it again.",
 "invalid_target": "That target is gone or cannot receive this action. Aim at another valid target.",
 "invalid_cast": "The spell target is not valid. Aim at ground inside the valley and try again.",
 "invalid_contact": "That strike did not reach a visible surface. Adjust your aim and strike again.",
 "outside_world": "The target is outside the playable valley. Aim inside the mountain boundary.",
 "hands_full": "Your hands are occupied. Collect or put down the held item before picking up another.",
 "nothing_held": "You are not holding an item. Pick one up before trying to drop or throw it.",
 "nothing_carried": "You have no carried supplies to deposit. Collect loose resources first.",
 "not_your_resources": "Those supplies belong to the other side. Collect your own or gather neutral resources.",
 "not_your_structure": "That structure belongs to the other side. Use a friendly structure or the central Forge.",
 "insufficient_mana": "Not enough mana for this spell. Wait for the mana bar to recover or choose a cheaper spell.",
 "overheated": "The weapon is overheated. Release Attack and let it cool before firing again.",
 "release_to_vent": "Venting requires you to stop firing. Release Attack, then use Special.",
 "permanent_forge": "The central Forge is permanent and cannot be damaged. Attack an enemy structure instead.",
 "structure_destroyed": "That structure is destroyed. Repair it from the workshop before using it.",
 "already_running": "An expedition is already under way. Open Current Quest to see the party objective.",
 "encounter_active": "An encounter is already active. Finish the current fight before calling another.",
 "invalid_stage": "That expedition action is unavailable at this stage. Check Current Quest for the next objective.",
 "guarded": "A guardian is protecting the fallen star. Defeat it before recovering the star.",
 "use_lodestar": "This stage needs the Lodestar action. Open Current Quest and use Lodestar on the fallen star.",
 "support_spent": "Your support allowance for this stage is spent. Help through combat or wait for the next stage.",
 "no_retries": "This expedition has used its recovery attempts. Start a new expedition from Current Quest.",
 "fully_built": "This upgrade is already at its maximum level. Choose another upgrade; no supplies were spent.",
 "worker_carrying": "That helper is carrying resources. Let it deliver its load before changing its assignment.",
 "worker_limit": "The helper limit has been reached. Reassign an existing helper from the workshop.",
 "defender_limit": "The defender limit has been reached. Use your current defenders before recruiting more.",
 "machine_limit": "The machine limit has been reached. Operate or repair an existing machine.",
 "ledger_full": "The world has reached its expedition record capacity. Download a recovery save and start a fresh world.",
 "host_required": "Only the current world host can perform this action. Ask the host to do it.",
 "role_required": "Your current role cannot perform that action. Switch Hero / God and use that role’s controls.",
 "not_joined": "You are not connected to a world. Create a world or join with your friend’s code.",
 "no_player": "Your player has left this world. Rejoin with the room code.",
 "invalid_resource": "That resource cannot be used here. Choose a resource listed in this workshop recipe.",
 "invalid_worker": "That helper is no longer available. Select a helper currently listed in the workshop.",
 "invalid_side": "That team is unavailable. Choose one of the sides shown in the workshop.",
 "invalid_action": "That action is unavailable. Close and reopen its panel to refresh the available actions.",
 "unknown_action": "This action is not supported by the host. Refresh the page so everyone uses the same version.",
 "invalid_message": "The host could not read that request. Refresh the page and rejoin the world.",
 "unknown_message": "The host does not recognise that request. Refresh the page to match the current version.",
 "invalid_input": "That input was not accepted. Release the controls, then try again.",
 "invalid_sequence": "Your connection is out of sync. Reconnect through Menu if retrying does not recover.",
 "duplicate_sequence": "That request was already processed. Wait for the world to catch up before retrying.",
 "invalid_player": "Your player state is unavailable. Rejoin using the room code.",
 "no_tree": "No standing tree is close enough to wake. Aim at a tree (stumps and felled trees cannot wake); no mana was spent.",
 "ent_limit": "Twelve ents are already awake. Wait for some to root again or fall before waking more; no mana was spent."
};

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
  if(['awaken','wildwake'].includes(command.spell))return 'The forest has too many trees resting from awakening. Wait for some to root again before waking more.';
  if((world.groves?.length||0)>=64&&['grove','ring'].includes(command.spell))return 'The grove limit is reached. This world cannot accept another grove.';
  if((world.pendingStarfalls?.length||0)>=8&&command.spell==='starfall')return 'Eight meteors are already descending. Wait for an impact before calling another.';
  if((world.deposits?.length||0)+(world.pendingStarfalls?.length||0)>=80)return 'Too many mineral sites are reserved. Finish mining existing deposits before creating more.';
  if(command.action==='special'&&player.tool==='pick')return `Terrain storage is full (${world.edits?.length||0} edits). Crystal walls free their space when they shatter (within a minute); mine one now to make room sooner.`;
  return `Terrain storage is full (${world.edits?.length||0} edits). Mine crystal walls to clear space, or save and reset this world. Waiting does not clear terrain.`;
 }
 if(code==='rate_limited')return 'Too many network requests arrived together. Wait up to a minute before creating or joining another room.';
 if(code==='busy')return 'The connection is processing another request. Retry shortly; if this persists, reconnect from Menu.';
 return RECOVERY[code]||null;
}
