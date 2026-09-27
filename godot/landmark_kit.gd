extends RefCounted
## Brann's Forge VR — Landmark Kit (landmarks commission, 2026-09-25).
##
## Deterministic, flat-shaded, low-poly geological and architectural masses for
## close-to-midrange set dressing (roughly 5–45 m from the player): quarry mesas
## with strata and broken faces, cut-stone benches, mossy ruin arches and walls,
## crystal outcrops / seams / cavern walls / stalactites, floating-island
## undersides, timber and stone bridges, basalt column clusters, dressed forge
## pillars and restrained ground fissures.
##
## Batching contract: every op appends to ONE shared vertex-coloured stone
## surface and ONE shared emissive surface, so a whole zone set is a single
## MeshInstance3D = at most two draw calls (plus shadow passes). No per-op nodes.
##
## Collision contract: large solids register explicit primitive proxies
## (BoxShape3D / CylinderShape3D) fitted INSIDE the generated rock, so a proxy
## can never stand proud of the visible surface (no invisible blockers). Debris,
## seams, stalactites, island undersides and fissures are visual-only. A FAR kit
## (detail = FAR) is visual-only by default, drops small detail and casts no
## shadow.
##
##   const LandmarkKit := preload("res://landmark_kit.gd")
##   var kit := LandmarkKit.new("sandstone_quarry")            # NEAR, collision on
##   kit.mesa(Vector3(-11.5, -2, -18), Vector3(10, 12, 7.5), {"broken": 0.55})
##   var node: Node3D = kit.build(zone_root)                   # Node3D container
##   print(kit.stats(), kit.check_clearance(LandmarkKit.keepouts("sandstone_quarry")))
##
## All positions are in the parent's local space (zone-local inside WorldZones).
## Every op accepts an options Dictionary; common keys: "yaw" (radians),
## "face_to" (Vector3 the local +Z front should look at), "seed", "name".

const NEAR := 0
const FAR := 1
const MAX_LIGHTS := 2
# Godot treats clockwise triangles as front faces; geometry below is authored
# counter-clockwise-outward and reversed on emit.
const _BOX_FACES := [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]]

const PALETTES := {
	"sandstone": {"bands": ["c47a47", "d99a5e", "b86d45", "e3ae76", "cf8d59", "a9623f"], "top": "e8c48f", "dark": "7d4a33", "debris": "c98a5c", "glow": "ffc36b", "glow2": "ffd98a", "wood": "8c603d", "trim": "c9a36a", "stone": "d4a877", "rope": "d8c49a", "moss": "a8a45a"},
	"ruin": {"bands": ["8f978d", "a0a698", "858d83", "979d90", "7c847a"], "top": "6f8f4a", "dark": "5a6159", "debris": "9aa093", "glow": "a7c76b", "glow2": "d6e59a", "wood": "6b4e36", "trim": "8a9a6a", "stone": "a0a698", "rope": "c8b98f", "moss": "6f8f4a"},
	"crystal": {"bands": ["4a5268", "434a60", "565e77", "3c4257", "505873"], "top": "6a7290", "dark": "262a3a", "debris": "4f566e", "glow": "58cee6", "glow2": "e49bdc", "wood": "a18266", "trim": "bfaa83", "stone": "5a6179", "rope": "bfaa83", "moss": "56708a"},
	"sky": {"bands": ["b8b09a", "a39c86", "909aa3", "808c98", "6f7b89"], "top": "93ad6a", "dark": "5a6574", "debris": "c2c7b2", "glow": "a4e5ea", "glow2": "d9b675", "wood": "87745f", "trim": "d9b675", "stone": "cfd2bb", "rope": "e4d6ad", "moss": "7fa35a"},
	"basalt": {"bands": ["3d3741", "48404d", "35303a", "514756", "433c48"], "top": "6a5f68", "dark": "221e26", "debris": "4a4250", "glow": "ff7a2e", "glow2": "ffb45a", "wood": "5a4032", "trim": "92807d", "stone": "5c525e", "rope": "8a7a6a", "moss": "6a5f68"},
}
const ZONE_FAMILY := {
	"forge_yard": "sandstone", "sandstone_quarry": "sandstone", "enchanted_kitchen": "sandstone",
	"pinewood_ruins": "ruin", "orchard_highlands": "ruin", "mushroom_glade": "ruin", "gloamfen": "ruin",
	"crystal_hollow": "crystal", "starfall_ridge": "crystal",
	"sky_garden": "sky", "cloudbreak_keep": "sky", "ember_foundry": "basalt",
}
const GLOW_ENERGY := {"sandstone": 1.0, "ruin": 0.8, "crystal": 1.7, "sky": 0.8, "basalt": 2.6}

static var _stone_mat: StandardMaterial3D
static var _glow_mats: Dictionary = {}
static var _glow_shader: Shader

var zone_id := ""
var family := ""
var pal: Dictionary = {}
var detail := NEAR
var collision := true
var shadows := true
var glow_energy := 1.0
var seed_base := 0

var _sv := PackedVector3Array()
var _sn := PackedVector3Array()
var _sc := PackedColorArray()
var _gv := PackedVector3Array()
var _gn := PackedVector3Array()
var _gc := PackedColorArray()
var _proxies: Array = []
var _lights: Array = []
var _elements: Array = []
var _el: Dictionary = {}
var _xf := Transform3D.IDENTITY
var _rng := RandomNumberGenerator.new()
var _top_on := false
var _top_col := Color.WHITE


## options: "detail" (NEAR/FAR), "collision" (bool, default NEAR only),
## "shadows" (bool), "seed" (int), "family" (palette family override),
## "palette" (Dictionary of palette key overrides), "glow_energy" (float).
func _init(zone: String = "sandstone_quarry", options: Dictionary = {}) -> void:
	zone_id = zone
	family = options.get("family", ZONE_FAMILY.get(zone, "sandstone"))
	pal = (PALETTES[family] as Dictionary).duplicate(true)
	if options.has("palette"):
		pal.merge(options["palette"], true)
	detail = options.get("detail", NEAR)
	collision = options.get("collision", detail == NEAR)
	shadows = options.get("shadows", detail == NEAR)
	glow_energy = options.get("glow_energy", GLOW_ENERGY.get(family, 1.0))
	seed_base = int(options.get("seed", 0)) ^ hash(zone)


# ---------------------------------------------------------------- geology ops

## Flat-topped butte with alternating strata ledges, vertical clefts, a broken
## (bitten, lowered) sector, an optional stepped top tier and talus at the break.
## pos = centre of the base (sink it below the floor for cliffs past the edge).
## size = (width, height, depth). Options: broken 0..1, broken_dir (local
## radians, 0 = +X), squareness (superellipse exponent), bands, clefts, tier,
## talus, ground_y (talus height in parent space).
func mesa(pos: Vector3, size: Vector3, o: Dictionary = {}) -> void:
	_begin("mesa", pos, o)
	var near := detail == NEAR
	var n: int = o.get("sides", 10 if near else 7)
	var rx := size.x * 0.5
	var rz := size.z * 0.5
	var h := size.y
	var expo: float = o.get("squareness", 4.5)
	var broken: float = o.get("broken", 0.5)
	var bdir: float = o.get("broken_dir", _rng.randf() * TAU)
	var base := PackedFloat32Array()
	for i in n:
		base.append(_rng.randf_range(0.88, 1.08))
	for k in int(o.get("clefts", 2 if near else 1)):
		base[_rng.randi() % n] *= 0.84
	var bands: int = o.get("bands", clampi(int(h / 1.5), 3, 7) if near else clampi(int(h / 3.0), 2, 3))
	var edges := PackedFloat32Array([0.0])
	var weights := PackedFloat32Array()
	var total := 0.0
	for b in bands:
		weights.append(_rng.randf_range(0.7, 1.3))
		total += weights[b]
	for b in bands:
		edges.append(edges[b] + h * weights[b] / total)
	var bite_y := h * (1.0 - broken * 0.6)
	var rings: Array = []
	var cols: Array = []
	var bandcols: Array = pal["bands"]
	var off := _rng.randi() % bandcols.size()
	for b in bands:
		var lip := 1.0 + _rng.randf_range(-0.03, 0.035)
		var col := _c(bandcols[(b + off) % bandcols.size()])
		for e in 2:
			var yy: float = edges[b + e]
			var m := PackedFloat32Array()
			var ys := PackedFloat32Array()
			for i in n:
				var a := TAU * float(i) / float(n)
				var w := maxf(0.0, 1.0 - absf(angle_difference(a, bdir)) / 1.1)
				var bite := 0.0
				if yy > bite_y:
					bite = w * broken * 0.32 * clampf((yy - bite_y) / maxf(h - bite_y, 0.01), 0.0, 1.0)
				m.append(base[i] * lerpf(1.0, 0.9, yy / h) * lip * (1.0 - bite) * _rng.randf_range(0.985, 1.015))
				ys.append(-_rng.randf_range(0.0, 0.3) - w * broken * h * 0.2 if (b == bands - 1 and e == 1) else 0.0)
			rings.append(_ring(0.0, 0.0, yy, rx, rz, n, m, expo, 0.0, ys))
		cols.append(col)
		cols.append(_c("dark").lerp(col, 0.6))
	cols.pop_back()
	_lathe(rings, cols, true, false, false, "top", 0.08)
	if near and o.get("tier", h > 5.0):
		var tdir := bdir + PI
		var tcx := cos(tdir) * rx * 0.22
		var tcz := sin(tdir) * rz * 0.22
		var th := h * _rng.randf_range(0.12, 0.18)
		var ty := h - 0.5
		var tm := PackedFloat32Array()
		for i in 8:
			tm.append(_rng.randf_range(0.9, 1.08))
		var trings: Array = []
		for spec in [[ty, 0.5], [ty + th * 0.55, 0.47], [ty + th * 0.55, 0.43], [ty + th, 0.4]]:
			var mm := PackedFloat32Array()
			for v in tm:
				mm.append(v * spec[1])
			trings.append(_ring(tcx, tcz, spec[0], rx, rz, 8, mm, expo, 0.2))
		var tc := _c(bandcols[(bands + off) % bandcols.size()])
		_lathe(trings, [tc, _c("dark").lerp(tc, 0.6), tc], true, false, false, "top", 0.05)
	if collision:
		var ytop := minf(bite_y, h * 0.9)
		_fit_box(rings, 0.0, ytop, Vector2(1.0, 0.62), Vector2(rx, rz))
		_fit_box(rings, 0.0, ytop, Vector2(0.62, 1.0), Vector2(rx, rz))
	var xf := _xf
	_end()
	if near and o.get("talus", true):
		var gy: float = o.get("ground_y", 0.0)
		var tp := xf * Vector3(cos(bdir) * rx * 1.12, 0.0, sin(bdir) * rz * 1.12)
		talus(Vector3(tp.x, gy, tp.z), minf(rx, rz) * 0.55, 6, {"max_size": clampf(h * 0.13, 0.6, 1.6), "name": _el_name_hint(o, "talus")})


