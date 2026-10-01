'use strict';

// Durable, physical workshop ledger.  It deliberately has no dependency on World
// so it can be migrated in before the runtime starts calling it.
const crypto = require('node:crypto');
const {RESOURCES, TOOLS, UPGRADES} = require('./progression');

const SIEGEBIRD = '20dc22c5-7bcc-43df-b07f-e81eab521b0f';
const MAX_TOKENS = 2000;
const MAX_MODULES = 500;
const MAX_RECEIPTS = 256;
const MATERIALS = [
  {id:'rat_tail',name:'Rat tail',use:'Tier 2 donation or Quickwind mechanism.'},
  {id:'lumber',name:'Lumber',use:'Alternative Tier 2 workshop donation.'},
  {id:'stone',name:'Stone',use:'Alternative Tier 2 workshop donation.'},
  {id:'iron',name:'Iron',use:'Tier 3 donation or Quickwind mechanism.'},
  {id:'apple',name:'Apple',use:'Verdant restorative module.'},
  {id:'spore',name:'Spore',use:'Verdant restorative module.'},
  {id:'crystal',name:'Crystal',use:'Truesight optic module.'},
  {id:'haunted_bone',name:'Haunted bone',use:'Tier 3 donation or Truesight optic module.'},
  {id:'sky_bloom',name:'Sky bloom',use:'Hearth ward module.'},
  {id:'ember_core',name:'Ember core',use:'Tier 4 donation or Hearth ward module.'},
];
const CATALOG = [
  {kind:'quickwind',name:'Quickwind',tier:2,costs:{iron:2,rat_tail:1},compatible:[SIEGEBIRD],description:'Halves Siegebird crank turns.'},
  {kind:'truesight',name:'Truesight',tier:3,costs:{crystal:2,haunted_bone:1},compatible:[SIEGEBIRD],description:'Extends the standard Siegebird weak-point sight from 25 to 42 metres. Headshot damage is already standard.'},
  {kind:'verdant',name:'Verdant',tier:3,costs:{apple:2,spore:1},compatible:'all',description:'Heals on alternate action once every ten seconds.'},
  {kind:'hearth',name:'Hearth',tier:4,costs:{ember_core:1,sky_bloom:2},compatible:'all',description:'Grants a three-second ward on alternate action, once every eight seconds.'},
];

function init(world) {
  if (!world || !world.player || typeof world.player !== 'object') throw Error('Workshop needs a valid world player.');
  if (world.player.workshop === undefined) world.player.workshop = freshWorkshop(world.player.tier);
  validate(world);
  return snapshot(world);
}

function snapshot(world) {
  validate(world);
  const w = world.player.workshop;
  return {
    revision:w.revision,
    donations:{tier:w.donations.tier,option:w.donations.option,counts:bucketCounts(w.tokens)},
    tokens:w.tokens.map(publicToken),
    modules:w.modules.map(m=>({id:m.id,kind:m.kind})),
    sockets:{...w.sockets},
    catalog:CATALOG.map(spec=>({...spec,costs:{...spec.costs},compatible:Array.isArray(spec.compatible)?[...spec.compatible]:spec.compatible})),
    materials:MATERIALS.map(m=>({...m})),
  };
}

function act(world, action, body, store = null) {
  if (typeof action !== 'string' || !ACTIONS.has(action)) throw Error('Unknown workshop action.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Workshop action body is required.');
  freshContext(world, !['material-take','material-return','material-place'].includes(action));
  validate(world);
  const requestId = request(body.requestId);
  const signature = stable({action,body:withoutRequest(body)});
  const w = world.player.workshop;
  const old = w.receipts.find(r=>r.id===requestId);
  if (old) {
    if (old.signature !== signature) throw Error('Request id was already used for a different workshop action.');
    return response(world, structuredClone(old.result));
  }
  const previous = structuredClone(world.player);
  try {
    const result = perform(world, action, body, store);
    w.revision++;
    w.receipts.push({id:requestId,signature,result:structuredClone(result)});
    if (w.receipts.length > MAX_RECEIPTS) w.receipts.splice(0, w.receipts.length - MAX_RECEIPTS);
    validate(world);
    world.save();
    world.log?.('WORKSHOP', {action,revision:w.revision,tier:world.player.tier,tokens:w.tokens.length,modules:w.modules.length});
    return response(world, result);
  } catch (error) {
    world.player = previous;
    throw error;
  }
}

