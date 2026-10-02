// Spatial wood interaction audio for trees.js events. One shared AudioContext (owned by the game),
// a bounded voice pool, deterministic per-event variation, no polling: landing is scheduled from the
// authoritative tree_fell event (optionally with the pure treeFall() land time) and confirmed by tree_land.
//
//   const wood = createWoodAudio({context: audioContext, baseUrl: '/assets/wood-audio/'});
//   wood.unlock();                       // call from the existing user-gesture unlock path
//   if (wood.handles(event)) wood.play(event, listener); else legacyBeep(event);
//   wood.tick(listener);                 // once per frame: listener pose + safety reaping (no per-tree work)
//   wood.dispose();

export const WOOD_SOUNDS = Object.freeze({
 // name: files (variants), priority (higher survives stealing), cap (same-sound instances), duration s (authored, for scheduling)
 axe_bite:       {files: ['axe_bite_a', 'axe_bite_b'], priority: 6, cap: 3, duration: .55, rate: .05},
 axe_bite_deep:  {files: ['axe_bite_deep'], priority: 7, cap: 2, duration: 1.35, rate: .04},
 bark_glance:    {files: ['bark_glance_a', 'bark_glance_b'], priority: 3, cap: 3, duration: .42, rate: .07},
 trunk_fracture: {files: ['trunk_fracture'], priority: 9, cap: 2, duration: 2.1, rate: .04},
 foliage_rustle: {files: ['foliage_rustle'], priority: 5, cap: 2, duration: 2.6, rate: .03},
 log_land_heavy: {files: ['log_land_heavy'], priority: 9, cap: 2, duration: 1.7, rate: .05},
 log_settle:     {files: ['log_settle'], priority: 4, cap: 2, duration: 1.0, rate: .05},
 log_bounce:     {files: ['log_bounce_a', 'log_bounce_b'], priority: 2, cap: 4, duration: .45, rate: .1},
 log_grab:       {files: ['log_grab'], priority: 4, cap: 2, duration: .32, rate: .06},
 log_stow:       {files: ['log_stow'], priority: 5, cap: 2, duration: .5, rate: .03},
 log_toss:       {files: ['log_toss'], priority: 2, cap: 2, duration: .38, rate: .08}
});
export const WOOD_EVENT_KINDS = Object.freeze(['wood_hit', 'tree_fell', 'tree_land', 'log_bounce', 'log_throw', 'grab', 'pickup']);
export const DEFAULT_LAND_DELAY = 2.5; // s; typical treeFall landTicks/60 for the authored trees (2.0-2.8 s)

/** FNV-1a -> [0,1). Same event on every client gives the same pitch/gain/variant. */
export function hash01(text) {
 let h = 0x811c9dc5;
 for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
 h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
 return (h >>> 0) / 4294967296;
}

/**
 * Pure mapping from a trees.js event to sound layers. Exported for tests and for callers that want to
 * inspect the plan. Returns [] for events this kit does not own.
 * layer: {sound, delay s, gain linear, alignEnd?: bool (end of buffer lands at delay)}
 */
