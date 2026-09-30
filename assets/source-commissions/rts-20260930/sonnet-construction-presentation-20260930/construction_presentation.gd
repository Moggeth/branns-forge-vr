extends RefCounted
## Visual-only timber presentation for bridge / ramp / stairs / boardwalk.
## Six merged surfaces (one MeshInstance3D) = 6 draw calls. No bodies, colliders or metadata.

const TEX_PLANK := "res://assets/worldbuilder/stockpile_tex_wood_plank.png"
const TEX_DARK := "res://assets/worldbuilder/stockpile_tex_wood_dark.png"
const TEX_END := "res://assets/worldbuilder/stockpile_tex_endgrain.png"
const TEX_BARK := "res://assets/worldbuilder/stockpile_tex_bark.png"
const TEX_TIMBER := "res://assets/forge_materials/timber.png"

enum S { PLANK, DARK, END, BRASS, ROPE, GLOW }
const PLANK_T := 0.08
const PILE_DEPTH := {"bridge": 1.7, "boardwalk": 1.0, "ramp": 1.0, "stairs": 0.9}

static var _cache: Dictionary = {}


class Mesher extends RefCounted:
	var sts: Array = []
	var counts: Array = [0, 0, 0, 0, 0, 0]

	func _init() -> void:
		for i in 6:
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			sts.append(st)

	## Box centred at xf.origin, extents `size` (local axes, NOT scaled), grain running along axis `grain`.
	## Faces whose normal is the grain axis go to `end_surf`. UVs are metre-scaled.
	func box(xf: Transform3D, size: Vector3, surf: int, end_surf: int, grain: int, color: Color, uvo: Vector2 = Vector2.ZERO, end_color: Color = Color.WHITE) -> void:
		var h := size * 0.5
		for n in 3:
			var t1 := (n + 1) % 3
			var t2 := (n + 2) % 3
			for sgn in [-1.0, 1.0]:
				var is_end := n == grain
				var st: SurfaceTool = sts[end_surf if is_end else surf]
				counts[end_surf if is_end else surf] += 2
				var col := end_color if is_end else color
				var ua := t1
				var va := t2
				if not is_end and t2 == grain:
					ua = t2
					va = t1
				var nrm := Vector3.ZERO
				nrm[n] = sgn
				var wn := (xf.basis * nrm).normalized()
				var pts: Array = []
				for uv in [Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)]:
					var p := Vector3.ZERO
					p[n] = sgn * h[n]
					p[t1] = (uv.x * 2.0 - 1.0) * h[t1]
					p[t2] = (uv.y * 2.0 - 1.0) * h[t2]
					var tc := Vector2(p[ua] + h[ua], p[va] + h[va])
					tc = Vector2(tc.x / 1.4, tc.y / 0.7) + uvo
					if is_end:
						tc = Vector2(tc.x * 1.4 / 0.5, tc.y * 0.7 / 0.5)
					pts.append([xf * p, tc])
				var order: Array = [0, 2, 1, 0, 3, 2] if sgn > 0.0 else [0, 1, 2, 0, 2, 3]
				for k in order:
					st.set_color(col)
					st.set_normal(wn)
					st.set_uv(pts[k][1])
					st.add_vertex(pts[k][0])

	## Beam between two points (length along local Z = grain).
	func beam(p0: Vector3, p1: Vector3, w: float, t: float, surf: int, end_surf: int, color: Color, uvo: Vector2 = Vector2.ZERO) -> void:
		var d := p1 - p0
		var len := d.length()
		if len < 0.001:
			return
		var z := d / len
		var x := Vector3.UP.cross(z)
		if x.length() < 0.01:
			x = Vector3.RIGHT
		x = x.normalized()
		var y := z.cross(x).normalized()
		box(Transform3D(Basis(x, y, z), (p0 + p1) * 0.5), Vector3(w, t, len), surf, end_surf, 2, color, uvo)


static func _tex(path: String) -> Texture2D:
	if ResourceLoader.exists(path):
		return load(path) as Texture2D
	return null


static func _mat(kind: int) -> StandardMaterial3D:
	if _cache.has(kind):
		return _cache[kind]
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	match kind:
		S.PLANK:
			m.albedo_texture = _tex(TEX_PLANK)
			m.roughness = 0.86
		S.DARK:
			m.albedo_texture = _tex(TEX_DARK)
			if m.albedo_texture == null: m.albedo_texture = _tex(TEX_TIMBER)
			m.roughness = 0.92
		S.END:
			m.albedo_texture = _tex(TEX_END)
			m.roughness = 0.95
		S.BRASS:
			m.albedo_color = Color(0.72, 0.56, 0.24)
			m.metallic = 0.6
			m.roughness = 0.5
		S.ROPE:
			m.albedo_texture = _tex(TEX_BARK)
			m.albedo_color = Color(0.78, 0.68, 0.48)
			m.roughness = 1.0
	_cache[kind] = m
	return m


