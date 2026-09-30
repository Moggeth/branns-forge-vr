extends RefCounted
## Material-specific impact debris art for the MaterialImpactFeedback root.
## The root owns emission, ballistics, dedup, audio and marks placement.
## This module owns fragment silhouettes, material response and the two small
## particle shaders (camera-facing dust, tapered ember streak). All resources
## are built once, cached and shared: 17 meshes, 14 materials, 2 shaders.
##
## Extra (ignored-by-root) keys on layer dictionaries:
##   "gate": "metal_tool"   spark layers should only fire for metal-headed tools
##   "name": string         layer label for diagnostics
##
## Winding convention: Godot front faces are clockwise. MB.tri() orients every
## triangle against an outward hint so culling is correct without cull_disabled
## (only the thin metal shaving and marks-free glass edges rely on it).

const MATERIAL_NAMES := ["stone", "wood", "bone", "metal", "flesh", "glass"]

static var _cache: Dictionary = {}

class MB:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var tangent_axis := Vector3.ZERO

	func tri(a: Vector3, b: Vector3, d: Vector3, ca: Color, cb: Color, cd: Color, hint: Vector3,
			na := Vector3.ZERO, nb := Vector3.ZERO, nd := Vector3.ZERO) -> void:
		var fn := (d - a).cross(b - a)
		if fn.length_squared() < 1e-14: return
		fn = fn.normalized()
		if fn.dot(hint) < 0.0:
			var tv := b; b = d; d = tv
			var tc := cb; cb = cd; cd = tc
			var tn := nb; nb = nd; nd = tn
			fn = -fn
		v.push_back(a); v.push_back(b); v.push_back(d)
		c.push_back(ca); c.push_back(cb); c.push_back(cd)
		if na != Vector3.ZERO:
			n.push_back(na); n.push_back(nb); n.push_back(nd)
		else:
			n.push_back(fn); n.push_back(fn); n.push_back(fn)

	func flat(a: Vector3, b: Vector3, d: Vector3, col: Color, hint: Vector3) -> void:
		tri(a, b, d, col, col, col, hint)

	## Centre, scale to a 1 m longest span, return the mesh.
	func build() -> ArrayMesh:
		var box := AABB(v[0], Vector3.ZERO)
		for p in v: box = box.expand(p)
		var span := maxf(box.size.x, maxf(box.size.y, box.size.z))
		var mid := box.get_center()
		for i in v.size(): v[i] = (v[i] - mid) / span
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = v
		arrays[Mesh.ARRAY_NORMAL] = n
		arrays[Mesh.ARRAY_COLOR] = c
		var uvs := PackedVector2Array()
		uvs.resize(v.size())
		for i in v.size(): uvs[i] = Vector2(v[i].x + 0.5, v[i].z + 0.5)
		arrays[Mesh.ARRAY_TEX_UV] = uvs
		if tangent_axis != Vector3.ZERO:
			var tans := PackedFloat32Array()
			for i in v.size():
				var t := (tangent_axis - n[i] * n[i].dot(tangent_axis)).normalized()
				tans.push_back(t.x); tans.push_back(t.y); tans.push_back(t.z); tans.push_back(1.0)
			arrays[Mesh.ARRAY_TANGENT] = tans
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		return mesh

	func triangles() -> int:
		return v.size() / 3

# ---------------------------------------------------------------- public API

