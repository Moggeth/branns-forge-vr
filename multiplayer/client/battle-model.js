// Pure adapters for the existing desktop/mobile and VR quest surfaces.
// Battle is team-objective PvE: heroes help their wave defeat bots and a base;
// it does not introduce direct hero-versus-hero weapon combat.
import {MATERIAL_KEYS} from '../shared/material-catalog.js';
import {expeditionRunning} from '../shared/adventure.js';
import {BATTLE,BATTLE_SIDES} from '../shared/battle-mode.js';

export const BATTLE_LABELS=Object.freeze({party:'Dawn',rivals:'Dusk'});
const sideOf=p=>p?.side==='rivals'?'rivals':'party';
const nonnegative=(value,fallback=0)=>Number.isFinite(value)?Math.max(0,value):fallback;

export function battlePanelModel(snapshot,playerId,{isHost=false,connected=false}={}) {
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
  return {status,isHost:!!isHost,connected:!!connected,selfSide,
    canChangeSide:!!connected&&!!player&&!carries&&!refining,
    expeditionActive:expeditionRunning(snapshot?.adventure),
    wave:status==='off'?0:nonnegative(battle.wave),
    nextWaveSeconds:status==='running'?Math.max(0,Math.ceil((nonnegative(battle.nextWaveTick)-nonnegative(snapshot?.tick))/60)):0,
    bots,bases,winner:status==='victory'&&BATTLE_SIDES.includes(battle.winner)?battle.winner:null};
}

// null means the caller should use its ordinary adventureView instead.
export function battleQuestView(snapshot,playerId) {
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
