const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateBuild}=require('./forge-worker');
test('new commissions require discoverable controls and functional trigger effects',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brann-interactions-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const data=Buffer.from(JSON.stringify({meshes:[{}],scenes:[{}]}));
 const mesh=Buffer.alloc(20+data.length);mesh.write('glTF');mesh.writeUInt32LE(2,4);mesh.writeUInt32LE(mesh.length,8);mesh.writeUInt32LE(data.length,12);mesh.writeUInt32LE(0x4e4f534a,16);data.copy(mesh,20);
 fs.writeFileSync(path.join(dir,'model.glb'),mesh);fs.writeFileSync(path.join(dir,'build.py'),'# test fixture');
 const spec={name:'Test hammer',description:'A real pulse',color:'#ffaa55',cooldown:3,capabilities:['blast']};
 const write=()=>fs.writeFileSync(path.join(dir,'item.json'),JSON.stringify(spec));write();
 fs.writeFileSync(path.join(dir,'behavior.js'),'function forgeAbility(s){return [{type:"spark",x:Math.floor(s.player.x),y:Math.floor(s.player.y)}]}');
 await assert.rejects(validateBuild(dir,{tier:2,capabilities:['blast']}),/controls/);
 spec.useInstructions='Swing to strike; holding trigger emits a pulse.';write();
 await assert.rejects(validateBuild(dir,{tier:2,capabilities:['blast']}),/functional action/);
 fs.writeFileSync(path.join(dir,'behavior.js'),'function forgeAbility(s){return [{type:"blast",x:Math.floor(s.player.x),y:Math.floor(s.player.y)}]}');
 const result=await validateBuild(dir,{tier:2,capabilities:['blast']});assert.equal(result.spec.name,spec.name);
});
