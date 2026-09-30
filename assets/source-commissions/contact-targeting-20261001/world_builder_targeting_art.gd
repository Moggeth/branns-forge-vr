extends Node3D
## Bespoke ground-conforming survey previews. One cached ArrayMesh (two surfaces, so two
## draw calls at most), rebuilt only when the targeting state changes (throttled while the
## cursor drags). Every vertex is lifted from game.landscape.height_at() and stood 6 cm off
## the surface; nothing floats, and nothing here changes mechanics.
##
## Coordinates: the node is top_level with an identity transform, so vertices are authored in
## WORLD space as   world_origin + Vector3(local.x, height + 0.06, local.z).
## Footprint numbers always come from state.footprint; the SPECS-style defaults below are only
## a fallback if a key is missing.
##
## Palette: valid previews use restrained gold / teal / green / violet (+ ember for Starfall,
## amber for earth). ANY invalid preview turns crimson and its fills become diagonal hatching;
## it also gains a barred ring at the cursor. Decorations (sprouts, veins, stars) are dropped
## when invalid so the crimson reads as one clear "no".

const STANDOFF := 0.06
const NO_MID := Color(0, 0, 0, -1)
const CRIMSON := Color(0.92, 0.2, 0.18)
const REBUILD_INTERVAL := 0.033
const MOVE_EPSILON := 0.12

const PALETTE := {
	"path": Color(0.97, 0.79, 0.36), "sunder": Color(0.93, 0.55, 0.17), "wall": Color(0.68, 0.54, 0.96),
	"forest": Color(0.45, 0.88, 0.45), "fault": Color(0.36, 0.86, 0.9), "bridge": Color(0.98, 0.8, 0.42),
	"ramp": Color(0.5, 0.9, 0.72), "stairs": Color(0.95, 0.74, 0.52), "boardwalk": Color(0.8, 0.86, 0.5),
	"raise": Color(0.72, 0.86, 0.42), "meteor": Color(1.0, 0.5, 0.14), "grove": Color(0.4, 0.85, 0.5),
	"ring": Color(0.72, 0.58, 0.97), "awaken": Color(0.62, 0.92, 0.4), "calm": Color(0.5, 0.86, 0.82),
	"harvest": Color(0.96, 0.66, 0.26), "seed": Color(0.5, 0.95, 0.55), "patrol": Color(0.85, 0.72, 1.0),
}

## Fallbacks only (mirrors input/world_builder_targeting.gd SPECS).
const DEFAULTS := {
	"path": 4.0, "sunder": 16.0, "wall": 13.0, "forest": 11.0, "fault": 8.0, "bridge": 4.0, "ramp": 3.0,
	"stairs": 3.0, "boardwalk": 3.4,
}
const PATH_PAINT_DEFAULT := 9.0
const MAX_TREE_GLYPHS := 30

class Surf:
	var v := PackedVector3Array()
	var c := PackedColorArray()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	var idx := PackedInt32Array()
	func add(p: Vector3, col: Color, u: Vector2, pat: float, par: float) -> int:
		v.push_back(p); c.push_back(col); uv.push_back(u); uv2.push_back(Vector2(pat, par))
		return v.size() - 1
	func tri(a: int, b: int, d: int) -> void:
		idx.push_back(a); idx.push_back(b); idx.push_back(d)
	func clear() -> void:
		v.clear(); c.clear(); uv.clear(); uv2.clear(); idx.clear()

var game
var instance: MeshInstance3D
var mesh := ArrayMesh.new()
var stats := {"triangles": 0, "vertices": 0, "surfaces": 0, "height_samples": 0, "build_usec": 0, "rebuilds": 0}
var _surf: Array = [Surf.new(), Surf.new()]
var _pending: Dictionary = {}
var _last_key := ""
var _last_build := -10.0
var _origin := Vector3.ZERO
var _hcache: Dictionary = {}
var _ok := true
var _base := Color.WHITE
var _hi := Color.WHITE
var _seed := 0
var _paint_width := 0.0
var _trees := PackedVector2Array()  # exact upcoming tree positions (Orchard-local XZ) or empty

static var _mix_material: ShaderMaterial
static var _add_material: ShaderMaterial

func setup(owner_game) -> void:
	game = owner_game
	name = "WorldBuilderTargetingArt"
	top_level = true
	global_transform = Transform3D.IDENTITY
	instance = MeshInstance3D.new()
	instance.name = "SurveyPreview"
	instance.mesh = mesh
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	instance.extra_cull_margin = 2.0
	instance.visible = false
	add_child(instance)
	set_process(false)

func _process(_delta: float) -> void:
	if _pending.is_empty():
		set_process(false)
		return
	if _now() - _last_build >= REBUILD_INTERVAL:
		var state := _pending
		_pending = {}
		_build(state)

func _now() -> float:
	return Time.get_ticks_usec() / 1000000.0

func clear_preview() -> void:
	_pending = {}
	_last_key = ""
	if instance != null: instance.visible = false

## Public entry: call as often as the view likes; geometry rebuilds only on real change.
func update_targeting(state: Dictionary) -> void:
	if instance == null: return
	var hovered: Variant = state.get("hovered", Vector3.INF)
	var id := str(state.get("id", ""))
	if state.is_empty() or id == "" or id == "hire" or not PALETTE.has(id) \
			or typeof(hovered) != TYPE_VECTOR3 or not (hovered as Vector3).is_finite():
		clear_preview()
		return
	var key := _key(state, hovered as Vector3)
	if key == _last_key and _pending.is_empty(): return
	var head := key.get_slice("|", 0) + key.get_slice("|", 1) + key.get_slice("|", 2)
	var fresh := _last_key.get_slice("|", 0) + _last_key.get_slice("|", 1) + _last_key.get_slice("|", 2) != head
	_last_key = key
	if fresh or _now() - _last_build >= REBUILD_INTERVAL or _last_build < 0.0:
		_pending = {}
		_build(state)
	else:
		_pending = state
		set_process(true)

func _key(state: Dictionary, hovered: Vector3) -> String:
	var first: Variant = state.get("first_point", Vector3.INF)
	var fp: Dictionary = state.get("footprint", {})
	var origin: Vector3 = state.get("world_origin", Vector3.ZERO)
	var hero: Variant = state.get("hero_clearance_center", Vector3.INF)
	return "%s|%s|%s|%.2f,%.2f|%s|%s|%s|%s|%d" % [state.get("id", ""), state.get("valid", false), state.get("stage", fp.get("stage", "")),
		snappedf(hovered.x, MOVE_EPSILON), snappedf(hovered.z, MOVE_EPSILON), first, origin.snapped(Vector3.ONE * 0.05),
		var_to_str(fp), hero, _tree_hash(state)]

