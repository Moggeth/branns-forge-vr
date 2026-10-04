import {applyCrystalMaterial} from './material-refinements.js';
import {PICK_WALL,SUNDER_SETTLE_DISTANCE,terrainFrameKey,wallSpec} from '../shared/terrain.js';
// Stonewhisper crystal wall presentation, v2 "geode" (2026-10-03).
// Authority (shared/weapon-specials.js) raises a chain of capsule segments behind a 10 m/s front, keeps them for
// its lifetimeTicks, then sinks them. Everything here is a pure function of the snapshot tick, so every peer and
// every late joiner sees the same moment of the same animation:
//   seam   a blue fissure races ahead of the front along the ground,
//   crust  earthy geode plates ride the rising soil, then split open along the crest, showing their glittering lining,
//   bloom  faceted crystals thrust up through the split (ease-out-back) with a light flash, sparks and dust,
//   live   a slow resonance shimmer travels the wall; crystals light the ground around their feet (additive pool),
//   warn   in the last 3 s the crystals flicker and shed glints,
//   break  at expiry (or when a segment is mined out) crystals burst into shards and the plates crumble as the earth sinks.
// Crystals line the two flanks of the crest and leave a druzy channel along its spine, so the walkable ramp/crest reads
// as walkable. Draw cost per wall: 3 crystal batches + 1 crust batch + 1 glow strip; shared shard/spark/dust pools add 3.
// No lights, no transparency sorting on solids, no per-frame allocation in update().
// The God's Raise Wall (edit kind 'wall') is the same geode, grown to rampart size; the God's Sunder (kind 'sunder')
// turns it inside out: the crust peels back off the chasm lips and crystal lines the chasm walls and floor.
export const CRYSTALS_PER_SEGMENT=10,PLATES_PER_SEGMENT=6,GROW_TICKS=30,CRACK_TICKS=12;
/** Per-kind layout. flank: crystal pairs along each side; floor: small crystals on the spine/floor; plates: crust slabs;
 * reach: lateral scale against the crystal wall; strip: half-width of the ground glow. */
