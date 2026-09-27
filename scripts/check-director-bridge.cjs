'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const net=require('node:net'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),started=performance.now();
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))});server.on('error',reject)})}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(fn,timeout=9000){const until=Date.now()+timeout;let last;while(Date.now()<until){try{const result=await fn();if(result)return result}catch(e){last=e}await wait(120)}throw last||Error('Director bridge timed out')}
async function run(){
 const port=await freePort(),url=`http://127.0.0.1:${port}`,data=fs.mkdtempSync(path.join(os.tmpdir(),'brann-director-check-'));
 const server=spawn(process.execPath,['server.js'],{cwd:path.join(root,'service'),env:{...process.env,BRANN_PORT:String(port),BRANN_DATA_DIR:data},windowsHide:true});
 let serviceOutput='',gameOutput='';server.stdout.on('data',x=>serviceOutput+=x);server.stderr.on('data',x=>serviceOutput+=x);
 let game;
 try{
  await eventually(async()=>{const r=await fetch(url+'/health');return r.ok&&await r.json()},8000);
  const page=await fetch(url+'/director/');assert.equal(page.status,200);assert.match(await page.text(),/live-frame/);
  const ui=await fetch(url+'/director/ui.js');assert.equal(ui.status,200);assert.match(await ui.text(),/CARD_ORDER/);
  const args=['--headless','--xr-mode','off','--audio-driver','Dummy','--path',path.join(root,'godot'),'--script','res://director_network_checks.gd','--quit-after','4000','--','--director-mode','--director-network-check',`--service=${url}`];
  game=spawn(path.join(root,'tools/godot/Godot_v4.7.2-stable_win64_console.exe'),args,{cwd:root,windowsHide:true});
  game.stdout.on('data',x=>gameOutput+=x);game.stderr.on('data',x=>gameOutput+=x);
  const state=await eventually(async()=>{const r=await fetch(url+'/api/director/state');const s=await r.json();return s.gameConnected&&s.phase==='waiting'?s:null},10000);
  async function command(type,lane=''){const r=await fetch(url+'/api/director/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:state.sessionId,type,lane})});const v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v}
  await command('start');
  await eventually(async()=>{const s=await (await fetch(url+'/api/director/state')).json();return s.phase==='running'?s:null},5000);
  await command('skeletons','west');await command('gloom','north');
  const exit=await Promise.race([new Promise(resolve=>game.on('exit',resolve)),wait(12000).then(()=>{throw Error('Godot bridge did not finish')})]);
  assert.equal(exit,0,gameOutput);assert.match(gameOutput,/DIRECTOR_NETWORK_RESULT .*"gloom":true/);assert.doesNotMatch(gameOutput,/SCRIPT ERROR:|ERROR:/);
  console.log(gameOutput.match(/DIRECTOR_NETWORK_RESULT .*/)[0]);
 }finally{
  if(game&&!game.killed)game.kill();server.kill();
  fs.writeFileSync(path.join(root,'logs/director-bridge-check.log'),gameOutput+'\nSERVICE\n'+serviceOutput);
  fs.appendFileSync(path.join(root,'logs/work-timing.csv'),`director-bridge-check,completed,${((performance.now()-started)/1000).toFixed(3)}\n`);
  const resolved=fs.realpathSync(data),tempRoot=fs.realpathSync(os.tmpdir());
  if(!resolved.startsWith(tempRoot+path.sep)||!path.basename(resolved).startsWith('brann-director-check-'))throw Error('Refusing to clean an unexpected director fixture path.');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1});
