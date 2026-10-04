// Stuck Timberline pairs: one bolt buried where it struck, its twin swinging on the wire until it settles.
// The authority only records the shot frame, flight time, anchor and host (shared/timberline-flight.js). Each client
// rebuilds the same rest pose with a fixed 60 Hz rope-and-rod integration from the moment of impact, so peers agree.
// All stuck bolts draw as instanced copies of the deployed bolt meshes, and every wire as one instanced segment
// batch, so sixty pairs cost a handful of draw calls.
import * as THREE from 'three';
import {createTimberlineBoltPair} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-bolts.js';
import {lodOf} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-ballista.js';
import {createFilamentMaterial} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-filament.js';
import {timberlineFlightAt,timberlineVelocity,stuckAnchor,TIMBERLINE_LONG} from '../shared/timberline-flight.js';
import {TIMBERLINE_FLIGHT} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-flight.js';

export const STUCK_TETHER=Object.freeze({rod:.905,rope:TIMBERLINE_FLIGHT.tautHalf*2,gravity:9.81,carry:.22,drag:.004,iterations:4,catchUp:600,
 sleepSpeed:.004,ground:.035,friction:.35,wireSegments:8,wireRadius:.0045});
const DT=1/60,_n=new THREE.Matrix4(),_v=new THREE.Vector3(),_w=new THREE.Vector3(),_f=new THREE.Vector3(),_r=new THREE.Vector3(),_u=new THREE.Vector3(),_m=new THREE.Matrix4(),_q=new THREE.Quaternion(),_s=new THREE.Vector3(1,1,1),_y=new THREE.Vector3(0,1,0);

// One free bolt: the filament eye and the nock as two verlet particles joined by a rigid rod, the eye roped to an anchor.
function freeBolt(eye,velocity,forward,rope){const e=new THREE.Vector3(...eye),n=e.clone().addScaledVector(forward,-STUCK_TETHER.rod),v=new THREE.Vector3(...velocity).multiplyScalar(STUCK_TETHER.carry*DT);
 return {e,n,pe:e.clone().sub(v),pn:n.clone().sub(v),rope,asleep:false,still:0};}
function stepBolt(b,anchor,ground){const g=STUCK_TETHER.gravity*DT*DT,k=1-STUCK_TETHER.drag;
 for(const [p,q] of [[b.e,b.pe],[b.n,b.pn]]){_v.subVectors(p,q).multiplyScalar(k);q.copy(p);p.add(_v);p.y-=g;}
 for(let it=0;it<STUCK_TETHER.iterations;it++){
  _v.subVectors(b.e,anchor);const d=_v.length();if(d>b.rope){b.e.copy(anchor).addScaledVector(_v,b.rope/d);}
  _v.subVectors(b.n,b.e);const r=_v.length()||1e-6,c=(r-STUCK_TETHER.rod)/r*.5;b.e.addScaledVector(_v,c);b.n.addScaledVector(_v,-c);
  for(const [p,q] of [[b.e,b.pe],[b.n,b.pn]]){const floor=ground(p.x,p.z)+STUCK_TETHER.ground;if(p.y<floor){p.y=floor;q.x+=(p.x-q.x)*STUCK_TETHER.friction;q.z+=(p.z-q.z)*STUCK_TETHER.friction;if(q.y<floor)q.y=floor;}}
 }
 const moved=b.e.distanceTo(b.pe)+b.n.distanceTo(b.pn);b.still=moved<STUCK_TETHER.sleepSpeed?b.still+1:0;b.asleep=b.still>30;}

