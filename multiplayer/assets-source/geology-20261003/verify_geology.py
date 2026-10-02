"""Independent GLB checks for the meteor/geology kit (plain Python + numpy, no Blender).
python verify_geology.py OUT_DIR   -> writes OUT_DIR/verify_report.json, exit 1 on any failure.
Per GLB: budgets (tris, materials, LOD), embedded images only, no cameras/lights, opaque single-sided materials,
bottom-centre origin and +Y up, Grip/ResourcePivot present, closed 2-manifold per connected piece (positions welded),
positive signed volume (outward winding), stored normals agree with winding, and a ray battery that mimics the game's
THREE.Raycaster use: rays from outside toward the deposit must hit a FRONT face (so backface culling can never show a
see-through wall) and every hit's horizontal distance after runtime normalisation must stay inside the 1.5 m server radius.
"""
import json, struct, sys, os, math
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = dict(SCALAR=1, VEC2=2, VEC3=3, VEC4=4)
RUNTIME_HEIGHT = dict(meteor=1.5, boulder=1.2, boulder_b=1.2, boulder_c=1.2)   # world-content-view authored(name, size)

def load(path):
    d = open(path, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl])
    off = 20 + jl; bl = struct.unpack('<I', d[off:off + 4])[0]; binc = d[off + 8:off + 8 + bl]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; dt = CT[a['componentType']]; n = NC[a['type']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride')
        isz = np.dtype(dt).itemsize
        if stride and stride != isz * n:
            raw = np.frombuffer(binc, np.uint8, count=stride * a['count'], offset=o).reshape(a['count'], stride)[:, :isz * n]
            arr = raw.copy().view(dt).reshape(a['count'], n)
        else: arr = np.frombuffer(binc, dt, count=a['count'] * n, offset=o).reshape(a['count'], n)
        return arr
    return d, j, acc

def node_world(j):
    W = {}
    def mat(n):
        M = np.eye(4)
        if 'matrix' in n: return np.array(n['matrix']).reshape(4, 4).T
        t = n.get('translation', [0, 0, 0]); q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
        x, y, z, w = q; R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M[:3, :3] = R * np.array(s)[None, :]; M[:3, 3] = t; return M
    def walk(i, P):
        M = P @ mat(j['nodes'][i]); W[i] = M
        for c in j['nodes'][i].get('children', []): walk(c, M)
    for r in j['scenes'][j.get('scene', 0)]['nodes']: walk(r, np.eye(4))
    return W

def ray_tris(o, d, A, E1, E2):
    p = np.cross(d, E2); det = (E1 * p).sum(1); ok = np.abs(det) > 1e-12; inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = o - A; u = (s * p).sum(1) * inv; qv = np.cross(s, E1); v = (qv * d).sum(1) * inv; t = (E2 * qv).sum(1) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6); t = np.where(hit, t, np.inf); i = int(np.argmin(t))
    return (i, t[i]) if np.isfinite(t[i]) else (None, None)

