// Speaking indicators: a small glowing "sound waves" badge above any nearby
// player whose voice you can hear right now. Fades and pulses every frame from
// the presentation clock; speaking state itself updates at 10 Hz.
import * as THREE from 'three';

// Screen-space badge ~34 px tall at any distance (non-attenuated sprite scale is a fraction of view height).
const HEIGHT = 2.25, PIXELS = 34, FADE = 10;
function badgeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(28,36,52,.82)'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = '#ffd77a'; g.stroke();
  // Speech bubble mouth + three arcs, drawn bold so it reads at phone size.
  g.fillStyle = '#fff6dc'; g.beginPath(); g.arc(46, 64, 13, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff6dc'; g.lineCap = 'round';
  for (const [r, w] of [[24, 8], [38, 7], [52, 6]]) { g.lineWidth = w; g.beginPath(); g.arc(46, 64, r, -.62, .62); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createVoiceIndicators({scene}) {
  let texture = null; const badges = new Map();
  function badge(id) {
    let b = badges.get(id); if (b) return b;
    texture ??= badgeTexture();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture, transparent:true, depthWrite:false, depthTest:true, sizeAttenuation:false, opacity:0}));
    sprite.renderOrder = 20; sprite.visible = false; scene.add(sprite);
    b = {sprite, amount:0, phase:Math.random() * 6}; badges.set(id, b); return b;
  }
  /** speaking: Set of player ids; positionOf: id => actor root Vector3 or null; viewHeight: canvas CSS pixels. */
  function update(dt, time, speaking, positionOf, viewHeight = 720) {
    const size = PIXELS / (.718 * Math.max(240, viewHeight));
    const k = 1 - Math.exp(-FADE * Math.min(dt, .1));
    for (const id of speaking || []) badge(id);
    for (const [id, b] of badges) {
      const at = positionOf(id), target = at && speaking?.has(id) ? 1 : 0;
      b.amount += (target - b.amount) * k;
      if (!at || b.amount < .01) {
        b.sprite.visible = false;
        if (!target) { b.sprite.removeFromParent(); b.sprite.material.dispose(); badges.delete(id); }
        continue;
      }
      const pulse = 1 + .12 * Math.sin(time * 9 + b.phase) * b.amount;
      b.sprite.visible = true; b.sprite.material.opacity = b.amount;
      b.sprite.position.set(at.x, at.y + HEIGHT + .08 * Math.sin(time * 2.2 + b.phase), at.z);
      b.sprite.scale.setScalar(size * (.7 + .3 * b.amount) * pulse);
    }
  }
  function dispose() { for (const b of badges.values()) { b.sprite.removeFromParent(); b.sprite.material.dispose(); } badges.clear(); texture?.dispose(); texture = null; }
  return {update, dispose, count:() => badges.size};
}
