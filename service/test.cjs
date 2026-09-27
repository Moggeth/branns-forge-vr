const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {World}=require('./world');const {ForgeStore}=require('./forge');const runtime=require('./forge-runtime');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brann-vr-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,world:new World(dir)};}
function visit(w){w.updateContext({position:{x:0,y:0,z:2},visiting:true,targets:[]});}
function earn(w){for(let i=0;i<5;i++){w.kill('rat-'+i);w.tail('rat-'+i);}visit(w);w.handin();}
test('owned physical pickups, duplicate protection and five-tail hand-in',t=>{const {world:w}=fixture(t);assert.throws(()=>w.tail('foreign'));w.kill('rat-0');w.tail('rat-0');w.tail('rat-0');assert.equal(w.player.tails,1);assert.throws(()=>w.handin());for(let i=1;i<5;i++){w.kill('rat-'+i);w.tail('rat-'+i);}visit(w);w.handin();assert.equal(w.player.favours,1);assert.equal(w.player.tails,0);assert.throws(()=>w.handin());});
test('favour persistence and interrupted job refund exactly once',t=>{const {dir,world:w}=fixture(t);earn(w);w.reserve('local','job1');assert.equal(w.player.favours,0);const reloaded=new World(dir);reloaded.reconcile([{id:'job1',status:'interrupted'}]);reloaded.reconcile([{id:'job1',status:'interrupted'}]);assert.equal(reloaded.player.favours,1);});
test('worker launch failure refunds; no real worker launched',t=>{const {dir,world:w}=fixture(t);earn(w);const s=new ForgeStore(dir);s.reserveReward=(a,id)=>w.reserve(a,id);s.refundReward=j=>w.refund(j);s.worker={available:()=>true,start:()=>{throw Error('test launch failure');}};assert.throws(()=>s.commission({brief:'An original hammer'},'test','local'),/test launch failure/);assert.equal(w.player.favours,1);assert.equal(s.jobs[0].status,'failed');});
test('bounded JavaScript executes real damage, rejects host access and runaway logic',async()=>{await runtime.ready;const state=runtime.probeState();assert.equal(runtime.evaluateAbility('function forgeAbility(s){return [{type:"blast",x:11,y:7}]}',state)[0].type,'blast');assert.throws(()=>runtime.evaluateAbility('function forgeAbility(){while(true){}}',state));assert.throws(()=>runtime.evaluateAbility('function forgeAbility(){return process.env}',state));assert.throws(()=>runtime.evaluateAbility('function forgeAbility(){return [{type:"blast",x:900,y:0}]}',state));});
test('world-coordinate action mapping and shared player cooldown prevent equipment bypass',async t=>{await runtime.ready;const {dir,world:w}=fixture(t);const id='test-item';fs.mkdirSync(path.join(dir,'data/forge-assets',id),{recursive:true});fs.writeFileSync(path.join(dir,'data/forge-assets',id,'behavior.js'),'function forgeAbility(s){return [{type:"blast",x:11,y:7,duration:1}]}');const store={root:dir,ready:()=>({cooldown:4})};const b={id,position:{x:0,y:0,z:0},forward:{x:1,y:0,z:0},targets:[]};assert.deepEqual(w.ability(b,store).actions[0],{type:'blast',x:1,y:0,z:0,duration:1,color:'#8be4ff'});assert.throws(()=>w.ability({...b,id:'other-item'},store),/recharging/);});
test('expired visitor and invalid coordinates cannot commission',t=>{const {world:w}=fixture(t);earn(w);w.seen=0;assert.throws(()=>w.reserve('local','x'),/Visit/);assert.throws(()=>w.updateContext({position:{x:NaN,y:0,z:0}}));assert.throws(()=>w.setVoice({voice:'invented'}));});

test('craft estimates use successful history, admit uncertainty and never finish by elapsed time',()=>{
 const {jobProgress}=require('./craft-progress');
 const history=[{status:'ready',elapsedSeconds:384},{status:'failed',elapsedSeconds:3}];
 const start=1000000;
 let p=jobProgress({id:'a',status:'building',startedAt:start},history,start+60000);
 assert.equal(p.sampleCount,1);assert.equal(p.estimatedTotalSeconds,384);assert.ok(p.remainingHighSeconds>p.remainingLowSeconds);assert.ok(p.estimatedProgress<1);
 p=jobProgress({status:'building',startedAt:start},history,start+1000000);assert.equal(p.overEstimate,true);assert.ok(p.estimatedProgress<1);
 assert.equal(jobProgress({status:'queued'},history).remainingHighSeconds,null);
 assert.equal(jobProgress({status:'building',startedAt:start},[],start+1000).estimatedTotalSeconds,null);
 assert.equal(jobProgress({status:'ready',elapsedSeconds:384},history).estimatedProgress,1);
});
