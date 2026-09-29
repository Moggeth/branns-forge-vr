'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..');const godot=path.join(project,'tools/godot/Godot_v4.7.2-stable_win64_console.exe');
const root=fs.mkdtempSync(path.join(process.env.BRANN_TEST_ROOT||os.tmpdir(),'integration-'));const id='00000000-0000-4000-8000-000000000001';const asset=path.join(root,'data/forge-assets',id);fs.mkdirSync(asset,{recursive:true});
const started=performance.now();let service;
function run(args){return new Promise((resolve,reject)=>{const p=spawn(godot,process.env.BRANN_VERBOSE_TEST==='1'?['--verbose',...args]:args,{windowsHide:true});let out='';p.stdout.on('data',d=>{out+=d;process.stdout.write(d);});p.stderr.on('data',d=>{out+=d;process.stderr.write(d);});p.on('error',reject);p.on('exit',code=>code===0&&!/SCRIPT ERROR|ERROR:/.test(out)?resolve(out):reject(Error('Godot verification failed, exit '+code)));});}
(async()=>{try{
await run(['--headless','--xr-mode','off','--path',path.join(project,'godot'),'--script','test_fixture.gd','--',path.join(asset,'model.glb')]);
const spec={name:'Integration test hammer',description:'Offline test fixture: damages the nearest living enemy in local range.',capabilities:['blast'],color:'#75b8cb',cooldown:2};fs.writeFileSync(path.join(asset,'item.json'),JSON.stringify(spec));fs.writeFileSync(path.join(asset,'behavior.js'),'function forgeAbility(s){const r=[...s.rats,...s.players.filter(p=>p.id!==s.player.id)].filter(r=>r.alive&&r.x>=1&&r.x<20&&r.y>=1&&r.y<14&&Math.hypot(Math.floor(r.x)-Math.floor(s.player.x),Math.floor(r.y)-Math.floor(s.player.y))<=6).sort((a,b)=>Math.hypot(a.x-s.player.x,a.y-s.player.y)-Math.hypot(b.x-s.player.x,b.y-s.player.y))[0];return r?[{type:"blast",x:Math.floor(r.x),y:Math.floor(r.y),duration:1}]:[]}');
fs.writeFileSync(path.join(root,'data/forge-items.json'),'[]');
fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify({id,key:'test-only',status:'ready',spec,modelUrl:`/forge-assets/${id}/model.glb`}));
service=spawn(process.execPath,['integration-host.cjs'],{cwd:__dirname,windowsHide:true,env:{...process.env,OPENAI_API_KEY:'',BRANN_PORT:'8788',BRANN_DATA_DIR:path.join(root,'data'),BRANN_ROOT:root}});let serviceOutput='';service.stdout.on('data',d=>serviceOutput+=d);service.stderr.on('data',d=>serviceOutput+=d);
for(let tries=0;;tries++){try{const health=await fetch('http://127.0.0.1:8788/health').then(r=>r.json());if(health.app!=='branns-forge-vr'||health.pid!==service.pid)throw Error('Test port occupied');break;}catch(e){if(tries>30)throw e;await new Promise(r=>setTimeout(r,100));}}
let output=await run(['--headless','--xr-mode','off','--path',path.join(project,'godot'),'--','--smoke','--service=http://127.0.0.1:8788']);
output+='\n'+await run(['--headless','--xr-mode','off','--path',path.join(project,'godot'),'--','--adventure-smoke','--service=http://127.0.0.1:8788']);
output+='\n'+await run(['--headless','--xr-mode','off','--path',path.join(project,'godot'),'--','--qol-smoke','--service=http://127.0.0.1:8788']);
output+='\n'+await run(['--headless','--xr-mode','off','--path',path.join(project,'godot'),'--quit-after','2000','--','--siege-ledger-check','--service=http://127.0.0.1:8788']);
if(!output.includes('SIEGE_LEDGER_RESULT []'))throw Error('Native ammunition test did not finish');
fs.writeFileSync(path.join(project,'logs/integration.log'),output+'\n'+serviceOutput);console.log('INTEGRATION PASS seconds='+((performance.now()-started)/1000).toFixed(3));
}finally{service?.kill();fs.appendFileSync(path.join(project,'logs/work-timing.csv'),`integration,finished,${(performance.now()-started)/1000}\n`);}})().catch(e=>{console.error(e);process.exitCode=1;});
