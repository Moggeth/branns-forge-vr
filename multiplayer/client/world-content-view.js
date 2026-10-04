import {createResourceArt} from './forest-resource-art.js';
export {createResourceArt,HELD_SCALE} from './forest-resource-art.js';
import {DEPOSIT_CATALOG,materialLabel} from '../shared/material-catalog.js';
import {isBayStack} from '../shared/inventions.js';
import {BAR_STACK_MAX} from './forest-resource-art.js';
import {terrainFrameKey,terrainDirtyEdits,foundationTerrainKey,TERRAIN_GRID} from '../shared/terrain.js';
import * as T from 'three';
import {createCrystalWall} from './crystal-wall.js';
import {attachFracture} from './mining-fracture.js';
import {createGeodeLight,setGeodeLightTime,geodeLightGlobalStats,GEODE_LIGHT_BUDGET,GEODE_LIGHT_DISTANCE} from './geode-light.js';
import {createTreeView} from './tree-view.js';

// Installed GLBs plus the Opus-authored reusable mineral and tree-detail kit.
// Trees (notches, hinge fall, stumps, physical logs, LOD) are delegated to tree-view.js; this module keeps props.
const TREE_ASSETS=['tree','tree_b','tree_young','tree_lod','tree_b_lod','tree_young_lod','log','endcap'];
// Opus resource kit: native metres, origin at the bottom centre (Ground) and ResourcePivot on the same vertical axis,
// so the existing y spin keeps the authored pivot. Pickups wait for their authored model rather than showing primitive stand-ins.
export const PICKUP_ASSETS={gems:'star_gem',stone:'stone_chunk',apple:'orchard_apple'};
const pickupLift=e=>e.bay?BAY_SURFACE:e.root.userData.authoredPickup?.12:.45;
// Bars on the Forge output bay sit still on their cradle with a small count plate, so each metal reads as its own reward.
const BAY_SURFACE=.13,BAY_COLORS={iron:'#d6dde2',mithril:'#9ff2ff',starMetal:'#ffc766',copper:'#ffb085',gold:'#ffe27a'};
function bayPlate(kind,amount){if(typeof document==='undefined')return null;const canvas=document.createElement('canvas');canvas.width=256;canvas.height=88;const g=canvas.getContext('2d');if(!g)return null;
 const draw=n=>{g.clearRect(0,0,256,88);g.fillStyle='rgba(18,13,9,.82)';g.beginPath();g.roundRect(6,10,244,68,30);g.fill();g.strokeStyle='rgba(233,202,117,.75)';g.lineWidth=3;g.stroke();
  g.textAlign='center';g.textBaseline='middle';g.font='700 40px Georgia, serif';g.fillStyle=BAY_COLORS[kind]||'#ffe1a0';g.fillText(`${n} ${materialLabel(kind)}`,128,45);tex.needsUpdate=true;};
 const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;const sprite=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));sprite.scale.set(.66,.23,1);sprite.renderOrder=3;sprite.userData.ownMaterial=true;sprite.userData.draw=draw;sprite.userData.amount=amount;draw(amount);return sprite;}
