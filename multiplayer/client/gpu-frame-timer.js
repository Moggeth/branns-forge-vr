// Asynchronous WebGL2 timing. Never wait for the GPU or treat submission as GPU time.
// Sample one frame in 30 and keep at most four queries in flight.
export function createGpuFrameTimer(gl, record, {every = 30, maxPending = 4} = {}) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let active = null, frame = 0, completed = 0, discarded = 0, disposed = false;
  const pending = [];
  function clear() {
    for (const q of pending) gl.deleteQuery(q);
    discarded += pending.length; pending.length = 0;
  }
  return {
    begin() {
      if (!ext || disposed || active || ++frame % every) return;
      if (gl.isContextLost()) { clear(); return; }
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { clear(); return; }
      // Availability is checked first; QUERY_RESULT is never read speculatively.
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift(), ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        gl.deleteQuery(q);
        if (Number.isFinite(ns) && ns >= 0) { record('gpuFrame', ns / 1e6); completed++; }
      }
      if (pending.length >= maxPending || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      if (!gl.isContextLost()) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); }
      else { gl.deleteQuery(active); discarded++; }
      active = null;
    },
    stats: () => ({supported: !!ext, completed, discarded, pending: pending.length, sampleEvery: every}),
    dispose() {
      if (active) { if (!gl.isContextLost()) gl.endQuery(ext.TIME_ELAPSED_EXT); gl.deleteQuery(active); active = null; }
      clear(); disposed = true;
    },
  };
}
