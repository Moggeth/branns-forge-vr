import {createTestingSupplies} from './testing-supplies.js';
import {STRUCTURES,createInventions,inventionAction,stepInventions,restoreInventions,resolveInventions,inventionFloor,damageInvention} from './inventions.js';
import {MATERIAL_KEYS,emptyMaterials,restoreMaterials,DEPOSIT_CATALOG,depositReward} from './material-catalog.js';
import {baseHeight,terrainHeight,moveOnTerrain,resolveTerrainBoundary,settleTerrainContents,createSunderRupture,validateTerrainRuptures,restoreTerrainEdit,hasActiveTerrain,validateWallSegment,PICK_WALL,RAISE_WALL,makeTerrainRoom,restoreTerrainBake} from './terrain.js';
import {collapseMinedWall,stepCrystalWalls,WALL_DEPOSITS} from './weapon-specials.js';
import {castEarthLine,earthLineEdits} from './earth-spells.js';
export {terrainHeight} from './terrain.js';
import {stepEnemies} from './enemy-behaviour.js';
import {resolveStartingWorld,STARTING_SITES} from './starting-world.js';
import {addFuel,applyHeat,quenchFire,fireContact,stepFire,restoreFire} from './fire.js';
// Browser-authoritative, deterministic 60 Hz room simulation. No DOM, sockets, or secrets.
import {worldTrees, initialDeposits, renewGeology} from './world-content.js';
import {SPELL_COST as COST,SPELL_BLOOM,settleCastPoint} from './spells.js';
import {BLOOM,bloomLevel,addBloom,stepBloom,restoreBloom} from './bloom.js';
import {strikeWaygate,stepWaygate,restoreWaygate} from './waygate.js';
import {useResource, collectTarget, nearestCollectible, meteorAwakens, flushMeteorRewards,createSettlement,settlementAction,stepSettlement,restoreSettlement,recordSettlementDeaths,reclaimDepletedDeposits,retainedDepositPredicate} from './resources.js';
import {stepVeins,validateVein} from './ore-veins.js';
import {TOOLS,PARTS,mineGolemRemains,createEnemy,enemyParts,enemyMaxHp,combatAction,stepCombat,hitEnemyPart,validPartHit,validateCombat,restoreCombat,releaseHeld,projectileContact,validSiegebird} from './combat.js';
import {forgeFloor,resolveForge} from './forge-collision.js';
import {castBoons,spendCharge,swiftFactor,stepBoons,validBoons} from './god-boons.js';
import {createAdventure,stepAdventure,adventureAction,expeditionRunning,applyAdventureIntents,validateRestore as restoreAdventure} from './adventure.js';
import {chopTree,stepTrees,logAction,releaseLog,resolveTrees,createTreeIndex,restoreHarvested,restoreLogs,TREE_LIMITS} from './trees.js';
import {ENT,ENT_SPELLS,entTargets,createEnt,rememberAwakened,pruneAwakened,stepEntRooting,restoreEntTrees,validEnt} from './ents.js';
export const HZ = 60;
export const MAX_PLAYERS = 8;
const BOUND = 55, MAX_WORLD = 64;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const copy = value => structuredClone(value);
const fail = code => ({ok: false, code, events: []});
const ok = (events = []) => ({ok: true, events});
const safeSeq = n => Number.isSafeInteger(n) && n > 0;
const cleanName = value => (typeof value === 'string' ? value : 'Guest').trim().replace(/[\r\n\t]/g, ' ').slice(0, 24) || 'Guest';
const validPoint = p => Array.isArray(p) && p.length === 3 && p.every(finite) && Math.abs(p[0]) <= BOUND && Math.abs(p[2]) <= BOUND && Math.abs(p[1]) <= 1000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const validPosition = p => Array.isArray(p) && p.length === 3 && p.every(finite) &&
  Math.abs(p[0]) <= BOUND && Math.abs(p[2]) <= BOUND && Math.abs(p[1]) <= 200;
const validTick = (n, current, minimum = -1000, future = 0) => Number.isSafeInteger(n) && n >= minimum && n <= current + future;

function pose(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.position) || value.position.length !== 3 ||
      !value.position.every(n => finite(n) && Math.abs(n) <= 2.5) || Math.hypot(...value.position) > 2.5 ||
      !Array.isArray(value.quaternion) || value.quaternion.length !== 4 ||
      !value.quaternion.every(n => finite(n) && Math.abs(n) <= 1.01)) return null;
  const length = Math.hypot(...value.quaternion);
  if (length * length < 0.5 || length * length > 1.5) return null;
  return {position: [...value.position], quaternion: value.quaternion.map(n => n / length)};
}


function spawn(state, ignored = '') {
  let best = [0, 0, 8], clearance = -1;
  const trees=createTreeIndex();trees.update(state);const cuts=new Map(state.harvestedTrees.map(h=>[h.id,h])),forgeY=terrainHeight(state,0,0,false);
  for (let i = 0; i < 128; i++) {
    const theta = i * 2.3999632297, radius = 2.8 * Math.sqrt(i);
    const candidate = [clamp(Math.cos(theta) * radius, -BOUND, BOUND), 0, clamp(8 + Math.sin(theta) * radius, -BOUND, BOUND)];
    candidate[1]=terrainHeight(state,candidate[0],candidate[2]);
    resolveForge(candidate,forgeY);if(state.landmarks)resolveStartingWorld(candidate,(x,z)=>terrainHeight(state,x,z));resolveTrees(candidate,trees,cuts,(x,z)=>terrainHeight(state,x,z));
    if(candidate.some((v,k)=>k!==1&&Math.abs(v)>49.5))continue;
    const others = [...state.players.filter(p => p.role === 'hero' && p.id !== ignored), ...state.enemies];
    const hazards=state.fireCells.filter(c=>c.burning);
    const space = Math.min(10000,...others.map(p => distance(candidate, p.position)),...hazards.map(c=>Math.hypot(candidate[0]-c.x,candidate[2]-c.z)));
    if (space > clearance) { best = candidate; clearance = space; }
    if (space >= 2.5) break;
  }
  best[1] = terrainHeight(state, best[0], best[2]);
  return best;
}

function event(kind, position, id) { return {kind, position: [...position], id}; }
function nextId(state, prefix) {
  const ids=[...state.players,...state.enemies,...state.edits,...state.groves,...state.pendingStarfalls,...state.deposits,...state.pickups,...state.bridges,...state.projectiles,...state.embeds,...state.detachedParts,...(state.fireSurfaces||[]),...(state.looseLogs||[]),...(state.meteorRewards||[]),...(state.settlement?.workers||[]),...(state.awakenedTrees||[]),...(state.wildTrees||[])].flatMap(x=>x.editId?[x.id,x.editId]:[x.id]);
  let id; do{id=`${prefix}${++state.idCounter}`;}while(ids.some(x=>x===id||x.startsWith(id+'_')||x.startsWith(id+'-')));return id;
}
function damageEnemy(state, enemy, amount, events, ownerId) {
  return hitEnemyPart(state,enemy,'torso',amount,ownerId?{ownerId}:null,{nextId,terrainHeight},events);

}
function damageHero(state, hero, amount, events) {
  if((hero.protectedUntil??0)>state.tick)return;
  hero.hp -= amount;
  events.push({...event('hit', hero.position, hero.id),material:'flesh',sourceMaterial:'bone'});
  if (hero.hp <= 0) {
    if(hero.stats)hero.stats.deaths=Math.min(1e9,hero.stats.deaths+1);
    events.push(event('death', hero.position, hero.id));
    releaseHeld(state,hero,[0,0,0]); releaseLog(state,hero);
    const rally=state.inventions?.structures.find(b=>b.id===hero.rally&&b.type==='sanctuary'&&b.hp>0&&b.side===(hero.side||'party'));
    hero.hp = 100; hero.position = rally?[rally.position[0]+2.4,terrainHeight(state,rally.position[0]+2.4,rally.position[2]),rally.position[2]]:spawn(state, hero.id); hero.vy = 0; hero.move = [0, 0];hero.velocity=[0,0,0]; hero.protectedUntil=state.tick+180;
    events.push({...event('respawn',hero.position,hero.id),protectedUntil:hero.protectedUntil});
  }
}