## Exact upcoming tree positions (Orchard-local Vector3s, max 30) from the targeting state; optional.
func _tree_source(state: Dictionary) -> Array:
	for source in [state, state.get("footprint", {})]:
		if source is Dictionary and source.has("tree_positions") and source["tree_positions"] is Array:
			return source["tree_positions"]
	return []

func _tree_hash(state: Dictionary) -> int:
	var h := 0
	for v in _tree_source(state):
		if typeof(v) == TYPE_VECTOR3 and (v as Vector3).is_finite(): h = hash([h, snappedf(v.x, 0.01), snappedf(v.z, 0.01)])
	return h

# ------------------------------------------------------------------ build

func _build(state: Dictionary) -> void:
	var t0 := Time.get_ticks_usec()
	_last_build = _now()
	for s in _surf: s.clear()
	_hcache.clear()
	stats.height_samples = 0
	var id := str(state.id)
	var fp: Dictionary = state.get("footprint", {})
	_origin = state.get("world_origin", Vector3.ZERO)
	_ok = bool(state.get("valid", false))
	_base = PALETTE[id] if _ok else CRIMSON
	_hi = _base.lerp(Color(1, 1, 0.92), 0.38)
	_seed = hash(id) & 0xffff
	_trees = PackedVector2Array()
	if id == "forest" or id == "ring":
		for v in _tree_source(state):
			if _trees.size() >= MAX_TREE_GLYPHS: break
			if typeof(v) == TYPE_VECTOR3 and (v as Vector3).is_finite(): _trees.push_back(Vector2(v.x, v.z))
	_paint_width = _fnum(fp, state, "paint_width", PATH_PAINT_DEFAULT) if id == "path" else 0.0
	var hovered: Vector3 = state.hovered
	var p := Vector2(hovered.x, hovered.z)
	var first_v: Variant = state.get("first_point", Vector3.INF)
	var has_first: bool = typeof(first_v) == TYPE_VECTOR3 and (first_v as Vector3).is_finite()
	var a := Vector2((first_v as Vector3).x, (first_v as Vector3).z) if has_first else Vector2.INF
	match id:
		"path", "sunder", "wall", "forest", "fault":
			if has_first and a.distance_to(p) > 0.3: call("_line_" + id, a, p, _fnum(fp, state, "width", DEFAULTS[id]))
			else: _line_start(p, _fnum(fp, state, "width", DEFAULTS[id]))
		"bridge", "ramp", "stairs", "boardwalk":
			if has_first and a.distance_to(p) > 0.3: _deck(id, a, p, _fnum(fp, state, "width", DEFAULTS[id]))
			else: _line_start(p, _fnum(fp, state, "width", DEFAULTS[id]))
		"raise": _raise(p, _fnum(fp, state, "radius", 15.0), _fnum(fp, state, "height", 3.6))
		"meteor": _meteor(p, state, _fnum(fp, state, "radius", 10.0), _fnum(fp, state, "damage_radius", 8.0))
		"grove": _grove(p, _fnum(fp, state, "radius", 3.1), int(_fnum(fp, state, "count", 3.0)))
		"ring": _ring(p, _fnum(fp, state, "inner", 14.0), _fnum(fp, state, "outer", 24.0), state)
		"awaken": _awaken(p, _fnum(fp, state, "radius", 5.0))
		"calm": _calm(p, _fnum(fp, state, "radius", 5.0))
		"harvest": _harvest(p, _fnum(fp, state, "radius", 5.0))
		"seed": _seed_glyph(p, _fnum(fp, state, "radius", 3.0))
		"patrol": _patrol(p, _fnum(fp, state, "radius", 3.0), state, _fnum(fp, state, "hero_clearance", 7.0))
	if not _ok: _blocked(p)
	_cursor(p)
	_commit()
	stats.build_usec = Time.get_ticks_usec() - t0
	stats.rebuilds += 1

func _fnum(fp: Dictionary, state: Dictionary, key: String, fallback: float) -> float:
	for source in [fp, state]:
		if source.has(key) and (typeof(source[key]) == TYPE_FLOAT or typeof(source[key]) == TYPE_INT) and float(source[key]) > 0.0:
			return float(source[key])
	return fallback

func _commit() -> void:
	mesh.clear_surfaces()
	var lower := Vector3.INF
	var upper := -Vector3.INF
	var tris := 0
	var verts := 0
	var surfaces := 0
	for i in _surf.size():
		var s: Surf = _surf[i]
		if s.idx.is_empty(): continue
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = s.v
		arrays[Mesh.ARRAY_COLOR] = s.c
		arrays[Mesh.ARRAY_TEX_UV] = s.uv
		arrays[Mesh.ARRAY_TEX_UV2] = s.uv2
		arrays[Mesh.ARRAY_INDEX] = s.idx
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(surfaces, _material(i))
		for v in s.v:
			lower = lower.min(v)
			upper = upper.max(v)
		tris += s.idx.size() / 3
		verts += s.v.size()
		surfaces += 1
	if surfaces > 0: mesh.custom_aabb = AABB(lower - Vector3(0, 0.5, 0), upper - lower + Vector3(0, 8.0, 0))
	instance.visible = surfaces > 0
	stats.triangles = tris
	stats.vertices = verts
	stats.surfaces = surfaces

# ------------------------------------------------------------- primitives

func _h(p: Vector2) -> float:
	if _hcache.has(p): return _hcache[p]
	var height := 0.0
	if game != null and game.get("landscape") != null:
		height = float(game.landscape.height_at(p))
		stats.height_samples += 1
	_hcache[p] = height
	return height

func _pt(p: Vector2, lift := 0.0) -> Vector3:
	return _origin + Vector3(p.x, _h(p) + STANDOFF + lift, p.y)

func _c(base: Color, alpha: float) -> Color:
	return Color(base.r, base.g, base.b, alpha)

func _hash(i: int) -> float:
	return fposmod(sin(float(i + _seed) * 12.9898) * 43758.5453, 1.0)

func _pattern(pat: float, par: float) -> Vector2:
	if not _ok and (pat == 1.0 or pat == 4.0): return Vector2(3.0, 0.9)
	return Vector2(pat, par)

