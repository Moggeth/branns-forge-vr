// Manned Timberline presentation for the operator: the brass sighting scope (hold right mouse) and the ammo counter.
// The scope is the eyepiece of the scope modelled on the cradle: the camera moves to its eye socket and looks down the
// bore, the view narrows, and the lens shows a glowing blue reticle. Its marks are worked out from the shared v3
// flight, so they are honest holdovers, not aim assist:
//  - the twin arcs at the centre sit where the two bolts leave, the cross is the bore;
//  - each drop bar below is where to put a target at that range (level ground), and its width is the bolt pair's
//    spread at that range, so a target that fills a bar is at that distance and will be spanned by the wire;
//  - the readouts give the range under the cross, where this aim lands, and the shots left.
// The winding progress runs round the brass rim. Everything here is presentation; nothing feeds back into the shot.
import * as THREE from 'three';
import './timberline-hud.css';
import {TIMBERLINE_FLIGHT} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-flight.js';

export const TIMBERLINE_SCOPE=Object.freeze({fov:24,radius:.92,marks:[50,100,150,200],rise:9,canvas:1024,spread:TIMBERLINE_FLIGHT.tautHalf,
 // Mouse look slows with the zoom so the reticle stays steerable.
 sensitivity:.36});

// Angle (radians) below the bore at which a level target at distance d is struck.
export function scopeHoldover(d){const t=d/TIMBERLINE_FLIGHT.speed;return Math.atan2(.5*TIMBERLINE_FLIGHT.gravity*t*t,d);}
// Canvas pixels from the reticle centre for an angle off the bore.
export function scopePixels(angle,{fov=TIMBERLINE_SCOPE.fov,radius=TIMBERLINE_SCOPE.radius,size=TIMBERLINE_SCOPE.canvas}={}){return Math.tan(angle)/Math.tan(fov*Math.PI/360)*size/(2*radius);}

const VIGNETTE_FRAG=`uniform float aspect;uniform float radius;uniform float amount;uniform float reload;uniform float ready;varying vec2 vUv;
void main(){vec2 p=(vUv-.5)*vec2(aspect,1.)*2.;float r=length(p),R=radius*mix(.18,1.,amount);
 float lens=1.-smoothstep(R-.012,R,r);float rim=smoothstep(R-.004,R,r)*(1.-smoothstep(R+.05,R+.07,r));
 float ang=fract(atan(p.x,p.y)/6.2831853+1.);float arc=smoothstep(R+.012,R+.02,r)*(1.-smoothstep(R+.032,R+.04,r))*step(ang,reload);
 vec3 brass=vec3(.42,.30,.12)*(.55+.45*cos(ang*6.2831853*1.+1.2))*(.6+.4*smoothstep(R+.07,R,r));
 vec3 glow=mix(vec3(.25,.7,1.),vec3(.55,.9,1.),ready);
 vec3 c=mix(vec3(.004,.006,.01),brass,rim);c=mix(c,glow*1.6,arc*.9);
 float edge=smoothstep(R*.55,R,r)*lens;vec3 tint=vec3(.02,.05,.08)*edge;
 gl_FragColor=vec4(lens>.5?tint:c,(lens>.5?edge*.55:1.)*smoothstep(0.,.25,amount));}`;
const VERT='varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';

