'use strict';
const ID='20dc22c5-7bcc-43df-b07f-e81eab521b0f';
const FIELDS={damage:[65,140,95],bolt_speed:[18,65,44],reel_speed:[0.5,3,2.2],crank_break_distance:[0.2,0.55,0.38],crank_snap_seconds:[0.03,0.15,0.08],load_reach:[0.08,0.28,0.19]};
function snapshot(world){return structuredClone(world.player.interactionProfiles||{});}
function configure(world,store,args){
 if(!args||typeof args.id!=='string'||!store.ready(args.id))throw Error('Choose a completed invention.');
 if(args.id!==ID)throw Error('This invention has no registered live interaction profile yet.');
 if(!Object.hasOwn(FIELDS,args.setting)||!Number.isFinite(args.value))throw Error('Unsupported interaction setting.');
 const [min,max]=FIELDS[args.setting];if(args.value<min||args.value>max)throw Error(`Choose ${min} to ${max} for ${args.setting}.`);
 const before=structuredClone(world.player);const profiles=world.player.interactionProfiles??={};
 const profile=profiles[args.id]??=Object.fromEntries(Object.entries(FIELDS).map(([k,v])=>[k,v[2]]));
 profile[args.setting]=args.value;profile.revision=(profile.revision||0)+1;
 try{world.save();}catch(e){world.player=before;throw e;}
 world.log('INTERACTION_PROFILE',args.id,args.setting,args.value,profile.revision);
 return {status:'published',message:'Saved. The running game applies this profile on its next state refresh, including held equipment. No reload needed.',id:args.id,profile:{...profile}};
}
function catalog(){return {schema:1,profiles:{[ID]:{name:'Siegebird',components:['anchored-crank','finite-projectile','weakpoint-optic','physical-reel'],settings:FIELDS}},limits:'Live profile edits change only registered bounded parameters. Generated models and validated trigger abilities can arrive live. Arbitrary engine scripts, new physics systems and environments are not hot-loaded.'};}
module.exports={snapshot,configure,catalog};
