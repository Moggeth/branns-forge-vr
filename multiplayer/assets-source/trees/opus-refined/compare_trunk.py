"""Byte-compare the Trunk mesh (every accessor: indices + all attributes) and node/material contract between
the original Sonnet GLBs and the refined GLBs.  python compare_trunk.py ORIG_DIR NEW_DIR"""
import json, struct, sys, os, hashlib

def load(path):
    d = open(path, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl])
    b0 = 20 + jl; bl = struct.unpack('<I', d[b0:b0 + 4])[0]; bin_ = d[b0 + 8:b0 + 8 + bl]
    return j, bin_

def acc_bytes(j, b, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    comp = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    stride = bv.get('byteStride', comp * n); off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return b''.join(b[off + k * stride: off + k * stride + comp * n] for k in range(a['count'])), a

def node_world(j, name):
    for nd in j['nodes']:
        if nd.get('name') == name: return nd.get('translation', [0, 0, 0]), nd.get('rotation', [0, 0, 0, 1]), nd.get('scale', [1, 1, 1])

def trunk(j, b):
    m = [m for m in j['meshes'] if m['name'] == 'Trunk'][0]; out = {}
    for pi, p in enumerate(m['primitives']):
        out['p%d.indices' % pi] = acc_bytes(j, b, p['indices'])
        for k, v in sorted(p['attributes'].items()): out['p%d.%s' % (pi, k)] = acc_bytes(j, b, v)
        out['p%d.material' % pi] = (j['materials'][p['material']]['name'].encode(), {})
    return out

ok_all = True; od, nd_ = sys.argv[1], sys.argv[2]
for nm in ('tree', 'tree_lod', 'tree_b', 'tree_b_lod', 'tree_young', 'tree_young_lod'):
    jo, bo = load(os.path.join(od, nm + '.glb')); jn, bn = load(os.path.join(nd_, nm + '.glb'))
    to, tn = trunk(jo, bo), trunk(jn, bn); rows = []
    ok = set(to) == set(tn)
    for k in sorted(to):
        a, b_ = to[k][0], tn.get(k, (b'', {}))[0]; same = a == b_; ok &= same
        rows.append('%s:%s(%d B %s)' % (k, 'EXACT' if same else 'DIFF', len(a), hashlib.sha1(a).hexdigest()[:8]))
    names_o = [n.get('name') for n in jo['nodes']]; names_n = [n.get('name') for n in jn['nodes']]
    same_nodes = names_o == names_n; ok &= same_nodes
    tr = all(node_world(jo, n) == node_world(jn, n) for n in ('Tree', 'Trunk', 'Ground', 'CutGuide'))
    ok &= tr
    mats_o = [m['name'] for m in jo['materials']]; mats_n = [m['name'] for m in jn['materials']]; ok &= mats_o == mats_n
    print('%-15s %s nodes=%s ground/cut/root/trunk-xform=%s materials=%s' % (nm, 'TRUNK EXACT' if ok else 'MISMATCH', same_nodes, tr, mats_n))
    print('   ', ' '.join(rows))
    ok_all &= ok
print('ALL TRUNK ACCESSORS + NODES EXACT' if ok_all else 'MISMATCH FOUND'); sys.exit(0 if ok_all else 1)
