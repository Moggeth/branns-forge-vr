class_name EntPresentation
extends Node3D
## Visual-only Ent layer. Child of the real tree; never reparents/frees it, never touches
## its transform, colliders or meta. All geometry lives in a "rig" that is aligned to the real
## Trunk mesh (axis, lean, radius, taper, polygon sides), so face parts are sampled ON the
## trunk surface and arms/roots pivot inside rounded knots that stay connected while animated.
## Front is +Z of the tree (integration supplies facing). Front faces are CLOCKWISE (see _tri).
## Rig units are trunk-base radii. Bark/seam/mote materials and trunk-independent limb meshes are
## shared statics; only the eye material is per-instance.

const EYE_CLOSED := 0.08
const LID_TRAVEL := 0.30
const LIP := 0.03   # minimum height of face relief above the (polygonal) trunk surface
static var _mats: Dictionary = {}
static var _meshes: Dictionary = {}

var _tree: Node3D
var _species: String = "apple"
var _cond: String = "healthy"
var _k: float = 1.0
var _rig: Node3D
var _face: Node3D
var _eyes: MeshInstance3D
var _brows: Array[Node3D] = []
var _lids: Array[Node3D] = []
var _brow_base: Array[Vector3] = []
var _lid_base: Array[Vector3] = []
var _arms: Array[Node3D] = []
var _forearms: Array[Node3D] = []
var _feet: Array[Node3D] = []
var _toes: Array[Node3D] = []
var _arm_yaw: Array[float] = []
var _foot_yaw: Array[float] = []
var _foot_y: float = 0.3
var _seams: MeshInstance3D
var _pollen: CPUParticles3D
var _chips: CPUParticles3D
var _canopy: Node3D
var _canopy_rest: Basis = Basis.IDENTITY
var _t: float = 0.0
var _wake: float = 1.0
var _wake_speed: float = 0.0
var _recoil: float = 0.0
var _calm: bool = false
var _calm_blend: float = 0.0
var _hostile: bool = false
var _host_blend: float = 0.0
var _fallen: bool = false
var _fall_blend: float = 0.0
var _external: bool = false
var _speed: float = 0.0
var _step_phase: float = 0.0
var _eye_col: Color = Color(1.0, 0.72, 0.3)
var _eye_material: StandardMaterial3D
var _last_tree_position := Vector3.ZERO
# trunk-fit state (rig units = base radius)
var _H: float = 6.0        # true trunk height
var _Hq: float = 6.0       # quantised height used for cached meshes
var _yF: float = 2.5       # face centre height
var _n: int = 8            # trunk polygon sides
var _a0: float = 0.0       # trunk-local angle of the front direction
var _sg: float = 1.0
var _sk: String = ""
var _ctr: int = 0

# ---------------------------------------------------------------- public API
func setup(tree: Node3D, species: String, scale_hint: float, condition: String) -> void:
	_tree = tree
	_species = species if species in ["apple", "pine"] else "apple"
	_cond = condition
	_k = clampf(scale_hint, 0.5, 3.0)
	name = "EntPresentation"
	_last_tree_position = tree.global_position
	for c: Node in get_children():
		c.queue_free()
	_arms.clear(); _forearms.clear(); _feet.clear(); _toes.clear()
	_brows.clear(); _lids.clear(); _brow_base.clear(); _lid_base.clear()
	_arm_yaw.clear(); _foot_yaw.clear()
	_seams = null
	_build()

## phase: awaken plays the wake-up; restore (or missing phase) snaps to the awake pose.
func react(payload: Dictionary) -> void:
	if _rig == null:
		return
	var phase: String = str(payload.get("phase", "restore"))
	match phase:
		"awaken":
			_wake = 0.0; _wake_speed = 0.55; _fallen = false; _calm = false; _hostile = false
			_burst(_chips)
		"restore":
			_wake = 1.0; _wake_speed = 0.0; _fallen = false; _calm = false; _hostile = false
		"hostile":
			_fallen = false; _calm = false; _hostile = true
		"ignite":
			set_condition("burning")
		"quenched":
			set_condition("healthy")
		"calm":
			_calm = true; _hostile = false; _burst(_pollen)
		"hit":
			_recoil = 1.0
			_burst(_chips)
		"fallen":
			_fallen = true; _calm = false; _hostile = false
			_burst(_pollen)

