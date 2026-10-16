// Art-direction PREVIEW only (?palette=sunny). A brighter, more welcoming look for the whole world, used to mock up
// the direction in-engine before any asset is repainted. Presentation only; no extra lights, passes or textures.
import * as THREE from 'three';

export const PALETTE = (() => { try { return new URLSearchParams(globalThis.location?.search || '').get('palette') || ''; } catch { return ''; } })();
export const SUNNY = PALETTE === 'sunny';

// Sky/light keys for the day-night layer (same shape as its KEYS table): clear saturated blue sky, light blue
// aerial perspective on far hills, a stronger warm sun and a brighter cool sky fill so shadows read blue, not black.
export const SUNNY_KEYS = [
  {e: -1.0, sun: 0xa8bcff, hemiSky: 0x4c64b0, hemiGround: 0x1c1a2a, hemiI: .55, zenith: 0x0b1640, horizon: 0x26377a, haze: 0x223268, hill: 0x18234e, exposure: 1.42, env: .1, cloud: 0x3a4880},
  {e: -.32, sun: 0xa8bcff, hemiSky: 0x4c64b0, hemiGround: 0x1c1a2a, hemiI: .55, zenith: 0x0b1640, horizon: 0x26377a, haze: 0x223268, hill: 0x18234e, exposure: 1.42, env: .1, cloud: 0x3a4880},
  {e: -.12, sun: 0xb0b2f0, hemiSky: 0x6670c0, hemiGround: 0x2e2638, hemiI: .75, zenith: 0x1b2a6a, horizon: 0x8a6aa8, haze: 0x4a4a88, hill: 0x2c2c5e, exposure: 1.18, env: .14, cloud: 0x7a62a0},
  {e: .02, sun: 0xff9050, hemiSky: 0xa9a6e0, hemiGround: 0x6a4a3a, hemiI: .95, zenith: 0x4a62c0, horizon: 0xffa070, haze: 0xf4a88a, hill: 0x6c5a92, exposure: 1.1, env: .32, cloud: 0xffb08a},
  {e: .14, sun: 0xffc47c, hemiSky: 0xc4d8f6, hemiGround: 0x7c7038, hemiI: 1.15, zenith: 0x4a8ee0, horizon: 0xffd8a4, haze: 0xf0d6b4, hill: 0x6f8cb0, exposure: 1.06, env: .45, cloud: 0xfff0d8},
  {e: .36, sun: 0xffe2b0, hemiSky: 0xc4e2ff, hemiGround: 0x7e8a44, hemiI: 1.3, zenith: 0x3d8ef0, horizon: 0xcfeaf8, haze: 0xbddcf2, hill: 0x7aa0c4, exposure: 1.06, env: .55, cloud: 0xffffff},
  {e: .75, sun: 0xfff4dc, hemiSky: 0xc8e4ff, hemiGround: 0x7e8c46, hemiI: 1.4, zenith: 0x3a8cf2, horizon: 0xc6e6f8, haze: 0xb8daf2, hill: 0x80a6c8, exposure: 1.06, env: .6, cloud: 0xffffff},
  {e: 1.0, sun: 0xfff4dc, hemiSky: 0xc8e4ff, hemiGround: 0x7e8c46, hemiI: 1.4, zenith: 0x3a8cf2, horizon: 0xc6e6f8, haze: 0xb8daf2, hill: 0x80a6c8, exposure: 1.06, env: .6, cloud: 0xffffff},
];

// Per-material grade, folded into each lit material's own shader (a few ALU, no pass): a little more saturation and
// a soft lift so near-black surfaces read as painted dark colours instead of holes.
const GRADE = `{ vec3 gC = gl_FragColor.rgb; float gL = dot(gC, vec3(.2126, .7152, .0722));
  gC = max(mix(vec3(gL), gC, 1.28), 0.0);
  gC += vec3(.022, .028, .055) * (1.0 - smoothstep(0.0, .14, gL));
  gl_FragColor.rgb = gC; }
#include <tonemapping_fragment>`;
const DARK_LIFT = new THREE.Color(0x5d6a8a), hsl = {h: 0, s: 0, l: 0};