func _line_pts(a: Vector2, b: Vector2, step: float, jag := 0.0) -> PackedVector2Array:
	var length := a.distance_to(b)
	var n := maxi(2, ceili(length / step) + 1)
	var dir := (b - a).normalized()
	var perp := Vector2(-dir.y, dir.x)
	var pts := PackedVector2Array()
	for i in n:
		var t := float(i) / (n - 1)
		var q := a.lerp(b, t)
		if jag > 0.0 and i > 0 and i < n - 1: q += perp * (_hash(i * 7) - 0.5) * 2.0 * jag
		pts.push_back(q)
	return pts

func _off(o: Variant, i: int) -> float:
	return (o as PackedFloat32Array)[i] if typeof(o) == TYPE_PACKED_FLOAT32_ARRAY else float(o)

## Ribbon along a polyline, laterally subdivided so EVERY vertex is height-sampled.
func _band(pts: PackedVector2Array, off_a: Variant, off_b: Variant, col_a: Color, col_b: Color, pat := 0.0, par := 1.0,
		surf := 0, lat_step := 2.0, mid := NO_MID, along := Vector2.ONE, lift := 0.0) -> void:
	var n := pts.size()
	if n < 2: return
	var widest := 0.0
	for i in n: widest = maxf(widest, absf(_off(off_b, i) - _off(off_a, i)))
	var lat := maxi(1, ceili(widest / lat_step))
	if mid.a >= 0.0 and lat % 2 == 1: lat += 1
	var pp := _pattern(pat, par)
	var s: Surf = _surf[surf]
	var prev := PackedInt32Array()
	var u := 0.0
	for i in n:
		var d := pts[mini(i + 1, n - 1)] - pts[maxi(i - 1, 0)]
		d = d.normalized() if d.length_squared() > 1e-8 else Vector2.RIGHT
		var perp := Vector2(-d.y, d.x)
		if i > 0: u += pts[i].distance_to(pts[i - 1])
		var oa := _off(off_a, i)
		var ob := _off(off_b, i)
		var fade := lerpf(along.x, along.y, float(i) / (n - 1))
		var row := PackedInt32Array()
		for j in lat + 1:
			var t := float(j) / lat
			var col: Color
			if mid.a >= 0.0: col = col_a.lerp(mid, t * 2.0) if t < 0.5 else mid.lerp(col_b, t * 2.0 - 1.0)
			else: col = col_a.lerp(col_b, t)
			col.a *= fade
			var off := lerpf(oa, ob, t)
			row.push_back(s.add(_pt(pts[i] + perp * off, lift), col, Vector2(u, off), pp.x, pp.y))
		if i > 0:
			for j in lat:
				s.tri(prev[j], row[j], prev[j + 1])
				s.tri(prev[j + 1], row[j], row[j + 1])
		prev = row

func _wob(theta: float, amount: float) -> float:
	return 1.0 + amount * (sin(theta * 3.0 + _seed) * 0.5 + sin(theta * 5.0 + _seed * 2.0) * 0.3 + sin(theta * 9.0 + _seed * 3.0) * 0.2)

## Polar patch (disc, annulus or arc), radially subdivided.
func _polar(center: Vector2, r0: float, r1: float, col0: Color, col1: Color, pat := 0.0, par := 1.0, surf := 0,
		segs := 40, lat_step := 2.5, a0 := 0.0, a1 := TAU, wobble := 0.0, xz_uv := true, mid := NO_MID, lift := 0.0) -> void:
	var lat := maxi(1, ceili(absf(r1 - r0) / lat_step))
	if mid.a >= 0.0 and lat % 2 == 1: lat += 1
	var pp := _pattern(pat, par)
	var s: Surf = _surf[surf]
	var prev := PackedInt32Array()
	var mid_r := (r0 + r1) * 0.5
	for i in segs + 1:
		var theta := lerpf(a0, a1, float(i) / segs)
		var w := _wob(theta, wobble) if wobble > 0.0 else 1.0
		var row := PackedInt32Array()
		for j in lat + 1:
			var t := float(j) / lat
			var col: Color
			if mid.a >= 0.0: col = col0.lerp(mid, t * 2.0) if t < 0.5 else mid.lerp(col1, t * 2.0 - 1.0)
			else: col = col0.lerp(col1, t)
			var r := lerpf(r0, r1, t) * w
			var q := center + Vector2(cos(theta), sin(theta)) * r
			var uv := q if xz_uv else Vector2(theta * mid_r, r - mid_r)
			row.push_back(s.add(_pt(q, lift), col, uv, pp.x, pp.y))
		if i > 0:
			for j in lat:
				s.tri(prev[j], row[j], prev[j + 1])
				s.tri(prev[j + 1], row[j], row[j + 1])
		prev = row

func _ring_line(center: Vector2, radius: float, thick: float, alpha: float, pat := 0.0, par := 1.0, surf := 0, segs := 48, wobble := 0.0, a0 := 0.0, a1 := TAU) -> void:
	_polar(center, radius - thick * 0.5, radius + thick * 0.5, _c(_base, alpha), _c(_base, alpha), pat, par, surf, segs, 2.0, a0, a1, wobble, false)

func _rung(center: Vector2, dir: Vector2, half: float, thick: float, alpha: float, surf := 1, col := Color(0, 0, 0, -1)) -> void:
	var perp := Vector2(-dir.y, dir.x)
	var pts := PackedVector2Array()
	var n := maxi(2, ceili(half * 2.0 / 1.4) + 1)
	for i in n: pts.push_back(center + perp * lerpf(-half, half, float(i) / (n - 1)))
	var c := _c(_base if col.a < 0.0 else col, alpha)
	_band(pts, -thick * 0.5, thick * 0.5, c, c, 0.0, 1.0, surf, 2.0, NO_MID)

func _chevron(center: Vector2, dir: Vector2, size: float, thick: float, alpha: float, surf := 1) -> void:
	var perp := Vector2(-dir.y, dir.x)
	var e1 := center - dir * size * 0.6 + perp * size
	var e2 := center - dir * size * 0.6 - perp * size
	var tip := center + dir * size * 0.6
	var pts := PackedVector2Array()
	for i in 4: pts.push_back(e1.lerp(tip, float(i) / 3.0))
	for i in range(1, 4): pts.push_back(tip.lerp(e2, float(i) / 3.0))
	var c := _c(_hi, alpha)
	_band(pts, -thick * 0.5, thick * 0.5, c, c, 0.0, 1.0, surf, 2.0)

