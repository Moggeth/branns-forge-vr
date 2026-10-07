// Save hygiene for the Stormspire's optional fields (operator2, wraps, probes, arc, planted). Older saves simply lack them; a
// hand-edited or damaged one is trimmed to something the simulation can safely step, never rejected outright.
const finite3 = a => Array.isArray(a) && a.length === 3 && a.every(n => Number.isFinite(n) && Math.abs(n) < 1e4);
const id = s => typeof s === 'string' && /^[-\w]{1,64}$/.test(s);
const PARTS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

export function restoreStormspire(b, tick) {
  for (const k of ['operator', 'operator2']) if (b[k] != null && !id(b[k])) b[k] = null;
  delete b.lastProbe;
  if (b.probes) {
    const out = {red: null, blue: null};
    for (const colour of ['red', 'blue']) {
      const p = b.probes[colour];
      if (!p || !finite3(p.at) || !Number.isFinite(p.tick) || p.tick > tick) continue;
      out[colour] = {at: p.at.map(Number), tick: p.tick, by: id(p.by) ? p.by : '', cost: Number.isFinite(p.cost) ? Math.max(0, Math.min(240, p.cost)) : 0,
        ...(id(p.enemy) ? {enemy: p.enemy, part: PARTS.includes(p.part) ? p.part : 'torso'} : {}), ...(p.fell === true ? {fell: true} : {})};
    }
    if (out.red || out.blue) b.probes = out; else delete b.probes;
  }
  if (b.arc && (!(b.probes?.red && b.probes?.blue) || !Number.isFinite(b.arc.tick) || !Number.isFinite(b.arc.until))) delete b.arc;
  else if (b.arc) b.arc = {tick: b.arc.tick, until: Math.min(b.arc.until, tick + 60 * 7), by: id(b.arc.by) ? b.arc.by : '', ...(id(b.arc.enemy) ? {enemy: b.arc.enemy} : {})};
  if (b.planted !== undefined) {
    const out = {};
    for (const colour of ['red', 'blue']) {
      const p = b.planted?.[colour];
      if (p && finite3(p.at) && Number.isFinite(p.yaw) && Math.abs(p.yaw) <= 4 && Number.isFinite(p.tick) && p.tick <= tick) out[colour] = {at: p.at.map(Number), yaw: p.yaw, tick: p.tick, by: id(p.by) ? p.by : ''};
    }
    if (out.red || out.blue) b.planted = out; else delete b.planted;
  }
  for (const [wraps, at] of [['wraps', 'wrapAt'], ['wraps2', 'wrapAt2']]) {
    if (b[wraps] !== undefined) b[wraps] = Array.isArray(b[wraps]) ? b[wraps].slice(0, 12).filter(w => w && id(w.id) && Number.isFinite(w.x) && Number.isFinite(w.z) && (w.s === 1 || w.s === -1)).map(({id: i, x, z, s}) => ({id: i, x, z, s})) : [];
    if (b[at] !== undefined && !(Array.isArray(b[at]) && b[at].length === 2 && b[at].every(Number.isFinite))) delete b[at];
  }
}