func set_condition(condition: String) -> void:
	_cond = condition
	_eye_col = Color(1.0, 0.42, 0.1) if condition == "burning" else (Color(1.0, 0.75, 0.3) if _species == "apple" else Color(0.95, 0.6, 0.25))
	if _rig == null: return
	if condition == "burning" and _seams == null:
		_seams = _make_seams()
		_rig.add_child(_seams)
	if _seams != null: _seams.visible = condition == "burning"
	for mesh in _rig.find_children("*", "MeshInstance3D", true, false):
		if mesh == _eyes or mesh == _seams: continue
		mesh.material_override = _mat("bark" + _ck())
	# Materials whose colour changes with one Ent are per-instance, while the
	# unchanged bark/geometry stays shared. Quenching must not recolour siblings.
	if _pollen != null:
		var mote_mesh: Mesh = _pollen.mesh.duplicate()
		var mote_material: StandardMaterial3D = mote_mesh.material.duplicate()
		var tint := Color(1, 0.55, 0.15) if condition == "burning" else Color(0.9, 1, 0.5)
		mote_material.albedo_color = tint
		mote_material.emission = tint
		mote_mesh.material = mote_material
		_pollen.mesh = mote_mesh

func update_motion(speed: float, delta: float) -> void:
	_external = true
	_speed = speed
	_tick(delta)

func _process(delta: float) -> void:
	if not _external:
		if is_instance_valid(_tree) and delta > 0.0:
			_speed = minf((_tree.global_position - _last_tree_position).length() / delta, 2.0)
			_last_tree_position = _tree.global_position
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
	_host_blend = move_toward(_host_blend, 1.0 if _hostile else 0.0, delta * 2.0)
	_fall_blend = move_toward(_fall_blend, 1.0 if _fallen else 0.0, delta * 0.8)
	var awake: float = smoothstep(0.0, 1.0, _wake) * (1.0 - _fall_blend)
	var breath: float = sin(_t * (1.1 if _calm else 1.6)) * 0.5 + 0.5
	var move: float = minf(_speed, 1.0)
	var blink: float = 1.0
	var bt: float = fposmod(_t, 5.3)
	if bt < 0.18:
		blink = absf(bt - 0.09) / 0.09
	var open: float = lerpf(EYE_CLOSED, 1.0, awake) * blink * (1.0 - _recoil * 0.4) * (1.0 - 0.22 * _host_blend)
	# face: eyelids slide over the eyes, brows/lids roll (inner end down = determined, up = kind)
	var mood: float = 0.42 * _host_blend - 0.16 * _calm_blend + 0.1 * _recoil
	for i in 2:
		var s: float = -1.0 if i == 0 else 1.0
		_lids[i].position = _lid_base[i] + Vector3(0.0, LID_TRAVEL * open, 0.0)
		_lids[i].rotation.z = s * mood * 0.65
		_brows[i].position = _brow_base[i] + Vector3(0.0, 0.05 * _calm_blend * awake - 0.05 * _host_blend - 0.04 * _recoil + 0.02 * breath * awake, 0.0)
		_brows[i].rotation.z = s * mood
	_face.rotation.y = sin(_t * 0.4) * 0.04 * awake + sin(_t * 41.0) * 0.03 * _recoil
	var glow: float = lerpf(0.12, 0.85 + 0.15 * breath, awake) * (1.0 + 0.25 * _host_blend)
	_eye_material.albedo_color = _eye_col.lerp(Color(0.7, 1.0, 0.55), _calm_blend) * glow
	# arms: shoulder + elbow swing, rest droop when asleep; walking counter-swings them
	var stride: float = sin(_step_phase)
	for i in 2:
		var s2: float = -1.0 if i == 0 else 1.0
		var up: float = lerpf(-1.0, -0.12, awake) + 0.55 * _calm_blend + 0.5 * _host_blend + 0.5 * _recoil - 0.3 * _fall_blend
		up += 0.05 * breath * awake + 0.12 * sin(_t * 1.3 + i * 1.7) * awake
		var swing: float = 0.35 * stride * s2 * move
		_arms[i].basis = Basis(Vector3.UP, _arm_yaw[i]) * Basis.from_euler(Vector3(0.0, swing, up))
		var bend: float = lerpf(-0.45, 0.25, awake) + 0.55 * _host_blend + 0.45 * _calm_blend * sin(_t * 2.2 + i * 2.0) + 0.25 * maxf(0.0, s2 * stride) * move
		_forearms[i].basis = Basis.from_euler(Vector3(0.0, 0.0, bend))
		# roots: planted when idle, lift/plant alternately while moving, tuck under when asleep
		var lift: float = maxf(0.0, sin(_step_phase + i * PI)) * move
		var fstride: float = sin(_step_phase + i * PI) * move
		_feet[i].position.y = _foot_y - 0.16 * (1.0 - awake)
		_feet[i].basis = Basis(Vector3.UP, _foot_yaw[i] + 0.25 * fstride * s2) * Basis.from_euler(Vector3(0.0, 0.0, lift * 0.5 - 0.3 * (1.0 - awake)))
		_toes[i].basis = Basis.from_euler(Vector3(0.0, 0.0, lift * 0.6 + 0.08 * sin(_t * 0.8 + i)))
	_step_phase += delta * _speed * 4.0
	if _canopy != null and is_instance_valid(_canopy):
		var sw: float = (sin(_t * 0.9) * 0.012 + sin(_step_phase) * 0.018 * move + _recoil * sin(_t * 30.0) * 0.03) * awake
		_canopy.transform.basis = _canopy_rest * Basis.from_euler(Vector3(sw, 0.0, sw * 0.7 + (breath - 0.5) * 0.006 * awake))
	if _seams != null:
		var sm: StandardMaterial3D = _mat("seam") as StandardMaterial3D
		sm.emission_energy_multiplier = (1.4 + 0.8 * sin(_t * 3.1) * sin(_t * 1.7)) * (1.0 - _fall_blend * 0.6)
	_pollen.emitting = awake > 0.5 and (_calm or _species == "apple" or _cond == "burning")

