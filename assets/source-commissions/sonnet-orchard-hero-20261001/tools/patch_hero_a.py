"""Editable generation step A: skeleton (hero growth layer) patched into tree_kit.gd (kept for provenance)."""
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, cnt)


rep("static func _skel_apple(sk: Dictionary, rng: RandomNumberGenerator, opts: Dictionary) -> void:\n\tvar h: float = sk.height\n\tvar form_name",
    "static func _skel_apple_base(sk: Dictionary, rng: RandomNumberGenerator, opts: Dictionary) -> void:\n\tvar h: float = sk.height\n\tvar form_name")
rep("static func _skel_pine(", '''## Apple = the proven base skeleton (trunk, low fruit limb, blobs, fruit, reach points: identical for every seed) plus a hero
## growth layer drawn from its own RNG stream.
static func _skel_apple(sk: Dictionary, rng: RandomNumberGenerator, opts: Dictionary) -> void:
	_skel_apple_base(sk, rng, opts)
	sk["hero"] = true
	_hero_apple(sk)

static func _path_at(pts: Array, t: float) -> Array:
	var n = pts.size() - 1
	var f = clampf(t, 0.0, 0.999) * float(n)
	var k = int(f)
	var u = f - float(k)
	return [pts[k].lerp(pts[k + 1], u), (pts[k + 1] - pts[k]).normalized()]

static func _radius_at(radii: Array, t: float) -> float:
	var n = radii.size() - 1
	var f = clampf(t, 0.0, 0.999) * float(n)
	var k = int(f)
	return lerpf(float(radii[k]), float(radii[k + 1]), f - float(k))

## Gnarled growth layer: crotch swell, a curving central leader, two extra scaffold limbs, forked secondary branches and
## twigs that end in small leaf clumps (sk.clumps), plus three long surface roots. Never touches sk.blobs/fruit/reach_points.
static func _hero_apple(sk: Dictionary) -> void:
	var h: float = sk.height
	var hr = _rng("apple_hero", int(sk.seed), 93)
	var r0: float = sk.trunk.radius
	var axis: Vector3 = sk.trunk.axis
	var top = _trunk_top(sk)
	var collar: Vector3 = top
	var parents = []
	for tb in sk.tubes:
		if tb.kind == "trunk": collar = tb.points.back()
		elif tb.kind == "limb": parents.append({"points": tb.points, "radii": tb.radii})
	sk.tubes.append({"points": [top - axis * 0.22, top + axis * 0.05, collar + Vector3.UP * 0.07], "radii": [r0 * 0.5, r0 * 0.6, r0 * 0.5], "wind": 0.0, "kind": "trunk"})
	var lean = Vector3(hr.randf_range(-1.0, 1.0), 0, hr.randf_range(-1.0, 1.0)) * h * 0.045
	var lead_len: float = maxf(h - collar.y - h * 0.1, 1.0)
	var lead = [collar - axis * 0.05, collar + Vector3.UP * lead_len * 0.35 + lean * 0.5, collar + Vector3.UP * lead_len * 0.7 - lean * 0.35, collar + Vector3.UP * lead_len + lean * 0.2]
	sk.tubes.append({"points": lead, "radii": [r0 * 0.4, r0 * 0.3, r0 * 0.17, r0 * 0.06], "wind": 0.0, "kind": "leader"})
	var az0 = hr.randf() * TAU
	for i in 2:
		var az = az0 + PI * float(i) + hr.randf_range(-0.6, 0.6)
		var elev = hr.randf_range(0.85, 1.25)
		var length = h * hr.randf_range(0.2, 0.27)
		var o: Vector3 = collar + Vector3.DOWN * hr.randf_range(0.05, 0.2)
		var mid: Vector3 = o + _dir(az, elev) * length * 0.5
		var tip: Vector3 = mid + _dir(az + hr.randf_range(-0.3, 0.3), elev * 0.8) * length * 0.5 + Vector3.UP * 0.08
		var tube = {"points": [o, mid, tip], "radii": [r0 * 0.36, r0 * 0.25, r0 * 0.12], "wind": 0.0, "kind": "scaffold"}
		sk.tubes.append(tube)
		parents.append({"points": tube.points, "radii": tube.radii})
	for pr in parents:
		for j in 2:
			var t = (0.34 + 0.34 * float(j)) + hr.randf_range(-0.06, 0.06)
			var at = _path_at(pr.points, t)
			var rad = _radius_at(pr.radii, t)
			var length = h * hr.randf_range(0.1, 0.15)
			var side = Vector3(hr.randf_range(-1.0, 1.0), hr.randf_range(-0.2, 0.5), hr.randf_range(-1.0, 1.0)).normalized()
			var d = (at[1] * 0.5 + side * 0.8).normalized()
			_hero_branch(sk, hr, at[0], d, length, rad * 0.5, 1)
	var off = hr.randf() * TAU
	for i in 3:
		var a = off + TAU * float(i) / 3.0 + hr.randf_range(-0.5, 0.5)
		var out = Vector3(cos(a), 0, sin(a))
		var reach = r0 * hr.randf_range(2.2, 3.4)
		sk.tubes.append({"points": [axis * 0.34 + out * r0 * 0.5, out * r0 * 1.2 + Vector3.UP * 0.09, out * (r0 + reach * 0.6) + Vector3.UP * 0.02, out * (r0 + reach) + Vector3.DOWN * 0.1],
			"radii": [r0 * 0.3, r0 * 0.22, r0 * 0.14, r0 * 0.06], "wind": 0.0, "kind": "root"})

static func _hero_branch(sk: Dictionary, hr: RandomNumberGenerator, o: Vector3, dir: Vector3, length: float, radius: float, depth: int) -> void:
	var side = dir.cross(Vector3(hr.randf_range(-1.0, 1.0), hr.randf_range(-0.3, 0.3), hr.randf_range(-1.0, 1.0))).normalized()
	var d1 = (dir.rotated(side, hr.randf_range(-0.2, 0.4)) + Vector3.UP * 0.16).normalized()
	var d2 = (d1.rotated(side, hr.randf_range(-0.35, 0.45)) + Vector3.UP * 0.1).normalized()
	var mid: Vector3 = o + d1 * length * 0.55
	var tip: Vector3 = mid + d2 * length * 0.45
	sk.tubes.append({"points": [o, mid, tip], "radii": [radius, radius * 0.62, radius * 0.32], "wind": 0.0, "kind": "branch" if depth > 0 else "twig"})
	if depth > 0:
		var fork_axis = d2.cross(Vector3.UP)
		if fork_axis.length_squared() < 0.01: fork_axis = Vector3.RIGHT
		fork_axis = fork_axis.normalized()
		_hero_branch(sk, hr, mid, d1.rotated(fork_axis, -0.7).rotated(Vector3.UP, hr.randf_range(-0.6, 0.6)), length * 0.62, radius * 0.5, depth - 1)
		_hero_branch(sk, hr, tip, d2.rotated(fork_axis, 0.45).rotated(Vector3.UP, hr.randf_range(-0.6, 0.6)), length * 0.62, radius * 0.5, depth - 1)
	else:
		var cr = hr.randf_range(0.34, 0.5)
		sk.clumps.append({"center": tip + d2 * cr * 0.35 + Vector3.UP * cr * 0.1, "radius": Vector3(cr, cr * 0.8, cr), "ci": hr.randi() % 4, "flat": 0.6,
			"phase": Vector3(hr.randf() * TAU, hr.randf() * TAU, hr.randf() * TAU), "spin": hr.randf() * TAU})

static func _skel_pine(''')
open(p, 'w', encoding='utf-8').write(s)
