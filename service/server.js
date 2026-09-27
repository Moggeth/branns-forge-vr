'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Reuse authorized credentials in memory; never duplicate a secret file.
for(const file of [path.join(__dirname,'.env.local'),'C:/Users/mog/OneDrive/Documents/BomberWLAN/.env.local'])if(fs.existsSync(file))process.loadEnvFile(file);
const express=require('express');const {mountForge}=require('./forge');const {World}=require('./world');
const directory=process.env.BRANN_DATA_DIR||path.join(__dirname,'data');
fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(path.join(__dirname,'logs'),{recursive:true});
const logfile=path.join(__dirname,'logs',`server-${new Date().toISOString().replace(/[:.]/g,'-')}.log`);
function log(...parts){const line=new Date().toISOString()+' '+parts.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(logfile,line+'\n');console.log(line);}
const app=express();
app.use((req,res,next)=>{const host=req.headers.host||'';let allowed=/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);if(req.headers.origin){try{allowed=allowed&&new URL(req.headers.origin).host===host;}catch{allowed=false;}}if(!allowed||req.headers['x-forwarded-for'])return res.sendStatus(403);res.setHeader('Cache-Control','no-store');next();});
const {Tuning}=require('./tuning');const tuning=new Tuning(directory,log);
const world=new World(directory,log);
const workshop=require('./workshop-ledger');
const supplies=require('./supplies');const profiles=require('./interaction-profiles');
const {LivingWorkshop}=require('./living-workshop');
const living=new LivingWorkshop(directory,log,()=>forge.store.list());
const {Director}=require('./director');
const director=new Director(log);
world.liveWorkshop=()=>living.summary();
const voiceClients={};
function voiceClientState(){
 const managed=voiceClients.managed;
 if(managed&&Date.now()-managed.at<6000)return {...managed,connected:true};
 const browser=voiceClients.browser;
 return browser&&Date.now()-browser.at<6000?{...browser,connected:true}:{connected:false,managed:false,message:'Audio helper is not connected.'};
}
app.post('/api/forge/session',(req,res,next)=>{
 if(voiceClientState().managed&&req.headers['x-brann-audio-managed']!=='1')return res.status(409).json({error:'Voice is managed inside the game. Point at Brann and press trigger.'});
 next();
});
const forge=mountForge(app,{directory,root:process.env.BRANN_ROOT||__dirname,log,express,getGameContext:()=>world.snapshot(),reserveReward:(actor,id,args)=>world.reserve(actor,id,args),livingWorkshop:living,configureInvention:b=>profiles.configure(world,forge.store,b),issueTool:(b,key)=>world.issueTool(b,key),upgradeWorkshop:b=>({...world.progression(),status:'awaiting_physical_offering',message:'Take individual materials from your hip pouch, place them in the Living Workshop buckets, then pull the lever. Donations stay saved and can be retrieved. Conversation cannot pull the lever for you.'}),refundReward:job=>world.refund(job)});
world.reconcile(forge.store.jobs);
app.use('/api/vr',express.json({limit:'160kb'}));
app.get('/health',(_,res)=>res.json({app:'branns-forge-vr',pid:process.pid,port:Number(process.env.BRANN_PORT||8787),configured:Boolean(process.env.OPENAI_API_KEY)}));
app.get('/api/vr/state',(_,res)=>res.json({...world.progression(),liveWorkshop:living.snapshot(),tuning:tuning.snapshot(),items:forge.store.list().filter(j=>j.status==='ready').map(j=>({...forge.store.ready(j.id),modelUrl:`http://127.0.0.1:${process.env.BRANN_PORT||8787}${j.modelUrl}`})),handoffs:forge.store.list().filter(j=>j.status==='ready').map(j=>j.handoff),jobs:forge.store.list().map(j=>require('./craft-progress').jobProgress(j,forge.store.list())),voice:world.voice,voiceClient:voiceClientState(),visiting:world.visiting(),configured:Boolean(process.env.OPENAI_API_KEY)}));
function route(name,fn){app.post('/api/vr/'+name,async(req,res)=>{try{res.json(await fn(req.body||{}));}catch(e){log('VR request rejected',name,e.message);res.status(409).json({error:e.message});}});}
app.get('/api/vr/tuning',(_,res)=>res.json(tuning.snapshot()));
route('tuning',b=>tuning.change(b));
app.get('/api/vr/living/catalog',(_,res)=>res.json(require('./living-workshop').catalog()));
app.get('/api/vr/living/history',(req,res)=>res.json({history:living.history(req.query.id),events:living.inspect({id:req.query.id}).events}));
route('living/publish-batch',b=>living.publishBatch(b));
for(const action of ['publish','ack','rollback','event'])route('living/'+action,b=>living[action](b));
route('supplies',b=>supplies.apply(world,b));
route('quests/event',b=>require('./quests').record(world,b));
route('quests/action',b=>require('./quests').action(world,b));
route('interaction-profile',b=>profiles.configure(world,forge.store,b));
route('voice-client',b=>{
 if(typeof b.managed!=='boolean'||typeof b.message!=='string')throw Error('Invalid voice client status.');
 const key=b.managed?'managed':'browser',message=b.message.slice(0,200);
 if(voiceClients[key]?.message!==message)log('VOICE_CLIENT',key,message);
 voiceClients[key]={managed:b.managed,message,phase:["idle","opening","connecting","listening","error"].includes(b.phase)?b.phase:"idle",at:Date.now()};
 return {ok:true};
});
route('delivery-ack',b=>world.ackDelivery(b));
let speech={level:0,active:false,at:0};
route('speech',b=>{
 if(typeof b.level!=='number'||!Number.isFinite(b.level)||b.level<0||b.level>1||typeof b.active!=='boolean')throw Error('Invalid speech envelope.');
 speech={level:b.active?b.level:0,active:b.active,at:Date.now()};return {ok:true};
});
app.get('/api/vr/speech',(_,res)=>res.json(Date.now()-speech.at<600?speech:{level:0,active:false}));
app.post('/api/director/frame',express.raw({type:'image/jpeg',limit:'1500kb'}),(req,res)=>{
 try{res.json(director.acceptFrame(req.headers['x-director-session'],req.body));}
 catch(e){log('DIRECTOR_REJECT','frame',e.message);res.status(409).json({error:e.message});}
});
app.get('/api/director/frame',(req,res)=>{
 if(!director.frame||Number(req.query.after||0)>=director.frameSequence)return res.sendStatus(204);
 res.setHeader('X-Director-Sequence',String(director.frameSequence));
 res.type('image/jpeg').send(director.frame);
});
app.use('/api/director',express.json({limit:'32kb'}));
app.get('/api/director/state',(_,res)=>{director.viewerAt=Date.now();res.json(director.state());});
for(const [name,method] of [['session/start','start'],['snapshot','snapshot'],['poll','poll'],['command','command'],['camera','camera']]){
 app.post('/api/director/'+name,(req,res)=>{
  try{res.json(director[method](req.body||{}));}
  catch(e){log('DIRECTOR_REJECT',name,e.message);res.status(409).json({error:e.message});}
 });
}
route('context',b=>world.updateContext(b));route('kill',b=>world.kill(b.id));route('tail',b=>world.tail(b.id));route('handin',()=>world.handin());route('voice',b=>world.setVoice(b));
route('commission',b=>forge.store.commission({brief:b.brief,capabilities:b.capabilities,baseItemId:b.baseItemId,originalRequest:b.brief},typeof b.requestId==='string'?'vr-'+b.requestId:crypto.randomUUID(),'local'));
route('ability',b=>world.ability(b,forge.store));
for(const name of ['gather','craft','death','recover'])route(name,b=>world[name](b));
for(const action of ['material-take','material-return','material-place','donate','withdraw','option','commit','module-craft','module-install','module-remove']) route('workshop/'+action,b=>workshop.act(world,action,b,forge.store));
route('upgrade',b=>workshop.act(world,'commit',b,forge.store));
route('unlock',()=>{throw Error('Fill the Living Workshop buckets and pull its lever.');});
route('equip',b=>world.equip(b,forge.store));
route('collection-take',b=>world.collectionTake(b));
route('shutdown',()=>{setTimeout(()=>server.close(()=>process.exit(0)),750);return {stopping:true};});
app.use('/tuning',express.static(path.join(__dirname,'public/tuning')));
app.use('/voice',express.static(path.join(__dirname,'public')));
app.use('/director',express.static(path.join(__dirname,'public/director')));
app.use((error,req,res,next)=>{log('HTTP error',error.name);res.status(400).json({error:'Invalid request.'});});
const server=app.listen(Number(process.env.BRANN_PORT||8787),'127.0.0.1',()=>log('START',process.pid,'native OpenXR bridge','voiceConfigured='+Boolean(process.env.OPENAI_API_KEY)));
server.on('error',e=>{log('START failed',e.code);process.exitCode=1;});
process.on('uncaughtException',e=>{log('UNCAUGHT',e.stack);process.exit(1);});process.on('unhandledRejection',e=>log('REJECTION',e?.stack||String(e)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
module.exports={forge,world,living,director,server,app};
