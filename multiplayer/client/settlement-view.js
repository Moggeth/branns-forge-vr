import * as THREE from 'three';

// Reuses the already loaded adventurer, palettes, weapon sockets, locomotion and
// attack clips. Owns only actor roots; the caller retains shared asset ownership.
export function createSettlementView({scene,heroView}) {
 const entries=new Map();let workers=[];
 const data=w=>({...w,hp:100,role:'hero',tool:w.job==='wood'?'axe':'pick',name:`Worker ${w.id.replace('worker','')} · ${w.job}`});
 function sync(snapshot){
  workers=snapshot?.settlement?.workers||[];const ids=new Set(workers.map(w=>w.id));
  for(const [id,e]of entries)if(!ids.has(id)){heroView.release(e.visual);e.root.removeFromParent();entries.delete(id);}
  for(const w of workers){
   let e=entries.get(w.id);if(!e){const visual=heroView.create(data(w),{variant:'mosswarden'});if(!visual)continue;const root=new THREE.Group();root.name=`Settlement ${w.id}`;root.userData.workerId=w.id;root.add(visual);scene.add(root);e={root,visual,data:data(w),position:new THREE.Vector3(...w.position),yaw:w.yaw};entries.set(w.id,e);root.position.copy(e.position);root.rotation.y=w.yaw;}
   e.data=data(w);e.position.fromArray(w.position);e.yaw=w.yaw;e.root.userData.label=e.data.name;e.root.userData.phase=w.phase;e.root.userData.cargo=w.cargo;
  }
 }
 function update(dt,cameraPosition){
  if(entries.size<workers.length&&heroView.ready())sync({settlement:{workers}});
  for(const e of entries.values()){e.root.position.lerp(e.position,1-Math.exp(-dt*15));const delta=Math.atan2(Math.sin(e.yaw-e.root.rotation.y),Math.cos(e.yaw-e.root.rotation.y));e.root.rotation.y+=delta*(1-Math.exp(-dt*15));heroView.update(e.visual,e.data,e.root,dt,cameraPosition);}
 }
 function event(ev){for(const e of entries.values())if(ev.by===e.data.id)heroView.event(e.visual,ev,e.data);}
 function dispose(){for(const e of entries.values()){heroView.release(e.visual);e.root.removeFromParent();}entries.clear();workers=[];}
 return {sync,update,event,dispose,stats:()=>({workers:entries.size,ids:[...entries.keys()]})};
}
