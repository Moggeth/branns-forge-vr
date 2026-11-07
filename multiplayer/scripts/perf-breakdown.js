// run inside page: breakdown of visible draw cost by top-level-ish name
(() => {
 const {scene, renderer, camera} = globalThis.__brannDebug;
 const frustum = new (camera.constructor.__proto__.constructor === Object ? Object : Object)();
 const rows = new Map(); let total = 0, meshes = 0, shadowCasters = 0, shadowTris = 0;
 const tri = o => { const g = o.geometry; if (!g) return 0; const c = g.index ? g.index.count : g.attributes.position?.count || 0; const dr = g.drawRange; const n = Math.min(c, dr.count); const inst = o.isInstancedMesh ? o.count : (g.isInstancedBufferGeometry ? g.instanceCount : 1); return (o.isPoints ? n : o.isLine || o.isLineSegments ? n/2 : n / 3) * (Number.isFinite(inst)?inst:1); };
 const path = o => { const names = []; let p = o; while (p && p !== scene) { if (p.name) names.unshift(p.name); p = p.parent; } return (names.slice(0, 2).join('/') || o.type) ; };
 scene.traverseVisible(o => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; meshes++; const t = tri(o); total += t; if (o.castShadow) { shadowCasters++; shadowTris += t; }
   const k = path(o); const r = rows.get(k) || {k, objs: 0, tris: 0, shadow: 0, mats: new Set()}; r.objs++; r.tris += t; if (o.castShadow) r.shadow += t; (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>r.mats.add(m?.type)); rows.set(k, r); });
 const top = [...rows.values()].sort((a, b) => b.tris - a.tris).slice(0, 30).map(r => ({k: r.k, objs: r.objs, ktris: +(r.tris/1000).toFixed(1), kshadow: +(r.shadow/1000).toFixed(1), mats: [...r.mats].join(',')}));
 const byObjs = [...rows.values()].sort((a, b) => b.objs - a.objs).slice(0, 15).map(r => ({k: r.k, objs: r.objs, ktris: +(r.tris/1000).toFixed(1)}));
 const lights = []; scene.traverse(o => { if (o.isLight && o.visible) lights.push({type: o.type, name: o.name, shadow: !!o.castShadow, map: o.shadow?.mapSize?.x}); });
 return {meshes, ktris: +(total/1000).toFixed(0), shadowCasters, kshadowTris: +(shadowTris/1000).toFixed(0), shadowMap: renderer.shadowMap.enabled, shadowAuto: renderer.shadowMap.autoUpdate, lights, top, byObjs, info: renderer.info.render, memory: renderer.info.memory};
})()
