// Hit volumes for the world as a volume-tested shot sees it (the Timberline pair), measured against the drawn models.
// Arrows, Siegebird bolts and melee already raycast the rendered triangles on the host; the Timberline authority steps a
// pure flight with no scene, so it needs shapes that hug the models instead of generous placement circles.
// Measured 2026-10-04 by building the client art in node (forest-resource-art.js, invention-art.js, the GLBs):
//  - ore kits sit 1.15-1.2 m tall and taper from ~.85-1.2 m half-width at the base to ~.5-.7 near the top;
//  - every structure used one 4 m cylinder at its placement radius (a trap is .25 m tall, a Timberline 1.5 m).
// Shapes: frustum {base, top, height} on the ground point, trunk {tree} (exact authored rings), box {x,z,w,d,h,rotY}
// relative to the ground, ring {radius, band, height} (palisade stakes).
import {worldTrees} from './world-content.js';
import {trunkRadius,treeProfile,treeScale,cutLocalHeight} from './trees.js';
import {FORGE_BOXES} from './forge-collision.js';
import {STARTING_SITES} from './starting-world.js';
import {entSpec,entHeight} from './ents.js';

// Ore: the tallest kit, a little inside its widest bands so the bolt reads as entering the rock it hits.
export const DEPOSIT_SHAPES=Object.freeze({
 ore:Object.freeze({base:.95,top:.5,height:1.15}),
 stone:Object.freeze({base:.95,top:.55,height:1.2}),   // boulder.glb at 1.2 m
 meteor:Object.freeze({base:1.05,top:.7,height:1.5}),   // meteor.glb at 1.5 m
});
export const depositShape=d=>DEPOSIT_SHAPES[d.kind]||DEPOSIT_SHAPES.ore;
/** Walkers (heroes, skeletons, golems, ents, workers) stop at ore rocks, boulders, crystals and meteors instead of
 * walking through them: push a ground point out of every standing deposit's footprint (its base, a touch inside the
 * drawn silhouette so you can still walk right up to it and swing). Something above a rock's top passes over it. */
export function resolveDeposits(state,position,radius=.3,height=null){
 for(const d of state.deposits||[]){
  if(d.depleted||d.special)continue; // spell-raised seams ride their own terrain edit (a crystal wall is already solid ground)
  const shape=depositShape(d),min=shape.base*.92+radius,dx=position[0]-d.x,dz=position[2]-d.z;
  if(Math.abs(dx)>=min||Math.abs(dz)>=min)continue;
  const dist=Math.hypot(dx,dz);if(dist>=min)continue;
  if(height&&position[1]>height(d.x,d.z)+shape.height-.15)continue;
  if(dist>1e-4){position[0]=d.x+dx/dist*min;position[2]=d.z+dz/dist*min;}else position[0]=d.x+min;
 }
 return position;
}
// Structures: drawn half-width and height (invention-art.js / timberline_ballista.glb). The forge uses its authored boxes.
export const STRUCTURE_SHAPES=Object.freeze({
 timberline:{radius:1,height:1.5}, trap:{radius:.9,height:.25}, prospector:{radius:1.25,height:1.4},
 loggingYard:{radius:1.8,height:1.85}, launcher:{radius:1.2,height:1.8}, barracks:{radius:1.6,height:2.9},
 storehouse:{radius:1.75,height:3.2}, sanctuary:{radius:2,height:2.8}, ward:{radius:1.15,height:3.4},
 influence:{radius:1.2,height:4.1}, watchtower:{radius:1.4,height:4}, palisade:{ring:2,band:.16,height:1.9},
});
export const ENEMY_SHAPES=Object.freeze({skeleton:{radius:.35,height:1.75},golem:{radius:1.1,height:2.8}});
export function enemyShape(e){if(e.kind==='ent'){const spec=entSpec(e);return {radius:spec.radius,height:entHeight(e)};}return ENEMY_SHAPES[e.kind]||ENEMY_SHAPES.skeleton;}

const landmarkBoxes=STARTING_SITES.flatMap(site=>site.footprints.map((b,i)=>({...b,id:`${site.id||'site'}-${i}`,c:Math.cos(b.rotY||0),s:Math.sin(b.rotY||0)})));