static func _glow_mat() -> StandardMaterial3D:
	## One per structure so its commissioning glow can settle independently.
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.1, 0.3, 0.3)
	m.emission_enabled = true
	m.emission = Color(0.25, 0.95, 0.85)
	m.emission_energy_multiplier = 3.0
	m.roughness = 0.4
	return m


static func _tint(rng: RandomNumberGenerator, base: Color, amt: float) -> Color:
	var k := 1.0 + rng.randf_range(-amt, amt)
	return Color(base.r * k * (1.0 + rng.randf_range(0.0, 0.05)), base.g * k, base.b * k * (1.0 - rng.randf_range(0.0, 0.05)), 1.0)


static func render(record: Dictionary, parent: Node3D) -> void:
	if parent == null or not record.has("a") or not record.has("b"):
		return
	var ra: Array = record.a
	var rb: Array = record.b
	var a := Vector3(float(ra[0]), float(ra[1]), float(ra[2]))
	var b := Vector3(float(rb[0]), float(rb[1]), float(rb[2]))
	var length: float = Vector2(b.x - a.x, b.z - a.z).length()
	if length < 0.5:
		return
	var kind := str(record.get("kind", "bridge"))
	var width: float = float(record.get("width", 3.0))
	var mid_y: float = (a.y + b.y) * 0.5
	var pitch: float = -atan2(b.y - a.y, length)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash("%d,%d,%d,%d,%d,%d" % [roundi(a.x * 10), roundi(a.y * 10), roundi(a.z * 10), roundi(b.x * 10), roundi(b.y * 10), roundi(b.z * 10)])
	var m := Mesher.new()
	var warm := Color(1.0, 0.86, 0.68)
	var dark := Color(0.72, 0.62, 0.55)
	if kind == "stairs":
		_stairs(m, rng, a, b, length, width, mid_y, warm, dark)
	else:
		_deck(m, rng, kind, length, width, pitch, warm, dark)
		_rails_and_posts(m, rng, kind, length, width, pitch, dark)
		_piles(m, rng, kind, a, b, length, width, mid_y, dark)
	var mesh := ArrayMesh.new()
	var mats: Array = [_mat(S.PLANK), _mat(S.DARK), _mat(S.END), _mat(S.BRASS), _mat(S.ROPE), null]
	var glow := _glow_mat()
	mats[S.GLOW] = glow
	for i in 6:
		if m.counts[i] == 0:
			continue
		(m.sts[i] as SurfaceTool).commit(mesh)
		mesh.surface_set_material(mesh.get_surface_count() - 1, mats[i])
	var mi := MeshInstance3D.new()
	mi.name = "TimberVisual"
	mi.mesh = mesh
	mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	parent.add_child(mi)
	if parent.is_inside_tree():
		var tw := mi.create_tween()
		tw.tween_property(glow, "emission_energy_multiplier", 0.5, 4.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
		tw.parallel().tween_property(glow, "emission", Color(0.75, 0.6, 0.25), 4.0)
	else:
		glow.emission_energy_multiplier = 0.5
		glow.emission = Color(0.75, 0.6, 0.25)


static func _deck(m: Mesher, rng: RandomNumberGenerator, kind: String, length: float, width: float, pitch: float, warm: Color, dark: Color) -> void:
	var F := Transform3D(Basis(Vector3.RIGHT, pitch), Vector3.ZERO)
	var span: float = length + 0.10 # matches collider
	var half := span * 0.5
	# Stringers under the planks (hidden top at -PLANK_T), plus fascia rims just below surface.
	var xs := [-(width * 0.5 - 0.22), 0.0, width * 0.5 - 0.22]
	for x in xs:
		m.box(F * Transform3D(Basis.IDENTITY, Vector3(x, -PLANK_T - 0.07, 0)), Vector3(0.2, 0.14, span), S.DARK, S.END, 2, _tint(rng, dark, 0.06))
	# Fascia beam, flush below plank ends
	for side in [-1.0, 1.0]:
		m.box(F * Transform3D(Basis.IDENTITY, Vector3(side * (width * 0.5 - 0.05), -0.15, 0)), Vector3(0.10, 0.14, span), S.DARK, S.END, 2, _tint(rng, dark, 0.05))
	# Cross-joists under deck
	var j := maxi(2, int(span / 1.4))
	for i in j + 1:
		var z: float = -half + 0.15 + (span - 0.3) * float(i) / float(j)
		m.box(F * Transform3D(Basis.IDENTITY, Vector3(0, -0.2, z)), Vector3(width - 0.1, 0.05, 0.14), S.DARK, S.END, 0, _tint(rng, dark, 0.08))
	# Planks
	var count := maxi(3, int(round(span / 0.25)))
	var pw: float = span / float(count)
	for i in count:
		var z: float = -half + (float(i) + 0.5) * pw
		var drop: float = rng.randf_range(0.0, 0.012) # only ever sunk, never proud
		var w: float = width - rng.randf_range(0.0, 0.03)
		var xo: float = rng.randf_range(-0.012, 0.012)
		var pos := Vector3(xo, -PLANK_T * 0.5 - drop, z)
		m.box(F * Transform3D(Basis.IDENTITY, pos), Vector3(w, PLANK_T, pw - 0.022), S.PLANK, S.END, 0, _tint(rng, warm, 0.12), Vector2(rng.randf(), rng.randf()), _tint(rng, Color(0.95, 0.8, 0.62), 0.1))
		# brass pegs on every 4th board, sunk flush (<=0.012 proud)
		if i % 4 == 1:
			for side in [-1.0, 1.0]:
				m.box(F * Transform3D(Basis.IDENTITY, Vector3(side * (width * 0.5 - 0.09), -0.004, z)), Vector3(0.05, 0.016, 0.05), S.BRASS, S.BRASS, 1, Color(0.85, 0.7, 0.45))
	# Teal inlay strips along the deck edges (flush, settle to gold)
	for side in [-1.0, 1.0]:
		if kind == "bridge":
			m.box(F * Transform3D(Basis.IDENTITY, Vector3(side * (width * 0.5 - 0.22), -0.006, 0)), Vector3(0.025, 0.012, span * 0.96), S.GLOW, S.GLOW, 2, Color.WHITE)


static func _rails_and_posts(m: Mesher, rng: RandomNumberGenerator, kind: String, length: float, width: float, pitch: float, dark: Color) -> void:
	var F := Transform3D(Basis(Vector3.RIGHT, pitch), Vector3.ZERO)
	var px := width * 0.5 - 0.10
	var spans := maxi(1, int(round(length / 3.0)))
	for side in [-1.0, 1.0]:
		var x: float = side * px
		m.box(F * Transform3D(Basis.IDENTITY, Vector3(x, 0.48, 0)), Vector3(0.15, 0.16, length), S.PLANK, S.END, 2, _tint(rng, Color(0.85, 0.72, 0.6), 0.05), Vector2(rng.randf(), rng.randf()))
		var prev := Vector3.ZERO
		for i in spans + 1:
			var z: float = (-0.48 + 0.96 * float(i) / float(spans)) * length
			m.box(F * Transform3D(Basis.IDENTITY, Vector3(x, 0.17, z)), Vector3(0.19, 0.52, 0.19), S.DARK, S.END, 1, _tint(rng, dark, 0.06), Vector2(rng.randf(), rng.randf()))
			# brass cap, shallow, atop rail height
			m.box(F * Transform3D(Basis.IDENTITY, Vector3(x, 0.445 + 0.26 + 0.0, z)), Vector3(0.23, 0.05, 0.23), S.BRASS, S.BRASS, 1, Color(0.8, 0.64, 0.38))
			m.box(F * Transform3D(Basis.IDENTITY, Vector3(x, 0.76 + 0.03, z)), Vector3(0.07, 0.05, 0.07), S.GLOW, S.GLOW, 1, Color.WHITE)
			# rope lashing around post
			m.box(F * Transform3D(Basis.IDENTITY, Vector3(x, 0.3, z)), Vector3(0.22, 0.05, 0.22), S.ROPE, S.ROPE, 1, Color.WHITE)
			# sagging rope between posts
			var pt := Vector3(x, 0.3, z)
			if i > 0:
				var segs := 4
				var last := prev
				for k in range(1, segs + 1):
					var f := float(k) / float(segs)
					var q := prev.lerp(pt, f)
					q.y -= 0.12 * sin(f * PI)
					m.beam(F * last, F * q, 0.035, 0.035, S.ROPE, S.ROPE, Color.WHITE)
					last = q
			prev = pt


static func _piles(m: Mesher, rng: RandomNumberGenerator, kind: String, a: Vector3, b: Vector3, length: float, width: float, mid_y: float, dark: Color) -> void:
	var depth: float = PILE_DEPTH.get(kind, 1.0)
	var bays := maxi(1, int(round(length / (4.5 if kind == "bridge" else 6.0))))
	var px := width * 0.5 - 0.3
	for i in bays + 1:
		var t: float = 0.03 + 0.94 * float(i) / float(bays)
		var z: float = (t - 0.5) * length
		var deck_y: float = lerpf(a.y, b.y, t) - mid_y - 0.22
		var d: float = depth + rng.randf_range(0.0, 0.3)
		for side in [-1.0, 1.0]:
			m.box(Transform3D(Basis.IDENTITY, Vector3(side * px, deck_y - d * 0.5 + 0.1, z)), Vector3(0.26, d + 0.2, 0.26), S.DARK, S.END, 1, _tint(rng, dark, 0.08), Vector2(rng.randf(), rng.randf()))
			m.box(Transform3D(Basis.IDENTITY, Vector3(side * px, deck_y - 0.03, z)), Vector3(0.34, 0.04, 0.34), S.BRASS, S.BRASS, 1, Color(0.72, 0.58, 0.36))
		if kind == "bridge" or d > 1.2:
			# X cross-brace between the pair, below the cap
			var y0 := deck_y - 0.25
			m.beam(Vector3(-px, y0, z), Vector3(px, y0 - d * 0.6, z), 0.1, 0.06, S.DARK, S.END, _tint(rng, dark, 0.05))
			m.beam(Vector3(px, y0, z), Vector3(-px, y0 - d * 0.6, z), 0.1, 0.06, S.DARK, S.END, _tint(rng, dark, 0.05))


static func _stairs(m: Mesher, rng: RandomNumberGenerator, a: Vector3, b: Vector3, length: float, width: float, mid_y: float, warm: Color, dark: Color) -> void:
	var dy: float = b.y - a.y
	var count: int = maxi(1, maxi(ceili(absf(dy) / 0.18), ceili(length / 0.48)))
	var depth: float = length / float(count) + 0.02
	var rise: float = absf(dy) / float(count)
	var up: float = 1.0 if dy >= 0.0 else -1.0
	for i in count:
		var t: float = (float(i) + 0.5) / float(count)
		var y: float = lerpf(a.y, b.y, float(i + 1) / float(count)) - mid_y
		var z: float = (t - 0.5) * length
		var w: float = width - rng.randf_range(0.0, 0.03)
		m.box(Transform3D(Basis.IDENTITY, Vector3(0, y - 0.09, z)), Vector3(w, 0.18, depth), S.PLANK, S.END, 0, _tint(rng, warm, 0.12), Vector2(rng.randf(), rng.randf()), _tint(rng, Color(0.95, 0.8, 0.62), 0.1))
		# dark riser board under lower edge
		var rh: float = maxf(rise, 0.06)
		m.box(Transform3D(Basis.IDENTITY, Vector3(0, y - 0.18 - rh * 0.5, z - up * (depth * 0.5 - 0.03))), Vector3(width - 0.1, rh, 0.05), S.DARK, S.END, 0, _tint(rng, dark, 0.06))
		if i % 3 == 1:
			for side in [-1.0, 1.0]:
				m.box(Transform3D(Basis.IDENTITY, Vector3(side * (width * 0.5 - 0.08), y + 0.001, z)), Vector3(0.05, 0.014, 0.05), S.BRASS, S.BRASS, 1, Color(0.85, 0.7, 0.45))
	# Side stringers (outside the walkable width) following the tread line
	var y_start: float = lerpf(a.y, b.y, 0.5 / float(count)) - mid_y
	var y_end: float = lerpf(a.y, b.y, 1.0 - 0.5 / float(count)) - mid_y
	var z0: float = (0.5 / float(count) - 0.5) * length
	var z1: float = (1.0 - 0.5 / float(count) - 0.5) * length
	for side in [-1.0, 1.0]:
		var x: float = side * (width * 0.5 + 0.07)
		m.beam(Vector3(x, y_start - 0.2, z0 - 0.15), Vector3(x, y_end - 0.2, z1 + 0.15), 0.14, 0.3, S.DARK, S.END, _tint(rng, dark, 0.05))
		# newel posts both ends, brass cap, teal gem
		for e in 2:
			var zz: float = z0 - 0.05 if e == 0 else z1 + 0.05
			var yy: float = (y_start if e == 0 else y_end)
			m.box(Transform3D(Basis.IDENTITY, Vector3(x, yy + 0.3, zz)), Vector3(0.2, 0.9, 0.2), S.DARK, S.END, 1, _tint(rng, dark, 0.06))
			m.box(Transform3D(Basis.IDENTITY, Vector3(x, yy + 0.77, zz)), Vector3(0.25, 0.05, 0.25), S.BRASS, S.BRASS, 1, Color(0.8, 0.64, 0.38))
			m.box(Transform3D(Basis.IDENTITY, Vector3(x, yy + 0.83, zz)), Vector3(0.07, 0.06, 0.07), S.GLOW, S.GLOW, 1, Color.WHITE)
			m.box(Transform3D(Basis.IDENTITY, Vector3(x, yy + 0.05, zz)), Vector3(0.23, 0.05, 0.23), S.ROPE, S.ROPE, 1, Color.WHITE)