function newState({room = 'LOCAL', seed = 41} = {}) {
  if (typeof room !== 'string' || !room || room.length > 64 || !Number.isSafeInteger(seed)) throw Error('Invalid room or seed');
  return {version: 1, contentVersion: 3, landmarks:true, room, seed, tick: 0, idCounter: 0, players: [], enemies: [], edits: [], groves: [], harvestedTrees: [], deposits: initialDeposits().concat([{id:'landmarkOre1',x:-21,z:11,kind:'stone',hits:0,maxHits:3,depleted:false},{id:'landmarkOre2',x:22,z:18,kind:'meteor',hits:0,maxHits:5,depleted:false},{id:'landmarkOre3',x:24,z:20,kind:'meteor',hits:0,maxHits:5,depleted:false}]), pickups: [
    ...createTestingSupplies(STRUCTURES.timberline.cost,baseHeight),
    {id:'watchCache',kind:'gems',x:-6,z:-22,y:baseHeight(-6,-22),amount:3},{id:'sanctuaryCache',kind:'stone',x:-25,z:11,y:baseHeight(-25,11),amount:4},
    {id:'apple1',kind:'apple',x:-2,z:6,y:baseHeight(-2,6),amount:1},{id:'apple2',kind:'apple',x:2,z:6.5,y:baseHeight(2,6.5),amount:1}], bridges: [],
    meteorRewards: [], projectiles: [], embeds: [], detachedParts: [], fireCells:[],fireSurfaces:[], looseLogs: [], adventure: createAdventure({seed}), settlement:createSettlement(), inventions:createInventions(), pendingStarfalls: [], bloom: 0, springs: [], awakenedTrees: [], wildTrees: [], shrine: {position: [0, baseHeight(0, 0), 0], hp: 100, maxHp: 100, disabledUntil: 0}};
}