# ---------------------------------------------------------------- trunk fit
func _ck() -> String:
	return "_burn" if _cond == "burning" else ("_pine" if _species == "pine" else "_apple")

func _rho(y: float) -> float:
	return maxf(1.0 - 0.5 * y / _Hq, 0.3)

## Point on the trunk surface (rig space) at angle u from the front, height y, pushed out by h.
## Follows the actual polygonal cross-section (vertex/edge phase measured from the Trunk mesh).
func _sp(u: float, y: float, h: float) -> Vector3:
	var m: float = fposmod(_a0 + _sg * u, TAU / float(_n)) - PI / float(_n)
	var r: float = _rho(y) * cos(PI / float(_n)) / cos(m) + h
	return Vector3(sin(u) * r, y, cos(u) * r)

func _p(u: float, v: float, h: float) -> Vector3:
	return _sp(u, _yF + v, h)

func _build() -> void:
	var tn: MeshInstance3D = _tree.get_node_or_null("Trunk") as MeshInstance3D
	var xf: Transform3D
	_n = 8
	if tn != null and tn.mesh != null:
		xf = tn.transform
		_n = clampi(roundi(float(tn.mesh.get_faces().size() / 3) / 7.0), 3, 16)
	else:
		var ta := AABB()
		var cr: MeshInstance3D = _tree.get_node_or_null("Crown") as MeshInstance3D
		if cr != null and cr.mesh != null:
			ta = cr.transform * cr.mesh.get_aabb()
			ta.size.y *= 0.45
		if ta.size == Vector3.ZERO:
			ta = AABB(Vector3(-0.3, 0.0, -0.3), Vector3(0.6, 3.0 * _k, 0.6))
		var rr: float = clampf(minf(ta.size.x, ta.size.z) * 0.5, 0.12, 0.8)
		xf = Transform3D(Basis(Vector3(2.0 * rr, 0, 0), Vector3(0, ta.size.y, 0), Vector3(0, 0, 2.0 * rr)), ta.position + Vector3(ta.size.x * 0.5, ta.size.y * 0.5, ta.size.z * 0.5))
	var ay: Vector3 = xf.basis.y
	var axis: Vector3 = ay.normalized()
	var r0: float = maxf(xf.basis.x.length() * 0.5, 0.05)
	var fwd: Vector3 = (Vector3.BACK - axis * axis.z).normalized()
	var right: Vector3 = axis.cross(fwd)
	var side: Vector3 = xf.basis.x.normalized()
	var fw_t: Vector3 = xf.basis.z.normalized()
	_a0 = snappedf(atan2(fwd.dot(fw_t), fwd.dot(side)), 0.02)
	var d1: Vector3 = fwd * cos(0.1) + right * sin(0.1)
	_sg = 1.0 if angle_difference(atan2(fwd.dot(fw_t), fwd.dot(side)), atan2(d1.dot(fw_t), d1.dot(side))) > 0.0 else -1.0
	_H = ay.length() / r0
	_Hq = maxf(snappedf(_H, 0.5), 2.0)
	_yF = snappedf(_H * (0.42 if _species == "apple" else 0.32), 0.25)
	_sk = "%s_%d_%.1f_%.2f_%d" % [_species, _n, _Hq, _a0, int(_sg)]
	var base: Vector3 = xf.origin - ay * 0.5
	_canopy = _tree.get_node_or_null("Crown") as Node3D
	if _canopy != null:
		_canopy_rest = _canopy.transform.basis
	_rig = Node3D.new(); _rig.name = "Rig"
	_rig.transform = Transform3D(Basis(right, axis, fwd).scaled(Vector3.ONE * r0), base)
	add_child(_rig)
	_eye_col = Color(1.0, 0.42, 0.1) if _cond == "burning" else (Color(1.0, 0.75, 0.3) if _species == "apple" else Color(0.95, 0.6, 0.25))
	var bark: Material = _mat("bark" + _ck())
	var solemn: bool = _species == "pine"
	# ---- face (child at the trunk axis; rotates about it so parts keep hugging the bark)
	_face = Node3D.new(); _face.name = "Face"; _face.position = Vector3(0.0, _yF, 0.0)
	_rig.add_child(_face)
	var org0 := Vector3(0.0, _yF, 0.0)
	_add_mesh(_face, "FaceBark", _cached("face_" + _sk, _build_face_bark.bind(solemn)), bark, Vector3.ZERO)
	_eyes = _add_mesh(_face, "Eyes", _cached("eyes_" + _sk, _build_eyes), null, Vector3.ZERO)
	_eye_material = (_mat("eye") as StandardMaterial3D).duplicate() as StandardMaterial3D
	_eye_material.albedo_color = _eye_col
	_eyes.material_override = _eye_material
	for i in 2:
		var s: float = -1.0 if i == 0 else 1.0
		var lp: Vector3 = _p(s * 0.42, 0.08, 0.0) - org0
		var lid: MeshInstance3D = _add_mesh(_face, "Lid%d" % i, _cached("lid_%s_%d" % [_sk, int(s)], _build_lid.bind(s)), bark, lp)
		_lids.append(lid); _lid_base.append(lp)
		var bp: Vector3 = _p(s * 0.45, 0.36, 0.0) - org0
		var brow: MeshInstance3D = _add_mesh(_face, "Brow%d" % i, _cached("brow_%s_%d" % [_sk, int(s)], _build_brow.bind(s, solemn)), bark, bp)
		_brows.append(brow); _brow_base.append(bp)
	# ---- arms: shoulder knot buried in the trunk, upper arm, elbow knot, forearm, wrist knot, twig fingers
	var y_sh: float = _H * (0.6 if _species == "apple" else 0.55)
	for i in 2:
		var s: float = -1.0 if i == 0 else 1.0
		var phi: float = s * 1.3
		var arm: Node3D = Node3D.new(); arm.name = "Arm%d" % i
		arm.position = _sp(phi, y_sh, -0.12)
		_rig.add_child(arm); _arms.append(arm)
		_arm_yaw.append(atan2(-cos(phi), sin(phi)))
		arm.add_child(_mi("Upper", _cached("arm", _build_arm), bark))
		var fa: Node3D = Node3D.new(); fa.name = "Forearm"
		fa.position = Vector3(1.15, -0.1, 0.0)
		arm.add_child(fa); _forearms.append(fa)
		fa.add_child(_mi("Lower", _cached("forearm", _build_forearm), bark))
	# ---- root feet: hip knot buried in the trunk base, thick root leg, ankle knot, splayed root toes
	var gy: float = -base.y / r0
	_foot_y = gy + 0.32
	for i in 2:
		var s: float = -1.0 if i == 0 else 1.0
		var phi: float = s * 0.62
		var foot: Node3D = Node3D.new(); foot.name = "Foot%d" % i
		foot.position = _sp(phi, _foot_y, -0.15)
		_rig.add_child(foot); _feet.append(foot)
		var yaw: float = atan2(-cos(s * 0.75), sin(s * 0.75))
		_foot_yaw.append(yaw)
		foot.add_child(_mi("Leg", _cached("foot", _build_foot), bark))
		var toe: Node3D = Node3D.new(); toe.name = "Toes"
		toe.position = Vector3(1.1, -0.25, 0.0)
		foot.add_child(toe); _toes.append(toe)
		toe.add_child(_mi("Roots", _cached("toes", _build_toes), bark))
	if _cond == "burning":
		_seams = _make_seams()
		_rig.add_child(_seams)
	var pc: Color = Color(1.0, 0.55, 0.15) if _cond == "burning" else Color(0.9, 1.0, 0.5)
	_pollen = _particles("Pollen", pc, 0.04 * _k, 20, 3.5, 0.25, Vector3(0, 0.1, 0), 0.6)
	_pollen.position = Vector3(0, _H * 1.2, 0)
	_chips = _particles("Chips", Color(0.55, 0.36, 0.2), 0.035 * _k, 10, 0.8, 1.0, Vector3(0, -6.0, 0), 0.05)
	_chips.one_shot = true; _chips.explosiveness = 0.95
	_chips.position = Vector3(0, _yF, 1.0)
	_rig.add_child(_pollen); _rig.add_child(_chips)

