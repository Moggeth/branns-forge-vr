extends RefCounted
## Mining Update visual vocabulary: surface fractures that accumulate with work,
## detached crystal treasure, stariron shell chips and 6(+4) shared materials.
## Self-contained: no images, no scenes, no per-frame code. Everything is built
## once, cached statically and shared. Visuals only; the host owns health/timers.
##
## Geometry contract
##  * crack_mesh: centred on the XY plane, +Z is the surface normal, ~0.32 m
##    footprint (radius <= 0.16 m). Relief only, 4 mm .. 18 mm above the plane.
##  * All triangles are opaque, front faces are clockwise (Godot convention) and
##    carry outward flat normals. No alpha, no cull_disabled, no discs/spheres.
##  * Surfaces: 0 fissure (rim/lip/dark floor), 1 strata shards, 2 glowing
##    mineral slivers (stage 3 only). Materials are already assigned.
## Vertex COLOR (all surface-shader meshes): rgb = tint, a = 1 - fresh (default white = plain crust; a=0 = fresh break)
## (bright fracture face / metallic break / glow). Crystal meshes use the
## crystal contract: r base..tip, g facet random, b hue mix, a bevel strip.

const KINDS := ["stone", "iron", "crystal", "meteor", "ice", "obsidian"]
const EXTRA_KINDS := ["fissure", "fissure_hot", "strata", "vein"]
const CRACK_VARIANTS := 4
const CRYSTAL_VARIANTS := 6
const CHIP_VARIANTS := 6
const FOOT_R := 0.16
const Z0 := 0.004

const STAGES := {
	1: {"len": 0.17, "w": 0.0055, "branches": 1, "sub": 0, "chips": 4, "big": 0, "slivers": 0, "step": 0.032, "rh": 0.007},
	2: {"len": 0.25, "w": 0.009, "branches": 3, "sub": 2, "chips": 10, "big": 1, "slivers": 0, "step": 0.034, "rh": 0.010},
	3: {"len": 0.31, "w": 0.015, "branches": 6, "sub": 4, "chips": 18, "big": 3, "slivers": 14, "step": 0.036, "rh": 0.014},
}

static var _cache: Dictionary = {}
static var _materials: Dictionary = {}
static var _surface_shader: Shader
static var _crystal_shader: Shader

# ------------------------------------------------------------------ public API

static func crack_mesh(stage: int, seed: int = 0) -> ArrayMesh:
	stage = clampi(stage, 1, 3)
	var variant := absi(seed) % CRACK_VARIANTS
	var key := "crack_%d_%d" % [stage, variant]
	if not _cache.has(key):
		_cache[key] = _build_crack(stage, variant)
	return _cache[key]

static func crystal_mesh(seed: int = 0) -> ArrayMesh:
	var variant := absi(seed) % CRYSTAL_VARIANTS
	var key := "crystal_%d" % variant
	if not _cache.has(key):
		_cache[key] = _build_crystal(variant)
	return _cache[key]

static func shell_chip_mesh(seed: int = 0) -> ArrayMesh:
	var variant := absi(seed) % CHIP_VARIANTS
	var key := "chip_%d" % variant
	if not _cache.has(key):
		_cache[key] = _build_chip(variant)
	return _cache[key]

static func material(kind: String) -> Material:
	if not _materials.has(kind):
		_materials[kind] = _make_material(kind)
	return _materials[kind]

## Parent gets one Node3D at `point` whose +Z is `normal`, carrying one cached
## crack mesh. Rolled by the seed so repeated hits never tile. Static, no script.
static func decorate_site(parent: Node3D, point: Vector3, normal: Vector3, stage: int, seed: int) -> Node3D:
	var site := Node3D.new()
	site.name = "MiningSite_%d" % clampi(stage, 1, 3)
	var z := normal.normalized() if normal.length_squared() > 1e-8 else Vector3.UP
	var up_hint := Vector3.RIGHT if absf(z.y) > 0.99 else Vector3.UP
	var x := up_hint.cross(z).normalized()
	var y := z.cross(x)
	var roll := float(absi(hash(seed * 31 + 7)) % 6283) / 1000.0
	var basis := Basis(x, y, z) * Basis(Vector3.BACK, roll)
	var instance := MeshInstance3D.new()
	instance.mesh = crack_mesh(stage, seed)
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	instance.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	site.add_child(instance)
	parent.add_child(site)
	site.global_transform = Transform3D(basis, point + z * 0.002)
	return site

static func warm_cache() -> void:
	for kind in KINDS: material(kind)
	for kind in EXTRA_KINDS: material(kind)
	for s in range(1, 4):
		for v in CRACK_VARIANTS: crack_mesh(s, v)
	for v in CRYSTAL_VARIANTS: crystal_mesh(v)
	for v in CHIP_VARIANTS: shell_chip_mesh(v)

static func triangle_count(mesh: ArrayMesh) -> int:
	var total := 0
	for s in mesh.get_surface_count():
		total += (mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX] as PackedVector3Array).size() / 3
	return total

# ------------------------------------------------------------------- builder

