// String-level check: injection anchors exist in the installed three.js standard shader and declarations are unique.
import {createRequire} from 'node:module';
const req = createRequire(process.argv[2] + '/');
import {pathToFileURL} from 'node:url';
const Tm = await import(pathToFileURL(req.resolve('three')).href); const T = Tm.MeshStandardMaterial ? Tm : Tm.default;
const {applyCrystalMaterial, MOUNTAIN_ROCK_GLSL} = await import('./material-refinements.js');
const resolve = s => s.replace(/#include <(\w+)>/g, (m, n) => T.ShaderChunk[n] ?? m);
let fail = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++; };
for (const kind of ['core', 'pale', 'rock']) {
  const m = new T.MeshStandardMaterial({flatShading: true}); applyCrystalMaterial(m, kind);
  const sh = {vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader, uniforms: {}};
  m.onBeforeCompile(sh, null);
  ok(m.userData.crystalRefinement.patched, kind + ' anchors patched');
  const fs = resolve(sh.fragmentShader), vs = resolve(sh.vertexShader);
  ok(fs.indexOf('vCrysMetric') > fs.indexOf('vViewPosition') && fs.indexOf('totalEmissiveRadiance = totalEmissiveRadiance') < 0 || kind === 'rock' || fs.indexOf('vec3 totalEmissiveRadiance') < fs.indexOf('totalEmissiveRadiance = totalEmissiveRadiance'), kind + ' emissive declared before use');
  ok(fs.indexOf('vec3 normal') < fs.indexOf('dot(normal, cV)') || kind === 'rock', kind + ' normal declared before use');
  ok(fs.indexOf('roughnessFactor = clamp') < 0 || fs.indexOf('float roughnessFactor') < fs.indexOf('roughnessFactor = clamp'), kind + ' roughness declared before use');
  ok(fs.lastIndexOf('#include <emissivemap_fragment>') < 0 && fs.indexOf('crysHash') > 0, kind + ' includes resolved');
  ok(vs.indexOf('vCrysMetric = position * crysScale') > vs.indexOf('vec3 transformed'), kind + ' vertex after begin_vertex');
  ok(m.customProgramCacheKey().includes('crystal-' + kind), kind + ' cache key ' + m.customProgramCacheKey());
}
ok(/vec3 mountainRock\(vec3 w, vec3 n, vec3 tint\)/.test(MOUNTAIN_ROCK_GLSL), 'mountainRock signature');
const decls = [...MOUNTAIN_ROCK_GLSL.matchAll(/^(?:float|vec3) (\w+)\(/gm)].map(x => x[1]);
ok(decls.every(d => d.startsWith('mtn') || d === 'mountainRock'), 'mountain helpers prefixed: ' + decls.join(','));
const locals = [...MOUNTAIN_ROCK_GLSL.matchAll(/\b(?:float|vec3) (\w+) =/g)].map(x => x[1]);
ok(new Set(locals).size === locals.length, 'no duplicate locals in mountainRock');
ok(!/orchard|oAlbedo|oN\b/.test(MOUNTAIN_ROCK_GLSL), 'no orchard identifiers referenced');
console.log('three r' + T.REVISION, fail ? `${fail} FAIL` : 'ALL PASS'); process.exit(fail ? 1 : 0);
