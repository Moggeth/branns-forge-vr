// Optional host-controlled lane battle. All clocks and IDs belong to the simulation.
import {expeditionRunning} from './adventure.js';

export const BATTLE = Object.freeze({botCap:32,perSideCap:16,waveSize:4,waveTicks:900,baseHp:400,aggroRange:12});
export const BATTLE_SIDES = Object.freeze(['party','rivals']);
const sites = [[-40,-40],[40,40]];
// The bent central lane bypasses the permanent Forge and its apron.
const lane = [[-40,-40],[-24,-24],[-12,0],[0,16],[24,28],[40,40]];
const flat = (a,b) => Math.hypot(a[0]-b[0],a[2]-b[2]);
const int = (n,a,b) => Number.isSafeInteger(n)&&n>=a&&n<=b;
const fail = code => ({ok:false,code,events:[]});
export const createBattle = () => ({v:1,status:'off',run:0,wave:0,nextWaveTick:0,winner:null,bases:[]});
export const battleActive = state => state.battle?.status === 'running';
export const battleBot = e => e?.battleRun !== undefined;
export const enemyHostileTo = (enemy,side='party') => !battleBot(enemy)||enemy.side!==side;
export function friendlyEnemyHit(state,enemy,hit) {
  if(!battleBot(enemy))return false;
  const side=hit?.side||state.players.find(p=>p.id===hit?.ownerId)?.side;
  // Legacy delayed attacks with a departed owner have no safe faction attribution.
  return side===enemy.side||!!hit?.ownerId&&!side;
}

function cleanup(state) {
  const removed=new Set(state.enemies.filter(battleBot).map(e=>e.id));
  const remains=state.detachedParts.filter(d=>/^battle\d+_/.test(d.sourceId));
  for(const d of remains){removed.add(d.id);const holder=state.players.find(p=>p.id===d.heldBy);if(holder?.tool==='limb')holder.tool='axe';}
  state.enemies=state.enemies.filter(e=>!battleBot(e));
  state.detachedParts=state.detachedParts.filter(d=>!removed.has(d.id));
  state.embeds=state.embeds.filter(e=>!removed.has(e.targetId));
}

export function battleAction(state,player,message,ctx) {
  if(!['start','stop','reset','attack_base'].includes(message.action))return fail('invalid_battle_action');
  if(message.action==='attack_base')return attackBattleBase(state,player,message.targetId,ctx);
  if(message.action==='stop'){
    cleanup(state);state.battle={...createBattle(),run:state.battle.run};
    return {ok:true,events:[{kind:'battle_stop',by:player.id}]};
  }
  if(expeditionRunning(state.adventure))return fail('expedition_active');
  if(message.action==='start'&&state.battle.status!=='off')return fail('battle_active');
  if(message.action==='reset'&&state.battle.status==='off')return fail('battle_inactive');
  cleanup(state);
  state.battle={v:1,status:'running',run:state.battle.run+1,wave:0,nextWaveTick:state.tick,winner:null,
    bases:BATTLE_SIDES.map((side,i)=>({id:`battle-base-${side}`,side,position:[sites[i][0],ctx.terrainHeight(state,...sites[i]),sites[i][1]],hp:BATTLE.baseHp,maxHp:BATTLE.baseHp}))};
  return {ok:true,events:[{kind:'battle_start',run:state.battle.run,by:player.id}]};
}

export function damageBattleBase(state,id,amount,side,events) {
  const base=state.battle?.bases.find(b=>b.id===id);
  if(!battleActive(state)||!base||base.hp<=0||base.side===side||!BATTLE_SIDES.includes(side)||!Number.isFinite(amount)||amount<=0||amount>1000)return false;
  base.hp=Math.max(0,base.hp-amount);
  events.push({kind:'battle_base_hit',id,side:base.side,hp:base.hp,position:[...base.position]});
  if(!base.hp){state.battle.status='victory';state.battle.winner=side;cleanup(state);events.push({kind:'battle_victory',winner:side,position:[...base.position]});}
  return true;
}

export function attackBattleBase(state,player,id,ctx,{cooldown=true}={}) {
  if(!battleActive(state))return fail('battle_inactive');
  const base=state.battle.bases.find(b=>b.id===id);
  if(!base)return fail('invalid_battle_target');
  if(player.role!=='hero')return fail('hero_required');
  if(base.side===(player.side||'party'))return fail('friendly_target');
  if(!['axe','pick','hammer','limb'].includes(player.tool))return fail('melee_required');
  const d=flat(player.position,base.position),dot=(-Math.sin(player.yaw)*(base.position[0]-player.position[0])-Math.cos(player.yaw)*(base.position[2]-player.position[2]))/Math.max(.001,d);
  if(d>3.2||Math.abs(player.position[1]-base.position[1])>2.5||(d>.5&&dot<.45))return fail('out_of_reach');
  if(cooldown&&state.tick-player.attackTick<({axe:27,pick:29,hammer:40,limb:32}[player.tool]))return fail('cooldown');
  player.attackTick=state.tick;const events=[];
  damageBattleBase(state,id,player.tool==='hammer'?55:25,player.side||'party',events);
  return {ok:true,events};
}