## Terraced blocks of dressed quarry stone with hairline cracks, stepping back
## away from the local +Z front. size = (width, total height, depth).
func cut_blocks(pos: Vector3, size: Vector3, o: Dictionary = {}) -> void:
	_begin("cut_blocks", pos, o)
	var near := detail == NEAR
	var steps: int = o.get("steps", 3)
	var sh := size.y / float(steps)
	var bandcols: Array = pal["bands"]
	for k in steps:
		var d := size.z * (1.0 - 0.28 * float(k))
		var w := size.x * (1.0 - 0.07 * float(k))
		var zc := -(size.z - d) * 0.5
		var nb := 2 + (k % 2)
		for j in nb:
			var bw := w / float(nb)
			var xc := -w * 0.5 + bw * (float(j) + 0.5)
			var bh := sh * _rng.randf_range(0.93, 1.0)
			_part()
			_jbox(Vector3(xc, sh * k + bh * 0.5, zc), Vector3(bw * 0.985, bh, d), Basis(Vector3.UP, _rng.randf_range(-0.02, 0.02)), _c(bandcols[(k * 3 + j) % bandcols.size()]), 0.02)
			if near and _rng.randf() < 0.65:
				var fx := xc + _rng.randf_range(-0.25, 0.25) * bw
				_crack(Vector3(fx, sh * k + bh * 0.96, zc + d * 0.5), Vector3(fx + _rng.randf_range(-0.3, 0.3) * bw, sh * k + bh * _rng.randf_range(0.15, 0.4), zc + d * 0.5), Vector3.BACK, 0.05)
		if collision:
			_add_box_proxy(Vector3(0.0, sh * k + sh * 0.46, zc), Vector3(w * 0.95, sh * 0.9, d * 0.93))
	_end()


## Faceted boulder. Proxy only when footprint area >= min_collide_area (2 m²).
func boulder(pos: Vector3, size: Vector3, o: Dictionary = {}) -> void:
	_begin("boulder", pos, o)
	var rings := _boulder_body(Vector3.ZERO, size, o)
	if collision and o.get("collide", true) and size.x * size.z >= float(o.get("min_collide_area", 2.0)) and size.y >= 0.8:
		_fit_box(rings, 0.0, size.y * 0.7, Vector2(1.0, 1.0), Vector2(size.x, size.z) * 0.5)
	_end()


## Scatter of small visual-only boulders (never collides).
func talus(center: Vector3, radius: float, count: int, o: Dictionary = {}) -> void:
	if detail == FAR:
		count = mini(count, 2)
	var mx: float = o.get("max_size", 1.0)
	var mn: float = o.get("min_size", mx * 0.35)
	var tmp := RandomNumberGenerator.new()
	tmp.seed = hash([seed_base, "talus", center.snapped(Vector3.ONE * 0.01)])
	for i in count:
		var a := float(i) * 2.39996 + tmp.randf() * 0.5
		var r := sqrt((float(i) + 0.5) / float(count)) * radius
		var s := lerpf(mn, mx, tmp.randf()) * (1.0 - 0.35 * r / maxf(radius, 0.01))
		boulder(center + Vector3(cos(a) * r, 0.0, sin(a) * r), Vector3(s * 1.25, s * 0.7, s), {"collide": false, "yaw": tmp.randf() * TAU, "name": str(o.get("name", "talus"))})


## Leaning angular cave slab (front = local +Z, lean toward the front) with
## glowing crystal edge-seams. size = (width, height, thickness).
func cavern_wall(pos: Vector3, size: Vector3, o: Dictionary = {}) -> void:
	_begin("cavern_wall", pos, o)
	var near := detail == NEAR
	var n := 7 if near else 5
	var lean: float = o.get("lean", 0.1)
	var h := size.y
	var rings: Array = []
	var cols: Array = []
	var bandcols: Array = pal["bands"]
	var base := PackedFloat32Array()
	for i in n:
		base.append(_rng.randf_range(0.85, 1.12))
	var prof := [[-0.3, 1.0], [0.28 * h, 1.05], [0.55 * h, 0.92], [0.8 * h, 0.72], [h, 0.4]]
	for k in prof.size():
		var y: float = prof[k][0]
		var m := PackedFloat32Array()
		for i in n:
			m.append(base[i] * prof[k][1] * _rng.randf_range(0.92, 1.06))
		rings.append(_ring(_rng.randf_range(-0.2, 0.2), lean * maxf(y, 0.0), y, size.x * 0.5, size.z * 0.5, n, m, 1.8, 0.3))
		if k < prof.size() - 1:
			cols.append(_c(bandcols[k % bandcols.size()]))
	_lathe(rings, cols, true, false, false, "top", 0.3)
	var seams: int = o.get("seams", 2 if near else 1)
	var order := _front_vertices(rings[1], n)
	for s in mini(seams, order.size()):
		var col := _c("glow" if s % 2 == 0 else str(o.get("seam2", "glow")))
		col.a = 0.9
		_part()
		_edge_seam(rings, order[s], 1, 3, col, 0.1)
		var p: Vector3 = rings[1][order[s]]
		var out := (p - _centroid(rings[1]))
		out.y = 0.0
		for c in (3 if near else 1):
			_shard(p + Vector3(0, -0.15 * c, 0), (out.normalized() + Vector3(0, 1.1, 0)).rotated(Vector3.UP, _rng.randf_range(-0.6, 0.6)), _rng.randf_range(0.5, 1.2) * (1.0 - 0.25 * c), 0.12 - 0.02 * c, col.darkened(0.2), col.lightened(0.3))
	if collision:
		_fit_box(rings, 0.0, 0.5 * h, Vector2(1.0, 0.8), Vector2(size.x, size.z) * 0.5)
		_fit_box(rings, 0.5 * h, 0.78 * h, Vector2(1.0, 0.8), Vector2(size.x, size.z) * 0.45)
	_end()


## Angular rock mass bristling with crystal shards. Big shards (>= 1.8 m) get
## thin inscribed box proxies (max 2). size = rock (width, height, depth).
## Options: crystals, hues (palette keys), facing (local radians bias), spread.
func crystal_outcrop(pos: Vector3, size: Vector3, o: Dictionary = {}) -> void:
	_begin("crystal_outcrop", pos, o)
	var near := detail == NEAR
	var rings := _boulder_body(Vector3.ZERO, size, {"sides": 6 if near else 5, "expo": 1.7, "jitter": 0.16, "color": o.get("color", "")})
	var count: int = o.get("crystals", 5 if near else 3)
	var hues: Array = o.get("hues", ["glow", "glow2"])
	var facing: float = o.get("facing", _rng.randf() * TAU)
	var spread: float = o.get("spread", 1.4)
	var big := 0
	for k in count:
		var a := facing + _rng.randf_range(-spread, spread)
		var t := _rng.randf_range(0.5, 0.85)
		var surf := Vector3(cos(a) * size.x * 0.5 * (1.0 - t * 0.55), size.y * t, sin(a) * size.z * 0.5 * (1.0 - t * 0.55)) * 0.82
		var dir := (Vector3(cos(a), 0.0, sin(a)) * _rng.randf_range(0.3, 0.75) + Vector3.UP).normalized()
		var length := size.y * _rng.randf_range(0.45, 0.95) * (1.35 if k == 0 else 1.0) * float(o.get("crystal_scale", 1.0))
		var col := _c(hues[k % hues.size()])
		_part()
		_shard(surf, dir, length, length * 0.17, Color(col.darkened(0.3), 0.55), Color(col.lightened(0.35), 1.0))
		if near:
			for s in 2:
				var sd := dir.rotated(Vector3.UP, _rng.randf_range(-1.0, 1.0)).lerp(Vector3(cos(a), 0, sin(a)), 0.3).normalized()
				_shard(surf + Vector3(_rng.randf_range(-0.3, 0.3), -0.1, _rng.randf_range(-0.3, 0.3)), sd, length * _rng.randf_range(0.3, 0.5), length * 0.09, Color(col.darkened(0.3), 0.5), Color(col.lightened(0.3), 1.0))
		if collision and length >= 1.8 and big < 2:
			big += 1
			var r := length * 0.17
			_add_box_proxy(surf + dir * length * 0.36, Vector3(r * 1.15, length * 0.62, r * 1.15), _basis_up(dir))
	if collision:
		_fit_box(rings, 0.0, size.y * 0.65, Vector2(1.0, 1.0), Vector2(size.x, size.z) * 0.5)
	_end()


## Visual-only line of glow ribbon + small shards across a surface from a to b.
## normal = direction the host surface faces (shards grow along it).
func crystal_seam(a: Vector3, b: Vector3, normal: Vector3, o: Dictionary = {}) -> void:
	_begin("crystal_seam", a, o)
	var d := b - a
	var L := d.length()
	var nrm := normal.normalized()
	var side := d.cross(nrm).normalized()
	var col := _c(o.get("hue", "glow"))
	var steps := maxi(2, int(L / 0.45))
	var prev := Vector3.ZERO
	for i in range(1, steps + 1):
		var t := float(i) / float(steps)
		var cur := d * t + side * (_rng.randf_range(-0.15, 0.15) if i < steps else 0.0)
		var w0 := 0.07 * sin(PI * (t - 1.0 / steps)) + 0.02
		var w1 := 0.07 * sin(PI * t) + 0.02
		_quad_h(prev - side * w0 + nrm * 0.03, prev + side * w0 + nrm * 0.03, cur + side * w1 + nrm * 0.03, cur - side * w1 + nrm * 0.03, Color(col, 0.95), prev - nrm, true)
		if detail == NEAR and i % 2 == 0:
			_shard(cur - nrm * 0.05, (nrm + Vector3(0, 0.6, 0) + side * _rng.randf_range(-0.5, 0.5)).normalized(), _rng.randf_range(0.25, 0.65), 0.07, Color(col.darkened(0.25), 0.6), Color(col.lightened(0.35), 1.0))
		prev = cur
	_end()


## Jagged vertical rock face along a->b (XZ; y ignored) from top_y down to
## bottom_y, facing toward o.facing (Vector3). Visual-only: meant for chasm
## walls, cut edges under floors and ledge skirts. Options: seams (int).
func cliff_face(a: Vector3, b: Vector3, top_y: float, bottom_y: float, o: Dictionary = {}) -> void:
	_begin("cliff_face", Vector3.ZERO, o)
	var near := detail == NEAR
	var d := Vector3(b.x - a.x, 0.0, b.z - a.z)
	var L := d.length()
	var dir := d / L
	var nrm := Vector3(dir.z, 0.0, -dir.x)
	var facing: Vector3 = o.get("facing", a + nrm)
	if nrm.dot(facing - a) < 0.0:
		nrm = -nrm
	var nc := maxi(2, int(L / (1.3 if near else 2.6)) + 1)
	var nr := maxi(2, int((top_y - bottom_y) / (1.2 if near else 2.4)) + 1)
	var grid: Array = []
	for r in nr:
		var row := PackedVector3Array()
		var y := lerpf(top_y, bottom_y, float(r) / float(nr - 1))
		for c in nc:
			var p := Vector3(a.x, y, a.z) + d * (float(c) / float(nc - 1))
			if r == 0:
				p -= nrm * 0.12
			else:
				p += nrm * _rng.randf_range(-0.35, 0.4) + Vector3(0, _rng.randf_range(-0.25, 0.25), 0)
				if c > 0 and c < nc - 1:
					p += dir * _rng.randf_range(-0.35, 0.35)
			row.append(p)
		grid.append(row)
	var bandcols: Array = pal["bands"]
	for r in nr - 1:
		_part()
		var col := _c(bandcols[r % bandcols.size()]).lerp(_c("dark"), 0.55 * float(r) / float(nr - 1))
		for c in nc - 1:
			var q0: Vector3 = grid[r][c]
			_quad_h(q0, grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c], _shade(col, 0.07), q0 - nrm * 3.0)
	var seams: int = o.get("seams", 0)
	for s in seams:
		var c0 := 1 + _rng.randi() % maxi(1, nc - 2)
		var col := _c(o.get("hue", "glow") if s % 2 == 0 else o.get("hue2", "glow2"))
		col.a = 0.95
		_part()
		for r in range(1, nr - 1):
			var p0: Vector3 = grid[r][c0]
			var p1: Vector3 = grid[r + 1][clampi(c0 + (1 if _rng.randf() < 0.5 else -1) * (r % 2), 0, nc - 1)]
			var side := (p1 - p0).cross(nrm).normalized() * 0.08
			_quad_h(p0 - side + nrm * 0.05, p0 + side + nrm * 0.05, p1 + side + nrm * 0.05, p1 - side + nrm * 0.05, col, p0 - nrm, true)
			if near and r % 2 == 1:
				_shard(p0, (nrm + Vector3(0, 0.4, 0)).normalized(), _rng.randf_range(0.35, 0.8), 0.09, Color(col.darkened(0.25), 0.6), Color(col.lightened(0.3), 1.0))
	_end()


