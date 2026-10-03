import * as THREE from 'three';
import {createInventionModel,animateInventionModel,disposeInventionArt} from './invention-art.js';
import {STRUCTURES} from '../shared/inventions.js';
import {terrainHeight} from '../shared/terrain.js';
// Presentation consumes authoritative structures; no gameplay timers or resources live here.
export function createInventionView({scene}){
 const entries=new Map(),shots=new Map();let snapshot=null;const effects=[];
 const ring=new THREE.Mesh(new THREE.RingGeometry(1.7,1.78,40),new THREE.MeshBasicMaterial({color:0xe9ca75,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.visible=false;scene.add(ring);
 const tilePreview=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-3,0,-3),new THREE.Vector3(3,0,-3),new THREE.Vector3(3,0,3),new THREE.Vector3(-3,0,3)]),new THREE.LineBasicMaterial({color:0xe9ca75}));tilePreview.visible=false;scene.add(tilePreview);
 const tileFill=new THREE.Mesh(new THREE.PlaneGeometry(6,6),new THREE.MeshBasicMaterial({color:0xe9ca75,transparent:true,opacity:.15,depthWrite:false,side:THREE.DoubleSide}));tileFill.rotation.x=-Math.PI/2;tileFill.visible=false;scene.add(tileFill);
 let previewState=null,previewLabel=null,labelCanvas=null,labelContext=null,lastLabel='';
 if(typeof document!=='undefined'){labelCanvas=document.createElement('canvas');labelCanvas.width=768;labelCanvas.height=104;labelContext=labelCanvas.getContext('2d');if(labelContext){const map=new THREE.CanvasTexture(labelCanvas);previewLabel=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthTest:false,depthWrite:false}));previewLabel.scale.set(7.4,1,1);previewLabel.visible=false;previewLabel.renderOrder=20;scene.add(previewLabel);}}
 function label(text,valid){if(!labelContext||lastLabel===`${valid}:${text}`)return;lastLabel=`${valid}:${text}`;labelContext.clearRect(0,0,768,104);labelContext.fillStyle='rgba(24,23,20,.9)';labelContext.fillRect(0,0,768,104);labelContext.fillStyle=valid?'#ffe1a0':'#ffb7ad';labelContext.font='bold 25px sans-serif';labelContext.textAlign='center';const lines=[];let line='';for(const word of text.split(' ')){const next=line?`${line} ${word}`:word;if(labelContext.measureText(next).width>730&&line){lines.push(line);line=word;}else line=next;}lines.push(line);lines.slice(0,2).forEach((line,i)=>labelContext.fillText(line,384,lines.length>1?38+i*34:61));previewLabel.material.map.needsUpdate=true;}
 let refinery=null;
 const shotGeo=new THREE.IcosahedronGeometry(.28,1),boltGeo=new THREE.CylinderGeometry(.035,.035,.9,6),shotMat=new THREE.MeshStandardMaterial({color:0x77736a,roughness:.9}),boltMat=new THREE.MeshStandardMaterial({color:0xbbaa86,metalness:.6,roughness:.4});
 const filamentGeo=new THREE.CylinderGeometry(.018,.018,1.4,6),filamentMat=new THREE.MeshBasicMaterial({color:0xb1fff0});
 const wardGeo=new THREE.RingGeometry(5.92,6,64),wardMat=new THREE.MeshBasicMaterial({color:0x64dbea,transparent:true,opacity:.35,side:THREE.DoubleSide,depthWrite:false});

 function sync(s){snapshot=s;const ids=new Set();
  if(s.inventions&&!refinery){refinery=createInventionModel('forgeRefinery');refinery.position.set(2.5,terrainHeight(s,2.5,0,false),0);scene.add(refinery);}
  for(const b of s.inventions?.structures||[]){if(b.type==='forge')continue;ids.add(b.id);let e=entries.get(b.id);
   if(!e){const root=createInventionModel(b.type);root.name=b.id;root.traverse(n=>{if(n.isMesh)n.userData.targetId=b.id;});scene.add(root);e={root,data:b,fireTick:b.fireTick??-10000};if(b.type==='ward'){e.field=new THREE.Mesh(wardGeo,wardMat);e.field.rotation.x=-Math.PI/2;scene.add(e.field);}entries.set(b.id,e);}
   e.data=b;e.fireTick=Math.max(e.fireTick,b.fireTick??-10000);const p=b.position||[b.x,0,b.z];e.root.position.set(p[0],b.type==='foundation'?p[1]:terrainHeight(s,p[0],p[2],false),p[2]);if(e.root.userData.lastYaw===undefined)e.root.rotation.y=b.yaw||0;e.root.userData.lastYaw=b.yaw||0;e.root.visible=true;
  }
  for(const [id,e]of entries)if(!ids.has(id)){e.root.removeFromParent();e.field?.removeFromParent();entries.delete(id);}
 }
 function event(ev){const e=entries.get(ev.structureId||ev.id);if(e&&/fire|shot|launch|timberline/.test(ev.kind))e.fireTick=snapshot?.tick||0;
  if(/timberline|launcher/.test(ev.kind)&&ev.position&&ev.target){const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...ev.position),new THREE.Vector3(...ev.target)]);const m=new THREE.LineBasicMaterial({color:0xa9ffdc,transparent:true});const line=new THREE.Line(g,m);scene.add(line);effects.push({line,life:.3});while(effects.length>16){const old=effects.shift();old.line.removeFromParent();old.line.geometry.dispose();old.line.material.dispose();}}
 }
 function update(dt,tick){
  const ids=new Set();for(const q of snapshot?.inventions?.shots||[]){ids.add(q.id);let v=shots.get(q.id);if(!v){v=new THREE.Group();if(q.type==='launcher')v.add(new THREE.Mesh(shotGeo,shotMat));else {for(const x of [-.7,.7]){const b=new THREE.Mesh(boltGeo,boltMat);b.position.x=x;b.rotation.x=Math.PI/2;v.add(b);}const line=new THREE.Mesh(filamentGeo,filamentMat);line.rotation.z=Math.PI/2;v.add(line);}scene.add(v);shots.set(q.id,v);}const t=THREE.MathUtils.clamp((tick-q.launchTick)/(q.impactTick-q.launchTick),0,1);v.position.set(...q.origin).lerp(new THREE.Vector3(...q.target),t);if(q.type==='launcher')v.position.y+=Math.sin(t*Math.PI)*6;else {v.position.y=q.origin[1];v.rotation.y=Math.atan2(-(q.target[0]-q.origin[0]),-(q.target[2]-q.origin[2]));}}
  for(const[id,v]of shots)if(!ids.has(id)){v.removeFromParent();shots.delete(id);}
for(const e of entries.values()){const b=e.data;e.root.rotation.y+=Math.atan2(Math.sin(b.yaw-e.root.rotation.y),Math.cos(b.yaw-e.root.rotation.y))*Math.min(1,dt*9);if(e.field){e.field.position.copy(e.root.position);e.field.position.y+=.08;e.field.visible=b.hp>0&&b.charge>0;}animateInventionModel(e.root,{time:tick/60,fireAge:(tick-e.fireTick)/60,damage:1-b.hp/Math.max(1,b.maxHp||STRUCTURES[b.type]?.hp||100),progress:Math.max(0,Math.min(1,1-(b.readyTick-tick)/(b.type==='launcher'?360:240))),active:b.hp>0,yaw:b.aimYaw??0,open:b.open?1:0,armed:b.armed,charge:b.charge/240});e.root.scale.y=b.hp<=0?.24:1;if(b.type==='foundation'){e.root.rotation.z=0;e.root.visible=b.hp>0;}}
  if(refinery)animateInventionModel(refinery,{time:tick/60,progress:snapshot?.pickups?.some(q=>q.id.startsWith('ingot'))?1:0,active:!!snapshot?.inventions?.refining?.length});
  for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;e.line.material.opacity=Math.max(0,e.life/.3);if(e.life<=0){e.line.removeFromParent();e.line.geometry.dispose();e.line.material.dispose();effects.splice(i,1);}}
 }
 return {sync,event,update,targets:()=>[...entries.values()].filter(e=>e.data.hp>0).map(e=>e.root),preview(point,type,validation=null){
   previewState=point?validation:null;const valid=validation?.ok!==false,color=valid?0xe9ca75:0xf06458,at=validation?.position|| (point?[point.x,point.y,point.z]:null);
   tilePreview.visible=!!point&&type==='foundation';tileFill.visible=tilePreview.visible;ring.visible=!!point&&type!=='foundation';
   if(point){const x=type==='foundation'?Math.round(at[0]/.75)*.75:at[0],z=type==='foundation'?Math.round(at[2]/.75)*.75:at[2];tilePreview.position.set(x,at[1]+.07,z);tileFill.position.set(x,at[1]+.065,z);ring.position.set(x,at[1]+.06,z);const r=STRUCTURES[type]?.radius||1.7;ring.scale.setScalar(r/1.7);tilePreview.material.color.setHex(color);tileFill.material.color.setHex(color);ring.material.color.setHex(color);if(previewLabel){previewLabel.position.set(x,at[1]+1.65,z);previewLabel.visible=!!validation&&!valid;label(validation?.reason||'',valid);}}
   else if(previewLabel)previewLabel.visible=false;
   return previewState;
  },stats:()=>({structures:entries.size,models:[...entries.values()].map(e=>({id:e.data.id,type:e.data.type,hp:e.data.hp})),effects:effects.length,placement:previewState}),dispose(){for(const e of entries.values()){e.root.removeFromParent();e.field?.removeFromParent();}for(const v of shots.values())v.removeFromParent();shots.clear();for(const g of [shotGeo,boltGeo,filamentGeo,wardGeo])g.dispose();for(const m of [shotMat,boltMat,filamentMat,wardMat])m.dispose();entries.clear();refinery?.removeFromParent();tilePreview.removeFromParent();tilePreview.geometry.dispose();tilePreview.material.dispose();tileFill.removeFromParent();tileFill.geometry.dispose();tileFill.material.dispose();if(previewLabel){previewLabel.removeFromParent();previewLabel.material.map.dispose();previewLabel.material.dispose();}ring.removeFromParent();ring.geometry.dispose();ring.material.dispose();for(const e of effects){e.line.removeFromParent();e.line.geometry.dispose();e.line.material.dispose();}disposeInventionArt();}};
}