const ACTIONS = new Set(['material-take','material-return','material-place','donate','withdraw','option','commit','module-craft','module-install','module-remove']);

function perform(world, action, body, store) {
  const w = world.player.workshop;
  switch (action) {
    case 'material-take': {
      const resource = resourceId(body.resource);
      if (w.tokens.length >= MAX_TOKENS) throw Error('Workshop token ledger is full.');
      debit(world.player, resource, 1);
      const token = {id:crypto.randomUUID(),resource,place:'loose',zone:world.context.zone,position:position(world.context.position)};
      w.tokens.push(token); return {token:publicToken(token)};
    }
    case 'material-return': {
      const token = looseToken(w, body.tokenId); w.tokens.splice(w.tokens.indexOf(token),1); credit(world.player, token.resource, 1);
      return {returned:token.resource};
    }
    case 'material-place': {
      const token = looseToken(w, body.tokenId); const nextZone=zone(body.zone); if(nextZone!==world.context.zone) throw Error('Place a token only in your current zone.'); token.position=position(body.position); token.zone=nextZone;
      return {token:publicToken(token)};
    }
    case 'option': {
      if (w.tokens.some(t=>t.place==='bucket')) throw Error('Withdraw all donated materials before changing the cost option.');
      const target=nextUpgrade(world.player); const option=optionIndex(target,body.option); w.donations.option=option;
      return {option};
    }
    case 'donate': {
      const target=nextUpgrade(world.player), option=optionIndex(target,body.option);
      if (w.donations.option !== option) throw Error('Choose this donation option before placing materials.');
      const token=looseToken(w,body.tokenId), costs=target.costs[option];
      if (!Object.hasOwn(costs,token.resource)) throw Error('This material is not needed by the selected workshop donation.');
      const counts=bucketCounts(w.tokens); if ((counts[token.resource]||0)>=costs[token.resource]) throw Error('This donation already has enough of that material.');
      token.place='bucket'; token.zone='forge_yard'; return {token:publicToken(token),donations:{tier:target.tier,option,counts:bucketCounts(w.tokens)}};
    }
    case 'withdraw': {
      const token=bucketToken(w,body.tokenId); token.place='loose'; token.zone=world.context.zone; token.position=position(world.context.position);
      return {token:publicToken(token)};
    }
    case 'commit': {
      const target=nextUpgrade(world.player); if (body.tier!==target.tier) throw Error('Commit the next workshop tier only.');
      const costs=target.costs[w.donations.option], counts=bucketCounts(w.tokens);
      if (!sameCounts(counts,costs)) throw Error('Place the exact selected materials in the donation bucket first.');
      w.tokens=w.tokens.filter(t=>t.place!=='bucket'); world.player.tier=target.tier;
      if (!world.player.unlocks.includes(target.milestone)) world.player.unlocks.push(target.milestone);
      w.donations={tier:target.tier<4?target.tier+1:null,option:0}; return {committedTier:target.tier};
    }
    case 'module-craft': {
      const spec=moduleSpec(body.kind); if (world.player.tier<spec.tier) throw Error(`This module needs workshop tier ${spec.tier}.`);
      if (w.modules.length>=MAX_MODULES) throw Error('Workshop module ledger is full.');
      for(const [r,n] of Object.entries(spec.costs)) if(amount(world.player,r)<n) throw Error('Insufficient module materials.');
      for(const [r,n] of Object.entries(spec.costs)) debit(world.player,r,n);
      const module={id:crypto.randomUUID(),kind:spec.kind}; w.modules.push(module); return {module:{...module}};
    }
    case 'module-install': {
      const module=moduleById(w,body.moduleId); const itemId=item(body.itemId); const spec=moduleSpec(module.kind);
      if (Object.values(w.sockets).includes(module.id)) throw Error('This module is already installed.');
      if (!owned(world,itemId,store)) throw Error('Own this weapon before installing a module.');
      if (spec.compatible!=='all'&&!spec.compatible.includes(itemId)) throw Error('This module is incompatible with that weapon.');
      const replaced=w.sockets[itemId]||null; w.sockets[itemId]=module.id; return {installed:{moduleId:module.id,itemId},replacedModuleId:replaced};
    }
    case 'module-remove': {
      const itemId=item(body.itemId); const moduleId=Object.hasOwn(w.sockets,itemId)?w.sockets[itemId]:null; if (!moduleId) throw Error('That weapon has no installed module.');
      delete w.sockets[itemId]; return {removed:{moduleId,itemId}};
    }
  }
}