func _add_mesh(parent: Node3D, nm: String, mesh: Mesh, mat: Material, pos: Vector3) -> MeshInstance3D:
	var mi: MeshInstance3D = _mi(nm, mesh, mat)
	mi.position = pos
	parent.add_child(mi)
	return mi

func _mi(nm: String, mesh: Mesh, mat: Material) -> MeshInstance3D:
	var mi: MeshInstance3D = MeshInstance3D.new()
	mi.name = nm; mi.mesh = mesh
	if mat != null: mi.material_override = mat
	return mi

func _make_seams() -> MeshInstance3D:
	var s: MeshInstance3D = MeshInstance3D.new()
	s.name = "Seams"
	s.mesh = _cached("seams", _build_seams)
	s.material_override = _mat("seam")
	s.scale = Vector3(1.0, _H, 1.0)
	return s

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
	# rig is scaled by the trunk radius; keep motes world-sized
	p.scale = Vector3.ONE / maxf(_rig.scale.x, 0.01)
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
		if key == "bark_burn":
			m.emission_enabled = true; m.emission = Color(0.6, 0.15, 0.03); m.emission_energy_multiplier = 0.18
	elif key.begins_with("eye"):
		# unshaded: glow comes from albedo_color, which is set per instance
		m.vertex_color_use_as_albedo = true
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
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
		_ctr = 0
		_meshes[key] = f.call()
	return _meshes[key]

