// Manned Timberline aiming aid: the two predicted bolt paths drawn as glowing blue arcs that end in a pair-of-arcs
// mark where the pair will come down, with its distance and flight time. The forecast replays the same shared
// v3 flight the authority steps (shared/timberline-flight.js) against the same ground, so it never aims for you:
// it only shows where the current aim lands. Structures, trees and creatures can still stop the pair earlier.
import * as THREE from 'three';
import {timberlineFlightAt,TIMBERLINE_LONG} from '../shared/timberline-flight.js';
import {mannedShot} from '../shared/inventions.js';

export const TIMBERLINE_SIGHT=Object.freeze({stepTicks:3,maxPoints:TIMBERLINE_LONG.maxTicks/3+2,color:0x5ec2ff,core:.02,perMetre:.0032,dash:2.4,flow:9});

// Forecast one manned shot. height(x,z) is the shared bare-earth height. Returns the sampled eye paths (flat xyz arrays)
// and where the first bolt meets the ground, or impact null when it leaves the world or outlives its flight.
export function forecastTimberline(q,height,{stepTicks=TIMBERLINE_SIGHT.stepTicks,maxTicks=TIMBERLINE_LONG.maxTicks}={}){
 const left=[],right=[];let prev=null,impact=null;
 const below=f=>Math.min(f.left[1]-height(f.left[0],f.left[2]),f.right[1]-height(f.right[0],f.right[2]));
 for(let k=0;k<=maxTicks;k+=stepTicks){const t=k/60,f=timberlineFlightAt(q,t);
  if(Math.abs(f.centre[0])>TIMBERLINE_LONG.reach||Math.abs(f.centre[2])>TIMBERLINE_LONG.reach||f.centre[1]<-60)break;
  if(k>0&&below(f)<.02){let lo=prev.t,hi=t;for(let i=0;i<8;i++){const mid=(lo+hi)/2;if(below(timberlineFlightAt(q,mid))<.02)hi=mid;else lo=mid;}
   const g=timberlineFlightAt(q,hi);left.push(...g.left);right.push(...g.right);impact={t:hi,centre:g.centre,left:g.left,right:g.right};break;}
  left.push(...f.left);right.push(...f.right);prev={t};}
 return {left,right,impact,distance:impact?Math.hypot(impact.centre[0]-q.origin[0],impact.centre[2]-q.origin[2]):null};
}