## Hanging ceiling spike, visual-only. top = attachment point on the ceiling.
func stalactite(top: Vector3, length: float, radius: float, o: Dictionary = {}) -> void:
	_begin("stalactite", top, o)
	var n := 6 if detail == NEAR else 4
	var rings: Array = []
	for spec in [[-0.6 * length, 0.42], [-0.3 * length, 0.78], [0.4, 1.0]]:
		var m := PackedFloat32Array()
		for i in n:
			m.append(spec[1] * _rng.randf_range(0.8, 1.15))
		rings.append(_ring(_rng.randf_range(-0.1, 0.1), _rng.randf_range(-0.1, 0.1), spec[0], radius, radius, n, m, 2.0, _rng.randf() * TAU))
	var bandcols: Array = pal["bands"]
	_top_on = false
	_lathe(rings, [_c("dark").lerp(_c(bandcols[0]), 0.5), _c(bandcols[1])], false, true, false, null, length * 0.4)
	if o.get("crystal", false):
		var col := _c(o.get("hue", "glow"))
		_shard(Vector3(0, -length * 0.62, 0), Vector3.DOWN, length * 0.45, radius * 0.3, Color(col.darkened(0.3), 0.6), Color(col.lightened(0.3), 1.0))
	_end()


# ------------------------------------------------------------ sky & structure

## Stratified inverted keel under an existing flat island top. top_center = the
## island's walk-surface centre; size = its XZ footprint (kept 1.5 % inside so
## it never pokes out past the existing floor collision). Visual-only; replaces
## the WorldZones.island() cone. Options: depth, spurs, vines, chunks.
func island_underside(top_center: Vector3, size: Vector2, depth: float, o: Dictionary = {}) -> void:
	_begin("island_underside", top_center, o)
	var near := detail == NEAR
	var n := 16 if near else 10
	var rx := size.x * 0.5 * 0.985
	var rz := size.y * 0.5 * 0.985
	var tip := Vector2(_rng.randf_range(-0.18, 0.18) * rx, _rng.randf_range(-0.18, 0.18) * rz)
	var top_y: float = o.get("top_y", -0.3)
	# [y, radius multiplier, superellipse exponent, jitter, band colour index]
	var prof := [[-depth, 0.07, 2.0, 0.3, 4], [-depth * 0.8, 0.2, 2.1, 0.22, 4], [-depth * 0.56, 0.42, 2.3, 0.16, 3],
		[-depth * 0.33, 0.66, 2.8, 0.12, 2], [-depth * 0.31, 0.72, 2.9, 0.1, 2], [-1.45, 0.9, 3.8, 0.06, 1],
		[-1.3, 0.96, 4.0, 0.03, 0], [top_y, 1.0, 4.2, 0.0, 0]]
	var rings: Array = []
	var cols: Array = []
	var bandcols: Array = pal["bands"]
	for k in prof.size():
		var spec: Array = prof[k]
		var y: float = spec[0]
		var f := clampf(-y / depth, 0.0, 1.0)
		var m := PackedFloat32Array()
		for i in n:
			m.append(spec[1] * (1.0 - _rng.randf_range(0.0, spec[3])) if k < prof.size() - 1 else 1.0)
		rings.append(_ring(tip.x * f, tip.y * f, y, rx, rz, n, m, spec[2], 0.0))
		if k < prof.size() - 1:
			cols.append(_c(bandcols[mini(int(spec[4]), bandcols.size() - 1)]))
	_top_on = false
	_lathe(rings, cols, false, true, false, null, depth * 0.12)
	if near:
		var spurs: int = o.get("spurs", 3)
		for s in spurs:
			var a := _rng.randf() * TAU
			var rr := _rng.randf_range(0.35, 0.55)
			var c := Vector3(cos(a) * rx * rr, -depth * 0.3, sin(a) * rz * rr)
			var sl := depth * _rng.randf_range(0.25, 0.45)
			var srings: Array = []
			for spec in [[-sl, 0.25], [-sl * 0.5, 0.6], [0.4, 1.0]]:
				var sm := PackedFloat32Array()
				for i in 6:
					sm.append(spec[1] * _rng.randf_range(0.8, 1.15))
				srings.append(_ring(c.x, c.z, c.y + spec[0], rx * 0.14, rz * 0.14, 6, sm, 2.0, _rng.randf()))
			_part()
			_lathe(srings, [_c(bandcols[4 % bandcols.size()]), _c(bandcols[3 % bandcols.size()])], false, true, false, null, sl * 0.3)
		var vines: int = o.get("vines", 7)
		for v in vines:
			var a := TAU * (float(v) + _rng.randf()) / float(vines)
			var p := _ring(0, 0, top_y - 0.5, rx * 0.985, rz * 0.985, 1, PackedFloat32Array(), 4.2, a)[0]
			_part()
			_vine(p, _rng.randf_range(1.2, 3.2))
		for c in int(o.get("chunks", 2)):
			var cp := Vector3(tip.x + _rng.randf_range(-2.0, 2.0), -depth - _rng.randf_range(1.2, 2.6), tip.y + _rng.randf_range(-2.0, 2.0))
			var cs := _rng.randf_range(0.6, 1.3)
			_part()
			_boulder_body(cp, Vector3(cs * 1.2, cs, cs), {"color": bandcols[3 % bandcols.size()]})
	_end()


## New small walkable island: grass slab + underside. The slab top gets an exact
## box proxy (walkable) when collision is on.
func islet(pos: Vector3, size: Vector2, o: Dictionary = {}) -> void:
	_begin("islet", pos, o)
	_top_on = true
	_top_col = _c("top")
	_jbox(Vector3(0, -0.35, 0), Vector3(size.x, 0.7, size.y), Basis(), _c(pal["bands"][0]), 0.0)
	if collision and o.get("walkable", true):
		_add_box_proxy(Vector3(0, -0.35, 0), Vector3(size.x, 0.7, size.y))
	_end()
	var uo: Dictionary = o.duplicate()
	uo["top_y"] = -0.65
	uo["name"] = str(o.get("name", "islet")) + "_underside"
	island_underside(pos, size, float(o.get("depth", maxf(size.x, size.y) * 0.8)), uo)


## Bridge between deck-top points a and b. style "timber" (planks, stringers,
## posts, rope rails, sag) or "stone" (slab deck, parapets, spandrel arch,
## piers). broken_at (0.1..1) truncates the span with a jagged end.
## Collision: deck box(es) + rail/parapet boxes (set "rails": false to omit).
func bridge(a: Vector3, b: Vector3, o: Dictionary = {}) -> void:
	var d := b - a
	var hd := Vector3(d.x, 0.0, d.z)
	var L := hd.length()
	var opts: Dictionary = o.duplicate()
	opts["yaw"] = atan2(-hd.z, hd.x)
	opts.erase("face_to")
	_begin("bridge", a, opts)
	_top_on = false
	var style: String = o.get("style", "timber")
	var width: float = o.get("width", 2.2)
	var upto: float = clampf(o.get("broken_at", 1.0), 0.1, 1.0)
	var sag: float = o.get("sag", 0.35 if style == "timber" else 0.0)
	var rails: bool = o.get("rails", true)
	var dy := d.y
	var span := L * upto
	if style == "timber":
		var wood := _c("wood")
		var step := 0.58
		var count := int(span / step)
		for i in count:
			var t := (float(i) + 0.5) * step / L
			var y := _deck_y(t, dy, sag)
			var slope := atan((_deck_y(t + 0.01, dy, sag) - y) / (0.01 * L))
			var bb := Basis(Vector3.BACK, slope) * Basis(Vector3.UP, _rng.randf_range(-0.04, 0.04))
			if upto < 1.0 and i >= count - 2:
				bb = Basis(Vector3.BACK, -0.5 - 0.45 * float(i - count + 2)) * bb
				y -= 0.18 * float(i - count + 3)
			_part()
			_jbox(Vector3(t * L, y - 0.06, _rng.randf_range(-0.05, 0.05)), Vector3(step * 0.86, 0.1, width * _rng.randf_range(0.88, 1.0)), bb, _shade(wood, 0.1), 0.01)
		var segs := maxi(1, int(span / 2.0))
		for s in segs:
			var t0 := float(s) / float(segs) * upto
			var t1 := float(s + 1) / float(segs) * upto
			for side in [-1.0, 1.0]:
				var z: float = side * (width * 0.5 - 0.22)
				_part()
				_beam(Vector3(t0 * L, _deck_y(t0, dy, sag) - 0.2, z), Vector3(t1 * L, _deck_y(t1, dy, sag) - 0.2, z), 0.16, wood.darkened(0.2))
		var posts: Array = []
		var x := 0.0
		while x <= span - 0.4:
			posts.append(x / L)
			x += 2.4
		for side in [-1.0, 1.0]:
			var z: float = side * width * 0.5
			var prev := Vector3.INF
			for t in posts:
				var y := _deck_y(t, dy, sag)
				_part()
				_jbox(Vector3(t * L, y + 0.3, z), Vector3(0.16, 1.3, 0.16), Basis(), wood.darkened(0.1), 0.01)
				_jbox(Vector3(t * L, y + 0.98, z), Vector3(0.22, 0.08, 0.22), Basis(), _c("trim"), 0.0)
				var top := Vector3(t * L, y + 0.92, z)
				if prev != Vector3.INF:
					_beam(prev, top, 0.06, _c("rope"))
					_beam(prev - Vector3(0, 0.42, 0), top - Vector3(0, 0.42, 0), 0.05, _c("rope"))
				prev = top
	else:
		var stone := _c("stone")
		var seg_len := 1.6
		var count := ceili(span / seg_len)
		var rise: float = o.get("arch_rise", L * 0.16)
		for i in count:
			var t0 := float(i) * seg_len / L
			var t1 := minf(float(i + 1) * seg_len, span) / L
			var y0 := _deck_y(t0, dy, 0.0)
			var y1 := _deck_y(t1, dy, 0.0)
			var last := i == count - 1 and upto < 1.0
			var tilt := Basis(Vector3.BACK, -0.12) if last else Basis()
			_part()
			_jbox(Vector3((t0 + t1) * 0.5 * L, (y0 + y1) * 0.5 - 0.2 - (0.08 if last else 0.0), 0.0), Vector3((t1 - t0) * L * 0.985, 0.4, width), tilt, _shade(stone, 0.05), 0.03)
			for side in [-1.0, 1.0]:
				if last and side > 0.0:
					continue
				var ph := 0.7 * (_rng.randf_range(0.45, 0.8) if last else 1.0)
				_jbox(Vector3((t0 + t1) * 0.5 * L, (y0 + y1) * 0.5 + ph * 0.5, side * (width * 0.5 - 0.17)), Vector3((t1 - t0) * L * 0.95, ph, 0.34), tilt, _shade(stone.darkened(0.08), 0.05), 0.03)
			# Spandrel between deck and a segmental soffit reads as a structural arch.
			var dep0 := 0.35 + rise * (1.0 - sin(PI * t0))
			var dep1 := 0.35 + rise * (1.0 - sin(PI * t1))
			var p := []
			for k in 8:
				var tt := t1 if k & 1 else t0
				var yy := _deck_y(tt, dy, 0.0) - 0.4
				if k & 2 == 0:
					yy -= dep1 if k & 1 else dep0
				p.append(Vector3(tt * L, yy, (width * 0.44) * (1.0 if k & 4 else -1.0)))
			_box8(p, _c(pal["bands"][i % 2]).lerp(stone, 0.5))
		var pier_depth: float = o.get("pier_depth", 7.0)
		for t in ([0.0, 1.0] if upto >= 1.0 else [0.0]):
			var y := _deck_y(t, dy, 0.0) - 0.4 - 0.35 - rise
			var ph := pier_depth - 0.75 - rise
			_part()
			_jbox(Vector3(t * L + (0.5 if t == 0.0 else -0.5), y - ph * 0.5 + 0.2, 0.0), Vector3(1.3, ph + 0.4, width * 0.85), Basis(), _c(pal["bands"][2 % pal["bands"].size()]), 0.05, false, 0.7)
	if collision:
		var nseg := 1 if sag < 0.15 else 3
		for s in nseg:
			var t0 := float(s) / float(nseg) * upto
			var t1 := float(s + 1) / float(nseg) * upto
			if style == "timber" and upto < 1.0 and s == nseg - 1:
				t1 = maxf(t0 + 0.02, t1 - 1.2 / L)
			var p0 := Vector3(t0 * L, _deck_y(t0, dy, sag), 0.0)
			var p1 := Vector3(t1 * L, _deck_y(t1, dy, sag), 0.0)
			var bb := Basis(Vector3.BACK, atan2(p1.y - p0.y, p1.x - p0.x))
			var seg_l := p0.distance_to(p1)
			var thick := 0.12 if style == "timber" else 0.4
			_add_box_proxy((p0 + p1) * 0.5 - bb.y * thick * 0.5, Vector3(seg_l, thick, width * (0.86 if style == "timber" else 1.0)), bb)
			if rails:
				for side in [-1.0, 1.0]:
					if style == "stone" and upto < 1.0 and side > 0.0 and s == nseg - 1:
						seg_l *= 0.6
					var rh := 0.9 if style == "timber" else 0.62
					var rt := 0.08 if style == "timber" else 0.28
					_add_box_proxy((p0 + p1) * 0.5 + Vector3(0, rh * 0.5, side * (width * 0.5 - (0.0 if style == "timber" else 0.17))), Vector3(seg_l * 0.96, rh, rt), bb)
	_end()