export const WALL_VIEWS=Object.freeze({
 pick_wall:{flank:4,floor:2,plates:6,reach:1,strip:1.8,seam:0,layout:'ridge'},
 wall:{flank:7,floor:3,plates:6,reach:wallSpec('wall').width/PICK_WALL.width,strip:2.9,seam:0,layout:'ridge'},
 sunder:{flank:8,floor:5,plates:6,reach:1,strip:3.2,seam:1,layout:'chasm'},
});
const viewOf=kind=>WALL_VIEWS[kind];
const SHARD_POOL=192,SPARK_POOL=320,DUST_POOL=96;
const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const rng=seed=>()=>{seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>t*t*(3-2*t);
const sinkOf=(seg,tick)=>tick<=seg.expireTick?0:smooth(clamp((tick-seg.expireTick)/seg.spec.sinkTicks,0,1));
const backOut=u=>{const c=1.7;return u>=1?1:1+(c+1)*Math.pow(u-1,3)+c*Math.pow(u-1,2);};

// One shared resonance clock (seconds) for every crystal/plate/strip shader.
export const wallTime={value:0};
const GLOW_GLSL=/* glsl */`
#if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
  {
    // instanceColor.r carries the per-crystal light level (birth flash, warning flicker, mining); diffuse was
    // already replaced by the crystal refinement, so the colour channel is free for it.
    float wGlow = vColor.r;
    float wWave = 0.82 + 0.18 * sin(uWallTime * 2.1 - (vWallWorld.x + vWallWorld.z) * 0.9);
    vec3 wV = normalize(vViewPosition);
    float wRim = pow(1.0 - clamp(abs(dot(normal, wV)), 0.0, 1.0), 3.0);
    totalEmissiveRadiance = totalEmissiveRadiance * wGlow * wWave + vec3(0.16, 0.48, 1.0) * wRim * 0.55 * wGlow * wWave;
  }
#endif
`;
function addResonance(material){
 const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=(shader,renderer)=>{previous?.call(material,shader,renderer);shader.uniforms.uWallTime=wallTime;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWallWorld;')
   .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\n#ifdef USE_INSTANCING\n vWallWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;\n#else\n vWallWorld=(modelMatrix*vec4(transformed,1.)).xyz;\n#endif');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uWallTime;\nvarying vec3 vWallWorld;')
   .replace('#include <lights_physical_fragment>',GLOW_GLSL+'\n#include <lights_physical_fragment>');};
 material.customProgramCacheKey=()=>previousKey()+'|wall-resonance-v1';material.needsUpdate=true;return material;
}
// Crust shell: earthy outer skin; its concave inner face (back faces) is a glittering druzy lining that the split reveals.
function crustMaterial(T){
 const m=new T.MeshStandardMaterial({color:0x6a4a33,roughness:.9,metalness:0,flatShading:true});
 m.onBeforeCompile=shader=>{shader.uniforms.uWallTime=wallTime;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPlateLocal;varying float vPlateIn;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvPlateLocal=position;vPlateIn=smoothstep(-.3,-.7,objectNormal.z);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uWallTime;varying vec3 vPlateLocal;varying float vPlateIn;
float plH(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float plN(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(plH(i),plH(i+vec3(1,0,0)),f.x),mix(plH(i+vec3(0,1,0)),plH(i+vec3(1,1,0)),f.x),f.y),mix(mix(plH(i+vec3(0,0,1)),plH(i+vec3(1,0,1)),f.x),mix(plH(i+vec3(0,1,1)),plH(i+vec3(1,1,1)),f.x),f.y),f.z);}`)
   .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   {float n=plN(vPlateLocal*5.),fine=plN(vPlateLocal*23.+7.),strata=.5+.5*sin(vPlateLocal.y*18.+n*4.);
    vec3 earth=mix(vec3(.12,.07,.035),vec3(.25,.165,.09),strata*.55+n*.45);earth=mix(earth,vec3(.2,.19,.17),smoothstep(.62,.75,fine)*.6);
    float inner=vPlateIn;
    float spark=smoothstep(.78,.86,fine)*(.55+.45*sin(uWallTime*2.6+n*30.));
    vec3 lining=mix(vec3(.03,.08,.24),vec3(.18,.5,1.),n*.8);
    diffuseColor.rgb=mix(earth,lining,inner);roughnessFactor=mix(.95,.22,inner);
    totalEmissiveRadiance=vec3(.1,.42,1.)*inner*(.2+.3*n+1.1*spark);}`);};
 m.customProgramCacheKey=()=>'crystal-wall-crust-v3';return m;
}
// Ground light pool + leading fissure. One strip per wall, conformed to the live terrain.
export function stripMaterial(T){
 return new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false,fog:false,
  uniforms:{uTime:wallTime,uFront:{value:0},uLength:{value:1},uBloom:{value:0},uLive:{value:1},uWarn:{value:0},uPreview:{value:0},uBad:{value:0},uScale:{value:1},uSeam:{value:0}},
  vertexShader:/* glsl */`attribute vec2 aWall;varying vec2 vWall;void main(){vWall=aWall;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:/* glsl */`uniform float uTime,uFront,uLength,uBloom,uLive,uWarn,uPreview,uBad,uScale,uSeam;varying vec2 vWall;
   float h1(float x){return fract(sin(x*127.1)*43758.5453);}
   float n1(float x){float i=floor(x),f=fract(x);return mix(h1(i),h1(i+1.),f*f*(3.-2.*f));}
   void main(){
    float along=vWall.x,across=abs(vWall.y)/uScale,vy=vWall.y/uScale;
    vec3 blue=mix(vec3(.12,.45,1.),vec3(1.,.55,.18),uBad);
    // jagged fissure line: lateral wobble from 1D noise along the wall
    float wob=(n1(along*3.1)-.5)*.22+(n1(along*9.7+4.)-.5)*.08;
    float crack=1.-smoothstep(.015,.07,abs(vy-wob));
    float inside=step(-.4,along)*step(along,uLength+.4);
    // preview: dashed chevrons streaming toward the target + soft footprint band
    if(uPreview>.5){
     float band=(1.-smoothstep(.55,1.15,across))*inside;
     float chev=step(.55,fract(along*1.4-across*.9-uTime*1.6))*(1.-smoothstep(.0,.5,across));
     float endRing=1.-smoothstep(.0,.12,abs(length(vec2(along-uLength,vy))-.45));
     float a=band*.16+chev*.28*inside+crack*.35*inside+endRing*.8;
     if(uBad>.5)a*=.55+.45*step(.5,fract(along*2.));
     gl_FragColor=vec4(blue*a,1.);return;}
    // leading fissure: brightest just ahead of the front, fading over 1.6 m
    float ahead=along-uFront;
    float lead=crack*smoothstep(1.6,.0,ahead)*step(-.2,ahead)*inside*1.8;
    // behind the front: a soft light pool around the wall foot (fake bounce light from the crystals)
    float behind=smoothstep(.2,-.6,ahead)*inside;
    float pool=smoothstep(.15,.7,across)*(1.-smoothstep(.9,1.8,across))*behind;
    float shimmer=.75+.25*sin(uTime*2.1-along*.9);
    float flick=1.+uWarn*(.6*step(.7,n1(uTime*14.+along*3.))-.35);
    // chasm: the floor keeps a living resonance seam (wider, breathing) for as long as it stands open
    float seam=uSeam*behind*(crack*.55+(1.-smoothstep(.0,.42,abs(vy-wob)))*.22)*shimmer*flick;
    float a=(lead+pool*(.09*shimmer+uBloom*.22)*flick*(1.-.6*uSeam)+crack*behind*.2*uBloom+seam)*uLive;
    gl_FragColor=vec4(blue*a,1.);}`});
}
// Faceted unit crystal y 0..1, radius ~1, deterministic jitter (convex: all facets face outward for honest rays).
const sub3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function unitCrystal(T,sides,tipFrac,r){
 const pos=[],shoulder=1-tipFrac,j=Array.from({length:sides},()=>.85+r()*.3),P=(k,h,s)=>{const a=k/sides*Math.PI*2;return [Math.cos(a)*s*j[k%sides],h,Math.sin(a)*s*j[k%sides]];};
 const tip=[(r()-.5)*.15,1,(r()-.5)*.15];
 for(let k=0;k<sides;k++){const a=P(k,0,.9),b=P(k+1,0,.9),c=P(k+1,shoulder,1),d=P(k,shoulder,1);pos.push(a,d,c,a,c,b,d,tip,c,a,b,[0,-.05,0]);}
 const flat=[];for(let t=0;t<pos.length;t+=3){let [a,b,c]=pos.slice(t,t+3);const n=cross3(sub3(b,a),sub3(c,a)),m=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3-.45,(a[2]+b[2]+c[2])/3];if(n[0]*m[0]+n[1]*m[1]+n[2]*m[2]<0)[b,c]=[c,b];flat.push(...a,...b,...c);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(flat,3));g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();return g;
}
// Crust lip: a jittered rock slab (x along the wall, y up, z thickness); its -z face looks at the crest and is lined.
function plateGeometry(T,r){
 const g=new T.BoxGeometry(1,1,1,2,3,1).toNonIndexed(),p=g.attributes.position,jit=new Map();
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),key=`${x},${y},${z}`;if(!jit.has(key))jit.set(key,[(r()-.5)*.18,(r()-.5)*.12,(r()-.5)*.25]);const [jx,jy,jz]=jit.get(key);
  const taper=1-.45*Math.max(0,y+.5);// narrower, jagged top edge
  p.setXYZ(i,(x+jx)*taper,y+.5+jy*(y>0?2.2:1),(z+jz)*(.6+.4*taper));}
 g.computeVertexNormals();g.computeBoundingSphere();return g;
}
const triCount=g=>(g.index?g.index.count:g.attributes.position.count)/3;
const dummy={p:null,q:null,s:null,m:null};

export function createCrystalWall({THREE:T,scene,height,quality='high'}){
 const root=new T.Group();root.name='CrystalWalls';scene.add(root);
 dummy.p=new T.Vector3();dummy.q=new T.Quaternion();dummy.s=new T.Vector3();dummy.m=new T.Matrix4();
 const mats={core:new T.MeshStandardMaterial({color:0x0d2a78,emissive:0x0a47d8,emissiveIntensity:1.15,roughness:.18,metalness:.05,flatShading:true}),
  pale:new T.MeshStandardMaterial({color:0x3f7fe0,emissive:0x0b3aa8,emissiveIntensity:.85,roughness:.12,metalness:0,flatShading:true})};
 // Glassy: front faces only, depth-writing, lightly see-through (convex crystals need no sorting within a batch).
 for(const [kind,material] of Object.entries(mats)){applyCrystalMaterial(material,kind);addResonance(material);material.transparent=true;material.opacity=kind==='core'?.92:.84;material.depthWrite=true;}
 const crust=crustMaterial(T),strip=stripMaterial(T);
 const shapes=[0,1,2].map(v=>unitCrystal(T,6-(v&1),.26+v*.06,rng(91+v))),shapeMaterial=[mats.pale,mats.core,mats.pale];
 const plateGeo=plateGeometry(T,rng(7));
 // ---- shared pools: shards (instanced crystal fragments), sparks (additive points), dust (soft points) ----
 const shardMesh=new T.InstancedMesh(shapes[0],mats.pale,SHARD_POOL);shardMesh.name='CrystalWallShards';shardMesh.count=0;shardMesh.frustumCulled=false;
 shardMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);shardMesh.setColorAt(0,new T.Color(1,1,1));shardMesh.raycast=()=>{};shardMesh.userData.ignoreContact=true;root.add(shardMesh);
 const shards=Array.from({length:SHARD_POOL},()=>({life:0,age:0,p:new T.Vector3(),v:new T.Vector3(),q:new T.Quaternion(),spin:new T.Vector3(),s:.1}));
 function points(name,count,additive){
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(count*3),3).setUsage(T.DynamicDrawUsage));
  g.setAttribute('aColor',new T.BufferAttribute(new Float32Array(count*4),4).setUsage(T.DynamicDrawUsage));g.setAttribute('aSize',new T.BufferAttribute(new Float32Array(count),1).setUsage(T.DynamicDrawUsage));
  const m=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:additive?T.AdditiveBlending:T.NormalBlending,toneMapped:false,fog:false,
   vertexShader:`attribute vec4 aColor;attribute float aSize;varying vec4 vC;void main(){vC=aColor;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*${quality==='low'?'260.':'340.'}/max(.1,-mv.z);gl_Position=projectionMatrix*mv;}`,
   fragmentShader:`varying vec4 vC;void main(){vec2 d=gl_PointCoord-.5;float r=dot(d,d)*4.;if(r>1.)discard;float a=${additive?'pow(1.-r,2.)':'(1.-r)*.45'};gl_FragColor=vec4(vC.rgb*${additive?'vC.a*a':'1.'},${additive?'1.':'vC.a*a'});}`});
  const mesh=new T.Points(g,m);mesh.name=name;mesh.frustumCulled=false;mesh.raycast=()=>{};mesh.userData.ignoreContact=true;mesh.renderOrder=3;root.add(mesh);
  return {mesh,count,live:Array.from({length:count},()=>({life:0,age:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,r:0,g:0,b:0,size:0,drag:0,grav:0})),next:0,liveCount:0};
 }
 const sparks=points('CrystalWallSparks',quality==='low'?SPARK_POOL/2:SPARK_POOL,true),dust=points('CrystalWallDust',quality==='low'?DUST_POOL/2:DUST_POOL,false);
 // grav: downward m/s^2 (negative = buoyant motes/dust)
 function emit(pool,x,y,z,vx,vy,vz,life,size,r,g,b,drag=0,grav=0){const p=pool.live[pool.next];pool.next=(pool.next+1)%pool.count;p.life=life;p.age=0;p.x=x;p.y=y;p.z=z;p.vx=vx;p.vy=vy;p.vz=vz;p.size=size;p.r=r;p.g=g;p.b=b;p.drag=drag;p.grav=grav;}
 function emitShard(x,y,z,vx,vy,vz,s,seed){let i=shards.findIndex(q=>q.age>=q.life);if(i<0)i=seed%SHARD_POOL;const q=shards[i];q.life=.75+(seed%7)*.05;q.age=0;q.p.set(x,y,z);q.v.set(vx,vy,vz);q.q.setFromAxisAngle(new T.Vector3(vx,1,vz).normalize(),seed%6);q.spin.set((seed%5)-2,(seed%3)*2-2,(seed%7)-3).multiplyScalar(2.2);q.s=s;}
 const events={burst:[],shatter:[],warn:[]};// drained by game.js for audio/haptics (presentation-timed, late-join safe)

 const walls=new Map();let terrainKey=null,lastEdits=null,lastDeposits=null,lastTick=0,shownTick=0;
 // ---- wall construction ----
 function build(id,list,deposits,tick){
  const r0=list[0].rupture,dx=r0.end[0]-r0.start[0],dz=r0.end[1]-r0.start[1],len=Math.hypot(dx,dz),tx=dx/len,tz=dz/len,nx=-tz,nz=tx;
  const kind=list[0].kind,view=viewOf(kind),spec=wallSpec(kind),g=new T.Group();g.name=(kind==='sunder'?'SunderChasm_':kind==='wall'?'RaiseWall_':'CrystalWall_')+id;root.add(g);
  const segCount=list.length,crystalCap=segCount*(view.flank*2+view.floor);
  const batches=shapes.map((geometry,k)=>{const mesh=new T.InstancedMesh(geometry,shapeMaterial[k],crystalCap);mesh.name='CrystalBatch_'+k;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
   mesh.setColorAt(0,new T.Color(1,1,1));mesh.instanceColor.setUsage(T.DynamicDrawUsage);mesh.userData.wallTargets=[];mesh.count=0;g.add(mesh);return mesh;});
  const crustMesh=new T.InstancedMesh(plateGeo,crust,segCount*view.plates);crustMesh.name='CrystalCrust';crustMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);crustMesh.userData.wallTargets=[];crustMesh.count=0;g.add(crustMesh);
  // strip: along -0.6..len+1.6, across -view.strip..view.strip, conformed to live terrain
  const nA=Math.max(8,Math.ceil((len+2.2)/.3)),nC=view.layout==='chasm'?13:9,positions=new Float32Array(nA*nC*3),wall=new Float32Array(nA*nC*2),index=[];
  for(let i=0;i<nA;i++)for(let j=0;j<nC;j++){const k=i*nC+j;wall[k*2]=-.6+(len+2.2)*i/(nA-1);wall[k*2+1]=view.strip*(-1+2*j/(nC-1));if(i<nA-1&&j<nC-1)index.push(k,k+1,k+nC,k+1,k+nC+1,k+nC);}
  const sg=new T.BufferGeometry();sg.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));sg.setAttribute('aWall',new T.BufferAttribute(wall,2));sg.setIndex(index);
  const sm=strip.clone();sm.uniforms.uTime=wallTime;sm.uniforms.uLength.value=len;sm.uniforms.uScale.value=view.strip/1.8;sm.uniforms.uSeam.value=view.seam;
  const stripMesh=new T.Mesh(sg,sm);stripMesh.name='CrystalWallGlow';stripMesh.frustumCulled=false;stripMesh.renderOrder=2;stripMesh.raycast=()=>{};stripMesh.userData.ignoreContact=true;g.add(stripMesh);
  const w={id,kind,view,spec,group:g,batches,crustMesh,stripMesh,rupture:r0,len,t:[tx,tz],n:[nx,nz],segments:[],lastHeights:null,owner:list[0].wall.owner,quiet:false};
  const ordered=[...list].sort((a,b)=>((a.x-r0.start[0])*tx+(a.z-r0.start[1])*tz)-((b.x-r0.start[0])*tx+(b.z-r0.start[1])*tz));
  ordered.forEach((e,si)=>w.segments.push(segment(w,e,si,deposits.get(e.id))));
  walls.set(id,w);return w;
 }
 function segment(w,e,si,deposit){
  const r=rng(hash(e.id)),[tx,tz]=w.t,[nx,nz]=w.n,ws=e.wall,half=Math.hypot(ws.b[0]-ws.a[0],ws.b[1]-ws.a[1])/2,{view,spec}=w,chasm=view.layout==='chasm';
  const top=spec.peak??spec.depth,along=(e.x-w.rupture.start[0])*tx+(e.z-w.rupture.start[1])*tz,hMean=(ws.h0+ws.h1)/2,scale=.45+.55*hMean/top;
  // front reaches this segment's centre, then the soil finishes moving over the settle band
  const span=w.len+SUNDER_SETTLE_DISTANCE,d=w.rupture.durationTicks,front=w.rupture.startTick+d*along/span,risen=w.rupture.startTick+d*Math.min(1,(along+SUNDER_SETTLE_DISTANCE)/span);
  const crack=front+(risen-front)*.55;
  const crystals=[],flank=view.flank*2,reach=view.reach,size=chasm?.7+.3*hMean:(.5+hMean*.3);
  for(let k=0;k<flank+view.floor;k++){
   const druze=k>=flank,pair=k>>1,s=k%2?1:-1;
   // ridge: crystals crowd the crest edges, leaning out; chasm: they line both walls, leaning in toward the void
   const side=druze?(r()-.5)*(chasm?.5:.25)*reach:s*(chasm?spec.width*(.22+r()*.42):(.28+r()*.3)*reach);
   // the crystal wall keeps its even rhythm; the God's lines scatter crystals freely so long walls never read as a fence
   const u=druze?((k-flank+.5)/view.floor*2-1)*.8:w.kind==='pick_wall'?(pair/Math.max(1,view.flank-1)*2-1)*(.85+r()*.15):(r()*2-1)*.98;
   const shape=druze?(chasm&&k%2?1:0):chasm?(k%3?1:k%2?2:0):k%4===1?1:k%3===2?2:0,core=shape===1,grand=!chasm&&reach>1&&(k%5===1);
   const len=(druze?(chasm?(.35+r()*.35)*size:(.22+r()*.18)*scale):(core?1.55:1.0+r()*.45)*size*(chasm?.7:1))*(grand?1.35:1);
   const rad=(druze?(chasm?.1+r()*.06:.07+r()*.04):(core?.21:.12+r()*.07)*(.75+scale*.35))*(reach>1?1.25:1);
   const lean=druze?(r()-.5)*.4:Math.sign(side)*(chasm?-(.4+r()*.35):(.22+r()*.3)),tilt=(r()-.5)*.35,twist=r()*Math.PI*2;
   const q=new T.Quaternion().setFromAxisAngle(new T.Vector3(tx,0,tz),-lean).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(nx,0,nz),tilt)).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),twist));
   crystals.push({shape,ox:tx*u*half+nx*side,oz:tz*u*half+nz*side,depth:druze?.08:chasm?.3+r()*.15:.6+r()*.2,len,rad,q,
    delay:r()*8+(druze?6:0)+(core?2:0),order:(core?10:0)+(druze?20:0)+r()+(1-Math.abs(side))*.5,seed:hash(e.id+':'+k),glow:core||chasm&&druze?1.15:1});
  }
  const removalOrder=[...crystals].sort((a,b)=>a.order-b.order);
  const platesOut=[],perSide=view.plates/2;
  for(let k=0;k<view.plates;k++){
   const s=k%2?1:-1,u=(((k>>1)+.5)/perSide*2-1)*.9+(r()-.5)*(chasm?.35:.15);
   // chasm slabs hinge at the lip and peel right back over the spoil bank (big open angle, longer slabs)
   // rampart slabs stand at the foot and lean in against the faces (negative open), so the crust armours the wall
   const rampart=reach>1;
   platesOut.push({ux:tx*u*half,uz:tz*u*half,side:s,lip:chasm?spec.width*(1+r()*.15):rampart?spec.width*(.8+r()*.14):(.16+r()*.1),w:(.95/perSide)*half*2*(.85+r()*.3)*(rampart?1.3:chasm?1.25:1),
    h:chasm?(.55+r()*.4):rampart?hMean*(.62+r()*.36):(.42+r()*.22)*(.5+.5*scale),d:(.13+r()*.05)*(rampart?2.4:chasm?1.5:1),yaw:Math.atan2(nx*s,nz*s)+(r()-.5)*(rampart?.35:chasm?.6:.3),
    open:chasm?.85+r()*.45:rampart?-(.16+r()*.14):.45+r()*.35,sink:chasm?.05:rampart?.35:.22,seed:hash(e.id+'#'+k)});
  }
  return {edit:e,spec,deposit,si,along,front,risen,crack,crystals,removalOrder,plates:platesOut,removed:0,hits:deposit?.hits||0,broken:false,bloomed:false,warned:false,expireTick:ws.expireTick,naturalEnd:w.rupture.startTick+spec.lifetimeTicks};
 }
 // ---- per-frame pose ----
 const tmpE=new T.Euler(),axisY=new T.Vector3(0,1,0),tmpQ=new T.Quaternion(),tmpQ2=new T.Quaternion(),tmpV=new T.Vector3(),white=new T.Color();
 function pose(w,tick){
  const edits=lastEdits;let animating=false;
  const counts=[0,0,0];let plateCount=0;
  for(const b of w.batches)b.userData.wallTargets.length=0;w.crustMesh.userData.wallTargets.length=0;
  for(const seg of w.segments){
   const e=seg.edit,cx=e.x,cz=e.z,ground=height(cx,cz,edits),sink=sinkOf(seg,tick);
   const grow=clamp((tick-seg.crack)/GROW_TICKS,0,1.6),open=clamp((tick-seg.crack+4)/CRACK_TICKS,0,1);
   if(tick<seg.crack+GROW_TICKS+12||sink>0&&sink<1||tick>seg.naturalEnd-seg.spec.warnTicks&&tick<seg.naturalEnd+4)animating=true;
   const id=seg.deposit?.id;
   // crust plates: ride the soil, split open at the crack, crumble while sinking
   if(!(sink>=1)){
    for(const p of seg.plates){
     // closed: the two lips lean together over the crest seam; open: they peel outward, showing their lining
     const grown=tick<seg.front?0:clamp((tick-seg.front)/8,0,1),k=(1-.5*sink)*grown;if(k<=.001)continue;
     const o=-.28+(backOut(open)*(p.open+.28))+sink*.8,lx=cx+p.ux+w.n[0]*p.side*p.lip,lz=cz+p.uz+w.n[1]*p.side*p.lip;
     tmpQ.setFromAxisAngle(axisY,p.yaw);tmpQ2.setFromAxisAngle(tmpV.set(w.t[0],0,w.t[1]),p.side*o);
     dummy.q.copy(tmpQ2).multiply(tmpQ);dummy.p.set(lx,height(lx,lz,edits)-p.sink-sink*.45,lz);dummy.s.set(p.w*k,p.h*k,p.d);
     dummy.m.compose(dummy.p,dummy.q,dummy.s);w.crustMesh.setMatrixAt(plateCount++,dummy.m);w.crustMesh.userData.wallTargets.push(id);
    }
   }
   // crystals
   if(sink>0&&!seg.broken){seg.broken=true;breakSegment(w,seg,ground,tick);}
   if(seg.broken)continue;
   const warnTicks=seg.spec.warnTicks,warn=tick>seg.naturalEnd-warnTicks&&seg.expireTick>=seg.naturalEnd?clamp((tick-(seg.naturalEnd-warnTicks))/warnTicks,0,1):0;
   if(warn>0&&!seg.warned){seg.warned=true;if(tick<seg.naturalEnd-warnTicks+20)events.warn.push({position:[cx,ground,cz],wall:w.id,segment:seg.si});}
   if(grow>0&&!seg.bloomed){seg.bloomed=true;if(tick-seg.crack<20)bloom(w,seg,ground);}
   for(let k=seg.removed;k<seg.removalOrder.length;k++){
    const c=seg.removalOrder[k],u=clamp((tick-seg.crack-c.delay)/(GROW_TICKS-8),0,1);if(u<=0)continue;
    const ee=backOut(u),lift=(1-Math.min(1,ee))*c.len*.9;
    dummy.p.set(cx+c.ox,height(cx+c.ox,cz+c.oz,edits)-c.depth-lift,cz+c.oz);
    dummy.q.copy(c.q);if(u<1){tmpQ.setFromAxisAngle(tmpV.set(w.t[0],0,w.t[1]),(1-ee)*1.1);dummy.q.premultiply(tmpQ);}
    const wide=.55+.45*Math.min(1,ee);dummy.s.set(c.rad*wide,(c.len+c.depth)*Math.max(.05,ee),c.rad*wide);
    dummy.m.compose(dummy.p,dummy.q,dummy.s);const b=w.batches[c.shape],i=counts[c.shape]++;b.setMatrixAt(i,dummy.m);b.userData.wallTargets.push(id);
    // light: birth flash decays to rest; warning flicker in the final seconds
    const flash=Math.max(0,1-(tick-seg.crack-c.delay)/40)*2.6,flick=warn>0?(1+warn*.9*Math.sin(tick*(.9+warn*1.4)+c.seed%13)*((c.seed>>3)%2?1:-.6)):1;
    white.setScalar(Math.max(.15,(c.glow+flash)*flick));b.setColorAt(i,white);
    if(warn>.25&&((tick|0)+c.seed)%97===0&&Math.random()<.5)emit(sparks,dummy.p.x,dummy.p.y+c.len*.8,dummy.p.z,(Math.random()-.5)*.6,.4,(Math.random()-.5)*.6,.9,.05,.4,.8,1,.4,-.4);
   }
  }
  for(let k=0;k<3;k++){const b=w.batches[k];b.count=counts[k];b.instanceMatrix.needsUpdate=true;if(b.instanceColor)b.instanceColor.needsUpdate=true;b.computeBoundingSphere();}
  w.crustMesh.count=plateCount;w.crustMesh.instanceMatrix.needsUpdate=true;w.crustMesh.computeBoundingSphere();
  // strip: front distance, bloom energy, fade as the wall sinks
  const u=w.stripMesh.material.uniforms,r=w.rupture,span=w.len+SUNDER_SETTLE_DISTANCE;
  u.uFront.value=clamp((tick-r.startTick)/r.durationTicks,0,1)*span;
  u.uBloom.value=Math.max(0,1-(tick-(r.startTick+r.durationTicks))/50)*clamp((tick-r.startTick)/r.durationTicks*2,0,1);
  let alive=0,sinkAll=1;for(const q of w.segments){const k=sinkOf(q,tick);if(k<1)alive++;sinkAll=Math.min(sinkAll,k);}alive/=w.segments.length;
  u.uLive.value=alive*(1-sinkAll);u.uWarn.value=w.segments.some(s=>s.warned&&!s.broken)?clamp((tick-(w.rupture.startTick+w.spec.lifetimeTicks-w.spec.warnTicks))/w.spec.warnTicks,0,1):0;
  conformStrip(w,animating||!w.lastHeights);
  return animating;
 }
 function conformStrip(w,force){
  if(!force)return;const pos=w.stripMesh.geometry.attributes.position,wall=w.stripMesh.geometry.attributes.aWall.array,[sx,sz]=w.rupture.start,[tx,tz]=w.t,[nx,nz]=w.n;
  for(let i=0;i<pos.count;i++){const a=wall[i*2],c=wall[i*2+1],x=sx+tx*a+nx*c,z=sz+tz*a+nz*c;pos.setXYZ(i,x,height(x,z,lastEdits)+.09,z);}
  pos.needsUpdate=true;w.lastHeights=true;
 }
 function bloom(w,seg,ground){
  const r=rng(seg.crystals[0].seed),[tx,tz]=w.t,e=seg.edit,many=quality==='low'?6:12;
  for(let i=0;i<many;i++){const a=r()*Math.PI*2,s=.6+r()*1.6;emit(sparks,e.x+(r()-.5)*.8,ground+.2+r()*.6,e.z+(r()-.5)*.8,Math.cos(a)*s*.6,1.2+r()*2.2,Math.sin(a)*s*.6,.7+r()*.6,.06+r()*.05,.35+r()*.3,.7+r()*.25,1,1.8,1.2);}
  for(let i=0;i<(quality==='low'?2:3);i++){const s=r()<.5?1:-1;emit(dust,e.x+w.n[0]*s*(.9+r()*.4)+tx*(r()-.5),ground-.6+r()*.3,e.z+w.n[1]*s*(.9+r()*.4)+tz*(r()-.5),w.n[0]*s*(.5+r()*.6),.3+r()*.4,w.n[1]*s*(.5+r()*.6),.9+r()*.4,.18+r()*.12,.62,.5,.36,2.6,-.15);}
  events.burst.push({position:[e.x,ground,e.z],wall:w.id,kind:w.kind,segment:seg.si,height:(e.wall.h0+e.wall.h1)/2});
 }
 function breakSegment(w,seg,ground,tick){
  const fresh=tick<seg.expireTick+10,e=seg.edit;
  if(fresh){
   for(let k=seg.removed;k<seg.removalOrder.length;k++){const c=seg.removalOrder[k],r=rng(c.seed);
    for(let j=0;j<(c.shape===1?2:1);j++)emitShard(e.x+c.ox,ground+c.len*(.2+.6*r()),e.z+c.oz,(r()-.5)*2.4+w.n[0]*Math.sign(c.ox*w.n[0]+c.oz*w.n[1]||1)*1.2,1.4+r()*2.6,(r()-.5)*2.4+w.n[1]*Math.sign(c.ox*w.n[0]+c.oz*w.n[1]||1)*1.2,c.rad*(.45+r()*.3),c.seed+j);
    for(let j=0;j<2;j++)emit(sparks,e.x+c.ox,ground+c.len*r(),e.z+c.oz,(r()-.5)*3,1+r()*2.5,(r()-.5)*3,.55+r()*.4,.07,.5,.85,1,1.2,4);}
   for(let i=0;i<2;i++)emit(dust,e.x+(Math.random()-.5),ground-.3,e.z+(Math.random()-.5),(Math.random()-.5)*.8,.4,(Math.random()-.5)*.8,1.1,.22,.62,.5,.36,2.4,-.15);
   events.shatter.push({position:[e.x,ground,e.z],wall:w.id,kind:w.kind,segment:seg.si,crystals:seg.removalOrder.length-seg.removed});
  }
  seg.removed=seg.removalOrder.length;
 }
 // mining: hits remove whole crystals (outer first), each with a little shard spray
 function applyHits(w,seg,deposit,animate){
  if(seg.broken){if(seg.expireTick<=lastTick)return;seg.broken=false;seg.removed=0;}// sinking owns it; else a restored checkpoint
  const max=Math.max(1,deposit?.maxHits||3),hits=deposit?.hits||0,n=seg.removalOrder.length;
  const target=deposit?.depleted?n:Math.min(n-1,Math.floor(n*Math.min(1,hits/max)));
  if(target<seg.removed){seg.removed=target;return;}// restored to an earlier checkpoint
  const ground=height(seg.edit.x,seg.edit.z,lastEdits);
  while(seg.removed<target){const c=seg.removalOrder[seg.removed++];if(!animate)continue;const r=rng(c.seed+hits);
   for(let j=0;j<2;j++)emitShard(seg.edit.x+c.ox,ground+c.len*.5,seg.edit.z+c.oz,(r()-.5)*2,1.5+r()*1.5,(r()-.5)*2,c.rad*.5,c.seed+j);}
 }
 // ---- snapshot sync ----
 function sync(s){
  lastEdits=s.edits||[];lastTick=s.tick??lastTick;const deposits=new Map(),key=terrainFrameKey(lastEdits,lastTick),moved=key!==terrainKey;terrainKey=key;
  for(const d of s.deposits||[])if((d.special==='pick_wall'||d.special==='wall')&&d.editId)deposits.set(d.editId,d);
  const casts=new Map();
  for(const e of lastEdits)if(e.wall&&e.rupture&&viewOf(e.kind)){if(!casts.has(e.rupture.id))casts.set(e.rupture.id,[]);casts.get(e.rupture.id).push(e);}
  for(const [id,w] of walls)if(!casts.has(id)||lastTick<w.rupture.startTick)retire(id,w);// gone, or world rewound before it
  for(const [id,list] of casts){
   const known=walls.get(id),w=known||build(id,list,deposits,lastTick),byId=new Map(list.map(e=>[e.id,e]));
   let changed=!known||moved;
   for(const seg of w.segments){const e=byId.get(seg.edit.id);
    if(!e){seg.expireTick=Math.min(seg.expireTick,lastTick-seg.spec.sinkTicks);continue;}// authority retired it after its sink
    const deposit=deposits.get(e.id);if(seg.expireTick!==e.wall.expireTick||(seg.deposit?.hits??0)!==(deposit?.hits??0)||!!seg.deposit?.depleted!==!!deposit?.depleted)changed=true;
    seg.edit=e;seg.expireTick=e.wall.expireTick;seg.deposit=deposit;
    applyHits(w,seg,deposit,!!known&&seg.bloomed);}
   if(changed){w.lastHeights=null;w.quiet=false;}// terrain, damage or lifetime changed: re-pose once
  }
  legacy.sync(s);
 }
 function retire(id,w){w.group.removeFromParent();for(const b of w.batches)b.dispose();w.crustMesh.dispose();w.stripMesh.geometry.dispose();w.stripMesh.material.dispose();walls.delete(id);}
 // ---- per frame ----
 function update(dt,simTick=lastTick){
  shownTick=simTick<shownTick-120?simTick:Math.max(shownTick,simTick);// never rewind for jitter; follow a real rewind
  wallTime.value=shownTick/60;
  for(const w of walls.values()){
   if(w.quiet&&shownTick<w.wakeAt)continue;
   const busy=pose(w,shownTick);w.quiet=!busy;
   // next scheduled change for a quiet wall: its warning, or the earliest segment expiry
   w.wakeAt=Infinity;for(const q of w.segments){for(const t of [q.naturalEnd-q.spec.warnTicks,q.expireTick])if(t>shownTick)w.wakeAt=Math.min(w.wakeAt,t);}
  }
  stepPools(dt);legacy.update(dt);
 }
 function stepPools(dt){
  let n=0;for(const q of shards){if(q.age>=q.life)continue;q.age+=dt;q.v.y-=9.8*dt;q.p.addScaledVector(q.v,dt);tmpQ.setFromEuler(tmpE.set(q.spin.x*dt,q.spin.y*dt,q.spin.z*dt));q.q.multiply(tmpQ);
   const k=Math.max(0,1-q.age/q.life),s=q.s*Math.pow(k,.6);if(s<=.002)continue;dummy.s.set(s*.45,s*2.8,s*.45);dummy.m.compose(q.p,q.q,dummy.s);shardMesh.setMatrixAt(n,dummy.m);white.setScalar(.6+2.4*k);shardMesh.setColorAt(n,white);n++;}
  shardMesh.count=n;shardMesh.instanceMatrix.needsUpdate=true;if(shardMesh.instanceColor)shardMesh.instanceColor.needsUpdate=true;
  for(const pool of [sparks,dust]){const pos=pool.mesh.geometry.attributes.position,col=pool.mesh.geometry.attributes.aColor,size=pool.mesh.geometry.attributes.aSize;let live=0;
   for(let i=0;i<pool.count;i++){const p=pool.live[i];if(p.age>=p.life){size.array[i]=0;continue;}live++;p.age+=dt;const drag=Math.exp(-p.drag*dt);p.vx*=drag;p.vz*=drag;p.vy=p.vy*drag-p.grav*dt;
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;const k=1-p.age/p.life,a=pool===dust?k*(1-k)*2:k*k;
    pos.array[i*3]=p.x;pos.array[i*3+1]=p.y;pos.array[i*3+2]=p.z;col.array.set([p.r,p.g,p.b,Math.min(1,a)],i*4);size.array[i]=p.size*(pool===dust?1+1.2*(1-k):1);}
   pool.mesh.visible=live>0;pos.needsUpdate=col.needsUpdate=size.needsUpdate=true;pool.liveCount=live;}
 }
 // ---- raycast: instanced crystals/plates map instanceId -> deposit id ----
 function resolveTarget(hit){const ids=hit?.object?.userData?.wallTargets;if(!ids||hit.instanceId===undefined)return null;const id=ids[hit.instanceId];if(!id)return null;
  return {id,point:hit.point.toArray(),normal:hit.face?hit.face.normal.clone().transformDirection(hit.object.matrixWorld).toArray():null,instanced:true};}
 function targets(){const out=[];for(const w of walls.values()){for(const b of w.batches)if(b.count)out.push(b);if(w.crustMesh.count)out.push(w.crustMesh);}return out.concat(legacy.targets());}
 function drainEvents(){const out={burst:events.burst.splice(0),shatter:events.shatter.splice(0),warn:events.warn.splice(0)};return out;}
 function stats(){let crystals=0,plates=0,tris=0,draws=0,growing=0;
  for(const w of walls.values()){for(const s of w.segments){crystals+=s.removalOrder.length-s.removed;if(shownTick<s.crack+GROW_TICKS)growing++;}
   for(const b of w.batches)if(b.count){draws++;tris+=triCount(b.geometry)*b.count;}plates+=w.crustMesh.count;if(w.crustMesh.count){draws++;tris+=triCount(plateGeo)*w.crustMesh.count;}if(w.stripMesh.material.uniforms.uLive.value>0){draws++;tris+=w.stripMesh.geometry.index.count/3;}}
  const l=legacy.stats();
  return {walls:walls.size,segments:[...walls.values()].reduce((n,w)=>n+w.segments.length,0)+l.segments,crystals:crystals+l.crystals,plates,growing,triangles:tris+l.triangles,draws:draws+l.draws+(shardMesh.count?1:0)+(sparks.mesh.visible?1:0)+(dust.mesh.visible?1:0),
   shards:shardMesh.count,sparks:sparks.liveCount||0,dust:dust.liveCount||0,debris:l.debris,sharedGeometries:shapes.length+1,sharedMaterials:Object.keys(mats).length+2};}
 function dispose(){for(const [id,w] of walls)retire(id,w);root.removeFromParent();legacy.dispose();shardMesh.dispose();for(const p of [sparks,dust]){p.mesh.geometry.dispose();p.mesh.material.dispose();}
  for(const g of shapes)g.dispose();plateGeo.dispose();for(const m of Object.values(mats))m.dispose();crust.dispose();strip.dispose();}
 const legacy=createLegacyWalls({T,scene:root,height,mats,shapes});
 return {sync,update,dispose,stats,targets,resolveTarget,drainEvents,root,materials:mats};
}

// Pre-v2 saves: permanent point-kernel walls (radius 1, height 2.4, no rupture). Static, mature crystal clusters with the
// original one-group-per-deposit tagging so their mining contract is unchanged.
function createLegacyWalls({T,scene,height,mats,shapes}){
 const segments=new Map(),debris=new T.Group();debris.name='CrystalWallDebris';scene.add(debris);
 function build(d,edits){const r=rng(hash(d.id)),ground=height(d.x,d.z,edits),g=new T.Group();g.name='CrystalWall_'+d.id;g.position.set(d.x,0,d.z);g.userData.targetId=d.id;
  const batches=shapes.map((geometry,k)=>{const mesh=new T.InstancedMesh(geometry,k===1?mats.core:mats.pale,9);mesh.name='CrystalBatch_'+k;mesh.userData.targetId=d.id;mesh.setColorAt(0,new T.Color(1,1,1));g.add(mesh);return mesh;});
  const crystals=[];for(let k=0;k<9;k++){const m=new T.Object3D(),core=k%3===1,side=(r()-.5)*.55,along=(k/8*2-1)*.55;m.position.set(along*.3,ground-2.4,along+side*.3);
   m.rotation.set((r()-.5)*.4,r()*6,(side>=0?1:-1)*(.08+r()*.22));m.scale.set(core?.3:.2,(2.9)*(core?1:.75+r()*.2),core?.3:.2);m.userData.shape=k%3;m.userData.order=(core?10:0)+r();crystals.push(m);}
  crystals.sort((a,b)=>a.userData.order-b.userData.order);scene.add(g);const seg={group:g,crystals,batches,removed:0,data:d,ground};refresh(seg);return seg;}
 function refresh(seg){for(let k=0;k<3;k++){const mesh=seg.batches[k];let n=0;for(let i=seg.removed;i<seg.crystals.length;i++){const c=seg.crystals[i];if(c.userData.shape!==k)continue;c.updateMatrix();mesh.setMatrixAt(n,c.matrix);mesh.setColorAt(n,new T.Color(1,1,1));n++;}mesh.count=n;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}}
 function sync(s){const legacyEdits=new Set((s.edits||[]).filter(e=>e.kind==='pick_wall'&&!e.wall).map(e=>e.id)),seen=new Set();
  for(const d of s.deposits||[]){if(d.special!=='pick_wall'||!legacyEdits.has(d.editId)||d.depleted)continue;seen.add(d.id);let seg=segments.get(d.id);
   if(seg&&d.hits<seg.data.hits){retire(d.id,seg);seg=null;}if(!seg){seg=build(d,s.edits);segments.set(d.id,seg);}
   seg.group.position.y=height(d.x,d.z,s.edits)-seg.ground;seg.data=d;const target=Math.min(seg.crystals.length-1,Math.floor(seg.crystals.length*Math.min(1,(d.hits||0)/Math.max(1,d.maxHits||3))));
   if(target!==seg.removed){seg.removed=target;refresh(seg);}}
  for(const [id,seg] of segments)if(!seen.has(id))retire(id,seg);}
 function retire(id,seg){seg.group.removeFromParent();for(const b of seg.batches)b.dispose();segments.delete(id);}
 return {sync,update(){},targets:()=>[...segments.values()].map(s=>s.group),dispose(){for(const [id,s] of segments)retire(id,s);debris.removeFromParent();},
  stats(){let crystals=0,draws=0,tris=0;for(const s of segments.values()){crystals+=s.crystals.length-s.removed;for(const b of s.batches)if(b.count){draws++;tris+=triCount(b.geometry)*b.count;}}return {segments:segments.size,crystals,draws,triangles:tris,debris:0};}};
}
