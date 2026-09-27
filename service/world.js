'use strict';
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('./forge-runtime');
const crypto = require('node:crypto');
const workshop = require('./workshop-ledger');
const quests=require('./quests');
const playful=require('./playful-context');
const challengeContext=require('./challenge-context');
const supplies=require('./supplies'); const profiles=require('./interaction-profiles');
const {RESOURCES,TOOLS,UPGRADES,policy}=require('./progression');
const VOICES = ['vesper','ripple','stone','meridian','cinder','marin','willow','quartz'];
class World {
  constructor(directory, log = () => {}) {
    this.file = path.join(directory, 'player.json'); this.log = log;
    this.player = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file,'utf8')) : {tails:0,favours:0,reservations:{},killed:[],collected:[]};
    if (!Number.isSafeInteger(this.player.tails) || this.player.tails < 0 || !Number.isSafeInteger(this.player.favours) || this.player.favours < 0 || !this.player.reservations || !Array.isArray(this.player.killed) || !Array.isArray(this.player.collected)) throw Error('Invalid saved player state; preserve data/player.json for recovery.');
    this.player.resources??={}; for(const r of RESOURCES){this.player.resources[r]??=0;if(!Number.isSafeInteger(this.player.resources[r])||this.player.resources[r]<0)throw Error('Invalid saved resources.');}
    this.player.resources.rat_tail=this.player.tails;
    this.player.tier??=1;this.player.unlocks??=[];this.player.tools??=TOOLS.filter(t=>t.tier===1).map(t=>t.id);this.player.gathered??=[];this.player.drop??=null;
    if(!Number.isInteger(this.player.tier)||this.player.tier<1||this.player.tier>4||!Array.isArray(this.player.unlocks)||!Array.isArray(this.player.tools)||!Array.isArray(this.player.gathered))throw Error('Invalid progression state; preserve player.json.');
    for(const tool of TOOLS.filter(t=>t.tier===1))if(!this.player.tools.includes(tool.id))this.player.tools.push(tool.id);
    this.player.deliveries??=[];
    if(!Array.isArray(this.player.deliveries)||this.player.deliveries.some(d=>!d||typeof d.id!=='string'||!TOOLS.some(t=>t.id===d.toolId)||!['pending','delivered'].includes(d.status)))throw Error('Invalid saved delivery queue.');
    workshop.init(this); supplies.ensure(this); quests.ensure(this);
    this.context = {position:{x:0,y:0,z:0},zone:'forge_yard',health:100,maxHealth:100,visiting:false,targets:[],equipped:'',controllers:[],interaction:null,worldChallenges:[]}; this.seen = 0;
    this.voice = {enabled:true,voice:'vesper',revision:0}; this.cooldowns = new Map();
  }
  save() {this.player.resources.rat_tail=this.player.tails;fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.player,null,2));fs.renameSync(this.file+'.tmp',this.file);}
  visiting() {return this.context.visiting && Date.now()-this.seen < 5000;}
  updateContext(value) {this.context={position:point(value.position),zone:typeof value.zone==='string'?identifier(value.zone):this.context.zone,health:Number.isFinite(value.health)?Math.max(0,Math.min(100,value.health)):(this.context.health??100),maxHealth:100,visiting:value.visiting===true,targets:targets(value.targets),equipped:typeof value.equipped==='string'?value.equipped.slice(0,80):'',controllers:controllers(value.controllers),interactionProfilesApplied:Object.fromEntries(Object.entries(value.interactionProfilesApplied||{}).slice(0,100).filter(([id,revision])=>/^[a-zA-Z0-9_.:-]{1,100}$/.test(id)&&Number.isSafeInteger(revision)&&revision>=0)),interaction:interaction(value.interaction),playful:playful.normalize(value.playful),worldChallenges:challengeContext.normalize(value.worldChallenges),presence:{distance:Number.isFinite(value.presence?.distance)?Math.max(0,Math.min(1000,value.presence.distance)):0,phase:["near","leaving","away"].includes(value.presence?.phase)?value.presence.phase:"away"}};this.seen=Date.now();return {ok:true};}
  kill(id) {id=identifier(id);if(!this.player.killed.includes(id)){if(this.player.killed.length>=20000)throw Error('Hunt ledger is full; archive player state before a new hunt.');this.player.killed.push(id);this.save();}return {ok:true};}
  tail(id) {id=identifier(id);if(!this.player.killed.includes(id))throw Error('This tail has not dropped from your hunt.');if(!this.player.collected.includes(id)){this.player.collected.push(id);this.player.tails++;this.save();this.log('TAIL collected',id);}return {tails:this.player.tails};}
  handin() {if(!this.visiting())throw Error('Bring your tails to Brann.');if(this.player.tails<5)throw Error('Five collected tails are required.');this.player.tails-=5;this.player.favours++;this.save();this.log('BOUNTY hand-in');return {tails:this.player.tails,favours:this.player.favours};}
  reserve(actor,id,args) {
    if(!this.visiting())throw Error('Visit Brann to commission an item.');
    if(!args){if(this.player.favours<1)throw Error('Bring five rat tails to Brann to earn a forging favour.');this.player.favours--;this.player.reservations[id]='reserved';}
    else {const p=policy(args);if(p.tier>this.player.tier&&!(p.tier===2&&this.player.favours>0))throw Error(`This invention needs workshop tier ${p.tier}. Bring the workshop upgrade materials to Brann.`);
      const favour=p.tier>this.player.tier&&this.player.favours>0?1:0;this.player.favours-=favour;this.player.reservations[id]={status:'reserved',favours:favour,tier:p.tier,capabilities:p.capabilities};}
    this.save();this.log('COMMISSION reserved',id);return {player:'local',id};
  }
  refund(job) {const r=this.player.reservations[job.id];if(r!=='reserved'&&r?.status!=='reserved')return;if(r==='reserved'){this.player.reservations[job.id]='refunded';this.player.favours++;}else{r.status='refunded';this.player.favours+=r.favours||0;}this.save();this.log('COMMISSION refunded',job.id);}
  reconcile(jobs) {for(const [id,status] of Object.entries(this.player.reservations)){if((status==='reserved'||status?.status==='reserved')&&(!jobs.some(j=>j.id===id)||jobs.some(j=>j.id===id&&['failed','cancelled','interrupted'].includes(j.status))))this.refund({id});}}
  progression() {const p=this.player;return {rpg:quests.snapshot(this),...(this.liveWorkshop?{liveWorkshop:this.liveWorkshop()}:{}),supplies:supplies.snapshot(this),interactionProfiles:profiles.snapshot(this),interactionCatalog:profiles.catalog(),workshop:workshop.snapshot(this),tails:p.tails,favours:p.favours,tier:p.tier,resources:{...p.resources,rat_tail:p.tails},unlocks:[...p.unlocks],tools:TOOLS.filter(t=>p.tools.includes(t.id)),defaultCombatTool:'bomb_glove',deliveries:p.deliveries.filter(d=>d.status==='pending').map(({requestKey,...d})=>({...d})),lastDelivery:(p.deliveries.filter(d=>d.status==='delivered').slice(-1).map(({requestKey,...d})=>({...d}))[0]||null),recipes:TOOLS.map(t=>({...t,available:t.tier<=p.tier,owned:p.tools.includes(t.id),cost:{}})),upgrades:UPGRADES.map(u=>({...u,available:u.tier===p.tier+1,completed:u.tier<=p.tier})),drop:p.drop,health:this.context.health??100,maxHealth:100};}
  gather(value) {const id=identifier(value.id),r=({timber:'lumber',spores:'spore',ember:'ember_core',bones:'haunted_bone',tails:'rat_tail'}[value.resource]||value.resource),n=value.amount??1;if(!RESOURCES.includes(r)||!Number.isInteger(n)||n<1||n>5)throw Error('Collect 1-5 of a known resource.');if(this.player.gathered.includes(id))return {...this.progression(),xpAwarded:0,levelUp:false};if(this.player.gathered.length>=50000)throw Error('Gather ledger full; archive state before continuing.');const before=structuredClone(this.player);try{this.player.gathered.push(id);if(r==='rat_tail')this.player.tails+=n;else this.player.resources[r]+=n;const awarded=quests.recordGather(this,r,n);this.save();this.log('RESOURCE gathered',r,n);return {...this.progression(),...awarded};}catch(error){this.player=before;throw error;}}

  upgrade(value={}) {if(this.player.workshop.tokens.some(t=>t.place==='bucket'))throw Error('Use the donation lever to commit your bucket materials.');if(!this.visiting())throw Error('Visit Brann to upgrade the workshop.');const tier=value.tier??this.player.tier+1;if(Number.isInteger(tier)&&tier<=this.player.tier&&tier>=2)return this.progression();const upgrade=UPGRADES.find(u=>u.tier===tier);if(!upgrade||tier!==this.player.tier+1)throw Error('Upgrade one workshop tier at a time.');this.player.resources.rat_tail=this.player.tails;const cost=upgrade.costs.find(c=>Object.entries(c).every(([r,n])=>this.player.resources[r]>=n));if(!cost)throw Error('Workshop needs '+upgrade.costs.map(c=>Object.entries(c).map(([r,n])=>`${n} ${r}`).join(' + ')).join(' or ')+'.');for(const [r,n] of Object.entries(cost)){this.player.resources[r]-=n;if(r==='rat_tail')this.player.tails-=n;}this.player.tier=tier;this.player.workshop.donations={tier:tier<4?tier+1:null,option:0};this.player.unlocks.push(upgrade.milestone);this.save();this.log('WORKSHOP upgraded',tier);return this.progression();}
  unlock(value) {const upgrade=UPGRADES.find(u=>u.milestone===value.milestone);if(!upgrade)throw Error('Unknown workshop milestone.');return this.upgrade({tier:upgrade.tier});}
  collectionTake(value) {
    if(Date.now()-this.seen>5000||this.context.zone!=='forge_yard')throw Error('Visit your collection in the Forge Yard.');
    const tool=TOOLS.find(t=>t.id===value.id);
    if(!tool)throw Error('Unknown workshop tool.');
    if(tool.tier>this.player.tier)throw Error(`This tool needs workshop tier ${tool.tier}.`);
    if(!this.player.tools.includes(tool.id)){this.player.tools.push(tool.id);this.save();}
    this.log('COLLECTION taken',tool.id);return {...this.progression(),tool};
  }
  craft(value) {if(!this.visiting())throw Error('Visit Brann to collect equipment.');const tool=TOOLS.find(t=>t.id===value.id);if(!tool)throw Error('Unknown workshop tool.');if(tool.tier>this.player.tier)throw Error(`This tool needs workshop tier ${tool.tier}.`);if(!this.player.tools.includes(tool.id)){this.player.tools.push(tool.id);this.save();}return {...this.progression(),tool};}
  issueTool(value,key) {
    if(typeof key!=='string'||!key||key.length>200)throw Error('A delivery request id is required.');
    const prior=this.player.deliveries.find(d=>d.requestKey===key);
    if(prior){if(prior.toolId!==value.id)throw Error('Delivery request id already belongs to another tool.');return this.deliveryResult(prior);}
    if(!this.visiting())throw Error('Visit Brann to collect equipment.');
    const tool=TOOLS.find(t=>t.id===value.id);if(!tool)throw Error('Unknown workshop tool.');if(tool.tier>this.player.tier)throw Error('This tool needs workshop tier '+tool.tier+'.');
    if(this.player.deliveries.length>=1000)throw Error('Delivery ledger full; archive it before issuing more tools.');
    if(this.player.deliveries.filter(d=>d.status==='pending').length>=16)throw Error('Collect pending tools before requesting more.');
    const previous=structuredClone(this.player);const delivery={id:crypto.randomUUID(),toolId:tool.id,status:'pending',createdAt:Date.now(),requestKey:key};
    if(!this.player.tools.includes(tool.id))this.player.tools.push(tool.id);
    this.player.deliveries.push(delivery);
    try{this.save();}catch(error){this.player=previous;throw error;}
    this.log('DELIVERY queued',delivery.id,tool.id);return this.deliveryResult(delivery);
  }
  deliveryResult(delivery){const {requestKey,...safe}=delivery;const tool=TOOLS.find(t=>t.id===delivery.toolId);return {tool,delivery:safe,status:delivery.status,message:delivery.status==='delivered'?tool.name+' was delivered to its named collection stand in the Forge Yard. Grip it to collect, or use Return to Stand if it is away.':tool.name+' is queued for delivery to your game. It has not reached its collection stand yet.',...this.progression()};}
  ackDelivery(value){const delivery=this.player.deliveries.find(d=>d.id===value.id);if(!delivery)throw Error('Unknown delivery.');if(delivery.status==='delivered')return this.deliveryResult(delivery);const previous=structuredClone(this.player);delivery.status='delivered';delivery.deliveredAt=Date.now();try{this.save();}catch(error){this.player=previous;throw error;}this.log('DELIVERY confirmed',delivery.id,delivery.toolId);return this.deliveryResult(delivery);}
  equip(value,store) {if(!this.player.tools.includes(value.id)&&!store?.ready(value.id))throw Error('Collect this tool first.');this.context.equipped=value.id;return {equipped:value.id};}
  death(value={}) {const position=value.position?point(value.position):this.context.position,zone=value.zone?identifier(value.zone):this.context.zone;const previous=this.player.drop?.resources||{};const resources={};for(const r of RESOURCES){resources[r]=(previous[r]||0)+(r==='rat_tail'?this.player.tails:this.player.resources[r]);this.player.resources[r]=0;}this.player.tails=0;this.context.health=100;this.player.drop={id:crypto.randomUUID(),position,zone,resources};this.save();this.log('EXPEDITION dropped',zone);return this.progression();}
  recover(value={}) {const drop=this.player.drop;if(!drop)return this.progression();if(value.id&&value.id!==drop.id)throw Error('That satchel is no longer here.');if(this.context.zone!==drop.zone||Math.hypot(...['x','y','z'].map(k=>this.context.position[k]-drop.position[k]))>3)throw Error('Stand near your dropped satchel to recover it.');for(const [r,n] of Object.entries(drop.resources)){if(r==='rat_tail')this.player.tails+=n;else this.player.resources[r]+=n;}this.player.drop=null;this.save();this.log('EXPEDITION recovered');return this.progression();}
  setVoice(value) {if(value.voice!==undefined&&!VOICES.includes(value.voice))throw Error('Unknown voice.');this.voice={enabled:value.enabled===true,voice:value.voice||this.voice.voice,revision:this.voice.revision+1};return this.voice;}
  snapshot() {return {commonGoods:{location:'Emberdew stand beside the forge',cost:'Free replenishing vials and reusable matchbox',controls:'Pull matchbox drawer or tap holding trigger; grip an individual match; stroke dark side striker; hold flame gently to vial wick; throw. Matchbox stows at left hip.',timers:'Matches and lit vial wicks each last 10 seconds. Fast match motion extinguishes it. Unlit or burned-out vials do not create fire.',ghosts:'Pinewood Ruins and Crystal Hollow: ONLY fire can damage or kill ghosts. Blades, bolts and ordinary bomb blasts cannot. Ghosts retreat from flames.'},game:'Branns Forge VR',playerId:'local',ratTails:this.player.tails,forgeFavours:this.player.favours,...this.progression(),...this.context,playful:playful.describe(this.context.playful,Date.now()-this.seen<5000),visiting:this.visiting()};}
  ability(value,store) {
    const item=store.ready(value.id);if(!item)throw Error('Collect a completed item first.');
    const now=Date.now();if((this.cooldowns.get('local')||0)>now)throw Error('The weapon is recharging.');
    const pos=point(value.position), forward=point(value.forward), list=targets(value.targets);
    const state=runtime.probeState();
    state.now=now;state.player.id='local';state.players=[{...state.player,alive:true}];
    state.player.facingX=Math.abs(forward.x)>Math.abs(forward.z)?Math.sign(forward.x):0;
    state.player.facingY=state.player.facingX===0?(Math.sign(forward.z)||1):0;
    state.rats=list.filter(t=>t.type==='rat').map(t=>({id:t.id,x:t.x-pos.x+10.5,y:t.z-pos.z+7.5,alive:t.alive}));
    const localTarget=t=>({...t,x:t.x-pos.x+10.5,y:t.z-pos.z+7.5});
    state.players.push(...list.filter(t=>['dummy','enemy','skeleton','boss','guardian','golem','wisp'].includes(t.type)).map(localTarget));
    state.resources=list.filter(t=>t.type==='resource').map(localTarget);state.anchors=list.filter(t=>t.type==='anchor').map(localTarget);state.barriers=list.filter(t=>t.type==='barrier').map(localTarget);
    state.capabilities=item.capabilities;state.interaction=interaction(value.interaction)||this.context.interaction;
    const source=fs.readFileSync(path.join(store.root,'data/forge-assets',value.id,'behavior.js'),'utf8');
    const actions=runtime.evaluateAbility(source,state).map(a=>({...a,x:a.x-10+pos.x,y:pos.y,z:a.y-7+pos.z}));
    this.cooldowns.set('local',now+item.cooldown*1000);return {actions,cooldown:item.cooldown};
  }
}
function point(p){if(!p||!['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=1000))throw Error('Invalid position.');return {x:p.x,y:p.y,z:p.z};}
function identifier(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(id))throw Error('Invalid hunt identifier.');return id;}
function targets(list){if(!Array.isArray(list))return [];if(list.length>100)throw Error('Too many targets.');return list.map(t=>({...point(t),id:identifier(t.id),alive:t.alive===true,type:['rat','dummy','enemy','skeleton','boss','guardian','golem','wisp','resource','anchor','barrier'].includes(t.type)?t.type:'dummy',enemy_type:['skeleton','boss','guardian','golem','wisp','rat'].includes(t.enemy_type)?t.enemy_type:'',resource:RESOURCES.includes(t.resource)?t.resource:'',requires:typeof t.requires==='string'?t.requires.slice(0,32):''}));}
function interaction(value){if(!value||typeof value!=='object')return null;return {phase:['formation','ready','release','impact','activate'].includes(value.phase)?value.phase:'activate',hand:value.hand==='left'?'left':'right',squeeze:Number.isFinite(value.squeeze)?Math.max(0,Math.min(1,value.squeeze)):0,formationSeconds:Number.isFinite(value.formationSeconds)?Math.max(0,Math.min(3,value.formationSeconds)):0};}
function controllers(value){if(!Array.isArray(value))return [];return value.slice(0,2).map(v=>({hand:typeof v.hand==='string'&&v.hand.includes('left')?'left':'right',profile:typeof v.profile==='string'?v.profile.slice(0,80):'unknown',haptics:v.haptics===true,tracked:v.tracked===true}));}
module.exports={World,VOICES};
