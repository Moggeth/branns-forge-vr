// Summarise a perf-bench --profile (.cpuprofile) or --heap (sampling heap profile) file: top self and inclusive entries.
// Usage: node scripts/perf-report.mjs <file> [top=40]
import {readFileSync} from 'node:fs';
const [file, topArg] = process.argv.slice(2), top = +(topArg || 40), data = JSON.parse(readFileSync(file, 'utf8'));
const key = cf => `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
const self = new Map(), incl = new Map(), add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
let unit, total = 0;
if (data.head) { // heap sampling profile: bytes
  unit = 'MB'; const walk = (n, stack) => { const k = key(n.callFrame), s = n.selfSize / 1e6; add(self, k, s); total += s; const st = new Set(stack).add(k); for (const x of st) add(incl, x, s); for (const c of n.children) walk(c, st); };
  walk(data.head, new Set());
} else { // CPU profile: ms
  unit = 'ms'; const nodes = new Map(data.nodes.map(n => [n.id, n])), parent = new Map();
  for (const n of data.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const time = new Map(); data.samples.forEach((s, i) => time.set(s, (time.get(s) || 0) + data.timeDeltas[i] / 1000));
  for (const [id, t] of time) { const n = nodes.get(id), k = key(n.callFrame); add(self, k, t); total += t; const seen = new Set(); for (let x = id; x !== undefined; x = parent.get(x)) { const kk = key(nodes.get(x).callFrame); if (!seen.has(kk)) { seen.add(kk); add(incl, kk, t); } } }
}
const print = (title, m) => { console.log(`--- ${title}`); for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${v.toFixed(2).padStart(10)} ${unit}  ${k}`); };
console.log(`total ${total.toFixed(1)} ${unit}`); print('self', self); print('inclusive', incl);
