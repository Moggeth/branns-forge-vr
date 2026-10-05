import * as THREE from 'three';

// Golden bolt marksman's rune: the moment a golden Siegebird bolt leaves the rail, a crisp golden magic circle snaps
// open at the eagle's beak, square to the shot, and the bolt flies through its centre. Two counter-turning layers:
// an outer band of rune staves and scope ticks, and an inner eagle sigil (spread wing fans, crest, tail) round a
// reticle that clicks into lock as it opens. A smaller echo circle a hand ahead makes a short tunnel, a ring of
// light rolls outward, and it all fades within about a second.
// Presentation only, in the crossbow's native frame (X right, Y forward along the bolt, Z up). Textures are drawn
// once per session on first use; each crossbow lazily owns five additive planes, drawn only during the flash.

export const RUNE = Object.freeze({life: .95, hold: .32, open: .075, lock: .13, centre: [0, 1.135, .179], size: .30, echo: {ahead: .16, size: .17, delay: .045}});

const TAU = Math.PI * 2;
const INK = '#ffeab0', GLOW = 'rgba(255,166,28,.95)';
let textures = null; // {band, sigil} | false (no DOM)

function seeded(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }

// Draw twice: a soft gold bloom underneath, then the crisp ink on top.
function inked(g, draw, blur = 10) {
  g.save(); g.shadowColor = GLOW; g.shadowBlur = blur; g.strokeStyle = GLOW; g.fillStyle = GLOW; draw(g); g.restore();
  g.save(); g.strokeStyle = INK; g.fillStyle = INK; draw(g); g.restore();
}
const ring = (g, r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); };

// Leaf-shaped feather from radius r0 to r1 along angle a, half width w at its widest, with a quill line.
function feather(g, a, r0, r1, w) {
  const c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c, at = (r, k) => [c * r + nx * k, s * r + ny * k];
  const m = r0 + (r1 - r0) * .42;
  g.beginPath(); g.moveTo(...at(r0, 0));
  g.quadraticCurveTo(...at(m, w * 1.25), ...at(r1, 0));
  g.quadraticCurveTo(...at(m, -w * 1.25), ...at(r0, 0)); g.closePath();
  g.globalAlpha = .22; g.fill(); g.globalAlpha = 1; g.lineWidth = 2.4; g.stroke();
  g.lineWidth = 1.4; g.beginPath(); g.moveTo(...at(r0 + 4, 0)); g.lineTo(...at(r1 - 8, 0)); g.stroke();
}

