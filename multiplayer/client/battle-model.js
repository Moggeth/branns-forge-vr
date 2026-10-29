// Pure adapters for the existing desktop/mobile and VR quest surfaces.
// Battle is team-objective PvE: heroes help their wave defeat bots and a base;
// it does not introduce direct hero-versus-hero weapon combat.
import {MATERIAL_KEYS} from '../shared/material-catalog.js';
import {expeditionRunning} from '../shared/adventure.js';
import {BATTLE,BATTLE_SIDES} from '../shared/battle-mode.js';
import {HOME_NAMES} from '../shared/home-bases.js';

export const BATTLE_LABELS=Object.freeze({party:'Dawn',rivals:'Dusk'});
const sideOf=p=>p?.side==='rivals'?'rivals':'party';
const nonnegative=(value,fallback=0)=>Number.isFinite(value)?Math.max(0,value):fallback;

export function battlePanelModel(snapshot,playerId,{isHost=false,connected=false,battleCompatible=true}={}) {
  const player=snapshot?.players?.find(p=>p.id===playerId),selfSide=sideOf(player),battle=snapshot?.battle;
  const status=['running','victory'].includes(battle?.status)?battle.status:'off';
  // Mirror inventionSide exactly: any carried material, lifted ore, or job
  // refining for the current side prevents switching, regardless of ownership.
  const carries=!!player?.heldOre||MATERIAL_KEYS.some(k=>player?.resources?.[k]>0);
  const refining=(snapshot?.inventions?.refining||[]).some(j=>j.side===selfSide);
  const bots={party:0,rivals:0};
  if(status==='running')for(const enemy of snapshot?.enemies||[])
    if(enemy.battleRun===battle.run&&enemy.hp>0&&BATTLE_SIDES.includes(enemy.side))bots[enemy.side]++;
  const bases=status==='off'?[]:BATTLE_SIDES.flatMap(side=>{
    const base=battle.bases?.find(b=>b.side===side);
    if(!base)return [];
    const maxHp=nonnegative(base.maxHp,BATTLE.baseHp);
    return [{side,hp:Math.min(nonnegative(base.hp),maxHp),maxHp}];
  });
  return {status,isHost:!!isHost,connected:!!connected,battleCompatible,selfSide,
    canChangeSide:!!connected&&!!player&&!carries&&!refining,
    expeditionActive:expeditionRunning(snapshot?.adventure),
    wave:status==='off'?0:nonnegative(battle.wave),
    nextWaveSeconds:status==='running'?Math.max(0,Math.ceil((nonnegative(battle.nextWaveTick)-nonnegative(snapshot?.tick))/60)):0,
    bots,bases,winner:status==='victory'&&BATTLE_SIDES.includes(battle.winner)?battle.winner:null,home:battle?.v===2,war:battle?.v===2&&battle.war===true};
}

