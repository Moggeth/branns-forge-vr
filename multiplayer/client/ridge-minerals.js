// Pick of Riches presentation: the minerals a Stonewhisper ridge tears up out of the ground (2026-10-12).
// The authority gives every ridge segment a DEPOSIT_CATALOG kind (shared/weapon-specials.js ridgeMinerals). Crystal
// segments keep the glassy blue geode crystals; every other mineral is drawn here as broken-off, faceted specimens in one
// opaque instanced batch per wall. The instance colour carries (glow, mineral/4, 0), so one program and one draw cover the lot:
//   stone   speckled granite,
//   iron    banded rock with rust staining and dark metallic nodules,
//   copper  verdigris-stained rock with bright native-copper nodules,
//   gold    dark rock with quartz streaks and glinting gold nodules and seams,
//   mithril blue-grey rock with silver-blue nodules that shimmer.
// The pick's magic shows as the blue resonance rim (birth flash, warning flicker), shared with the crystals.
// Opaque, depth-writing, no textures, no extra lights.
export const ORE_INDEX=Object.freeze({stone:0,iron:1,copper:2,gold:3,mithril:4});
export const oreIndex=kind=>ORE_INDEX[kind]??0;
/** Additive glint colour for the bloom of a rich seam (null: no glints). */
export const ORE_GLINT=Object.freeze({gold:[1,.74,.28],mithril:[.55,.9,1],crystal:[.5,.75,1]});

const ORE_GLSL_COMMON=/* glsl */`
uniform float uWallTime;
varying vec3 vOreLocal;varying vec3 vOreMetric;
float oreH(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float oreN(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(oreH(i),oreH(i+vec3(1,0,0)),f.x),mix(oreH(i+vec3(0,1,0)),oreH(i+vec3(1,1,0)),f.x),f.y),mix(mix(oreH(i+vec3(0,0,1)),oreH(i+vec3(1,0,1)),f.x),mix(oreH(i+vec3(0,1,1)),oreH(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
const ORE_GLSL_VERTEX=/* glsl */`
{
  vec3 oScale=vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),length(modelMatrix[2].xyz));
#ifdef USE_INSTANCING
  oScale*=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