# ---------------------------------------------------------------- mesh primitives
func _hash(i: int) -> float:
	return fposmod(sin(float(i) * 12.9898 + 3.1) * 43758.5453, 1.0)

func _jit(col: Color) -> Color:
	_ctr += 1
	var f: float = 0.82 + 0.3 * _hash(_ctr)   # per-facet bark shade variation
	return Color(col.r * f, col.g * f, col.b * f, 1.0)

## One flat triangle. `out` points to the visible side; emitted clockwise as seen from there.
func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, col: Color, out: Vector3) -> void:
	var n: Vector3 = (b - a).cross(c - a)
	if n.length_squared() < 1e-10:
		return
	n = n.normalized()
	if n.dot(out) > 0.0:
		var t: Vector3 = b; b = c; c = t
	else:
		n = -n
	var cc: Color = _jit(col)
	for v: Vector3 in [a, b, c]:
		st.set_color(cc); st.set_normal(n); st.add_vertex(v)

func _begin() -> SurfaceTool:
	var st: SurfaceTool = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	return st

func _end(st: SurfaceTool) -> ArrayMesh:
	return st.commit()

## Tapered tube along a polyline with parallel-transport rings; optional rounded end cap.
func _tube(st: SurfaceTool, pts: Array, radii: Array, sides: int, col: Color, cap_end: bool) -> void:
	var n: int = pts.size()
	var u: Vector3 = Vector3.UP
	var t0: Vector3 = (pts[1] - pts[0]).normalized()
	if absf(t0.dot(u)) > 0.9:
		u = Vector3.BACK
	var rings: Array = []
	var last_t: Vector3 = t0
	for k in n:
		var t: Vector3 = (pts[mini(k + 1, n - 1)] - pts[maxi(k - 1, 0)]).normalized()
		last_t = t
		u = (u - t * u.dot(t)).normalized()
		var v: Vector3 = t.cross(u)
		var ring: Array = []
		for i in sides:
			var a: float = TAU * float(i) / float(sides)
			var rr: float = float(radii[k]) * (1.0 + 0.08 * sin(float(i) * 2.4 + float(k) * 1.3))
			ring.append(pts[k] + (u * cos(a) + v * sin(a)) * rr)
		rings.append(ring)
	for k in n - 1:
		var mid: Vector3 = (pts[k] + pts[k + 1]) * 0.5
		for i in sides:
			var j: int = (i + 1) % sides
			var a: Vector3 = rings[k][i]; var b: Vector3 = rings[k][j]
			var c: Vector3 = rings[k + 1][i]; var d: Vector3 = rings[k + 1][j]
			var out: Vector3 = (a + b + c + d) * 0.25 - mid
			_tri(st, a, c, b, col, out); _tri(st, b, c, d, col, out)
	if cap_end:
		var tip: Vector3 = pts[n - 1] + last_t * float(radii[n - 1]) * 0.7
		for i in sides:
			_tri(st, rings[n - 1][i], tip, rings[n - 1][(i + 1) % sides], col, tip - pts[n - 1])