// null means the caller should use its ordinary adventureView instead.
function homeQuestView(snapshot,playerId) {
  const players=snapshot.players||[],me=players.find(p=>p.id===playerId),role=me?.role==='god'?'god':'hero',selfSide=sideOf(me),foeSide=selfSide==='party'?'rivals':'party';
  const battle=snapshot.battle,tick=snapshot.tick||0,own=battle.bases.find(b=>b.side===selfSide),foe=battle.bases.find(b=>b.side===foeSide);
  const pylons=b=>b.parts.filter(p=>p.kind==='pylon'&&p.hp>0).length,fallen=b=>b.fallenUntil>tick;
  const self=HOME_NAMES[selfSide],enemy=HOME_NAMES[foeSide],waveIn=Math.max(0,Math.ceil((battle.nextWaveTick-tick)/60));
  const nextStep=fallen(foe)?`${enemy} is rebuilding · back in ${Math.ceil((foe.fallenUntil-tick)/60)}s`:fallen(own)?`${self} is rebuilding · hold the lane`:
    !pylons(foe)?`${enemy}'s shield is down. Smash its heart!`:role==='god'?`Heal ${self}'s troops; strike ${enemy}'s pylons.`:`Push with your troops and break ${enemy}'s pylons.`;
  const team=players.filter(p=>sideOf(p)===selfSide);
  return {mode:'battle',stage:'battle',run:battle.run,title:`${self} vs ${enemy}`,role,nextStep,
    notice:`You: ${self} · Next squad in ${waveIn}s · Their pylons ${pylons(foe)}/3`,elapsedSeconds:0,
    objectives:[{id:own.id,label:`${self} heart · defend`,have:own.hp,need:own.maxHp,done:false,icon:'flame',role:'all'},
      {id:foe.id,label:`${enemy} ${pylons(foe)?'pylons':'heart'} · attack`,have:pylons(foe)?pylons(foe):foe.hp,need:pylons(foe)?3:foe.maxHp,done:false,icon:'skull',role:'all'}],
    party:{heroes:team.filter(p=>p.role==='hero').length,gods:team.filter(p=>p.role==='god').length},
    actions:[],telegraphs:[],flame:null,retriesLeft:0,godSupportLeft:0,renown:0,star:null,selfSide,winner:battle.winner,
    bots:{party:(snapshot.enemies||[]).filter(e=>e.battleRun===battle.run&&e.side==='party'&&e.hp>0).length,rivals:(snapshot.enemies||[]).filter(e=>e.battleRun===battle.run&&e.side==='rivals'&&e.hp>0).length}};
}

export function battleQuestView(snapshot,playerId) {
  if(snapshot?.run)return null; // an Expedition Roguelite run shows its own strip (client/run-panel.js); the keeps send no squads
  // Peaceful keeps (the keep war is off) leave the quest card to the world's own guide or the forge quest.
  if(snapshot?.battle?.v===2)return snapshot.battle.status==='running'&&snapshot.battle.war===true&&snapshot.battle.bases?.length===2?homeQuestView(snapshot,playerId):null;
  const model=battlePanelModel(snapshot,playerId);
  if(model.status==='off')return null;
  const players=snapshot?.players||[],me=players.find(p=>p.id===playerId),role=me?.role==='god'?'god':'hero';
  const self=BATTLE_LABELS[model.selfSide],opponent=BATTLE_LABELS[model.selfSide==='party'?'rivals':'party'];
  const victory=model.status==='victory',winner=model.winner?BATTLE_LABELS[model.winner]:null;
  const team=players.filter(p=>sideOf(p)===model.selfSide);
  const nextStep=victory?'Host can reset or stop in Battle.':role==='god'?`Heal ${self}; strike ${opponent} bots and base.`:`Defend ${self}. Push with allies to destroy ${opponent}.`;
  return {mode:'battle',stage:victory?'battle-victory':'battle',run:snapshot.battle.run,
    title:victory?`${winner||'Battle'} wins`:'Dawn vs Dusk',role,nextStep,
    notice:victory?`${self} team · ${winner||'Battle'} victory`:`You: ${self} · Wave ${model.wave+1} in ${model.nextWaveSeconds}s · Bots ${model.bots.party}/${model.bots.rivals}`,
    // The battle protocol has no start-time field; do not invent an elapsed timer.
    elapsedSeconds:0,
    objectives:model.bases.map(base=>({id:`battle-base-${base.side}`,label:`${BATTLE_LABELS[base.side]} base · ${base.side===model.selfSide?'defend':'attack'}`,
      have:base.hp,need:base.maxHp,done:false,icon:base.side===model.selfSide?'flame':'skull',role:'all'})),
    party:{heroes:team.filter(p=>p.role==='hero').length,gods:team.filter(p=>p.role==='god').length},
    actions:[],telegraphs:[],flame:null,retriesLeft:0,godSupportLeft:0,renown:0,star:null,
    selfSide:model.selfSide,winner:model.winner,bots:model.bots};
}
