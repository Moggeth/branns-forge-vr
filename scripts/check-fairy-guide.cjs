const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),start=performance.now();
const packAt=process.argv.indexOf('--pack'),pack=packAt>=0?path.resolve(process.argv[packAt+1]):null;
const args=['--headless','--xr-mode','off','--audio-driver','Dummy',...(pack?['--main-pack',pack]:['--path',path.join(root,'godot')]),'--script','res://fairy_guide_playthrough.gd','--quit-after','5000','--','--playful-demo'];
const child=spawnSync(path.join(root,'tools/godot/Godot_v4.7.2-stable_win64_console.exe'),args,{encoding:'utf8',windowsHide:true,timeout:60000});
const out=(child.stdout||'')+(child.stderr||'');fs.writeFileSync(path.join(root,'logs/fairy-guide-playthrough.log'),out);
fs.appendFileSync(path.join(root,'logs/work-timing.csv'),`fairy-guide-playthrough,exit-${child.status},${((performance.now()-start)/1000).toFixed(3)}\n`);
assert.equal(child.error,undefined,out);assert.equal(child.status,0,out);assert.match(out,/FAIRY_GUIDE_PLAYTHROUGH_RESULT .*"failures":\[\]/,out);assert.doesNotMatch(out,/SCRIPT ERROR:|ERROR:/,out);
console.log(out.match(/FAIRY_GUIDE_PLAYTHROUGH_RESULT .*/)[0]);
