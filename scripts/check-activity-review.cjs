"use strict";
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),began=performance.now(),at=process.argv.indexOf("--pack"),pack=at>=0?path.resolve(process.argv[at+1]):null;
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),"brann-activity-review-"));
const cases=[["festival_flight_checks","FESTIVAL_FLIGHT_CHECKS"],["arcade_input_ownership_checks","ARCADE_INPUT_OWNERSHIP_CHECKS"],["persistence_edge_checks","PERSISTENCE_EDGE_CHECKS"],["activity-review","ACTIVITY_REVIEW_RESULT []"]];
for(const [name,marker]of cases){
 const start=performance.now(),main=name==="activity-review";
 const args=["--headless","--xr-mode","off","--audio-driver","Dummy",...(pack?["--main-pack",pack]:["--path",path.join(root,"godot")]),"--quit-after","4000",...(!main?["--script","res://"+name+".gd"]:[]),"--","--playful-demo","--demo-session-check",...(main?["--demo-persistent","--demo-save-dir="+fixture,"--demo-persistence-check=activity-review"]:[])];
 const r=spawnSync(path.join(root,"tools/godot/Godot_v4.7.2-stable_win64_console.exe"),args,{encoding:"utf8",windowsHide:true,timeout:45000});
 const output=(r.stdout||"")+(r.stderr||"");fs.writeFileSync(path.join(root,"logs",name+"-final.log"),output);
 const seconds=((performance.now()-start)/1000).toFixed(3);fs.appendFileSync(path.join(root,"logs/work-timing.csv"),`final-review-${name},exit-${r.status},${seconds}\n`);
 assert.equal(r.error,undefined,output);assert.equal(r.status,0,output);assert.ok(output.includes(marker),output);assert.doesNotMatch(output,/SCRIPT ERROR:|ERROR:|failures=[1-9]|"failures":\["/);
 console.log(name+" PASS "+seconds+"s");
}
console.log("ACTIVITY_REVIEW_PROCESS PASS "+((performance.now()-began)/1000).toFixed(3)+"s fixture="+fixture);
