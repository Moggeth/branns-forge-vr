'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'brann-demo-persistence-'));
const engine=path.join(root,'tools/godot/Godot_v4.7.2-stable_win64_console.exe');
const total=performance.now();
const packIndex=process.argv.indexOf('--pack');
const pack=packIndex>=0?path.resolve(process.argv[packIndex+1]):null;
function run(phase){
 const start=performance.now();
 const result=spawnSync(engine,['--headless','--xr-mode','off','--audio-driver','Dummy','--log-file',path.join(fixture,phase+'-native.log'),...(pack?['--main-pack',pack]:['--path',path.join(root,'godot')]),'--quit-after','4000','--','--playful-demo','--demo-persistent','--demo-save-dir='+fixture,'--demo-persistence-check='+phase],{encoding:'utf8',windowsHide:true,timeout:30000});
 const output=(result.stdout||'')+(result.stderr||'');
 fs.writeFileSync(path.join(root,'logs','demo-persistence-'+phase+'.log'),output);
 fs.appendFileSync(path.join(root,'logs','work-timing.csv'),`demo-persistence-${phase},exit-${result.status},${((performance.now()-start)/1000).toFixed(6)}\n`);
 assert.equal(result.error,undefined,output);
 assert.equal(result.status,0,output);
 assert.match(output,/DEMO_PERSISTENCE_RESULT .*"failures":\[\]/,output);
 assert.doesNotMatch(output,/SCRIPT ERROR:|ERROR:/);
 console.log('Demo phase passed:',phase);
}
const progress=path.join(fixture,'progress.json');
try{
 run('seed');
 assert.ok(fs.existsSync(progress));
 run('resume');
 run('close');
 run('resume-close');
 fs.writeFileSync(progress,'{ interrupted write');
 run('recover');
 const future=JSON.stringify({schema:999,kind:'bellworks-demo',revision:999,progress:{future:true}});
 fs.writeFileSync(progress,future);
 run('incompatible');
 assert.equal(fs.readFileSync(progress,'utf8'),future,'Unsupported future save was overwritten');
 run('reset');
 run('fresh');
 // Recovery after reset must use a reset-era backup, never old achievements.
 fs.writeFileSync(progress,'{ bad post-reset write');
 run('fresh-recover');
 assert.ok(fs.readdirSync(fixture).some(name=>name.includes('reset')||name.includes('archive')),'Reset preserves recoverable history outside active candidates');
 console.log(`DEMO_PROCESS_CHECK PASS elapsed_seconds=${((performance.now()-total)/1000).toFixed(3)} fixture=${fixture}`);
}catch(error){
 console.error('Fixture retained for diagnosis:',fixture);
 throw error;
}