## Cluster of hexagonal basalt columns with slanted, bevelled tops and cooling
## joints. fissures = number of restrained glowing edge-cracks (default 1).
## collision_mode: "columns" (cylinder per column, default), "core", "none".
func basalt_cluster(pos: Vector3, radius: float, height: float, o: Dictionary = {}) -> void:
	_begin("basalt_cluster", pos, o)
	var near := detail == NEAR
	var count: int = o.get("columns", clampi(int(radius * radius * 1.6), 3, 13))
	if not near:
		count = maxi(3, int(count * 0.6))
	var cr: float = o.get("column_radius", radius * 0.34)
	var slant_dir := _rng.randf() * TAU
	var sink: float = o.get("sink", 0.6)
	var bandcols: Array = pal["bands"]
	var infos: Array = []
	for c in count:
		var rr := sqrt((float(c) + 0.3) / float(count)) * radius * 0.78
		var a := float(c) * 2.39996 + _rng.randf() * 0.3
		var cx := cos(a) * rr
		var cz := sin(a) * rr
		var hh := height * (1.0 - 0.5 * rr / radius) * _rng.randf_range(0.7, 1.05)
		var r := cr * _rng.randf_range(0.8, 1.1)
		var slant := _rng.randf_range(0.08, 0.32)
		var phase := _rng.randf() * TAU
		var ys := PackedFloat32Array()
		for i in 6:
			ys.append(tan(slant) * r * cos(phase + TAU * float(i) / 6.0 - slant_dir))
		var col := _c(bandcols[c % bandcols.size()])
		var rings: Array = [_ring(cx, cz, -sink, r, r, 6, PackedFloat32Array(), 2.0, phase)]
		var cols: Array = [col]
		if near and hh > 2.5:
			var jy := hh * _rng.randf_range(0.35, 0.6)
			for spec in [[jy - 0.07, 1.0], [jy, 0.92], [jy + 0.07, 1.0]]:
				rings.append(_ring(cx, cz, spec[0], r * spec[1], r * spec[1], 6, PackedFloat32Array(), 2.0, phase))
			cols.append_array([col.darkened(0.25), col.darkened(0.25), col])
		rings.append(_ring(cx, cz, hh - 0.18, r, r, 6, PackedFloat32Array(), 2.0, phase, ys))
		rings.append(_ring(cx, cz, hh, r * 0.84, r * 0.84, 6, PackedFloat32Array(), 2.0, phase, ys))
		cols.append(col.lightened(0.12))
		_part()
		_lathe(rings, cols, true, false, false, "top", 0.0)
		infos.append({"x": cx, "z": cz, "h": hh - absf(tan(slant) * r) - 0.2, "r": r, "rings": rings})
	infos.sort_custom(func(p, q): return p["h"] > q["h"])
	var fis: int = o.get("fissures", 1)
	for f in mini(fis, infos.size()):
		var info: Dictionary = infos[f]
		var rings: Array = info["rings"]
		var col := _c("glow" if f % 2 == 0 else "glow2")
		col.a = 1.0
		_part()
		_edge_seam(rings, _rng.randi() % 6, 1, rings.size() - 2, col, 0.06)
	if collision:
		var mode: String = o.get("collision_mode", "columns")
		if mode == "core":
			var hmin := INF
			for info in infos:
				hmin = minf(hmin, info["h"])
			_add_cyl_proxy(Vector3(0, (hmin - sink) * 0.5, 0), radius * 0.5, hmin + sink)
		elif mode == "columns":
			for info in infos:
				if info["h"] > 0.8:
					_add_cyl_proxy(Vector3(info["x"], (info["h"] - sink) * 0.5, info["z"]), info["r"] * 0.84, info["h"] + sink)
	_end()


## Dressed square forge pillar: plinth, stacked blocks, capital and an optional
## glowing rune slit on the local +Z face. One box proxy.
func forge_pillar(pos: Vector3, height: float, o: Dictionary = {}) -> void:
	_begin("forge_pillar", pos, o)
	var w: float = o.get("width", 1.1)
	var bandcols: Array = pal["bands"]
	var broken: bool = o.get("broken", false)
	_top_on = true
	_top_col = _c("top")
	_jbox(Vector3(0, 0.25, 0), Vector3(w * 1.5, 0.5, w * 1.5), Basis(), _c(bandcols[0]), 0.03)
	_jbox(Vector3(0, 0.6, 0), Vector3(w * 1.28, 0.2, w * 1.28), Basis(), _c("stone"), 0.02)
	var shaft := height - 1.4
	var blocks := maxi(2, int(shaft / 1.3))
	var bh := shaft / float(blocks)
	var y := 0.7
	for k in blocks:
		var bb := Basis(Vector3.UP, _rng.randf_range(-0.05, 0.05))
		var hh := bh
		if broken and k == blocks - 1:
			bb = Basis(Vector3.RIGHT, _rng.randf_range(-0.12, 0.12)) * bb
			hh *= 0.7
		_part()
		_jbox(Vector3(_rng.randf_range(-0.03, 0.03), y + hh * 0.5, _rng.randf_range(-0.03, 0.03)), Vector3(w * _rng.randf_range(0.96, 1.04), hh * 0.985, w * _rng.randf_range(0.96, 1.04)), bb, _c(bandcols[(k + 1) % bandcols.size()]), 0.03)
		y += hh
	if not broken:
		_jbox(Vector3(0, y + 0.18, 0), Vector3(w * 1.38, 0.36, w * 1.38), Basis(), _c("stone"), 0.02)
		_jbox(Vector3(0, y + 0.49, 0), Vector3(w * 1.16, 0.26, w * 1.16), Basis(), _c(bandcols[0]), 0.02)
	if o.get("rune", true):
		var col := _c("glow2")
		col.a = 0.85
		_jbox(Vector3(0, 0.7 + shaft * 0.5, w * 0.5 + 0.03), Vector3(0.09, shaft * 0.5, 0.04), Basis(), col, 0.0, true)
		_jbox(Vector3(0, 0.7 + shaft * 0.68, w * 0.5 + 0.03), Vector3(0.42, 0.08, 0.04), Basis(), col, 0.0, true)
	if collision:
		_add_box_proxy(Vector3(0, y * 0.5, 0), Vector3(w * 0.9, y, w * 0.9))
	_end()


## Restrained glowing crack across a walkable floor with low dark lips.
## Visual-only and under 0.1 m tall, so it never trips or blocks.
func ground_fissure(a: Vector3, b: Vector3, o: Dictionary = {}) -> void:
	_begin("ground_fissure", a, o)
	_top_on = false
	var d := b - a
	var L := d.length()
	var dir := d / L
	var side := Vector3(-dir.z, 0.0, dir.x)
	var w: float = o.get("width", 0.3)
	var n := maxi(3, int(L / 0.55))
	var pts: Array = []
	for i in n + 1:
		var t := float(i) / float(n)
		var p := d * t + side * (_rng.randf_range(-1.0, 1.0) * w * 0.9 if (i > 0 and i < n) else 0.0)
		pts.append([p, w * pow(sin(PI * t), 0.6)])
	var glow := _c("glow")
	glow.a = 1.0
	var lip := _c("dark")
	for i in n:
		var p0: Vector3 = pts[i][0]
		var p1: Vector3 = pts[i + 1][0]
		var w0: float = pts[i][1] * 0.5
		var w1: float = pts[i + 1][1] * 0.5
		var up := Vector3(0, 0.025, 0)
		var below := p0 - Vector3(0, 1, 0)
		_part()
		_quad_h(p0 - side * w0 + up, p1 - side * w1 + up, p1 + side * w1 + up, p0 + side * w0 + up, glow, below, true)
		for s in [-1.0, 1.0]:
			var e0: Vector3 = p0 + side * s * w0 + up
			var e1: Vector3 = p1 + side * s * w1 + up
			var m0: Vector3 = p0 + side * s * (w0 + 0.12) + Vector3(0, 0.08, 0)
			var m1: Vector3 = p1 + side * s * (w1 + 0.12) + Vector3(0, 0.08, 0)
			var o0: Vector3 = p0 + side * s * (w0 + 0.38)
			var o1: Vector3 = p1 + side * s * (w1 + 0.38)
			_quad_h(e0, e1, m1, m0, _shade(lip, 0.1), below)
			_quad_h(m0, m1, o1, o0, _shade(lip.lightened(0.1), 0.1), below)
	_end()


