// Compile gate. The first time a material is drawn, three.js builds its shader program right there in the frame and
// then blocks the main thread until the driver has finished linking it: a 30-70 ms freeze the first time a Voltnewt,
// a crystal or a new weapon trim comes into view. Startup warms everything it knows about, but streamed creatures,
// Great Wilds places and late spell effects still met the compiler mid-play.
//
// With the gate on, a draw whose material has no finished program is skipped for that frame instead. After the frame
// the gate hands those objects to the parallel compiler (KHR_parallel_shader_compile), and the object starts drawing
// on the first frame its program is ready. The world keeps moving; at worst that one new thing appears a few frames
// late, once per material per session. Shadow and full-screen passes (drawn with no scene) are never gated.
export const COMPILE_GATE = Object.freeze({maxWaitMs: 1500, maxPerFrame: 48});

export function createCompileGate({renderer, scene, compile}) {
  const properties = renderer.properties, ready = new WeakSet(), waiting = new Map(), firstSkip = new WeakMap();
  const queued = new Set(), stats = {skipped: 0, compiled: 0, released: 0, timeouts: 0};
  let active = false;
  const original = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function(camera, drawScene, geometry, material, object, group) {
    if (!active || drawScene !== scene || ready.has(material)) return original.call(this, camera, drawScene, geometry, material, object, group);
    const now = performance.now(), program = properties.get(material).currentProgram, since = waiting.get(material);
    if (program !== undefined && (since === undefined || program.isReady())) { ready.add(material); if (since !== undefined) { waiting.delete(material); stats.released++; } return original.call(this, camera, drawScene, geometry, material, object, group); }
    // Never hold anything back for long: a material that never readies, or an object that keeps getting new
    // materials, draws (and compiles the old way) after maxWaitMs.
    let run = firstSkip.get(object); if (!run || now - run[1] > 250) firstSkip.set(object, run = [now, now]); else run[1] = now; // a run of consecutive skips
    if ((since !== undefined && now - since > COMPILE_GATE.maxWaitMs) || now - run[0] > COMPILE_GATE.maxWaitMs) { ready.add(material); waiting.delete(material); stats.timeouts++; return original.call(this, camera, drawScene, geometry, material, object, group); }
    if (since === undefined) waiting.set(material, now);
    if (program === undefined && queued.size < COMPILE_GATE.maxPerFrame) queued.add(object);
    stats.skipped++;
  };
  // compile() only needs traverse/traverseVisible from its root, so one call covers every object queued this frame
  // (each call walks the whole scene for lights, so batching matters).
  const batch = {isObject3D: true, traverse(cb) { for (const o of queued) cb(o); }, traverseVisible() {}};
  function flush(camera) {
    if (!queued.size) return;
    try { compile(batch, camera, scene); stats.compiled += queued.size; }
    catch { for (const o of queued) { const m = o.material; for (const x of Array.isArray(m) ? m : [m]) if (x) { ready.add(x); waiting.delete(x); } } }
    queued.clear();
  }
  return {
    flush, setActive(on) { active = !!on; },
    stats: () => ({...stats, waiting: waiting.size, active}),
    dispose() { renderer.renderBufferDirect = original; },
  };
}