export function createTimberlineStuck({scene,gltf,sharedMaterials=null,ground}){
 // Template: a deployed pair, read once for each mesh's pose relative to its bolt root.
 const pair=createTimberlineBoltPair(gltf,{castShadow:false,sharedMaterials,readability:null});pair.openVanes();pair.mixer.update(2);pair.group.updateMatrixWorld(true);
 const cap=TIMBERLINE_LONG.stuckCap,parts={L:[],R:[]},batches=[];
 for(const tag of ['L','R']){const root=pair.bolts[tag],inv=root.matrixWorld.clone().invert();root.traverse(o=>{if(!o.isMesh||lodOf(o)===1)return;const mesh=new THREE.InstancedMesh(o.geometry,o.material,cap);mesh.name=`TimberlineStuck_${tag}_${o.name}`;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);parts[tag].push({mesh,local:inv.clone().multiply(o.matrixWorld)});batches.push(mesh);});}
 const eyeLocal={L:pair.nodes.Bolt_L_FilamentEye.position.clone(),R:pair.nodes.Bolt_R_FilamentEye.position.clone()};pair.dispose();
 const segCap=cap*STUCK_TETHER.wireSegments*2,wireGeo=new THREE.CylinderGeometry(STUCK_TETHER.wireRadius,STUCK_TETHER.wireRadius,1,5,1,true).translate(0,.5,0),wireMat=createFilamentMaterial();
 const wire=new THREE.InstancedMesh(wireGeo,wireMat,segCap);wire.name='TimberlineStuckWire';wire.count=0;wire.frustumCulled=false;wire.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(wire);
 const live=new Map();let dirty=true;

 function build(r,s){const f=timberlineFlightAt(r,r.t),vel=timberlineVelocity(r,r.t),dir=new THREE.Vector3(...vel).normalize(),anchor=new THREE.Vector3(...stuckAnchor(s,r)),eyes={L:f.left,R:f.right},free={};
  for(const tag of ['L','R'])if(r.mode!==tag){const rope=r.mode==='snag'?Math.min(STUCK_TETHER.rope,anchor.distanceTo(_v.set(...eyes[tag]))+.02):STUCK_TETHER.rope;free[tag]=freeBolt(eyes[tag],vel,dir,rope);}
  const e={r,dir,anchor,free,ticks:0};const n=Math.min(STUCK_TETHER.catchUp,Math.max(0,(s.tick??r.tick)-r.tick));for(let k=0;k<n;k++)advance(e,s);return e;}
 function advance(e,s){e.ticks++;for(const b of Object.values(e.free))if(!b.asleep||e.r.hostKind==='enemy')stepBolt(b,e.anchor,ground);}
 function hostTurn(r,s){if(r.hostKind!=='enemy')return 0;const h=s.enemies?.find(x=>x.id===r.host);return h?(h.yaw||0)-(r.yaw||0):0;}

 function place(tag,i,eye,forward){_f.copy(forward).normalize();_r.crossVectors(_f,Math.abs(_f.y)>.97?_w.set(1,0,0):_y).normalize();_u.crossVectors(_r,_f);
  _m.makeBasis(_r,_u,_v.copy(_f).negate());_q.setFromRotationMatrix(_m);_v.copy(eyeLocal[tag]).applyQuaternion(_q);_w.copy(eye).sub(_v);_m.compose(_w,_q,_s);
  for(const p of parts[tag])p.mesh.setMatrixAt(i,_n.multiplyMatrices(_m,p.local));}
 const segment=new THREE.Matrix4(),_a=new THREE.Vector3(),_b=new THREE.Vector3(),_c=new THREE.Vector3(),_p=new THREE.Vector3(),_o=new THREE.Vector3();
 let segs=0;
 function wireTo(a,b,length){const d=a.distanceTo(b),sag=d<length?Math.sqrt(Math.max(0,length*length-d*d))*.5:0;_c.addVectors(a,b).multiplyScalar(.5);_c.y-=sag;_o.copy(a);
  for(let k=1;k<=STUCK_TETHER.wireSegments&&segs<segCap;k++){const t=k/STUCK_TETHER.wireSegments,u=1-t;_p.set(0,0,0).addScaledVector(a,u*u).addScaledVector(_c,2*u*t).addScaledVector(b,t*t);
   _v.subVectors(_p,_o);const len=_v.length();if(len>1e-5){_q.setFromUnitVectors(_y,_v.divideScalar(len));segment.compose(_o,_q,_w.set(1,len,1));wire.setMatrixAt(segs++,segment);}_o.copy(_p);}}

 function sync(s){const records=s?.inventions?.stuck||[],ids=new Set();for(const r of records){ids.add(r.id);if(!live.has(r.id)){live.set(r.id,build(r,s));dirty=true;}}for(const id of live.keys())if(!ids.has(id)){live.delete(id);dirty=true;}}
 function update(s,tick){if(!s)return;let moving=false;
  for(const e of live.values()){const target=Math.min(tick,e.r.tick+e.ticks+STUCK_TETHER.catchUp);if(e.r.hostKind==='enemy')e.anchor.set(...stuckAnchor(s,e.r));
   while(e.r.tick+e.ticks<target){advance(e,s);moving=true;}if(e.r.hostKind==='enemy'||Object.values(e.free).some(b=>!b.asleep))moving=true;}
  if(!moving&&!dirty)return;dirty=false;let i=0;segs=0;
  for(const e of live.values()){if(i>=cap)break;const dir=_a.copy(e.dir).applyAxisAngle(_y,hostTurn(e.r,s));
   if(e.r.mode!=='snag')place(e.r.mode,i,e.anchor,dir);
   for(const [tag,b]of Object.entries(e.free))place(tag,i,b.e,_b.subVectors(b.e,b.n));
   if(e.r.mode==='snag'){wireTo(e.free.L.e,e.anchor,e.free.L.rope);wireTo(e.anchor,e.free.R.e,e.free.R.rope);}
   else{const b=Object.values(e.free)[0];wireTo(e.anchor,b.e,b.rope);}
   i++;}
  for(const tag of ['L','R'])for(const p of parts[tag]){p.mesh.count=i;p.mesh.instanceMatrix.needsUpdate=true;}
  wire.count=segs;wire.instanceMatrix.needsUpdate=true;}
 return {sync,update,
  stats:()=>({pairs:live.size,drawCalls:batches.length+1,sleeping:[...live.values()].filter(e=>Object.values(e.free).every(b=>b.asleep)).length,wireSegments:segs}),
  pose(id){const e=live.get(id);if(!e)return null;return {anchor:e.anchor.toArray(),free:Object.fromEntries(Object.entries(e.free).map(([k,b])=>[k,{eye:b.e.toArray(),nock:b.n.toArray(),asleep:b.asleep}]))};},
  dispose(){for(const m of batches)m.removeFromParent();wire.removeFromParent();wireGeo.dispose();wireMat.dispose();live.clear();}};
}