## Mossy (or zone-tinted) ruined arch of stacked pier blocks and voussoirs.
## span = clear opening width, height = crown height. broken = right-hand side
## collapsed with fallen voussoirs. Proxies: two piers (+ crown when intact).
func ruin_arch(pos: Vector3, span: float, height: float, o: Dictionary = {}) -> void:
	_begin("ruin_arch", pos, o)
	var near := detail == NEAR
	var pw: float = o.get("pier", 0.85)
	var depth: float = o.get("depth", 1.0)
	var broken: bool = o.get("broken", false)
	var bandcols: Array = pal["bands"]
	var R := span * 0.5 + pw * 0.5
	var spring := maxf(1.0, height - R - pw * 0.5)
	_top_on = true
	_top_col = _c(o.get("top", "top"))
	for side in [-1.0, 1.0]:
		var px: float = side * (span * 0.5 + pw * 0.5)
		var top := spring
		if broken and side > 0.0:
			top = maxf(0.8, spring - _rng.randf_range(0.6, 1.3))
		var y := 0.0
		_part()
		_jbox(Vector3(px, 0.15, 0), Vector3(pw * 1.3, 0.3, depth * 1.25), Basis(), _c("dark").lerp(_c(bandcols[0]), 0.6), 0.03)
		while y < top - 0.05:
			var bh := minf(_rng.randf_range(0.6, 0.85), top - y)
			_part()
			_jbox(Vector3(px + _rng.randf_range(-0.05, 0.05), y + bh * 0.5, _rng.randf_range(-0.04, 0.04)), Vector3(pw * _rng.randf_range(0.94, 1.06), bh * 0.97, depth * _rng.randf_range(0.94, 1.04)), Basis(Vector3.UP, _rng.randf_range(-0.07, 0.07)), _c(bandcols[_rng.randi() % bandcols.size()]), 0.025)
			y += bh
		if collision:
			_add_box_proxy(Vector3(px, y * 0.5, 0), Vector3(pw * 0.86, y, depth * 0.86))
	var nv := 9 if near else 7
	var keep := nv if not broken else int(float(nv) * 0.6)
	var gap := 0.012
	for i in nv:
		var a0 := PI - PI * float(i) / float(nv) - gap
		var a1 := PI - PI * float(i + 1) / float(nv) + gap
		var ri := R - pw * 0.5
		var ro := R + pw * 0.5 + _rng.randf_range(-0.05, 0.08)
		if i >= keep:
			# Fallen voussoir lying beside the collapsed pier.
			_part()
			_jbox(Vector3(span * 0.5 + pw * _rng.randf_range(1.0, 2.2), pw * 0.35, _rng.randf_range(-1.0, 1.0) * depth), Vector3(pw * 0.9, pw * 0.7, depth * 0.9), Basis(Vector3.UP, _rng.randf() * TAU) * Basis(Vector3.BACK, _rng.randf_range(-0.3, 0.3)), _c(bandcols[i % bandcols.size()]), 0.04)
			continue
		var p := []
		for k in 8:
			var aa := a1 if k & 1 else a0
			var rr := ro if k & 2 else ri
			p.append(Vector3(cos(aa) * rr, spring + sin(aa) * rr, depth * 0.5 * (1.0 if k & 4 else -1.0)))
		_part()
		_box8(p, _c(bandcols[(i + 1) % bandcols.size()]))
	if collision and not broken:
		var ri := R - pw * 0.5
		var y0 := spring + ri + 0.05
		var y1 := spring + (R + pw * 0.5) * 0.9
		if y1 > y0 + 0.2:
			_add_box_proxy(Vector3(0, (y0 + y1) * 0.5, 0), Vector3(ri * 0.8, y1 - y0, depth * 0.86))
	_end()


## Broken ruin wall of running-bond blocks from a to b (ground points). The
## first course is always complete, and the single box proxy stops at the
## lowest surviving column so gaps in the upper courses never block.
func ruin_wall(a: Vector3, b: Vector3, height: float, o: Dictionary = {}) -> void:
	var hd := Vector3(b.x - a.x, 0.0, b.z - a.z)
	var L := hd.length()
	var opts: Dictionary = o.duplicate()
	opts["yaw"] = atan2(-hd.z, hd.x)
	opts.erase("face_to")
	_begin("ruin_wall", a, opts)
	_top_on = true
	_top_col = _c(o.get("top", "top"))
	var t: float = o.get("thickness", 0.8)
	var ch := 0.62
	var courses := maxi(1, int(height / ch))
	var bandcols: Array = pal["bands"]
	var ph := _rng.randf() * TAU
	var min_top := INF
	var x := 0.0
	# Column profile: a ragged descending line so the wall reads as collapsed.
	var profile := func(u: float) -> int:
		return clampi(int(round(float(courses) * (0.45 + 0.4 * sin(u * 5.0 + ph) * 0.5 + 0.35 * (1.0 - u)))), 1, courses)
	for c in courses:
		x = 0.0 if c % 2 == 0 else -0.45
		while x < L - 0.1:
			var bl := _rng.randf_range(0.8, 1.3)
			var x0 := maxf(x, 0.0)
			var x1 := minf(x + bl, L)
			x += bl
			if x1 - x0 < 0.25:
				continue
			var tall: int = profile.call((x0 + x1) * 0.5 / L)
			if c >= tall:
				continue
			_part()
			_jbox(Vector3((x0 + x1) * 0.5, ch * c + ch * 0.5, _rng.randf_range(-0.04, 0.04)), Vector3((x1 - x0) * 0.97, ch * 0.96, t * _rng.randf_range(0.92, 1.04)), Basis(Vector3.UP, _rng.randf_range(-0.04, 0.04)), _c(bandcols[_rng.randi() % bandcols.size()]), 0.03)
	for s in 12:
		min_top = minf(min_top, float(profile.call((float(s) + 0.5) / 12.0)) * ch)
	if collision:
		_add_box_proxy(Vector3(L * 0.5, min_top * 0.47, 0), Vector3(L * 0.97, min_top * 0.94, t * 0.86))
	_end()


## Adds an OmniLight3D (no shadow) to the build, capped at MAX_LIGHTS per kit.
func accent_light(pos: Vector3, color: String, energy: float = 1.0, light_range: float = 8.0) -> bool:
	if _lights.size() >= MAX_LIGHTS:
		push_warning("LandmarkKit: accent light budget (%d) reached; light at %s ignored" % [MAX_LIGHTS, pos])
		return false
	_lights.append({"pos": pos, "color": color, "energy": energy, "range": light_range})
	return true


# ------------------------------------------------------------- build / report

## Emits the kit into ONE Node3D container: "Mesh" (single MeshInstance3D with
## a stone and an emissive surface), optional "Collision" StaticBody3D holding
## every proxy (meta kind = "solid"), and optional accent lights. The container
## is a Node3D, so WorldZones.batch_decorations() will not wrap it in a convex
## hull. Returns the container.
func build(parent: Node, node_name: String = "") -> Node3D:
	var root := Node3D.new()
	root.name = node_name if node_name != "" else "Landmarks_%s%s" % [zone_id, "_far" if detail == FAR else ""]
	var mesh := ArrayMesh.new()
	if _sv.size() > 0:
		_add_surface(mesh, _sv, _sn, _sc, _stone_material())
	if _gv.size() > 0:
		_add_surface(mesh, _gv, _gn, _gc, _glow_material(glow_energy))
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	if collision and not _proxies.is_empty():
		var body := StaticBody3D.new()
		body.name = "Collision"
		body.set_meta("kind", "solid")
		root.add_child(body)
		for p in _proxies:
			var cs := CollisionShape3D.new()
			if p["type"] == "box":
				var bs := BoxShape3D.new()
				bs.size = p["size"]
				cs.shape = bs
			else:
				var cy := CylinderShape3D.new()
				cy.radius = p["radius"]
				cy.height = p["height"]
				cs.shape = cy
			cs.transform = p["xf"]
			cs.set_meta("landmark", p["owner"])
			body.add_child(cs)
	for l in _lights:
		var ol := OmniLight3D.new()
		ol.position = l["pos"]
		ol.light_color = Color(l["color"])
		ol.light_energy = l["energy"]
		ol.omni_range = l["range"]
		ol.shadow_enabled = false
		root.add_child(ol)
	root.set_meta("landmark_stats", stats())
	parent.add_child(root)
	return root


func stats() -> Dictionary:
	var boxes := 0
	var cyls := 0
	for p in _proxies:
		if p["type"] == "box":
			boxes += 1
		else:
			cyls += 1
	return {
		"zone": zone_id, "detail": "near" if detail == NEAR else "far",
		"triangles": (_sv.size() + _gv.size()) / 3, "stone_triangles": _sv.size() / 3, "glow_triangles": _gv.size() / 3,
		"mesh_instances": 1, "surfaces": int(_sv.size() > 0) + int(_gv.size() > 0),
		"collision_shapes": _proxies.size() if collision else 0, "box_shapes": boxes if collision else 0,
		"cylinder_shapes": cyls if collision else 0, "convex_shapes": 0, "lights": _lights.size(),
		"elements": _elements.size(),
	}


func elements() -> Array:
	return _elements


func proxies() -> Array:
	return _proxies if collision else []


## Tests every element's per-part visual AABBs (and so every collision proxy,
## which is always inside its visual) against gameplay keep-out volumes.
## keepout: {"name", "kind": "sphere"|"capsule"|"box", "p","r" | "a","b","r" |
## "aabb", optional "except": [element kinds allowed inside]}. Returns strings.
func check_clearance(keepouts: Array) -> Array:
	var out: Array = []
	for k in keepouts:
		var allow: Array = k.get("except", [])
		for e in _elements:
			if e["kind"] in allow:
				continue
			for part in e["parts"]:
				if part["empty"]:
					continue
				if (part["aabb"] as AABB).end.y < float(k.get("floor", -INF)):
					continue
				if _hits(k, part["aabb"]):
					out.append("%s (%s) intrudes on %s" % [e["name"], e["kind"], k["name"]])
					break
	return out