function gradeMaterial(m) {
  if (!m || m.userData.paletteGraded || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) return;
  m.userData.paletteGraded = true;
  const U = m.userData.orchardUniforms;
  if (U) { U.orchardDryTint.value.set(1.2, 1.36, .52); U.orchardLushTint.value.set(.78, 1.2, .6); U.orchardWornTint.value.set(1.32, 1.12, .72); }
  // Very dark stone/iron (gates, arches) becomes a cool slate so silhouettes stay friendly and readable.
  if (m.color && !m.map) { m.color.getHSL(hsl); if (hsl.l < .1 && (!m.emissive || m.emissive.getHex() === 0)) m.color.lerp(DARK_LIFT, .45); }
  else if (m.color && m.map && m.color.getHex() !== 0xffffff) { m.color.getHSL(hsl); if (hsl.l < .1) m.color.lerp(DARK_LIFT, .35); }
  // Home-base stone: the dark gate stone becomes warm sunlit limestone; slate roofs go a friendly cornflower blue.
  if (/^Basalt/.test(m.name || '') && m.color) m.color.multiply(new THREE.Color(3.4, 3.1, 2.7));
  if (/^Slate/.test(m.name || '') && m.color) m.color.multiply(new THREE.Color(1.6, 2.1, 3.2));
  if (/^Iron/.test(m.name || '') && m.color) m.color.multiply(new THREE.Color(1.8, 1.9, 2.3));
  const prior = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => { prior?.call(m, shader, renderer); shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', GRADE); };
  m.customProgramCacheKey = () => (key ? key.call(m) : '') + '|sunny';
  m.needsUpdate = true;
}

export function gradeScene(scene) {
  scene.traverse(o => { const m = o.material; if (Array.isArray(m)) m.forEach(gradeMaterial); else gradeMaterial(m); });
}

if (SUNNY && typeof document !== 'undefined') document.documentElement.classList.add('palette-sunny');

// HUD: the same layout and icons, re-inked from soot-and-leather to a bright twilight blue glass with sunny accents.
const SUNNY_CSS = `html.palette-sunny{--bf-soot:#16223f;--bf-ink:rgba(24,40,78,.74);--bf-ink-2:rgba(32,54,102,.84);--bf-parch:#fbfaf6;--bf-parch-dim:#cbd8ee;
--bf-ember:#ff9a2e;--bf-ember-hot:#ffc24a;--bf-gold:#ffc857;--bf-gold-hi:#ffe28a;--bf-moss:#7ee08a;--bf-frost:#5ad6f2;--bf-blood:#ff6b6b;--bf-line:rgba(255,255,255,.3);
--bf-ink-solid:#1c2f5c;--bf-edge:rgba(255,255,255,.38);--bf-text:#fbfaf6;--bf-dim:#c4d3ec;--bf-mana:#5ad6f2;
--charcoal:#16223f;--forest:#14305a;--card:rgba(26,44,86,.84);--line:rgba(255,255,255,.26);--brass:#ffc857;--brass-hi:#ffe08a;--brass-lo:#d08a2a;
--ember:#ff8a2a;--ember-hi:#ffb547;--parchment:#fbfaf6;--text:#fbfaf6;--muted:#c8d6ee;--heal:#7ee08a;--mana:#5ad6f2;
--mq-glass:rgba(24,42,84,.5);--mq-glass-solid:rgba(26,44,86,.92)}
html.palette-sunny .bf-chip{background:linear-gradient(180deg,rgba(66,104,180,.9),rgba(26,44,86,.82))!important}`;
if (SUNNY && typeof document !== 'undefined') { const s = document.createElement('style'); s.textContent = SUNNY_CSS; document.head.append(s); }
