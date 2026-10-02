import * as T from 'three';
import {worldTrees} from '../shared/world-content.js';

// Reuses the installed Sonnet/Opus GLBs. No replacement procedural art kit.
export function createWorldContent({scene,templates,instantiate,height}) {
 const trees=new Map(),objects=new Map(),batches=[],formations=[];let terrainKey='',last=null,seed=null,initialized=false;
 const matrix=new T.Matrix4(),dummy=new T.Object3D();
 const pickMaterials={apple:new T.MeshStandardMaterial({color:0xc84826,roughness:.65}),gems:new T.MeshStandardMaterial({color:0x69dada,metalness:.25,roughness:.3,emissive:0x123232}),stone:new T.MeshStandardMaterial({color:0x898879,roughness:.95})};
 function authored(name,size=1){const template=templates.get(name);if(!template)return null;const mesh=template.scene.clone(true);const collisionOnly=[];mesh.traverse(n=>{if(n.name.toLowerCase().includes('colonly'))collisionOnly.push(n);});for(const n of collisionOnly)n.removeFromParent();const bounds=new T.Box3().setFromObject(mesh),span=bounds.getSize(new T.Vector3());const scale=size/Math.max(.01,span.y);const root=new T.Group();root.add(mesh);mesh.scale.multiplyScalar(scale);mesh.position.set(-(bounds.min.x+bounds.max.x)/2*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)/2*scale);return root;}
 function tag(node,id){node.userData.targetId=id;node.traverse(c=>{if(c.isMesh)c.userData.targetId=id;});return node;}
 function clip(node,plane){node.traverse(c=>{if(c.isMesh){c.material=(Array.isArray(c.material)?c.material:[c.material]).map(m=>{const clone=m.clone();clone.clippingPlanes=[plane];return clone;});}});}
 function remove(node){node.removeFromParent();node.traverse(c=>{for(const m of Array.isArray(c.material)?c.material:[c.material])if(m?.clippingPlanes?.length)m.dispose();});}
 function sync(s){last=s;const now=performance.now(),ids=new Set();
  for(const t of worldTrees(s)){ids.add(t.id);let e=trees.get(t.id);const cut=s.harvestedTrees?.find(h=>h.id===t.id);const floor=height(t.x,t.z,s.edits);
   if(!e){const root=new T.Group();const visual=instantiate(['tree','tree_b','tree_young'][t.variant]||'tree',t.height)||instantiate('tree',t.height);if(!visual)continue;root.add(visual);scene.add(root);tag(root,t.id);e={root,visual,cut:null,born:initialized?now-100:now-1600,seed:t};trees.set(t.id,e);}
   e.root.position.set(t.x,floor,t.z);e.floor=floor;
   if(cut?.cuts && !cut.felledTick && (e.cuts!==cut.cuts||e.cutHeight!==cut.cutHeight)){if(e.wedge)remove(e.wedge);e.wedge=authored(cut.cuts===1?'cut1':'cut2',.18+cut.cuts*.08);if(e.wedge){e.wedge.position.set(0,Math.max(.3,cut.cutHeight-floor),.2);e.root.add(e.wedge);}e.cuts=cut.cuts;e.cutHeight=cut.cutHeight;}
   if(cut?.felledTick&&!e.cut){
    if(e.wedge)remove(e.wedge);e.cut=cut;e.pivot=new T.Group();const cy=T.MathUtils.clamp(cut.cutHeight-floor,.3,t.height*.65);e.pivot.position.y=cy;e.root.add(e.pivot);e.pivot.add(e.visual);e.visual.position.y=-cy;
    e.clip=new T.Plane(new T.Vector3(0,1,0),-cy);clip(e.visual,e.clip);
    const stump=instantiate(['tree','tree_b','tree_young'][t.variant]||'tree',t.height);const plane=new T.Plane(new T.Vector3(0,-1,0),floor+cy);clip(stump,plane);e.root.add(stump);e.stump=stump;
    const cap=authored('endcap',.10);if(cap){cap.position.y=cy-.04;e.root.add(cap);}e.fallStart=initialized?now:now-2200;
   }
  }
  for(const [id,e]of trees)if(!ids.has(id)){remove(e.root);trees.delete(id);}
  const content=[...(s.deposits||[]).filter(d=>!d.depleted).map(d=>({...d,type:'deposit'})),...(s.pickups||[]).map(p=>({...p,type:'pickup'})),...(s.bridges||[]).map(b=>({...b,type:'bridge'}))];const objectIds=new Set(content.map(c=>c.id));
  for(const c of content){let e=objects.get(c.id);if(!e){let root;
    if(c.type==='deposit')root=authored(c.kind==='meteor'?'meteor':'boulder',c.kind==='meteor'?1.5:1.2);
    else if(c.type==='bridge'){const source=templates.get('bridge');if(source){root=source.scene.clone(true);const collisionOnly=[];root.traverse(n=>{if(n.name.toLowerCase().includes('colonly'))collisionOnly.push(n);});for(const n of collisionOnly)n.removeFromParent();root.scale.set(1.6/3.4,.65,5/5.9);}}
    else if(c.kind==='wood'){root=authored('log',.38);if(root){root.rotation.z=Math.PI/2;root.scale.setScalar(2);}}
    else root=new T.Mesh(new T.IcosahedronGeometry(c.kind==='apple'?.16:.22,1),pickMaterials[c.kind]||pickMaterials.stone);
    if(!root)continue;scene.add(root);tag(root,c.id);e={root,data:c};objects.set(c.id,e);
   }e.data=c;const floor=height(c.x,c.z,s.edits);e.root.position.set(c.x,c.type==='bridge'?c.y:floor+(c.type==='pickup'?.45:0),c.z);if(c.type==='bridge')e.root.rotation.y=c.yaw;
   if(c.type==='deposit')e.root.scale.setScalar(1-c.hits/c.maxHits*.15);
  }
  for(const [id,e]of objects)if(!objectIds.has(id)){remove(e.root);if(e.root.isMesh)e.root.geometry.dispose();objects.delete(id);}
  if(seed!==s.seed){for(const b of batches){scene.remove(b.mesh);b.mesh.dispose();}batches.length=0;for(const f of formations)f.mesh.removeFromParent();formations.length=0;seed=s.seed;scatter(s);terrainKey='';}
  const nextTerrainKey=JSON.stringify(s.edits);if(nextTerrainKey!==terrainKey){terrainKey=nextTerrainKey;
  for(const f of formations)f.mesh.position.y=height(f.x,f.z,s.edits)-.1;
  for(const b of batches){for(let i=0;i<b.points.length;i++){const p=b.points[i];dummy.position.set(p.x,height(p.x,p.z,s.edits),p.z);dummy.rotation.y=p.angle;dummy.scale.setScalar(p.scale);dummy.updateMatrix();matrix.multiplyMatrices(dummy.matrix,b.local);b.mesh.setMatrixAt(i,matrix);}b.mesh.instanceMatrix.needsUpdate=true;b.mesh.computeBoundingSphere();}}
  initialized=true;
 }
 function scatter(s){
  for(const [name,x,z,size,angle]of [['bank',-18,-18,1.4,.8],['bank',-21,-16,1.1,1.2],['ridge',20,-22,3.1,-.5],['ridge',23,-24,2.4,.5],['roots',-13,-10,.65,1.2]]){const mesh=authored(name,size);if(mesh){mesh.position.set(x,height(x,z,s.edits)-.1,z);mesh.rotation.y=angle;scene.add(mesh);formations.push({mesh,x,z});}}
  const names=['grass_tuft','meadow_flowers','fern_delicate','leaf_litter','pebble_scatter','mushroom_cluster','fallen_branch','broadleaf_plant','river_stones','root_tangle'];
  for(let n=0;n<names.length;n++){const template=templates.get(names[n]);if(!template)continue;template.scene.updateMatrixWorld(true);const points=[];
   for(let i=0;i<65;i++){const h=((Math.imul(i+1,73856093)^Math.imul(n+1,19349663)^s.seed)>>>0);const a=h*.000001,r=5+Math.sqrt((h%1000)/1000)*45,x=Math.sin(a)*r,z=Math.cos(a)*r;if(Math.abs(x)<1.5&&z>0&&z<16)continue;points.push({x,z,angle:a,scale:.7+(h%70)/100});}
   template.scene.traverse(c=>{if(!c.isMesh)return;const mesh=new T.InstancedMesh(c.geometry,c.material,points.length);scene.add(mesh);batches.push({mesh,points,local:c.matrixWorld.clone()});});
  }
 }
 function tick(now){for(const e of trees.values()){
   if(e.cut){const t=T.MathUtils.clamp((now-e.fallStart)/1800,0,1);const angle=t*t*(3-2*t)*1.48;const axis=new T.Vector3(-Math.cos(e.cut.fallYaw),0,Math.sin(e.cut.fallYaw));e.pivot.quaternion.setFromAxisAngle(axis,angle);e.root.updateMatrixWorld(true);e.clip.set(new T.Vector3(0,1,0),0).applyMatrix4(e.pivot.matrixWorld);}
   else {const t=T.MathUtils.clamp((now-e.born)/1400,0,1);e.visual.scale.setScalar(Math.max(.01,t*t*(3-2*t)));}
  }for(const e of objects.values())if(e.data.type==='pickup'){e.root.position.y=height(e.data.x,e.data.z,last.edits)+.6+Math.sin(now*.002+e.data.x)*.045;if(e.data.kind!=='wood')e.root.rotation.y=now*.0007;}}
 return {sync,tick,targets:()=>[...trees.values()].filter(e=>!e.cut).map(e=>e.root).concat([...objects.values()].filter(e=>e.data.type==='deposit').map(e=>e.root)),reload(){seed=null;if(last)sync(last);},dispose(){for(const e of trees.values())remove(e.root);for(const e of objects.values())remove(e.root);for(const f of formations)f.mesh.removeFromParent();for(const b of batches){b.mesh.removeFromParent();b.mesh.dispose();}Object.values(pickMaterials).forEach(m=>m.dispose());},stats:()=>({trees:trees.size,props:batches.reduce((n,b)=>n+b.points.length,0),deposits:objects.size})};
}
