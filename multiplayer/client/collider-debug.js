// ?colliders: draws the authority's Timberline hit volumes (shared/colliders.js) as wireframes over the world, so a
// mismatch with a model is visible at a glance. Rebuilt about twice a second; off unless the URL asks for it.
import * as THREE from 'three';
import {worldColliders} from '../shared/colliders.js';
import {trunkRadius} from '../shared/trees.js';

const COLORS={block:0xff5a3c,tree:0x63e86b,enemy:0xffd23c};
export function createColliderDebug({scene,terrainHeight,legacy=false,structureRadius=()=>1.5}){
 const geometry=new THREE.BufferGeometry(),material=new THREE.LineBasicMaterial({vertexColors:true,depthTest:false,transparent:true,opacity:.9,toneMapped:false});
 const lines=new THREE.LineSegments(geometry,material);lines.name='ColliderDebug';lines.renderOrder=999;lines.frustumCulled=false;lines.userData.ignoreContact=true;scene.add(lines);
 let next=0;const color=new THREE.Color();
 function build(s){const pos=[],col=[];
  const seg=(a,b)=>{pos.push(...a,...b);col.push(color.r,color.g,color.b,color.r,color.g,color.b);};
  const circle=(c,y,r,n=20,cx=0,cz=0)=>{for(let i=0;i<n;i++){const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2;seg([c[0]+cx+Math.cos(a)*r,c[1]+y,c[2]+cz+Math.sin(a)*r],[c[0]+cx+Math.cos(b)*r,c[1]+y,c[2]+cz+Math.sin(b)*r]);}};
  for(const v of worldColliders(s,{terrainHeight,near:()=>true})){color.setHex(COLORS[v.kind]||0xffffff);const c=v.at;
   if(v.shape==='box'){const hw=v.w/2,hd=v.d/2,pt=(u,w,y)=>[c[0]+v.cx+u*v.c+w*v.s,c[1]+y,c[2]+v.cz-u*v.s+w*v.c],corners=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
    for(let i=0;i<4;i++){const [u,w]=corners[i],[u2,w2]=corners[(i+1)%4];seg(pt(u,w,v.y0),pt(u2,w2,v.y0));seg(pt(u,w,v.y1),pt(u2,w2,v.y1));seg(pt(u,w,v.y0),pt(u,w,v.y1));}continue;}
   if(v.shape==='trunk'){const n=6;for(let k=0;k<=n;k++){const y=v.height*k/n;circle(c,y,trunkRadius(v.tree,y),12);}for(let i=0;i<4;i++){const a=i*Math.PI/2;seg([c[0]+Math.cos(a)*trunkRadius(v.tree,0),c[1],c[2]+Math.sin(a)*trunkRadius(v.tree,0)],[c[0]+Math.cos(a)*trunkRadius(v.tree,v.height),c[1]+v.height,c[2]+Math.sin(a)*trunkRadius(v.tree,v.height)]);}continue;}
   if(v.shape==='ring'){for(const r of [v.radius-v.band,v.radius+v.band]){circle(c,0,r,28);circle(c,v.height,r,28);}continue;}
   circle(c,0,v.base);circle(c,v.height*.5,(v.base+v.top)/2);circle(c,v.height,v.top);for(let i=0;i<6;i++){const a=i/6*Math.PI*2;seg([c[0]+Math.cos(a)*v.base,c[1],c[2]+Math.sin(a)*v.base],[c[0]+Math.cos(a)*v.top,c[1]+v.height,c[2]+Math.sin(a)*v.top]);}}
  // ?colliders=legacy also draws the volumes the Timberline used before 2026-10-04 in grey, for comparison.
  if(legacy){color.setHex(0x9aa3ad);for(const d of s.deposits||[])if(!d.depleted&&!d.special){const c=[d.x,terrainHeight(s,d.x,d.z,false),d.z];circle(c,0,1.3);circle(c,2.5,1.3);for(let i=0;i<6;i++){const a=i/6*Math.PI*2;seg([c[0]+Math.cos(a)*1.3,c[1],c[2]+Math.sin(a)*1.3],[c[0]+Math.cos(a)*1.3,c[1]+2.5,c[2]+Math.sin(a)*1.3]);}}
   for(const b of s.inventions?.structures||[])if(b.hp>0&&b.type!=='foundation'){const r=structureRadius(b.type);circle(b.position,0,r,28);circle(b.position,4,r,28);}}
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(col,3));}
 return {update(s,now){if(!s||now<next)return;next=now+500;build(s);},dispose(){lines.removeFromParent();geometry.dispose();material.dispose();}};
}
