// Blue resonance tracers behind each Timberline bolt in flight, so long "artillery" shots stay readable
// against sky and mountains. One additive instanced mesh for every flying bolt (one draw call), reusing the
// crossed-ribbon streak geometry of the bows and the Siegebird with a longer, colder comet.
import * as THREE from 'three';
import {buildStreakGeometry} from './projectile-streaks.js';

export const TIMBERLINE_TRACER=Object.freeze({color:0x4fb4ff,length:3.2,width:.06,nock:.905,fadeTicks:8,capacity:48});

export function createTimberlineTracers({scene}){
 const geometry=buildStreakGeometry(),material=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,fog:false});
 const mesh=new THREE.InstancedMesh(geometry,material,TIMBERLINE_TRACER.capacity);mesh.name='TimberlineTracers';mesh.count=0;mesh.frustumCulled=false;mesh.userData.ignoreContact=true;
 mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.setColorAt(0,new THREE.Color());mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);
 const base=new THREE.Color(TIMBERLINE_TRACER.color).multiplyScalar(1.5),tint=new THREE.Color(),m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3(),z=new THREE.Vector3(0,0,1);
 let n=0;
 return {object:mesh,
  begin(){n=0;},
  // eye: the bolt's filament eye; dir: unit flight direction; age: ticks since release (fades the comet in clear of the rails).
  add(eye,dir,age){if(n>=TIMBERLINE_TRACER.capacity)return;const fade=Math.min(1,Math.max(0,age)/TIMBERLINE_TRACER.fadeTicks);if(fade<=0)return;
   p.copy(eye).addScaledVector(dir,-TIMBERLINE_TRACER.nock);q.setFromUnitVectors(z,dir);s.set(TIMBERLINE_TRACER.width,TIMBERLINE_TRACER.width,TIMBERLINE_TRACER.length*fade);
   m.compose(p,q,s);mesh.setMatrixAt(n,m);mesh.setColorAt(n,tint.copy(base).multiplyScalar(.5+.5*fade));n++;},
  end(){mesh.count=n;mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;},
  get count(){return n;},
  dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();mesh.dispose();}};
}
