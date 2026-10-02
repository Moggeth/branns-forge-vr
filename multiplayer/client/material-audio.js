// Spatial material-impact audio (stone / metal / bone / hammer fracture / ore reward) for the existing
// combat + mining events. Same conventions as wood-audio.js: one AudioContext owned by the game, a bounded
// voice pool (<=12 here; wood keeps its own 16), deterministic per-event variation, no polling, no physics.
// It consumes only what the authoritative events already carry: kind, material, energy, normal, position,
// id, part, impact. Unknown materials return [] so the caller's legacy path still runs.
//
//   const mat = createMaterialAudio({context: audioContext, baseUrl: '/assets/material-audio/'});
//   mat.unlock();                                   // inside the existing user-gesture unlock path
//   if (mat.handles(event)) mat.play(event, listener, snapshot.tick); else legacyBeep(event);
//   mat.tick(listener);                             // once per frame: listener pose + safety reaping
//   mat.dispose();

export const MATERIAL_SOUNDS = Object.freeze({
 // files (variants), priority (higher survives stealing), cap (same-sound instances), duration s, rate jitter,
 // cull m (beyond this no nodes are created), cooldown s (global minimum spacing for this sound)
 pick_stone:     {files: ['pick_stone_a', 'pick_stone_b', 'pick_stone_c'], priority: 5, cap: 4, duration: .46, rate: .05, cull: 35, cooldown: .02},
 bone_crack:     {files: ['bone_crack_a', 'bone_crack_b', 'bone_crack_c'], priority: 5, cap: 4, duration: .38, rate: .06, cull: 35, cooldown: .015},
 metal_ricochet: {files: ['metal_ricochet_a', 'metal_ricochet_b', 'metal_ricochet_c'], priority: 6, cap: 2, duration: .95, rate: .04, cull: 45, cooldown: .03},
 stone_fracture: {files: ['stone_fracture_a', 'stone_fracture_b'], priority: 8, cap: 2, duration: 1.3, rate: .04, cull: 60, cooldown: .05},
 ore_break:      {files: ['ore_break_a', 'ore_break_b'], priority: 9, cap: 2, duration: 1.1, rate: .03, cull: 50, cooldown: 0}
});
export const MATERIAL_EVENT_KINDS = Object.freeze(['hit', 'headshot', 'stone_hit', 'ore_break', 'armor_break', 'embed', 'hammer_slam']);
export const VOICE_CEILING = 12;
const SAME_SOURCE_COOLDOWN = .045; // s: same sound on the same id (duplicate packet / multi-contact flam)