class _B:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()

	## Orients every triangle against `hint` so front faces are clockwise and the
	## stored flat normal faces outward (Godot front face == clockwise).
	func tri(a: Vector3, b: Vector3, d: Vector3, ca: Color, cb: Color, cd: Color, hint: Vector3) -> void:
		var fn := (d - a).cross(b - a)
		if fn.length_squared() < 1e-12: return
		fn = fn.normalized()
		if fn.dot(hint) < 0.0:
			var tv := b; b = d; d = tv
			var tc := cb; cb = cd; cd = tc
			fn = -fn
		v.push_back(a); v.push_back(b); v.push_back(d)
		c.push_back(ca); c.push_back(cb); c.push_back(cd)
		n.push_back(fn); n.push_back(fn); n.push_back(fn)

	func quad(a: Vector3, b: Vector3, d: Vector3, e: Vector3, ca: Color, cb: Color, cd: Color, ce: Color, hint: Vector3) -> void:
		tri(a, b, d, ca, cb, cd, hint)
		tri(a, d, e, ca, cd, ce, hint)

	## `crust_alpha`: store a = 1 - fresh so a default white COLOR means plain crust.
	func commit(mesh: ArrayMesh, mat: Material, crust_alpha: bool = true) -> void:
		if v.is_empty(): return
		if crust_alpha:
			for i in c.size(): c[i].a = 1.0 - c[i].a
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = v
		arrays[Mesh.ARRAY_NORMAL] = n
		arrays[Mesh.ARRAY_COLOR] = c
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(mesh.get_surface_count() - 1, mat)

# ------------------------------------------------------------------- cracks

const _SKIRT := Color(0.10, 0.085, 0.07, 0.0)
const _CREST := Color(0.30, 0.27, 0.24, 0.06)
const _LIP := Color(0.62, 0.44, 0.30, 1.0)
const _FLOOR := Color(0.012, 0.010, 0.010, 0.0)
const _FLOOR_HOT := Color(0.010, 0.05, 0.065, 0.0)

static func _build_crack(stage: int, variant: int) -> ArrayMesh:
	var cfg: Dictionary = STAGES[stage]
	var rng := RandomNumberGenerator.new()
	rng.seed = 7311 + stage * 977 + variant * 131
	var step: float = cfg.step
	var length: float = cfg.len
	var wmax: float = cfg.w
	var base_ang := rng.randf() * TAU
	var dir := Vector2(cos(base_ang), sin(base_ang))
	var start := -dir * length * 0.5 + Vector2(rng.randf_range(-0.012, 0.012), rng.randf_range(-0.012, 0.012))
	var paths: Array = []
	paths.append(_path(rng, start, base_ang + rng.randf_range(-0.15, 0.15), length, step, 0.22, wmax, true, stage == 3))
	for k in int(cfg.branches):
		_spawn(rng, paths, 0 if k < 4 else 1 + rng.randi() % maxi(1, paths.size() - 1), 0.62, 0.55 if stage > 1 else 0.5, step)
	for k in int(cfg.sub):
		if paths.size() < 2: break
		_spawn(rng, paths, 1 + rng.randi() % (paths.size() - 1), 0.6, 0.5, step)

	var fiss := _B.new()
	var strata := _B.new()
	var vein := _B.new()
	for i in paths.size():
		_ribbon(fiss, rng, paths[i], i == 0, float(cfg.rh), stage == 3)
	_scatter_chips(strata, rng, paths, cfg, stage)
	if stage == 3: _scatter_slivers(vein, rng, paths, int(cfg.slivers))

	var mesh := ArrayMesh.new()
	fiss.commit(mesh, material("fissure_hot" if stage == 3 else "fissure"))
	strata.commit(mesh, material("strata"))
	vein.commit(mesh, material("vein"))
	return mesh

static func _path(rng: RandomNumberGenerator, start: Vector2, ang: float, length: float, step: float,
		jag: float, wmax: float, is_main: bool, mouth: bool) -> Dictionary:
	var pts: Array[Vector2] = [start]
	var p := start
	var a := ang
	for i in maxi(2, int(round(length / step))):
		a += rng.randfn(0.0, jag)
		if rng.randf() < 0.22: a += rng.randf_range(-0.8, 0.8)
		var d := Vector2(cos(a), sin(a))
		var nxt := p + d * step * rng.randf_range(0.75, 1.3)
		if nxt.length() > FOOT_R:
			var b := p.dot(d)
			var s := -b + sqrt(maxf(b * b - (p.length_squared() - FOOT_R * FOOT_R), 0.0))
			if s > step * 0.3: pts.append(p + d * s)
			break
		p = nxt
		pts.append(p)
	var count := pts.size()
	var wl: Array[float] = []
	var wr: Array[float] = []
	var total := 0.0
	for i in count:
		var t := float(i) / maxf(1.0, count - 1.0)
		var prof := pow(maxf(sin(PI * t), 0.0), 0.65) if is_main else pow(1.0 - t, 0.85)
		if mouth and is_main: prof *= 1.0 + 0.7 * exp(-pow((t - 0.45) / 0.12, 2.0))
		wl.append(maxf(wmax * prof * rng.randf_range(0.7, 1.3), 0.0007))
		wr.append(maxf(wmax * prof * rng.randf_range(0.7, 1.3), 0.0007))
		if i > 0: total += pts[i].distance_to(pts[i - 1])
	return {"pts": pts, "wl": wl, "wr": wr, "wmax": wmax, "length": total, "notch": [], "used": [], "main": is_main, "wide": is_main}

