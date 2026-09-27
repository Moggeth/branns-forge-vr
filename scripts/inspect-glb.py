"""Read-only, dependency-free asset handoff inspection. Usage: python inspect-glb.py file.glb."""
import json
import pathlib
import struct
import sys

path = pathlib.Path(sys.argv[1])
data = path.read_bytes()
magic, version, length = struct.unpack_from('<III', data)
assert magic == 0x46546C67 and version == 2 and length == len(data), 'Invalid GLB header'
chunk_length, chunk_type = struct.unpack_from('<II', data, 12)
assert chunk_type == 0x4E4F534A, 'Missing JSON chunk'
doc = json.loads(data[20:20 + chunk_length])
assert all('uri' not in b for b in doc.get('buffers', [])), 'External buffer'
assert all('uri' not in i or i['uri'].startswith('data:') for i in doc.get('images', [])), 'External image'
nodes = doc.get('nodes', [])
meshes = doc.get('meshes', [])
accessors = doc.get('accessors', [])
triangles = sum(accessors[p['indices']]['count'] // 3 if 'indices' in p else accessors[p['attributes']['POSITION']]['count'] // 3 for m in meshes for p in m['primitives'] if p.get('mode', 4) == 4)
required = ['Bolt', 'Crank', 'CrankKnob', 'Pinion', 'Reduction', 'Drum', 'Sled', 'Clutch', 'Latch', 'Trigger', 'OpticRear', 'BoltSeat', 'GripAnchor', 'LiveCord']
parts = {name: next((n for n in nodes if n.get('name') == name), None) for name in required}
report = {'file': str(path), 'bytes': len(data), 'nodes': len(nodes), 'meshes': len(meshes), 'materials': len(doc.get('materials', [])), 'triangles': triangles,
          'parts': {k: {'translation': v.get('translation', [0, 0, 0]), 'rotation': v.get('rotation', [0, 0, 0, 1]), 'scale': v.get('scale', [1, 1, 1]), 'children': len(v.get('children', []))} if v else None for k, v in parts.items()},
          'morphs': {m.get('name', str(i)): m.get('extras', {}).get('targetNames', []) for i, m in enumerate(meshes) if any(p.get('targets') for p in m['primitives'])}}
print(json.dumps(report, indent=2))
if '--siegebird' in sys.argv:
    assert all(parts.values()), 'Missing required Siegebird node'
    assert len(parts['LiveCord'].get('children', [])) == 20, 'Requires 20 direct live cords'
    assert any('Drawn' in names and 'Narrow' in names for names in report['morphs'].values()), 'Missing limb flex morphs'
