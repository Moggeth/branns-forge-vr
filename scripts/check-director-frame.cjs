'use strict';
// Visual bridge smoke test: desktop Godot renders a real scene into the Director JPEG feed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),started=performance.now(),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)})}
async function eventually(fn,ms=12000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const v=await fn();if(v)return v}catch(e){last=e}await wait(150)}throw last||Error('Timed out')}
async function run(){
 const port=await freePort(),url=`http://127.0.0.1:${port}`,data=fs.mkdtempSync(path.join(os.tmpdir(),'brann-director-frame-'));
 const service=spawn(process.execPath,['server.js'],{cwd:path.join(root,'service'),env:{...process.env,BRANN_PORT:String(port),BRANN_DATA_DIR:data},windowsHide:true});
 let game,serviceLog='',gameLog='';service.stdout.on('data',x=>serviceLog+=x);service.stderr.on('data',x=>serviceLog+=x);
 try{
  await eventually(async()=>{const r=await fetch(url+'/health');return r.ok});
  game=spawn(path.join(root,'tools/godot/Godot_v4.7.2-stable_win64_console.exe'),['--xr-mode','off','--audio-driver','Dummy','--path',path.join(root,'godot'),'--script','res://director_network_checks.gd','--quit-after','4000','--','--director-mode','--director-network-check',`--service=${url}`],{cwd:root,windowsHide:true});
  game.stdout.on('data',x=>gameLog+=x);game.stderr.on('data',x=>gameLog+=x);
  const state=await eventually(async()=>{const s=await (await fetch(url+'/api/director/state')).json();return s.gameConnected?s:null},12000);
  // Keep the viewer heartbeat alive while Godot starts its second camera.
  const frame=await eventually(async()=>{await fetch(url+'/api/director/state');const r=await fetch(url+'/api/director/frame');if(!r.ok)return null;const bytes=Buffer.from(await r.arrayBuffer());return bytes.length>1000?bytes:null},10000);
  const continued=await eventually(async()=>{const s=await (await fetch(url+'/api/director/state')).json();return s.frameSequence>=10?s:null},10000);
  assert.equal(frame[0],0xff);assert.equal(frame[1],0xd8);
  const output=path.join(root,'outputs/director-live-frame.jpg');fs.writeFileSync(output,frame);
  console.log(JSON.stringify({session:state.sessionId,frames:continued.frameSequence,bytes:frame.length,output}));
  assert.doesNotMatch(gameLog,/SCRIPT ERROR:|ERROR:/);
 }finally{
  if(game&&!game.killed)game.kill();service.kill();
  fs.writeFileSync(path.join(root,'logs/director-frame-check.log'),gameLog+'\nSERVICE\n'+serviceLog);
  fs.appendFileSync(path.join(root,'logs/work-timing.csv'),`director-frame-check,${((performance.now()-started)/1000).toFixed(3)}\n`);
  const resolved=fs.realpathSync(data),tempRoot=fs.realpathSync(os.tmpdir());
  if(resolved.startsWith(tempRoot+path.sep)&&path.basename(resolved).startsWith('brann-director-frame-'))fs.rmSync(resolved,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1});