#endif
  vOreLocal=position;vOreMetric=position*oScale;
}
`;
const ORE_GLSL_FRAGMENT=/* glsl */`
{
  // Same recipe as the world's mineral deposits (forest-resource-art.js DEPOSIT): banded host rock, a stain that
  // tells the mineral at a glance, and metallic ore nodules and seams. Linear-space colours; patterns live in the
  // specimen's own metric space so they ride with it as it rises.
  vec3 P=vOreMetric*vec3(16.,9.,16.);
  float n=oreN(P),g=oreN(P*.45+2.3),f=oreN(P*1.7+5.1),h=oreN(P*4.+11.);
  float fb=oreN(P*.8+7.7)*.6+n*.4,rid=1.-abs(2.*fb-1.);
  float strata=.9+.1*sin(vOreMetric.y*40.+g*6.);
  float y=clamp(vOreLocal.y,0.,1.);
  float k=0.,glow=1.;
#if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
  glow=vColor.r;k=vColor.g*4.;
#endif
  vec3 hostA,hostB,stain,ore;float stainAt,oreAt,oreMetal=.9,oreRough=.3;vec3 oreGlow=vec3(0.);
  if(k<.5){hostA=vec3(.1,.097,.092);hostB=vec3(.2,.19,.175);stain=vec3(.46,.44,.4);ore=vec3(.03);stainAt=.82;oreAt=.88;oreMetal=0.;oreRough=.7;}
  else if(k<1.5){hostA=vec3(.11,.09,.08);hostB=vec3(.19,.16,.14);stain=vec3(.46,.12,.03);ore=vec3(.05,.035,.03);stainAt=.4;oreAt=.8;}
  else if(k<2.5){hostA=vec3(.1,.09,.08);hostB=vec3(.18,.16,.14);stain=vec3(.04,.42,.27);ore=vec3(.7,.22,.06);stainAt=.4;oreAt=.8;}
  else if(k<3.5){hostA=vec3(.07,.068,.066);hostB=vec3(.14,.135,.13);stain=vec3(.62,.6,.53);ore=vec3(1.,.6,.1);stainAt=.66;oreAt=.75;oreRough=.2;oreGlow=vec3(1.,.55,.12);}
  else{hostA=vec3(.06,.075,.095);hostB=vec3(.13,.16,.2);stain=vec3(.15,.32,.4);ore=vec3(.7,.88,.95);stainAt=.66;oreAt=.76;oreRough=.16;oreGlow=vec3(.25,.75,1.);}
  vec3 alb=mix(hostA,hostB,n*.55+h*.25+g*.2)*strata;
  alb=mix(alb,stain,smoothstep(stainAt,stainAt+.22,g)*.7);
  // stone has no ore, only fine dark mica and pale feldspar grains; metals add nodules and (native metals) thin seams
  float grain=smoothstep(.86,.92,h);
  float nod=smoothstep(oreAt,oreAt+.05,f),seam=k>1.5?smoothstep(.95,.985,rid)*.85:0.,orem=k<.5?0.:max(nod,seam);
  alb=mix(alb,k<.5?vec3(.02):hostB*1.4,grain*(k<.5?.75:.35));
  if(k<.5)alb=mix(alb,vec3(.42,.4,.36),smoothstep(.9,.96,oreN(P*2.6+3.))*.8);
  alb=mix(alb,ore,orem);
  float metal=oreMetal*orem,rough=mix(.88,oreRough,orem);
  float sparkle=smoothstep(.9,.97,h)*orem*(.5+.5*sin(uWallTime*3.+n*31.));
  vec3 emi=oreGlow*(orem*.06+sparkle*.9);
  // rooted base: still coated in the soil it was torn from
  float root=smoothstep(.0,.28,y);
  alb=mix(vec3(.05,.032,.018),alb,root);rough=mix(.95,rough,root);metal*=root;
  diffuseColor.rgb=alb;roughnessFactor=rough;metalnessFactor=metal;
  // the pick's resonance clings to the lifted stone: a blue rim, flaring at birth and flickering before the ridge sinks
  vec3 oV=normalize(vViewPosition);
  float rim=pow(1.-clamp(abs(dot(normal,oV)),0.,1.),3.);
  float wave=.82+.18*sin(uWallTime*2.1-(vOreMetric.x+vOreMetric.z)*.9);
  totalEmissiveRadiance=emi*(.6+.4*min(glow,2.))+vec3(.12,.42,1.)*(rim*.3*wave*root*min(glow,1.)+max(0.,glow-1.)*.07);
}
`;
/** One opaque material for every lifted mineral (instance colour g = mineral index / 4 picks the palette). */
export function oreMaterial(T,wallTime){
 const m=new T.MeshStandardMaterial({color:0xffffff,roughness:.9,metalness:0,flatShading:true});
 m.onBeforeCompile=shader=>{shader.uniforms.uWallTime=wallTime;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vOreLocal;varying vec3 vOreMetric;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\n'+ORE_GLSL_VERTEX);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+ORE_GLSL_COMMON)
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n'+ORE_GLSL_FRAGMENT);};
 m.customProgramCacheKey=()=>'ridge-ore-v1';m.envMapIntensity=.9;return m;
}
/** Broken mineral column, y 0..1, radius ~1: 7 jittered sides and a slanted, chipped break instead of a point. Convex. */
export function oreChunkGeometry(T,r){
 const sides=7,j=Array.from({length:sides},()=>.78+r()*.4),top=Array.from({length:sides},(_,k)=>{const a=k/sides*Math.PI*2;return .74+.2*Math.cos(a-.6)+(r()-.5)*.08;});
 const P=(k,h,s)=>{const a=k/sides*Math.PI*2,i=k%sides;return [Math.cos(a)*s*j[i],h,Math.sin(a)*s*j[i]];};
 const cap=[(r()-.5)*.1,Math.max(...top)*.97,(r()-.5)*.1],pos=[];
 for(let k=0;k<sides;k++){const n=(k+1)%sides,a=P(k,0,.92),b=P(k+1,0,.92),c=P(k+1,top[n],.86),d=P(k,top[k],.86);pos.push(a,d,c,a,c,b,d,cap,c,a,b,[0,-.04,0]);}
 const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],flat=[];
 for(let t=0;t<pos.length;t+=3){let [a,b,c]=pos.slice(t,t+3);const nn=cross(sub(b,a),sub(c,a)),m=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3-.45,(a[2]+b[2]+c[2])/3];if(nn[0]*m[0]+nn[1]*m[1]+nn[2]*m[2]<0)[b,c]=[c,b];flat.push(...a,...b,...c);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(flat,3));g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();return g;
}
/** Instance colour for a chunk: r = light level (flash/flicker), g = mineral. */
export const oreColor=(color,glow,kind)=>color.setRGB(glow,oreIndex(kind)/4,0);