function response(world,result) { return {...world.progression(),workshop:snapshot(world),...result}; }
function freshContext(world, forgeOnly = true) {
  if (!world.context || !Number.isFinite(world.seen) || Date.now()-world.seen>5000 || Date.now()<world.seen-5000) throw Error('Refresh your Forge Yard context.');
  if (forgeOnly && world.context.zone!=='forge_yard') throw Error('Use the workshop in the Forge Yard.');
  position(world.context.position);
}
function freshWorkshop(tier) { return {revision:0,donations:{tier:targetTier(tier),option:0},tokens:[],modules:[],sockets:{},receipts:[]}; }
function targetTier(tier) { return Number.isInteger(tier)&&tier<4?tier+1:null; }
function nextUpgrade(player) { const upgrade=UPGRADES.find(u=>u.tier===player.tier+1); if(!upgrade) throw Error('The workshop is already at its highest tier.'); return upgrade; }
function optionIndex(upgrade,value) { if(!Number.isInteger(value)||value<0||value>=upgrade.costs.length) throw Error('Unknown donation option.'); return value; }
function bucketCounts(tokens) { const counts={}; for(const t of tokens) if(t.place==='bucket') counts[t.resource]=(counts[t.resource]||0)+1; return counts; }
function sameCounts(actual,cost) { return Object.keys(cost).every(r=>actual[r]===cost[r])&&Object.keys(actual).every(r=>cost[r]===actual[r]); }
function publicToken(t) { return {id:t.id,resource:t.resource,place:t.place,zone:t.zone,position:{...t.position}}; }
function looseToken(w,id) { const t=tokenById(w,id); if(t.place!=='loose') throw Error('This token is not loose.'); return t; }
function bucketToken(w,id) { const t=tokenById(w,id); if(t.place!=='bucket') throw Error('This token is not in the donation bucket.'); return t; }
function tokenById(w,id) { id=uuid(id,'token'); const t=w.tokens.find(x=>x.id===id); if(!t) throw Error('Unknown material token.'); return t; }
function moduleById(w,id) { id=uuid(id,'module'); const m=w.modules.find(x=>x.id===id); if(!m) throw Error('Unknown module.'); return m; }
function moduleSpec(kind) { if(typeof kind!=='string') throw Error('Unknown module kind.'); const spec=CATALOG.find(x=>x.kind===kind); if(!spec) throw Error('Unknown module kind.'); return spec; }
function owned(world,id,store) { return TOOLS.some(t=>t.id===id)&&world.player.tools.includes(id) || Boolean(store&&typeof store.ready==='function'&&store.ready(id)); }
function debit(player,r,n) { if(amount(player,r)<n) throw Error('Insufficient material inventory.'); if(r==='rat_tail') player.tails-=n; else player.resources[r]-=n; player.resources.rat_tail=player.tails; }
function credit(player,r,n) { if(r==='rat_tail') player.tails+=n; else player.resources[r]+=n; player.resources.rat_tail=player.tails; }
function amount(player,r) { return r==='rat_tail'?player.tails:player.resources[r]; }
function resourceId(r) { if(!RESOURCES.includes(r)) throw Error('Unknown material resource.'); return r; }
function request(value) { if(typeof value!=='string'||!/^[-a-zA-Z0-9_.:]{1,160}$/.test(value)) throw Error('A valid workshop requestId is required.'); return value; }
function item(value) { if(typeof value!=='string'||!/^[-a-zA-Z0-9_.:]{1,160}$/.test(value)) throw Error('Invalid weapon id.'); return value; }
function zone(value) { if(typeof value!=='string'||!/^[-a-zA-Z0-9_.:]{1,100}$/.test(value)) throw Error('Invalid token zone.'); return value; }
function uuid(value,label) { if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw Error(`Invalid ${label} id.`); return value; }
function position(value) { if(!value||typeof value!=='object'||!['x','y','z'].every(k=>Number.isFinite(value[k])&&Math.abs(value[k])<=10000)) throw Error('Invalid token position.'); return {x:value.x,y:value.y,z:value.z}; }
function withoutRequest(body) { const out={}; for(const [k,v] of Object.entries(body)) if(k!=='requestId') out[k]=v; return out; }
function stable(value) { if(Array.isArray(value)) return '['+value.map(stable).join(',')+']'; if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}'; return JSON.stringify(value); }