static func _spawn(rng: RandomNumberGenerator, paths: Array, parent_idx: int, w_scale: float, len_frac: float, step: float) -> void:
	var parent: Dictionary = paths[parent_idx]
	var pts: Array[Vector2] = parent.pts
	if pts.size() < 4: return
	for attempt in 6:
		var j := rng.randi_range(1, pts.size() - 2)
		var clash := false
		for u in parent.used:
			if absi(int(u) - j) < 2: clash = true
		if clash: continue
		var tangent := (pts[j + 1] - pts[j - 1]).angle()
		var side := 1.0 if rng.randf() < 0.5 else -1.0
		var ang := tangent + side * rng.randf_range(0.5, 1.1)
		var length: float = float(parent.length) * len_frac * rng.randf_range(0.7, 1.2)
		var child := _path(rng, pts[j], ang, length, step * 0.9, 0.3, float(parent.wmax) * w_scale, false, false)
		if (child.pts as Array).size() < 3: continue
		parent.used.append(j)
		parent.notch.append([j, int(side)])
		paths.append(child)
		return

## Cross-section kinds: 0 skirt, 1 crest, 2 lip, 3 floor edge, 4 centre.
static func _dist(kind: int, w: float, rim: float) -> float:
	match kind:
		0: return w + rim + 0.004
		1: return w + rim * 0.5
		2: return w
		3: return w * 0.5
	return 0.0

static func _ribbon(b: _B, rng: RandomNumberGenerator, path: Dictionary, wide: bool, rh_base: float, hot: bool) -> void:
	var pts: Array[Vector2] = path.pts
	var wl: Array[float] = path.wl
	var wr: Array[float] = path.wr
	var n := pts.size()
	var profile: Array = [[0, 1], [1, 1], [2, 1], [4, 0], [2, -1], [1, -1], [0, -1]]
	if true: profile = [[0, 1], [1, 1], [2, 1], [3, 1], [4, 0], [3, -1], [2, -1], [1, -1], [0, -1]]
	var rows: Array = []
	for i in n:
		var tan := (pts[mini(i + 1, n - 1)] - pts[maxi(i - 1, 0)]).normalized()
		var nl := Vector2(-tan.y, tan.x)
		var miter := 1.0
		if i > 0 and i < n - 1:
			var d1 := (pts[i] - pts[i - 1]).normalized()
			miter = 1.0 / clampf(nl.dot(Vector2(-d1.y, d1.x)), 0.55, 1.0)
		var mult := [1.0, 1.0]
		if not path.main: mult = [clampf(i / 1.8, 0.0, 1.0), clampf(i / 1.8, 0.0, 1.0)]
		for nt in path.notch:
			var side_index := 0 if int(nt[1]) > 0 else 1
			mult[side_index] = minf(mult[side_index], clampf(absf(i - int(nt[0])) / 1.6, 0.0, 1.0))
		var row: Array = []
		for entry in profile:
			var kind: int = entry[0]
			var side: int = entry[1]
			var w: float = wl[i] if side >= 0 else wr[i]
			var rim := 0.003 + 0.35 * w
			var m: float = mult[0] if side >= 0 else mult[1]
			var rh := rh_base * m * rng.randf_range(0.8, 1.2)
			var xy := pts[i] + nl * float(side) * _dist(kind, w, rim) * miter
			var z := Z0
			var col := _FLOOR_HOT if hot else _FLOOR
			match kind:
				0:
					col = _SKIRT
				1:
					z += rh
					col = _CREST * rng.randf_range(0.85, 1.12)
					col.a = 0.06 * m
				2:
					z += rh * 0.5
					col = _LIP
					col.a = 0.55 + 0.45 * m
			row.append([Vector3(xy.x, xy.y, z), col])
		rows.append(row)
	for i in n - 1:
		for k in profile.size() - 1:
			var p0: Array = rows[i][k]
			var p1: Array = rows[i][k + 1]
			var p2: Array = rows[i + 1][k + 1]
			var p3: Array = rows[i + 1][k]
			b.quad(p0[0], p1[0], p2[0], p3[0], p0[1], p1[1], p2[1], p3[1], Vector3.BACK)

static func _path_point(path: Dictionary, i: int) -> Array:
	var pts: Array[Vector2] = path.pts
	var n := pts.size()
	var tan := (pts[mini(i + 1, n - 1)] - pts[maxi(i - 1, 0)]).normalized()
	return [pts[i], Vector2(-tan.y, tan.x), tan]