const VERT=`attribute float along;attribute float edge;varying float vAlong;varying float vEdge;void main(){vAlong=along;vEdge=edge;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const FRAG=`uniform vec3 color;uniform float time;uniform float total;uniform float dash;uniform float opacity;varying float vAlong;varying float vEdge;
void main(){float core=1.-vEdge*vEdge;float lead=smoothstep(.0,3.,vAlong);float tail=1.-smoothstep(total-2.,total,vAlong)*.35;
 float d=fract((vAlong-time)/dash);float beat=.45+.55*smoothstep(.0,.08,d)*(1.-smoothstep(.55,.7,d));
 gl_FragColor=vec4(color*(core*core*1.6+.25)*beat,core*lead*tail*opacity);}`;

function arcMesh(capacity,uniforms){const g=new THREE.BufferGeometry(),n=capacity*2;
 g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3).setUsage(THREE.DynamicDrawUsage));
 g.setAttribute('along',new THREE.BufferAttribute(new Float32Array(n),1).setUsage(THREE.DynamicDrawUsage));
 const edge=new Float32Array(n);for(let i=0;i<capacity;i++){edge[i*2]=-1;edge[i*2+1]=1;}g.setAttribute('edge',new THREE.BufferAttribute(edge,1));
 const idx=[];for(let i=0;i<capacity-1;i++){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}g.setIndex(idx);g.setDrawRange(0,0);
 const m=new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:FRAG,uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false});
 const mesh=new THREE.Mesh(g,m);mesh.frustumCulled=false;mesh.renderOrder=5;return mesh;}

// The landing mark: two facing arcs, one under each bolt, with a fine centre cross. Drawn once to a canvas.
function markTexture(){const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.translate(128,128);
 const arc=(side)=>{x.beginPath();x.arc(side*30,0,70,side>0?Math.PI*.62:-Math.PI*.38,side>0?Math.PI*1.38:Math.PI*.38);x.stroke();};
 for(const [w,a]of [[22,.12],[12,.3],[5,1]]){x.strokeStyle=`rgba(120,205,255,${a})`;x.lineWidth=w;x.lineCap='round';arc(-1);arc(1);}
 x.strokeStyle='rgba(190,235,255,.95)';x.lineWidth=4;x.beginPath();x.moveTo(-16,0);x.lineTo(16,0);x.moveTo(0,-16);x.lineTo(0,16);x.stroke();
 x.fillStyle='rgba(120,205,255,.5)';for(const s of [-1,1]){x.beginPath();x.arc(s*92,0,7,0,Math.PI*2);x.fill();}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}

export function createTimberlineSight({scene}){
 const group=new THREE.Group();group.name='TimberlineSight';group.visible=false;group.userData.ignoreContact=true;scene.add(group);
 const uniforms={color:{value:new THREE.Color(TIMBERLINE_SIGHT.color)},time:{value:0},total:{value:1},dash:{value:TIMBERLINE_SIGHT.dash},opacity:{value:.85}};
 const arcs=[arcMesh(TIMBERLINE_SIGHT.maxPoints,uniforms),arcMesh(TIMBERLINE_SIGHT.maxPoints,uniforms)];arcs.forEach((a,i)=>{a.name=`TimberlineSightArc_${'LR'[i]}`;group.add(a);});
 const markTex=markTexture(),mark=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:markTex,transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
 mark.name='TimberlineSightMark';mark.renderOrder=6;group.add(mark);
 const lc=document.createElement('canvas');lc.width=256;lc.height=64;const lx=lc.getContext('2d'),labelTex=new THREE.CanvasTexture(lc);labelTex.colorSpace=THREE.SRGBColorSpace;
 const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTex,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));label.name='TimberlineSightLabel';label.renderOrder=7;group.add(label);
 let lastText='',last=null,key='';const _a=new THREE.Vector3(),_b=new THREE.Vector3(),_t=new THREE.Vector3(),_s=new THREE.Vector3(),_c=new THREE.Vector3();
 function text(t){if(t===lastText)return;lastText=t;lx.clearRect(0,0,256,64);lx.font='bold 34px sans-serif';lx.textAlign='center';lx.textBaseline='middle';lx.lineWidth=6;lx.strokeStyle='rgba(6,18,34,.85)';lx.strokeText(t,128,32);lx.fillStyle='#bfe6ff';lx.fillText(t,128,32);labelTex.needsUpdate=true;}
 function ribbon(mesh,pts,eye){const pos=mesh.geometry.attributes.position,al=mesh.geometry.attributes.along,n=Math.min(pts.length/3,TIMBERLINE_SIGHT.maxPoints);let along=0;
  for(let i=0;i<n;i++){_a.fromArray(pts,i*3);_b.fromArray(pts,Math.min(n-1,i+1)*3);if(i===n-1)_b.fromArray(pts,i*3).sub(_t.fromArray(pts,Math.max(0,i-1)*3)).add(_a);
   _t.subVectors(_b,_a).normalize();_c.subVectors(_a,eye);const w=TIMBERLINE_SIGHT.core+TIMBERLINE_SIGHT.perMetre*_c.length();_s.crossVectors(_t,_c).normalize().multiplyScalar(w);
   if(i>0)along+=_a.distanceTo(_b.fromArray(pts,(i-1)*3));pos.setXYZ(i*2,_a.x-_s.x,_a.y-_s.y,_a.z-_s.z);pos.setXYZ(i*2+1,_a.x+_s.x,_a.y+_s.y,_a.z+_s.z);al.setX(i*2,along);al.setX(i*2+1,along);}
  pos.needsUpdate=al.needsUpdate=true;mesh.geometry.setDrawRange(0,Math.max(0,n-1)*6);return along;}
 return {object:group,
  // b: the manned structure; aim {yaw,pitch} (the local wanted aim); height(x,z); eye: camera world position.
  update({b,aim,height,eye,camera,time,editsKey=''}){if(!b||!aim){group.visible=false;return null;}
   const k=`${b.id}:${b.position.join(',')}:${aim.yaw.toFixed(4)}:${aim.pitch.toFixed(4)}:${b.yaw}:${editsKey}`;if(k!==key){key=k;last=forecastTimberline(mannedShot(b,aim),height);}
   group.visible=true;const total=Math.max(ribbon(arcs[0],last.left,eye),ribbon(arcs[1],last.right,eye));uniforms.total.value=total;uniforms.time.value=time*TIMBERLINE_SIGHT.flow;
   if(last.impact){const c=_c.fromArray(last.impact.centre),l=_a.fromArray(last.impact.left),r=_b.fromArray(last.impact.right),d=c.distanceTo(eye);
    mark.visible=label.visible=true;const size=Math.max(1.6,d*.07);mark.position.copy(c).y+=size*.3;
    // Stands up facing the operator (a flat ground decal vanishes at grazing angles); the arcs sit left and right like the bolts.
    mark.quaternion.copy(camera.quaternion);mark.scale.setScalar(size);
    label.position.copy(c).y+=size*.95;const lw=d*.085+1;label.scale.set(lw,lw/4,1);text(`${Math.round(last.distance)} m · ${last.impact.t.toFixed(1)} s`);}
   else{mark.visible=false;label.visible=true;label.position.fromArray(last.left.slice(-3));label.scale.set(8,2,1);text('Beyond range');}
   return last;},
  hide(){group.visible=false;},
  get forecast(){return last;},
  dispose(){group.removeFromParent();for(const a of arcs){a.geometry.dispose();a.material.dispose();}mark.geometry.dispose();mark.material.dispose();markTex.dispose();label.material.dispose();labelTex.dispose();}};
}