// Called before enemy AI; bounded even after a long suspension or host handoff.
export function stepBattle(state,ctx,events) {
  if(!battleActive(state))return;
  for(const base of state.battle.bases)base.position[1]=ctx.terrainHeight(state,base.position[0],base.position[2]);
  if(!state.players.length||state.tick<state.battle.nextWaveTick)return;
  const b=state.battle;b.wave++;b.nextWaveTick=state.tick+BATTLE.waveTicks;
  const counts=Object.fromEntries(BATTLE_SIDES.map(side=>[side,state.enemies.filter(e=>battleBot(e)&&e.side===side).length]));
  let spawned=0;
  // Alternate insertion order each wave, and reserve a matched pair of world slots.
  for(let n=0;n<BATTLE.waveSize;n++){
    const eligible=(b.wave%2?BATTLE_SIDES:[...BATTLE_SIDES].reverse()).filter(side=>counts[side]<BATTLE.perSideCap);
    if(64-state.enemies.length<eligible.length)break;
    for(const side of eligible){
    const index=BATTLE_SIDES.indexOf(side),sign=index?-1:1,base=b.bases[index],x=base.position[0]+sign*(3+n*.65),z=base.position[2]+sign*(3-n*.65);
    const e=ctx.createEnemy(ctx.nextId(state,`battle${b.run}_${b.wave}_${side}_`),[x,ctx.terrainHeight(state,x,z),z],'skeleton');
    Object.assign(e,{side,battleRun:b.run,battleWaypoint:index?lane.length-2:1,emergeTick:state.tick});
    state.enemies.push(e);counts[side]++;spawned++;
    }
  }
  events.push({kind:'battle_wave',wave:b.wave,count:spawned,nextWaveTick:b.nextWaveTick});
}

export function battleWaypoint(state,enemy,ground) {
  const b=state.battle.bases.find(b=>b.side!==enemy.side);
  const i=enemy.battleWaypoint,p=lane[i];
  if(flat(enemy.position,[p[0],0,p[1]])<3&&i!==0&&i!==lane.length-1)enemy.battleWaypoint+=enemy.side==='party'?1:-1;
  const at=lane[enemy.battleWaypoint];
  return enemy.battleWaypoint===0||enemy.battleWaypoint===lane.length-1?b:{id:'battle-lane',position:[at[0],ground(...at),at[1]],battleLane:true};
}

export function restoreBattle(saved) {
  const b=saved.battle;
  const bots=saved.enemies.filter(battleBot);
  if(b===undefined){if(bots.length)throw Error('Invalid battle bots');return createBattle();}
  const bad=()=>{throw Error('Invalid battle state');};
  if(!b||b.v!==1||!['off','running','victory'].includes(b.status)||!int(b.run,0,1e9)||!int(b.wave,0,1e9)||!int(b.nextWaveTick,0,saved.tick+BATTLE.waveTicks)||!Array.isArray(b.bases)||bots.length>BATTLE.botCap)bad();
  if(b.status==='off'){if(b.bases.length||bots.length||b.winner!==null||b.wave!==0||b.nextWaveTick!==0)bad();}
  else {
    if(!b.run||b.bases.length!==2||expeditionRunning(saved.adventure))bad();
    for(let i=0;i<2;i++){
      const base=b.bases[i];if(!base||base.id!==`battle-base-${BATTLE_SIDES[i]}`||base.side!==BATTLE_SIDES[i]||base.maxHp!==BATTLE.baseHp||!Number.isFinite(base.hp)||base.hp<0||base.hp>BATTLE.baseHp||!Array.isArray(base.position)||base.position.length!==3||!base.position.every(Number.isFinite)||base.position[0]!==sites[i][0]||base.position[2]!==sites[i][1]||Math.abs(base.position[1])>200)bad();
    }
    if(b.status==='running'&&(b.winner!==null||b.bases.some(x=>x.hp<=0)))bad();
    if(b.status==='victory'&&(!BATTLE_SIDES.includes(b.winner)||bots.length||b.bases.find(x=>x.side!==b.winner).hp!==0||b.bases.find(x=>x.side===b.winner).hp<=0))bad();
  }
  for(const side of BATTLE_SIDES)if(bots.filter(e=>e.side===side).length>BATTLE.perSideCap)bad();
  for(const e of bots)if(b.status!=='running'||e.battleRun!==b.run||e.kind!=='skeleton'||!BATTLE_SIDES.includes(e.side)||!int(e.battleWaypoint,0,lane.length-1)||!new RegExp(`^battle${b.run}_[1-9][0-9]*_${e.side}_[0-9]+$`).test(e.id)||Number(e.id.split('_')[1])>b.wave)bad();
  for(const e of saved.enemies)if(!battleBot(e)&&(e.side!==undefined||e.battleWaypoint!==undefined||/^battle\d+_/.test(e.id)))bad();
  return {v:1,status:b.status,run:b.run,wave:b.wave,nextWaveTick:b.nextWaveTick,winner:b.winner,bases:b.bases.map(({id,side,position,hp,maxHp})=>({id,side,position:[...position],hp,maxHp}))};
}