static func _scatter_chips(b: _B, rng: RandomNumberGenerator, paths: Array, cfg: Dictionary, stage: int) -> void:
	var total := int(cfg.chips)
	var big := int(cfg.big)
	var placed := 0
	var guard := 0
	while placed < total and guard < total * 8:
		guard += 1
		var path: Dictionary = paths[rng.randi() % paths.size()]
		var i := rng.randi_range(0, (path.pts as Array).size() - 1)
		var info := _path_point(path, i)
		var side := 1.0 if rng.randf() < 0.5 else -1.0
		var w: float = (path.wl[i] if side > 0 else path.wr[i])
		var size := rng.randf_range(0.005, 0.011) * (0.8 + 0.25 * stage)
		if placed < big: size *= 1.7
		var pos: Vector2 = info[0] + info[1] * side * (w + 0.003 + 0.35 * w + rng.randf_range(0.008, 0.03) + size)
		if pos.length() + size * 1.5 > FOOT_R + 0.005: continue
		_chip(b, rng, pos, size, rng.randf() * TAU, size * rng.randf_range(0.45, 0.9))
		placed += 1

static func _chip(b: _B, rng: RandomNumberGenerator, centre: Vector2, size: float, rot: float, height: float) -> void:
	var sides := rng.randi_range(4, 5)
	var sx := size * rng.randf_range(0.8, 1.6)
	var sy := size * rng.randf_range(0.5, 1.0)
	var base: Array[Vector3] = []
	var top: Array[Vector3] = []
	for k in sides:
		var a := TAU * (float(k) + rng.randf_range(-0.2, 0.2)) / sides
		var local := Vector2(cos(a) * sx, sin(a) * sy).rotated(rot)
		base.append(Vector3(centre.x + local.x, centre.y + local.y, Z0))
		top.append(Vector3(centre.x + local.x * 0.5, centre.y + local.y * 0.5, Z0 + height * rng.randf_range(0.6, 1.0)))
	var apex := Vector3(centre.x + rng.randf_range(-0.2, 0.2) * sx, centre.y + rng.randf_range(-0.2, 0.2) * sy, Z0 + height * 1.15)
	var inside := Vector3(centre.x, centre.y, Z0 - 0.002)
	var dark := Color(0.17, 0.14, 0.11, 0.0) * rng.randf_range(0.8, 1.2)
	dark.a = 0.0
	var warm := Color(0.8, 0.62, 0.42, 1.0)
	for k in sides:
		var k1 := (k + 1) % sides
		var hint := (base[k] + base[k1] + top[k] + top[k1]) * 0.25 - inside
		b.quad(base[k], base[k1], top[k1], top[k], dark, dark, warm, warm, hint)
		var th := (top[k] + top[k1] + apex) / 3.0 - inside
		b.tri(top[k], top[k1], apex, warm, warm, Color(0.95, 0.8, 0.6, 1.0), th)

static func _scatter_slivers(b: _B, rng: RandomNumberGenerator, paths: Array, count: int) -> void:
	var main: Dictionary = paths[0]
	var tries := 0
	var placed := 0
	while placed < count and tries < count * 10:
		tries += 1
		var path: Dictionary = paths[0] if rng.randf() < 0.6 or paths.size() < 2 else paths[1 + rng.randi() % (paths.size() - 1)]
		var i := rng.randi_range(1, (path.pts as Array).size() - 2)
		var w := minf(path.wl[i], path.wr[i])
		if w < 0.0045: continue
		var info := _path_point(path, i)
		var pos: Vector2 = info[0] + info[1] * rng.randf_range(-0.3, 0.3) * w
		var tangent: Vector2 = (info[2] as Vector2).rotated(rng.randf_range(-0.5, 0.5))
		var roll := rng.randf()
		var col := Color(0.15, 0.9, 1.0) if roll < 0.45 else (Color(0.7, 0.35, 1.0) if roll < 0.8 else Color(1.0, 0.62, 0.16))
		_sliver(b, rng, pos, tangent, rng.randf_range(0.026, 0.05), clampf(w * rng.randf_range(0.5, 0.8), 0.0035, 0.008),
			rng.randf_range(0.013, 0.028), col)
		placed += 1

static func _sliver(b: _B, rng: RandomNumberGenerator, at: Vector2, u2: Vector2, length: float, hw: float, height: float, col: Color) -> void:
	var u := Vector3(u2.x, u2.y, 0.0)
	var v := Vector3(-u2.y, u2.x, 0.0)
	var o := Vector3(at.x, at.y, Z0)
	var lean := rng.randf_range(-0.6, 0.6) * height
	var front := o + u * length * 0.5
	var left := o + v * hw
	var back := o - u * length * 0.5
	var right := o - v * hw
	var r1 := o + u * length * 0.12 + v * lean * 0.5 + Vector3(0.0, 0.0, height)
	var r2 := o - u * length * 0.22 + v * lean * 0.3 + Vector3(0.0, 0.0, height * 0.58)
	var low := col * 0.55
	low.a = 0.3
	var mid := col
	mid.a = 0.65
	var hi := col.lerp(Color.WHITE, 0.2)
	hi.a = 1.0
	var inside := o + Vector3(0.0, 0.0, height * 0.2)
	b.tri(front, left, r1, low, low, hi, (front + left + r1) / 3.0 - inside)
	b.tri(front, r1, right, low, hi, low, (front + r1 + right) / 3.0 - inside)
	b.tri(left, back, r2, low, low, mid, (left + back + r2) / 3.0 - inside)
	b.tri(left, r2, r1, low, mid, hi, (left + r2 + r1) / 3.0 - inside)
	b.tri(right, r1, r2, low, hi, mid, (right + r1 + r2) / 3.0 - inside)
	b.tri(right, r2, back, low, mid, low, (right + r2 + back) / 3.0 - inside)

