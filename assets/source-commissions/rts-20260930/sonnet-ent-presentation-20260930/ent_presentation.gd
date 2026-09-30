class_name EntPresentation
extends Node3D
## Visual-only Ent layer. Child of the real tree; never reparents/frees it, never touches
## its transform, colliders or meta. See HANDOFF.md for budgets. Untested in-engine.

const EYE_CLOSED := 0.08
static var _mats: Dictionary = {}
static var _meshes: Dictionary = {}

var _tree: Node3D
var _species: String = "apple"
var _cond: String = "healthy"
var _k: float = 1.0
var _rig: Node3D
var _face: Node3D
var _brows: MeshInstance3D
var _eyes: MeshInstance3D
var _arms: Array[Node3D] = []
var _forearms: Array[Node3D] = []
var _feet: Array[Node3D] = []
var _toes: Array[Node3D] = []
var _seams: MeshInstance3D
var _pollen: CPUParticles3D
var _chips: CPUParticles3D
var _canopy: Node3D
var _canopy_rest: Basis = Basis.IDENTITY
var _t: float = 0.0
var _wake: float = 1.0
var _wake_speed: float = 0.0
var _recoil: float = 0.0
var _recoil_dir: Vector3 = Vector3.BACK
var _calm: bool = false
var _calm_blend: float = 0.0
var _fallen: bool = false
var _fall_blend: float = 0.0
var _external: bool = false
var _speed: float = 0.0
var _step_phase: float = 0.0
var _eye_col: Color = Color(1.0, 0.72, 0.3)
var _face_y: float = 1.6
var _face_r: float = 0.3
var _unit: float = 0.3

# ---------------------------------------------------------------- public API
func setup(tree: Node3D, species: String, scale_hint: float, condition: String) -> void:
	_tree = tree
	_species = species if species in ["apple", "pine"] else "apple"
	_cond = condition
	_k = clampf(scale_hint, 0.5, 3.0)
	name = "EntPresentation"
	for c: Node in get_children():
		c.queue_free()
	_arms.clear(); _forearms.clear(); _feet.clear(); _toes.clear()
	_seams = null
	_build()

## phase: awaken plays the wake-up; restore (or missing phase) snaps to the awake pose.
func react(payload: Dictionary) -> void:
	if _rig == null:
		return
	var phase: String = str(payload.get("phase", "restore"))
	match phase:
		"awaken":
			_wake = 0.0; _wake_speed = 0.55; _fallen = false; _calm = false
			_burst(_chips)
		"restore":
			_wake = 1.0; _wake_speed = 0.0; _fallen = false; _calm = false
		"hostile":
			_fallen = false; _calm = false
		"calm":
			_calm = true; _burst(_pollen)
		"hit":
			_recoil = 1.0
			_recoil_dir = Vector3(sin(_t * 7.0) * 0.5, 0.2, 1.0).normalized()
			_burst(_chips)
		"fallen":
			_fallen = true; _calm = false
			_burst(_pollen)

func update_motion(speed: float, delta: float) -> void:
	_external = true
	_speed = speed
	_tick(delta)

func _process(delta: float) -> void:
	if not _external:
		_tick(delta)

func _exit_tree() -> void:
	if _canopy != null and is_instance_valid(_canopy):
		_canopy.transform.basis = _canopy_rest

static func clear_cache() -> void:
	_mats.clear(); _meshes.clear()