static func profiles() -> Dictionary:
	return {
		"stone": [
			_layer("stone shards", "chip", "stone_shard", "stone_chip", 4, 0.052, 3.4, 0.75, Color(0.66, 0.63, 0.58)),
			_layer("stone slabs", "chip", "stone_slab", "stone_chip", 3, 0.075, 2.2, 0.8, Color(0.52, 0.5, 0.47)),
			_layer("stone grit", "dust", "quad", "dust_chalk", 3, 0.30, 1.1, 0.9, Color(0.72, 0.69, 0.63)),
			_layer("stone strike sparks", "spark", "streak", "spark", 2, 0.11, 5.4, 0.26, Color(1.0, 0.72, 0.34), {"gate": "metal_tool"}),
		],
		"wood": [
			_layer("wood splinters", "chip", "splinter", "wood_chip", 4, 0.115, 3.0, 0.8, Color(0.86, 0.66, 0.42)),
			_layer("bark flakes", "chip", "bark", "wood_chip", 3, 0.062, 2.2, 0.85, Color(0.66, 0.5, 0.36)),
			_layer("sawdust", "dust", "quad", "dust_sawdust", 3, 0.22, 0.9, 0.8, Color(0.86, 0.68, 0.45)),
		],
		"bone": [
			_layer("bone chips", "chip", "bone_chip", "bone_mat", 4, 0.048, 3.0, 0.7, Color(0.94, 0.9, 0.79)),
			_layer("bone flakes", "chip", "bone_flake", "bone_mat", 3, 0.066, 2.2, 0.75, Color(0.9, 0.86, 0.74)),
			_layer("bone chalk", "dust", "quad", "dust_chalk", 4, 0.32, 1.0, 1.0, Color(0.96, 0.94, 0.88)),
		],
		"metal": [
			_layer("steel shavings", "chip", "shaving", "metal_shaving", 3, 0.095, 3.4, 0.7, Color(0.82, 0.84, 0.88)),
			_layer("strike sparks", "spark", "streak", "spark", 5, 0.10, 6.0, 0.3, Color(1.0, 0.76, 0.36), {"gate": "metal_tool"}),
			_layer("metal dust", "dust", "quad", "dust_fine", 1, 0.14, 1.0, 0.5, Color(0.62, 0.62, 0.65)),
		],
		"flesh": [
			_layer("hide scraps", "chip", "pulp", "flesh_pulp", 3, 0.042, 2.4, 0.7, Color(0.56, 0.32, 0.25)),
			_layer("hide puff", "dust", "quad", "dust_puff", 3, 0.24, 0.9, 0.7, Color(0.74, 0.6, 0.52)),
		],
		"glass": [
			_layer("glass shards", "chip", "glass_shard", "glass", 6, 0.052, 3.4, 0.8, Color(0.78, 0.94, 0.96)),
			_layer("glass powder", "dust", "quad", "dust_fine", 2, 0.16, 1.0, 0.6, Color(0.86, 0.95, 0.98)),
		],
	}

## Surface-local decal-like mesh in the XZ plane, front face UP, ~1 m span.
## Root scales it by "size" * energy strength and stands it 8 mm off the surface.
static func mark_profile(material: String) -> Dictionary:
	match material:
		"stone": return {"mesh": _res("mark_stone"), "material": _res("mark_mat"), "size": 0.13}
		"wood": return {"mesh": _res("mark_wood"), "material": _res("mark_mat"), "size": 0.11}
		"bone": return {"mesh": _res("mark_bone"), "material": _res("mark_mat"), "size": 0.09}
		"metal": return {"mesh": _res("mark_metal"), "material": _res("mark_metal_mat"), "size": 0.09}
	return {}

## Cheap diagnostics for the validation harness.
static func stats() -> Dictionary:
	var result := {"meshes": {}, "triangles": 0, "bad_windings": 0}
	for key in ["stone_shard", "stone_slab", "splinter", "bark", "bone_chip", "bone_flake", "shaving", "pulp",
			"glass_shard", "streak", "mark_stone", "mark_wood", "mark_bone", "mark_metal"]:
		var mesh: ArrayMesh = _res(key)
		var arrays := mesh.surface_get_arrays(0)
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
		result.meshes[key] = verts.size() / 3
		result.triangles += verts.size() / 3
		if normals.size() != verts.size(): continue
		for i in range(0, verts.size(), 3):
			var front := (verts[i + 2] - verts[i]).cross(verts[i + 1] - verts[i])
			if front.length_squared() > 1e-12 and front.dot(normals[i] + normals[i + 1] + normals[i + 2]) < 0.0:
				result.bad_windings += 1
	return result

# ------------------------------------------------------------------ layers