## Keep-out volumes copied from source/world_zones.gd + world_expeditions.gd
## (zone-local). Portals, spawn, resource nodes, enemies, barrier/arch lanes,
## grapple anchors and grapple lines, plus the walkable floor volume.
static func keepouts(zone: String) -> Array:
	var k: Array = []
	var S := func(name: String, p: Vector3, r: float) -> void: k.append({"name": name, "kind": "sphere", "p": p, "r": r, "floor": p.y - 1.0})
	var C := func(name: String, a: Vector3, b: Vector3, r: float) -> void: k.append({"name": name, "kind": "capsule", "a": a, "b": b, "r": r, "floor": minf(a.y, b.y) - 1.0})
	var B := func(name: String, lo: Vector3, hi: Vector3, allow: Array = []) -> void: k.append({"name": name, "kind": "box", "aabb": AABB(lo, hi - lo), "except": allow, "floor": lo.y})
	match zone:
		"sandstone_quarry":
			S.call("spawn", Vector3(0, 1, 8), 2.5)
			S.call("portal_forge_yard", Vector3(7.5, 1, 9.5), 2.8)
			C.call("path_lane", Vector3(0, 1, 9), Vector3(4, 1, -8), 2.2)
			C.call("barrier_lane", Vector3(4, 1, -8), Vector3(5, 1, -13.5), 1.8)
			for v in [Vector3(-6, 0.7, -1), Vector3(-1, 0.7, 4), Vector3(4, 0.7, -1), Vector3(-8, 0.7, -7), Vector3(-2, 0.7, -7), Vector3(4, 0.7, -7), Vector3(5, 0.7, -13)]:
				S.call("ore_%s" % v, v, 1.8)
			S.call("golem", Vector3(2, 1, -5), 2.5)
			B.call("crates", Vector3(-11, 0, 3.2), Vector3(-7.8, 1.6, 6.2))
			S.call("quarry_sign", Vector3(-9, 1.5, -8), 1.3)
			B.call("arch_barrier", Vector3(2.4, 0, -10.6), Vector3(7.6, 5.0, -9.4))
			B.call("play_floor", Vector3(-11, 0.05, -9.5), Vector3(11, 3.5, 10.5))
		"crystal_hollow":
			S.call("spawn", Vector3(0, 1, 8), 2.5)
			S.call("portal_forge_yard", Vector3(7.5, 1, 9.5), 2.8)
			S.call("crate", Vector3(-6, 0.5, 5), 1.2)
			B.call("bridge_lane", Vector3(-2, 0, -8), Vector3(2, 4, 2))
			C.call("central_lane", Vector3(0, 1, 10), Vector3(0, 1, -12), 2.0)
			for x in [-7.0, -2.5, 2.0, 6.5]:
				S.call("crystal_ore_%s" % x, Vector3(x, 0.7, -10), 1.8)
			S.call("golem", Vector3(3, 1, -8), 2.5)
			S.call("skeleton", Vector3(-5, 1, -7.5), 2.5)
			S.call("anchor", Vector3(4, 3, -8), 1.5)
			for p in [Vector3(0, 1.6, 3), Vector3(5, 1.6, 1), Vector3(-4, 1.6, 1), Vector3(3, 1.6, 6), Vector3(8, 1.6, 2)]:
				C.call("grapple_line_%s" % p, p, Vector3(4, 3, -8), 0.9)
			B.call("play_floor_near", Vector3(-10, 0.05, -2), Vector3(10, 3.5, 12))
			B.call("play_floor_far", Vector3(-10, 0.05, -12), Vector3(10, 3.5, -6))
		"cloudbreak_keep":
			var tops := {"main": [Vector3(0, 0, 10), Vector2(28, 24)], "west": [Vector3(-16, 2.2, -8), Vector2(13, 12)], "east": [Vector3(15, 4.2, -15), Vector2(12, 12)], "north": [Vector3(-3, 6, -25), Vector2(14, 12)]}
			for id in tops:
				var c: Vector3 = tops[id][0]
				var s: Vector2 = tops[id][1]
				B.call("island_top_" + id, c + Vector3(-s.x * 0.5, 0.05, -s.y * 0.5), c + Vector3(s.x * 0.5, 4.0, s.y * 0.5), ["bridge"])
			S.call("portal_sky_garden", Vector3(7.5, 1, 19.5), 2.8)
			S.call("spawn", Vector3(0, 1, 8), 2.5)
			var anchors := [Vector3(-11.45, 6.7, -7), Vector3(14.55, 8.7, -13), Vector3(-0.45, 10.5, -24), Vector3(1.55, 4.5, 4)]
			var stands := [Vector3(0, 1.6, 10), Vector3(0, 1.6, -1), Vector3(-10, 1.6, 4), Vector3(10, 1.6, 4), Vector3(-16, 3.8, -8), Vector3(15, 5.8, -15), Vector3(-3, 7.6, -25)]
			for an in anchors:
				S.call("anchor_%s" % an, an, 1.5)
				for st in stands:
					if st.distance_to(an) > 5.0:
						C.call("grapple_line_%s_to_%s" % [st, an], st, an, 1.0)
		"ember_foundry":
			S.call("spawn", Vector3(0, 1, 8), 2.5)
			S.call("portal_forge_yard", Vector3(7.5, 1, 9.5), 2.8)
			for x in [-9.0, 9.0]:
				for z in [-8.0, 4.0, 10.0]:
					S.call("brazier_%s_%s" % [x, z], Vector3(x, 1, z), 1.2)
			B.call("warden_arena", Vector3(-7, 0, -11), Vector3(7, 5, -2))
			S.call("skeleton", Vector3(5, 1, -5), 2.0)
			S.call("iron_ore", Vector3(-7, 0.7, -7), 1.8)
			B.call("warden_gate", Vector3(-11, 0, -13.2), Vector3(11, 8, -11))
			B.call("floor_south", Vector3(-12, 0.05, -0.5), Vector3(12, 3.5, 14.5), ["ground_fissure"])
			B.call("floor_north", Vector3(-11, 0.05, -12), Vector3(11, 3.5, -2), ["ground_fissure"])
			B.call("floor_bridge", Vector3(-2, 0.05, -3), Vector3(2, 3.5, 1))
		"pinewood_ruins":
			S.call("spawn", Vector3(0, 1, 8), 2.5)
			S.call("portal_forge_yard", Vector3(7.5, 1, 9.5), 2.8)
			S.call("portal_orchard", Vector3(-8.5, 1, 9.5), 2.8)
			for v in [Vector3(-6, 1, 4), Vector3(5, 1, 2), Vector3(-7, 1, -4)]:
				S.call("lumber_%s" % v, v, 2.0)
			for v in [Vector3(0, 1, -8.7), Vector3(5, 1, -8.5)]:
				S.call("skeleton_%s" % v, v, 2.2)
			S.call("chop_barrier", Vector3(-5, 1, -9), 2.2)
			B.call("old_arch", Vector3(-3, 0, -7), Vector3(3, 5, -5))
			for i in 14:
				var a := float(i) * TAU / 14.0
				S.call("tree_%d" % i, Vector3(cos(a) * 12.5, 1.0, sin(a) * 12.5), 1.3)
			B.call("play_floor", Vector3(-11, 0.05, -11), Vector3(11, 3.5, 11))
	return k


## Populates this kit with the suggested zone-local placements (see HANDOFF.md).
## Does NOT touch existing WorldZones geometry; the coordinator decides what
## the new masses replace.
func add_suggested() -> void:
	match zone_id:
		"sandstone_quarry":
			if detail == FAR:
				mesa(Vector3(-31, -3, -38), Vector3(15, 16, 11), {"broken": 0.4, "broken_dir": 0.5})
				mesa(Vector3(33, -3, -36), Vector3(13, 13, 10), {"broken": 0.5, "broken_dir": 2.8})
				mesa(Vector3(-40, -3, -8), Vector3(10, 11, 14), {"broken": 0.3})
				return
			mesa(Vector3(-11.5, -2, -18.5), Vector3(10, 12, 7.5), {"broken": 0.55, "broken_dir": 0.9, "yaw": 0.08, "name": "back_mesa_w"})
			mesa(Vector3(-2.8, -2, -19.5), Vector3(7.2, 13.5, 7.5), {"broken": 0.7, "broken_dir": 0.4, "yaw": -0.05, "name": "back_mesa_c", "talus": false})
			cut_blocks(Vector3(4.8, 0, -17.9), Vector3(6.8, 5.6, 4.6), {"steps": 3, "face_to": Vector3(4.8, 0, 0), "name": "alcove_benches"})
			mesa(Vector3(12.8, -2, -18.5), Vector3(8.5, 11, 7.5), {"broken": 0.5, "broken_dir": 2.2, "yaw": -0.1, "name": "back_mesa_e"})
			mesa(Vector3(-19, -2, -7.5), Vector3(8.5, 10.5, 10), {"broken": 0.45, "broken_dir": 0.1, "yaw": 0.12, "name": "west_mesa_s"})
			mesa(Vector3(-18.8, -2, 5), Vector3(7.5, 8.5, 9), {"broken": 0.3, "broken_dir": 0.3, "name": "west_mesa_n"})
			mesa(Vector3(19.2, -2, -6), Vector3(8.5, 11.5, 10), {"broken": 0.5, "broken_dir": PI, "name": "east_mesa_s"})
			mesa(Vector3(19.2, -2, 6.5), Vector3(7.5, 8, 8), {"broken": 0.3, "broken_dir": PI - 0.3, "name": "east_mesa_n"})
			mesa(Vector3(13.2, 0, -10.8), Vector3(2.8, 7.2, 2.6), {"broken": 0.35, "tier": false, "talus": false, "bands": 5, "name": "hoodoo"})
			cut_blocks(Vector3(-13.2, 0, -2.2), Vector3(3.2, 2.6, 3.0), {"steps": 2, "face_to": Vector3(0, 0, -2), "name": "west_blocks"})
			boulder(Vector3(-12.6, 0, -12.2), Vector3(2.4, 1.6, 2.0), {"name": "sw_boulder"})
			talus(Vector3(11.6, 0, -13.2), 1.2, 4, {"max_size": 0.8})
		"crystal_hollow":
			var mid := Vector3(0, 0, 0)
			cavern_wall(Vector3(-9.8, 0, -15.0), Vector3(6, 10, 2.6), {"face_to": mid, "name": "back_wall_w", "seam2": "glow2"})
			cavern_wall(Vector3(0, 0, -16.4), Vector3(7, 10.5, 2.8), {"face_to": mid, "name": "back_wall_c", "seams": 3})
			cavern_wall(Vector3(9.8, 0, -15.0), Vector3(6, 9.5, 2.6), {"face_to": mid, "name": "back_wall_e", "seam2": "glow2"})
			cavern_wall(Vector3(-13.0, 0, 7.5), Vector3(5.5, 9, 2.4), {"face_to": Vector3(0, 0, 5), "name": "west_wall", "seams": 1})
			cavern_wall(Vector3(12.8, 0, -1.0), Vector3(5, 9, 2.4), {"face_to": Vector3(0, 0, 0), "name": "east_wall", "seams": 1, "seam2": "glow2"})
			crystal_outcrop(Vector3(-12.2, -5.2, -4.0), Vector3(3.8, 10, 3.4), {"facing": 0.0, "hues": ["glow"], "crystal_scale": 0.4, "name": "chasm_spire_w"})
			crystal_outcrop(Vector3(12.4, -5.2, -4.0), Vector3(3.6, 9.2, 3.4), {"facing": PI, "hues": ["glow2", "glow"], "crystal_scale": 0.4, "spread": 0.9, "name": "chasm_spire_e"})
			crystal_outcrop(Vector3(-12.8, 0, 3.0), Vector3(3.4, 3.0, 3.0), {"facing": 0.2, "crystal_scale": 0.8, "spread": 0.8, "name": "west_outcrop"})
			crystal_outcrop(Vector3(-12.4, 0, -9.6), Vector3(3.0, 3.6, 2.8), {"facing": 0.5, "hues": ["glow2"], "name": "nw_outcrop"})
			crystal_outcrop(Vector3(12.4, 0, -9.8), Vector3(3.0, 3.4, 2.8), {"facing": PI - 0.5, "hues": ["glow"], "name": "ne_outcrop"})
			cliff_face(Vector3(-15, 0, -2), Vector3(15, 0, -2), -0.42, -5.4, {"facing": Vector3(0, -2, -4), "seams": 3, "name": "chasm_face_s"})
			cliff_face(Vector3(-15, 0, -6), Vector3(15, 0, -6), -0.42, -5.4, {"facing": Vector3(0, -2, -4), "seams": 3, "name": "chasm_face_n"})
			for s in [[Vector3(-6, 10, -4), 3.2], [Vector3(-2.5, 10, 3.5), 2.6], [Vector3(4.5, 10, -2.5), 3.6], [Vector3(7, 10, 5), 2.4], [Vector3(-8, 10, 6.5), 2.8], [Vector3(1.5, 10, -9.5), 2.2], [Vector3(-9, 10, -8), 3.0]]:
				stalactite(s[0], s[1], 0.55 + s[1] * 0.08, {"crystal": s[1] > 3.0})
		"cloudbreak_keep":
			if detail == FAR:
				islet(Vector3(34, -1, -46), Vector2(10, 8), {"depth": 9})
				islet(Vector3(50, 2, -36), Vector2(7, 7), {"depth": 6})
				bridge(Vector3(38.8, -1, -44), Vector3(46.6, 2, -37.5), {"style": "stone", "width": 2.4, "pier_depth": 6})
				islet(Vector3(-42, -3, -30), Vector2(9, 8), {"depth": 8})
				ruin_arch(Vector3(-42, -3, -31), 2.6, 4.2, {"broken": true, "name": "far_arch"})
				return
			island_underside(Vector3(0, 0, 10), Vector2(28, 24), 12.0, {"name": "main_underside", "spurs": 4})
			island_underside(Vector3(-16, 2.2, -8), Vector2(13, 12), 7.5, {"name": "west_underside"})
			island_underside(Vector3(15, 4.2, -15), Vector2(12, 12), 8.0, {"name": "east_underside"})
			island_underside(Vector3(-3, 6, -25), Vector2(14, 12), 8.5, {"name": "north_underside"})
			bridge(Vector3(-13.8, 0, 13), Vector3(-27, 0.4, 15.5), {"style": "stone", "broken_at": 0.52, "width": 2.6, "name": "old_keep_bridge"})
			bridge(Vector3(20.8, 4.2, -13.5), Vector3(26.2, 4.8, -10.5), {"style": "timber", "width": 1.8, "name": "lookout_bridge"})
			islet(Vector3(29.5, 4.8, -9.5), Vector2(7, 6), {"depth": 6, "name": "lookout_islet"})
			ruin_arch(Vector3(31, 4.8, -8.6), 1.8, 3.4, {"broken": true, "pier": 0.6, "depth": 0.7, "face_to": Vector3(20, 4.8, -14), "name": "lookout_arch"})
		"ember_foundry":
			basalt_cluster(Vector3(-15.2, -0.7, 7), 2.6, 6.5, {"collision_mode": "core", "name": "lava_cols_sw"})
			basalt_cluster(Vector3(15.6, -0.7, 2.5), 2.4, 7.5, {"collision_mode": "core", "name": "lava_cols_se"})
			basalt_cluster(Vector3(-14.8, -0.7, -6.5), 2.2, 8.5, {"collision_mode": "core", "fissures": 0, "name": "lava_cols_nw"})
			basalt_cluster(Vector3(15, -0.7, -8.5), 2.6, 9, {"collision_mode": "core", "name": "lava_cols_ne"})
			basalt_cluster(Vector3(-8.2, -0.7, -17), 3.0, 11, {"collision_mode": "core", "name": "gate_cols_w"})
			basalt_cluster(Vector3(8.4, -0.7, -17.4), 3.2, 12.5, {"collision_mode": "core", "name": "gate_cols_e", "fissures": 2})
			ruin_arch(Vector3(0, -0.7, -16.2), 6.2, 12.0, {"pier": 1.6, "depth": 1.8, "name": "gate_arch"})
			forge_pillar(Vector3(-13.4, -0.6, 12.5), 5.6, {"face_to": Vector3(0, 0, 8), "name": "pillar_sw"})
			forge_pillar(Vector3(13.4, -0.6, 13), 6.2, {"face_to": Vector3(0, 0, 8), "broken": true, "name": "pillar_se"})
			ground_fissure(Vector3(-11.5, 0, 13.6), Vector3(-10.4, 0, 6.8), {"width": 0.28})
			ground_fissure(Vector3(10.7, 0, -2.4), Vector3(10.1, 0, -6.4), {"width": 0.24})
			accent_light(Vector3(0, 3.0, -15.2), "ff8a3a", 1.4, 9.0)
		"pinewood_ruins":
			ruin_arch(Vector3(0, 0, -14.3), 3.0, 4.4, {"face_to": Vector3(0, 0, 0), "name": "far_arch"})
			ruin_wall(Vector3(-14.4, 0, -8.6), Vector3(-10.4, 0, -13.8), 2.6, {"name": "wall_w"})
			ruin_wall(Vector3(10.4, 0, -13.8), Vector3(14.4, 0, -8.6), 2.2, {"name": "wall_e"})
			ruin_arch(Vector3(-14.6, 0, 3.6), 2.2, 3.3, {"face_to": Vector3(0, 0, 1.5), "broken": true, "pier": 0.7, "name": "west_arch"})
			mesa(Vector3(-13.5, -1, 13.2), Vector3(5, 5, 4.6), {"broken": 0.4, "broken_dir": -0.6, "tier": false, "talus": false, "name": "mossy_crag_w"})
			mesa(Vector3(14, -1, 13.5), Vector3(5.5, 6, 5), {"broken": 0.5, "broken_dir": PI + 0.6, "tier": false, "name": "mossy_crag_e"})
			boulder(Vector3(14.4, 0, -3.2), Vector3(2.6, 1.8, 2.2), {"name": "east_boulder"})
		_:
			push_warning("LandmarkKit: no suggested layout for %s" % zone_id)


