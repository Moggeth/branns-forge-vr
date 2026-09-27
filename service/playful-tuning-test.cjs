const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Tuning,SCHEMA}=require('./tuning');
test('ten playful controls use existing bounded atomic persistence and undo',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brann-playful-tuning-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const tuning=new Tuning(dir),keys=Object.keys(SCHEMA).filter(k=>SCHEMA[k].group==='playful');assert.equal(keys.length,10);
 assert.deepEqual(keys.map(k=>SCHEMA[k].default),[1,1.1,18,4.5,22,4.2,4.2,.025,28,.84]);
 for(const key of keys){const rule=SCHEMA[key];for(const bad of [rule.min-.01,rule.max+.01,NaN,Infinity,'1'])assert.throws(()=>tuning.change({values:{[key]:bad}}),/Invalid tuning value/);}
 assert.equal(tuning.revision,0);assert.equal(fs.existsSync(tuning.file),false);
 tuning.change({values:{'playful.magnet_pull':10,'playful.ring_gravity':0},expectedRevision:0});
 const reloaded=new Tuning(dir);assert.equal(reloaded.values['playful.magnet_pull'],10);assert.equal(reloaded.values['playful.ring_gravity'],0);
 assert.throws(()=>reloaded.change({values:{'playful.magnet_fling':5.8},expectedRevision:0}),/elsewhere/);
 reloaded.change({action:'undo',expectedRevision:1});assert.equal(new Tuning(dir).values['playful.magnet_pull'],22);assert.equal(reloaded.values['playful.ring_gravity'],1.1);
});
test('old saved tuning snapshots acquire safe playful defaults without losing existing changes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brann-playful-migration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'tuning.json'),JSON.stringify({revision:8,values:{'throw.gain':2},previous:{'throw.gain':1.5}}));
 const tuning=new Tuning(dir);assert.equal(tuning.values['throw.gain'],2);assert.equal(tuning.values['playful.magnet_range'],4.5);assert.equal(tuning.values['playful.ring_recall_speed'],18);
 tuning.change({action:'undo',expectedRevision:8});assert.equal(tuning.values['throw.gain'],1.5);assert.equal(tuning.values['playful.magnet_pull'],22);
});
