'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {LivingWorkshop,validatePackage,catalog}=require('./living-workshop');
const root=path.resolve(__dirname,'..');
const demo=()=>JSON.parse(fs.readFileSync(path.join(root,'godot/living_returning_demo.json'),'utf8'));
test('returning projectile schema is bounded and mirrored natively',()=>{
 const valid=validatePackage(demo());assert.equal(valid.entities[1].components[1].type,'returning_projectile');
 const c=catalog(),pinned=JSON.parse(fs.readFileSync(path.join(root,'godot/living_capabilities.json'),'utf8'));
 assert.deepEqual(pinned.components.returning_projectile,c.components.returning_projectile);assert.deepEqual(pinned.events,c.events);
 for(const mutate of [
  p=>p.entities[1].components[1].config.speed=17,
  p=>p.entities[1].components[1].config.gravity=Infinity,
  p=>p.entities[1].components[1].config.returnSpeed=21,
  p=>p.entities[1].components[1].config.returnAfter=9,
  p=>p.entities[1].components[1].config.collision='teleport_player',
  p=>p.entities[1].components[1].config.hitEvent='execute_native',
  p=>p.entities[1].components[1].config.script='evil()',
  p=>p.entities[1].components.shift(),
  p=>p.entities[1].size=[2,2,2],
  p=>p.entities[1].components[0].config.mass=4,
  p=>p.entities[1].components.push({type:'grapple',config:{}}),
  p=>p.links.push({id:'joint',from:'ring',to:'stand',type:'hinge',config:{}})
 ]){const bad=demo();mutate(bad);assert.throws(()=>validatePackage(bad));}
});
test('published immutable ring snapshots activate, recall and replace through native lifecycle',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brann-projectile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const registry=new LivingWorkshop(dir);const one=demo();const first=registry.publish({package:one,requestId:'ring-one'});const snapshot1=registry.snapshot();
 const changed=demo();changed.entities[1].color='#cc7755';assert.throws(()=>registry.publish({package:changed,requestId:'mutate-one'}),/immutable/);
 const two=demo();two.version=2;two.name='Cinderloop v2';two.entities[1].color='#f3bf68';const second=registry.publish({package:two,requestId:'ring-two'});const snapshot2=registry.snapshot();
 registry.rollback({id:one.id,version:0,requestId:'ring-remove'});const removed=registry.snapshot();
 const bundle=path.join(dir,'snapshots.json');fs.writeFileSync(bundle,JSON.stringify({one:snapshot1,two:snapshot2,removed}));
 const executable=process.env.GODOT_PATH||path.join(root,'tools/godot/Godot_v4.7.2-stable_win64_console.exe');
 const result=spawnSync(executable,['--headless','--xr-mode','off','--path',path.join(root,'godot'),'--script','res://living_projectile_checks.gd','--',bundle],{encoding:'utf8',timeout:20000,windowsHide:true});
 const output=(result.stdout||'')+(result.stderr||'');process.stdout.write(output);assert.equal(result.error,undefined);assert.equal(result.status,0,output);
 assert.match(output,/LIVING_PROJECTILE_RESULT .*"failures":\[\]/);assert.doesNotMatch(output,/SCRIPT ERROR|ERROR:|leaked/);
 assert.equal(first.status,'published');assert.equal(second.status,'published');assert.equal(registry.history(one.id).length,2);
});
