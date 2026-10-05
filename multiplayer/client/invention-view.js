import {createTimberlineBallista} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-ballista.js';
import {addLadderPlates} from './timberline-ladder-plates.js';
import {createTimberlineBoltPair,collectMaterials} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-bolts.js';
import {createTimberlineFx} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-fx.js';
import {timberlineFlight,timberlineLaunch,timberlineVelocity,TIMBERLINE_RELEASE_TICKS} from '../shared/timberline-flight.js';
import * as THREE from 'three';
import {HEARTSTONE} from '../shared/heartstone.js';
import {createInventionModel,animateInventionModel,disposeInventionArt} from './invention-art.js';
import {STRUCTURES,machineCycleAge,timberlineAmmo,isBayStack} from '../shared/inventions.js';
import {createForgeWorks,FORGE_WORKS_ORIGIN} from './forge-works-art.js';
import {terrainHeight} from '../shared/terrain.js';
import {createTimberlineStuck} from './timberline-stuck.js';
import {createTimberlineTracers} from './timberline-tracers.js';
import {createBlueprintGhost,BLUEPRINT_COLORS} from './build-blueprint.js';
import {createHomeBaseView} from './home-base-view.js';
// Presentation consumes authoritative structures; no gameplay timers or resources live here.
export function createInventionView({scene}){
 const assets={},entries=new Map(),shots=new Map(),localAim=new Map();const timberFx=createTimberlineFx({maxChips:96,maxDust:16});scene.add(timberFx.object);const tracers=createTimberlineTracers({scene});let snapshot=null,stuck=null,viewerId=null,scoped=null;const effects=[];
 const ring=new THREE.Mesh(new THREE.RingGeometry(1.7,1.78,40),new THREE.MeshBasicMaterial({color:0xe9ca75,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.visible=false;scene.add(ring);
 const tilePreview=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-3,0,-3),new THREE.Vector3(3,0,-3),new THREE.Vector3(3,0,3),new THREE.Vector3(-3,0,3)]),new THREE.LineBasicMaterial({color:0xe9ca75}));tilePreview.visible=false;scene.add(tilePreview);
 const tileFill=new THREE.Mesh(new THREE.PlaneGeometry(6,6),new THREE.MeshBasicMaterial({color:0xe9ca75,transparent:true,opacity:.15,depthWrite:false,side:THREE.DoubleSide}));tileFill.rotation.x=-Math.PI/2;tileFill.visible=false;scene.add(tileFill);
 let previewState=null,previewLabel=null,labelCanvas=null,labelContext=null,lastLabel='';
 if(typeof document!=='undefined'){labelCanvas=document.createElement('canvas');labelCanvas.width=768;labelCanvas.height=104;labelContext=labelCanvas.getContext('2d');if(labelContext){const map=new THREE.CanvasTexture(labelCanvas);previewLabel=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthTest:false,depthWrite:false}));previewLabel.scale.set(7.4,1,1);previewLabel.visible=false;previewLabel.renderOrder=20;scene.add(previewLabel);}}
 const ghost=createBlueprintGhost({scene,timberlineReady:()=>!!assets.timberline_ballista,timberline:()=>createTimberlineBallista(assets.timberline_ballista,{castShadow:false,filament:false,autoReload:false})});
 function label(text,valid){if(!labelContext||lastLabel===`${valid}:${text}`)return;lastLabel=`${valid}:${text}`;labelContext.clearRect(0,0,768,104);labelContext.fillStyle='rgba(24,23,20,.9)';labelContext.fillRect(0,0,768,104);labelContext.fillStyle=valid?'#ffe1a0':'#ffb7ad';labelContext.font='bold 25px sans-serif';labelContext.textAlign='center';const lines=[];let line='';for(const word of text.split(' ')){const next=line?`${line} ${word}`:word;if(labelContext.measureText(next).width>730&&line){lines.push(line);line=word;}else line=next;}lines.push(line);lines.slice(0,2).forEach((line,i)=>labelContext.fillText(line,384,lines.length>1?38+i*34:61));previewLabel.material.map.needsUpdate=true;}
 let refinery=null;
 const homeBases=createHomeBaseView({scene});
 const shotGeo=new THREE.IcosahedronGeometry(.28,1),shotMat=new THREE.MeshStandardMaterial({color:0x77736a,roughness:.9});
 const wardGeo=new THREE.RingGeometry(5.92,6,64),wardMat=new THREE.MeshBasicMaterial({color:0x64dbea,transparent:true,opacity:.35,side:THREE.DoubleSide,depthWrite:false});

 function installTimberline(name,gltf){assets[name]=gltf;if(name==='timberline_ballista')for(const e of entries.values())if(e.data.type==='timberline')upgrade(e);
  if(assets.timberline_bolts&&assets.timberline_ballista&&!stuck){stuck=createTimberlineStuck({scene,gltf:assets.timberline_bolts,sharedMaterials:collectMaterials(assets.timberline_ballista.scene),ground:(x,z)=>terrainHeight(snapshot,x,z,false)});if(snapshot)stuck.sync(snapshot);}}
 function upgrade(e){if(e.machine||!assets.timberline_ballista)return;e.machine=createTimberlineBallista(assets.timberline_ballista,{castShadow:false});e.root.add(e.machine.object);addLadderPlates(e.machine.nodes);e.root.traverse(n=>{if(n.isMesh)n.userData.targetId=e.data.id;});}
 function sync(s){snapshot=s;stuck?.sync(s);const ids=new Set();
  if(s.inventions&&!refinery){refinery=createForgeWorks();scene.add(refinery.root);}
  if(refinery)refinery.place(terrainHeight(s,FORGE_WORKS_ORIGIN[0],FORGE_WORKS_ORIGIN[1],false));
  // Battle objectives reuse the commissioned sanctuary, including its real contact geometry.
  homeBases.sync(s);
  const objectives=(s.battle?.status!=='off'&&s.battle?.v!==2?s.battle?.bases||[]:[]).map(b=>({...b,type:'sanctuary',yaw:0,battleBase:true}));
  for(const b of [...s.inventions?.structures||[],...objectives]){if(b.type==='forge')continue;ids.add(b.id);let e=entries.get(b.id);
   if(!e){const root=b.type==='timberline'?new THREE.Group():createInventionModel(b.type);root.name=b.id;root.traverse(n=>{if(n.isMesh)n.userData.targetId=b.id;});scene.add(root);e={root,data:b,fireTick:b.fireTick??-10000};if(b.type==='ward'){e.field=new THREE.Mesh(wardGeo,wardMat);e.field.rotation.x=-Math.PI/2;scene.add(e.field);}entries.set(b.id,e);if(b.type==='timberline')upgrade(e);}
   e.data=b;e.fireTick=b.fireTick??-10000;const p=b.position||[b.x,0,b.z];e.root.position.set(p[0],b.type==='foundation'?p[1]:terrainHeight(s,p[0],p[2],false),p[2]);if(e.root.userData.lastYaw===undefined)e.root.rotation.y=b.yaw||0;e.root.userData.lastYaw=b.yaw||0;e.root.visible=true;
  }
  for(const [id,e]of entries)if(!ids.has(id)){e.machine?.dispose();e.root.removeFromParent();e.field?.removeFromParent();entries.delete(id);}
 }
 function event(ev){
  homeBases.event(ev);
  if(refinery&&(ev.kind==='refinery_feed'||ev.kind==='refinery_output'))refinery.event(ev);
  if(ev.kind==='timberline_shear'&&ev.position)timberFx.chips(new THREE.Vector3(...ev.position),new THREE.Vector3(0,1,0),{count:20});
  if(ev.kind==='timberline_stop'&&ev.position)timberFx.dust(new THREE.Vector3(...ev.position),{count:8});
  if(ev.kind==='timberline_embed'&&ev.position){const at=new THREE.Vector3(...ev.position);if(ev.host==='enemy')timberFx.chips(at,new THREE.Vector3(0,1,0),{count:6});else timberFx.dust(at,{count:ev.host==='ground'?10:6});}
  if(/launcher/.test(ev.kind)&&ev.position&&ev.target){const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...ev.position),new THREE.Vector3(...ev.target)]);const m=new THREE.LineBasicMaterial({color:0xa9ffdc,transparent:true});const line=new THREE.Line(g,m);scene.add(line);effects.push({line,life:.3});while(effects.length>16){const old=effects.shift();old.line.removeFromParent();old.line.geometry.dispose();old.line.material.dispose();}}
 }
 function update(dt,tick,camera=null,viewportHeight=1080){
  homeBases.update(dt,camera);
  timberFx.update(dt);stuck?.update(snapshot,tick);tracers.begin();
  const ids=new Set();for(const q of snapshot?.inventions?.shots||[]){ids.add(q.id);let v=shots.get(q.id);
   if(!v){if(q.type==='timberline'){if(!assets.timberline_bolts)continue;const pair=createTimberlineBoltPair(assets.timberline_bolts,{castShadow:false,sharedMaterials:assets.timberline_ballista?collectMaterials(assets.timberline_ballista.scene):null});v={root:pair.group,pair};}else {v={root:new THREE.Mesh(shotGeo,shotMat)};}scene.add(v.root);shots.set(q.id,v);}
   if(v.pair){v.root.visible=tick>=q.launchTick+(q.v===2?TIMBERLINE_RELEASE_TICKS:0);if(!v.root.visible)continue;const flight=q.v>=2?timberlineFlight(q,Math.min(tick,q.impactTick)):timberlineFlight(q,q.launchTick+TIMBERLINE_RELEASE_TICKS+(tick-q.launchTick)*4),eyeL=new THREE.Vector3(...flight.left),eyeR=new THREE.Vector3(...flight.right);let forward,up,pitchDeg=flight.pitchDeg;
    // v3 pairs fall under world gravity: point them along the true velocity so they nose over on long arcs.
    if(q.v===3){const age=Math.max(0,Math.min(tick,q.impactTick)-q.launchTick-TIMBERLINE_RELEASE_TICKS);forward=new THREE.Vector3(...timberlineVelocity(q,age/60)).normalize();const right=new THREE.Vector3(...timberlineLaunch(q).right);up=new THREE.Vector3().crossVectors(right,forward).normalize();pitchDeg=0;tracers.add(eyeL,forward,age);tracers.add(eyeR,forward,age);}
    else{const frame=timberlineLaunch(q);forward=new THREE.Vector3(...frame.forward);up=new THREE.Vector3(...frame.up);}
    v.pair.update(dt,camera,viewportHeight);v.pair.setState({eyeL,eyeR,forward,up,yawOutDeg:flight.yawOutDeg,pitchDeg,tension:flight.tension,vaneOpen:flight.vaneOpen>0});v.pair.filament.update(0,camera,viewportHeight);}
   else {const t=THREE.MathUtils.clamp((tick-q.launchTick)/(q.impactTick-q.launchTick),0,1);v.root.position.set(...q.origin).lerp(new THREE.Vector3(...q.target),t);v.root.position.y+=Math.sin(t*Math.PI)*6;}
  }
  tracers.end();
  for(const[id,v]of shots)if(!ids.has(id)){v.pair?.dispose();v.root.removeFromParent();shots.delete(id);}
for(const e of entries.values()){const b=e.data;e.root.rotation.y+=Math.atan2(Math.sin(b.yaw-e.root.rotation.y),Math.cos(b.yaw-e.root.rotation.y))*Math.min(1,dt*9);if(e.field){e.field.position.copy(e.root.position);e.field.position.y+=.08;e.field.visible=b.hp>0&&b.charge>0;}if(e.machine){e.root.rotation.y=b.yaw;const local=localAim.get(b.id);e.machine.aimImmediate(local?local.yaw:b.aimYaw||0,local?local.pitch:b.aimPitch||0);const viewer=viewerId&&snapshot?.players?.find(p=>p.id===viewerId),armed=!viewer||viewer.role!=='hero'||(viewer.side==='rivals'?'rivals':'party')!==b.side||timberlineAmmo(snapshot,viewer).total>0;e.armed=armed;e.machine.seekCycle(machineCycleAge({...b,fireTick:e.fireTick},tick),camera,viewportHeight,{ammo:armed});}else animateInventionModel(e.root,{time:tick/60,fireAge:(tick-e.fireTick)/60,damage:1-b.hp/Math.max(1,b.maxHp||STRUCTURES[b.type]?.hp||100),progress:Math.max(0,Math.min(1,1-(b.readyTick-tick)/(b.type==='launcher'?360:240))),active:b.hp>0,yaw:b.aimYaw??0,open:b.open?1:0,armed:b.armed,charge:b.charge/240,bloom:snapshot?.bloom||0,mending:b.type==='influence'&&b.hp>0&&(snapshot?.players||[]).some(p=>p.role==='hero'&&p.hp>0&&(p.side==='rivals'?'rivals':'party')===b.side&&(p.hp<100||p.mana<100)&&Math.hypot(p.position[0]-b.position[0],p.position[2]-b.position[2])<=HEARTSTONE.reach)});e.root.scale.y=b.hp<=0?.24:1;if(b.type==='foundation'){e.root.rotation.z=0;e.root.visible=b.hp>0;}}
  if(refinery){const bay={};for(const q of snapshot?.pickups||[])if(isBayStack(q))bay[q.kind]=(bay[q.kind]||0)+q.amount;
   const feedReady=(snapshot?.players||[]).some(p=>p.role==='hero'&&p.hp>0&&Math.hypot(p.position[0],p.position[2])<12&&Object.keys(p.resources||{}).some(k=>/Ore$/.test(k)&&p.resources[k]>0));
   refinery.animate({time:tick/60,dt,jobs:snapshot?.inventions?.refining?.length||0,feedReady,bay});}
  for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;e.line.material.opacity=Math.max(0,e.life/.3);if(e.life<=0){e.line.removeFromParent();e.line.geometry.dispose();e.line.material.dispose();effects.splice(i,1);}}
 }
 return {installTimberline,installHomeKit:gltf=>homeBases.installKit(gltf),homeBaseStats:()=>homeBases.stats(),sync,event,update,
  // The local operator's predicted aim wins over the last replicated aim, so a manned machine answers the mouse at once.
  setLocalAim(id,aim){homeBases.setLocalAim(id,aim);if(aim)localAim.set(id,aim);else localAim.delete(id);},stuckPose:id=>stuck?.pose(id)||null,setViewer(id){viewerId=id||null;},
  // Who is sighting along the ladder. The ladder stays visible to them (it is the sight).
  setScoped(id,amount=0){scoped=id&&amount>0?{id,amount}:null;},
  scopeEye(id,out=new THREE.Vector3()){const e=entries.get(id);if(!e?.machine)return null;e.root.updateWorldMatrix(true,true);return e.machine.nodes.Socket_ScopeEye?.getWorldPosition(out)||null;},
  targets:()=>[...entries.values()].filter(e=>e.data.hp>0).map(e=>e.root).concat(homeBases.targets()),preview(point,type,validation=null,{yaw=0,dt=1/60,time=0,label:showLabel=true}={}){
   previewState=point?validation:null;const valid=validation?.ok!==false,color=valid?BLUEPRINT_COLORS.valid.ring:BLUEPRINT_COLORS.invalid.ring,at=validation?.position|| (point?[point.x,point.y,point.z]:null);
   // Operating a machine aims a target ring only; building shows the see-through model where it will stand.
   if(point&&STRUCTURES[type])ghost.show({type,position:type==='foundation'?[Math.round(at[0]/.75)*.75,at[1],Math.round(at[2]/.75)*.75]:at,yaw:type==='foundation'?0:(validation?.yaw??yaw),valid,dt,time});else ghost.hide();
   tilePreview.visible=!!point&&type==='foundation';tileFill.visible=tilePreview.visible;ring.visible=!!point&&type!=='foundation';
   if(point){const x=type==='foundation'?Math.round(at[0]/.75)*.75:at[0],z=type==='foundation'?Math.round(at[2]/.75)*.75:at[2];tilePreview.position.set(x,at[1]+.07,z);tileFill.position.set(x,at[1]+.065,z);ring.position.set(x,at[1]+.06,z);const r=STRUCTURES[type]?.radius||1.7;ring.scale.setScalar(r/1.7);tilePreview.material.color.setHex(color);tileFill.material.color.setHex(color);ring.material.color.setHex(color);if(previewLabel){previewLabel.position.set(x,at[1]+Math.max(1.65,(STRUCTURES[type]?.radius||1)*1.6+1),z);previewLabel.visible=showLabel&&!!validation&&!valid;label(validation?.reason||'',valid);}}
   else if(previewLabel)previewLabel.visible=false;
   return previewState;
  },stats:()=>({structures:entries.size,models:[...entries.values()].map(e=>({id:e.data.id,type:e.data.type,hp:e.data.hp,asset:e.machine?'opus-twinbolt':null,armed:e.armed,loadedVisible:e.machine?.nodes.LoadedBolt_L.visible,phase:e.machine?.state,lod:e.machine?.lod,aim:e.machine?.aim})),timberlineAssets:Object.keys(assets),volleys:[...shots.values()].filter(v=>v.pair).length,tracers:tracers.count,stuck:stuck?.stats()||null,effects:effects.length,placement:previewState,blueprint:ghost.stats()}),dispose(){ghost.dispose();refinery?.dispose();refinery=null;for(const e of entries.values()){e.machine?.dispose();e.root.removeFromParent();e.field?.removeFromParent();}for(const v of shots.values()){v.pair?.dispose();v.root.removeFromParent();}timberFx.dispose();tracers.dispose();stuck?.dispose();const resources=new Set();for(const gltf of Object.values(assets))gltf.scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){resources.add(m);for(const v of Object.values(m))if(v?.isTexture)resources.add(v);}});for(const r of resources)r.dispose();shots.clear();for(const g of [shotGeo,wardGeo])g.dispose();for(const m of [shotMat,wardMat])m.dispose();entries.clear();refinery?.removeFromParent();tilePreview.removeFromParent();tilePreview.geometry.dispose();tilePreview.material.dispose();tileFill.removeFromParent();tileFill.geometry.dispose();tileFill.material.dispose();if(previewLabel){previewLabel.removeFromParent();previewLabel.material.map.dispose();previewLabel.material.dispose();}ring.removeFromParent();ring.geometry.dispose();ring.material.dispose();for(const e of effects){e.line.removeFromParent();e.line.geometry.dispose();e.line.material.dispose();}disposeInventionArt();}};
}