# ---------------------------------------------------------------- animation
func _tick(delta: float) -> void:
	if _rig == null:
		return
	_t += delta
	if _wake_speed > 0.0:
		_wake = minf(1.0, _wake + _wake_speed * delta)
	_recoil = maxf(0.0, _recoil - delta * 3.5)
	_calm_blend = move_toward(_calm_blend, 1.0 if _calm else 0.0, delta * 1.2)
	_fall_blend = move_toward(_fall_blend, 1.0 if _fallen else 0.0, delta * 0.8)
	var awake: float = smoothstep(0.0, 1.0, _wake) * (1.0 - _fall_blend)
	var breath: float = sin(_t * (1.1 if _calm else 1.6)) * 0.5 + 0.5
	var blink: float = 1.0
	var bt: float = fposmod(_t, 5.3)
	if bt < 0.18:
		blink = absf(bt - 0.09) / 0.09
	var open: float = lerpf(EYE_CLOSED, 1.0, awake) * blink * (1.0 - _recoil * 0.45)
	_eyes.scale = Vector3(_unit, _unit * maxf(open, 0.05), _unit)
	var em: StandardMaterial3D = _mat("eye" + _ck()) as StandardMaterial3D
	em.emission = _eye_col.lerp(Color(0.7, 1.0, 0.55), _calm_blend)
	em.emission_energy_multiplier = (0.9 + 0.35 * breath) * awake + 0.05
	_face.position = Vector3(0.0, _face_y, _face_r) + _recoil_dir * (_recoil * 0.05 * _k)
	_face.rotation = Vector3(-0.1 * _recoil + 0.05 * _fall_blend, sin(_t * 0.4) * 0.03 * awake, 0.0)
	_brows.position.y = _unit * (0.12 * _calm_blend - 0.1 * _recoil)
	for i in 2:
		var s: float = -1.0 if i == 0 else 1.0
		var raise: float = 0.35 + 0.25 * _calm_blend + 0.6 * _recoil - 0.5 * _fall_blend
		# z-roll: arms hang down (-0.9 rad * s ... ) when asleep, lift as awake
		_arms[i].rotation = Vector3(0.08 * sin(_t * 1.3 + i * 1.7) * awake, 0.0,
			-s * (0.9 - raise * awake - 0.12 * breath * awake))
		_forearms[i].rotation = Vector3(0.0, 0.0, s * (0.45 + 0.35 * _calm_blend * sin(_t * 2.2 + i * 2.0)))
		var lift: float = maxf(0.0, sin(_step_phase + i * PI)) * minf(_speed, 1.0)
		_feet[i].rotation = Vector3(-lift * 0.5, 0.0, s * (0.25 - 0.3 * (1.0 - awake)))
		_toes[i].rotation = Vector3(lift * 0.6 + 0.1 * sin(_t * 0.8 + i), 0.0, 0.0)
	_step_phase += delta * _speed * 4.0
	if _canopy != null and is_instance_valid(_canopy):
		var sw: float = (sin(_t * 0.9) * 0.012 + _recoil * sin(_t * 30.0) * 0.03) * awake
		_canopy.transform.basis = _canopy_rest * Basis.from_euler(Vector3(sw, 0.0, sw * 0.7))
	if _seams != null:
		var sm: StandardMaterial3D = _mat("seam") as StandardMaterial3D
		sm.emission_energy_multiplier = (1.4 + 0.8 * sin(_t * 3.1) * sin(_t * 1.7)) * (1.0 - _fall_blend * 0.6)
	_pollen.emitting = awake > 0.5 and (_calm or _species == "apple" or _cond == "burning")

# ---------------------------------------------------------------- build
func _ck() -> String:
	return "_burn" if _cond == "burning" else ("_pine" if _species == "pine" else "_apple")

func _aabb_of(n: Node) -> AABB:
	var mi: MeshInstance3D = n as MeshInstance3D
	if mi != null and mi.mesh != null:
		return mi.transform * mi.mesh.get_aabb()
	return AABB()