function validate(world) {
  const p=world.player, w=p.workshop;
  if(!Number.isInteger(p.tier)||p.tier<1||p.tier>4||!p.resources||!Array.isArray(p.tools)||!Array.isArray(p.unlocks)||!Number.isSafeInteger(p.tails)||p.tails<0) throw Error('Invalid player state for workshop recovery.');
  for(const r of RESOURCES) if(r!=='rat_tail'&&(!Number.isSafeInteger(p.resources[r])||p.resources[r]<0)) throw Error('Invalid workshop material inventory.');
  if(!w||typeof w!=='object'||!Number.isSafeInteger(w.revision)||w.revision<0||!w.donations||!Array.isArray(w.tokens)||!Array.isArray(w.modules)||!w.sockets||typeof w.sockets!=='object'||Array.isArray(w.sockets)||!Array.isArray(w.receipts)) throw Error('Invalid workshop state; preserve player.json for recovery.');
  if(w.tokens.length>MAX_TOKENS||w.modules.length>MAX_MODULES||w.receipts.length>MAX_RECEIPTS||w.donations.tier!==targetTier(p.tier)||!Number.isInteger(w.donations.option)||(w.donations.tier===null?w.donations.option!==0:w.donations.option<0||w.donations.option>=UPGRADES.find(u=>u.tier===w.donations.tier).costs.length)) throw Error('Invalid workshop state; preserve player.json for recovery.');
  const ids=new Set(); for(const t of w.tokens){if(!t||typeof t!=='object'||!uuidValid(t.id)||ids.has(t.id)||!RESOURCES.includes(t.resource)||!['loose','bucket'].includes(t.place)) throw Error('Invalid workshop token state; preserve player.json for recovery.');ids.add(t.id);zone(t.zone);position(t.position);if(t.place==='bucket'&&t.zone!=='forge_yard')throw Error('Invalid bucket token state; preserve player.json for recovery.');}
  const bucket=bucketCounts(w.tokens);
  if(w.donations.tier===null?(Object.keys(bucket).length>0):!Object.entries(bucket).every(([r,n])=>Object.hasOwn(UPGRADES.find(u=>u.tier===w.donations.tier).costs[w.donations.option],r)&&n<=UPGRADES.find(u=>u.tier===w.donations.tier).costs[w.donations.option][r])) throw Error('Invalid workshop donation state; preserve player.json for recovery.');
  const mids=new Set(); for(const m of w.modules){if(!m||!uuidValid(m.id)||mids.has(m.id)||!CATALOG.some(c=>c.kind===m.kind))throw Error('Invalid workshop module state; preserve player.json for recovery.');mids.add(m.id);}
  const installed=new Set(); for(const [weapon,moduleId] of Object.entries(w.sockets)){item(weapon);if(!mids.has(moduleId)||installed.has(moduleId))throw Error('Invalid workshop socket state; preserve player.json for recovery.');installed.add(moduleId);}
  const rids=new Set();for(const r of w.receipts){if(!r||typeof r.id!=='string'||rids.has(r.id)||typeof r.signature!=='string'||!Object.hasOwn(r,'result'))throw Error('Invalid workshop receipt state; preserve player.json for recovery.');rids.add(r.id);}
}
function uuidValid(v){return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}

module.exports={init,snapshot,act,CATALOG};
