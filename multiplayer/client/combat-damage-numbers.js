import * as THREE from 'three';

// Optional and off by default. A tiny capped sprite pool gives a readable
// result without attaching a permanent UI widget to every creature.
export function createCombatDamageNumbers(scene) {
  const active = [], cap = 12;
  let enabled = false;
  const canvas = () => {
    if (typeof document !== 'undefined') return document.createElement('canvas');
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(128, 64);
    return null;
  };
  function destroy(item) {
    item.sprite.removeFromParent();
    item.sprite.material.map?.dispose();
    item.sprite.material.dispose();
    const index = active.indexOf(item);
    if (index >= 0) active.splice(index, 1);
  }
  function paint(item) {
    const c = item.canvas, context = c.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, c.width, c.height);
    const strong = item.kind === 'strong', weak = item.kind === 'weak';
    const color = item.kind === 'hero' ? '#ff9c8a' : weak ? '#9ab9bc' : strong ? '#ffe7a6' : '#f4eee0';
    context.font = `${strong ? 700 : 600} ${strong ? 33 : 29}px system-ui, sans-serif`;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.shadowColor = '#080d11'; context.shadowBlur = 5;
    context.lineWidth = 4; context.strokeStyle = 'rgba(8, 13, 17, .8)';
    const value = String(Math.max(1, Math.round(item.damage)));
    context.strokeText(value, 64, 31); context.fillStyle = color; context.fillText(value, 64, 31);
    item.sprite.material.map.needsUpdate = true;
  }
  function note(event) {
    if (!enabled || !event || !['hit', 'headshot'].includes(event.kind) || !Array.isArray(event.position)) return false;
    const amount = Number(event.damage);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    // A struck Hero (another player) shows a rose number over the head instead of at the feet.
    const kind = event.hero ? 'hero' : event.resisted ? 'weak' : event.kind === 'headshot' || amount >= 55 ? 'strong' : 'normal';
    const recent = active.find(item => item.id === event.id && item.kind === kind && item.age < .12);
    if (recent) {recent.damage += amount; recent.age = 0; paint(recent); return true;}
    const c = canvas(); if (!c) return false;
    c.width = 128; c.height = 64;
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({map:texture, transparent:true, depthWrite:false, depthTest:false, opacity:.95});
    const sprite = new THREE.Sprite(material);
    sprite.position.fromArray(event.position);
    sprite.position.y += kind === 'hero' ? 2.05 : kind === 'strong' ? .23 : .13;
    const width = kind === 'strong' ? .45 : .37;
    sprite.scale.set(width, width * .5, 1);
    sprite.renderOrder = 50;
    scene.add(sprite);
    const item = {id:event.id,kind,damage:amount,age:0,sprite,canvas,origin:sprite.position.clone()};
    active.push(item); paint(item);
    if (active.length > cap) destroy(active[0]);
    return true;
  }
  function tick(dt) {
    for (const item of [...active]) {
      item.age += Math.max(0, dt);
      if (item.age >= .7) {destroy(item); continue;}
      const t = item.age / .7;
      item.sprite.position.copy(item.origin).add(new THREE.Vector3(0, .37 * (1 - (1 - t) * (1 - t)), 0));
      item.sprite.material.opacity = .95 * Math.min(1, (1 - t) * 2.3);
    }
  }
  function setEnabled(value) {
    enabled = !!value;
    if (!enabled) for (const item of [...active]) destroy(item);
    return enabled;
  }
  return {note,tick,setEnabled,dispose:()=>setEnabled(false),stats:()=>({enabled,active:active.length})};
}