static func _layer(label: String, kind: String, mesh_key: String, material_key: String, count: int,
		size: float, speed: float, life: float, tint: Color, extra := {}) -> Dictionary:
	var layer := {"name": label, "kind": kind, "mesh": _res(mesh_key), "material": _res(material_key),
		"count": count, "size": size, "speed": speed, "life": life, "tint": tint}
	for key in extra: layer[key] = extra[key]
	return layer

static func _res(key: String) -> Resource:
	if not _cache.has(key): _cache[key] = _make(key)
	return _cache[key]

static func _make(key: String) -> Resource:
	match key:
		"stone_shard": return _crystal(4101, 5, Vector3(1.0, 0.62, 0.78), 0.3, 0.16, Color(0.95, 0.94, 0.92))
		"stone_slab": return _prism(4102, 6, Vector3(1.0, 1.0, 0.72), 0.13, 0.28, Color(0.98, 0.97, 0.94), Color(0.62, 0.6, 0.58), Color(0.8, 0.79, 0.76))
		"bone_chip": return _crystal(4103, 5, Vector3(1.0, 0.7, 0.82), 0.2, 0.08, Color(1.0, 0.99, 0.95))
		"bone_flake": return _prism(4104, 5, Vector3(1.0, 1.0, 0.8), 0.15, 0.2, Color(1.0, 0.99, 0.96), Color(0.8, 0.72, 0.52), Color(0.92, 0.9, 0.82))
		"bark": return _prism(4105, 7, Vector3(1.0, 1.0, 0.7), 0.16, 0.3, Color(0.34, 0.24, 0.17), Color(0.96, 0.82, 0.6), Color(0.66, 0.5, 0.36))
		"splinter": return _splinter(4106)
		"shaving": return _shaving(4107)
		"pulp": return _crystal(4108, 6, Vector3(1.0, 0.72, 0.85), 0.16, 0.06, Color(1, 1, 1), true)
		"glass_shard": return _glass_shard(4109)
		"streak": return _streak()
		"quad":
			var quad := QuadMesh.new()
			quad.size = Vector2.ONE
			return quad
		"mark_stone": return _mark_stone()
		"mark_wood": return _mark_wood()
		"mark_bone": return _mark_bone()
		"mark_metal": return _mark_metal()
		"stone_chip": return _chip_material(0.92, 0.0)
		"bone_mat": return _chip_material(0.78, 0.0)
		"wood_chip": return _chip_material(0.88, 0.0)
		"flesh_pulp": return _chip_material(0.7, 0.0)
		"metal_shaving": return _metal_material()
		"glass": return _glass_material()
		"dust_chalk": return _dust_material(0.62, 0.7, 0.75, 0.45)
		"dust_sawdust": return _dust_material(0.5, 0.75, 0.9, 0.5)
		"dust_fine": return _dust_material(0.32, 0.55, 0.6, 0.3)
		"dust_puff": return _dust_material(0.45, 0.85, 0.5, 0.38)
		"spark": return _spark_material()
		"mark_mat": return _mark_material(0.9, 0.0)
		"mark_metal_mat": return _mark_material(0.32, 0.7)
	return null

# --------------------------------------------------------------- fragments

## Irregular bipyramid: sharp, faceted, unevenly weighted stone/bone/pulp fragment.
static func _crystal(seed_value: int, sides: int, stretch: Vector3, jitter: float, tone: float,
		base: Color, smooth := false) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var ring: Array[Vector3] = []
	for i in sides:
		var angle := (float(i) + rng.randf_range(-0.3, 0.3)) / sides * TAU
		var radius := rng.randf_range(1.0 - jitter, 1.0 + jitter) * 0.5
		ring.append(Vector3(cos(angle) * radius * stretch.x, rng.randf_range(-jitter, jitter) * 0.35 * stretch.y, sin(angle) * radius * stretch.z))
	var top := Vector3(rng.randf_range(-0.12, 0.12) * stretch.x, rng.randf_range(0.36, 0.52) * stretch.y, rng.randf_range(-0.12, 0.12) * stretch.z)
	var bottom := Vector3(rng.randf_range(-0.12, 0.12) * stretch.x, -rng.randf_range(0.3, 0.5) * stretch.y, rng.randf_range(-0.12, 0.12) * stretch.z)
	var mb := MB.new()
	for i in sides:
		var a := ring[i]
		var b := ring[(i + 1) % sides]
		for apex_up in [true, false]:
			var apex: Vector3 = top if apex_up else bottom
			var centroid := (a + b + apex) / 3.0
			var facing := centroid.normalized()
			var shade := (0.72 + 0.28 * clampf(facing.y * 0.5 + 0.5, 0.0, 1.0)) * (1.0 + tone * rng.randf_range(-1.0, 1.0))
			var col := Color(base.r * shade, base.g * shade, base.b * shade, 1.0)
			if smooth:
				mb.tri(a, b, apex, col, col, col, centroid, a.normalized(), b.normalized(), apex.normalized())
			else:
				mb.flat(a, b, apex, col, centroid)
	return mb.build()