// Is world point p inside a collider? ground(x,z) is the bare-earth height the volume stands on.
export function insideCollider(v,p){
 const dx=p[0]-v.at[0],dz=p[2]-v.at[2],y=p[1]-v.at[1];
 if(v.shape==='box'){const u=dx*v.c-dz*v.s,w=dx*v.s+dz*v.c;return Math.abs(u)<=v.w/2&&Math.abs(w)<=v.d/2&&y>=v.y0-.05&&y<=v.y1;}
 if(y<-.05||y>v.height)return false;const r=Math.hypot(dx,dz);
 if(v.shape==='trunk')return r<=trunkRadius(v.tree,Math.max(0,y));
 if(v.shape==='ring')return Math.abs(r-v.radius)<=v.band;
 return r<=v.base+(v.top-v.base)*Math.max(0,y)/v.height;
}

// Every volume near (x,z) within reach. kind: 'block' (bolts stick), 'tree' (the wire shears it), 'enemy'.
export function worldColliders(s,{terrainHeight,near,exclude=null}){
 const out=[],g=(x,z)=>terrainHeight(s,x,z,false);
 for(const b of s.inventions?.structures||[]){if(b.id===exclude||!(b.hp>0)||b.type==='foundation'||(b.type==='palisade'&&b.open))continue;
  if(b.type==='forge'){if(!near(b.position[0],b.position[2],3.5))continue;for(const box of FORGE_BOXES)out.push({kind:'block',obj:b,shape:'box',at:b.position,x:0,z:0,c:1,s:0,
   w:box.max[0]-box.min[0],d:box.max[2]-box.min[2],y0:box.min[1],y1:box.max[1],cx:(box.min[0]+box.max[0])/2,cz:(box.min[2]+box.max[2])/2});continue;}
  const sh=STRUCTURE_SHAPES[b.type]||{radius:1.2,height:2.5},r=sh.ring||sh.radius;if(!near(b.position[0],b.position[2],r))continue;
  out.push(sh.ring?{kind:'block',obj:b,shape:'ring',at:b.position,radius:sh.ring,band:sh.band,height:sh.height,reach:sh.ring+sh.band}:{kind:'block',obj:b,shape:'frustum',at:b.position,base:sh.radius,top:sh.radius,height:sh.height,reach:sh.radius});}
 for(const base of s.battle?.bases||[]){if(!(base.hp>0)||!near(base.position[0],base.position[2],2))continue;
  out.push({kind:'battle-base',obj:base,shape:'frustum',at:base.position,base:2,top:2,height:2.8,reach:2});}
 for(const d of s.deposits||[]){if(d.depleted||d.special)continue;const sh=depositShape(d);if(!near(d.x,d.z,sh.base))continue;out.push({kind:'block',obj:d,shape:'frustum',at:[d.x,g(d.x,d.z),d.z],...sh,reach:sh.base});}
 for(const t of worldTrees(s)){const reach=.5*treeScale(t);if(!near(t.x,t.z,reach))continue;const cut=s.harvestedTrees?.find(h=>h.id===t.id),floor=g(t.x,t.z);
  // Standing (even notched) trunks are sheared by the wire; a felled tree leaves a stump the bolts bury themselves in.
  if(cut?.cuts>=3)out.push({kind:'block',obj:{id:`stump-${t.id}`,permanent:true,material:'wood'},shape:'trunk',tree:t,at:[t.x,floor,t.z],height:cutLocalHeight(t,cut,floor),reach});
  else out.push({kind:'tree',obj:t,shape:'trunk',tree:t,at:[t.x,floor,t.z],height:treeProfile(t).firstLimb*treeScale(t)+.6,reach});}
 for(const e of s.enemies||[]){const sh=enemyShape(e);if(!near(e.position[0],e.position[2],sh.radius))continue;out.push({kind:'enemy',obj:e,shape:'frustum',at:e.position,base:sh.radius,top:sh.radius,height:sh.height,reach:sh.radius});}
 if(s.landmarks)for(const b of landmarkBoxes){const r=Math.hypot(b.w,b.d)/2;if(!near(b.x,b.z,r))continue;out.push({kind:'block',obj:{id:`landmark-${b.id}`,permanent:true,material:'stone'},shape:'box',at:[b.x,g(b.x,b.z),b.z],c:b.c,s:b.s,w:b.w,d:b.d,y0:0,y1:b.h,cx:0,cz:0,reach:r});}
 return out;
}
// Forge boxes are offset from the structure origin; fold the offset into the point test.
export function insideVolume(v,p){return v.shape==='box'&&(v.cx||v.cz)?insideCollider(v,[p[0]-v.cx,p[1],p[2]-v.cz]):insideCollider(v,p);}