func _build() -> void:
	var ta: AABB = _aabb_of(_tree.get_node_or_null("Trunk"))
	if ta.size == Vector3.ZERO:
		ta = _aabb_of(_tree.get_node_or_null("Crown"))
		ta.size.y *= 0.45   # crown AABB: assume lower part is trunk
	if ta.size == Vector3.ZERO:
		ta = AABB(Vector3(-0.3, 0.0, -0.3), Vector3(0.6, 3.0 * _k, 0.6))
	var th: float = ta.size.y
	var tr: float = clampf(minf(ta.size.x, ta.size.z) * 0.5, 0.12, 0.8)
	_unit = tr
	_face_y = ta.position.y + th * (0.42 if _species == "apple" else 0.3)
	_face_r = tr * 0.9
	_canopy = _tree.get_node_or_null("Crown") as Node3D
	if _canopy != null:
		_canopy_rest = _canopy.transform.basis
	_rig = Node3D.new(); _rig.name = "Rig"
	_rig.position = Vector3(ta.position.x + ta.size.x * 0.5, 0.0, ta.position.z + ta.size.z * 0.5)
	add_child(_rig)
	_eye_col = Color(1.0, 0.42, 0.1) if _cond == "burning" else (Color(1.0, 0.75, 0.3) if _species == "apple" else Color(0.95, 0.6, 0.25))
	_face = Node3D.new(); _face.name = "Face"; _face.position = Vector3(0.0, _face_y, _face_r)
	_rig.add_child(_face)
	var solemn: bool = _species == "pine"
	_brows = MeshInstance3D.new(); _brows.name = "Brows"
	_brows.mesh = _cached("brows_%s" % _species, _build_brows.bind(solemn))
	_brows.material_override = _mat("bark" + _ck()); _brows.scale = Vector3.ONE * _unit
	_face.add_child(_brows)
	_eyes = MeshInstance3D.new(); _eyes.name = "Eyes"
	_eyes.mesh = _cached("eyes", _build_eyes)
	_eyes.material_override = _mat("eye" + _ck()); _eyes.scale = Vector3.ONE * _unit
	_face.add_child(_eyes)
	var sh_y: float = ta.position.y + th * 0.6
	var seg: float = th * (0.3 if _species == "apple" else 0.22)
	for i in 2:
		var s: float = -1.0 if i == 0 else 1.0
		var arm: Node3D = Node3D.new(); arm.name = "Arm%d" % i
		arm.position = Vector3(s * tr * 0.85, sh_y, 0.0)
		_rig.add_child(arm); _arms.append(arm)
		arm.add_child(_limb(Vector3(s, 0, 0), tr * 0.3, seg))
		var fa: Node3D = Node3D.new(); fa.name = "Forearm"
		fa.position = Vector3(s * seg * 0.97, 0, 0)
		arm.add_child(fa); _forearms.append(fa)
		fa.add_child(_limb(Vector3(s, 0, 0), tr * 0.2, seg * 0.8))
		var foot: Node3D = Node3D.new(); foot.name = "Foot%d" % i
		foot.position = Vector3(s * tr * 0.5, ta.position.y + th * 0.05, tr * 0.3)
		_rig.add_child(foot); _feet.append(foot)
		var rd: Vector3 = Vector3(s * 0.6, -0.3, 0.75).normalized()
		foot.add_child(_limb(rd, tr * 0.3, tr * 1.6))
		var toe: Node3D = Node3D.new(); toe.name = "Toe"
		toe.position = rd * tr * 1.55
		foot.add_child(toe); _toes.append(toe)
		toe.add_child(_limb(Vector3(s * 0.3, -0.35, 0.9).normalized(), tr * 0.17, tr * 0.9))
	if _cond == "burning":
		_seams = MeshInstance3D.new(); _seams.name = "Seams"
		_seams.mesh = _cached("seams", _build_seams)
		_seams.material_override = _mat("seam")
		_seams.position = Vector3(0, ta.position.y, 0); _seams.scale = Vector3(tr, th, tr)
		_rig.add_child(_seams)
	var pc: Color = Color(1.0, 0.55, 0.15) if _cond == "burning" else Color(0.9, 1.0, 0.5)
	_pollen = _particles("Pollen", pc, 0.04 * _k, 20, 3.5, 0.25, Vector3(0, 0.1, 0), 0.6 * _k)
	_pollen.position = Vector3(0, ta.position.y + th * 1.2, 0)
	_chips = _particles("Chips", Color(0.55, 0.36, 0.2), 0.035 * _k, 10, 0.8, 1.0, Vector3(0, -6.0, 0), 0.05)
	_chips.one_shot = true; _chips.explosiveness = 0.95
	_chips.position = Vector3(0, _face_y, _face_r)
	_rig.add_child(_pollen); _rig.add_child(_chips)