## Thin irregular slab: coloured top, contrasting underside (bark/inner wood, chalky pores).
static func _prism(seed_value: int, sides: int, stretch: Vector3, thickness: float, jitter: float,
		top_col: Color, bottom_col: Color, side_col: Color) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var top: Array[Vector3] = []
	var bottom: Array[Vector3] = []
	for i in sides:
		var angle := (float(i) + rng.randf_range(-0.28, 0.28)) / sides * TAU
		var radius := rng.randf_range(1.0 - jitter, 1.0 + jitter * 1.4) * 0.5
		var p := Vector3(cos(angle) * radius * stretch.x, 0.0, sin(angle) * radius * stretch.z)
		var lift := rng.randf_range(0.0, thickness * 0.5)
		top.append(p + Vector3(0, thickness * 0.5 - lift, 0))
		bottom.append(p * rng.randf_range(0.82, 0.95) + Vector3(0, -thickness * 0.5, 0))
	var top_centre := Vector3(rng.randf_range(-0.05, 0.05), thickness * 0.9, rng.randf_range(-0.05, 0.05))
	var bottom_centre := Vector3(0, -thickness * 0.75, 0)
	var mb := MB.new()
	for i in sides:
		var j := (i + 1) % sides
		var vary := rng.randf_range(0.88, 1.08)
		mb.flat(top[i], top[j], top_centre, _scaled(top_col, vary), Vector3.UP)
		mb.flat(bottom[i], bottom[j], bottom_centre, _scaled(bottom_col, vary), Vector3.DOWN)
		var out := Vector3((top[i] + top[j]).x, 0.0, (top[i] + top[j]).z)
		mb.flat(top[i], top[j], bottom[j], _scaled(side_col, vary), out)
		mb.flat(top[i], bottom[j], bottom[i], _scaled(side_col, vary * 0.92), out)
	return mb.build()

