// Outcrop geode presentation: drives the cluster growth/glow uniforms in starting-world.js from snapshot.geodes
// (shared/geode-outcrop.js), flashes a cluster as it cracks and breaks, and plays its glass. Never changes gameplay.
// No extra draws: the clusters are one live mesh owned by the starting world.
import {GEODES, GEODE_RULES} from '../shared/geode-outcrop.js';
import {createLandmarkAudio} from './landmark-audio.js';

const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export function createGeodeView({startingWorld, audio = () => null, listener = () => null}) {
  const sound = createLandmarkAudio({audio, listener});
  const grow = GEODES.map(() => 1), glow = GEODES.map(() => 0), flash = GEODES.map(() => 0);
  function handleEvent(event) {
    if (event.kind === 'geode_crack') { flash[event.index] = Math.max(flash[event.index], 0.7); sound.bell(event.position, 19 + event.hits * 2, 0.1, 0.9); }
    else if (event.kind === 'geode_break') { flash[event.index] = 1; sound.shatter(event.position); }
    else if (event.kind === 'geode_regrown') { flash[event.index] = 0.8; sound.chord(event.position, [12, 16, 19], 0.06, 90, 2); }
  }
  // Regrowth: a broken cluster sits as a glowing stub for the first 40% of its wait, then grows back to full.
  function update(snapshot, dt) {
    const list = snapshot?.landmarks ? snapshot.geodes : null, tick = snapshot?.tick ?? 0;
    for (const g of GEODES) {
      const s = list?.[g.index], i = g.index;
      const left = s ? s.regrowTick - tick : 0, target = left > 0 ? 0.12 + 0.88 * smooth((1 - left / GEODE_RULES.regrowTicks - 0.4) / 0.6) : 1;
      grow[i] += (target - grow[i]) * Math.min(1, dt * (target < grow[i] ? 14 : 3));
      flash[i] = Math.max(0, flash[i] - dt * 1.4);
      const cracked = s && left <= 0 ? s.hits / g.maxHits : 0;
      glow[i] = Math.min(1, cracked * 0.55 + flash[i] + (left > 0 ? 0.25 : 0));
    }
    startingWorld.setGeodes?.(grow, glow);
  }
  return {handleEvent, update, stats: () => ({grown: grow.filter(g => g > 0.95).length})};
}
