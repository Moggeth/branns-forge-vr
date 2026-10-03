import {stripMaterial,wallTime} from './crystal-wall.js';
import {planCrystalWall} from '../shared/weapon-specials.js';
// Hold-to-aim footprint for the Stonewhisper crystal wall: the exact authoritative plan (planCrystalWall) drawn on the
// live terrain as a glowing band with chevrons streaming toward the end ring. Blue = will cast on release; amber and
// dashed = will not (recharging / outside the valley) and `reason` says why. One additive draw, preallocated buffers.
const MAX_ALONG=40,ACROSS=7;
export function createWallPreview({THREE:T,scene,height}){
 const positions=new Float32Array(MAX_ALONG*ACROSS*3),wall=new Float32Array(MAX_ALONG*ACROSS*2),index=[];
 for(let i=0;i<MAX_ALONG-1;i++)for(let j=0;j<ACROSS-1;j++){const k=i*ACROSS+j;index.push(k,k+1,k+ACROSS,k+1,k+ACROSS+1,k+ACROSS);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));g.setAttribute('aWall',new T.BufferAttribute(wall,2).setUsage(T.DynamicDrawUsage));g.setIndex(index);
 const material=stripMaterial(T);material.uniforms.uPreview.value=1;material.uniforms.uTime=wallTime;
 const mesh=new T.Mesh(g,material);mesh.name='CrystalWallPreview';mesh.frustumCulled=false;mesh.renderOrder=4;mesh.visible=false;mesh.raycast=()=>{};mesh.userData.ignoreContact=true;scene.add(mesh);
 let last=null;
 function show({position,yaw,point,ready=true,inside}){
  const plan=planCrystalWall(position,yaw,point),[sx,sz]=plan.start,[fx,fz]=plan.direction,nx=-fz,nz=fx,len=plan.length;
  const nA=Math.min(MAX_ALONG,Math.max(6,Math.ceil((len+1.4)/.3)));
  for(let i=0;i<MAX_ALONG;i++)for(let j=0;j<ACROSS;j++){const k=i*ACROSS+j,ii=Math.min(i,nA-1),a=-.4+(len+1.0)*ii/(nA-1),c=-1.3+2.6*j/(ACROSS-1),x=sx+fx*a+nx*c,z=sz+fz*a+nz*c;
   wall[k*2]=a;wall[k*2+1]=c;positions[k*3]=x;positions[k*3+1]=height(x,z)+.12;positions[k*3+2]=z;}
  g.attributes.position.needsUpdate=g.attributes.aWall.needsUpdate=true;g.setDrawRange(0,(nA-1)*(ACROSS-1)*6);
  // Same world bound the authority enforces (outside_world), so an amber preview always means the cast will fail.
  inside??=[plan.start,plan.end].every(q=>Math.abs(q[0])<=46&&Math.abs(q[1])<=46);
  const bad=!ready||!inside;material.uniforms.uLength.value=len;material.uniforms.uBad.value=bad?1:0;
  mesh.visible=true;last={plan,ready,inside};return last;
 }
 function hide(){mesh.visible=false;last=null;}
 return {show,hide,get state(){return last;},object:mesh,dispose(){mesh.removeFromParent();g.dispose();material.dispose();}};
}