func _star(center: Vector2, r_out: float, r_in: float, rot: float, col_c: Color, col_o: Color, surf := 1, points := 5) -> void:
	var s: Surf = _surf[surf]
	var hub := s.add(_pt(center), col_c, center, 0.0, 1.0)
	var first := -1
	var prev := -1
	for i in points * 2:
		var r := r_out if i % 2 == 0 else r_in
		var theta := rot + float(i) / (points * 2) * TAU
		var q := center + Vector2(cos(theta), sin(theta)) * r
		var vi := s.add(_pt(q), col_o if i % 2 == 0 else col_o.lerp(col_c, 0.5), q, 0.0, 1.0)
		if first < 0: first = vi
		if prev >= 0: s.tri(hub, prev, vi)
		prev = vi
	s.tri(hub, prev, first)

func _kite(center: Vector2, dir: Vector2, length: float, width: float, col_c: Color, col_t: Color, surf := 1) -> void:
	var perp := Vector2(-dir.y, dir.x)
	var s: Surf = _surf[surf]
	var base := s.add(_pt(center), col_c, center, 0.0, 1.0)
	var l := s.add(_pt(center + dir * length * 0.35 + perp * width), col_c, center, 0.0, 1.0)
	var tip := s.add(_pt(center + dir * length), col_t, center, 0.0, 1.0)
	var r := s.add(_pt(center + dir * length * 0.35 - perp * width), col_c, center, 0.0, 1.0)
	s.tri(base, l, tip)
	s.tri(base, tip, r)

func _sprout(center: Vector2, size: float, rot: float, alpha: float, surf := 1) -> void:
	for i in 3:
		var dir := Vector2.from_angle(rot + float(i) / 3.0 * TAU)
		_kite(center, dir, size, size * 0.34, _c(_hi, alpha), _c(_base, alpha * 0.35), surf)

func _streak(tail: Vector2, head: Vector2, w_head: float, alpha: float, surf := 1) -> void:
	var pts := _line_pts(tail, head, 1.2)
	var widths := PackedFloat32Array()
	var lows := PackedFloat32Array()
	for i in pts.size():
		var t := float(i) / (pts.size() - 1)
		var w := lerpf(0.04, w_head, pow(t, 1.4))
		widths.push_back(w)
		lows.push_back(-w)
	_band(pts, lows, widths, _c(_hi, alpha), _c(_hi, alpha), 0.0, 1.0, surf, 2.0, NO_MID, Vector2(0.0, 1.0))

func _blade(base: Vector2, dir: Vector2, half: float, height: float, alpha: float) -> void:
	# Two crossed vertical triangles rooted in the ground, fading to nothing at the tip.
	var s: Surf = _surf[1]
	var perp := Vector2(-dir.y, dir.x)
	for axis in [dir, perp]:
		var ax: Vector2 = axis
		var l := s.add(_pt(base - ax * half), _c(_hi, alpha), base, 0.0, 1.0)
		var r := s.add(_pt(base + ax * half), _c(_hi, alpha), base, 0.0, 1.0)
		var t := s.add(_pt(base, height), _c(_hi, 0.0), base, 0.0, 1.0)
		s.tri(l, r, t)

func _cursor(p: Vector2) -> void:
	_ring_line(p, 0.32, 0.09, 0.9, 0.0, 1.0, 1, 20)

func _blocked(p: Vector2) -> void:
	_ring_line(p, 0.95, 0.16, 0.95, 0.0, 1.0, 1, 28)
	var d := Vector2(0.7071, 0.7071)
	var pts := PackedVector2Array([p - d * 0.95, p - d * 0.3, p + d * 0.3, p + d * 0.95])
	_band(pts, -0.08, 0.08, _c(CRIMSON, 0.95), _c(CRIMSON, 0.95), 0.0, 1.0, 1, 2.0)

# ---------------------------------------------------------------- actions

func _line_start(p: Vector2, width: float) -> void:
	# No first point yet: anchor ring plus a very faint gauge of the true half-width.
	_ring_line(p, 0.9, 0.14, 0.75, 0.0, 1.0, 1, 32)
	_ring_line(p, width * 0.5, 0.12, 0.2, 2.0, 1.4, 0, 72)
	if _paint_width > width: _ring_line(p, _paint_width * 0.5, 0.1, 0.1, 2.0, 1.4, 0, 72)
	_polar(p, 0.0, 0.9, _c(_base, 0.3), _c(_base, 0.0), 0.0, 1.0, 0, 24, 2.0)

func _line_path(a: Vector2, b: Vector2, width: float) -> void:
	var pts := _line_pts(a, b, 1.0)
	var dir := (b - a).normalized()
	var half := width * 0.5
	var paint_half := maxf(_paint_width, width) * 0.5
	# soft painted-ground corridor (footprint.paint_width) fading outward from the true path edge
	if paint_half > half + 0.1:
		for side in [-1.0, 1.0]:
			_band(pts, side * half, side * paint_half, _c(_base, 0.16), _c(_base, 0.0), 0.0, 1.0, 0, 1.5)
	_band(pts, -half, half, _c(_base, 0.0), _c(_base, 0.0), 1, 3.0, 0, 1.0, _c(_base, 0.3))
	for side in [-1.0, 1.0]:
		var edge := PackedFloat32Array()
		var edge2 := PackedFloat32Array()
		for i in pts.size():
			edge.push_back(side * (half - 0.26))
			edge2.push_back(side * (half + 0.04))
		_band(pts, edge, edge2, _c(_base, 0.0), _c(_base, 0.85), 0.0, 1.0, 0, 2.0)
	var length := a.distance_to(b)
	var ticks := int(length / 3.0)
	for i in range(1, ticks + 1):
		var q := a + dir * (i * 3.0)
		if a.distance_to(q) < length - 0.4: _rung(q, dir, half * 0.72, 0.13, 0.55 if _ok else 0.35, 1)
	_chevron(b - dir * 0.2, dir, width * 0.7, 0.24, 0.85 if _ok else 0.0)
	_polar(a, 0.0, width, _c(_hi, 0.55), _c(_base, 0.0), 0.0, 1.0, 0, 20, 2.0)