## Long tapered splinter: bark on one edge, pale exposed grain, ragged broken end.
static func _splinter(seed_value: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var bark := Color(0.36, 0.25, 0.17)
	var inner := Color(1.0, 0.9, 0.74)
	var r0: Array[Vector3] = []
	var r1: Array[Vector3] = []
	for k in 3:
		var angle := float(k) / 3.0 * TAU + 0.5
		var w := rng.randf_range(0.055, 0.085)
		r0.append(Vector3(-0.5 + rng.randf_range(0.0, 0.1), sin(angle) * w, cos(angle) * w * 1.5))
		r1.append(Vector3(0.05 + rng.randf_range(-0.05, 0.05), sin(angle) * w * 0.55, cos(angle) * w * 0.8))
	var tip := Vector3(0.5, 0.005, -0.01)
	var mb := MB.new()
	for k in 3:
		var m := (k + 1) % 3
		var col := bark if k == 0 else _scaled(inner, rng.randf_range(0.82, 1.05))
		var mid := Vector3((r0[k].x + r1[k].x) * 0.5, (r0[k].y + r0[m].y) * 0.5, (r0[k].z + r0[m].z) * 0.5)
		var out := Vector3(0, mid.y, mid.z)
		mb.flat(r0[k], r0[m], r1[m], col, out)
		mb.flat(r0[k], r1[m], r1[k], _scaled(col, 0.94), out)
		mb.flat(r1[k], r1[m], tip, _scaled(col, 1.05), out)
	mb.flat(r0[0], r0[1], r0[2], Color(0.95, 0.82, 0.62), Vector3.LEFT)
	return mb.build()

## Fine curled steel sliver. Vertex normals + tangents so the anisotropic highlight streaks
## along the strip. Thin, so the material is double-sided.
static func _shaving(seed_value: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var segments := 8
	var mb := MB.new()
	mb.tangent_axis = Vector3.RIGHT
	var left: Array[Vector3] = []
	var right: Array[Vector3] = []
	var normals: Array[Vector3] = []
	for i in segments + 1:
		var s := float(i) / segments - 0.5
		var phi := s * 3.6
		var centre := Vector3(sin(phi) / 3.6, (1.0 - cos(phi)) / 3.6 * 0.9, sin(s * 9.0) * 0.03)
		var taper := 1.0 - pow(absf(s) * 2.0, 2.5) * 0.85
		var width := 0.075 * taper * rng.randf_range(0.85, 1.1)
		left.append(centre + Vector3(0, 0, width))
		right.append(centre - Vector3(0, 0, width))
		normals.append(Vector3(-sin(phi), cos(phi), 0.0))
	for i in segments:
		var hint := normals[i] + normals[i + 1]
		var lo := Color(0.78, 0.8, 0.84)
		var hi := Color(1.0, 1.0, 1.0)
		var shade := hi if i % 2 == 0 else lo
		mb.tri(left[i], right[i], left[i + 1], shade, shade, shade, hint, normals[i], normals[i], normals[i + 1])
		mb.tri(right[i], right[i + 1], left[i + 1], shade, shade, shade, hint, normals[i], normals[i + 1], normals[i + 1])
	return mb.build()

## Thin faceted shard: bright rim, translucent core.
static func _glass_shard(seed_value: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var pts: Array[Vector3] = [
		Vector3(-0.5, 0, rng.randf_range(-0.05, 0.1)),
		Vector3(0.05, 0, -0.3 + rng.randf_range(-0.05, 0.05)),
		Vector3(0.5, 0, rng.randf_range(-0.05, 0.05)),
		Vector3(-0.1, 0, 0.28 + rng.randf_range(-0.05, 0.05)),
	]
	var thick := 0.045
	var core := Color(0.9, 1.0, 1.0, 0.5)
	var rim := Color(1.0, 1.0, 1.0, 0.92)
	var mb := MB.new()
	var upper: Array[Vector3] = []
	var lower: Array[Vector3] = []
	for i in pts.size():
		upper.append(pts[i] + Vector3(0, thick * (0.5 + 0.4 * sin(i * 1.7)), 0))
		lower.append(pts[i] - Vector3(0, thick * 0.5, 0))
	mb.tri(upper[0], upper[1], upper[2], core, rim, core, Vector3.UP)
	mb.tri(upper[0], upper[2], upper[3], core, core, rim, Vector3.UP)
	mb.tri(lower[0], lower[1], lower[2], core, rim, core, Vector3.DOWN)
	mb.tri(lower[0], lower[2], lower[3], core, core, rim, Vector3.DOWN)
	for i in pts.size():
		var j := (i + 1) % pts.size()
		var out := Vector3(pts[i].x + pts[j].x, 0, pts[i].z + pts[j].z)
		mb.tri(upper[i], upper[j], lower[j], rim, rim, rim, out)
		mb.tri(upper[i], lower[j], lower[i], rim, rim, rim, out)
	return mb.build()

## Tapered spark streak: fat bright head, long fading tail, sharp tip. Spans X. The spark
## shader turns this into a camera-facing ribbon along the instance's X axis.
static func _streak() -> ArrayMesh:
	var mb := MB.new()
	var tail := Color(0.35, 0.05, 0.0, 0.0)
	var mid := Color(1.0, 0.45, 0.1, 0.75)
	var head := Color(1.0, 0.95, 0.75, 1.0)
	var nose := Color(1.0, 1.0, 0.9, 0.7)
	var t := Vector3(-0.5, 0, 0)
	var l := Vector3(0.08, 0, 0.035)
	var r := Vector3(0.08, 0, -0.035)
	var n := Vector3(0.5, 0, 0)
	var m_l := Vector3(-0.2, 0, 0.018)
	var m_r := Vector3(-0.2, 0, -0.018)
	mb.flat(t, m_l, m_r, tail, Vector3.UP)
	mb.tri(m_l, l, m_r, mid, head, mid, Vector3.UP)
	mb.tri(m_r, l, r, mid, head, head, Vector3.UP)
	mb.tri(l, n, r, head, nose, head, Vector3.UP)
	return mb.build()

# ------------------------------------------------------------------- marks

static func _fan_ring(mb: MB, rng: RandomNumberGenerator, points: int, radii: Array, colors: Array, elongate := Vector2.ONE, jag := 0.18) -> void:
	# Concentric irregular rings around the origin in the XZ plane, front face UP.
	var angles: Array[float] = []
	var jitter: Array[float] = []
	for i in points:
		angles.append((float(i) + rng.randf_range(-0.3, 0.3)) / points * TAU)
		jitter.append(rng.randf_range(1.0 - jag, 1.0 + jag))
	var previous: Array[Vector3] = []
	for ring_index in radii.size():
		var ring: Array[Vector3] = []
		for i in points:
			var r: float = float(radii[ring_index]) * (jitter[i] if ring_index > 0 else 1.0)
			ring.append(Vector3(cos(angles[i]) * r * elongate.x, 0, sin(angles[i]) * r * elongate.y))
		for i in points:
			var j := (i + 1) % points
			if ring_index == 0:
				mb.tri(Vector3.ZERO, ring[i], ring[j], colors[0], colors[0], colors[0], Vector3.UP)
			else:
				var ci: Color = colors[ring_index]
				var cp: Color = colors[ring_index - 1]
				mb.tri(previous[i], ring[i], ring[j], cp, ci, ci, Vector3.UP)
				mb.tri(previous[i], ring[j], previous[j], cp, ci, cp, Vector3.UP)
		previous = ring

static func _crack(mb: MB, rng: RandomNumberGenerator, origin: Vector2, angle: float, length: float,
		width: float, col: Color, segments := 4, wander := 0.4) -> void:
	var pts: Array[Vector2] = [origin]
	var a := angle
	var p := origin
	for i in segments:
		a += rng.randf_range(-wander, wander)
		p += Vector2(cos(a), sin(a)) * length / segments * rng.randf_range(0.8, 1.2)
		pts.append(p)
	var edge := Color(col.r, col.g, col.b, 0.0)
	var lefts: Array[Vector3] = []
	var rights: Array[Vector3] = []
	var centres: Array[Vector3] = []
	var alphas: Array[Color] = []
	for i in pts.size():
		var t := float(i) / (pts.size() - 1)
		var w := width * pow(1.0 - t, 0.8) + 0.004
		var dir := (pts[mini(i + 1, pts.size() - 1)] - pts[maxi(i - 1, 0)]).normalized()
		var perp := Vector2(-dir.y, dir.x)
		centres.append(Vector3(pts[i].x, 0, pts[i].y))
		lefts.append(Vector3(pts[i].x + perp.x * w, 0, pts[i].y + perp.y * w))
		rights.append(Vector3(pts[i].x - perp.x * w, 0, pts[i].y - perp.y * w))
		alphas.append(Color(col.r, col.g, col.b, col.a * (1.0 - t * 0.55)))
	for i in pts.size() - 1:
		mb.tri(lefts[i], centres[i], lefts[i + 1], edge, alphas[i], edge, Vector3.UP)
		mb.tri(centres[i], centres[i + 1], lefts[i + 1], alphas[i], alphas[i + 1], edge, Vector3.UP)
		mb.tri(centres[i], rights[i], centres[i + 1], alphas[i], edge, alphas[i + 1], Vector3.UP)
		mb.tri(rights[i], rights[i + 1], centres[i + 1], edge, edge, alphas[i + 1], Vector3.UP)

static func _mark_stone() -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = 5101
	var mb := MB.new()
	# pale fresh-cut halo, dark pit, radiating fracture arms
	_fan_ring(mb, rng, 9, [0.0, 0.07, 0.11, 0.2, 0.27],
		[Color(0.04, 0.035, 0.03, 0.92), Color(0.08, 0.07, 0.06, 0.85), Color(0.6, 0.57, 0.5, 0.55), Color(0.7, 0.67, 0.6, 0.25), Color(0.7, 0.67, 0.6, 0.0)])
	var arms := 7
	for i in arms:
		var angle := float(i) / arms * TAU + rng.randf_range(-0.25, 0.25)
		_crack(mb, rng, Vector2(cos(angle), sin(angle)) * 0.07, angle, rng.randf_range(0.22, 0.46), rng.randf_range(0.022, 0.04), Color(0.05, 0.045, 0.04, 0.88), 4, 0.42)
	return mb.build()

static func _mark_wood() -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = 5102
	var mb := MB.new()
	# elongated gouge along X: dark torn rim, pale exposed grain, dark core notch
	_fan_ring(mb, rng, 12, [0.0, 0.05, 0.1, 0.16, 0.22],
		[Color(0.36, 0.22, 0.12, 0.98), Color(0.94, 0.72, 0.44, 0.96), Color(0.72, 0.5, 0.29, 0.94), Color(0.14, 0.08, 0.05, 0.75), Color(0.14, 0.08, 0.05, 0.0)],
		Vector2(2.2, 0.72), 0.22)
	for i in 3:
		var z := (float(i) - 1.0) * 0.045
		_crack(mb, rng, Vector2(-0.3 + rng.randf_range(0.0, 0.1), z), 0.0 + rng.randf_range(-0.06, 0.06), rng.randf_range(0.4, 0.56), 0.011, Color(0.2, 0.11, 0.06, 0.7), 5, 0.1)
	return mb.build()

static func _mark_bone() -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = 5103
	var mb := MB.new()
	_fan_ring(mb, rng, 8, [0.0, 0.08, 0.16, 0.24],
		[Color(0.96, 0.94, 0.86, 0.9), Color(0.93, 0.9, 0.8, 0.85), Color(0.9, 0.87, 0.76, 0.4), Color(0.9, 0.87, 0.76, 0.0)], Vector2.ONE, 0.2)
	for i in 4:
		var angle := float(i) / 4.0 * TAU + rng.randf_range(-0.4, 0.4)
		_crack(mb, rng, Vector2(cos(angle), sin(angle)) * 0.05, angle, rng.randf_range(0.18, 0.34), 0.012, Color(0.42, 0.34, 0.22, 0.85), 3, 0.35)
	return mb.build()

static func _mark_metal() -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = 5104
	var mb := MB.new()
	# soft dent bruise, then bright scratches
	_fan_ring(mb, rng, 8, [0.0, 0.1, 0.2], [Color(0.1, 0.1, 0.11, 0.32), Color(0.1, 0.1, 0.11, 0.2), Color(0.1, 0.1, 0.11, 0.0)], Vector2.ONE, 0.12)
	for i in 4:
		var z := (float(i) - 1.5) * 0.06
		_crack(mb, rng, Vector2(-0.34 + rng.randf_range(0.0, 0.1), z), rng.randf_range(-0.14, 0.14), rng.randf_range(0.5, 0.66), 0.014, Color(0.9, 0.91, 0.94, 0.95), 4, 0.08)
	return mb.build()

# --------------------------------------------------------------- materials

static func _scaled(col: Color, k: float) -> Color:
	return Color(col.r * k, col.g * k, col.b * k, col.a)

static func _chip_material(roughness: float, metallic: float) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = roughness
	mat.metallic = metallic
	mat.metallic_specular = 0.35
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
	return mat

static func _metal_material() -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.metallic = 0.92
	mat.roughness = 0.34
	mat.anisotropy_enabled = true
	mat.anisotropy = 0.85
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	return mat

static func _glass_material() -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.roughness = 0.05
	mat.metallic = 0.0
	mat.metallic_specular = 1.0
	mat.rim_enabled = true
	mat.rim = 0.7
	mat.rim_tint = 0.4
	mat.albedo_color = Color(0.8, 0.96, 1.0, 1.0)
	return mat

static func _dust_material(edge_softness: float, density: float, grain: float, tone: float) -> ShaderMaterial:
	var shader := _shader("dust")
	var mat := ShaderMaterial.new()
	mat.shader = shader
	mat.set_shader_parameter("edge_softness", edge_softness)
	mat.set_shader_parameter("density", density)
	mat.set_shader_parameter("grain", grain)
	mat.set_shader_parameter("tone_shade", tone)
	mat.render_priority = 1
	return mat

static func _spark_material() -> ShaderMaterial:
	var mat := ShaderMaterial.new()
	mat.shader = _shader("spark")
	mat.render_priority = 2
	return mat

static func _mark_material(roughness: float, metallic: float) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.roughness = roughness
	mat.metallic = metallic
	mat.metallic_specular = 0.3
	mat.render_priority = 1
	mat.cull_mode = BaseMaterial3D.CULL_BACK
	return mat

static func _shader(key: String) -> Shader:
	var cache_key := "shader_" + key
	if _cache.has(cache_key): return _cache[cache_key]
	var shader := Shader.new()
	shader.code = DUST_SHADER if key == "dust" else SPARK_SHADER
	_cache[cache_key] = shader
	return shader

const DUST_SHADER := """
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
// Sparse atmospheric grit: camera-facing, unlit, noise-eroded soft disc. No glow.
uniform float density : hint_range(0.0, 1.0) = 0.55;
uniform float edge_softness : hint_range(0.05, 1.0) = 0.6;
uniform float grain : hint_range(0.0, 1.0) = 0.7;
uniform float tone_shade : hint_range(0.0, 1.0) = 0.4;
varying vec2 vseed;
float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
		mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() {
	float s = length(MODEL_MATRIX[0].xyz);
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	VERTEX *= s;
	// Stable per-instance seed from the (constant) instance orientation, not position.
	vec3 axis = normalize(MODEL_MATRIX[0].xyz);
	vec3 up = normalize(MODEL_MATRIX[1].xyz);
	vseed = vec2(hash21(axis.xy * 17.3 + up.z * 5.1), hash21(up.xy * 11.7 + axis.z * 3.9));
}
void fragment() {
	vec2 q = UV * 2.0 - 1.0;
	float r = length(q);
	float n = vnoise(q * 2.3 + vseed * 31.0) * 0.6 + vnoise(q * 5.7 + vseed * 17.0) * 0.4;
	float shape = 1.0 - smoothstep(1.0 - edge_softness, 1.0, r + (n - 0.5) * grain);
	shape *= shape;
	ALBEDO = COLOR.rgb * (1.0 - tone_shade * (n - 0.25));
	ALPHA = clamp(shape * density * COLOR.a, 0.0, 1.0);
}
"""

const SPARK_SHADER := """
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
// Tapered ember streak: a camera-facing ribbon along the instance X axis. Head is hot,
// tail fades. Additive but capped so a burst never blooms into a glow ball.
uniform float energy : hint_range(0.5, 4.0) = 1.6;
void vertex() {
	mat4 mv = VIEW_MATRIX * MODEL_MATRIX;
	vec3 centre = (mv * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	vec3 axis = (mv * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
	float full = max(length(axis), 0.0001);
	vec2 dir = axis.xy;
	float flat_len = length(dir);
	dir = flat_len > 0.00001 ? dir / flat_len : vec2(1.0, 0.0);
	float shown = max(flat_len, full * 0.3);
	vec2 perp = vec2(-dir.y, dir.x);
	vec3 pos = centre + vec3(dir * VERTEX.x * shown + perp * VERTEX.z * full, 0.0);
	POSITION = PROJECTION_MATRIX * vec4(pos, 1.0);
}
void fragment() {
	ALBEDO = COLOR.rgb * energy;
	ALPHA = clamp(COLOR.a, 0.0, 1.0);
}
"""
