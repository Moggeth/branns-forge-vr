"""Editable generation step B: hero meshing (smoothed bark tubes, root flare, leaf-card canopy) patched into tree_kit.gd."""
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, cnt)


rep('''		_mesh_trunk(buf, sk, 8 if near else 5)
	for t in sk.tubes:''', '''		_mesh_trunk(buf, sk, 8 if near else 5)
	var hero: bool = sk.hero
	if hero: _mesh_flare(buf, sk, near)
	for t in sk.tubes:''')
rep('''(kind == "branch" and sk.species == "apple")): continue
		var sides = (7 if kind in ["trunk", "limb"] else 5) if near else (4 if kind != "trunk" else 5)''',
    '''(kind in ["branch", "twig"] and sk.species == "apple")): continue
		var sides = (7 if kind in ["trunk", "limb", "leader"] else (6 if kind == "scaffold" else (4 if kind == "twig" else 5))) if near else (4 if kind != "trunk" else 5)''')
rep('''	var ico = _icosphere(1 if near else 0)
	var biggest = -1.0
	for b in sk.blobs: biggest = maxf(biggest, b.radius.x)
	for b in sk.blobs:
		var use: Array = ico''', '''	if hero and near:
		_mesh_canopy(buf, sk, pal)
	var ico = _icosphere(1 if near else 0)
	var biggest = -1.0
	for b in sk.blobs: biggest = maxf(biggest, b.radius.x)
	for b in sk.blobs:
		if hero and near: break
		var use: Array = ico''')
rep('''			if b.radius.x >= biggest: use = _icosphere(1)
		_mesh_blob(buf, sk, b, use, pal, rng)''', '''			if b.radius.x >= biggest: use = _icosphere(1)
			if hero:   # far hull sits at the mean card-shell radius so the LOD swap keeps the silhouette
				b = b.duplicate()
				b.radius = b.radius * 0.93
		_mesh_blob(buf, sk, b, use, pal, rng)''')

rep('''static func _mesh_tube(buf: MeshBuf, sk: Dictionary, pts: Array, radii: Array, sides: int, pal: Dictionary, rng: RandomNumberGenerator, is_root: bool) -> void:
	var rings = []''', '''## Catmull-Rom subdivision with a deterministic gnarl wobble (interior points only, roots stay on the ground plane).
static func _smooth_path(pts: Array, radii: Array, per: int, gnarl: float, flat: bool) -> Array:
	var out_p = []
	var out_r = []
	var n = pts.size()
	for k in n - 1:
		var p0: Vector3 = pts[maxi(k - 1, 0)]
		var p1: Vector3 = pts[k]
		var p2: Vector3 = pts[k + 1]
		var p3: Vector3 = pts[mini(k + 2, n - 1)]
		for s in per:
			var t = float(s) / float(per)
			var p: Vector3 = 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t)
			var r = lerpf(float(radii[k]), float(radii[k + 1]), t)
			if k > 0 or s > 0:
				var w = Vector3(sin(p.y * 7.1 + p.z * 3.3), 0.0 if flat else sin(p.z * 6.3 + p.x * 2.9) * 0.5, sin(p.x * 8.2 + p.y * 4.1))
				p += w * gnarl * r
				r *= 1.0 + 0.1 * sin(p.x * 5.0 + p.y * 9.0 + p.z * 4.0)
			out_p.append(p)
			out_r.append(r)
	out_p.append(pts[n - 1])
	out_r.append(radii[n - 1])
	return [out_p, out_r]

static func _mesh_tube(buf: MeshBuf, sk: Dictionary, pts: Array, radii: Array, sides: int, pal: Dictionary, rng: RandomNumberGenerator, is_root: bool) -> void:
	var hero: bool = sk.hero
	if hero and sides > 4:
		var big: float = radii[0]
		var sm = _smooth_path(pts, radii, 3 if big > 0.1 else (2 if big > 0.035 else 1), 0.4, is_root)
		pts = sm[0]
		radii = sm[1]
	var lengths = [0.0]
	for k in range(1, pts.size()): lengths.append(lengths[k - 1] + (pts[k] - pts[k - 1]).length())
	var rings = []''')
rep('''			var c = Color(bark[(i + k) % bark.size()])
			var fn = out.normalized()
			if fn.y > 0.45 and not is_root: c = c.lerp(moss, 0.35)
			c = c.darkened(rng.randf_range(0.0, 0.08))
			buf.quad(q[0], q[1], q[2], q[3], c, out, _wind_weight(sk, q[0]), _wind_weight(sk, q[1]), _wind_weight(sk, q[2]), _wind_weight(sk, q[3]))''',
    '''			var c = Color(bark[(i + k) % bark.size()])
			if hero: c = Color(bark[1]).lerp(c, 0.4)
			var fn = out.normalized()
			if fn.y > 0.45 and not is_root: c = c.lerp(moss, 0.35)
			c = c.darkened(rng.randf_range(0.0, 0.08))
			var uvs: Array = []
			if hero:
				var u0 = float(i) / float(sides)
				var u1 = float(i + 1) / float(sides)
				uvs = [Vector2(u0, lengths[k]), Vector2(u1, lengths[k]), Vector2(u1, lengths[k + 1]), Vector2(u0, lengths[k + 1])]
			buf.quad(q[0], q[1], q[2], q[3], c, out, _wind_weight(sk, q[0]), _wind_weight(sk, q[1]), _wind_weight(sk, q[2]), _wind_weight(sk, q[3]), 0.0, uvs, 2.0 if hero else 0.0)''')
