// Long-frame attribution from a perf-bench --trace file: what the main thread was doing in its longest tasks,
// and where garbage collection, layout and style time went. Usage: node scripts/perf-trace.mjs <trace.json> [minMs=6]
import {readFileSync} from 'node:fs';
const [file, minArg] = process.argv.slice(2), minMs = +(minArg || 6), {traceEvents: ev} = JSON.parse(readFileSync(file, 'utf8'));
const names = new Map(); for (const e of ev) if (e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
const main = [...names].find(([, n]) => n === 'CrRendererMain')?.[0];
const onMain = ev.filter(e => `${e.pid}:${e.tid}` === main && e.ph === 'X' && e.dur);
const allTasks = onMain.filter(e => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask').sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const tasks = []; let end = -1; for (const t of allTasks) if (t.ts >= end) { tasks.push(t); end = t.ts + t.dur; } // outermost only
const label = e => e.name === 'FunctionCall' ? `JS ${e.args?.data?.functionName || '(anon)'} ${(e.args?.data?.url || '').split('/').pop()}:${e.args?.data?.lineNumber ?? ''}` :
  e.name === 'TimerFire' ? 'TimerFire' : e.name === 'EventDispatch' ? `Event ${e.args?.data?.type}` : e.name;
const totals = new Map(), add = (k, v) => totals.set(k, (totals.get(k) || 0) + v);
for (const e of onMain) if (/GC|Layout|UpdateLayoutTree|RecalculateStyles|Paint|ParseHTML|Compile|MajorGC|MinorGC|V8.GC/.test(e.name)) add(e.name, e.dur / 1000);
console.log('main-thread totals (ms):', Object.fromEntries([...totals].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, +v.toFixed(1)])));
const long = tasks.filter(t => t.dur / 1000 >= minMs).sort((a, b) => b.dur - a.dur);
console.log(`tasks >= ${minMs} ms: ${long.length} of ${tasks.length}`);
const causes = new Map();
for (const t of long) {
  const inside = onMain.filter(e => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.dur / 1000 >= .3);
  const top = inside.filter(e => !inside.some(o => o !== e && o.ts <= e.ts && o.ts + o.dur >= e.ts + e.dur && o.dur > e.dur && o.name !== 'RunTask'));
  const parts = inside.filter(e => !/RunTask|WaitForCmd|CommandBuffer|WaitForGetOffset/.test(e.name)).sort((a, b) => b.dur - a.dur).slice(0, 5).map(e => `${label(e)} ${(e.dur / 1000).toFixed(1)}`);
  const key = parts[0]?.replace(/ [\d.]+$/, '') || 'unknown'; causes.set(key, (causes.get(key) || 0) + 1);
  if (long.indexOf(t) < 25) console.log(`${(t.dur / 1000).toFixed(1).padStart(6)} ms  ${parts.join(' | ')}`);
}
console.log('long-task leading causes:', Object.fromEntries([...causes].sort((a, b) => b[1] - a[1]).slice(0, 15)));