def check(path, name):
    d, j, acc = load(path); W = node_world(j); R = dict(file=os.path.basename(path), bytes=len(d)); fails = []
    lod = name.endswith('_lod'); base = name[:-4] if lod else name.split('_worked')[0]
    V = []; T = []; NRM = []; CW = []; vo = 0; tris = 0
    for ni, n in enumerate(j['nodes']):
        if 'mesh' not in n: continue
        M = W[ni]
        for p in j['meshes'][n['mesh']]['primitives']:
            pos = acc(p['attributes']['POSITION']).astype(np.float64); nr = acc(p['attributes']['NORMAL']).astype(np.float64)
            idx = acc(p['indices']).reshape(-1, 3).astype(np.int64)
            pw = (np.c_[pos, np.ones(len(pos))] @ M.T)[:, :3]; nw = nr @ M[:3, :3].T
            V.append(pw); NRM.append(nw); T.append(idx + vo); vo += len(pos); tris += len(idx)
            if 'COLOR_0' not in p['attributes']: fails.append('no COLOR_0')
            else:
                ca = j['accessors'][p['attributes']['COLOR_0']]; cc = acc(p['attributes']['COLOR_0']).astype(np.float64)
                if ca['componentType'] != 5126: cc /= np.iinfo(CT[ca['componentType']]).max
                CW.append(cc[:, :3])
            if p.get('mode', 4) != 4: fails.append('non-triangle primitive')
    V = np.concatenate(V); T = np.concatenate(T); NRM = np.concatenate(NRM)
    if CW:   # Forge Yard lesson: a white-only COLOR_0 means the authored tint was lost
        C = np.concatenate(CW); R['color0_mean'] = C.mean(0).round(3).tolist(); R['color0_white_fraction'] = round(float((C.min(1) > 0.98).mean()), 3)
        if R['color0_white_fraction'] > 0.9: fails.append('COLOR_0 white-only')
        if C.max() > 1.0 + 1e-6 or C.min() < 0: fails.append('COLOR_0 out of [0,1]')
    R['triangles'] = tris; lim = 1500 if lod else 6000
    if tris > lim: fails.append('tris %d > %d' % (tris, lim))
    mats = j.get('materials', []); R['materials'] = [m['name'] for m in mats]
    if len(mats) > 4: fails.append('materials > 4')
    for m in mats:
        if m.get('doubleSided'): fails.append('doubleSided ' + m['name'])
        if m.get('alphaMode', 'OPAQUE') != 'OPAQUE': fails.append('alpha ' + m['name'])
        f = m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])
        if f[3] < 1: fails.append('baseColor alpha < 1 ' + m['name'])
    if any('uri' in im for im in j.get('images', [])): fails.append('external image')
    if j.get('cameras') or 'KHR_lights_punctual' in j.get('extensionsUsed', []): fails.append('camera/light')
    names = [n.get('name') for n in j['nodes']]; R['nodes'] = names
    for s in ('Grip', 'ResourcePivot'):
        if s not in names: fails.append('missing ' + s)
    lo = V.min(0); hi = V.max(0); R['bbox_min'] = lo.round(4).tolist(); R['bbox_max'] = hi.round(4).tolist()
    if abs(lo[1]) > 1e-3: fails.append('min y %.4f != 0' % lo[1])
    if 'chips' not in name and hi[1] < max(hi[0] - lo[0], hi[2] - lo[2]) * 0.25: fails.append('suspicious axis: flat in Y')
    # weld + manifold + volume per connected piece
    key = np.round(V / 1e-5).astype(np.int64); _, wid = np.unique(key, axis=0, return_inverse=True); wid = wid.ravel(); TW = wid[T]
    e = np.sort(np.stack([TW[:, [0, 1]], TW[:, [1, 2]], TW[:, [2, 0]]], 1).reshape(-1, 2), 1)
    _, ec = np.unique(e, axis=0, return_counts=True); R['open_or_nonmanifold_edges'] = int((ec != 2).sum())
    if (ec != 2).any(): fails.append('non-closed edges %d' % (ec != 2).sum())
    de = np.stack([TW[:, [0, 1]], TW[:, [1, 2]], TW[:, [2, 0]]], 1).reshape(-1, 2)   # directed: each must appear once
    _, dc = np.unique(de, axis=0, return_counts=True); R['inconsistent_winding_edges'] = int((dc != 1).sum())
    if (dc != 1).any(): fails.append('winding inconsistent %d' % (dc != 1).sum())
    A = V[T[:, 0]]; E1 = V[T[:, 1]] - A; E2 = V[T[:, 2]] - A; FN = np.cross(E1, E2)
    # union-find pieces for signed volume
    parent = np.arange(wid.max() + 1)
    def find(x):
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for a, b, c in TW:
        ra, rb, rc = find(a), find(b), find(c); parent[rb] = ra; parent[find(rc)] = ra
    piece = np.array([find(x) for x in TW[:, 0]]); vol = (A * np.cross(V[T[:, 1]], V[T[:, 2]])).sum(1) / 6
    pv = {int(k): float(vol[piece == k].sum()) for k in np.unique(piece)}; R['pieces'] = len(pv); R['min_piece_volume_m3'] = round(min(pv.values()), 7)
    if min(pv.values()) <= 0: fails.append('inward piece (negative volume)')
    sn = NRM[T].mean(1); agree = ((sn * FN).sum(1) > 0).mean(); R['normal_winding_agreement'] = round(float(agree), 4)
    if agree < 0.999: fails.append('normals disagree with winding %.3f' % agree)
    # ray battery: 96 rays on a Fibonacci sphere, aimed at random interior targets near the vertical axis
    scale = RUNTIME_HEIGHT.get(base, 1.0) / hi[1] if base in RUNTIME_HEIGHT else 1.0
    cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2; rad = float(np.linalg.norm(hi - lo)) * 1.5
    rng = np.random.default_rng(5); front = 0; back = 0; misses = 0; hr = []
    for k in range(96):
        y = 1 - (k + 0.5) / 96 * 1.1; r = math.sqrt(max(0, 1 - y * y)); th = k * 2.399963
        o = np.array([cx + rad * r * math.cos(th), hi[1] * 0.5 + rad * y, cz + rad * r * math.sin(th)])
        tgt = np.array([cx, hi[1] * rng.uniform(0.15, 0.85), cz]) + rng.normal(0, 0.05, 3) * hi[1]
        dvec = tgt - o; dvec /= np.linalg.norm(dvec); i, t = ray_tris(o, dvec, A, E1, E2)
        if i is None: misses += 1; continue
        if (FN[i] * dvec).sum() < 0: front += 1
        else: back += 1
        hp = o + dvec * t; hr.append(math.hypot(hp[0] - cx, hp[2] - cz) * scale)
    R['rays'] = dict(front_face_hits=front, back_face_hits=back, misses=misses, max_horizontal_hit_radius_runtime_m=round(max(hr), 3) if hr else None, runtime_scale=round(scale, 4))
    if back: fails.append('ray hit back face %d (see-through wall)' % back)
    if base in RUNTIME_HEIGHT and hr and max(hr) > 1.5: fails.append('hit radius %.2f > 1.5 m server limit' % max(hr))
    R['ok'] = not fails; R['fails'] = fails; return R

