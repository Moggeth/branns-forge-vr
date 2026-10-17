// The Underways' shell materials: a standard material per style and surface, with the dungeon's baked torchlight
// (the `aLight` attribute, client/underways/build.js) added as emission that flickers slowly by area, and fine surface
// detail in world metres (rock grain and strata for the mine, bricks and flagstones for the crypt, ashlar and moss for the
// sunken keep). One program per style and surface; the uniforms are shared.
import * as THREE from 'three';

export const lookUniforms = {uUwTime: {value: 0}, uUwBright: {value: 1}};
const NOISE = `
float uwh(vec3 p){p=fract(p*.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float uwn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(uwh(i),uwh(i+vec3(1,0,0)),f.x),mix(uwh(i+vec3(0,1,0)),uwh(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(uwh(i+vec3(0,0,1)),uwh(i+vec3(1,0,1)),f.x),mix(uwh(i+vec3(0,1,1)),uwh(i+vec3(1,1,1)),f.x),f.y),f.z);}
// distance to the nearest mortar line of a running-bond brick course (u along, v up), 0 on the line
float uwBrick(vec2 p, vec2 size){ float row=floor(p.y/size.y); p.x+=mod(row,2.0)*size.x*.5; vec2 f=fract(p/size)*size; vec2 d=min(f,size-f); return min(d.x,d.y); }`;

// Per style and surface: how the fine detail is drawn (GLSL snippet that scales diffuseColor and may set roughness).
const DETAIL = {
  mine: {
    floor: `float g=uwn(vUwWorld*5.0)*.55+uwn(vUwWorld*13.0)*.45; diffuseColor.rgb*=.78+.42*g; float pebble=smoothstep(.72,.8,uwn(vUwWorld*vec3(3.1,1.0,3.1))); diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.25,pebble);`,
    wall: `float g=uwn(vUwWorld*4.0)*.5+uwn(vUwWorld*11.0)*.5; float strata=.5+.5*sin(vUwWorld.y*5.2+uwn(vUwWorld*.7)*4.0); diffuseColor.rgb*=(.74+.4*g)*(.9+.14*strata);`,
    roof: `float g=uwn(vUwWorld*3.0)*.6+uwn(vUwWorld*9.0)*.4; diffuseColor.rgb*=.7+.42*g;`,
  },
  crypt: {
    floor: `vec2 fp=vUwWorld.xz; float row=floor(fp.y/1.0); fp.x+=mod(row,2.0)*.5; vec2 f=fract(fp/vec2(1.0,1.0)); vec2 e=min(f,1.0-f); float m=smoothstep(.0,.045,min(e.x,e.y)); vec2 cell=floor(fp); float tone=uwh(vec3(cell,3.0)); diffuseColor.rgb*=(.82+.3*tone)*(.55+.45*m)*(.88+.2*uwn(vUwWorld*7.0));`,
    wall: `float m=smoothstep(.0,.03,uwBrick(vUwUv,vec2(.62,.3))); vec2 cell=floor(vec2(vUwUv.x/.62+mod(floor(vUwUv.y/.3),2.0)*.5,vUwUv.y/.3)); float tone=uwh(vec3(cell,7.0)); diffuseColor.rgb*=(.8+.32*tone)*(.5+.5*m)*(.9+.18*uwn(vUwWorld*6.0));`,
    roof: `float m=smoothstep(.0,.04,uwBrick(vUwWorld.xz,vec2(.9,.45))); diffuseColor.rgb*=(.6+.4*m)*(.85+.25*uwn(vUwWorld*5.0));`,
  },
  keep: {
    floor: `vec2 fp=vUwWorld.xz; vec2 f=fract(fp/1.4); vec2 e=min(f,1.0-f); float m=smoothstep(.0,.04,min(e.x,e.y)); float tone=uwh(vec3(floor(fp/1.4),5.0)); float moss=smoothstep(.55,.75,uwn(vUwWorld*vec3(.6,1.0,.6)))*(1.0-m*.6); diffuseColor.rgb*=(.84+.28*tone)*(.6+.4*m); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.22,.34,.14),moss*.65);`,
    wall: `float m=smoothstep(.0,.035,uwBrick(vUwUv,vec2(1.2,.6))); vec2 cell=floor(vec2(vUwUv.x/1.2+mod(floor(vUwUv.y/.6),2.0)*.5,vUwUv.y/.6)); float tone=uwh(vec3(cell,9.0)); float moss=smoothstep(.62,.8,uwn(vUwWorld*vec3(.7,.35,.7)))*smoothstep(2.5,.2,vUwUv.y-vUwFloor); diffuseColor.rgb*=(.82+.3*tone)*(.55+.45*m); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.2,.32,.13),moss*.6);`,
    roof: `float m=smoothstep(.0,.05,uwBrick(vUwWorld.xz,vec2(1.6,.8))); diffuseColor.rgb*=(.6+.4*m)*(.85+.25*uwn(vUwWorld*4.0));`,
  },
};

const cache = new Map();
/** The shell material for a style and surface ('floor', 'wall' or 'roof'). Shared; do not dispose per dungeon. */
export function shellMaterial(style, surface, {low = false} = {}) {
  const key = `${style}-${surface}-${low ? 'low' : 'high'}`;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({vertexColors: true, roughness: surface === 'floor' ? .86 : .92, metalness: 0, envMapIntensity: .25, side: THREE.DoubleSide});
  const detail = DETAIL[style]?.[surface] || '';
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lookUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLight; varying vec3 vUwLight; varying vec3 vUwWorld; varying vec2 vUwUv; varying float vUwFloor;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUwUv = uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvUwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vUwLight = aLight; vUwFloor = 0.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vUwLight; varying vec3 vUwWorld; varying vec2 vUwUv; varying float vUwFloor; uniform float uUwTime, uUwBright;${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${detail}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Baked fire- and crystal-light, breathing gently by area (no two torches in step).
        float uwFlick = .9 + .07 * sin(uUwTime * 7.3 + vUwWorld.x * 1.3 + vUwWorld.z * .7) + .05 * sin(uUwTime * 12.9 + vUwWorld.z * 2.1);
        totalEmissiveRadiance += diffuseColor.rgb * vUwLight * uwFlick * uUwBright;`);
  };
  m.customProgramCacheKey = () => 'uw-' + key;
  cache.set(key, m);
  return m;
}

/** Emissive-only material for flames, crystal hearts and glows (additive, no depth write). */
export function glowMaterial(color, {opacity = 1} = {}) {
  return new THREE.MeshBasicMaterial({color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
}
