// Progressive boulder/meteor fracture (Opus 2026-10-03). Replaces world-content-view's whole-mesh
// `root.scale.setScalar(1-hits/maxHits*.15)` with real damaged geometry built from the authored GLB mesh itself.
//  * The authored triangles (all primitives, original textures/vertex colours/tangents/material groups) are partitioned into
//    CHUNKS Voronoi cells around deterministic seeds (per asset + variant from the deposit id).
//  * Damage removes cells in a deterministic order (top/exposed first). A removed cell's shell is detached from the tagged
//    hierarchy (so rays never hit vanished rock) and flies off as a chip; in its place a recessed crater surface (the same
//    triangles pulled toward the centre) plus fracture walls appear using the asset's own GeoInterior material, so the hole
//    is closed, textured and ray-hittable. Walls between two cells exist in both orientations and are shown iff exactly one
//    cell is gone, so adjacent craters merge cleanly.
//  * Partitions are cached per (template geometry, variant) and shared by every instance; materials are the template's own
//    shared materials and are never mutated. dispose() only frees what this module allocated.
export const CHUNKS=14,RECESS=.76,VARIANTS=4;
const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const rng=seed=>()=>{seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const cache=new Map(); // key -> {cells:[{shells:[{geometry,material}], crater, centroid, order}], walls:Map}

// root: the Group returned by authored('boulder'|'meteor') (already tagged with userData.targetId).
export function attachFracture(T,root,id,{chunks=CHUNKS}={}){
 const meshes=[];root.traverse(n=>{if(n.isMesh&&!n.userData.fractureOwned)meshes.push(n);});
 if(!meshes.length)return null;
 const host=meshes[0].parent; // all primitives of the authored node share this space (glTF multi-primitive -> sibling meshes)
 const variant=hash(id)%VARIANTS,key=meshes.map(m=>m.geometry.uuid).join('|')+'#'+variant+'#'+chunks;
 let part=cache.get(key);if(!part){part=partition(T,meshes,variant,chunks);cache.set(key,part);}part.users=(part.users||0)+1;
 const interior=meshes.map(m=>m.material).find(m=>/interior/i.test(m?.name||''))||meshes[0].material;
 // Hide the authored meshes; the cell shells reproduce them exactly (same triangles, same attributes, same materials).
 for(const m of meshes)m.visible=false,m.userData.fractureHidden=true,m.raycast=()=>{};
 const tag=o=>{o.userData.targetId=root.userData.targetId;o.userData.fractureOwned=true;return o;};
 const cells=part.cells.map(c=>{const shells=c.shells.map(s=>tag(new T.Mesh(s.geometry,meshes[s.mesh].material)));for(const s of shells)host.add(s);
  const crater=tag(new T.Mesh(c.crater,interior));crater.visible=false;return {shells,crater,attachedCrater:false};});
 const walls=[];for(const w of part.walls){const m=tag(new T.Mesh(w.geometry,interior));walls.push({...w,mesh:m,on:false});}
 const removed=new Set(),chips=[];let level=0;
 function setDamage(hits,maxHits){const max=Math.max(1,maxHits||1);const want=Math.min(chunks-3,Math.floor((chunks-3)*Math.min(1,(hits||0)/max)+1e-9));
  while(level<want){const k=part.order[level++];removed.add(k);const cell=cells[k];
   for(const s of cell.shells){s.updateWorldMatrix(true,false);const chip=s;root.parent?.attach(chip);delete chip.userData.targetId;chip.raycast=()=>{};
    const r=rng(hash(id+':'+k));const out=part.cells[k].centroid.clone().normalize();chip.userData.fly={t:0,v:out.multiplyScalar(1.5+r()).applyQuaternion(host.getWorldQuaternion(new T.Quaternion())).add(new T.Vector3(0,2.2,0)),spin:new T.Vector3(r()*5,r()*5,r()*5),s0:chip.scale.x};chips.push(chip);}
   cell.shells.length=0;host.add(cell.crater);cell.crater.visible=true;}
  for(const w of walls){const on=removed.has(w.a)!==removed.has(w.b)&&removed.has(w.facing);if(on&&!w.on)host.add(w.mesh);else if(!on&&w.on)w.mesh.removeFromParent();w.on=on;}
  return level;}
 function update(dt){for(let i=chips.length-1;i>=0;i--){const c=chips[i],f=c.userData.fly;f.t+=dt;f.v.y-=9.8*dt;c.position.addScaledVector(f.v,dt*.35);c.rotation.x+=f.spin.x*dt;c.rotation.z+=f.spin.z*dt;
  const k=Math.max(0,1-f.t/.6);c.scale.setScalar(f.s0*k);if(f.t>.6){c.removeFromParent();chips.splice(i,1);}}}
 function dispose(){for(const c of chips)c.removeFromParent();chips.length=0;if(--part.users<=0){for(const c of part.cells){for(const s of c.shells)s.geometry.dispose();c.crater.dispose();}for(const w of part.walls)w.geometry.dispose();cache.delete(key);}}
 function stats(){return {variant,chunks,removed:removed.size,chips:chips.length,walls:walls.filter(w=>w.on).length,cachedPartitions:cache.size};}
 return {setDamage,update,dispose,stats,removedCells:()=>[...removed]};
}

function partition(T,meshes,variant,chunks){
 const box=new T.Box3();for(const m of meshes){m.geometry.computeBoundingBox();box.union(m.geometry.boundingBox);}
 const centre=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());
 // deterministic seeds on an inflated shell so cells are surface patches ("chips") rather than slivers
 const r=rng(1013+variant*7919),seeds=[];
 for(let k=0;k<chunks;k++){const y=1-2*(k+.5)/chunks,rad=Math.sqrt(1-y*y),a=k*2.39996+r()*.6;seeds.push(new T.Vector3(Math.cos(a)*rad*size.x*.5,y*size.y*.5,Math.sin(a)*rad*size.z*.5).add(centre));}
 const cellOf=p=>{let best=0,bd=Infinity;for(let k=0;k<seeds.length;k++){const d=p.distanceToSquared(seeds[k]);if(d<bd){bd=d;best=k;}}return best;};
 const cellTris=Array.from({length:chunks},()=>meshes.map(()=>[])),edges=new Map(),qkey=v=>`${Math.round(v.x*2e4)},${Math.round(v.y*2e4)},${Math.round(v.z*2e4)}`;
 const triRec=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),cen=new T.Vector3();
 meshes.forEach((m,mi)=>{const g=m.geometry,pos=g.attributes.position,idx=g.index,n=idx?idx.count:pos.count;
  for(let t=0;t<n;t+=3){const i0=idx?idx.getX(t):t,i1=idx?idx.getX(t+1):t+1,i2=idx?idx.getX(t+2):t+2;a.fromBufferAttribute(pos,i0);b.fromBufferAttribute(pos,i1);c.fromBufferAttribute(pos,i2);
   const k=cellOf(cen.copy(a).add(b).add(c).divideScalar(3));cellTris[k][mi].push(i0,i1,i2);
   const keys=[qkey(a),qkey(b),qkey(c)];for(const [u,v,iu,iv] of [[0,1,i0,i1],[1,2,i1,i2],[2,0,i2,i0]]){const ek=keys[u]<keys[v]?keys[u]+'|'+keys[v]:keys[v]+'|'+keys[u];let e=edges.get(ek);if(!e)edges.set(ek,e=[]);e.push({cell:k,mesh:mi,iu,iv});}}});
 const cells=[];
 for(let k=0;k<chunks;k++){const shells=[],craterParts=[];const centroid=new T.Vector3();let count=0;
  meshes.forEach((m,mi)=>{const list=cellTris[k][mi];if(!list.length)return;const sub=extract(T,m.geometry,list);shells.push({mesh:mi,geometry:sub});
   const p=sub.attributes.position;for(let i=0;i<p.count;i++){centroid.x+=p.getX(i);centroid.y+=p.getY(i);centroid.z+=p.getZ(i);count++;}
   craterParts.push(recess(T,sub,centre));});
  centroid.divideScalar(Math.max(1,count));
  cells.push({shells,crater:merge(T,craterParts),centroid:centroid.clone().sub(centre)});}
 // fracture walls along every edge shared by two different cells, one quad per orientation
 const pairs=new Map();
 for(const list of edges.values()){if(list.length<2)continue;const e0=list[0],e1=list.find(e=>e.cell!==e0.cell);if(!e1)continue;
  const g=meshes[e0.mesh].geometry.attributes.position,A=new T.Vector3().fromBufferAttribute(g,e0.iu),B=new T.Vector3().fromBufferAttribute(g,e0.iv);
  const Ai=A.clone().sub(centre).multiplyScalar(RECESS).add(centre),Bi=B.clone().sub(centre).multiplyScalar(RECESS).add(centre);
  for(const [facing,other] of [[e0.cell,e1.cell],[e1.cell,e0.cell]]){const pk=Math.min(e0.cell,e1.cell)+':'+Math.max(e0.cell,e1.cell)+':'+facing;let w=pairs.get(pk);if(!w)pairs.set(pk,w={a:e0.cell,b:e1.cell,facing,pos:[]});
   // orient the quad toward the removed (facing) cell's centroid so FrontSide shows it from inside the hole
   const toward=cells[facing].centroid.clone().add(centre).sub(A);let q=[A,B,Bi,A,Bi,Ai];const nrm=new T.Vector3().subVectors(B,A).cross(new T.Vector3().subVectors(Bi,A));if(nrm.dot(toward)<0)q=[A,Bi,B,A,Ai,Bi];
   for(const v of q)w.pos.push(v.x,v.y,v.z);}}
 const walls=[...pairs.values()].map(w=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(w.pos,3));const n=w.pos.length/3;
  g.setAttribute('uv',new T.Float32BufferAttribute(Array.from({length:n*2},(_,i)=>(w.pos[Math.floor(i/2)*3+(i%2?1:0)])*1.7),2));g.setAttribute('color',new T.Float32BufferAttribute(new Array(n*3).fill(.82),3));g.computeVertexNormals();g.computeBoundingSphere();return {a:w.a,b:w.b,facing:w.facing,geometry:g};});
 // removal order: exposed upper cells first, deterministic jitter per variant
 const order=cells.map((c,k)=>({k,s:c.centroid.y/Math.max(.01,size.y)+r()*.35})).sort((p,q)=>q.s-p.s).map(o=>o.k);
 return {cells,walls,order,centre};
}
function extract(T,src,list){ // non-indexed copy of the listed triangles carrying every source attribute
 const g=new T.BufferGeometry();for(const [name,attr] of Object.entries(src.attributes)){const out=new Float32Array(list.length*attr.itemSize);const get=[attr.getX,attr.getY,attr.getZ,attr.getW];for(let i=0;i<list.length;i++)for(let c=0;c<attr.itemSize;c++)out[i*attr.itemSize+c]=get[c].call(attr,list[i]);g.setAttribute(name,new T.BufferAttribute(out,attr.itemSize,false));} // getX.. denormalise packed COLOR_0
 g.computeBoundingSphere();return g;}
function recess(T,sub,centre){const g=sub.clone();const p=g.attributes.position;for(let i=0;i<p.count;i++)p.setXYZ(i,centre.x+(p.getX(i)-centre.x)*RECESS,centre.y+(p.getY(i)-centre.y)*RECESS,centre.z+(p.getZ(i)-centre.z)*RECESS);g.deleteAttribute('tangent');g.computeVertexNormals();return g;}
function merge(T,parts){const g=new T.BufferGeometry();if(!parts.length)return g;const names=['position','normal','uv','color'];
 for(const n of names){const has=parts.every(p=>p.attributes[n]);const size=n==='uv'?2:n==='color'?(parts[0].attributes.color?.itemSize||3):3;
  if(!has){if(n==='color'){const total=parts.reduce((s,p)=>s+p.attributes.position.count,0);g.setAttribute('color',new T.Float32BufferAttribute(new Array(total*size).fill(1),size));}continue;}
  const arr=[];for(const p of parts){const a=p.attributes[n];for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)arr.push(a.getComponent(i,c));}g.setAttribute(n,new T.Float32BufferAttribute(arr,parts[0].attributes[n].itemSize));}
 g.computeBoundingSphere();return g;}