def main():
    out = sys.argv[1]; gdir = os.path.join(out, 'glb'); rep = {}; total = 0
    for f in sorted(os.listdir(gdir)):
        if f.endswith('.glb'): rep[f[:-4]] = check(os.path.join(gdir, f), f[:-4]); total += rep[f[:-4]]['bytes']
    tex = {f: os.path.getsize(os.path.join(out, 'textures', f)) for f in os.listdir(os.path.join(out, 'textures'))}
    summary = dict(all_ok=all(r['ok'] for r in rep.values()), glb_total_bytes=total, texture_png_bytes=tex, assets=rep)
    json.dump(summary, open(os.path.join(out, 'verify_report.json'), 'w'), indent=1)
    for k, r in rep.items():
        print('%-24s %-4s tris=%-5d mats=%d pieces=%-2d open=%d front=%d back=%d miss=%d maxR=%s %s' % (k, 'OK' if r['ok'] else 'FAIL', r['triangles'], len(r['materials']), r['pieces'],
              r['open_or_nonmanifold_edges'], r['rays']['front_face_hits'], r['rays']['back_face_hits'], r['rays']['misses'], r['rays']['max_horizontal_hit_radius_runtime_m'], '; '.join(r['fails'])))
    print('all_ok', summary['all_ok'], 'glb_total_bytes', total)
    sys.exit(0 if summary['all_ok'] else 1)

main()