rep('''		buf.tri(rings[last][i], rings[last][i1], apex, Color(bark[0]), (rings[last][i] + rings[last][i1]) * 0.5 - pts[last] + dir * 0.3 * float(radii[last]), _wind_weight(sk, rings[last][i]), _wind_weight(sk, rings[last][i1]), _wind_weight(sk, apex))''',
    '''		var cap_uv: Array = [Vector2(float(i) / float(sides), lengths[last]), Vector2(float(i1) / float(sides), lengths[last]), Vector2(0.5, lengths[last] + float(radii[last]) * 1.5)] if hero else []
		buf.tri(rings[last][i], rings[last][i1], apex, Color(bark[0]), (rings[last][i] + rings[last][i1]) * 0.5 - pts[last] + dir * 0.3 * float(radii[last]), _wind_weight(sk, rings[last][i]), _wind_weight(sk, rings[last][i1]), _wind_weight(sk, apex), 0.0, cap_uv, 2.0 if hero else 0.0)''')

rep("static func _mesh_twig(", '''## Buttressed root flare: lobes line up with the root tubes, sink 0.18 m below the soil line and blend into the trunk
## (the last ring is buried inside the chop trunk, which keeps its exact notch-compatible shape above ~0.5 m).
static func _mesh_flare(buf: MeshBuf, sk: Dictionary, near: bool) -> void:
	var t: Dictionary = sk.trunk
	var r0: float = t.radius
	var height: float = t.height
	var axis: Vector3 = t.axis
	var side = axis.cross(Vector3.FORWARD if absf(axis.z) < 0.9 else Vector3.RIGHT).normalized()
	var fwd = side.cross(axis).normalized()
	var azs = []
	for tb in sk.tubes:
		if tb.kind == "root": azs.append(atan2(tb.points.back().z, tb.points.back().x))
	var ys = [-0.18, 0.0, 0.14, 0.3, 0.55]
	var fs = [0.85, 1.0, 0.62, 0.26, 0.0]
	var sides = 12 if near else 8
	var bark: Array = sk.palette.bark
	var rings = []
	for j in ys.size():
		var y: float = ys[j]
		var tr = r0 * (1.0 - 0.5 * maxf(y, 0.0) / height)
		var ring = []
		for i in sides:
			var a = TAU * float(i) / float(sides)
			var dir: Vector3 = side * cos(a) + fwd * sin(a)
			var az = atan2(dir.z, dir.x)
			var lobe = 0.0
			for ra in azs: lobe = maxf(lobe, pow(maxf(cos(az - ra), 0.0), 4.0))
			var rad = tr * (1.0 + float(fs[j]) * (0.26 + 0.95 * lobe)) if j < ys.size() - 1 else tr * 0.9
			ring.append(t.base + axis * y + dir * rad)
		rings.append(ring)
	var moss = Color(sk.palette.get("moss", bark[0]))
	for j in ys.size() - 1:
		for i in sides:
			var i1 = (i + 1) % sides
			var q = [rings[j][i], rings[j][i1], rings[j + 1][i1], rings[j + 1][i]]
			var face_c: Vector3 = (q[0] + q[1] + q[2] + q[3]) * 0.25
			var out = face_c - (t.base + axis * (float(ys[j]) + float(ys[j + 1])) * 0.5)
			var c = Color(bark[1]).lerp(Color(bark[(i + j) % bark.size()]), 0.4)
			if out.normalized().y > 0.35: c = c.lerp(moss, 0.3)
			var u0 = float(i) / float(sides)
			var u1 = float(i + 1) / float(sides)
			buf.quad(q[0], q[1], q[2], q[3], c, out, 0, 0, 0, 0, 0.0, [Vector2(u0, ys[j]), Vector2(u1, ys[j]), Vector2(u1, ys[j + 1]), Vector2(u0, ys[j + 1])], 2.0)

## Layered canopy: every blob and clump becomes a shell of double-sided alpha-scissor leaf cards (soft volumetric normals,
## inner cards darker) around a dark low-poly core, so branches show through and the edge breaks into small clusters.
static func _mesh_canopy(buf: MeshBuf, sk: Dictionary, pal: Dictionary) -> void:
	var crng = _rng(sk.species, sk.seed, 77)
	var avoid = []
	for f in sk.fruit: avoid.append(f.pos)
	for p in sk.reach_points: avoid.append(p)
	for b in sk.blobs:
		_mesh_core(buf, sk, b, pal)
		_mesh_leaf_mass(buf, sk, b, pal, crng, avoid, 1.0, 0.5)
	for c in sk.clumps:
		_mesh_leaf_mass(buf, sk, c, pal, crng, avoid, 1.25, 0.6)

static func _mesh_core(buf: MeshBuf, sk: Dictionary, b: Dictionary, pal: Dictionary) -> void:
	var ico: Array = _icosphere(0)
	var col = Color(pal.leaf_dark).lerp(Color(pal.leaf[int(b.ci) % pal.leaf.size()]), 0.22)
	var c: Vector3 = b.center + Vector3.DOWN * b.radius.y * 0.08
	var r: Vector3 = b.radius * 0.5
	for face in ico[1]:
		var p = []
		for k in 3: p.append(c + Vector3(ico[0][face[k]].x * r.x, ico[0][face[k]].y * r.y, ico[0][face[k]].z * r.z))
		buf.tri(p[0], p[1], p[2], col, (p[0] + p[1] + p[2]) / 3.0 - c, _wind_weight(sk, p[0]), _wind_weight(sk, p[1]), _wind_weight(sk, p[2]), 0.0, [], 3.0)

static func _mesh_leaf_mass(buf: MeshBuf, sk: Dictionary, b: Dictionary, pal: Dictionary, crng: RandomNumberGenerator, avoid: Array, density: float, shell: float) -> void:
	var leaves: Array = pal.leaf
	var base = Color(leaves[int(b.ci) % leaves.size()])
	var light = Color(pal.leaf_light)
	var dark = Color(pal.leaf_dark)
	var r: Vector3 = b.radius
	var rm = (r.x + r.z) * 0.5
	var n = clampi(int(density * rm * rm * 62.0), 7, 120)
	var inv = Vector3(1.0 / (r.x * r.x), 1.0 / (r.y * r.y), 1.0 / (r.z * r.z))
	var crown_axis = Vector3(0, b.center.y, 0)
	var reach: float = sk.height * 0.42
	var uvs = [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
	for i in n:
		# Fixed draw order per card keeps the sequence identical whether or not a card is skipped.
		var d = Vector3(crng.randf_range(-1.0, 1.0), crng.randf_range(-0.8, 1.0), crng.randf_range(-1.0, 1.0))
		var dev = Vector3(crng.randf_range(-1.0, 1.0), crng.randf_range(-1.0, 1.0), crng.randf_range(-1.0, 1.0))
		var jit = crng.randf_range(-0.07, 0.07)
		var tone = Color(leaves[crng.randi() % leaves.size()])
		var roll = crng.randf() * TAU
		var ragged = crng.randf() < 0.14
		var depth = pow(crng.randf(), 1.6) * shell
		var size_k = crng.randf_range(0.36, 0.58)
		var k = crng.randf_range(1.02, 1.16) if ragged else 1.0 - depth
		if d.length_squared() < 0.04: continue
		d = d.normalized()
		var surf = _blob_surface(b, d)
		var p: Vector3 = b.center + (surf - b.center) * k
		var nrm_e = ((p - b.center) * inv).normalized()
		var horiz = clampf(Vector2(p.x, p.z).length() / reach, 0.0, 1.0)
		var size = size_k * lerpf(1.0, 0.72, horiz) * (0.62 if ragged else 1.0) * (1.0 - 0.2 * depth / shell)
		var blocked = false
		for q in avoid:
			if p.distance_to(q) < size * 0.5 + 0.14:
				blocked = true
				break
		if blocked: continue
		var face = (nrm_e + Vector3.UP * 0.55 + dev * 0.5).normalized()
		var right = face.cross(Vector3.UP)
		if right.length_squared() < 0.05: right = Vector3.RIGHT
		right = right.normalized()
		var upv = face.cross(right).normalized()
		var rr = right.rotated(face, roll) * size * 0.5
		var uu = upv.rotated(face, roll) * size * 0.5
		var q4 = [p - rr - uu, p + rr - uu, p + rr + uu, p - rr + uu]
		var col = base.lerp(tone, 0.45)
		col = col.lerp(light, clampf(nrm_e.y, 0.0, 1.0) * 0.35) if nrm_e.y > 0.0 else col.lerp(dark, clampf(-nrm_e.y, 0.0, 1.0) * 0.45)
		col = col.darkened(depth / shell * 0.35)
		if (p - crown_axis).dot(nrm_e) < 0.0: col = col.darkened(0.14)
		col = Color(col.r * (1.0 + jit), col.g * (1.0 + jit), col.b * (1.0 + jit * 0.6))
		var ns = []
		var ws = []
		for corner in q4:
			ns.append((((corner - b.center) * inv).normalized() * 0.7 + Vector3.UP * 0.3).normalized())
			ws.append(_wind_weight(sk, corner))
		buf.card(q4, ns, col, ws, uvs)

static func _mesh_twig(''')
open(p, 'w', encoding='utf-8').write(s)
