// Hides shot apples on the instanced Orchard apple trees (shared/fruit.js `fruit.missing`).
// The apple tree's Fruit geometry gets a per-vertex `appleSlot` (1-based, matched to shared APPLE_SLOTS by nearest
// centre), and the fruit shader (tree-materials.js) reads one RGBA8 texel per instance: 32 bits, one per apple.
// Only the intact instanced batch is masked; a promoted (wounded) tree shows its authored fruit.
import * as T from 'three';
import {APPLE_SLOTS,APPLE_VARIANT} from '../shared/fruit.js';
import {VARIANTS} from '../shared/trees.js';
import {FRUIT_MASK} from './tree-materials.js';

const WIDTH = 64;
/** Clone of the apple tree's Fruit geometry with `appleSlot` per vertex. Geometry is in Tree-root space. */
export function tagAppleSlots(geometry, matrix = null) {
 const g = geometry.clone(), p = g.attributes.position, slot = new Float32Array(p.count), v = new T.Vector3();
 for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (matrix) v.applyMatrix4(matrix); let best = 0, d = Infinity;
  for (let k = 0; k < APPLE_SLOTS.length; k++) { const a = APPLE_SLOTS[k], e = (v.x - a[0])**2 + (v.y - a[1])**2 + (v.z - a[2])**2; if (e < d) { d = e; best = k; } }
  slot[i] = d < .04 ? best + 1 : 0; }
 g.setAttribute('appleSlot', new T.BufferAttribute(slot, 1)); g.userData.appleSlots = true; return g;
}
export function createFruitMask() {
 let batches = null, data = new Uint8Array(WIDTH*4), texture = null, bits = new Map(), uploads = 0, masked = 0;
 const key = VARIANTS[APPLE_VARIANT] + ':full';
 function ensure(capacity) {
  const rows = Math.max(1, Math.ceil(capacity/WIDTH)); if (texture && texture.image.height === rows) return;
  texture?.dispose(); data = new Uint8Array(WIDTH*rows*4); texture = new T.DataTexture(data, WIDTH, rows, T.RGBAFormat, T.UnsignedByteType);
  texture.magFilter = texture.minFilter = T.NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true; FRUIT_MASK.texture.value = texture;
 }
 return {
  attach(treeView) { batches = treeView?.batches || null; },
  sync(s) { bits = new Map(); for (const m of s.fruit?.missing || []) bits.set(m.tree, (bits.get(m.tree) || 0) | (1 << m.slot)); masked = (s.fruit?.missing || []).length; },
  flush() {
   const b = batches?.batches?.().find(x => x.key === key); if (!b) { FRUIT_MASK.enabled.value = 0; return; }
   ensure(b.capacity); let changed = false;
   for (let i = 0; i < b.ids.length; i++) { const m = bits.get(b.ids[i]) || 0, o = i*4;
    for (let k = 0; k < 4; k++) { const byte = (m >>> (k*8)) & 255; if (data[o + k] !== byte) { data[o + k] = byte; changed = true; } } }
   if (changed) { texture.needsUpdate = true; uploads++; }
   FRUIT_MASK.enabled.value = bits.size ? 1 : 0;
  },
  stats: () => ({missing: masked, trees: bits.size, uploads}),
  dispose() { texture?.dispose(); texture = null; FRUIT_MASK.texture.value = null; FRUIT_MASK.enabled.value = 0; },
 };
}