func _particles(nm: String, col: Color, size: float, amount: int, life: float, vel: float, grav: Vector3, radius: float) -> CPUParticles3D:
	var p: CPUParticles3D = CPUParticles3D.new(); p.name = nm
	p.amount = amount; p.lifetime = life; p.emitting = false
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE; p.emission_sphere_radius = radius
	p.direction = Vector3(0, 1, 0.5); p.spread = 60.0
	p.initial_velocity_min = vel * 0.5; p.initial_velocity_max = vel * 1.5
	p.gravity = grav; p.local_coords = false
	var qm: QuadMesh = QuadMesh.new(); qm.size = Vector2(size, size)
	qm.material = _mat("mote_" + nm + ("_burn" if _cond == "burning" else ""))
	var sm: StandardMaterial3D = qm.material as StandardMaterial3D
	sm.albedo_color = col; sm.emission = col
	p.mesh = qm
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return p

func _burst(p: CPUParticles3D) -> void:
	if p != null:
		p.restart()
		p.emitting = true

# ---------------------------------------------------------------- materials / meshes
func _mat(key: String) -> Material:
	if _mats.has(key):
		return _mats[key]
	var m: StandardMaterial3D = StandardMaterial3D.new()
	m.roughness = 0.9
	if key.begins_with("bark"):
		m.vertex_color_use_as_albedo = true
		var cols: Dictionary = {"_apple": Color(0.52, 0.34, 0.2), "_pine": Color(0.4, 0.27, 0.2), "_burn": Color(0.22, 0.14, 0.11)}
		m.albedo_color = cols[key.substr(4)]
		m.rim_enabled = true; m.rim = 0.25; m.rim_tint = 0.6
	elif key.begins_with("eye"):
		m.vertex_color_use_as_albedo = true
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.emission_enabled = true; m.emission = Color(1.0, 0.72, 0.3)
	elif key == "seam":
		m.albedo_color = Color(0.1, 0.03, 0.02); m.emission_enabled = true
		m.emission = Color(1.0, 0.38, 0.08); m.emission_energy_multiplier = 1.5
	else:
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		m.emission_enabled = true; m.emission_energy_multiplier = 1.4
	_mats[key] = m
	return m

func _cached(key: String, f: Callable) -> ArrayMesh:
	if not _meshes.has(key):
		_meshes[key] = f.call()
	return _meshes[key]

## Limb mesh is built along +X (unit length, unit radius), then oriented to `dir`.
func _limb(dir: Vector3, r: float, length: float) -> MeshInstance3D:
	var mi: MeshInstance3D = MeshInstance3D.new()
	mi.mesh = _cached("limb", _build_limb)
	var b: Basis
	if dir.x < -0.99:
		b = Basis.from_euler(Vector3(0, PI, 0))
	else:
		b = Basis(Quaternion(Vector3.RIGHT, dir.normalized()))
	mi.transform = Transform3D(b * Basis.from_scale(Vector3(length, r, r)), Vector3.ZERO)
	mi.material_override = _mat("bark" + _ck())
	return mi

func _build_limb() -> ArrayMesh:
	var st: SurfaceTool = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n: int = 6
	var radii: Array[float] = [1.25, 1.0, 0.8, 0.55, 0.15]
	var bend: Array[float] = [0.0, 0.03, 0.0, -0.05, -0.1]
	var rings: int = radii.size()
	for k in rings:
		var x: float = float(k) / float(rings - 1)
		var shade: float = 0.85 + 0.15 * float(k % 2)
		for i in n:
			var a: float = TAU * float(i) / float(n)
			st.set_color(Color(shade, shade, shade))
			st.add_vertex(Vector3(x, bend[k] + cos(a) * radii[k], sin(a) * radii[k] * 1.15))
	for k in rings - 1:
		for i in n:
			var a: int = k * n + i
			var b: int = k * n + (i + 1) % n
			for idx: int in [a, b, a + n, b, b + n, a + n]:
				st.add_index(idx)
	st.generate_normals()
	return st.commit()

