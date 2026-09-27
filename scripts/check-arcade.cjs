"use strict";
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"..");
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),"brann-arcade-"));
const packAt=process.argv.indexOf("--pack");
const pack=packAt>=0?path.resolve(process.argv[packAt+1]):null;
const began=performance.now();
for(const phase of ["arcade-seed","arcade-resume"]){
 const start=performance.now();
 const child=spawnSync(path.join(root,"tools/godot/Godot_v4.7.2-stable_win64_console.exe"),["--headless","--xr-mode","off","--audio-driver","Dummy","--log-file",path.join(fixture,phase+".log"),...(pack?["--main-pack",pack]:["--path",path.join(root,"godot")]),"--quit-after","12000","--","--playful-demo","--demo-persistent","--demo-save-dir="+fixture,"--demo-persistence-check="+phase],{encoding:"utf8",windowsHide:true,timeout:55000});
 const output=(child.stdout||"")+(child.stderr||"");
 fs.writeFileSync(path.join(root,"logs",phase+".log"),output);
 fs.appendFileSync(path.join(root,"logs/work-timing.csv"),`arcade-${phase},exit-${child.status},${((performance.now()-start)/1000).toFixed(6)}\n`);
 assert.equal(child.error,undefined,"Fixture: "+fixture+"\n"+output);
 assert.equal(child.status,0,"Fixture: "+fixture+"\n"+output);
 assert.match(output,/DEMO_PERSISTENCE_RESULT .*"failures":\[\]/,output);
 assert.doesNotMatch(output,/SCRIPT ERROR:|ERROR:/);
 if(phase==="arcade-seed")assert.match(output,/ARCADE_WALKTHROUGH_RESULT \[\]/,output);
 console.log(phase,"passed");
}
console.log("ARCADE_PROCESS_CHECK PASS seconds="+((performance.now()-began)/1000).toFixed(3)+" fixture="+fixture);