func _line_sunder(a: Vector2, b: Vector2, width: float) -> void:
	var pts := _line_pts(a, b, 2.5)
	var n := pts.size()
	var half := width * 0.5
	var shoulder := 8.0
	var dir := (b - a).normalized()
	var perp := Vector2(-dir.y, dir.x)
	var neg := PackedFloat32Array()
	var pos := PackedFloat32Array()
	var neg_out := PackedFloat32Array()
	var pos_out := PackedFloat32Array()
	for i in n:
		var edge_jag := 0.0 if i == 0 or i == n - 1 else 1.0
		var ja := half + (_hash(i * 3 + 1) - 0.5) * 1.6 * edge_jag
		var jb := half + (_hash(i * 3 + 2) - 0.5) * 1.6 * edge_jag
		neg.push_back(-ja)
		pos.push_back(jb)
		neg_out.push_back(-ja - shoulder)
		pos_out.push_back(jb + shoulder)
	_band(pts, neg, pos, _c(_base, 0.06), _c(_base, 0.06), 4, 1.0, 0, 2.4, _c(_base, 0.3))
	_band(pts, pos, pos_out, _c(_base, 0.15), _c(_base, 0.0), 0, 1.0, 0, 2.7)
	_band(pts, neg, neg_out, _c(_base, 0.15), _c(_base, 0.0), 0, 1.0, 0, 2.7)
	# glowing jagged ridge lines at the true chasm edges
	for side in [pos, neg]:
		_band(pts, side, _shift(side, signf(side[1]) * 0.22), _c(_base, 0.0), _c(_hi, 0.75), 0.0, 1.0, 1, 2.0)
	if not _ok: return
	var zig := PackedVector2Array()
	for i in n:
		var q := pts[i]
		if i > 0 and i < n - 1: q += perp * (float(i % 2) - 0.5) * 1.5 + perp * (_hash(i * 5) - 0.5) * 0.7
		zig.push_back(q)
	_band(zig, -0.16, 0.16, _c(_hi, 0.9), _c(_hi, 0.9), 0.0, 1.0, 1, 2.0)
	for i in range(1, n - 1, 2):
		var side := 1.0 if i % 4 == 1 else -1.0
		var length := 2.5 + _hash(i * 11) * 3.0
		var out := (dir * (0.7 if _hash(i) > 0.5 else -0.7) + perp * side).normalized()
		var fork := PackedVector2Array([zig[i], zig[i] + out * length * 0.5 + perp * side * 0.2, zig[i] + out * length])
		_band(fork, -0.1, 0.1, _c(_hi, 0.65), _c(_hi, 0.65), 0.0, 1.0, 1, 2.0, NO_MID, Vector2(1.0, 0.0))

