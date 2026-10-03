import {applyCrystalMaterial} from './material-refinements.js';
// Pick special "crystal wall" presentation (Opus 2026-10-03).
// Deposits with special:'pick_wall' (x,z,hits,maxHits,depleted,editId) are the 7 curved linked segments the root raised by 2.4 m.
// Each segment = a deterministic cluster of faceted crystals, base at height(x,z)-2.4 and tips ~height(x,z)+.5.
// Newborn deposits thrust up + twist along the curve tangent in 600 ms; deposits present at first sync (late join) are mature.
// Damage removes whole crystals one by one in a deterministic per-id order (no whole-model scale). Every live crystal is a
// real Mesh with userData.targetId=deposit.id, so ray hits land on the exact visible facets; broken crystals are detached
// from the tagged hierarchy before their short fall so they never receive hits. Geometry/materials are module-owned and shared
// between all walls; nothing mutates a material after creation.
export const WALL_DEPTH=2.4,TIP_ABOVE=.5,GROW_MS=600,CRYSTALS_PER_SEGMENT=9;
const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const rng=seed=>()=>{seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
export function createCrystalWall({THREE:T,scene,height,now=()=>performance.now()}){
 const root=new T.Group();root.name='CrystalWalls';scene.add(root);
 const debris=new T.Group();debris.name='CrystalWallDebris';scene.add(debris);
 // Shared resources (owned here, disposed in dispose()). Colours match the pick's Resonance_Crystal.
 const mats={core:new T.MeshStandardMaterial({color:0x0d2a78,emissive:0x0a47d8,emissiveIntensity:.85,roughness:.18,metalness:.05,flatShading:true}),
  pale:new T.MeshStandardMaterial({color:0x3f7fe0,emissive:0x0b3aa8,emissiveIntensity:.6,roughness:.12,metalness:0,flatShading:true}),
  rock:new T.MeshStandardMaterial({color:0x3b3a44,roughness:.92,metalness:.05,flatShading:true})};
 // Unit crystal: hex prism y=0..1 with pointed tip, radius 1; scaled per crystal (length, radius). 3 variants for variety.
 for(const [kind,material] of Object.entries(mats))applyCrystalMaterial(material,kind);
 const shapes=[0,1,2].map(v=>unitCrystal(T,6-(v&1),.26+v*.06,rng(91+v)));
 const plinth=new T.DodecahedronGeometry(1,0);
 const segments=new Map();let first=true,lastSnapshot=null;
 function curveFrames(list){ // order linked segments of one editId along the curve and derive tangents
  const ordered=list.map((d,segment)=>({...d,segment}));
  if(ordered.every(d=>Number.isFinite(d.segment)))ordered.sort((a,b)=>a.segment-b.segment);
  else{let a=ordered[0],far=a,best=-1;for(const d of ordered){const q=(d.x-a.x)**2+(d.z-a.z)**2;if(q>best){best=q;far=d;}}
   for(const d of ordered){const q=(d.x-far.x)**2+(d.z-far.z)**2;if(q>best){best=q;a=d;}}// a = one end
   ordered.sort((p,q)=>((p.x-a.x)**2+(p.z-a.z)**2)-((q.x-a.x)**2+(q.z-a.z)**2)||String(p.id).localeCompare(String(q.id)));}
  return ordered.map((d,i)=>{const p=ordered[Math.max(0,i-1)],n=ordered[Math.min(ordered.length-1,i+1)];
   let tx=n.x-p.x,tz=n.z-p.z;const l=Math.hypot(tx,tz);if(l>.001){tx/=l;tz/=l;}else{tx=0;tz=-1;}
   const gap=ordered.length>1?Math.hypot(n.x-p.x,n.z-p.z)/(n===p?1:(ordered.indexOf(n)-ordered.indexOf(p))):1.2;
   return {d,index:i,count:ordered.length,tangent:[tx,tz],half:Math.max(.45,gap*.55)};});
 }
 function build(f,edits,born){
  const {d,tangent:[tx,tz],half}=f,r=rng(hash(d.id)),ground=height(d.x,d.z,edits);
  const base=ground-WALL_DEPTH,top=ground+TIP_ABOVE,nx=-tz,nz=tx;
  const g=new T.Group();g.name='CrystalWall_'+d.id;g.position.set(d.x,0,d.z);g.userData.targetId=d.id;
  const crystals=[];
  for(let k=0;k<CRYSTALS_PER_SEGMENT;k++){
   const along=(k/(CRYSTALS_PER_SEGMENT-1)*2-1)*half*(.85+r()*.15),side=(r()-.5)*.55,core=k%3===1;
   const len=(top-base)*(core?1:.72+r()*.22)+(r()-.5)*.25,rad=(core?.30:.17+r()*.1)*(1+Math.abs(side)*.3);
   const lean=(side>=0?1:-1)*(.08+r()*.22),twist=(r()-.5)*.6;
   const m=new T.Mesh(shapes[k%3],core?mats.core:mats.pale);
   m.userData.targetId=d.id;m.userData.shape=k%3;m.name='Crystal_'+k;
   const pos=new T.Vector3(tx*along+nx*side,base,tz*along+nz*side);
   // final orientation: lean outward from the wall plane (about the tangent) + a little along it, twist about its own axis
   const q=new T.Quaternion().setFromAxisAngle(new T.Vector3(tx,0,tz),-lean).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(nx,0,nz),(r()-.5)*.25)).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),twist*Math.PI));
   m.userData.rest={pos,q,scale:new T.Vector3(rad,len,rad)};
   // stagger thrust along the curve (wave runs from the player end) inside the 600 ms budget
   m.userData.delay=(f.index/Math.max(1,f.count-1))*.28+(k/CRYSTALS_PER_SEGMENT)*.08;
   m.userData.order=(core?10:0)+r()+(1-Math.abs(side))*.5; // break outer shards first, cores last
   applyGrowth(m,born?0:1,[tx,tz]);crystals.push(m);
  }
  // rubble plinth at ground line hides the seam where crystals leave the raised terrain; tagged, so hits on it also mine the deposit
  const rubble=new T.InstancedMesh(plinth,mats.rock,3),dummy=new T.Object3D();rubble.name='WallRubble';rubble.userData.targetId=d.id;
  for(let k=0;k<3;k++){const a=(k-1)*half*.7;dummy.position.set(tx*a+nx*(r()-.5)*.4,ground-.05,tz*a+nz*(r()-.5)*.4);dummy.scale.set(.28+r()*.15,.16+r()*.08,.26+r()*.15);dummy.rotation.set(r()*3,r()*3,r()*3);dummy.updateMatrix();rubble.setMatrixAt(k,dummy.matrix);}
  rubble.computeBoundingSphere();g.add(rubble);
  const batches=shapes.map((geometry,k)=>{const mesh=new T.InstancedMesh(geometry,k===1?mats.core:mats.pale,CRYSTALS_PER_SEGMENT);mesh.name='CrystalBatch_'+k;mesh.userData.targetId=d.id;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);g.add(mesh);return mesh;});
  crystals.sort((a,b)=>a.userData.order-b.userData.order);
  root.add(g);const seg={group:g,crystals,batches,removed:0,born:born?now():-1e9,tangent:[tx,tz],data:d,ground};refreshInstances(seg);return seg;
 }
 function refreshInstances(seg){
  for(let k=0;k<seg.batches.length;k++){const mesh=seg.batches[k];let count=0;
   for(let i=seg.removed;i<seg.crystals.length;i++){const crystal=seg.crystals[i];if(crystal.userData.shape!==k)continue;crystal.updateMatrix();mesh.setMatrixAt(count++,crystal.matrix);}
   mesh.count=count;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
 }

 function applyGrowth(m,u,[tx,tz]){ // u 0..1 thrust: rises from below + spins about the curve tangent into place (ease-out-back)
  const {pos,q,scale}=m.userData.rest,c=1.6,e=u>=1?1:1+(c+1)*Math.pow(u-1,3)+c*Math.pow(u-1,2);
  m.position.copy(pos);m.position.y-=(1-Math.min(1,e))*scale.y*.9;
  m.quaternion.copy(q);if(u<1)m.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(tx,0,tz),(1-e)*1.1)).premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),(1-e)*.9));
  m.scale.set(scale.x*(.55+.45*Math.min(1,e)),scale.y*Math.max(.05,e),scale.z*(.55+.45*Math.min(1,e)));
 }
 function breakCrystal(seg,m,{animate=true}={}){
  if(!animate){m.removeFromParent();return;} // detach from tagged group first -> no further ray hits; short deterministic fall
  seg.group.add(m);m.updateWorldMatrix(true,false);debris.attach(m);delete m.userData.targetId;m.raycast=()=>{};m.userData.ignoreContact=true;
  const r=rng(hash(seg.data.id+':'+m.name));const [tx,tz]=seg.tangent;
  m.userData.fall={t:0,v:new T.Vector3((r()-.5)*1.2-tz*.8,1.4+r(),(r()-.5)*1.2+tx*.8),spin:new T.Vector3(r()*6,r()*4,r()*6)};
 }
 function sync(s){lastSnapshot=s;const walls=(s.deposits||[]).filter(d=>d.special==='pick_wall');const seen=new Set();
  // Authority uses a unique editId per segment, not per cast. Its persisted
  // insertion order retains seven-point curved casts, including depleted tombstones.
  const byEdit=new Map();let group=[];
  for(const d of walls){const previous=group.at(-1);if(group.length>=7||previous&&Math.hypot(previous.x-d.x,previous.z-d.z)>1.4)group=[];
   if(!group.length)byEdit.set(d.id,group);group.push(d);}

  for(const list of byEdit.values())for(const f of curveFrames(list)){const d=f.d;seen.add(d.id);let seg=segments.get(d.id);
   if(seg&&(d.hits<seg.data.hits||d.x!==seg.data.x||d.z!==seg.data.z)){retire(d.id,seg);seg=null;}
   const newlyCreated=!seg;
   if(!seg){if(d.depleted)continue;seg=build(f,s.edits,!first&&!(d.hits>0));segments.set(d.id,seg);}
   seg.group.position.y=height(d.x,d.z,s.edits)-seg.ground;
   seg.data=d;
   const max=Math.max(1,d.maxHits||1),target=d.depleted?seg.crystals.length:Math.min(seg.crystals.length-1,Math.floor(seg.crystals.length*Math.min(1,(d.hits||0)/max)));
   while(seg.removed<target)breakCrystal(seg,seg.crystals[seg.removed++],{animate:!newlyCreated});
   refreshInstances(seg);if(d.depleted&&seg.removed>=seg.crystals.length)retire(d.id,seg);}
  for(const [id,seg]of segments)if(!seen.has(id)){while(seg.removed<seg.crystals.length)breakCrystal(seg,seg.crystals[seg.removed++]);retire(id,seg);}
  first=false;}
 function retire(id,seg){seg.group.removeFromParent();segments.delete(id);} // shared geometry/material: nothing to dispose per segment
 function update(dt){const t=now();
  for(const seg of segments.values()){const age=(t-seg.born)/GROW_MS;if(age>1.6)continue;
   for(let k=seg.removed;k<seg.crystals.length;k++){const m=seg.crystals[k],u=Math.min(1,Math.max(0,(age-m.userData.delay)/(1-.36)));applyGrowth(m,u,seg.tangent);}refreshInstances(seg);}
  for(const m of [...debris.children]){const f=m.userData.fall;f.t+=dt;f.v.y-=9.8*dt;m.position.addScaledVector(f.v,dt);m.rotation.x+=f.spin.x*dt;m.rotation.y+=f.spin.y*dt;m.rotation.z+=f.spin.z*dt;
   const k=Math.max(0,1-f.t/.45);m.scale.multiplyScalar(k>0?Math.pow(k,dt*4):0);if(f.t>.45)m.removeFromParent();}}
 function targets(){return [...segments.values()].map(s=>s.group);}
 function stats(){let live=0,growing=0,tris=0,draws=0;const t=now();for(const s of segments.values()){const n=s.crystals.length-s.removed;live+=n;if(t-s.born<GROW_MS*1.6)growing++;for(const mesh of s.group.children)if(mesh.isMesh){tris+=triCount(mesh.geometry)*(mesh.isInstancedMesh?mesh.count:1);if(!mesh.isInstancedMesh||mesh.count)draws++;}}
  return {segments:segments.size,crystals:live,debris:debris.children.length,growing,triangles:tris,draws,sharedGeometries:shapes.length+1,sharedMaterials:Object.keys(mats).length};}
 function dispose(){root.removeFromParent();debris.removeFromParent();segments.clear();for(const g of shapes)g.dispose();plinth.dispose();for(const m of Object.values(mats))m.dispose();}
 return {sync,update,dispose,stats,targets,root};
}
const sub3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const triCount=g=>(g.index?g.index.count:g.attributes.position.count)/3;
function unitCrystal(T,sides,tipFrac,r){ // flat-shaded prism y 0..1, radius ~1, deterministic jitter
 const pos=[],shoulder=1-tipFrac,j=Array.from({length:sides},()=>.85+r()*.3),P=(k,h,s)=>{const a=k/sides*Math.PI*2;return [Math.cos(a)*s*j[k%sides],h,Math.sin(a)*s*j[k%sides]];};
 const tip=[(r()-.5)*.15,1,(r()-.5)*.15];
 for(let k=0;k<sides;k++){const a=P(k,0,.9),b=P(k+1,0,.9),c=P(k+1,shoulder,1),d=P(k,shoulder,1);pos.push(a,d,c,a,c,b,d,tip,c,a,b,[0,-.05,0]);}
 // convex: orient every facet away from the interior point so FrontSide rays hit the visible faces
 const flat=[];for(let t=0;t<pos.length;t+=3){let [a,b,c]=pos.slice(t,t+3);const n=cross3(sub3(b,a),sub3(c,a)),m=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3-.45,(a[2]+b[2]+c[2])/3];if(n[0]*m[0]+n[1]*m[1]+n[2]*m[2]<0)[b,c]=[c,b];flat.push(...a,...b,...c);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(flat,3));g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();return g;
}