function instantiate(state) {
  let fireSampleProvider=null;
  const fireContext={nextId,terrainHeight,fireSamples:e=>fireSampleProvider?.(e),damageHero:(s,p,n,events)=>{const start=events.length;damageHero(s,p,n,events);for(let i=start;i<events.length;i++)events[i].fire=true;},damageEnemy:(s,e,n,events)=>{const start=events.length;damageEnemy(s,e,n,events);for(let i=start;i<events.length;i++)events[i].fire=true;}};
  const combatContext={nextId,terrainHeight,playerVelocity:p=>p.role==='hero'?[p.velocity?.[0]||0,p.vy,p.velocity?.[2]||0]:[0,0,0],fireContact:(s,shot,hit)=>fireContact(s,shot,hit,fireContext)};
  const inventionContext={nextId,terrainHeight,createEnemy,damageEnemy,hitEnemyPart,chopTree};
  const player = id => state.players.find(p => p.id === id);
  // Trees: spatial index for trunk/stump collision; logs and felling are stepped from shared/trees.js.
  const treeIndex = createTreeIndex();
  const addPickup = (kind,x,z,amount) => { if (state.pickups.length >= 256) return null; const idNew=nextId(state,'p'); state.pickups.push({id:idNew,kind,x,z,y:terrainHeight(state,x,z),amount}); return idNew; };
  const treeContext = {terrainHeight, nextId, makePickup: addPickup};
  // A leaving player's pack falls where they stood (gems first: star shards are finite) in <=10-unit pickups, at most 24,
  // so a Hero who leaves mid-expedition cannot strand the team. Parked reconnect records rejoin with an empty pack (no duplicates).
  const dropCarried = p => { let slot = 0; for (const kind of MATERIAL_KEYS) { while ((p.resources?.[kind] | 0) > 0 && slot < 24) {
    const n = Math.min(10, p.resources[kind]), a = slot * 2.39996, r = .7 + .25 * (slot % 3);
    if (!addPickup(kind, clamp(p.position[0] + Math.cos(a) * r, -BOUND, BOUND), clamp(p.position[2] + Math.sin(a) * r, -BOUND, BOUND), n)) return;
    p.resources[kind] -= n; slot++; } } };
  // Optional Forge Expedition (shared/adventure.js): command results since the last step feed its deed tracking.
  const adventureEvents = [], adventureContext = {createEnemy, terrainHeight};
  const api = {
    addPlayer({id, name = 'Guest', role = 'hero'} = {}) {
      if (!validId(id) || player(id)) return fail('invalid_player');
      if (!['hero', 'god'].includes(role)) return fail('invalid_role');
      if (state.players.length >= MAX_PLAYERS) return fail('room_full');
      const position = spawn(state);
      state.players.push({id, name: cleanName(name), role, position, yaw: 0, hp: 100, mana: 100,
        move: [0, 0], vy: 0,velocity:[0,0,0], inputTick: -1000, attackTick: -1000, castTick: -1000,
        roleTick: -1000, seq: 0, stats:{kills:0,deaths:0,harvested:0,contribution:0}, tool: 'axe', side:'party', resources: emptyMaterials()});
      return ok([event('join', position, id)]);
    },
    removePlayer(id) {
      const p = player(id); if (!p) return fail('not_joined');
      releaseHeld(state,p,[0,0,0]); releaseLog(state,p);if(p.heldOre){p.resources[p.heldOre]++;delete p.heldOre;}dropCarried(p);
      state.players.splice(state.players.indexOf(p), 1);
      return ok([event('leave', p.position, id)]);
    },
    command(id, message) {
      const p = player(id);
      if (p && message?.type === 'adventure') {
        if (!safeSeq(message.seq)) return fail('invalid_sequence');
        if (message.seq <= p.seq) return fail('duplicate_sequence');
        p.seq = message.seq;
        if(message.action==='start')reclaimDepletedDeposits(state);
        const r = adventureAction(state.adventure, id, message, state);
        if (!r.ok) return fail(r.code);
        applyAdventureIntents(state, r.intents, adventureContext); return ok(r.events);
      }
      const result = api.baseCommand(id, message, p);
      // Optional attribution: events caused by a player's action name that player (public id) so clients
      // can scope physical feedback. Never overwrites; older clients ignore it.
      if (result.ok && message?.type === 'action') for (const e of result.events || []) if (e && e.by === undefined) e.by = id;
      recordSettlementDeaths(state,result.events);
      if (result.events?.length && adventureEvents.length < 256) adventureEvents.push(...result.events);
      return result;
    },
    baseCommand(id, message) {
      const p = player(id);
      if (!p) return fail('not_joined');
      if (!message || typeof message !== 'object') return fail('invalid_message');
      if (message.type === 'role') {
        if (!['hero', 'god'].includes(message.role)) return fail('invalid_role');
        if (state.tick - p.roleTick < 120) return fail('cooldown');
        if (p.role !== message.role) {
          releaseHeld(state,p,[0,0,0]); releaseLog(state,p);
          p.role = message.role; p.roleTick = state.tick; p.move = [0, 0]; p.vy = 0;p.velocity=[0,0,0];
          if (p.role === 'hero') p.position = spawn(state, p.id);
        }
        return ok();
      }
      if (!['input', 'action', 'cast'].includes(message.type)) return fail('unknown_message');
      if (!safeSeq(message.seq)) return fail('invalid_sequence');
      if (message.seq <= p.seq) return fail('duplicate_sequence');
      p.seq = message.seq; // Even a rejected payload consumes a valid sequence.
      if (message.type === 'input') {
        const m = message.move;
        if (!m || !finite(m.x) || !finite(m.z) || !finite(message.yaw) || Math.abs(message.yaw) > 100000 ||
            (message.head !== undefined && !pose(message.head)) ||
            (message.hands !== undefined && (!Array.isArray(message.hands) || message.hands.length > 2 || !message.hands.every(h => pose(h))))) return fail('invalid_input');
        let x = clamp(m.x, -1, 1), z = clamp(m.z, -1, 1), size = Math.hypot(x, z);
        if (size > 1) { x /= size; z /= size; }
        p.move = p.role === 'hero' ? [x, z] : [0, 0];
        p.yaw = ((message.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        p.inputTick = state.tick;
        if (message.jump === true && p.role === 'hero' && p.vy === 0) p.vy = 5.5;
        if (message.head !== undefined) p.head = pose(message.head);
        if (message.hands !== undefined) p.hands = message.hands.map(pose);
        return ok();
      }
      if (message.type === 'action') {
        if(typeof message.action==='string'&&message.action.startsWith('invention'))return inventionAction(state,p,message,inventionContext);
        if(typeof message.action==='string'&&message.action.startsWith('forge')&&p.side==='rivals')return fail('not_your_structure');
        if(typeof message.action==='string'&&message.action.startsWith('forge'))return settlementAction(state,p,message,{nextId,terrainHeight,createEnemy});
        if (message.action === 'useResource') return useResource(state,p,message);
        if (message.action === 'collectTarget') return collectTarget(state,p,message,{terrainHeight,combatAction,combatContext});
        if (p.role !== 'hero') return fail('invalid_action');
        if (message.action === 'equip') {
          if (!TOOLS.includes(message.tool) || (message.tool==='limb'&&!state.detachedParts.some(d=>d.heldBy===p.id))) return fail('invalid_action');
          if(message.tool!=='limb')releaseHeld(state,p,[0,0,0]);
          p.tool = message.tool; return ok();
        }
        // Held logs own grab/release/stow first; a full hand blocks swings until the log is dropped or stowed.
        const logResult=logAction(state,p,message);if(logResult)return logResult;
        if(message.action==='special'&&['axe','pick'].includes(p.tool))reclaimDepletedDeposits(state);
        const combatResult=combatAction(state,p,message,combatContext);if(combatResult)return combatResult;
        if (message.action === 'interact') {
          const target=nearestCollectible(state,p,{height:(x,z)=>terrainHeight(state,x,z,false)});
          return target?collectTarget(state,p,{targetId:target.id},{terrainHeight,combatAction,combatContext}):ok();
        }
        if (message.action === 'buildBridge') {
          if (state.bridges.length >= 32) return fail('world_limit');
          if (p.resources.wood < 3) return fail('insufficient_resources');
          const x = clamp(p.position[0]-Math.sin(p.yaw)*3,-BOUND,BOUND), z = clamp(p.position[2]-Math.cos(p.yaw)*3,-BOUND,BOUND);
          if(Math.hypot(x,z)<7)return fail('protected_forge');
          p.resources.wood -= 3; const idNew = nextId(state,'b'); const y = Math.max(...[-2.5,0,2.5].map(d=>terrainHeight(state,clamp(x-Math.sin(p.yaw)*d,-BOUND,BOUND),clamp(z-Math.cos(p.yaw)*d,-BOUND,BOUND))))+.12;
          state.bridges.push({id:idNew,x,z,y,yaw:p.yaw}); return ok([event('build',[x,y,z],idNew)]);
        }
        if (message.action !== 'strike') return fail('invalid_action');
        const supplied = message.targetId !== undefined;
        if (supplied && (!validId(message.targetId) || !validPoint(message.point) || !Array.isArray(message.normal) || message.normal.length !== 3 || !message.normal.every(finite) || Math.abs(Math.hypot(...message.normal)-1)>.02)) return fail('invalid_action');
        const requestedTool = message.tool === undefined ? p.tool : message.tool;
        if (!['axe','pick','hammer','limb'].includes(requestedTool) || requestedTool !== p.tool) return fail('invalid_action');
        // 27 ticks is the legacy .45 s cadence; pick is the requested .48 s (29 ticks).
        const cooldown = {axe:27,pick:29,hammer:40,limb:32}[requestedTool];
        if (state.tick - p.attackTick < cooldown) return fail('cooldown');
        const requestedOre=state.deposits.find(d=>d.id===message.targetId);
        if(requestedTool==='pick'&&requestedOre&&!requestedOre.depleted&&requestedOre.hits===requestedOre.maxHits-1&&state.pickups.length>=256)return fail('world_limit');
        p.attackTick = state.tick;
        const facing = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
        const inReach = target => {
          const dx = target.position[0] - p.position[0], dz = target.position[2] - p.position[2];
          const d = Math.hypot(dx, dz);
          return Math.abs(target.position[1] - p.position[1]) <= 2.5 && d <= 2.8 &&
            (d < 0.5 || (facing[0] * dx + facing[1] * dz) / d >= 0.45) ? d : Infinity;
        };
        const targetOK = q => { const dx=q.x-p.position[0], dz=q.z-p.position[2], d=Math.hypot(dx,dz); return d<=3.2 && (d<.5 || (facing[0]*dx+facing[1]*dz)/d>=.45) && Math.abs((q.y ?? terrainHeight(state,q.x,q.z))-p.position[1])<=3; };
        const events = [];
        const makePickup = (kind,x,z,amount) => { if (state.pickups.length < 256) { const idNew=nextId(state,'p'); state.pickups.push({id:idNew,kind,x,z,y:terrainHeight(state,x,z),amount}); return idNew; } return null; };
        const sanctuary = supplied ? strikeWaygate(state, p, message, events) : null;
        if (sanctuary) return ok(sanctuary);
        const tree = worldTrees(state).find(t => t.id === message.targetId);
        const ore = state.deposits.find(d => d.id === message.targetId);
        if (supplied && tree) {
          if (requestedTool !== 'axe' || !targetOK({x:tree.x,z:tree.z,y:terrainHeight(state,tree.x,tree.z)})) return ok();
          // Persisted notch at the struck height/side; third cut hinges the upper section (shared/trees.js).
          const chop=chopTree(state,tree,message.point,message.normal,{terrainHeight:(x,z)=>terrainHeight(state,x,z)});
          return chop.code?fail(chop.code):ok(chop.events);
        }
        if (supplied && ore) {
          // Ore is anchored to visible earth; a bridge deck overhead is not its contact surface.
          const oreFloor=terrainHeight(state,ore.x,ore.z,false);
          // A Raise Wall segment is quarried anywhere on its face, from its foot up to the crest.
          const face=ore.special==='wall'?RAISE_WALL.peak:0,reachY=Math.max(oreFloor-face,Math.min(oreFloor,p.position[1]));
          if (requestedTool !== 'pick' || ore.depleted || !targetOK({x:ore.x,z:ore.z,y:reachY}) || (face ? Math.hypot(message.point[0]-ore.x,message.point[2]-ore.z) > RAISE_WALL.width+.5 : Math.hypot(message.point[0]-ore.x,message.point[2]-ore.z) > 1.5) || message.point[1]>oreFloor+2 || message.point[1]<oreFloor-face-2) return ok();
          if(ore.hits===ore.maxHits-1&&state.pickups.length>=256)return fail('world_limit');
          ore.hits++; events.push({...event('stone_hit',message.point,ore.id),material:'stone',normal:[...message.normal]});
          if (ore.hits >= ore.maxHits) { ore.depleted=true; collapseMinedWall(state,ore); const reward=depositReward(ore.kind);makePickup(reward.kind,ore.x,ore.z,reward.amount);if(ore.kind==='meteor')makePickup('gems',ore.x+.3,ore.z,2); events.push(event('ore_break',[ore.x,terrainHeight(state,ore.x,ore.z),ore.z],ore.id)); } return ok(events);
        }
        if (supplied) {
          const building=state.inventions.structures.find(b=>b.id===message.targetId);
          if(building){if(inReach(building)<Infinity&&Math.hypot(message.point[0]-building.position[0],message.point[2]-building.position[2])<4)damageInvention(state,building.id,requestedTool==='hammer'?55:25,p.id,events);return ok(events);}
          const salvage=mineGolemRemains(state,p,message,combatContext);if(salvage)return salvage;
          const hitEnemy=state.enemies.find(e=>e.id===message.targetId);
          if(hitEnemy && inReach(hitEnemy)<Infinity && validPartHit(hitEnemy,message.part||'torso',message.point)){const charge=spendCharge(state,p);if(charge)events.push({kind:'charged_strike',id:hitEnemy.id,by:p.id,position:[...message.point],hits:p.charge?.hits||0});hitEnemyPart(state,hitEnemy,message.part||'torso',(requestedTool==='hammer'?70:requestedTool==='limb'?30:34)+charge,{...message,tool:requestedTool,ownerId:p.id},combatContext,events);}
          else if(message.targetId==='shrine')return fail('permanent_forge');
          return ok(events); // No fallback to another target when a precise surface missed.
        }
        const enemy = state.enemies.map(e => [e, inReach(e)]).sort((a, b) => a[1] - b[1])[0];
        if (enemy && Number.isFinite(enemy[1])) {const charge=spendCharge(state,p);if(charge)events.push({kind:'charged_strike',id:enemy[0].id,by:p.id,position:[...enemy[0].position],hits:p.charge?.hits||0});damageEnemy(state, enemy[0], 34+charge, events,p.id);}
        return ok(events);
      }
      if (p.role !== 'god') return fail('role_required');
      const spell = message.spell;
      const line=spell==='sunder'||spell==='wall';
      if(line && (message.start!==undefined||message.end!==undefined) && (!validPoint(message.start)||!validPoint(message.end)||distance(message.start,message.end)<.5||distance(message.start,message.end)>18))return fail('invalid_cast');
      const lineCount=line?earthLineEdits(message.start,message.end):1;
      if (!Object.hasOwn(COST, spell) || !validPoint(message.point)) return fail('invalid_cast');
      // Mana is the only rule that refuses a cast; placement rules move it instead.
      const point = settleCastPoint(spell, message.point, {expedition: expeditionRunning(state.adventure)});
      if (bloomLevel(state.bloom) < SPELL_BLOOM[spell]) return fail('bloom_locked');
      if (p.mana < COST[spell]) return fail('insufficient_mana');
      if(spell==='crystal'||spell==='starfall'||spell==='wall')reclaimDepletedDeposits(state); // a wall reclaims room for its quarry stone
      // Terrain is unlimited: the oldest settled earthworks fold into the baked ground to make room.
      if(['raise','lower','sunder','wall','starfall'].includes(spell))makeTerrainRoom(state,(line?lineCount:1)+state.pendingStarfalls.length);
      if ((['skeleton','squad','golem'].includes(spell) && state.enemies.length+(spell==='squad'?4:1)>MAX_WORLD) ||
          ((spell === 'grove' || spell === 'ring') && state.groves.length >= MAX_WORLD) ||
          (['raise','lower','sunder','wall'].includes(spell) && state.edits.length + state.pendingStarfalls.length + (line?lineCount:1) > MAX_WORLD) || (spell==='crystal' && state.deposits.length+state.pendingStarfalls.length>=80) ||
          (spell === 'starfall' && state.edits.length + state.pendingStarfalls.length >= MAX_WORLD) ||
          (spell === 'starfall' && (state.pendingStarfalls.length >= 8 || state.deposits.length+state.pendingStarfalls.length>=80))) return fail('world_limit');
      // Ents: the God awakens trees that already stand. Nothing to wake is the only refusal besides mana and world limits.
      const entTrees=ENT_SPELLS.includes(spell)?entTargets(worldTrees(state),state.harvestedTrees,spell,point):null;
      if(entTrees&&!entTrees.length)return fail('no_tree');
      const entRoom=entTrees?Math.min(entTrees.length,ENT.maxAwake-state.enemies.filter(e=>e.kind==='ent').length,MAX_WORLD-state.enemies.length):0;
      if(entTrees&&entRoom<=0)return fail('ent_limit');
      if(entTrees&&state.awakenedTrees.length+entRoom>ENT.records){pruneAwakened(state);if(state.awakenedTrees.length+entRoom>ENT.records)return fail('world_limit');}
      p.mana -= COST[spell]; p.castTick = state.tick;
      const idNew = nextId(state, spell[0]);
      const x = point[0], z = point[2], at = [x, terrainHeight(state, x, z), z], events = [event('cast', at, idNew)];
      const dx=x-p.position[0],dz=z-p.position[2],d=Math.hypot(dx,dz),ux=d>.001?dx/d:-Math.sin(p.yaw),uz=d>.001?dz/d:-Math.cos(p.yaw);
      const start=line?(message.start||[clamp(x-uz*3,-BOUND,BOUND),at[1],clamp(z+ux*3,-BOUND,BOUND)]):null;
      const end=line?(message.end||[clamp(x+uz*3,-BOUND,BOUND),at[1],clamp(z-ux*3,-BOUND,BOUND)]):null;
      const earth=line?castEarthLine(state,p,spell,idNew,start,end,{nextId},events):null;
      events.push({kind:'spell',spell,id:idNew,tick:state.tick,position:[...at],...(spell==='starfall'?{phase:'launch'}:{}),...(line?{start,end,rupture:earth.rupture,expireTick:earth.expireTick,by:p.id}:{})});
      if (spell === 'skeleton'||spell==='golem') state.enemies.push({...createEnemy(idNew,at,spell==='golem'?'golem':'skeleton'),emergeTick:state.tick});
      if(spell==='squad')for(let i=0;i<4;i++){const sx=clamp(x+(i%2?1:-1)*1.4,-BOUND,BOUND),sz=clamp(z+(i<2?-1:1)*1.4,-BOUND,BOUND);state.enemies.push({...createEnemy(`${idNew}_${i}`,[sx,terrainHeight(state,sx,sz),sz]),emergeTick:state.tick});}
      if(spell==='crystal')state.deposits.push({id:idNew,x,z,kind:'crystal',hits:0,maxHits:5,depleted:false});
      if(spell==='heal'||spell==='frost')quenchFire(state,at,7);
      if(spell==='spring'){if(state.springs.length>=BLOOM.spring.cap)state.springs.shift();state.springs.push({id:idNew,x,z,expireTick:state.tick+BLOOM.spring.ticks});quenchFire(state,at,BLOOM.spring.radius);}
      if(spell==='quake')for(const enemy of [...state.enemies])if(distance(enemy.position,at)<=8){enemy.slowUntil=Math.max(enemy.slowUntil??0,state.tick+180);damageEnemy(state,enemy,30,events,p.id);}
      if(spell==='lightning')for(const b of state.inventions.structures)if(distance(b.position,at)<=3)damageInvention(state,b.id,65,p.id,events);
      if(spell==='lightning')applyHeat(state,at,3,1,fireContext);
      if(spell==='heal')for(const hero of state.players)if(hero.role==='hero'&&distance(hero.position,at)<=7)hero.hp=Math.min(100,hero.hp+40);
      if(spell==='lightning')for(const enemy of [...state.enemies])if(distance(enemy.position,at)<=3)damageEnemy(state,enemy,80,events,p.id);
      if(spell==='frost')for(const enemy of state.enemies)if(distance(enemy.position,at)<=7)enemy.slowUntil=state.tick+300;
      if(entTrees)for(const [i,tree] of entTrees.slice(0,entRoom).entries()){
        if(!rememberAwakened(state,tree,state.enemies))break;
        const ent=createEnt(`${idNew}_${i}`,tree,[tree.x,terrainHeight(state,tree.x,tree.z),tree.z],state.tick);
        // Turn to face the nearest Hero as it tears free.
        const hero=state.players.filter(h=>h.role==='hero').sort((a,b)=>distance(a.position,ent.position)-distance(b.position,ent.position))[0];
        if(hero)ent.yaw=Math.atan2(-(hero.position[0]-tree.x),-(hero.position[2]-tree.z));
        state.enemies.push(ent);events.push({kind:'ent_wake',id:ent.id,treeId:tree.id,size:ent.size,position:[...ent.position],tick:state.tick,material:'wood'});
      }
      if (spell === 'grove' || spell === 'ring') {state.groves.push({id: idNew, x, z, ...(spell === 'ring' ? {kind:'ring'} : {})});addBloom(state,BLOOM.grove,events,at);}
      if (spell === 'raise'||spell==='lower') {
        state.edits.push({id: idNew, kind: spell, x, z, radius: 6, height: spell==='raise'?2:-2});
        liftActors(state);
      }
      if (spell === 'starfall') state.pendingStarfalls.push({id: idNew, x, z, radius: 5, impactTick: state.tick + 48,side:p.side||'party'});
      if (line) liftActors(state);
      events.push(...castBoons(state,p,spell,at,{nextId,terrainHeight,damageHero},{start,end,id:idNew}));
      return ok(events);
    },
    step() {
      state.tick++;
      if(hasActiveTerrain(state.edits,state.tick))settleTerrainContents(state);
      const events = [];
      let forgeY=terrainHeight(state,0,0,false);
      state.shrine.hp=100;state.shrine.disabledUntil=0;
      treeIndex.update(state); const treeCuts=new Map(state.harvestedTrees.map(h=>[h.id,h]));
      for (const p of state.players) {
        const previousPosition=[...p.position];
        p.mana = Math.min(100, p.mana + (3+(p.role==='god'?Math.min(2,state.groves.filter(g=>!state.harvestedTrees.some(t=>t.id.startsWith(g.id)&&t.cuts>=3)).length*.15):0)) / HZ);
        if (state.tick - p.inputTick > 18) p.move = [0, 0];
        if (p.role === 'hero') {
          const pace=5*swiftFactor(state,p)/HZ;moveOnTerrain(state,p.position,p.move[0]*pace,p.move[1]*pace);
          resolveTerrainBoundary(p.position);
        }
        p.vy -= 15 / HZ; p.position[1] += p.vy / HZ;
        if(p.role==='hero'){resolveForge(p.position,forgeY);resolveInventions(state,p.position);if(state.landmarks)resolveStartingWorld(p.position,(x,z)=>terrainHeight(state,x,z));resolveTrees(p.position,treeIndex,treeCuts,(x,z)=>terrainHeight(state,x,z));resolveTerrainBoundary(p.position);}
        const floor = p.role==='hero'?inventionFloor(state,p.position[0],p.position[2],forgeFloor(p.position[0],p.position[2],forgeY,terrainHeight(state,p.position[0],p.position[2])),p.position[1]):terrainHeight(state,p.position[0],p.position[2]);
        if (p.position[1] <= floor) { p.position[1] = floor; p.vy = 0; }
        let vx=(p.position[0]-previousPosition[0])*HZ,vz=(p.position[2]-previousPosition[2])*HZ;
        if(!p.move[0]&&!p.move[1]){vx=0;vz=0;}
        // Collision corrections and spawn relocation are not locomotion impulse.
        const speed=Math.hypot(vx,vz);if(speed>5){vx*=5/speed;vz*=5/speed;}
        p.velocity=p.role==='hero'?[vx,p.vy,vz]:[0,0,0];
      }
      stepBoons(state); stepBloom(state, events); stepWaygate(state, {terrainHeight}, events);
      for (const pending of [...state.pendingStarfalls]) {
        if (pending.impactTick > state.tick) continue;
        state.pendingStarfalls.splice(state.pendingStarfalls.indexOf(pending), 1);
        const at = [pending.x, terrainHeight(state, pending.x, pending.z), pending.z];
        for (const e of [...state.enemies]) if (distance(at, e.position) <= 6) damageEnemy(state, e, 90, events);
        for (const p of state.players) if (p.role === 'hero' && distance(at, p.position) <= 5) damageHero(state, p, 18, events);
        for(const b of state.inventions.structures)if(distance(b.position,at)<=5)damageInvention(state,b.id,90,null,events,pending.side||'party');
        state.edits.push({id: pending.id, kind: 'starfall', x: pending.x, z: pending.z, radius: 5, height: -1});
        const awakens = meteorAwakens(state.seed,pending.id) && state.enemies.length < MAX_WORLD;
        if (!awakens && state.deposits.length < 80) state.deposits.push({id:`${pending.id}_meteor`,x:pending.x,z:pending.z,kind:'meteor',hits:0,maxHits:5,depleted:false});
        addFuel(state,at,2,.35,true);applyHeat(state,at,5,1,fireContext);
        if (awakens) { const enemy=createEnemy(`${pending.id}_creature`,[pending.x,terrainHeight(state,pending.x,pending.z),pending.z],'golem'); Object.assign(enemy,{meteorBorn:true,unfurlTick:state.tick}); state.enemies.push(enemy); events.push({kind:'meteor_unfurl',id:enemy.id,position:[...enemy.position],tick:state.tick}); }
        liftActors(state); events.push(event('cast', at, pending.id));events.push({kind:'spell',spell:'starfall',phase:'impact',position:at,id:pending.id,tick:state.tick});
      }
      stepCrystalWalls(state,combatContext,hitEnemyPart,events);
      forgeY=terrainHeight(state,0,0,false); // Starfall may have changed the ground.
      stepEnemies(state,{
        ground:(x,z)=>inventionFloor(state,x,z,forgeFloor(x,z,forgeY,terrainHeight(state,x,z))),
        resolve:(position,radius=.28,height=1.65)=>{resolveForge(position,forgeY,radius,height);resolveInventions(state,position,radius,height);if(state.landmarks)resolveStartingWorld(position,(x,z)=>terrainHeight(state,x,z),radius,height);resolveTrees(position,treeIndex,treeCuts,(x,z)=>terrainHeight(state,x,z),radius,height);resolveTerrainBoundary(position,radius);return position;},
        damageHero,damageStructure:(id,n,ev)=>damageInvention(state,id,n,null,ev),events
      });
      stepEntRooting(state,treeIndex.all(),{terrainHeight,nextId,logLimit:TREE_LIMITS.logs,makePickup:addPickup,blocked:(x,z)=>state.inventions.structures.some(b=>Math.hypot(b.position[0]-x,b.position[2]-z)<3)||(state.landmarks&&STARTING_SITES.some(q=>Math.hypot(x-q.x,z-q.z)<q.radius+1))},events);
      flushMeteorRewards(state,terrainHeight);
      renewGeology(state,{terrainHeight,canPlace:(x,z)=>!state.inventions.structures.some(b=>Math.hypot(b.position[0]-x,b.position[2]-z)<5)},events);
      stepVeins(state,{terrainHeight,canPlace:(x,z)=>!state.inventions.structures.some(b=>Math.hypot(b.position[0]-x,b.position[2]-z)<5),retained:d=>retainedDepositPredicate(state)(d)},events);
      stepCombat(state,combatContext,events);
      stepFire(state,fireContext,events);
      stepTrees(state,treeContext,treeIndex,events);
      stepSettlement(state,{nextId,terrainHeight,damageEnemy,collapseMinedWall,
        ground:(x,z)=>inventionFloor(state,x,z,forgeFloor(x,z,forgeY,terrainHeight(state,x,z))),
        resolve:(position,radius=.24,height=1.65)=>{resolveForge(position,forgeY,radius,height);resolveInventions(state,position,radius,height);if(state.landmarks)resolveStartingWorld(position,(x,z)=>terrainHeight(state,x,z),radius,height);resolveTrees(position,treeIndex,treeCuts,(x,z)=>terrainHeight(state,x,z),radius,height);resolveTerrainBoundary(position,radius);return position;}
      },events,adventureEvents);
      stepInventions(state,inventionContext,events);
      const expedition = stepAdventure(state.adventure, state, adventureEvents.concat(events)); adventureEvents.length = 0;
      if (expedition.intents.length) applyAdventureIntents(state, expedition.intents, adventureContext);
      events.push(...expedition.events);
      state.shrine.hp=100;state.shrine.disabledUntil=0;
      return events;
    },
    setFireSamples(provider){fireSampleProvider=typeof provider==='function'?provider:null;},
    projectileContact(message){const result=projectileContact(state,message,combatContext);recordSettlementDeaths(state,result.events);return result;},
    snapshot() {
      return copy({tick: state.tick, time: state.tick / HZ, seed: state.seed, room: state.room,
        players: state.players.map(({id, name, role, side, roleTick, position,velocity, yaw, hp, mana, tool, resources, heldOre,rally,heat,overheatUntil,flaskLit, stats, castTick,attackTick,flameTick,specialTick,protectedUntil,siegebird,charge,swiftUntil,head, hands}) =>
          ({id, name, role, side, roleTick, position,velocity:velocity||[0,0,0], yaw, hp, mana, tool, resources, stats,...(heldOre?{heldOre}:{}),...(rally?{rally}:{}),castTick,attackTick,flameTick:flameTick??-1000, heat:heat||0,overheatUntil:overheatUntil||0,flaskLit:!!flaskLit,...(specialTick!==undefined?{specialTick}:{}),...(protectedUntil!==undefined?{protectedUntil}:{}),...(siegebird?{siegebird:{...siegebird}}:{}),...(charge?{charge:{...charge}}:{}),...(swiftUntil!==undefined?{swiftUntil}:{}), ...(head ? {head} : {}), ...(hands ? {hands} : {})})),
        enemies: state.enemies, projectiles: state.projectiles, embeds: state.embeds, detachedParts: state.detachedParts,
        edits: state.edits, ...(state.terrainBake?{terrainBake:state.terrainBake}:{}), groves: state.groves, pendingStarfalls: state.pendingStarfalls, bloom: state.bloom, springs: state.springs, ...(state.waygate ? {waygate: state.waygate} : {}),
        harvestedTrees: state.harvestedTrees, deposits: state.deposits, pickups: state.pickups, bridges: state.bridges,
        fireCells:state.fireCells,fireSurfaces:state.fireSurfaces,looseLogs:state.looseLogs,adventure:state.adventure,settlement:state.settlement,inventions:state.inventions,
        awakenedTrees:state.awakenedTrees,wildTrees:state.wildTrees,contentVersion: 4, landmarks:state.landmarks, shrine: state.shrine, maxPlayers: MAX_PLAYERS});
    },
    checkpoint() { return copy(state); },
    adventureWorld() { return state; },
    applyAdventure(intents) { return applyAdventureIntents(state, intents, adventureContext); },
  };
  return api;
}

function liftActors(state) { settleTerrainContents(state); }

export function createSimulation(options) { return instantiate(newState(options)); }
export function loadSimulation(saved) {
  // Validate every nested gameplay field before it can enter the simulation loop.
  if (!record(saved) || saved.version !== 1 || !Number.isSafeInteger(saved.tick) || saved.tick < 0 ||
      !Number.isSafeInteger(saved.idCounter) || saved.idCounter < 0 ||
      !Array.isArray(saved.players) || !Array.isArray(saved.enemies) || !Array.isArray(saved.edits) ||
      !Array.isArray(saved.groves) || !Array.isArray(saved.pendingStarfalls) ||
      saved.players.length > MAX_PLAYERS || saved.enemies.length > MAX_WORLD ||
      saved.edits.length + saved.pendingStarfalls.length > MAX_WORLD || saved.groves.length > MAX_WORLD ||
      saved.pendingStarfalls.length > 8)
    throw Error('Invalid simulation checkpoint');
  const ids = new Set();
  const unique = id => { if (!validId(id) || id === 'shrine' || ids.has(id)) return false; ids.add(id); return true; };
  const validXZ = item => finite(item.x) && finite(item.z) && Math.abs(item.x) <= BOUND && Math.abs(item.z) <= BOUND;
  const harvested = saved.harvestedTrees === undefined ? [] : saved.harvestedTrees;
  const deposits = saved.deposits === undefined ? initialDeposits() : saved.deposits;
  const pickups = saved.pickups === undefined ? [] : saved.pickups;
  const bridges = saved.bridges === undefined ? [] : saved.bridges;
  if (!Array.isArray(harvested) || !Array.isArray(deposits) || !Array.isArray(pickups) || !Array.isArray(bridges) || harvested.length > 256 || deposits.length + saved.pendingStarfalls.length > 80 || pickups.length > 256 || bridges.length > 32) throw Error('Invalid simulation content');
  for (const p of saved.players) {
    if (!record(p) || !unique(p.id) || typeof p.name !== 'string' || !p.name || p.name.length > 24 ||
        !['hero', 'god'].includes(p.role) || !validPosition(p.position) || !finite(p.yaw) || Math.abs(p.yaw) > Math.PI + 0.000001 ||
        !finite(p.hp) || p.hp <= 0 || p.hp > 100 || !finite(p.mana) || p.mana < 0 || p.mana > 100 ||
        !Array.isArray(p.move) || p.move.length !== 2 || !p.move.every(n => finite(n) && Math.abs(n) <= 1) ||
        Math.hypot(...p.move) > 1.000001 || (p.role === 'god' && Math.hypot(...p.move) > 0) ||
        !finite(p.vy) || Math.abs(p.vy) > 100 ||
        (p.velocity!==undefined&&(!Array.isArray(p.velocity)||p.velocity.length!==3||!p.velocity.every(n=>finite(n)&&Math.abs(n)<=100)||Math.hypot(p.velocity[0],p.velocity[2])>5.000001)) ||
        !validTick(p.inputTick, saved.tick) || !validTick(p.attackTick, saved.tick) ||
        !validTick(p.castTick, saved.tick) || !validTick(p.roleTick, saved.tick) ||
        !Number.isSafeInteger(p.seq) || p.seq < 0 ||
        (p.tool !== undefined && !TOOLS.includes(p.tool)) ||
        (p.stats!==undefined&&(!record(p.stats)||!['kills','deaths','harvested','contribution'].every(k=>finite(p.stats[k])&&p.stats[k]>=0&&p.stats[k]<=1e9&&(k==='contribution'||Number.isInteger(p.stats[k]))))) ||
        (p.protectedUntil !== undefined && !validTick(p.protectedUntil,saved.tick,0,180)) ||
        (p.specialTick !== undefined && !validTick(p.specialTick,saved.tick)) ||
        (p.siegebird !== undefined && !validSiegebird(p.siegebird)) || !validBoons(p, saved.tick) ||
        (p.heldOre!==undefined&&!['ironOre','mithrilOre','starOre'].includes(p.heldOre)) ||
        (p.rally!==undefined&&!validId(p.rally)) ||
        (p.side!==undefined&&!['party','rivals'].includes(p.side)) ||
        (p.resources !== undefined && (!record(p.resources) || !MATERIAL_KEYS.every(k => p.resources[k]===undefined || Number.isSafeInteger(p.resources[k]) && p.resources[k] >= 0 && p.resources[k] <= 999))) ||
        (p.head !== undefined && !pose(p.head)) ||
        (p.hands !== undefined && (!Array.isArray(p.hands) || p.hands.length > 2 || !p.hands.every(h => pose(h)))))
      throw Error('Invalid simulation player');
  }
  const entTrees = restoreEntTrees(saved), entAwake = new Set(entTrees.awakenedTrees.map(t => t.id));
  for (const e of saved.enemies) {
    if(e?.emergeTick!==undefined&&!validTick(e.emergeTick,saved.tick,0))throw Error('Invalid enemy emergence');
    if (!record(e) || !unique(e.id) || !validPosition(e.position) || !finite(e.yaw) || Math.abs(e.yaw) > Math.PI + 0.000001 ||
        (e.attackTarget!==undefined&&!validId(e.attackTarget)) || !finite(e.hp) || e.hp <= 0 || e.hp > enemyMaxHp(e) || !validEnt(e,saved,entAwake) || (e.slowUntil!==undefined&&!validTick(e.slowUntil,saved.tick,0,300)) || !validTick(e.attackTick, saved.tick) || (e.hurtTick !== undefined && !validTick(e.hurtTick,saved.tick)) || (e.meteorBorn!==undefined && (e.meteorBorn!==true || e.kind!=='golem' || !validTick(e.unfurlTick,saved.tick,0))) || (e.unfurlTick!==undefined && e.meteorBorn!==true) || (e.launchTick!==undefined && !validTick(e.launchTick,saved.tick,saved.tick-PICK_WALL.launchTicks)))
      throw Error('Invalid simulation enemy');
  }
  for (const e of saved.edits) {
    if (!record(e) || !unique(e.id) || !validXZ(e) ||
        !((e.kind === 'raise' && e.radius === 6 && e.height === 2) || (e.kind === 'lower' && e.radius === 6 && e.height === -2) ||
          (e.kind === 'starfall' && e.radius === 5 && e.height === -1) ||
          (e.kind === 'sunder' && (e.wall === undefined ? e.radius === 2.5 && e.height === -1.5 : validateWallSegment(e, saved.tick))) || (e.kind === 'wall' && (e.wall === undefined ? e.radius === 2.5 && e.height === 1.5 && e.rupture === undefined : validateWallSegment(e, saved.tick))) ||
          (e.kind === 'axe_sunder' && e.radius === 1.35 && e.height === -.12) || (e.kind === 'pick_wall' && (e.wall === undefined ? e.radius === 1 && e.height === 2.4 && e.rupture === undefined : validateWallSegment(e, saved.tick)))))
      throw Error('Invalid simulation edit');
  }
  for (const g of saved.groves) {
    if (!record(g) || !unique(g.id) || !validXZ(g) || (g.kind !== undefined && g.kind !== 'ring')) throw Error('Invalid simulation grove');
  }
  const treeIds=new Set(worldTrees(saved).map(t=>t.id));
  for (const t of entTrees.wildTrees) if (!treeIds.has(t.id)) throw Error('Invalid rooted tree'); // an id cannot be both awake and rooted
  if (entTrees.wildTrees.length + worldTrees({...saved,wildTrees:[]}).length !== treeIds.size) throw Error('Duplicate rooted tree');
  const harvestedTrees=restoreHarvested({...saved,harvestedTrees:harvested},treeIds); // strict; legacy felled trees count as landed (wood already awarded)
  const contentIds = new Set([...ids, 'shrine', ...treeIds, ...entAwake, ...saved.pendingStarfalls.map(p=>p.id)]);
  for (const d of deposits) if (!record(d) || !validId(d.id) || contentIds.has(d.id) || !validXZ(d) || !Object.hasOwn(DEPOSIT_CATALOG,d.kind) || !Number.isInteger(d.hits) || d.hits < 0 || d.hits > DEPOSIT_CATALOG[d.kind].maxHits || d.maxHits !== DEPOSIT_CATALOG[d.kind].maxHits || typeof d.depleted !== 'boolean' || (d.depleted !== (d.hits >= d.maxHits))) throw Error('Invalid deposit'); else contentIds.add(d.id);
  const veinSlots=new Set();for(const d of deposits)validateVein(d,saved.tick,veinSlots);
  const linkedWalls=new Set();
  for(const d of deposits) {
    if(d.special!==undefined&&!['axe_sunder',...WALL_DEPOSITS].includes(d.special))throw Error('Invalid special deposit');
    if(d.special!==undefined&&d.kind!=='stone')throw Error('Invalid special material');
    if(WALL_DEPOSITS.includes(d.special)) {
      const edit=saved.edits.find(e=>e.id===d.editId);
      if(!validId(d.editId)||linkedWalls.has(d.editId)||(d.depleted?!!edit&&!(edit.wall&&edit.wall.expireTick<=saved.tick):!edit)||edit&&(edit.kind!==d.special||edit.x!==d.x||edit.z!==d.z)||d.special==='wall'&&edit&&!edit.wall)throw Error('Invalid wall linkage');
      linkedWalls.add(d.editId);
    } else if(d.editId!==undefined)throw Error('Invalid wall linkage');
  }
  if(saved.edits.some(e=>e.kind==='pick_wall'&&!linkedWalls.has(e.id)))throw Error('Unmineable wall'); // Raise Wall quarry stone is optional
  for (const q of pickups) if (!record(q) || !validId(q.id) || contentIds.has(q.id) || ![...MATERIAL_KEYS,'apple'].includes(q.kind) || !validXZ(q) || (q.side!==undefined&&!['party','rivals'].includes(q.side)) || !finite(q.y) || Math.abs(q.y)>200 || !Number.isInteger(q.amount) || q.amount < 1 || q.amount > (/^ingot/.test(q.id) ? 999 : 10)) throw Error('Invalid pickup'); else contentIds.add(q.id);
  for (const b of bridges) if (!record(b) || !validId(b.id) || contentIds.has(b.id) || !validXZ(b) || !finite(b.y) || Math.abs(b.y)>200 || !finite(b.yaw) || Math.abs(b.yaw)>Math.PI+.000001) throw Error('Invalid bridge'); else contentIds.add(b.id);
  const meteorRewards=saved.meteorRewards??[];
  if(!Array.isArray(meteorRewards)||meteorRewards.length>64)throw Error('Invalid meteor rewards');
  for(const r of meteorRewards)if(!record(r)||!validId(r.id)||contentIds.has(r.id)||!validXZ(r)||r.amount!==6)throw Error('Invalid meteor reward');else contentIds.add(r.id);
  const looseLogs=restoreLogs(saved,contentIds);
  for (const pending of saved.pendingStarfalls) {
    if (!record(pending) || (pending.side!==undefined&&!['party','rivals'].includes(pending.side)) || !unique(pending.id) || !validXZ(pending) || pending.radius !== 5 ||
        !validTick(pending.impactTick, saved.tick, saved.tick + 1, 48) || pending.impactTick <= saved.tick)
      throw Error('Invalid simulation Starfall');
  }
  validateCombat(saved,contentIds);
  const shrine = saved.shrine;
  if (!record(shrine) || !validPosition(shrine.position) || shrine.position[0] !== 0 || shrine.position[2] !== 0 ||
      shrine.position[1] !== baseHeight(0, 0) || shrine.maxHp !== 100 || !finite(shrine.hp) ||
      shrine.hp < 0 || shrine.hp > 100 || !validTick(shrine.disabledUntil, saved.tick, 0, 480) ||
      (shrine.hp === 0 && shrine.disabledUntil <= saved.tick))
    throw Error('Invalid simulation shrine');
  const state = newState({room: saved.room, seed: saved.seed});
  state.tick = saved.tick;
  state.idCounter = saved.idCounter;
  state.players = copy(saved.players).map(p => ({id: p.id, name: p.name, role: p.role, position: p.position,
    stats:Object.fromEntries(['kills','deaths','harvested','contribution'].map(k=>[k,p.stats?.[k]||0])),
    yaw: p.yaw, hp: p.hp, mana: p.mana, move: p.move, vy: p.vy,velocity:p.velocity||[0,0,0], inputTick: p.inputTick,
    attackTick: p.attackTick, castTick: p.castTick, roleTick: p.roleTick, seq: p.seq, tool: p.tool || 'axe', side:p.side||'party',...(p.heldOre?{heldOre:p.heldOre}:{}),...(p.rally?{rally:p.rally}:{}), resources: restoreMaterials(p.resources),
    ...(p.protectedUntil!==undefined?{protectedUntil:p.protectedUntil}:{}),heat:p.heat||0,overheatUntil:p.overheatUntil||0,flameTick:p.flameTick??-1000,flaskLit:!!p.flaskLit,
    ...(p.specialTick!==undefined?{specialTick:p.specialTick}:{}),...(p.siegebird?{siegebird:{n:p.siegebird.n,golden:p.siegebird.golden,hits:p.siegebird.hits,...(p.siegebird.quick!==undefined?{quick:p.siegebird.quick,wind:p.siegebird.wind}:{})}}:{}),...(p.charge?{charge:{hits:p.charge.hits,until:p.charge.until}}:{}),...(p.swiftUntil!==undefined?{swiftUntil:p.swiftUntil}:{}), ...(p.head ? {head: p.head} : {}), ...(p.hands ? {hands: p.hands} : {})}));
  state.enemies = copy(saved.enemies).map(({id, position, yaw, hp, attackTick, attackTarget,hurtTick,kind,parts,missingParts,slowUntil,armor,meteorBorn,unfurlTick,scorch,burnUntil,burnPart,emergeTick,launchTick,size,treeId,variant,treeHeight,wakeTick,shield,shieldBroken,flinchTick}) => ({id, position, yaw, hp, attackTick,...(kind==='ent'?{size,treeId,variant,treeHeight,wakeTick}:{}),...(launchTick!==undefined?{launchTick}:{}),...(scorch?{scorch}:{}),...(burnUntil!==undefined?{burnUntil,burnPart}:{}),...(emergeTick!==undefined?{emergeTick}:{}),...(attackTarget?{attackTarget}:{}),...(meteorBorn?{meteorBorn:true,unfurlTick}:{}),kind:kind||'skeleton',parts:parts?Object.fromEntries(PARTS.map(p=>[p,parts[p]])):enemyParts(kind,size),missingParts:missingParts||[],...(kind==='golem'?{armor:armor??3}:{}), ...(slowUntil!==undefined?{slowUntil}:{}), ...(hurtTick !== undefined ? {hurtTick} : {}),...(shield!==undefined?{shield}:{}),...(shieldBroken?{shieldBroken:true}:{}),...(flinchTick!==undefined?{flinchTick}:{})}));
  Object.assign(state,restoreCombat(saved),restoreFire(saved,ids));
  if(!validateTerrainRuptures(saved.edits,saved.tick))throw Error('Invalid terrain rupture');
  state.edits = saved.edits.map(restoreTerrainEdit); const bake = restoreTerrainBake(saved.terrainBake); if (bake) state.terrainBake = bake; state.groves = copy(saved.groves);
  state.pendingStarfalls = copy(saved.pendingStarfalls); Object.assign(state, restoreBloom(saved, ids));
  state.harvestedTrees = harvestedTrees; state.looseLogs = looseLogs; Object.assign(state, entTrees);
  if (saved.adventure !== undefined) { const restored = restoreAdventure(saved.adventure); if (!restored.ok) throw Error('Invalid expedition: ' + restored.code); state.adventure = restored.adventure; }
  state.settlement=restoreSettlement(saved.settlement,saved.tick,contentIds,new Set(saved.enemies.map(e=>e.id)));
  state.inventions=restoreInventions(saved.inventions,saved.tick);
  for(const b of state.inventions.structures){if(contentIds.has(b.id))throw Error('Duplicate structure');contentIds.add(b.id);}
  state.deposits = deposits.map(({id,x,z,kind,hits,maxHits,depleted,special,editId,vein,respawnTick})=>({id,x,z,kind,hits,maxHits,depleted,...(special?{special}:{}),...(editId?{editId}:{}),...(vein!==undefined?{vein}:{}),...(respawnTick!==undefined?{respawnTick}:{})}));
  state.meteorRewards=copy(meteorRewards);
  state.pickups = pickups.map(({id,kind,x,z,y,amount,side})=>({id,kind,x,z,y,amount,...(side?{side}:{})}));
  state.bridges = bridges.map(({id,x,z,y,yaw})=>({id,x,z,y,yaw}));
  if(saved.landmarks!==undefined&&typeof saved.landmarks!=='boolean')throw Error('Invalid landmark version');
  state.landmarks=saved.landmarks===true;
  const waygate=restoreWaygate(saved);if(waygate)state.waygate=waygate;
  state.shrine = copy(saved.shrine); // Includes break/restore timer.
  return instantiate(state);
}
