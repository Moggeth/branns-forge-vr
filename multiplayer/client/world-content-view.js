import * as T from 'three';
import {createTreeView} from './tree-view.js';

// Reuses the installed Sonnet/Opus GLBs. No replacement procedural art kit.
// Trees (notches, hinge fall, stumps, physical logs, LOD) are delegated to tree-view.js; this module keeps props.
const TREE_ASSETS=['tree','tree_b','tree_young','tree_lod','tree_b_lod','tree_young_lod','log','endcap'];
// Opus resource kit: native metres, origin at the bottom centre (Ground) and ResourcePivot on the same vertical axis,
// so the existing y spin keeps the authored pivot. Authored pickups hover just off the ground; the load-time fallback keeps its old lift.
export const PICKUP_ASSETS={gems:'star_gem',stone:'stone_chunk',apple:'orchard_apple'};
const pickupLift=e=>e.root.userData.authoredPickup?.12:.45;
export function createWorldContent({scene,templates,instantiate,height,camera=null}) {
 const objects=new Map(),batches=[],formations=[];let terrainKey='',last=null,seed=null,treeAssets='';
 const treeView=createTreeView({scene,templates,height,camera});
 const matrix=new T.Matrix4(),dummy=new T.Object3D();
 const pickMaterials={apple:new T.MeshStandardMaterial({color:0xc84826,roughness:.65}),gems:new T.MeshStandardMaterial({color:0x69dada,metalness:.25,roughness:.3,emissive:0x123232}),stone:new T.MeshStandardMaterial({color:0x898879,roughness:.95})};
 function authored(name,size=1){const template=templates.get(name);if(!template)return null;const mesh=template.scene.clone(true);const collisionOnly=[];mesh.traverse(n=>{if(n.name.toLowerCase().includes('colonly'))collisionOnly.push(n);});for(const n of collisionOnly)n.removeFromParent();const bounds=new T.Box3().setFromObject(mesh),span=bounds.getSize(new T.Vector3());const scale=size/Math.max(.01,span.y);const root=new T.Group();root.add(mesh);mesh.scale.multiplyScalar(scale);mesh.position.set(-(bounds.min.x+bounds.max.x)/2*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)/2*scale);return root;}
 function tag(node,id){node.userData.targetId=id;node.traverse(c=>{if(c.isMesh)c.userData.targetId=id;});return node;}
 function remove(node){node.removeFromParent();node.traverse(c=>{for(const m of Array.isArray(c.material)?c.material:[c.material])if(m?.clippingPlanes?.length)m.dispose();});}
 function sync(s){last=s;
  // Rebuild tree kits once per change in the loaded tree asset set (GLBs arrive asynchronously).
  const assetKey=TREE_ASSETS.map(n=>templates.has(n)?1:0).join('');if(assetKey!==treeAssets){treeAssets=assetKey;treeView.reload(templates);}
  treeView.sync(s);
  const content=[...(s.deposits||[]).filter(d=>!d.depleted).map(d=>({...d,type:'deposit'})),...(s.pickups||[]).map(p=>({...p,type:'pickup'})),...(s.bridges||[]).map(b=>({...b,type:'bridge'}))];const objectIds=new Set(content.map(c=>c.id));
  for(const c of content){let e=objects.get(c.id);if(!e){let root;
    if(c.type==='deposit')root=authored(c.kind==='meteor'?'meteor':'boulder',c.kind==='meteor'?1.5:1.2);
    else if(c.type==='bridge'){const source=templates.get('bridge');if(source){root=source.scene.clone(true);const collisionOnly=[];root.traverse(n=>{if(n.name.toLowerCase().includes('colonly'))collisionOnly.push(n);});for(const n of collisionOnly)n.removeFromParent();root.scale.set(1.6/3.4,.65,5/5.9);}}
    else if(c.kind==='wood'){root=authored('log',.38);if(root){root.rotation.z=Math.PI/2;root.scale.setScalar(2);}}
    else if(templates.has(PICKUP_ASSETS[c.kind])){root=new T.Group();root.add(templates.get(PICKUP_ASSETS[c.kind]).scene.clone(true));root.userData.authoredPickup=true;}
    else root=new T.Mesh(new T.IcosahedronGeometry(c.kind==='apple'?.16:.22,1),pickMaterials[c.kind]||pickMaterials.stone); // until the Opus GLB has loaded
    if(!root)continue;scene.add(root);tag(root,c.id);e={root,data:c};objects.set(c.id,e);
   }e.data=c;const floor=height(c.x,c.z,s.edits);e.root.position.set(c.x,c.type==='bridge'?c.y:floor+(c.type==='pickup'?pickupLift(e):0),c.z);if(c.type==='bridge')e.root.rotation.y=c.yaw;
   if(c.type==='deposit')e.root.scale.setScalar(1-c.hits/c.maxHits*.15);
  }
  for(const [id,e]of objects)if(!objectIds.has(id)){remove(e.root);if(e.root.isMesh)e.root.geometry.dispose();objects.delete(id);}
  if(seed!==s.seed){for(const b of batches){scene.remove(b.mesh);b.mesh.dispose();}batches.length=0;for(const f of formations)f.mesh.removeFromParent();formations.length=0;seed=s.seed;scatter(s);terrainKey='';}
  const nextTerrainKey=JSON.stringify(s.edits);if(nextTerrainKey!==terrainKey){terrainKey=nextTerrainKey;
  for(const f of formations)f.mesh.position.y=height(f.x,f.z,s.edits)-.1;
  for(const b of batches){for(let i=0;i<b.points.length;i++){const p=b.points[i];dummy.position.set(p.x,height(p.x,p.z,s.edits),p.z);dummy.rotation.y=p.angle;dummy.scale.setScalar(p.scale);dummy.updateMatrix();matrix.multiplyMatrices(dummy.matrix,b.local);b.mesh.setMatrixAt(i,matrix);}b.mesh.instanceMatrix.needsUpdate=true;b.mesh.computeBoundingSphere();}}
 }
 function scatter(s){
  for(const [name,x,z,size,angle]of [['bank',-18,-18,1.4,.8],['bank',-21,-16,1.1,1.2],['ridge',20,-22,3.1,-.5],['ridge',23,-24,2.4,.5],['roots',-13,-10,.65,1.2]]){const mesh=authored(name,size);if(mesh){mesh.position.set(x,height(x,z,s.edits)-.1,z);mesh.rotation.y=angle;scene.add(mesh);formations.push({mesh,x,z});}}
  const names=['grass_tuft','meadow_flowers','fern_delicate','leaf_litter','pebble_scatter','mushroom_cluster','fallen_branch','broadleaf_plant','river_stones','root_tangle'];
  for(let n=0;n<names.length;n++){const template=templates.get(names[n]);if(!template)continue;template.scene.updateMatrixWorld(true);const points=[];
   for(let i=0;i<65;i++){const h=((Math.imul(i+1,73856093)^Math.imul(n+1,19349663)^s.seed)>>>0);const a=h*.000001,r=5+Math.sqrt((h%1000)/1000)*45,x=Math.sin(a)*r,z=Math.cos(a)*r;if(Math.abs(x)<1.5&&z>0&&z<16)continue;points.push({x,z,angle:a,scale:.7+(h%70)/100});}
   template.scene.traverse(c=>{if(!c.isMesh)return;const mesh=new T.InstancedMesh(c.geometry,c.material,points.length);scene.add(mesh);batches.push({mesh,points,local:c.matrixWorld.clone()});});
  }
 }
 // simTick may be fractional (interpolated render tick); tree falls are pure functions of it so every client agrees.
 function tick(now,simTick=last?.tick??0){treeView.tick(now,simTick);
  for(const e of objects.values())if(e.data.type==='pickup'){e.root.position.y=height(e.data.x,e.data.z,last.edits)+pickupLift(e)+.15*!e.root.userData.authoredPickup+Math.sin(now*.002+e.data.x)*.045;if(e.data.kind!=='wood')e.root.rotation.y=now*.0007;}}
 return {sync,tick,collectibleTargets:()=>treeView.collectibleTargets().concat([...objects.values()].filter(e=>e.data.type==='pickup').map(e=>e.root)),collectibleId:hit=>treeView.collectibleId(hit),targets:()=>treeView.targets().concat([...objects.values()].filter(e=>e.data.type==='deposit').map(e=>e.root)),
  // Raycast hit -> {id, point, normal (world), instanced}: instanced tree batches map instanceId to the tree id; deposits/entities use userData.targetId.
  resolveTarget(hit){const t=treeView.resolveTarget(hit);if(t)return t;let n=hit?.object;while(n&&!n.userData.targetId)n=n.parent;if(!n)return null;
   return {id:n.userData.targetId,point:hit.point.toArray(),normal:hit.face?hit.face.normal.clone().transformDirection(hit.object.matrixWorld).toArray():null,instanced:false};},
  grabTarget:(origin,direction,max)=>treeView.grabTarget(origin,direction,Math.min(max??2.5,2.5))?.id||null,surfaceVisible:treeView.surfaceVisible,trees:treeView,
  reload(){seed=null;for(const [id,e]of objects)if(e.data.type==='pickup'&&e.root.isMesh&&templates.has(PICKUP_ASSETS[e.data.kind])){remove(e.root);e.root.geometry.dispose();objects.delete(id);}if(last)sync(last);},dispose(){treeView.dispose();for(const e of objects.values())remove(e.root);for(const f of formations)f.mesh.removeFromParent();for(const b of batches){b.mesh.removeFromParent();b.mesh.dispose();}Object.values(pickMaterials).forEach(m=>m.dispose());},
  stats:()=>({...treeView.stats(),props:batches.reduce((n,b)=>n+b.points.length,0),deposits:objects.size})};
}