func _shift(values: PackedFloat32Array, amount: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	for v in values: out.push_back(v + amount)
	return out

func _line_wall(a: Vector2, b: Vector2, width: float) -> void:
	var pts := _line_pts(a, b, 2.0)
	var half := width * 0.5
	var dir := (b - a).normalized()
	var length := a.distance_to(b)
	_band(pts, -half, half, _c(_base, 0.0), _c(_base, 0.0), 1, 5.0, 0, 2.0, _c(_base, 0.2))
	for side in [-1.0, 1.0]:
		_band(pts, side * (half - 0.3), side * half, _c(_base, 0.0), _c(_base, 0.55), 0.0, 1.0, 0, 2.0)
	_band(pts, -0.3, 0.3, _c(_hi, 0.75 if _ok else 0.45), _c(_hi, 0.75 if _ok else 0.45), 0.0, 1.0, 1, 2.0)
	if not _ok: return
	var count := int(length / 4.0)
	for i in range(count):
		var q := a + dir * (2.0 + i * 4.0)
		if a.distance_to(q) > length - 1.0: continue
		_chevron(q, dir, 1.5, 0.2, 0.8)
		_blade(q + dir * 1.0, dir, 0.42, 2.0, 0.55)
		for side in [-1.0, 1.0]:
			var qq: Vector2 = q + Vector2(-dir.y, dir.x) * side * 3.2 + dir * (2.0 if i % 2 == 0 else 0.0)
			if a.distance_to(qq) < length - 0.5: _blade(qq, dir, 0.36, 1.1, 0.4)

func _line_forest(a: Vector2, b: Vector2, width: float) -> void:
	var pts := _line_pts(a, b, 2.5)
	var half := width * 0.5
	var dir := (b - a).normalized()
	var perp := Vector2(-dir.y, dir.x)
	var length := a.distance_to(b)
	_band(pts, -half, half, _c(_base, 0.0), _c(_base, 0.0), 4, 1.0, 0, 2.2, _c(_base, 0.27))
	for side in [-1.0, 1.0]:
		_band(pts, side * (half - 0.2), side * half, _c(_base, 0.0), _c(_base, 0.5), 0.0, 1.0, 0, 2.0)
	if not _ok: return
	# saplings grow from small at the first point to bigger at the far end
	if not _trees.is_empty():
		for q in _trees:
			var t := clampf((q - a).dot(dir) / maxf(length, 0.01), 0.0, 1.0)
			_sprout(q, lerpf(0.4, 0.95, t), _hash(int(q.x * 7.0 + q.y * 13.0)) * TAU, lerpf(0.5, 0.85, t))
		for i in range(int(length / 7.0)):
			_chevron(a + dir * (3.5 + i * 7.0), dir, 1.1, 0.16, 0.55)
		return
	var count := clampi(int(length / 3.4), 2, 30)
	for i in count:
		var t := (float(i) + 0.5) / count
		var lateral := (_hash(i * 13) - 0.5) * (width - 3.0)
		var q := a + dir * length * t + perp * lateral
		_sprout(q, lerpf(0.4, 0.95, t), _hash(i * 17) * TAU, lerpf(0.5, 0.85, t))
	for i in range(int(length / 7.0)):
		_chevron(a + dir * (3.5 + i * 7.0), dir, 1.1, 0.16, 0.55)

func _line_fault(a: Vector2, b: Vector2, width: float) -> void:
	var pts := _line_pts(a, b, 2.0)
	var half := width * 0.5
	var dir := (b - a).normalized()
	var perp := Vector2(-dir.y, dir.x)
	_band(pts, -half, half, _c(_base, 0.0), _c(_base, 0.0), 1, 3.5, 0, 2.0, _c(_base, 0.2))
	for side in [-1.0, 1.0]:
		_band(pts, side * (half - 0.16), side * half, _c(_base, 0.0), _c(_base, 0.5), 0.0, 1.0, 0, 2.0)
	var zig := _line_pts(a, b, 3.0, 0.85)
	if not _ok:
		_band(zig, -0.22, 0.22, _c(_hi, 0.6), _c(_hi, 0.6), 0.0, 1.0, 1, 2.0)
		return
	# refine the zigzag so the stress line stays on the ground between its corners
	var fine := PackedVector2Array()
	for i in zig.size() - 1:
		for k in 3: fine.push_back(zig[i].lerp(zig[i + 1], float(k) / 3.0))
	fine.push_back(zig[zig.size() - 1])
	_band(fine, -0.2, 0.2, _c(_hi, 0.95), _c(_hi, 0.95), 0.0, 1.0, 1, 2.0)
	for i in range(1, zig.size() - 1):
		var side := 1.0 if i % 2 == 0 else -1.0
		for k in 2:
			var angle := 0.9 + k * 0.5 + _hash(i * 3 + k) * 0.3
			var out := (dir * cos(angle) * (1.0 if k == 0 else -1.0) + perp * side * sin(angle)).normalized()
			var vein := PackedVector2Array([zig[i], zig[i] + out * 0.9, zig[i] + out * (1.5 + _hash(i * 5 + k) * 1.5)])
			_band(vein, -0.075, 0.075, _c(_hi, 0.7), _c(_hi, 0.7), 0.0, 1.0, 1, 2.0, NO_MID, Vector2(1.0, 0.0))
		if i % 2 == 0: _kite(zig[i], perp * side, 1.7, 0.42, _c(_hi, 0.65), _c(_base, 0.0))

func _deck(id: String, a: Vector2, b: Vector2, width: float) -> void:
	var length := a.distance_to(b)
	var dir := (b - a).normalized()
	var perp := Vector2(-dir.y, dir.x)
	var half := width * 0.5
	var pts := _line_pts(a, b, 1.0)
	var fill := 0.22 if _ok else 0.26
	match id:
		"ramp":
			_band(pts, -half, half, _c(_base, 0.05), _c(_base, 0.05), 0, 1.0, 0, 1.6, _c(_base, 0.38), Vector2(0.35, 1.0))
		"stairs":
			_band(pts, -half, half, _c(_base, 0.1), _c(_base, 0.1), 0, 1.0, 0, 1.6, _c(_base, 0.24))
		_:
			_band(pts, -half, half, _c(_base, fill * 0.6), _c(_base, fill * 0.6), 0, 1.0, 0, 1.6, _c(_base, fill))
	for side in [-1.0, 1.0]:
		if id == "boardwalk":
			_band(pts, side * (half - 0.09), side * (half + 0.09), _c(_base, 0.7), _c(_base, 0.7), 2, 1.0, 1, 2.0)
		else:
			_band(pts, side * (half - 0.18), side * half, _c(_base, 0.0), _c(_base, 0.85), 0.0, 1.0, 0, 2.0)
	if not _ok: return
	match id:
		"bridge":
			for i in range(1, int(length / 1.0)):
				_rung(a + dir * i, dir, half - 0.1, 0.1, 0.45, 1)
			for i in range(0, int(length / 2.0) + 1):
				for side in [-1.0, 1.0]:
					_rung(a + dir * (i * 2.0) + perp * side * (half + 0.1), perp, 0.22, 0.4, 0.8, 1)
			for i in range(1, int(length / 4.0) + 1):
				if i * 4.0 < length - 0.5: _rung(a + dir * (i * 4.0), dir, half + 0.35, 0.28, 0.85, 1)
		"ramp":
			for i in range(int(length / 2.5)):
				_chevron(a + dir * (1.3 + i * 2.5), dir, width * 0.42, 0.16, lerpf(0.4, 0.9, float(i) / maxf(1.0, length / 2.5)))
		"stairs":
			var treads := int(length / 0.6)
			for i in range(1, treads):
				_rung(a + dir * (i * 0.6), dir, half - 0.05, 0.11, 0.6 if i % 2 == 0 else 0.3, 1)
		"boardwalk":
			for i in range(1, int(length / 0.8)):
				_rung(a + dir * (i * 0.8), dir, half - 0.15, 0.09, 0.42 if i % 4 else 0.7, 1)
			for i in range(0, int(length / 3.2) + 1):
				for side in [-1.0, 1.0]:
					_rung(a + dir * (i * 3.2) + perp * side * half, perp, 0.13, 0.26, 0.8, 1)
	if id != "ramp": _chevron(b - dir * 0.3, dir, width * 0.55, 0.2, 0.9)
	_polar(a, 0.0, width * 0.55, _c(_hi, 0.45), _c(_base, 0.0), 0.0, 1.0, 0, 16, 2.0)

func _raise(p: Vector2, radius: float, height: float) -> void:
	_polar(p, 0.0, radius, _c(_base, 0.3), _c(_base, 0.0), 4, 1.0, 0, 56, 2.5)
	_ring_line(p, radius, 0.28, 0.65, 0.0, 1.0, 0, 72)
	# Topographic contours: equal height steps of an ease-out (quadratic) slope, so rings crowd near the rim.
	for k in range(1, 6):
		var r := radius * sqrt(1.0 - float(k) / 6.0)
		_ring_line(p, r, 0.16, 0.28 + 0.1 * k, 0.0, 1.0, 0, 64)
	if not _ok: return
	_ring_line(p, 1.4, 0.2, 0.85, 0.0, 1.0, 1, 24)
	_star(p, 1.6, 0.7, PI * 0.5, _c(_hi, 0.5), _c(_base, 0.0), 1, 4)
	# faint crest-height column so the true rise (from the footprint) is legible
	var s: Surf = _surf[1]
	for axis in [Vector2.RIGHT, Vector2.DOWN]:
		var ax: Vector2 = axis
		var bl := s.add(_pt(p - ax * 0.45), _c(_hi, 0.38), p, 0.0, 1.0)
		var br := s.add(_pt(p + ax * 0.45), _c(_hi, 0.38), p, 0.0, 1.0)
		var tl := s.add(_pt(p - ax * 0.12, height), _c(_hi, 0.0), p, 0.0, 1.0)
		var tr := s.add(_pt(p + ax * 0.12, height), _c(_hi, 0.0), p, 0.0, 1.0)
		s.tri(bl, br, tl)
		s.tri(br, tr, tl)

func _meteor(p: Vector2, state: Dictionary, radius: float, damage: float) -> void:
	var toward := _hero_dir(p, state)
	# Zone: ember fill hardened by a hazard-dashed damage ring; crater core in the centre.
	_polar(p, 0.0, radius, _c(_base, 0.36), _c(_base, 0.0), 4, 1.0, 0, 48, 2.0, 0.0, TAU, 0.0, true, NO_MID)
	_ring_line(p, radius, 0.22, 0.55, 0.0, 1.0, 0, 72)
	_polar(p, damage - 0.22, damage + 0.22, _c(_base, 0.85), _c(_base, 0.85), 2, 1.3, 1, 64, 2.0, 0.0, TAU, 0.0, false)
	var core := 2.0
	_polar(p, 0.0, core, _c(Color(0.28, 0.06, 0.03), 0.6 if _ok else 0.45), _c(Color(0.28, 0.06, 0.03), 0.0), 0, 1.0, 0, 28, 2.0)
	_ring_line(p, core, 0.14, 0.9, 0.0, 1.0, 1, 40)
	if not _ok: return
	# star-streak arrow: a comet streak arrives from the far side and ends on the crater core.
	var incoming := -toward.rotated(deg_to_rad(38.0))
	_streak(p + incoming * (damage + 1.6), p + incoming * (core + 0.25), 0.55, 0.85)
	for side in [-1.0, 1.0]:
		var perp: Vector2 = Vector2(-incoming.y, incoming.x) * side
		_streak(p + incoming * (damage - 0.5) + perp * 0.9, p + incoming * (core + 1.5) + perp * 0.45, 0.14, 0.45)
	_star(p, 1.55, 0.6, atan2(incoming.y, incoming.x), _c(Color(1, 0.93, 0.62), 0.95), _c(_base, 0.0))

func _grove(p: Vector2, radius: float, count: int) -> void:
	_polar(p, 0.0, radius, _c(_base, 0.3), _c(_base, 0.0), 4, 1.0, 0, 32, 1.6, 0.0, TAU, 0.1, true, _c(_base, 0.27))
	_ring_line(p, radius * 0.94, 0.14, 0.55, 0.0, 1.0, 0, 40, 0.1)
	if not _ok: return
	var n := maxi(count, 1)
	for i in n:
		var theta := TAU * float(i) / n + PI * 0.5
		var q := p + Vector2.from_angle(theta) * radius * 0.48
		_sprout(q, 0.85, theta + 0.4, 0.9)
		_ring_line(q, 0.55, 0.07, 0.4, 0.0, 1.0, 1, 16)
	# leafy nubs on the rim
	for i in 14:
		var theta := TAU * float(i) / 14.0 + 0.2
		var edge := p + Vector2.from_angle(theta) * radius * 0.94 * _wob(theta, 0.1)
		_kite(edge, Vector2.from_angle(theta), 0.5, 0.16, _c(_hi, 0.55), _c(_base, 0.0))

func _ring(p: Vector2, r_in: float, r_out: float, state: Dictionary) -> void:
	# Gateway faces the hero unless the footprint names one explicitly.
	var fp: Dictionary = state.get("footprint", {})
	var toward := _hero_dir(p, state)
	var gate := float(fp.get("gateway_angle", atan2(toward.y, toward.x)))
	var gap := float(fp.get("gateway_arc", 2.0 * asin(clampf(4.0 / ((r_in + r_out) * 0.5), 0.0, 1.0))))
	var a0 := gate + gap * 0.5
	var a1 := gate - gap * 0.5 + TAU
	var mid_r := (r_in + r_out) * 0.5
	var segs := 96
	_polar(p, r_in, r_out, _c(_base, 0.0), _c(_base, 0.0), 4, 1.0, 0, segs, 2.5, a0, a1, 0.0, true, _c(_base, 0.24))
	_ring_line(p, r_in, 0.22, 0.6, 0.0, 1.0, 0, segs, 0.0, a0, a1)
	_ring_line(p, r_out, 0.22, 0.6, 0.0, 1.0, 0, segs, 0.0, a0, a1)
	if not _ok: return
	_polar(p, mid_r - 0.1, mid_r + 0.1, _c(_hi, 0.55), _c(_hi, 0.55), 2, 1.6, 1, segs, 2.0, a0, a1, 0.0, false)
	if not _trees.is_empty():
		for q in _trees: _sprout(q, 0.9, (q - p).angle(), 0.55)
	else:
		for i in 24:
			var theta := lerpf(a0, a1, (float(i) + 0.5) / 24.0)
			_sprout(p + Vector2.from_angle(theta) * mid_r, 0.9, theta, 0.55)
	for edge in [gate + gap * 0.5, gate - gap * 0.5]:
		var post := p + Vector2.from_angle(edge) * mid_r
		var out := Vector2.from_angle(edge)
		_rung(post, out, (r_out - r_in) * 0.5, 0.3, 0.9, 1, Color(1.0, 0.86, 0.45))
		_star(post, 1.0, 0.42, edge, _c(Color(1.0, 0.92, 0.6), 0.9), _c(Color(1.0, 0.8, 0.35), 0.0))

func _awaken(p: Vector2, radius: float) -> void:
	_polar(p, 0.0, radius, _c(_base, 0.3), _c(_base, 0.0), 4, 1.0, 0, 36, 1.8, 0.0, TAU, 0.05)
	_ring_line(p, radius * 0.96, 0.14, 0.5, 0.0, 1.0, 0, 48)
	if not _ok: return
	# root spiral winding out from a small crown
	var spiral := PackedVector2Array()
	var steps := 64
	for i in steps + 1:
		var t := float(i) / steps
		var theta := t * TAU * 2.1
		spiral.push_back(p + Vector2.from_angle(theta) * lerpf(0.45, radius * 0.88, t))
	_band(spiral, -0.13, 0.13, _c(_hi, 0.95), _c(_hi, 0.3), 0.0, 1.0, 1, 2.0, NO_MID, Vector2(1.0, 0.25))
	for i in 5:
		var t := 0.3 + float(i) * 0.14
		var idx := int(t * steps)
		var out := (spiral[idx] - p).normalized()
		var root := PackedVector2Array([spiral[idx], spiral[idx] + out.rotated(0.5) * 0.7, spiral[idx] + out.rotated(0.9) * 1.3])
		_band(root, -0.07, 0.07, _c(_hi, 0.7), _c(_hi, 0.7), 0.0, 1.0, 1, 2.0, NO_MID, Vector2(1.0, 0.0))
	_sprout(p, 0.7, 0.3, 0.95)

func _calm(p: Vector2, radius: float) -> void:
	_polar(p, 0.0, radius, _c(_base, 0.26), _c(_base, 0.0), 1, 4.0, 0, 36, 1.8)
	_ring_line(p, radius * 0.96, 0.14, 0.5, 2.0, 1.1, 0, 60)
	if not _ok: return
	for i in 6:
		var start := TAU * float(i) / 6.0 + 0.2
		var tendril := PackedVector2Array()
		for k in 21:
			var t := float(k) / 20.0
			var r := lerpf(radius * 0.88, 0.5, t)
			tendril.push_back(p + Vector2.from_angle(start + t * 1.7 + sin(t * 6.0) * 0.16) * r)
		_band(tendril, -0.1, 0.1, _c(_hi, 0.75), _c(_hi, 0.75), 0.0, 1.0, 1, 2.0, NO_MID, Vector2(0.15, 1.0))
	_ring_line(p, 0.55, 0.12, 0.85, 0.0, 1.0, 1, 24)

func _harvest(p: Vector2, radius: float) -> void:
	_polar(p, 0.0, radius, _c(_base, 0.28), _c(_base, 0.0), 0, 1.0, 0, 36, 1.8)
	_ring_line(p, radius * 0.96, 0.14, 0.55, 2.0, 1.4, 0, 60)
	if not _ok: return
	# axe: a crescent head on a haft, lying on the ground
	var s := 1.0
	var handle := PackedVector2Array()
	for i in 6: handle.push_back(p + Vector2(-0.9, -1.7).lerp(Vector2(0.6, 1.5), float(i) / 5.0) * s)
	_band(handle, -0.09, 0.09, _c(_hi, 0.9), _c(_hi, 0.9), 0.0, 1.0, 1, 2.0)
	var blade := PackedVector2Array()
	for i in 9:
		var t := float(i) / 8.0
		var theta := lerpf(-1.05, 1.05, t)
		blade.push_back(p + Vector2(0.6, 1.3) + Vector2.from_angle(theta - 0.35) * 1.05 * s)
	_band(blade, -0.32, 0.32, _c(_hi, 0.95), _c(_hi, 0.95), 0.0, 1.0, 1, 2.0, NO_MID, Vector2(0.4, 1.0))
	for i in 3:
		var theta := 2.2 + float(i) * 1.5
		var stem := PackedVector2Array([p + Vector2.from_angle(theta) * 1.7, p + Vector2.from_angle(theta + 0.1) * 2.6, p + Vector2.from_angle(theta - 0.15) * 3.3])
		_band(stem, -0.07, 0.07, _c(_hi, 0.7), _c(_hi, 0.7), 0.0, 1.0, 1, 2.0, NO_MID, Vector2(1.0, 0.2))
		_kite(stem[2], (stem[2] - stem[1]).normalized(), 0.6, 0.18, _c(_hi, 0.65), _c(_base, 0.0))

func _seed_glyph(p: Vector2, radius: float) -> void:
	_polar(p, 0.0, radius, _c(_base, 0.2), _c(_base, 0.0), 4, 1.0, 0, 28, 1.6)
	_ring_line(p, radius * 0.96, 0.1, 0.5, 2.0, 1.0, 0, 48)
	if not _ok: return
	_sprout(p, 0.55, 0.6, 0.95)
	_ring_line(p, 0.3, 0.08, 0.7, 0.0, 1.0, 1, 16)

func _hero_dir(p: Vector2, state: Dictionary) -> Vector2:
	var hero: Variant = state.get("hero_clearance_center", Vector3.INF)
	if typeof(hero) == TYPE_VECTOR3 and (hero as Vector3).is_finite():
		var d := Vector2((hero as Vector3).x, (hero as Vector3).z) - p
		if d.length() > 0.1: return d.normalized()
	if game != null and game.get("camera") != null:
		var cam: Vector3 = game.camera.global_position - _origin
		var d2 := Vector2(cam.x, cam.z) - p
		if d2.length() > 0.1: return d2.normalized()
	return Vector2(0, 1)

func _patrol(p: Vector2, radius: float, state: Dictionary, clearance: float) -> void:
	var face := _hero_dir(p, state)
	var perp := Vector2(-face.y, face.x)
	_polar(p, 0.0, radius, _c(_base, 0.22), _c(_base, 0.0), 0, 1.0, 0, 32, 1.6)
	_ring_line(p, radius * 0.96, 0.12, 0.55, 2.0, 1.2, 0, 48)
	var hero: Variant = state.get("hero_clearance_center", Vector3.INF)
	if typeof(hero) == TYPE_VECTOR3 and (hero as Vector3).is_finite():
		var hc := Vector2((hero as Vector3).x, (hero as Vector3).z)
		if hc.distance_to(p) < clearance + 9.0:
			_ring_line(hc, clearance, 0.18, 0.4 if _ok else 0.7, 2.0, 1.4, 0, 56)
	if not _ok: return
	# formation: point-man ahead, two flankers behind, all facing the Hero
	var spawns := [p + face * radius * 0.56, p - face * radius * 0.3 + perp * radius * 0.5, p - face * radius * 0.3 - perp * radius * 0.5]
	for spawn in spawns:
		var q: Vector2 = spawn
		_ring_line(q, 0.42, 0.09, 0.85, 0.0, 1.0, 1, 20)
		_polar(q, 0.0, 0.42, _c(_hi, 0.45), _c(_base, 0.0), 0.0, 1.0, 0, 16, 1.0)
		_chevron(q + face * 0.7, face, 0.5, 0.12, 0.9)

# --------------------------------------------------------------- materials

static func _material(surface: int) -> ShaderMaterial:
	if surface == 0:
		if _mix_material == null: _mix_material = _make_material(SHADER, 0)
		return _mix_material
	if _add_material == null: _add_material = _make_material(SHADER, 1)
	return _add_material

static func _make_material(code: String, priority: int) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = code
	var mat := ShaderMaterial.new()
	mat.shader = shader
	mat.render_priority = priority
	return mat

const SHADER := """
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
// Vertex COLOR carries palette + soft-edge alpha. UV2.x picks the pattern:
// 0 solid, 1 flowing bands (par = wavelength m), 2 dashes (par = period m), 3 hatch (invalid), 4 organic grain.
uniform float breathe : hint_range(0.0, 0.4) = 0.1;
varying vec2 v_pat;
float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() {
	v_pat = UV2;
	// Nudge 3 cm toward the eye (on top of the 6 cm geometric standoff) to avoid ground z-fighting.
	vec3 to_eye = CAMERA_POSITION_WORLD - (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	VERTEX += normalize(to_eye) * 0.03;
}
void fragment() {
	float m = 1.0;
	float pat = v_pat.x;
	float par = max(v_pat.y, 0.05);
	if (pat > 3.5) {
		float n = vnoise(UV * 1.5 + TIME * 0.05) * 0.6 + vnoise(UV * 4.3 - TIME * 0.04) * 0.4;
		m = 0.4 + 0.9 * n;
	} else if (pat > 2.5) {
		float s = fract((UV.x + UV.y) / par);
		m = 0.2 + 0.8 * smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.4, 0.5, s));
	} else if (pat > 1.5) {
		float s = fract(UV.x / par);
		m = smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.5, 0.62, s));
	} else if (pat > 0.5) {
		m = 0.55 + 0.45 * sin((UV.x - TIME * 1.2) * 6.2831853 / par);
	}
	float pulse = 1.0 + breathe * sin(TIME * 1.7 + UV.x * 0.12);
	ALBEDO = COLOR.rgb;
	ALPHA = clamp(COLOR.a * m * pulse, 0.0, 1.0);
}
"""