/** FNV-1a -> [0,1). Identical to wood-audio.js so both kits vary the same way on every client. */
export function hash01(text) {
 let h = 0x811c9dc5;
 for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
 h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
 return (h >>> 0) / 4294967296;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const finite3 = v => Array.isArray(v) && v.length >= 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
/** Contact energy exactly as the impact visuals read it (combat.js: 1, hammer 1.8), clamped like impact-presentation. */
export const energyOf = event => (Number.isFinite(event?.energy) ? clamp(event.energy, .2, 2) : 1);
/** Same material inference as game.js handleEvent, so sound and chips always agree. */
export function materialOf(event) {
 const k = event?.kind;
 return event?.material || (k === 'wood_hit' ? 'wood' : k === 'stone_hit' || k === 'ore_break' ? 'stone' : event?.id === 'shrine' ? 'metal' : 'bone');
}

/**
 * Pure mapping from an existing event to sound layers. [] = not ours (wood, unknown material, enemy embeds
 * that already produced a hit event). layer: {sound, gain linear, rateBase}
 */
export function materialLayersFor(event) {
 const k = event?.kind;
 if (!MATERIAL_EVENT_KINDS.includes(k)) return [];
 const material = materialOf(event), e = energyOf(event);
 if (k === 'ore_break') return [{sound: 'ore_break', gain: 1, rateBase: 1}];
 if (k === 'hammer_slam') return [{sound: 'stone_fracture', gain: 1, rateBase: .92}];
 if (k === 'armor_break') return [{sound: 'stone_fracture', gain: .7, rateBase: 1.18}]; // golem plate; its hit event adds the bite
 if (k === 'stone_hit') return [{sound: 'pick_stone', gain: 1, rateBase: 1}];
 if (k === 'embed') { // world-surface arrow/bolt only: enemy embeds already arrive as hit/headshot
  if (!event.impact) return [];
  if (material === 'stone') return [{sound: 'pick_stone', gain: .5, rateBase: 1.2}];
  if (material === 'bone') return [{sound: 'bone_crack', gain: .55, rateBase: 1.12}];
  if (material === 'metal') return [{sound: 'metal_ricochet', gain: .6, rateBase: 1.05}];
  return [];
 }
 // hit / headshot
 if (material === 'stone') return e >= 1.5 ? [{sound: 'stone_fracture', gain: .85, rateBase: 1}] : [{sound: 'pick_stone', gain: 1, rateBase: 1}];
 if (material === 'bone') return [{sound: 'bone_crack', gain: k === 'headshot' ? 1.15 : 1, rateBase: k === 'headshot' ? 1.05 : 1}];
 if (material === 'metal') return [{sound: 'metal_ricochet', gain: 1, rateBase: 1}];
 return [];
}

/** Energy -> linear gain and a small pitch drop for heavier contacts (heavier = lower, not just louder). */
export function energyShape(e) { return {gain: clamp(.4 + .6 * e, .45, 1.35), rate: clamp(1 - .05 * (e - 1), .95, 1.04)}; }

function setParam(param, value, node, setter) { if (param) param.value = value; else node?.[setter]?.(value); }

export function createMaterialAudio({context, destination = context?.destination, baseUrl = '/assets/material-audio/', ext = 'wav',
 fetchImpl = globalThis.fetch?.bind(globalThis), maxVoices = VOICE_CEILING, releaseSlots = 2, refDistance = 2, rolloff = 1.15,
 masterGain = .7, panningModel = 'equalpower', driveListener = false, airAbsorption = true, surfaceOffset = .04} = {}) {
 if (!context?.createBufferSource) throw new Error('createMaterialAudio needs the game\'s existing AudioContext');
 const hardCap = clamp(Math.floor(maxVoices), 2, VOICE_CEILING), audible = Math.max(1, hardCap - releaseSlots);
 const master = context.createGain(); master.gain.value = masterGain; master.connect(destination);
 const buffers = new Map(), voices = new Set(), recent = new Map(), lastBySound = new Map();
 const stats = {started: 0, ended: 0, stolen: 0, culled: 0, dropped: 0, cooldown: 0, loading: 0, occluded: 0, peakVoices: 0};
 let disposed = false, unlocked = false, listenerPos = [0, 0, 0], loadPromise = null;

 function decode(bytes) { // promise and legacy-callback Safari forms
  return new Promise((resolve, reject) => { const p = context.decodeAudioData(bytes, resolve, reject); if (p?.then) p.then(resolve, reject); });
 }
 function load() {
  if (loadPromise) return loadPromise;
  const files = [...new Set(Object.values(MATERIAL_SOUNDS).flatMap(s => s.files))];
  loadPromise = Promise.all(files.map(async f => {
   try { const r = await fetchImpl(`${baseUrl}${f}.${ext}`); if (!r.ok) throw Error(`${f}: ${r.status}`); const b = await decode(await r.arrayBuffer()); if (!disposed) buffers.set(f, b); return true; }
   catch { return false; }
  })).then(ok => ({loaded: ok.filter(Boolean).length, total: files.length}));
  return loadPromise;
 }

 /** Call inside the existing user-gesture handler (after the wood kit's unlock is fine: priming is idempotent). */
 function unlock() {
  if (disposed) return;
  if (context.state === 'suspended') context.resume?.().catch?.(() => {});
  if (!unlocked) { try { const b = context.createBuffer(1, 1, context.sampleRate || 44100), s = context.createBufferSource(); s.buffer = b; s.connect(master); s.start(0); s.onended = () => s.disconnect(); unlocked = true; } catch {} }
  load();
 }

 function cleanup(v) {
  if (v.dead) return; v.dead = true; voices.delete(v); stats.ended++;
  try { v.source.onended = null; v.source.disconnect(); v.gain.disconnect(); v.filter?.disconnect(); v.panner.disconnect(); } catch {}
 }
 function release(v, hard = false) {
  if (v.releasing && !hard) return; const now = context.currentTime;
  if (hard) { try { v.source.stop(); } catch {} cleanup(v); return; }
  v.releasing = true; stats.stolen++;
  try { v.gain.gain.cancelScheduledValues?.(now); v.gain.gain.setTargetAtTime(0, now, .006); v.source.stop(now + .035); } catch { cleanup(v); }
 }
 const live = () => [...voices].filter(v => !v.releasing);
 function makeRoom(sound, priority) {
  const same = live().filter(v => v.sound === sound);
  if (same.length >= MATERIAL_SOUNDS[sound].cap) release(same.sort((a, b) => a.startAt - b.startAt)[0]);
  const candidates = live();
  if (candidates.length >= audible) {
   const victim = candidates.sort((a, b) => a.priority - b.priority || a.startAt - b.startAt)[0];
   if (victim.priority > priority) return false; // everything playing matters more: drop the new one
   release(victim);
  }
  while (voices.size >= hardCap) { // release slots exhausted by a burst: finish the oldest fade now
   const r = [...voices].filter(v => v.releasing).sort((a, b) => a.startAt - b.startAt)[0];
   if (!r) return false; release(r, true);
  }
  return true;
 }

 function startLayer(layer, event, position, distance, occluded, seedBase, salt) {
  const def = MATERIAL_SOUNDS[layer.sound], seed = `${seedBase}|${salt}`, now = context.currentTime;
  const file = def.files[Math.floor(hash01(seed + '|v') * def.files.length)], buffer = buffers.get(file);
  if (!buffer) { stats.loading++; return null; }
  const key = `${layer.sound}|${event.id ?? ''}`;
  if (now - (recent.get(key) ?? -1) < SAME_SOURCE_COOLDOWN || now - (lastBySound.get(layer.sound) ?? -1) < def.cooldown) { stats.cooldown++; return null; }
  if (!makeRoom(layer.sound, def.priority)) { stats.dropped++; return null; }
  recent.set(key, now); lastBySound.set(layer.sound, now); if (recent.size > 128) recent.delete(recent.keys().next().value);
  const shape = energyShape(energyOf(event));
  const rate = layer.rateBase * shape.rate * (1 + def.rate * (2 * hash01(seed + '|r') - 1));
  const gainDb = 3 * hash01(seed + '|g') - 1.5;
  const duration = buffer.duration ?? def.duration;
  const source = context.createBufferSource(), gain = context.createGain(), panner = context.createPanner();
  source.buffer = buffer; setParam(source.playbackRate, rate, source, null);
  gain.gain.value = layer.gain * shape.gain * (occluded ? .7 : 1) * 10 ** (gainDb / 20);
  Object.assign(panner, {panningModel, distanceModel: 'inverse', refDistance, maxDistance: def.cull, rolloffFactor: rolloff});
  if (panner.positionX) { panner.positionX.value = position[0]; panner.positionY.value = position[1]; panner.positionZ.value = position[2]; }
  else panner.setPosition?.(...position);
  // One lowpass covers both air absorption (distant hits lose their edge) and the far side of the struck surface.
  let cutoff = airAbsorption && distance > 8 ? Math.max(2400, 16000 / (1 + (distance - 8) / 10)) : 0;
  if (occluded) cutoff = cutoff ? Math.min(cutoff, 1800) : 1800;
  let filter = null;
  if (cutoff && context.createBiquadFilter) {
   filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
   source.connect(gain).connect(filter).connect(panner).connect(master);
  } else source.connect(gain).connect(panner).connect(master);
  const v = {source, gain, panner, filter, sound: layer.sound, priority: def.priority, startAt: now, endAt: now + duration / rate, releasing: false, dead: false};
  source.onended = () => cleanup(v);
  source.start(now);
  voices.add(v); stats.started++; stats.peakVoices = Math.max(stats.peakVoices, voices.size);
  return v;
 }

 /** True when this kit owns the event's sound (the caller should then skip its legacy oscillator). */
 function handles(event) { return materialLayersFor(event).length > 0; }

 /**
  * Play an existing combat/mining event. listener (optional): {position, forward?, up?}. tick (optional):
  * the snapshot tick, used only as variation seed when the event has none (keeps clients in agreement).
  */
 function play(event, listener, tick) {
  if (disposed || !event) return [];
  if (listener) setListener(listener);
  const layers = materialLayersFor(event);
  if (!layers.length || !finite3(event.position)) return [];
  const p = event.position, n = finite3(event.normal) ? event.normal : null, nl = n ? Math.hypot(n[0], n[1], n[2]) : 0;
  // Emit from just outside the struck face (normal), so the panner is not inside the rock/armour.
  const position = nl > 1e-6 ? [p[0] + n[0] / nl * surfaceOffset, p[1] + n[1] / nl * surfaceOffset, p[2] + n[2] / nl * surfaceOffset] : [p[0], p[1], p[2]];
  const dx = listenerPos[0] - position[0], dy = listenerPos[1] - position[1], dz = listenerPos[2] - position[2], d = Math.hypot(dx, dy, dz);
  const reach = Math.max(...layers.map(l => MATERIAL_SOUNDS[l.sound].cull));
  if (d > reach) { stats.culled += layers.length; return []; } // inaudible: no nodes at all
  // Listener clearly behind the struck surface (e.g. the far side of a boulder): muffle, do not fake geometry.
  const occluded = nl > 1e-6 && d > 1 && (dx * n[0] + dy * n[1] + dz * n[2]) / nl < -.35 * d;
  if (occluded) stats.occluded++;
  const seedBase = `${event.kind}|${event.id ?? ''}|${event.part ?? ''}|${event.tick ?? tick ?? ''}|${p.map(q => Math.round(q * 100)).join(',')}`;
  return layers.filter(l => d <= MATERIAL_SOUNDS[l.sound].cull || ((stats.culled++), false))
   .map((l, i) => startLayer(l, event, position, d, occluded, seedBase, i)).filter(Boolean);
 }

 /** Listener pose. driveListener defaults to false because the wood kit already drives context.listener. */
 function setListener({position, forward, up} = {}) {
  if (finite3(position)) listenerPos = [position[0], position[1], position[2]];
  if (!driveListener) return;
  const L = context.listener; if (!L) return;
  if (L.positionX) { L.positionX.value = listenerPos[0]; L.positionY.value = listenerPos[1]; L.positionZ.value = listenerPos[2]; }
  else L.setPosition?.(...listenerPos);
  if (finite3(forward)) {
   const u = finite3(up) ? up : [0, 1, 0];
   if (L.forwardX) { L.forwardX.value = forward[0]; L.forwardY.value = forward[1]; L.forwardZ.value = forward[2]; L.upX.value = u[0]; L.upY.value = u[1]; L.upZ.value = u[2]; }
   else L.setOrientation?.(...forward, ...u);
  }
 }

 /** Per frame: listener position and a reaper for voices whose onended never fired. */
 function tick(listener) {
  if (disposed) return;
  if (listener) setListener(listener);
  const now = context.currentTime;
  for (const v of [...voices]) if (now > v.endAt + .25) { try { v.source.stop(); } catch {} cleanup(v); }
 }

 function dispose() {
  if (disposed) return; disposed = true;
  for (const v of [...voices]) release(v, true);
  try { master.disconnect(); } catch {}
  buffers.clear(); recent.clear(); lastBySound.clear();
 }

 return {load, unlock, handles, play, tick, dispose, setListener,
  stats: () => ({...stats, voices: voices.size, releasing: [...voices].filter(v => v.releasing).length, buffers: buffers.size, maxVoices: hardCap, disposed})};
}
