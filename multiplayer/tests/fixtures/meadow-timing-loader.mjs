// Test-only fault injection. Transform the loaded module in memory; never write
// production source. Delay actual walking refills before lastFillMs is recorded.
const target = new URL('../../client/meadow-cover.js', import.meta.url).href;
const mode = process.env.MEADOW_TIMING_FAULT;
if (!['once', 'twice', 'sustained'].includes(mode)) throw Error('Expected a meadow timing fault mode');

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url !== target) return result;
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  const marker = 'filledAt = focus.clone(); forceFill = pending; fills++; lastFillMs = performance.now() - t0;';
  if (source.split(marker).length !== 2) throw Error('Meadow refill instrumentation point changed');
  const injection = `
    if (fx === 2.5 && fz === 8) {
      const sample = globalThis.__meadowTimingFaultSample = (globalThis.__meadowTimingFaultSample || 0) + 1;
      if (${JSON.stringify(mode)} === 'sustained' || sample <= (${JSON.stringify(mode)} === 'once' ? 1 : 2)) {
        const pauseStart = performance.now();
        while (performance.now() - pauseStart < 20) {} // real elapsed time, not a fabricated stats value
        console.log('meadow timing fault: ' + sample);
      }
    }
  `;
  return {...result, source: source.replace(marker, injection + marker)};
}