export function createWorldContent({scene,templates,instantiate,height,camera=null}) {
 const objects=new Map(),batches=[],formations=[];let terrainKey=null,foundationKey=null,last=null,seed=null,treeAssets='',previousTerrainEdits=[],previousTerrainTick=Infinity;
 const resourceArt=createResourceArt();
 const resourceVariant=id=>{let h=2166136261;for(const ch of id)h=Math.imul(h^ch.charCodeAt(0),16777619);return (h>>>0)%3;};
 const treeView=createTreeView({scene,templates,height,camera});
 const crystalWall=createCrystalWall({THREE:T,scene,height});let previousTickTime=null;
 const matrix=new T.Matrix4(),dummy=new T.Object3D();
 const lightCandidates=[],cameraPosition=new T.Vector3();
 function authored(name,size=1){const template=templates.get(name);if(!template)return null;const mesh=template.scene.clone(true);const collisionOnly=[];mesh.traverse(n=>{if(n.name.toLowerCase().includes('colonly'))collisionOnly.push(n);});for(const n of collisionOnly)n.removeFromParent();const bounds=new T.Box3().setFromObject(mesh),span=bounds.getSize(new T.Vector3());const scale=size/Math.max(.01,span.y);const root=new T.Group();root.add(mesh);mesh.scale.multiplyScalar(scale);mesh.position.set(-(bounds.min.x+bounds.max.x)/2*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)/2*scale);return root;}
 function tag(node,id){node.userData.targetId=id;node.traverse(c=>{if(c.isMesh)c.userData.targetId=id;});return node;}
 function remove(node){node.removeFromParent();node.traverse(c=>{for(const m of Array.isArray(c.material)?c.material:[c.material])if(m?.clippingPlanes?.length||c.userData.ownMaterial){if(c.isSprite)m.map?.dispose();m.dispose();}});}
 function sync(s){last=s;
  // Rebuild tree kits once per change in the loaded tree asset set (GLBs arrive asynchronously).
  const assetKey=TREE_ASSETS.map(n=>templates.has(n)?1:0).join('');if(assetKey!==treeAssets){treeAssets=assetKey;treeView.reload(templates);}
  treeView.sync(s);crystalWall.sync(s);
  const content=[...(s.deposits||[]).filter(d=>!d.depleted&&d.special!=='pick_wall'&&d.special!=='wall').map(d=>({...d,type:'deposit'})),...(s.pickups||[]).map(p=>({...p,type:'pickup'})),...(s.bridges||[]).map(b=>({...b,type:'bridge'}))];const objectIds=new Set(content.map(c=>c.id));
  for(const c of content){let e=objects.get(c.id);if(e&&(e.data.type!==c.type||e.data.kind!==c.kind||c.hits<e.data.hits||e.bay&&Math.min(BAR_STACK_MAX,c.amount)!==e.root.userData.barStack)){e.light?.dispose();e.fracture?.dispose();remove(e.root);objects.delete(c.id);e=null;}const newlyCreated=!e;if(!e){let root;
    if(c.type==='deposit')root=resourceArt.deposit(c.kind,{variant:resourceVariant(c.id)})||authored(c.kind==='meteor'?'meteor':'boulder',c.kind==='meteor'?1.5:1.2);
    else if(c.type==='bridge'){const source=templates.get('bridge');if(source){root=source.scene.clone(true);const collisionOnly=[];root.traverse(n=>{if(n.name.toLowerCase().includes('colonly'))collisionOnly.push(n);});for(const n of collisionOnly)n.removeFromParent();root.scale.set(1.6/3.4,.65,5/5.9);}}
    else if(c.kind==='wood'){root=authored('log',.38);if(root){root.rotation.z=Math.PI/2;root.scale.setScalar(2);}}
    else if(c.type==='pickup'&&isBayStack(c)&&(root=resourceArt.barStack(c.kind,c.amount))){}
    else if(root=resourceArt.pickup(c.kind==='gems'?'crystal':c.kind)){}
    else if(templates.has(PICKUP_ASSETS[c.kind])){root=new T.Group();root.add(templates.get(PICKUP_ASSETS[c.kind]).scene.clone(true));root.userData.authoredPickup=true;}
    else continue; // Wait for the authored asset; never show a temporary primitive pickup.
    if(!root)continue;if(c.type==='deposit'&&!root.userData.authoredDeposit&&!['stone','meteor'].includes(c.kind)){root.traverse(n=>{if(n.isMesh){n.material=n.material.clone();n.material.color.lerp(new T.Color(DEPOSIT_CATALOG[c.kind]?.color||0xffffff),.65);n.userData.ownMaterial=true;}});}scene.add(root);tag(root,c.id);e={root,data:c,bay:!!root.userData.barStack};if(e.bay){e.plate=bayPlate(c.kind,c.amount);if(e.plate){e.plate.position.y=Math.ceil(root.userData.barStack/3)*.073+.32;root.add(e.plate);}}objects.set(c.id,e);
   }if(e.plate&&e.plate.userData.amount!==c.amount){e.plate.userData.amount=c.amount;e.plate.userData.draw(c.amount);}e.data=c;const floor=height(c.x,c.z,s.edits);e.root.position.set(c.x,c.type==='bridge'?c.y:floor+(c.type==='pickup'?pickupLift(e):0),c.z);if(c.type==='bridge')e.root.rotation.y=c.yaw;
   if(c.type==='deposit'&&c.hits>0){
    if(!e.fracture){e.fracture=attachFracture(T,e.root,c.id);if(c.kind==='meteor'&&e.fracture)e.light=createGeodeLight({root:e.root,id:c.id,fracture:e.fracture});}
    // Capture the fracture shells before saved damage removes them without chips.
    e.fracture?.setDamage(c.hits,c.maxHits,{animate:!newlyCreated});e.light?.damage(c.hits/Math.max(1,c.maxHits));
   }
  }
  for(const [id,e]of objects)if(!objectIds.has(id)){e.light?.dispose();e.fracture?.dispose();remove(e.root);if(e.root.isMesh)e.root.geometry.dispose();objects.delete(id);}
  if(seed!==s.seed){for(const b of batches){scene.remove(b.mesh);b.mesh.dispose();}batches.length=0;for(const f of formations)f.mesh.removeFromParent();formations.length=0;seed=s.seed;scatter(s);terrainKey=null;}
  const nextFoundationKey=foundationTerrainKey(s),nextTerrainKey=terrainFrameKey(s.edits,s.tick)+'|'+nextFoundationKey;if(nextTerrainKey!==terrainKey){
   const full=terrainKey===null||nextFoundationKey!==foundationKey,dirty=terrainDirtyEdits(previousTerrainEdits,s.edits,previousTerrainTick,s.tick),touched=p=>full||dirty.some(e=>Math.hypot(p.x-e.x,p.z-e.z)<=e.radius+TERRAIN_GRID.step);
   terrainKey=nextTerrainKey;foundationKey=nextFoundationKey;
   for(const f of formations)if(touched(f))f.mesh.position.y=height(f.x,f.z,s.edits)-.1;
   for(const b of batches){let changed=false;for(let i=0;i<b.points.length;i++){const p=b.points[i];if(!touched(p))continue;dummy.position.set(p.x,height(p.x,p.z,s.edits),p.z);dummy.rotation.y=p.angle;dummy.scale.setScalar(p.scale);dummy.updateMatrix();matrix.multiplyMatrices(dummy.matrix,b.local);b.mesh.setMatrixAt(i,matrix);changed=true;}if(changed){b.mesh.instanceMatrix.needsUpdate=true;b.mesh.computeBoundingSphere();}}
  }
  previousTerrainEdits=s.edits;previousTerrainTick=s.tick;

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
 function tick(now,simTick=last?.tick??0){resourceArt.update(now/1000);treeView.tick(now,simTick);const dt=previousTickTime===null?0:Math.max(0,Math.min(.1,(now-previousTickTime)/1000));previousTickTime=now;crystalWall.update(dt,simTick);for(const e of objects.values())e.fracture?.update(dt);
  setGeodeLightTime(now/1000);lightCandidates.length=0;if(camera)camera.getWorldPosition(cameraPosition);else cameraPosition.set(0,0,0);
  for(const e of objects.values())if(e.light){e.lightDistance=e.root.position.distanceToSquared(cameraPosition);e.lightRank=Infinity;if(e.lightDistance<=GEODE_LIGHT_DISTANCE**2)lightCandidates.push(e);}
  lightCandidates.sort((a,b)=>a.lightDistance-b.lightDistance);for(let i=0;i<Math.min(GEODE_LIGHT_BUDGET,lightCandidates.length);i++)lightCandidates[i].lightRank=i;
  // Release old slots first, so moving toward another geode changes priority this frame.
  for(const e of objects.values())if(e.light&&e.lightRank>=GEODE_LIGHT_BUDGET)e.light.update(dt,camera,false);
  for(let i=0;i<Math.min(GEODE_LIGHT_BUDGET,lightCandidates.length);i++)lightCandidates[i].light.update(dt,camera);
  for(const e of objects.values())if(e.data.type==='pickup'&&!e.bay){e.root.position.y=height(e.data.x,e.data.z,last.edits)+pickupLift(e)+.15*!e.root.userData.authoredPickup+Math.sin(now*.002+e.data.x)*.045;if(e.data.kind!=='wood')e.root.rotation.y=now*.0007;}}
 return {sync,tick,collectibleTargets:()=>treeView.collectibleTargets().concat([...objects.values()].filter(e=>e.data.type==='pickup').map(e=>e.root)),collectibleId:hit=>treeView.collectibleId(hit),targets:()=>treeView.targets().concat(crystalWall.targets(),[...objects.values()].filter(e=>e.data.type==='deposit').map(e=>e.root)),
  // Raycast hit -> {id, point, normal (world), instanced}: instanced tree batches map instanceId to the tree id; deposits/entities use userData.targetId.
  resolveTarget(hit){const t=treeView.resolveTarget(hit)||crystalWall.resolveTarget(hit);if(t)return t;let n=hit?.object;while(n&&!n.userData.targetId)n=n.parent;if(!n)return null;
   return {id:n.userData.targetId,point:hit.point.toArray(),normal:hit.face?hit.face.normal.clone().transformDirection(hit.object.matrixWorld).toArray():null,instanced:false};},
  crystalWall,grabTarget:(origin,direction,max)=>treeView.grabTarget(origin,direction,Math.min(max??2.5,2.5))?.id||null,surfaceVisible:treeView.surfaceVisible,trees:treeView,
  reload(){seed=null;for(const [id,e]of objects)if(e.data.type==='pickup'&&e.root.isMesh&&templates.has(PICKUP_ASSETS[e.data.kind])){remove(e.root);e.root.geometry.dispose();objects.delete(id);}if(last)sync(last);},dispose(){treeView.dispose();crystalWall.dispose();for(const e of objects.values()){e.light?.dispose();e.fracture?.dispose();remove(e.root);}for(const f of formations)f.mesh.removeFromParent();for(const b of batches){b.mesh.removeFromParent();b.mesh.dispose();}resourceArt.dispose();},
  stats:()=>({...treeView.stats(),resourceArt:resourceArt.stats(),resourceModels:[...objects.values()].map(e=>({id:e.data.id,kind:e.data.kind,type:e.data.type,art:e.root.userData.resourceArt||(e.data.type==='deposit'?(e.data.kind==='meteor'?'meteor':'boulder'):PICKUP_ASSETS[e.data.kind]||e.data.kind)})),props:batches.reduce((n,b)=>n+b.points.length,0),deposits:objects.size,crystalWalls:crystalWall.stats(),geodeLights:{...geodeLightGlobalStats(),geodes:[...objects.values()].filter(e=>e.light).map(e=>e.light.stats())},fractures:[...objects.values()].filter(e=>e.fracture).map(e=>e.fracture.stats())})};
}