export function createTimberlineScope({camera}){
 const S=TIMBERLINE_SCOPE.canvas,group=new THREE.Group();group.name='TimberlineScope';group.visible=false;camera.add(group);
 const uniforms={aspect:{value:1},radius:{value:TIMBERLINE_SCOPE.radius},amount:{value:0},reload:{value:1},ready:{value:1}};
 const vignette=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:VIGNETTE_FRAG,uniforms,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
 vignette.renderOrder=1000;vignette.frustumCulled=false;group.add(vignette);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=S;const x=canvas.getContext('2d'),tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
 const reticle=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,opacity:0}));
 reticle.renderOrder=1001;reticle.frustumCulled=false;group.add(reticle);
 const D=.12;vignette.position.z=reticle.position.z=-D;
 let drawn='';
 function glowLine(w,a,draw){for(const [lw,al]of [[w+8,.12*a],[w+3,.35*a],[w,a]]){x.lineWidth=lw;x.strokeStyle=`rgba(120,206,255,${al})`;draw();}}
 function draw({range,impact,time,ammo,state}){
  const key=`${range}|${impact}|${time}|${ammo}|${state}`;if(key===drawn)return;drawn=key;
  x.clearRect(0,0,S,S);x.save();x.translate(S/2,S/2);x.lineCap='round';x.textBaseline='middle';
  const R=S/2-6,px=a=>scopePixels(a),gap=px(Math.atan2(TIMBERLINE_SCOPE.spread,25));
  // Bore cross: heavy posts from the rim, fine wire to the centre gap.
  glowLine(7,.9,()=>{x.beginPath();for(const [dx,dy]of [[1,0],[-1,0],[0,-1]]){x.moveTo(dx*R*.98,dy*R*.98);x.lineTo(dx*R*.55,dy*R*.55);}x.stroke();});
  glowLine(2,.95,()=>{x.beginPath();for(const [dx,dy]of [[1,0],[-1,0],[0,-1]]){x.moveTo(dx*R*.55,dy*R*.55);x.lineTo(dx*gap*1.6,dy*gap*1.6);}x.stroke();});
  // Twin arcs: the pair at 25 m, facing each other across the bore.
  glowLine(4,1,()=>{for(const s of [-1,1]){x.beginPath();x.arc(s*gap*.35,0,gap*.85,s>0?-.9:Math.PI-.9,s>0?.9:Math.PI+.9);x.stroke();}});
  x.fillStyle='rgba(200,238,255,1)';x.beginPath();x.arc(0,0,3.5,0,Math.PI*2);x.fill();
  // Drop bars: vertical drop wire with one bar per range, each as wide as the bolt pair at that range.
  const marks=TIMBERLINE_SCOPE.marks.map(d=>({d,y:px(scopeHoldover(d)),w:px(Math.atan2(TIMBERLINE_SCOPE.spread,d))})).filter(m=>m.y<R*.9);
  glowLine(2,.8,()=>{x.beginPath();x.moveTo(0,gap*1.6);x.lineTo(0,R*.98);x.stroke();});
  x.font='600 26px sans-serif';x.textAlign='left';
  for(const m of marks){glowLine(4,1,()=>{x.beginPath();x.moveTo(-m.w,m.y);x.lineTo(m.w,m.y);x.moveTo(-m.w,m.y-9);x.lineTo(-m.w,m.y+9);x.moveTo(m.w,m.y-9);x.lineTo(m.w,m.y+9);x.stroke();});
   x.fillStyle='rgba(170,226,255,.95)';x.fillText(String(m.d),Math.max(m.w,14)+16,m.y);}
  // Readouts along the lower lens, dark-backed so they read over snow and sky.
  const rows=[[`RANGE ${range}`,-R*.62,R*.56],[`LANDS ${impact}${time?` · ${time}`:''}`,R*.62,R*.56],[ammo,0,R*.78],[state,0,-R*.78]];
  x.font='700 30px sans-serif';x.textAlign='center';
  for(const [t,cx,cy]of rows){if(!t)continue;const w=x.measureText(t).width+28;x.fillStyle='rgba(4,12,22,.62)';x.beginPath();x.roundRect(cx-w/2,cy-21,w,42,10);x.fill();x.fillStyle=t.startsWith('Out')?'#ffb7ad':'#bfe6ff';x.fillText(t,cx,cy);}
  x.restore();tex.needsUpdate=true;}
 return {object:group,
  // amount 0..1 zoom; info {range,impact,time,ammo,state,reload 0..1,ready}
  update(amount,info={}){group.visible=amount>.001;if(!group.visible)return;
   const h=2*D*Math.tan(camera.fov*Math.PI/360),w=h*camera.aspect;vignette.scale.set(w,h,1);uniforms.aspect.value=camera.aspect;uniforms.amount.value=amount;
   uniforms.reload.value=info.reload??1;uniforms.ready.value=info.ready?1:0;
   // Fixed angular size, so the marks stay true holdovers while the view narrows.
   const size=2*D*Math.tan(TIMBERLINE_SCOPE.fov*Math.PI/360)*TIMBERLINE_SCOPE.radius;reticle.scale.set(size,size,1);reticle.material.opacity=THREE.MathUtils.smoothstep(amount,.7,1);
   if(reticle.material.opacity>0)draw(info);},
  get visible(){return group.visible;},
  dispose(){group.removeFromParent();vignette.geometry.dispose();vignette.material.dispose();reticle.geometry.dispose();reticle.material.dispose();tex.dispose();}};
}

// The operator's ammo counter: crafted bolts first, then whole shots the carried and stored Wood and Iron pay for.
export function timberlineAmmoText({bolts=0,raw=0}={}){
 if(!bolts&&!raw)return 'Out of ammo';
 const b=`${bolts} bolt${bolts===1?'':'s'}`;if(!raw)return b;const r=`${raw} from Wood/Iron`;return bolts?`${b} + ${r}`:`${raw} shot${raw===1?'':'s'} from Wood/Iron`;}

export function createTimberlineAmmoHud({parent=document.body}={}){
 const el=document.createElement('div');el.className='timberline-ammo';el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.hidden=true;
 el.innerHTML='<span class="timberline-ammo-glyph" aria-hidden="true"></span><span class="timberline-ammo-count"></span><span class="timberline-ammo-state"></span>';parent.appendChild(el);
 const count=el.querySelector('.timberline-ammo-count'),state=el.querySelector('.timberline-ammo-state');let last='';
 return {element:el,
  set(info){if(!info){if(!el.hidden)el.hidden=true;last='';return;}const t=timberlineAmmoText(info),s=info.state||'';const key=`${t}|${s}|${!!info.scoped}`;if(key===last)return;last=key;el.hidden=false;
   count.textContent=t;state.textContent=s;el.classList.toggle('is-empty',!info.bolts&&!info.raw);el.classList.toggle('is-scoped',!!info.scoped);},
  dispose(){el.remove();}};
}