# ------------------------------------------------------------------ internals

func _begin(kind: String, pos: Vector3, o: Dictionary) -> void:
	var yaw: float = o.get("yaw", 0.0)
	if o.has("face_to"):
		var d: Vector3 = o["face_to"] - pos
		yaw = atan2(d.x, d.z)
	_xf = Transform3D(Basis(Vector3.UP, yaw), pos)
	_rng.seed = hash([seed_base, kind, pos.snapped(Vector3.ONE * 0.01), o.get("seed", 0)])
	_el = {"name": str(o.get("name", "%s_%d" % [kind, _elements.size()])), "kind": kind, "parts": []}
	_part()
	_top_on = kind in ["mesa", "boulder", "cut_blocks", "cavern_wall", "crystal_outcrop", "basalt_cluster", "islet"]
	_top_col = _c("top")


func _end() -> void:
	_elements.append(_el)


func _el_name_hint(o: Dictionary, suffix: String) -> String:
	return str(o.get("name", "mesa")) + "_" + suffix


func _part() -> void:
	(_el["parts"] as Array).append({"aabb": AABB(), "empty": true})


func _c(v) -> Color:
	if v is Color:
		return v
	var s := str(v)
	if pal.has(s):
		var pv = pal[s]
		return Color(pv[0]) if pv is Array else Color(pv)
	return Color(s)


func _shade(col: Color, amt: float) -> Color:
	var f := 1.0 + _rng.randf_range(-amt, amt)
	return Color(col.r * f, col.g * f, col.b * f, col.a)


func _tri(a: Vector3, b: Vector3, c: Vector3, col: Color, glow := false) -> void:
	a = _xf * a
	b = _xf * b
	c = _xf * c
	var n := (b - a).cross(c - a)
	if n.length_squared() < 1e-12:
		return
	n = n.normalized()
	if _top_on and not glow and n.y > 0.72:
		col = Color(_top_col.lerp(col, 0.18), col.a)
	if glow:
		_gv.append_array([a, c, b])
		_gn.append_array([n, n, n])
		_gc.append_array([col, col, col])
	else:
		_sv.append_array([a, c, b])
		_sn.append_array([n, n, n])
		_sc.append_array([col, col, col])
	var part: Dictionary = _el["parts"][-1]
	if part["empty"]:
		part["aabb"] = AABB(a, Vector3.ZERO)
		part["empty"] = false
	var box: AABB = part["aabb"]
	part["aabb"] = box.expand(a).expand(b).expand(c)


func _quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, col: Color, glow := false) -> void:
	_tri(a, b, c, col, glow)
	_tri(a, c, d, col, glow)


## Quad oriented so its normal points away from `hint` (a point inside).
func _quad_h(a: Vector3, b: Vector3, c: Vector3, d: Vector3, col: Color, hint: Vector3, glow := false) -> void:
	var n := (b - a).cross(c - a)
	if n.dot((a + b + c + d) * 0.25 - hint) < 0.0:
		_quad(a, d, c, b, col, glow)
	else:
		_quad(a, b, c, d, col, glow)


func _box8(p: Array, col: Color, glow := false, shade := 0.05) -> void:
	var cen := Vector3.ZERO
	for q in p:
		cen += q
	cen /= 8.0
	for f in _BOX_FACES:
		_quad_h(p[f[0]], p[f[1]], p[f[2]], p[f[3]], _shade(col, shade), cen, glow)


func _jbox(c: Vector3, size: Vector3, b: Basis, col: Color, jitter := 0.0, glow := false, taper := 1.0) -> void:
	var p := []
	for i in 8:
		var l := Vector3(float((i & 1) * 2 - 1), float(((i >> 1) & 1) * 2 - 1), float(((i >> 2) & 1) * 2 - 1)) * 0.5 * size
		if l.y > 0.0:
			l.x *= taper
			l.z *= taper
		if jitter > 0.0:
			l += Vector3(_rng.randf_range(-1, 1), _rng.randf_range(-1, 1), _rng.randf_range(-1, 1)) * jitter
		p.append(c + b * l)
	_box8(p, col, glow)


func _beam(p0: Vector3, p1: Vector3, thick: float, col: Color) -> void:
	var x := (p1 - p0).normalized()
	var y := (Vector3.UP - x * x.y).normalized()
	var z := x.cross(y)
	_jbox((p0 + p1) * 0.5, Vector3(p0.distance_to(p1), thick, thick), Basis(x, y, z), col)


func _ring(cx: float, cz: float, y: float, rx: float, rz: float, n: int, mults: PackedFloat32Array, expo := 2.0, phase := 0.0, ys := PackedFloat32Array()) -> PackedVector3Array:
	var out := PackedVector3Array()
	var e := 2.0 / expo
	for i in n:
		var a := phase + TAU * float(i) / float(n)
		var ca := cos(a)
		var sa := sin(a)
		var m := 1.0 if mults.is_empty() else mults[i]
		out.append(Vector3(cx + signf(ca) * pow(absf(ca), e) * rx * m, y + (0.0 if ys.is_empty() else ys[i]), cz + signf(sa) * pow(absf(sa), e) * rz * m))
	return out


func _centroid(ring: PackedVector3Array) -> Vector3:
	var c := Vector3.ZERO
	for p in ring:
		c += p
	return c / float(ring.size())


## Side quads between consecutive rings (bottom to top, angles CCW from +X
## toward +Z) are outward-facing by construction; caps are fans.
func _lathe(rings: Array, cols: Array, cap_top: bool, cap_bottom: bool, glow := false, cap_col = null, lift := 0.0) -> void:
	var n: int = (rings[0] as PackedVector3Array).size()
	for k in range(rings.size() - 1):
		var r0: PackedVector3Array = rings[k]
		var r1: PackedVector3Array = rings[k + 1]
		for i in n:
			var j := (i + 1) % n
			_quad(r0[i], r1[i], r1[j], r0[j], _shade(cols[mini(k, cols.size() - 1)], 0.045), glow)
	if cap_top:
		var top: PackedVector3Array = rings[rings.size() - 1]
		var c := _centroid(top) + Vector3(0, lift, 0)
		var col: Color = _c(cap_col) if cap_col != null else cols[cols.size() - 1]
		for i in n:
			_tri(c, top[(i + 1) % n], top[i], _shade(col, 0.04), glow)
	if cap_bottom:
		var bot: PackedVector3Array = rings[0]
		var c := _centroid(bot) - Vector3(0, lift, 0)
		var col: Color = cols[0]
		for i in n:
			_tri(c, bot[i], bot[(i + 1) % n], _shade(col.darkened(0.1), 0.04), glow)


