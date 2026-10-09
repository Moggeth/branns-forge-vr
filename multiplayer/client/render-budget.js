// Presentation-only governor. No simulation, entity or network state is changed.
export const GRAPHICS_MODES = ['auto', 'clarity', 'battery'];
export function createRenderBudget({mobile = false, dpr = 1, mode = 'auto'} = {}) {
  const ceiling = Math.min(Math.max(1, dpr), mobile ? 1.5 : 1.75);
  let current = Math.min(ceiling, mobile ? 1.25 : 1.75), target = current;
  let selected = GRAPHICS_MODES.includes(mode) ? mode : 'auto';
  let samples = [], cpu = [], start = null, lastChange = -Infinity, bad = 0, good = 0, changes = 0;
  if(selected==='clarity')current=target=ceiling;
  if(selected==='battery')current=target=Math.min(1,ceiling);
  let last = {p90Ms: 0, cpuP90Ms: 0};
  const percentile = a => a.sort((a,b)=>a-b)[Math.floor((a.length-1)*.9)] || 0;
  function reset() { samples = []; cpu = []; start = null; bad = good = 0; }
  function choose(value, now) { target = Math.round(Math.max(.75, Math.min(ceiling, value))*100)/100; lastChange = now; changes++; bad = good = 0; }
  return {
    mode(value) { if (!GRAPHICS_MODES.includes(value)) return false; selected = value; reset(); if (value === 'clarity') target = ceiling; else if (value === 'battery') target = Math.min(1, ceiling); return true; },
    sample(now, intervalMs, cpuMs, eligible = true) {
      if (!eligible || !Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 250) { reset(); return; }
      if (selected !== 'auto') { target = selected === 'clarity' ? ceiling : Math.min(1, ceiling); return; }
      start ??= now; samples.push(intervalMs); cpu.push(cpuMs);
      if (now-start < 2000 || samples.length < 30) return;
      last = {p90Ms: percentile(samples), cpuP90Ms: percentile(cpu)};
      samples = []; cpu = []; start = now;
      bad = last.p90Ms > 20 ? bad+1 : 0;
      good = last.p90Ms < 18 && last.cpuP90Ms < 11 ? good+1 : 0;
      // Four seconds of pressure to step down; twenty seconds of headroom to recover.
      // Never react to one spell, orientation change, background tab or loading frame.
      const floor=last.cpuP90Ms>20&&last.cpuP90Ms>last.p90Ms*.75?1:.75;
      // CPU-bound crowds cannot be cured by making the image increasingly blurry.
      if (bad >= 2 && now-lastChange >= 5000 && target > floor) choose(Math.max(floor,target-.1), now);
      else if (good >= 10 && now-lastChange >= 20000 && target < ceiling) choose(target+.05, now);
    },
    ratio(dt = 0) { current += Math.max(-dt*.08, Math.min(dt*.08, target-current)); return current; },
    reset,
    stats: () => ({mode: selected, mobile, ratio: +current.toFixed(3), target, ceiling, changes, ...last}),
  };
}

// Quantize drawing-buffer changes: continuous quality interpolation must not
// reallocate WebGL targets on every animation frame. CSS/HUD pixels stay native.
export function renderSize(width, height, ratio) {
  const step = 32;
  return {width: Math.max(step, Math.round(width*ratio/step)*step), height: Math.max(step, Math.round(height*ratio/step)*step)};
}