function bandTexture(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); if (!g) return null;
  const k = size / 512; g.translate(size / 2, size / 2); g.scale(k, k); g.lineCap = 'round'; g.lineJoin = 'round';
  inked(g, g => {
    ring(g, 247, 2); ring(g, 237, 5); ring(g, 199, 3); ring(g, 186, 1.5);
    // Rune staves between the rings: a stave with elvish branches, seeded so every peer draws the same circle.
    const rnd = seeded(0x51e9eb1d), n = 28;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, c = Math.cos(a), s = Math.sin(a), px = -s, py = c, P = (r, t) => [c * r + px * t, s * r + py * t];
      g.lineWidth = 2.6; g.beginPath(); g.moveTo(...P(206, 0)); g.lineTo(...P(229, 0)); g.stroke();
      const kind = Math.floor(rnd() * 5), side = rnd() < .5 ? 1 : -1; g.lineWidth = 2.1; g.beginPath();
      if (kind === 0) { g.moveTo(...P(225, 0)); g.lineTo(...P(219, 6 * side)); g.moveTo(...P(214, 0)); g.lineTo(...P(208, 6 * side)); }
      else if (kind === 1) { g.moveTo(...P(226, -6)); g.lineTo(...P(220, 0)); g.lineTo(...P(226, 6)); }
      else if (kind === 2) { g.moveTo(...P(218, 0)); g.lineTo(...P(224, 6 * side)); g.lineTo(...P(212, 6 * side)); }
      else if (kind === 3) { g.moveTo(...P(222, -5)); g.lineTo(...P(212, 5)); g.moveTo(...P(222, 5)); g.lineTo(...P(212, -5)); }
      else { g.arc(...P(217, 5 * side), 3, 0, TAU); }
      g.stroke();
      // a dot between staves
      const b = (i + .5) / n * TAU; g.beginPath(); g.arc(Math.cos(b) * 218, Math.sin(b) * 218, 1.8, 0, TAU); g.fill();
    }
    // Scope ticks inside the band: every 7.5 degrees, long at the cardinals, a small diamond on each diagonal.
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * TAU, long = i % 12 === 0, mid = i % 6 === 0, r0 = long ? 160 : mid ? 172 : 178;
      g.lineWidth = long ? 3 : 1.6; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * 184, Math.sin(a) * 184); g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const a = TAU / 8 + i * TAU / 4, c = Math.cos(a), s = Math.sin(a), r = 242;
      g.beginPath(); g.moveTo(c * (r - 9), s * (r - 9)); g.lineTo(c * r - s * 6, s * r + c * 6); g.lineTo(c * (r + 9), s * (r + 9)); g.lineTo(c * r + s * 6, s * r - c * 6); g.closePath(); g.fill();
    }
  }, 12);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function sigilTexture(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); if (!g) return null;
  const k = size / 512; g.translate(size / 2, size / 2); g.scale(k, -k); g.lineCap = 'round'; g.lineJoin = 'round'; // y up
  inked(g, g => {
    ring(g, 158, 3.5); ring(g, 58, 3); ring(g, 50, 1.2);
    // Spread wings: six feathers a side fanning from level to high, longest at the leading edge.
    for (let i = 0; i < 6; i++) {
      const a = (-34 + i * 13) * Math.PI / 180, r1 = 150 - Math.abs(i - 3.4) * 7, w = 11.5 - i * .5;
      feather(g, a, 66, r1, w); feather(g, Math.PI - a, 66, r1, w);
    }
    // Tail: three feathers straight down.
    for (const d of [-14, 0, 14]) feather(g, (-90 + d) * Math.PI / 180, 66, d ? 128 : 142, 9);
    // Crest: a sharp beaked head rising through the top, facing the shot.
    g.lineWidth = 2.6; g.beginPath();
    g.moveTo(-15, 62); g.quadraticCurveTo(-24, 98, -10, 122); g.quadraticCurveTo(0, 140, 8, 150);
    g.quadraticCurveTo(26, 146, 30, 128); g.lineTo(22, 122); g.quadraticCurveTo(18, 116, 12, 116);
    g.quadraticCurveTo(20, 92, 15, 62); g.closePath(); g.globalAlpha = .22; g.fill(); g.globalAlpha = 1; g.stroke();
    g.beginPath(); g.moveTo(-4, 128); g.lineTo(8, 131); g.lineTo(1, 124); g.closePath(); g.fill(); // the eye
    // Reticle: four slim feather-chevrons pointing in at the bolt's path, and a hairline cross through the centre gap.
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + TAU / 8, c = Math.cos(a), s = Math.sin(a), px = -s, py = c;
      g.lineWidth = 2.4; g.beginPath(); g.moveTo(c * 76 + px * 9, s * 76 + py * 9); g.lineTo(c * 62, s * 62); g.lineTo(c * 76 - px * 9, s * 76 - py * 9); g.stroke();
    }
    g.lineWidth = 1.2; g.beginPath();
    for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { g.moveTo(x * 16, y * 16); g.lineTo(x * 44, y * 44); }
    g.stroke();
  }, 10);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function shockTexture(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); if (!g) return null;
  const k = size / 256; g.translate(size / 2, size / 2); g.scale(k, k);
  inked(g, g => { ring(g, 122, 2.5); ring(g, 114, 1); }, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function runeTextures() {
  if (textures === null) {
    if (typeof document === 'undefined') textures = false;
    else { const band = bandTexture(512), sigil = sigilTexture(512), shock = shockTexture(256); textures = band && sigil && shock ? {band, sigil, shock} : false; }
  }
  return textures || null;
}

const easeOutBack = u => { const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };

// One rune rig per crossbow, parented to the flock's native-frame group. glowTexture: the flock's soft glow sprite map.
export function createSiegebirdRune(parent, {glowTexture = null} = {}) {
  const tex = runeTextures(); if (!tex) return null;
  const root = new THREE.Group(); root.name = 'SiegebirdRune'; root.visible = false;
  root.position.fromArray(RUNE.centre); root.rotation.x = Math.PI / 2; // plane square to the bolt (+Y)
  const plane = new THREE.PlaneGeometry(1, 1);
  const mat = (map, color, extra = {}) => new THREE.MeshBasicMaterial({map, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false, ...extra});
  const quad = (map, color, name) => { const m = new THREE.Mesh(plane, mat(map, color)); m.name = name; m.renderOrder = 8; m.userData.ignoreContact = true; m.frustumCulled = false; root.add(m); return m; };
  const band = quad(tex.band, 0xffc957, 'SiegebirdRuneBand'), sigil = quad(tex.sigil, 0xffdc86, 'SiegebirdRuneSigil');
  const echo = quad(tex.band, 0xffb43c, 'SiegebirdRuneEcho'); echo.position.z = -RUNE.echo.ahead; // rotated frame: -Z is native +Y
  const wave = quad(tex.shock, 0xffd070, 'SiegebirdRuneWave');
  const flash = glowTexture ? quad(glowTexture, 0xfff6dc, 'SiegebirdRuneFlash') : null;
  parent.add(root);
  let at = -1, spin = 0, pending = false;

  // The flash starts on the next update so it shares the flock's presentation clock.
  function fire() { pending = true; spin = Math.random() * TAU; root.visible = true; }
  function update(time) {
    if (!root.visible) return;
    if (pending) { pending = false; at = time; }
    const t = time - at;
    if (t < 0 || t > RUNE.life) { root.visible = false; return; }
    const open = Math.min(1, t / RUNE.open), fade = t < RUNE.hold ? 1 : Math.max(0, 1 - (t - RUNE.hold) / (RUNE.life - RUNE.hold)) ** 1.6;
    const s = RUNE.size * (.55 + .45 * easeOutBack(open)) * (1 + .06 * t);
    band.scale.setScalar(s); band.rotation.z = spin + t * .55; band.material.opacity = Math.min(1, open * 1.6) * fade;
    // The sigil turns in against the band and clicks to lock (crest up) as the circle opens.
    const lock = Math.min(1, t / RUNE.lock), settle = (1 - lock) ** 3;
    sigil.scale.setScalar(s * (1 + .12 * settle)); sigil.rotation.z = -.7 * settle - t * .08; sigil.material.opacity = Math.min(1, open * 1.4) * fade;
    const e = Math.max(0, t - RUNE.echo.delay), eo = Math.min(1, e / RUNE.open);
    echo.scale.setScalar(RUNE.echo.size * (.5 + .5 * easeOutBack(eo)) * (1 + .1 * e)); echo.rotation.z = -spin - e * .9; echo.material.opacity = (e > 0 ? Math.min(1, eo * 1.5) : 0) * fade * .8;
    { const w = Math.min(1, t / .34); wave.scale.setScalar(RUNE.size * (1.0 + .9 * (1 - (1 - w) ** 3))); wave.material.opacity = (1 - w) ** 1.5 * .9; }
    if (flash) { const f = Math.min(1, t / .1); flash.scale.setScalar(RUNE.size * (.18 + .14 * f)); flash.material.opacity = (1 - f) ** 2 * .8; }
  }
  function dispose() { root.removeFromParent(); plane.dispose(); for (const c of root.children) c.material.dispose(); }
  return {root, fire, update, dispose, get active() { return root.visible; }};
}
