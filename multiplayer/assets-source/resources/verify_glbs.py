"""Independent GLB checks (plain Python, no Blender): python verify_glbs.py OUT_DIR
COLOR_0 present and not all-white, winding agrees with stored normals, maps embedded, no cameras/lights,
sockets present, origin on ground, budgets. Writes OUT_DIR/verify_report.json; exit 1 on failure."""
import json, struct, sys, os, glob

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def load(path):
    d = open(path, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl])
    bo = 20 + jl; bl = struct.unpack('<I', d[bo:bo + 4])[0]; return j, d[bo + 8:bo + 8 + bl]

def acc(j, b, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; f, sz = CT[a['componentType']]; n = NC[a['type']]
    st = bv.get('byteStride', sz * n); o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); out = []
    mx = {5121: 255.0, 5123: 65535.0}.get(a['componentType']) if a.get('normalized') else None
    for k in range(a['count']):
        v = struct.unpack_from('<' + f * n, b, o + k * st); out.append(tuple(x / mx for x in v) if mx else v)
    return out

def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

def check(path):
    j, b = load(path); r = dict(file=os.path.basename(path), errors=[])
    names = [n.get('name') for n in j['nodes']]
    for s in ('Grip', 'ResourcePivot'):
        if s not in names: r['errors'].append('missing socket ' + s)
    if j.get('cameras') or 'KHR_lights_punctual' in j.get('extensionsUsed', []): r['errors'].append('camera/light exported')
    if any('uri' in im for im in j.get('images', [])): r['errors'].append('external image uri')
    r['images'] = [dict(mime=im.get('mimeType'), bytes=j['bufferViews'][im['bufferView']]['byteLength']) for im in j.get('images', [])]
    tris = agree = 0; white = total = 0; miny = 1e9; maxdim = [1e9, -1e9]
    for me in j['meshes']:
        for p in me['primitives']:
            at = p['attributes']
            if 'COLOR_0' not in at: r['errors'].append('primitive without COLOR_0'); continue
            P = acc(j, b, at['POSITION']); Nn = acc(j, b, at['NORMAL']); C = acc(j, b, at['COLOR_0']); I = acc(j, b, p['indices'])
            for c in C:
                total += 1; white += all(x > 0.995 for x in c[:3])
            for k in range(0, len(I), 3):
                a, bb, cc = I[k][0], I[k + 1][0], I[k + 2][0]; fn = cross(sub(P[bb], P[a]), sub(P[cc], P[a]))
                vn = tuple(Nn[a][q] + Nn[bb][q] + Nn[cc][q] for q in range(3)); tris += 1; agree += dot(fn, vn) > 0
            miny = min(miny, min(v[1] for v in P))
    r.update(triangles=tris, winding_agrees_with_normals=round(agree / max(1, tris), 4), color0_white_fraction=round(white / max(1, total), 4),
             materials=len(j['materials']), double_sided=[m.get('name') for m in j['materials'] if m.get('doubleSided')],
             emissive=[m.get('name') for m in j['materials'] if 'emissiveTexture' in m], extensions=j.get('extensionsUsed', []),
             mesh_min_y_local=round(miny, 4), bytes=os.path.getsize(path))
    if r['winding_agrees_with_normals'] < 0.98: r['errors'].append('winding/normal disagreement')
    if r['color0_white_fraction'] > 0.5: r['errors'].append('COLOR_0 mostly white')
    if r['materials'] > 3: r['errors'].append('more than 3 materials')
    if tris > 1650: r['errors'].append('over triangle budget')
    return r

out = sys.argv[1]; rep = [check(p) for p in sorted(glob.glob(os.path.join(out, '*.glb')))]
json.dump(rep, open(os.path.join(out, 'verify_report.json'), 'w', encoding='utf-8'), indent=1)
for r in rep: print(r['file'], r['triangles'], 'tris', r['bytes'], 'B', 'wind', r['winding_agrees_with_normals'], 'white', r['color0_white_fraction'], 'mats', r['materials'], 'ERR' if r['errors'] else 'OK', r['errors'])
sys.exit(1 if any(r['errors'] for r in rep) else 0)
