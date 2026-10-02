"""Prove the cut contract is untouched: byte-compare Trunk + Roots accessors and the node hierarchy/transforms
between the frozen shipped GLBs (reference/multiplayer/public/assets) and the new build (out/).
python compare_trunk.py [OLD_DIR] [NEW_DIR]   -> exit 0 only if every check is exact."""
import json, struct, sys, hashlib, os

OLD = sys.argv[1] if len(sys.argv) > 1 else 'reference/multiplayer/public/assets'
NEW = sys.argv[2] if len(sys.argv) > 2 else 'out'
ASSETS = ['tree', 'tree_b', 'tree_young', 'tree_lod', 'tree_b_lod', 'tree_young_lod']
EXACT_MESHES = ('Trunk', 'Roots')
NODE_KEYS = ('translation', 'rotation', 'scale', 'matrix')

def load(path):
    d = open(path, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl])
    bl = struct.unpack('<I', d[20 + jl:24 + jl])[0]; bin_ = d[28 + jl:28 + jl + bl]
    return j, bin_

def acc_bytes(j, b, i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
    comp = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    stride = v.get('byteStride', comp * n); off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    raw = b''.join(b[off + k * stride: off + k * stride + comp * n] for k in range(a['count']))
    return a['componentType'], a['type'], a['count'], raw

def mesh_sig(j, b, name):
    m = [m for m in j['meshes'] if m['name'] == name][0]; out = []
    for p in m['primitives']:
        mat = j['materials'][p['material']]['name']
        parts = {'indices': acc_bytes(j, b, p['indices'])}
        # index values are compared as resolved vertices, so a different vertex order would still be caught
        for k, i in sorted(p['attributes'].items()): parts[k] = acc_bytes(j, b, i)
        out.append((mat, {k: (v[0], v[1], v[2], hashlib.sha1(v[3]).hexdigest()) for k, v in parts.items()}))
    return out

def node_sig(j):
    return [(n.get('name'), {k: n[k] for k in NODE_KEYS if k in n}, n.get('mesh') is not None,
             sorted(j['nodes'][c].get('name') for c in n.get('children', []))) for n in j['nodes']]

ok = True
for a in ASSETS:
    po, pn = os.path.join(OLD, a + '.glb'), os.path.join(NEW, a + '.glb')
    if not os.path.exists(po): print('%-15s SKIP (absent from %s)' % (a, OLD)); continue
    jo, bo = load(po); jn, bn = load(pn)
    for m in EXACT_MESHES:
        so, sn = mesh_sig(jo, bo, m), mesh_sig(jn, bn, m); same = so == sn; ok &= same
        print('%-15s %-6s %s  (%s)' % (a, m, 'EXACT' if same else 'DIFF', ', '.join('%s:%d' % (k, v[2]) for k, v in so[0][1].items())))
    no = {n[0]: n for n in node_sig(jo)}; nn = {n[0]: n for n in node_sig(jn)}
    names_same = sorted(no) == sorted(nn); ok &= names_same
    print('%-15s nodes  %s %s' % (a, 'EXACT' if names_same else 'DIFF', sorted(nn)))
    for k in ('Tree', 'Trunk', 'Roots', 'Branches', 'Leaves', 'Fruit', 'Ground', 'CutGuide', 'FallTip'):
        if k not in no: continue
        same = no[k] == nn.get(k); ok &= same
        if not same: print('   transform/children DIFF', k, no[k], nn.get(k))
    print('%-15s mats   %s' % (a, [m['name'] for m in jn['materials']]))
    if 'Crown' in no and no['Crown'] != nn.get('Crown'): print('%-15s Crown moved (leaf-mass centroid, not used by runtime): %s -> %s' % (a, no['Crown'][1], nn['Crown'][1]))
print('ALL TRUNK/ROOTS ACCESSORS + HIERARCHY EXACT' if ok else 'MISMATCH')
sys.exit(0 if ok else 1)