export function woodLayersFor(event, scheduledLandings = null) {
 const k = event?.kind;
 if (k === 'wood_hit') {
  if (event.glance) return [{sound: 'bark_glance', delay: 0, gain: 1}];
  if (event.cuts === 2) return [{sound: 'axe_bite_deep', delay: 0, gain: 1}];
  if (event.cuts >= 3) return [{sound: 'axe_bite', delay: 0, gain: 1.1, rateBase: .9}]; // tree_fell carries the fracture
  return [{sound: 'axe_bite', delay: 0, gain: 1}];
 }
 if (k === 'tree_fell') {
  // landTicks: proposed authoritative field on tree_fell (treeFall(...).landTicks at 60 Hz); landDelay: seconds override.
  const raw = Number.isFinite(event.landDelay) ? event.landDelay : Number.isFinite(event.landTicks) ? event.landTicks / 60 : NaN;
  const land = raw > 0 && raw < 6 ? raw : null;
  const layers = [{sound: 'trunk_fracture', delay: 0, gain: 1}, {sound: 'foliage_rustle', delay: land ?? DEFAULT_LAND_DELAY, gain: 1, alignEnd: true}];
  if (land !== null) { layers.push({sound: 'log_land_heavy', delay: land, gain: 1}); scheduledLandings?.set(String(event.id), true); }
  return layers;
 }
 if (k === 'tree_land') { // authoritative settle event (doneTicks = landTicks + settleTicks)
  const pre = scheduledLandings?.get(String(event.id)); scheduledLandings?.delete(String(event.id));
  return [{sound: pre ? 'log_settle' : 'log_land_heavy', delay: 0, gain: 1}];
 }
 if (k === 'log_bounce') return [{sound: 'log_bounce', delay: 0, gain: 1}];
 if (k === 'log_throw') return [{sound: 'log_toss', delay: 0, gain: 1}];
 if (k === 'grab' && String(event.id ?? '').startsWith('log')) return [{sound: 'log_grab', delay: 0, gain: 1}];
 if (k === 'pickup' && event.material === 'wood') return [{sound: 'log_stow', delay: 0, gain: 1}];
 return [];
}

const finite3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
function setParam(param, value, node, setter) { if (param) param.value = value; else node?.[setter]?.(value); }