func _boulder_body(c: Vector3, size: Vector3, o: Dictionary) -> Array:
	var near := detail == NEAR
	var n: int = o.get("sides", (9 if maxf(size.x, size.z) > 3.0 else 7) if near else 5)
	var jit: float = o.get("jitter", 0.14)
	var expo: float = o.get("expo", 2.3)
	var h := size.y
	var phase := _rng.randf() * TAU
	var rings: Array = []
	for p in [[-0.12 * h - 0.05, 0.8], [0.3 * h, 1.0], [0.72 * h, 0.8], [h, 0.36]]:
		var m := PackedFloat32Array()
		var ys := PackedFloat32Array()
		for i in n:
			m.append(p[1] * _rng.randf_range(1.0 - jit, 1.0 + jit * 0.6))
			ys.append(_rng.randf_range(-0.07, 0.07) * h if p[1] != 0.8 or p[0] > 0.0 else 0.0)
		rings.append(_ring(c.x, c.z, c.y + p[0], size.x * 0.5, size.z * 0.5, n, m, expo, phase, ys))
	var colkey: String = str(o.get("color", ""))
	var col := _c(colkey if colkey != "" else "debris")
	var bandcols: Array = pal["bands"]
	_lathe(rings, [col.darkened(0.08), col, _c(bandcols[1 % bandcols.size()]).lerp(col, 0.5)], true, false, false, null, 0.05 * h)
	return rings


func _shard(base: Vector3, dir: Vector3, length: float, radius: float, c0: Color, c1: Color) -> void:
	var sides := 6 if detail == NEAR else 4
	var b := _basis_up(dir)
	var tw := _rng.randf() * TAU
	var r0 := PackedVector3Array()
	var r1 := PackedVector3Array()
	for i in sides:
		var a := tw + TAU * float(i) / float(sides)
		var m := _rng.randf_range(0.88, 1.12)
		r0.append(base + b * Vector3(cos(a) * radius * 0.85 * m, -length * 0.1, sin(a) * radius * 0.85 * m))
		r1.append(base + b * Vector3(cos(a) * radius * m, length * 0.68, sin(a) * radius * m))
	var tip := base + b * Vector3(_rng.randf_range(-0.1, 0.1) * radius, length, _rng.randf_range(-0.1, 0.1) * radius)
	for i in sides:
		var j := (i + 1) % sides
		var body := c0.lightened(0.18) if i % 2 == 0 else c0
		_quad(r0[i], r1[i], r1[j], r0[j], body, true)
		_tri(tip, r1[j], r1[i], c1 if i % 2 == 0 else c1.darkened(0.12), true)


func _basis_up(dir: Vector3) -> Basis:
	var y := dir.normalized()
	var ref := Vector3.FORWARD if absf(y.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT
	var x := ref.cross(y).normalized()
	var z := x.cross(y).normalized()
	return Basis(x, y, z)


## Indices of ring vertices sorted by how far they face local +Z (the front).
func _front_vertices(ring: PackedVector3Array, n: int) -> Array:
	var cen := _centroid(ring)
	var idx: Array = []
	for i in n:
		idx.append(i)
	idx.sort_custom(func(p, q): return (ring[p] - cen).normalized().z > (ring[q] - cen).normalized().z)
	return idx


## Glowing zig-zag ribbon along the vertical mesh edge i of a lathe, k0..k1.
func _edge_seam(rings: Array, i: int, k0: int, k1: int, col: Color, width := 0.1) -> void:
	var n: int = (rings[0] as PackedVector3Array).size()
	var pts: Array = []
	for k in range(k0, k1 + 1):
		var ring: PackedVector3Array = rings[k]
		var p := ring[i]
		var tan := (ring[(i + 1) % n] - ring[(i - 1 + n) % n]).normalized()
		var out := p - _centroid(ring)
		out.y = 0.0
		out = out.normalized()
		pts.append([p, tan, out])
		if k < k1:
			var q: Vector3 = (rings[k + 1] as PackedVector3Array)[i]
			pts.append([p.lerp(q, 0.5) + tan * _rng.randf_range(-0.14, 0.14), tan, out])
	for s in pts.size() - 1:
		var A: Array = pts[s]
		var B: Array = pts[s + 1]
		var wa := width * (0.35 if s == 0 else 1.0)
		var wb := width * (0.35 if s == pts.size() - 2 else 1.0)
		var a0: Vector3 = A[0] + A[2] * 0.04
		var b0: Vector3 = B[0] + B[2] * 0.04
		_quad_h(a0 - A[1] * wa, a0 + A[1] * wa, b0 + B[1] * wb, b0 - B[1] * wb, col, A[0] - A[2] * 2.0, true)


## Thin hanging vine (triangular prism strip) from a rim point.
func _vine(p: Vector3, length: float) -> void:
	var col := _c("moss")
	var segs := 3
	var prev := p
	for s in segs:
		var nxt := p + Vector3(_rng.randf_range(-0.2, 0.2), -length * float(s + 1) / float(segs), _rng.randf_range(-0.2, 0.2))
		var w := 0.09 * (1.0 - float(s) / float(segs))
		var tri := [Vector3(w, 0, 0), Vector3(-w * 0.5, 0, w * 0.87), Vector3(-w * 0.5, 0, -w * 0.87)]
		for k in 3:
			var q0: Vector3 = tri[k]
			var q1: Vector3 = tri[(k + 1) % 3]
			_quad_h(prev + q0, prev + q1, nxt + q1 * 0.7, nxt + q0 * 0.7, _shade(col, 0.1), (prev + nxt) * 0.5)
		prev = nxt


func _crack(p0: Vector3, p1: Vector3, nrm: Vector3, width: float) -> void:
	var segs := 4
	var prev := p0
	var side := (p1 - p0).cross(nrm).normalized()
	var col := _c("dark")
	var off := nrm * 0.035
	for s in segs:
		var t := float(s + 1) / float(segs)
		var nxt := p0.lerp(p1, t) + side * (_rng.randf_range(-0.18, 0.18) if s < segs - 1 else 0.0)
		var w0 := width * (1.0 - float(s) / float(segs) * 0.7)
		var w1 := width * (1.0 - t * 0.7)
		_quad_h(prev - side * w0 + off, prev + side * w0 + off, nxt + side * w1 + off, nxt - side * w1 + off, col, prev - nrm)
		prev = nxt


func _deck_y(t: float, dy: float, sag: float) -> float:
	return dy * t - sag * 4.0 * t * (1.0 - t)


## Inscribed axis-aligned (local) box: shrinks from the full extent until all
## corners and edge midpoints lie inside every ring polygon that bounds the
## height range, so the proxy can never stand proud of the visible rock.
func _fit_box(rings: Array, y0: float, y1: float, aspect: Vector2, extent: Vector2) -> void:
	var polys: Array = []
	var last_below = null
	var cen := Vector2.ZERO
	var cnt := 0
	for r in rings:
		var ring: PackedVector3Array = r
		var lo := INF
		var hi := -INF
		for p in ring:
			lo = minf(lo, p.y)
			hi = maxf(hi, p.y)
		if hi < y0:
			last_below = ring
			continue
		polys.append(ring)
		if lo > y1:
			break
	if last_below != null:
		polys.append(last_below)
	var flat: Array = []
	for ring in polys:
		var p2 := PackedVector2Array()
		for p in ring:
			p2.append(Vector2(p.x, p.z))
			cen += Vector2(p.x, p.z)
			cnt += 1
		flat.append(p2)
	if cnt == 0:
		return
	cen /= float(cnt)
	var s := 1.0
	var ok := false
	for it in 60:
		var hx := aspect.x * extent.x * s
		var hz := aspect.y * extent.y * s
		ok = true
		for p2 in flat:
			for q in [Vector2(-hx, -hz), Vector2(hx, -hz), Vector2(hx, hz), Vector2(-hx, hz), Vector2(0, -hz), Vector2(hx, 0), Vector2(0, hz), Vector2(-hx, 0)]:
				if not Geometry2D.is_point_in_polygon(cen + q, p2):
					ok = false
					break
			if not ok:
				break
		if ok:
			break
		s *= 0.94
	if not ok:
		return
	s *= 0.97
	var sx := aspect.x * extent.x * s * 2.0
	var sz := aspect.y * extent.y * s * 2.0
	if sx < 0.5 or sz < 0.5:
		return
	_add_box_proxy(Vector3(cen.x, (y0 + y1) * 0.5, cen.y), Vector3(sx, y1 - y0, sz))


func _add_box_proxy(c: Vector3, size: Vector3, b := Basis()) -> void:
	if not collision:
		return
	var xf := _xf * Transform3D(b, c)
	_proxies.append({"type": "box", "size": size, "xf": xf, "aabb": xf * AABB(-size * 0.5, size), "owner": _el["name"], "kind": _el["kind"]})


func _add_cyl_proxy(c: Vector3, radius: float, height: float) -> void:
	if not collision:
		return
	var xf := _xf * Transform3D(Basis(), c)
	var size := Vector3(radius * 2.0, height, radius * 2.0)
	_proxies.append({"type": "cylinder", "radius": radius, "height": height, "xf": xf, "aabb": xf * AABB(-size * 0.5, size), "owner": _el["name"], "kind": _el["kind"]})


static func _hits(k: Dictionary, box: AABB) -> bool:
	match k["kind"]:
		"sphere":
			return _dist_aabb(box, k["p"]) <= k["r"]
		"capsule":
			var a: Vector3 = k["a"]
			var b: Vector3 = k["b"]
			var steps := maxi(2, int(a.distance_to(b) / 0.25))
			for i in steps + 1:
				if _dist_aabb(box, a.lerp(b, float(i) / float(steps))) <= k["r"]:
					return true
			return false
		"box":
			return box.intersects(k["aabb"])
	return false


static func _dist_aabb(box: AABB, p: Vector3) -> float:
	var q := p.clamp(box.position, box.end)
	return q.distance_to(p)


static func _add_surface(mesh: ArrayMesh, v: PackedVector3Array, n: PackedVector3Array, c: PackedColorArray, m: Material) -> void:
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	arr[Mesh.ARRAY_COLOR] = c
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	mesh.surface_set_material(mesh.get_surface_count() - 1, m)


static func _stone_material() -> StandardMaterial3D:
	if _stone_mat == null:
		_stone_mat = StandardMaterial3D.new()
		_stone_mat.vertex_color_use_as_albedo = true
		_stone_mat.vertex_color_is_srgb = true
		_stone_mat.roughness = 0.88
	return _stone_mat


static func _glow_material(energy: float) -> ShaderMaterial:
	var key := snappedf(energy, 0.01)
	if _glow_mats.has(key):
		return _glow_mats[key]
	if _glow_shader == null:
		_glow_shader = Shader.new()
		# Vertex colour = sRGB hue, alpha = emission weight. Filmic-safe: no bloom needed.
		_glow_shader.code = """shader_type spatial;
render_mode cull_back;
uniform float energy = 1.5;
void fragment() {
	vec3 c = pow(COLOR.rgb, vec3(2.2));
	ALBEDO = c * 0.5;
	ROUGHNESS = 0.3;
	EMISSION = c * energy * COLOR.a;
}
"""
	var m := ShaderMaterial.new()
	m.shader = _glow_shader
	m.set_shader_parameter("energy", energy)
	_glow_mats[key] = m
	return m