## Low-poly knobby sphere (6 segments, 3 rings + poles = 36 tris) for joints.
func _knot(st: SurfaceTool, c: Vector3, r: float, col: Color, sq: Vector3 = Vector3.ONE) -> void:
	var segs: int = 6
	var ths: Array[float] = [PI * 0.28, PI * 0.5, PI * 0.72]
	var rings: Array = []
	for k in 3:
		var ring: Array = []
		for i in segs:
			var a: float = TAU * (float(i) + 0.5 * float(k % 2)) / float(segs)
			var j: float = 0.9 + 0.2 * _hash(int(c.x * 31.0) + k * 7 + i)
			ring.append(c + Vector3(sin(ths[k]) * cos(a) * sq.x, cos(ths[k]) * sq.y, sin(ths[k]) * sin(a) * sq.z) * r * j)
		rings.append(ring)
	var top: Vector3 = c + Vector3(0, r * sq.y, 0)
	var bot: Vector3 = c - Vector3(0, r * sq.y, 0)
	for i in segs:
		var j2: int = (i + 1) % segs
		_tri(st, top, rings[0][i], rings[0][j2], col, top - c)
		_tri(st, bot, rings[2][i], rings[2][j2], col, bot - c)
		for k in 2:
			var a: Vector3 = rings[k][i]; var b: Vector3 = rings[k][j2]
			var cc: Vector3 = rings[k + 1][i]; var d: Vector3 = rings[k + 1][j2]
			var o: Vector3 = (a + b + cc + d) * 0.25 - c
			_tri(st, a, cc, b, col, o); _tri(st, b, cc, d, col, o)

## Dome/ring patch on the trunk. prof = [[ring 0..1 (outer->centre), height, shade], ...].
## Vertices are sampled on the polygonal trunk surface so edges sit flush with the bark.
func _disc(st: SurfaceTool, org: Vector3, uc: float, vc: float, ru: float, rv: float, prof: Array, segs: int, rot: float = 0.0) -> void:
	var rings: Array = []
	for pr: Array in prof:
		var ring: Array = []
		var count: int = 1 if float(pr[0]) <= 0.0 else segs
		for i in count:
			var a: float = TAU * float(i) / float(segs)
			var dx: float = cos(a) * ru * float(pr[0])
			var dy: float = sin(a) * rv * float(pr[0])
			var du: float = dx * cos(rot) - dy * sin(rot)
			var dv: float = dx * sin(rot) + dy * cos(rot)
			ring.append(_p(uc + du, vc + dv, float(pr[1])) - org)
		rings.append(ring)
	var out: Vector3 = Vector3(sin(uc), 0.0, cos(uc))
	for k in prof.size() - 1:
		var col: Color = Color(1, 1, 1) * float((prof[k] as Array)[2])
		for i in segs:
			var j: int = (i + 1) % segs
			var a: Vector3 = rings[k][i]; var b: Vector3 = rings[k][j]
			if rings[k + 1].size() == 1:
				_tri(st, a, rings[k + 1][0], b, col, out)
			else:
				var c: Vector3 = rings[k + 1][i]; var d: Vector3 = rings[k + 1][j]
				_tri(st, a, c, b, col, out); _tri(st, b, c, d, col, out)