export function createWoodAudio({context, destination = context?.destination, baseUrl = '/assets/wood-audio/', ext = 'wav',
 fetchImpl = globalThis.fetch?.bind(globalThis), maxVoices = 16, releaseSlots = 2, refDistance = 2.5, maxDistance = 55,
 rolloff = 1.1, masterGain = .7, panningModel = 'equalpower', driveListener = true, airAbsorption = true} = {}) {
 if (!context?.createBufferSource) throw new Error('createWoodAudio needs the game\'s existing AudioContext');
 const audible = Math.max(1, Math.min(16, maxVoices) - releaseSlots), hardCap = Math.min(16, maxVoices);
 const master = context.createGain(); master.gain.value = masterGain; master.connect(destination);
 const buffers = new Map(), voices = new Set(), recent = new Map(), scheduledLandings = new Map();
 const stats = {started: 0, ended: 0, stolen: 0, culled: 0, dropped: 0, loading: 0, peakVoices: 0};
 let disposed = false, unlocked = false, listenerPos = [0, 0, 0], loadPromise = null;

 function decode(bytes) { // promise and legacy-callback Safari forms
  return new Promise((resolve, reject) => { const p = context.decodeAudioData(bytes, resolve, reject); if (p?.then) p.then(resolve, reject); });
 }
 function load() {
  if (loadPromise) return loadPromise;
  const files = [...new Set(Object.values(WOOD_SOUNDS).flatMap(s => s.files))];
  loadPromise = Promise.all(files.map(async f => {
   try { const r = await fetchImpl(`${baseUrl}${f}.${ext}`); if (!r.ok) throw Error(`${f}: ${r.status}`); const b = await decode(await r.arrayBuffer()); if (!disposed) buffers.set(f, b); return true; }
   catch { return false; }
  })).then(ok => ({loaded: ok.filter(Boolean).length, total: files.length}));
  return loadPromise;
 }

 /** Call inside the existing user-gesture handler. Resumes and primes iOS with a 1-sample silent buffer. */
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
 function makeRoom(def, priority) {
  const same = live().filter(v => v.sound === def);
  if (same.length >= WOOD_SOUNDS[def].cap) release(same.sort((a, b) => a.startAt - b.startAt)[0]);
  let candidates = live();
  if (candidates.length >= audible) {
   const victim = candidates.sort((a, b) => a.priority - b.priority || a.startAt - b.startAt)[0];
   if (victim.priority > priority) return false;               // everything playing matters more: drop the new one
   release(victim);
  }
  while (voices.size >= hardCap) { // release slots exhausted by a burst: finish the oldest fade immediately
   const r = [...voices].filter(v => v.releasing).sort((a, b) => a.startAt - b.startAt)[0];
   if (!r) return false; release(r, true);
  }
  return true;
 }

 function startLayer(layer, event, position, distance, salt) {
  const def = WOOD_SOUNDS[layer.sound], seed = `${event.kind}|${event.id ?? ''}|${event.cuts ?? ''}|${event.tick ?? ''}|${salt}`;
  const file = def.files[Math.floor(hash01(seed + '|v') * def.files.length)], buffer = buffers.get(file);
  if (!buffer) { stats.loading++; return null; }
  const key = `${layer.sound}|${event.id ?? ''}`, now = context.currentTime;
  if (layer.delay === 0 && now - (recent.get(key) ?? -1) < .03) { stats.dropped++; return null; } // duplicate packet flam
  if (!makeRoom(layer.sound, def.priority)) { stats.dropped++; return null; }
  recent.set(key, now); if (recent.size > 128) recent.delete(recent.keys().next().value);
  const rate = (layer.rateBase ?? 1) * (1 + def.rate * (2*hash01(seed + '|r') - 1));
  const gainDb = 3 * hash01(seed + '|g') - 1.5;
  const duration = buffer.duration ?? def.duration;
  let when = now + layer.delay, offset = 0;
  if (layer.alignEnd) { when -= duration / rate; if (when < now) { offset = Math.min(duration - .05, (now - when) * rate); when = now; } }
  const source = context.createBufferSource(), gain = context.createGain(), panner = context.createPanner();
  source.buffer = buffer; setParam(source.playbackRate, rate, source, null);
  gain.gain.value = (layer.gain ?? 1) * 10 ** (gainDb / 20);
  Object.assign(panner, {panningModel, distanceModel: 'inverse', refDistance, maxDistance, rolloffFactor: rolloff});
  setParam(panner.positionX, position[0], panner, null); setParam(panner.positionY, position[1], panner, null); setParam(panner.positionZ, position[2], panner, null);
  if (!panner.positionX) panner.setPosition?.(...position);
  let filter = null;
  if (airAbsorption && distance > 8 && context.createBiquadFilter) { // distant chops lose their edge, not just level
   filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = Math.max(2200, 16000 / (1 + (distance - 8) / 10));
   source.connect(gain).connect(filter).connect(panner).connect(master);
  } else source.connect(gain).connect(panner).connect(master);
  const v = {source, gain, panner, filter, sound: layer.sound, priority: def.priority, startAt: when, endAt: when + (duration - offset) / rate, releasing: false, dead: false};
  source.onended = () => cleanup(v);
  source.start(when, offset);
  voices.add(v); stats.started++; stats.peakVoices = Math.max(stats.peakVoices, voices.size);
  return v;
 }

 /** True when this kit owns the event's sound (the caller should then skip its legacy oscillator). */
 function handles(event) { return WOOD_EVENT_KINDS.includes(event?.kind) && woodLayersFor(event).length > 0; }

 /** Play a trees.js event. listener (optional) is {position, forward?, up?}; updates the listener first. */
 function play(event, listener) {
  if (disposed || !event) return [];
  if (listener) setListener(listener);
  const position = finite3(event.position) ? event.position : listenerPos;
  const d = Math.hypot(position[0]-listenerPos[0], position[1]-listenerPos[1], position[2]-listenerPos[2]);
  const layers = woodLayersFor(event, scheduledLandings);
  if (scheduledLandings.size > 64) scheduledLandings.delete(scheduledLandings.keys().next().value);
  if (!layers.length) return [];
  if (d > maxDistance) { stats.culled += layers.length; return []; } // inaudible: no nodes at all
  return layers.map((l, i) => startLayer(l, event, position, d, i)).filter(Boolean);
 }

 function setListener({position, forward, up} = {}) {
  if (finite3(position)) listenerPos = [...position];
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

 /** Per frame: listener pose and a reaper for voices whose onended never fired (suspended/interrupted contexts). */
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
  buffers.clear(); recent.clear(); scheduledLandings.clear();
 }

 return {load, unlock, handles, play, tick, dispose, setListener,
  stats: () => ({...stats, voices: voices.size, releasing: [...voices].filter(v => v.releasing).length, buffers: buffers.size, disposed})};
}
