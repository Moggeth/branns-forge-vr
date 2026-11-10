// Longest individual calls of one function in a perf-bench --profile file (default: the game's frame()), with what
// ran inside each. Finds the code behind single slow frames that averages hide. Usage:
// node scripts/perf-frames.mjs <file.cpuprofile> [fn=frame] [count=8]
import {readFileSync} from 'node:fs';
const [file, fn = 'frame', countArg] = process.argv.slice(2), count = +(countArg || 8), p = JSON.parse(readFileSync(file, 'utf8'));
const nodes = new Map(p.nodes.map(n => [n.id, n])), parent = new Map();
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const key = n => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
const runs = []; let cur = null, t = p.startTime;
p.samples.forEach((id, i) => {
  t += p.timeDeltas[i]; const stack = []; let inFn = false;
  for (let x = id; x !== undefined; x = parent.get(x)) { const n = nodes.get(x); stack.push(n); if (n.callFrame.functionName === fn) inFn = true; }
  if (!inFn) { if (cur) { runs.push(cur); cur = null; } return; }
  const dt = (p.timeDeltas[i + 1] ?? 0) / 1000; cur ??= {start: t, ms: 0, incl: new Map()}; cur.ms += dt;
  const seen = new Set(); for (const n of stack) { const k = key(n); if (!seen.has(k)) { seen.add(k); cur.incl.set(k, (cur.incl.get(k) || 0) + dt); } }
});
if (cur) runs.push(cur);
runs.sort((a, b) => b.ms - a.ms);
console.log(`${runs.length} calls of ${fn}; median ${runs[Math.floor(runs.length / 2)]?.ms.toFixed(2)} ms`);
for (const r of runs.slice(0, count)) {
  console.log(`\n${r.ms.toFixed(1)} ms at +${((r.start - p.startTime) / 1e6).toFixed(2)} s`);
  for (const [k, v] of [...r.incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !/^\(root\)|^\(anon\) :|onAnimationFrame/.test(k)).slice(0, 14)) console.log(`  ${v.toFixed(1).padStart(7)}  ${k}`);
}