# ------------------------------------------------------------------ crystals

static func _build_crystal(variant: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = 4400 + variant * 53
	var b := _B.new()
	var hue := float(variant % 3) / 2.0 * 0.8 + rng.randf() * 0.15
	_shard(b, rng, Vector3(0.0, -0.09, 0.0), Vector3(rng.randf_range(-0.08, 0.08), 1.0, rng.randf_range(-0.08, 0.08)),
		0.04, 0.17, rng.randi_range(5, 6), hue)
	var count := rng.randi_range(2, 3)
	for i in count:
		var a := TAU * (float(i) + rng.randf() * 0.6) / count + variant
		var lean := rng.randf_range(0.35, 0.8)
		var dir := Vector3(cos(a) * lean, 1.0, sin(a) * lean).normalized()
		_shard(b, rng, Vector3(cos(a) * 0.028, -0.09, sin(a) * 0.028), dir, rng.randf_range(0.02, 0.03),
			rng.randf_range(0.07, 0.11), 5, hue + rng.randf_range(-0.3, 0.3))
	_recentre(b, Vector3(0.0, 0.18, 0.0), true)
	var mesh := ArrayMesh.new()
	b.commit(mesh, material("crystal"), false)
	return mesh

static func _shard(b: _B, rng: RandomNumberGenerator, base: Vector3, axis: Vector3, radius: float,
		length: float, sides: int, hue: float) -> void:
	axis = axis.normalized()
	var t1 := axis.cross(Vector3.RIGHT if absf(axis.x) < 0.9 else Vector3.FORWARD).normalized()
	var t2 := axis.cross(t1)
	var h_frac := [-0.04, 0.05, 0.62, 0.86]
	var r_frac := [0.82, 1.0, 0.92, 0.55]
	var twist := rng.randf() * TAU
	var delta := PI / sides * rng.randf_range(0.14, 0.24)
	var corner_a: Array[float] = []
	var corner_r: Array[float] = []
	for i in sides:
		corner_a.append(TAU * (float(i) + rng.randf_range(-0.22, 0.22)) / sides + twist)
		corner_r.append(rng.randf_range(0.82, 1.14))
	var rings: Array = []
	for k in 4:
		var ring: Array[Vector3] = []
		var shear := rng.randf_range(-0.05, 0.05) * radius * k
		for i in sides:
			for pair in 2:
				var ang: float = corner_a[i] + (delta if pair == 1 else -delta) + k * 0.05
				var rr: float = radius * r_frac[k] * corner_r[i] * (1.0 + (0.08 if pair == 0 else 0.0))
				ring.append(base + axis * (h_frac[k] * length) + t1 * (cos(ang) * rr + shear) + t2 * (sin(ang) * rr))
		rings.append(ring)
	var apex := base + axis * length + t1 * rng.randf_range(-0.35, 0.35) * radius + t2 * rng.randf_range(-0.35, 0.35) * radius
	var centre := base + axis * (length * 0.45)
	var hue_c := fposmod(hue, 1.0)
	for k in 3:
		for i in sides:
			var i1 := (i + 1) % sides
			var h0 := float(k) / 3.0
			var h1 := float(k + 1) / 3.0
			var bevel_g := rng.randf()
			var facet_g := rng.randf()
			_cq(b, centre, rings[k][i * 2], rings[k][i * 2 + 1], rings[k + 1][i * 2 + 1], rings[k + 1][i * 2], h0, h1, bevel_g, hue_c, 1.0)
			_cq(b, centre, rings[k][i * 2 + 1], rings[k][i1 * 2], rings[k + 1][i1 * 2], rings[k + 1][i * 2 + 1], h0, h1, facet_g, hue_c, 0.0)
	for i in sides:
		var i1 := (i + 1) % sides
		var a0: Vector3 = rings[3][i * 2]
		var b0: Vector3 = rings[3][i * 2 + 1]
		var a1: Vector3 = rings[3][i1 * 2]
		var lo := Color(0.86, rng.randf(), hue_c, 1.0)
		var tip := Color(1.0, lo.g, hue_c, 1.0)
		b.tri(a0, b0, apex, lo, lo, tip, (a0 + b0 + apex) / 3.0 - centre)
		lo = Color(0.86, rng.randf(), hue_c, 0.0)
		tip = Color(1.0, lo.g, hue_c, 0.0)
		b.tri(b0, a1, apex, lo, lo, tip, (b0 + a1 + apex) / 3.0 - centre)

static func _cq(b: _B, centre: Vector3, a: Vector3, bb: Vector3, c: Vector3, d: Vector3,
		h0: float, h1: float, facet: float, hue: float, edge: float) -> void:
	var lo := Color(h0, facet, hue, edge)
	var hi := Color(h1, facet, hue, edge)
	b.quad(a, bb, c, d, lo, lo, hi, hi, (a + bb + c + d) * 0.25 - centre)

## Re-centre the mesh on its AABB centre. `fit` scales so Y span == target.y.
static func _recentre(b: _B, target: Vector3, fit: bool) -> void:
	var box := AABB(b.v[0], Vector3.ZERO)
	for p in b.v: box = box.expand(p)
	var mid := box.get_center()
	var s := target.y / box.size.y if fit else 1.0
	for i in b.v.size(): b.v[i] = (b.v[i] - mid) * s

# --------------------------------------------------------------- stariron chip

static func _build_chip(variant: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = 9100 + variant * 71
	var data := _icosphere(2)
	var verts: Array[Vector3] = data[0]
	var faces: Array = data[1]
	var ph := Vector3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU)
	var squash := Vector3(rng.randf_range(0.068, 0.082), rng.randf_range(0.04, 0.055), rng.randf_range(0.05, 0.066))
	for i in verts.size():
		var p := verts[i]
		var d := 1.0 + 0.2 * sin(p.x * 2.3 + ph.x) * cos(p.y * 2.9 + ph.y) + 0.14 * sin(p.z * 3.4 + ph.z) + 0.04 * rng.randf_range(-1.0, 1.0)
		verts[i] = p * d * squash
	var planes: Array = []
	for k in 3:
		var nn := Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)).normalized()
		planes.append([nn, rng.randf_range(0.026, 0.04) * (0.8 if k > 0 else 1.0)])
	for pass_index in 2:
		for pl in planes:
			for i in verts.size():
				var s: float = verts[i].dot(pl[0]) - float(pl[1])
				if s > 0.0: verts[i] -= (pl[0] as Vector3) * s
	var box := AABB(verts[0], Vector3.ZERO)
	for p in verts: box = box.expand(p)
	var mid := box.get_center()
	var span := maxf(box.size.x, maxf(box.size.y, box.size.z))
	var b := _B.new()
	for f in faces:
		var pa := verts[f.x]; var pb := verts[f.y]; var pc := verts[f.z]
		var fresh := 0.0
		for pl in planes:
			var on := true
			for q in [pa, pb, pc]:
				if absf((q as Vector3).dot(pl[0]) - float(pl[1])) > 4e-4: on = false
			if on: fresh = 1.0
		var tint := rng.randf_range(0.8, 1.2)
		var col := Color(tint, tint, tint, fresh)
		var s := 0.14 / span
		var qa := (pa - mid) * s; var qb := (pb - mid) * s; var qc := (pc - mid) * s
		b.tri(qa, qb, qc, col, col, col, (qa + qb + qc) / 3.0)
	var mesh := ArrayMesh.new()
	b.commit(mesh, material("meteor"))
	return mesh

