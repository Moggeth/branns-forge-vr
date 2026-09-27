"use strict";
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'brann-ember-'));
const packAt=process.argv.indexOf('--pack'),pack=packAt>=0?path.resolve(process.argv[packAt+1]):null;
const gpu=process.argv.includes('--capture');
const phases=gpu?['ember-capture']:['ember-seed','ember-resume'];
for(const phase of phases){
 const start=performance.now(),args=[...(gpu?[]:['--headless']),'--xr-mode','off','--audio-driver','Dummy',...(pack?['--main-pack',pack]:['--path',path.join(root,'godot')]),'--quit-after','16000','--','--playful-demo','--ember-gallery-demo','--demo-persistent','--demo-save-dir='+fixture,'--demo-persistence-check='+phase];
 if(gpu)args.push('--ember-output='+path.join(root,'outputs/ember-gallery'+(pack?'-export':'')));
 const child=spawnSync(path.join(root,'tools/godot/Godot_v4.7.2-stable_win64_console.exe'),args,{encoding:'utf8',windowsHide:true,timeout:90000});
 const out=(child.stdout||'')+(child.stderr||'');fs.writeFileSync(path.join(root,'logs',phase+(pack?'-export':'')+'.log'),out);
 fs.appendFileSync(path.join(root,'logs/work-timing.csv'),`${phase},exit-${child.status},${((performance.now()-start)/1000).toFixed(6)}\n`);
 assert.equal(child.error,undefined,out);assert.equal(child.status,0,out);assert.match(out,/DEMO_PERSISTENCE_RESULT .*"failures":\[\]/,out);assert.doesNotMatch(out,/SCRIPT ERROR:|ERROR:/,out);if(gpu)assert.match(out,/EMBER_GPU_RESULT/);
 console.log(phase+' PASS '+((performance.now()-start)/1000).toFixed(3)+'s');
}
console.log('EMBER_CHECK PASS fixture='+fixture);