## Ridge/groove strip along a (u,v) curve. prof = [[cross-section -1..1, height, shade], ...].
func _strip(st: SurfaceTool, org: Vector3, pts: Array, hw: float, prof: Array) -> void:
	var n: int = pts.size()
	var rows: Array = []
	for k in n:
		var t: Vector2 = (pts[mini(k + 1, n - 1)] - pts[maxi(k - 1, 0)]).normalized()
		var nrm: Vector2 = Vector2(-t.y, t.x)
		var taper: float = pow(sin(PI * clampf(float(k) / float(n - 1), 0.03, 0.97)), 0.6)
		var row: Array = []
		for pr: Array in prof:
			var q: Vector2 = pts[k] + nrm * hw * taper * float(pr[0])
			row.append(_p(q.x, q.y, LIP + (float(pr[1]) - LIP) * taper) - org)
		rows.append(row)
	for k in n - 1:
		var out: Vector3 = Vector3(sin(pts[k].x), 0.0, cos(pts[k].x))
		for j in prof.size() - 1:
			var col: Color = Color(1, 1, 1) * float((prof[j] as Array)[2])
			var a: Vector3 = rows[k][j]; var b: Vector3 = rows[k][j + 1]
			var c: Vector3 = rows[k + 1][j]; var d: Vector3 = rows[k + 1][j + 1]
			_tri(st, a, c, b, col, out); _tri(st, b, c, d, col, out)

# ---------------------------------------------------------------- face meshes
## Static face relief in face space: eye sockets (bark rim + recess), nose, cheeks, smile.
func _build_face_bark(solemn: bool) -> ArrayMesh:
	var st: SurfaceTool = _begin()
	var org := Vector3(0.0, _yF, 0.0)
	for s: float in [-1.0, 1.0]:
		_disc(st, org, s * 0.42, 0.08, 0.29, 0.23,
			[[1.0, LIP, 0.5], [0.88, 0.09, 0.9], [0.7, 0.11, 1.05], [0.56, 0.03, 0.4], [0.0, 0.02, 0.3]], 8, -s * 0.1)
		_disc(st, org, s * 0.8, -0.32, 0.18, 0.14, [[1.0, LIP, 1.0], [0.55, 0.08, 1.12], [0.0, 0.1, 1.15]], 8)
	_disc(st, org, 0.0, -0.17, 0.12, 0.22, [[1.0, LIP, 1.0], [0.6, 0.1, 1.05], [0.25, 0.16, 1.1], [0.0, 0.18, 1.1]], 8)
	var curve: float = 0.03 if solemn else 0.13
	var pts: Array = []
	for i in 9:
		var t: float = float(i) / 8.0
		pts.append(Vector2(lerpf(-0.4, 0.4, t), -0.58 - curve * (1.0 - pow(2.0 * t - 1.0, 2.0)) + (0.02 if solemn else 0.0)))
	_strip(st, org, pts, 0.1, [[-1.0, LIP, 1.0], [-0.55, 0.075, 1.05], [-0.2, 0.02, 0.28], [0.2, 0.02, 0.28], [0.55, 0.06, 1.0], [1.0, LIP, 0.95]])
	return _end(st)

## Glowing eyes sunk in the sockets. Vertex colour carries amber rim, cream iris and a dark pupil.
func _build_eyes() -> ArrayMesh:
	var st: SurfaceTool = _begin()
	var org := Vector3(0.0, _yF, 0.0)
	for s: float in [-1.0, 1.0]:
		_disc(st, org, s * 0.42, 0.08, 0.165, 0.125,
			[[1.0, 0.035, 0.85], [0.75, 0.055, 1.0], [0.35, 0.065, 1.15], [0.0, 0.07, 1.2]], 8)
		_disc(st, org, s * 0.42, 0.08, 0.06, 0.085, [[1.0, 0.072, 0.12], [0.0, 0.078, 0.1]], 6)
	return _end(st)

## Upper eyelid: a bark ellipse pivoting at the eye centre; the node slides it up (open) / down (shut).
func _build_lid(s: float) -> ArrayMesh:
	var st: SurfaceTool = _begin()
	var uc: float = s * 0.42
	var org: Vector3 = _p(uc, 0.08, 0.0)
	_disc(st, org, uc, 0.08, 0.26, 0.17, [[1.0, LIP, 0.8], [0.8, 0.09, 1.0], [0.4, 0.115, 1.1], [0.0, 0.12, 1.1]], 8)
	return _end(st)

## Brow ridge: arched strip that starts and ends flush with the bark. Kind = outer end raised, solemn = stern.
func _build_brow(s: float, solemn: bool) -> ArrayMesh:
	var st: SurfaceTool = _begin()
	var uc: float = s * 0.45
	var org: Vector3 = _p(uc, 0.36, 0.0)
	var pts: Array = []
	for i in 7:
		var t: float = float(i) / 6.0   # inner -> outer
		var arch: float = 0.07 * sin(PI * t)
		var tilt: float = (-0.05 * (1.0 - t) if solemn else 0.05 * t)
		pts.append(Vector2(s * (0.1 + 0.7 * t), 0.36 + arch + tilt))
	_strip(st, org, pts, 0.1, [[-1.0, LIP, 0.9], [-0.55, 0.09, 1.05], [0.0, 0.125, 1.15], [0.55, 0.09, 1.05], [1.0, LIP, 0.9]])
	return _end(st)