static func _icosphere(level: int) -> Array:
	var t := (1.0 + sqrt(5.0)) / 2.0
	var verts: Array[Vector3] = []
	for p in [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
			Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]:
		verts.append((p as Vector3).normalized())
	var faces: Array = []
	for f in [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
			[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]:
		faces.append(Vector3i(f[0], f[1], f[2]))
	for l in level:
		var mids := {}
		var next: Array = []
		for f in faces:
			var m: Array[int] = []
			for pair in [[f.x, f.y], [f.y, f.z], [f.z, f.x]]:
				var lo := mini(pair[0], pair[1]); var hi := maxi(pair[0], pair[1])
				var key := lo * 4096 + hi
				if not mids.has(key):
					verts.append(((verts[lo] + verts[hi]) * 0.5).normalized())
					mids[key] = verts.size() - 1
				m.append(mids[key])
			next.append(Vector3i(f.x, m[0], m[2]))
			next.append(Vector3i(f.y, m[1], m[0]))
			next.append(Vector3i(f.z, m[2], m[1]))
			next.append(Vector3i(m[0], m[1], m[2]))
		faces = next
	return [verts, faces]

# ----------------------------------------------------------------- materials

const _SURFACE_CODE := """
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;
uniform vec3 base_color : source_color = vec3(0.35);
uniform vec3 fresh_color : source_color = vec3(0.65);
uniform vec3 band_color : source_color = vec3(0.25);
uniform vec3 fresh_band_color : source_color = vec3(0.3);
uniform vec3 emit_color : source_color = vec3(0.0);
uniform vec3 sheen_color : source_color = vec3(0.0);
uniform float vcol_mix = 0.0;
uniform float grain_scale = 60.0;
uniform float grain_amount = 0.25;
uniform float band_scale = 30.0;
uniform float band_amount = 0.0;
uniform float fresh_band_amount = 0.0;
uniform float band_cross = 0.0;
uniform float rough = 0.9;
uniform float fresh_rough = 0.5;
uniform float metal = 0.0;
uniform float fresh_metal = 0.0;
uniform float emit_base = 0.0;
uniform float emit_fresh = 0.0;
uniform float sheen_power = 3.0;
uniform float sheen_amount = 0.0;
varying vec3 mpos;

float h31(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise(vec3 p) {
	vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	float a = mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y);
	float b = mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y);
	return mix(a, b, f.z);
}
void vertex() { mpos = VERTEX; }
void fragment() {
	float g = vnoise(mpos * grain_scale) * 0.6 + vnoise(mpos * grain_scale * 2.9) * 0.4;
	float fresh = 1.0 - clamp(COLOR.a, 0.0, 1.0);
	vec3 vc = mix(vec3(1.0), COLOR.rgb, vcol_mix);
	float b1 = sin(dot(mpos, vec3(0.6, 0.8, 0.3)) * band_scale + g * 3.0);
	float b2 = sin(dot(mpos, vec3(-0.7, 0.5, 0.5)) * band_scale * 1.15 + g * 2.0);
	float bands = max(smoothstep(0.55, 0.9, b1), band_cross * smoothstep(0.6, 0.92, b2));
	vec3 crust = base_color * vc * (1.0 - grain_amount + grain_amount * 2.0 * g);
	crust = mix(crust, band_color * vc, bands * band_amount);
	vec3 fr = fresh_color * (0.85 + 0.3 * g);
	fr = mix(fr, fresh_band_color, bands * fresh_band_amount);
	ALBEDO = mix(crust, fr, fresh);
	ROUGHNESS = mix(rough, fresh_rough, fresh);
	METALLIC = mix(metal, fresh_metal, fresh);
	SPECULAR = 0.6;
	float ndv = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
	float fres = pow(1.0 - ndv, sheen_power);
	float glow = emit_base + emit_fresh * fresh;
	EMISSION = emit_color * mix(vec3(1.0), COLOR.rgb, vcol_mix * step(0.5, emit_fresh)) * glow * (0.7 + 0.5 * g + 0.6 * fres)
		+ sheen_color * fres * sheen_amount;
}
"""

const _CRYSTAL_CODE := """
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;
uniform vec3 core_a : source_color = vec3(0.10, 0.88, 1.0);
uniform vec3 core_b : source_color = vec3(0.66, 0.30, 1.0);
uniform vec3 hot : source_color = vec3(1.0, 0.62, 0.16);
uniform float glow = 1.3;
uniform float depth_scale = 0.12;
uniform float vein_scale = 12.0;
uniform float amber_share = 0.33;
varying vec3 mpos;
varying vec3 mnrm;
varying vec3 mview;
varying vec4 vc;

float veins(vec3 p) {
	float a = abs(sin(dot(p, vec3(0.7, 1.3, 0.4)) + sin(dot(p, vec3(1.1, -0.5, 0.9)) * 1.5) * 1.6));
	float b = abs(sin(dot(p, vec3(-1.2, 0.5, 1.1)) + sin(dot(p, vec3(0.6, 1.4, -0.7)) * 1.3) * 1.4));
	return max(1.0 - smoothstep(0.0, 0.035, a), (1.0 - smoothstep(0.0, 0.026, b)) * 0.7);
}
void vertex() {
	mpos = VERTEX;
	mnrm = NORMAL;
	mview = (inverse(MODELVIEW_MATRIX) * vec4(0.0, 0.0, 0.0, 1.0)).xyz - VERTEX;
	vc = COLOR;
}
void fragment() {
	vec3 V = normalize(mview);
	vec3 N = normalize(mnrm);
	float ndv = clamp(dot(N, V), 0.0, 1.0);
	float fres = pow(1.0 - ndv, 3.0);
	vec3 R = refract(-V, N, 0.7);
	float v1 = veins((mpos + R * depth_scale) * vein_scale);
	float v2 = veins((mpos + R * depth_scale * 2.3) * vein_scale * 0.6 + vec3(3.1));
	float accent = step(1.0 - amber_share, fract(vc.g * 7.3));
	vec3 hue = mix(core_a, core_b, smoothstep(0.3, 0.7, clamp(vc.b + (vc.g - 0.5) * 0.3, 0.0, 1.0)));
	hue = mix(hue, hot, accent * 0.55);
	float facet = 0.35 + 1.25 * vc.g;
	float key = clamp(dot(N, normalize(vec3(0.4, 0.8, 0.45))) * 0.5 + 0.5, 0.0, 1.0);
	float shade = mix(0.25, 1.0, key * key) * facet;
	float deep = (1.0 - vc.r) * 0.7 + 0.3;
	vec3 dark = mix(vec3(0.01, 0.09, 0.12), vec3(0.09, 0.02, 0.16), smoothstep(0.3, 0.7, vc.b));
	vec3 inner = dark + hue * hue * deep * deep * (0.15 + 0.5 * ndv) * shade;
	float core = pow(ndv, 2.0) * (1.0 - vc.r) * 0.7;
	float vein_amt = (v1 * 0.32 + v2 * 0.18) * (0.3 + 0.7 * deep) * (0.4 + 0.6 * ndv);
	float edge_glint = vc.a * (0.15 + 0.9 * fres) * (0.5 + 0.5 * key);
	float sparkle = pow(clamp(sin(TIME * 1.3 + vc.g * 40.0), 0.0, 1.0), 24.0) * vc.a * (0.2 + fres);
	vec3 emit = inner + hue * hue * core + mix(hue, vec3(0.9, 1.0, 1.0), 0.3) * vein_amt;
	emit += hue * fres * 0.45 + mix(hue, vec3(1.0), 0.45) * edge_glint * 0.55 + vec3(sparkle * 0.5);
	ALBEDO = dark + hue * hue * (0.08 + 0.18 * vc.g);
	EMISSION = emit * glow;
	ROUGHNESS = mix(0.05 + 0.2 * vc.g, 0.03, vc.a);
	METALLIC = 0.25;
	SPECULAR = 1.0;
}
"""

static func _make_material(kind: String) -> Material:
	if kind == "crystal":
		if _crystal_shader == null:
			_crystal_shader = Shader.new()
			_crystal_shader.code = _CRYSTAL_CODE
		var cm := ShaderMaterial.new()
		cm.shader = _crystal_shader
		return cm
	if _surface_shader == null:
		_surface_shader = Shader.new()
		_surface_shader.code = _SURFACE_CODE
	var m := ShaderMaterial.new()
	m.shader = _surface_shader
	var p := {}
	match kind:
		"iron":
			p = {"base_color": Color(0.2, 0.17, 0.16), "band_color": Color(0.42, 0.2, 0.1), "band_amount": 0.5, "band_scale": 22.0,
				"fresh_color": Color(0.66, 0.65, 0.68), "rough": 0.7, "metal": 0.35, "fresh_rough": 0.3, "fresh_metal": 0.95}
		"meteor":
			p = {"base_color": Color(0.055, 0.05, 0.055), "band_color": Color(0.2, 0.13, 0.09), "band_amount": 0.45, "band_scale": 55.0,
				"fresh_color": Color(0.74, 0.72, 0.7), "fresh_band_color": Color(0.3, 0.3, 0.33), "fresh_band_amount": 0.55,
				"band_cross": 1.0, "rough": 0.55, "metal": 0.3, "fresh_rough": 0.22, "fresh_metal": 1.0, "grain_scale": 90.0,
				"sheen_color": Color(0.12, 0.2, 0.45), "sheen_amount": 0.35, "sheen_power": 3.5}
		"ice":
			p = {"base_color": Color(0.58, 0.8, 0.93), "band_color": Color(0.9, 0.97, 1.0), "band_amount": 0.3, "band_scale": 16.0,
				"fresh_color": Color(0.92, 0.98, 1.0), "rough": 0.18, "fresh_rough": 0.08, "grain_amount": 0.12,
				"emit_color": Color(0.2, 0.5, 0.7), "emit_base": 0.25, "sheen_color": Color(0.6, 0.9, 1.0), "sheen_amount": 0.6, "sheen_power": 2.5}
		"obsidian":
			p = {"base_color": Color(0.02, 0.02, 0.028), "band_color": Color(0.09, 0.03, 0.13), "band_amount": 0.5, "band_scale": 14.0,
				"fresh_color": Color(0.012, 0.012, 0.02), "rough": 0.1, "fresh_rough": 0.03, "grain_amount": 0.1, "metal": 0.1,
				"sheen_color": Color(0.3, 0.22, 0.6), "sheen_amount": 0.7, "sheen_power": 3.0}
		"fissure", "fissure_hot":
			p = {"vcol_mix": 1.0, "base_color": Color.WHITE, "fresh_color": Color(0.7, 0.4, 0.22), "rough": 0.95, "fresh_rough": 0.8,
				"grain_scale": 120.0, "grain_amount": 0.3}
			if kind == "fissure_hot":
				p.merge({"emit_color": Color(1.0, 0.5, 0.18), "emit_fresh": 0.2})
		"strata":
			p = {"vcol_mix": 0.6, "base_color": Color(0.38, 0.3, 0.24), "band_color": Color(0.74, 0.5, 0.28), "band_amount": 0.6,
				"band_scale": 150.0, "fresh_color": Color(0.6, 0.47, 0.34), "fresh_band_color": Color(0.38, 0.27, 0.18),
				"fresh_band_amount": 0.5, "rough": 0.9, "fresh_rough": 0.75, "grain_scale": 160.0}
		"vein":
			p = {"vcol_mix": 1.0, "base_color": Color(0.1, 0.3, 0.4), "fresh_color": Color(0.25, 0.7, 0.85), "rough": 0.12, "fresh_rough": 0.08,
				"fresh_metal": 0.2, "grain_scale": 200.0, "grain_amount": 0.2,
				"emit_color": Color(1.0, 1.0, 1.0), "emit_fresh": 2.4, "sheen_color": Color(0.8, 1.0, 1.0), "sheen_amount": 0.6, "sheen_power": 2.0}
		_:
			if kind != "stone": push_warning("MiningVisualArt: unknown material '%s', using stone" % kind)
			p = {"base_color": Color(0.36, 0.33, 0.3), "band_color": Color(0.27, 0.24, 0.21), "band_amount": 0.45, "band_scale": 25.0,
				"fresh_color": Color(0.66, 0.56, 0.43), "rough": 0.92, "fresh_rough": 0.85}
	for key in p: m.set_shader_parameter(key, p[key])
	return m