## Slab from a to b, front face toward +Z.
func _slab(st: SurfaceTool, a: Vector3, b: Vector3, col: Color, thick: float) -> void:
	var z: Vector3 = Vector3(0, 0, thick)
	var up: Vector3 = Vector3(0, thick * 1.1, 0)
	var v: Array[Vector3] = [a - up, b - up, b + up, a + up, a - up + z, b - up + z, b + up + z * 1.5, a + up + z * 1.5]
	var quads: Array = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [1, 2, 6, 5], [0, 4, 7, 3]]
	for q: Array in quads:
		for idx: int in [q[0], q[1], q[2], q[0], q[2], q[3]]:
			st.set_color(col)
			st.add_vertex(v[idx])

func _build_brows(solemn: bool) -> ArrayMesh:
	var st: SurfaceTool = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var cl: Color = Color(1.05, 1.0, 0.95)
	for s: float in [-1.0, 1.0]:
		# kind apple brow: outer end higher (soft arch); pine: inner end lower (stern)
		var y_in: float = 0.36 - (0.0 if not solemn else 0.08)
		var y_out: float = 0.36 + (0.16 if not solemn else 0.04)
		_slab(st, Vector3(0.1 * s, y_in, 0.0), Vector3(0.62 * s, y_out, -0.02), cl, 0.11)
		_slab(st, Vector3(0.24 * s, -0.2, 0.0), Vector3(0.56 * s, -0.16, -0.04), cl * 0.92, 0.09)
	_slab(st, Vector3(0.0, 0.2, 0.04), Vector3(0.0, -0.16, 0.1), cl * 0.9, 0.08)
	var mc: Color = cl * 0.55
	var segs: int = 4
	var curve: float = 0.0 if solemn else 0.16
	for i in segs:
		var t0: float = float(i) / float(segs)
		var t1: float = float(i + 1) / float(segs)
		var y0: float = -0.5 + curve * (1.0 - pow(2.0 * t0 - 1.0, 2.0)) * -1.0 + curve
		var y1: float = -0.5 + curve * (1.0 - pow(2.0 * t1 - 1.0, 2.0)) * -1.0 + curve
		_slab(st, Vector3(lerpf(-0.36, 0.36, t0), y0, -0.02), Vector3(lerpf(-0.36, 0.36, t1), y1, -0.02), mc, 0.03)
	st.generate_normals()
	return st.commit()

func _build_eyes() -> ArrayMesh:
	var st: SurfaceTool = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for s: float in [-1.0, 1.0]:
		var c: Vector3 = Vector3(0.33 * s, 0.1, 0.02)
		var n: int = 10
		for i in n:
			var a0: float = TAU * float(i) / float(n)
			var a1: float = TAU * float(i + 1) / float(n)
			st.set_color(Color(1.0, 0.95, 0.75)); st.add_vertex(c + Vector3(0, 0, 0.03))
			st.set_color(Color(0.85, 0.55, 0.25)); st.add_vertex(c + Vector3(cos(a0) * 0.16, sin(a0) * 0.1, 0.0))
			st.set_color(Color(0.85, 0.55, 0.25)); st.add_vertex(c + Vector3(cos(a1) * 0.16, sin(a1) * 0.1, 0.0))
	return st.commit()

func _build_seams() -> ArrayMesh:
	var st: SurfaceTool = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for a0: float in [0.6, 2.4, 4.0, 5.3]:
		var prev: Vector3 = Vector3.ZERO
		for k in 6:
			var a: float = a0 + sin(float(k) * 2.3 + a0) * 0.18
			var p: Vector3 = Vector3(cos(a) * 1.03, 0.05 + 0.14 * float(k), sin(a) * 1.03)
			if k > 0:
				var t: Vector3 = Vector3(-sin(a), 0, cos(a)) * 0.05 * (1.0 - float(k) / 7.0)
				for v: Vector3 in [prev - t, p - t, p + t, prev - t, p + t, prev + t]:
					st.set_color(Color.WHITE)
					st.add_vertex(v)
			prev = p
	st.generate_normals()
	return st.commit()
