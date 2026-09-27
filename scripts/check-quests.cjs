'use strict';
// An isolated real HTTP -> native lifecycle test. No paid API calls or voice sessions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..'),started=performance.now();let host,native,serviceOutput='',nativeOutput='';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'brann-quests-network-'));
(async()=>{try{
 host=spawn(process.execPath,['-e',"const {server}=require('./server');server.on('listening',()=>console.log('TEST_PORT='+server.address().port));"],{cwd:path.join(project,'service'),windowsHide:true,env:{...process.env,BRANN_DATA_DIR:root,BRANN_ROOT:root,BRANN_PORT:'0',OPENAI_API_KEY:''}});
 host.stdout.on('data',d=>serviceOutput+=d);host.stderr.on('data',d=>serviceOutput+=d);
 let port;for(let n=0;n<80;n++){const match=serviceOutput.match(/TEST_PORT=(\d+)/);if(match){port=Number(match[1]);break;}if(host.exitCode!==null)throw Error('Isolated server exited');await new Promise(r=>setTimeout(r,25));}if(!port)throw Error('Isolated server failed to start');
 const base='http://127.0.0.1:'+port;const health=await fetch(base+'/health').then(r=>r.json());if(health.pid!==host.pid)throw Error('Service identity mismatch');
 await new Promise((resolve,reject)=>{
  native=spawn(path.join(project,'tools/godot/Godot_v4.7.2-stable_win64_console.exe'),[...(process.argv.includes('--capture')?['--audio-driver','Dummy']:['--headless']),'--xr-mode','off','--path',path.join(project,'godot'),'--quit-after','4000','--','--quest-check','--service='+base,...(process.argv.includes('--capture')?['--quest-capture='+path.join(project,'outputs','quest-journal.png')]:[])],{windowsHide:true});
  const timeout=setTimeout(()=>{native.kill();reject(Error('Native test exceeded 40 seconds'));},40000);
  const capture=d=>{nativeOutput+=d;if(/SCRIPT ERROR|ERROR:/.test(nativeOutput))native.kill();};native.stdout.on('data',capture);native.stderr.on('data',capture);native.on('error',e=>{clearTimeout(timeout);reject(e);});native.on('exit',code=>{clearTimeout(timeout);if(code||/SCRIPT ERROR|ERROR:/.test(nativeOutput)||!nativeOutput.includes('QUEST_CHECK_RESULT []'))reject(Error('Native quest checks failed code='+code+'; inspect logs/quests-network.log'));else resolve();});
 });
 console.log(nativeOutput.split('\n').filter(l=>/QUEST_CHECK_RESULT/.test(l)).join('\n'));
 console.log('QUEST NETWORK PASS seconds='+((performance.now()-started)/1000).toFixed(3));
}finally{native?.kill();host?.kill();fs.writeFileSync(path.join(project,process.argv.includes('--capture')?'logs/quests-capture.log':'logs/quests-network.log'),nativeOutput+'\nSERVICE\n'+serviceOutput,'utf8');fs.appendFileSync(path.join(project,'logs/work-timing.csv'),'quests-network,'+(nativeOutput.includes('QUEST_CHECK_RESULT []')?'passed':'failed')+','+((performance.now()-started)/1000)+'\n');}})().catch(e=>{console.error(e.message);process.exitCode=1;});