# ---------------------------------------------------------------- limb meshes (rig units, built along +X)
func _build_arm() -> ArrayMesh:
	var st: SurfaceTool = _begin()
	var c := Color(1, 1, 1)
	_knot(st, Vector3.ZERO, 0.36, c, Vector3(1, 0.95, 1))
	_tube(st, [Vector3(0, 0, 0), Vector3(0.55, -0.06, 0.05), Vector3(1.15, -0.1, 0)], [0.25, 0.21, 0.18], 6, c, false)
	_knot(st, Vector3(1.15, -0.1, 0), 0.27, c * 0.92)
	# little side twig makes it read as a branch, not a pipe
	_tube(st, [Vector3(0.55, 0.06, 0.02), Vector3(0.68, 0.24, 0.1), Vector3(0.8, 0.42, 0.16)], [0.07, 0.05, 0.025], 4, c * 1.05, true)
	return _end(st)

func _build_forearm() -> ArrayMesh:
	var st: SurfaceTool = _begin()
	var c := Color(1, 1, 1)
	_tube(st, [Vector3(0, 0, 0), Vector3(0.5, 0.02, 0.04), Vector3(1.0, 0.05, 0)], [0.17, 0.13, 0.1], 6, c, true)
	var w := Vector3(1.0, 0.05, 0)
	_knot(st, w, 0.13, c * 0.95)
	for f: Array in [[0.5, 0.05, 0.05], [0.0, 0.12, 0.04], [-0.5, 0.0, 0.05]]:
		var d := Vector3(cos(float(f[0])) * 1.0, float(f[2]) * -1.0 + float(f[1]) * 0.0, sin(float(f[0])) * 1.0).normalized()
		var curl := Vector3(0, float(f[1]), 0)
		_tube(st, [w, w + d * 0.22 + curl * 0.6, w + d * 0.42 + curl * 1.6], [0.05, 0.035, 0.012], 3, c, true)
	return _end(st)

func _build_foot() -> ArrayMesh:
	var st: SurfaceTool = _begin()
	var c := Color(1, 1, 1)
	_knot(st, Vector3.ZERO, 0.36, c, Vector3(1, 0.95, 1))
	_tube(st, [Vector3(0, 0, 0), Vector3(0.6, -0.14, 0), Vector3(1.1, -0.25, 0)], [0.3, 0.27, 0.23], 6, c, false)
	_knot(st, Vector3(1.1, -0.25, 0), 0.26, c * 0.9, Vector3(1.1, 0.8, 1))
	return _end(st)

func _build_toes() -> ArrayMesh:
	var st: SurfaceTool = _begin()
	var c := Color(1, 1, 1)
	for a: float in [0.55, 0.0, -0.55]:
		var d := Vector3(cos(a), -0.05, sin(a))
		var len: float = 0.72 if a == 0.0 else 0.6
		_tube(st, [Vector3(0.05, 0, 0), d * len * 0.5 + Vector3(0, 0.03, 0), d * len + Vector3(0, -0.05, 0)], [0.15, 0.11, 0.035], 4, c, true)
	return _end(st)

func _build_seams() -> ArrayMesh:
	var st: SurfaceTool = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for a0: float in [0.6, 2.4, 4.0, 5.3]:
		var prev: Vector3 = Vector3.ZERO
		for k in 6:
			var a: float = a0 + sin(float(k) * 2.3 + a0) * 0.18
			var y: float = 0.05 + 0.14 * float(k)
			var rad: float = 0.97 * (1.0 - 0.5 * y)   # follow trunk taper (unit height space)
			var p: Vector3 = Vector3(cos(a) * rad, y, sin(a) * rad)
			if k > 0:
				var t: Vector3 = Vector3(-sin(a), 0, cos(a)) * 0.05 * (1.0 - float(k) / 7.0)
				for v: Vector3 in [prev - t, p + t, p - t, prev - t, prev + t, p + t]:
					st.set_color(Color.WHITE)
					st.add_vertex(v)
			prev = p
	st.generate_normals()
	return st.commit()
