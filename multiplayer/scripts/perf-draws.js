// run inside page (perf-bench --breakdown): which objects actually issue draw calls, main pass vs shadow passes,
// grouped by their first two named ancestors, over 60 frames. Also flags groups that never move (static batching candidates).
(async () => {
  const {scene, renderer} = globalThis.__brannDebug;
  const path = o => { const n = []; for (let p = o; p && p !== scene; p = p.parent) if (p.name) n.unshift(p.name); return n.slice(0, 2).join('/') || ('(' + o.type + ')'); };
  const rows = new Map(), seen = new Map(); let frames = 0, main = 0, shadow = 0, on = false;
  const orig = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) {
    if (!on) return orig.call(this, cam, sc, geo, mat, obj, grp);
    const k = path(obj); let r = rows.get(k); if (!r) rows.set(k, r = {k, main: 0, shadow: 0, objs: new Set(), mats: new Set(), geos: new Set(), moved: 0});
    if (sc) { r.main++; main++; } else { r.shadow++; shadow++; }
    r.objs.add(obj); r.mats.add(mat); r.geos.add(geo);
    const e = obj.matrixWorld.elements, s = e[12] + e[13] * 7 + e[14] * 13 + e[0] * 3, prev = seen.get(obj);
    if (prev !== undefined && Math.abs(prev - s) > 1e-6) r.moved++; seen.set(obj, s);
    return orig.call(this, cam, sc, geo, mat, obj, grp);
  };
  // With --nopath, sample the views the bench path passes through (spawn turn, glide end, overview); else the live view.
  const h = window.brannHarness, me = h.snapshot().players.find(p => p.id === h.state().playerId), [x, y, z] = me?.position || [0, 0, 0];
  const views = window.__benchDrawViews || [[0, 1.65, 0, 0, -.08], [0, 1.65, 0, Math.PI * .75, -.08], [0, 1.65, 0, Math.PI * 1.5, -.08], [-63, 1.65, -63, Math.PI * 2.4, -.08], [-63, 36.65, -63, Math.PI * 2.8, -.37]];
  const per = [];
  for (const v of views) {
    if (v) window.__brannShotCam = [x + v[0], y + v[1], z + v[2], v[3], v[4]];
    await new Promise(r => setTimeout(r, 1500)); const m0 = main, s0 = shadow, f0 = frames; on = true;
    await new Promise(res => { let n = 0; const tick = () => { frames++; if (++n >= 20) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }); on = false;
    per.push({view: v, main: +((main - m0) / (frames - f0)).toFixed(1), shadow: +((shadow - s0) / (frames - f0)).toFixed(1)});
  }
  renderer.renderBufferDirect = orig;
  const list = [...rows.values()].map(r => ({k: r.k, mainPerFrame: +(r.main / frames).toFixed(1), shadowPerFrame: +(r.shadow / frames).toFixed(1), objs: r.objs.size, mats: r.mats.size, geos: r.geos.size, static: r.moved === 0}));
  list.sort((a, b) => (b.mainPerFrame + b.shadowPerFrame) - (a.mainPerFrame + a.shadowPerFrame));
  return {per, frames, mainPerFrame: +(main / frames).toFixed(1), shadowPerFrame: +(shadow / frames).toFixed(1), info: {...renderer.info.render}, top: list.slice(0, 40), all: list};
})()
