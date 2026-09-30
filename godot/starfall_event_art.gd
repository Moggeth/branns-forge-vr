extends Node3D
## Bounded Starfall presentation adapter. Purely visual: subscribes to a
## meteor's `visual_event(payload)`, never touches its state, colliders or terrain.
## 6 slots share 4 MultiMeshes (glow quads, glow spikes, earth chips, dust) and
## 2 shadowless warm lights. No per-particle nodes, no physics, no GPUParticles.
## Runs in world space (top_level, identity) so it can be parented anywhere.
##
## Host: setup(game); watch_meteor(m) per meteor; tick(delta) each frame
## (or set auto_tick = true). Optional: set_zone(center, radius), cull_distance,
## and owner_game.terrain_height_at(Vector3) -> float for real-surface chips.

signal sound_requested(kind: String, position: Vector3, strength: float)
signal haptic_requested(position: Vector3, strength: float, duration: float)

const SLOTS := 6
const GQ := 56   # glow quads per slot
const SP := 40   # glow spikes per slot
const CH := 20   # chips per slot
const DU := 14   # dust puffs per slot
const IMPACT_LIFE := 6.0
const HEAT_SECONDS := 3.8
const GRAVITY := 9.8
const MAX_LIGHT_ENERGY := 5.0

var auto_tick := false
var cull_distance := 90.0
var owner_game: Node3D
var zone_center := Vector3.ZERO
var zone_radius := INF

var _slots: Array[Dictionary] = []
var _gq: MultiMesh
var _sp: MultiMesh
var _ch: MultiMesh
var _du: MultiMesh
var _lights: Array[OmniLight3D] = []
var _light_owner: Array[int] = [-1, -1]
var _park := Vector3(0, -500, 0)
var _watched: Dictionary = {}

static var _glow_shader: Shader
static var _dust_shader: Shader
static var _spike_mesh: ArrayMesh
static var _chip_mesh: ArrayMesh

const _GLOW_CODE := """
shader_type spatial;
render_mode blend_add, unshaded, depth_draw_never, cull_disabled, fog_disabled;
uniform bool billboard = false;
uniform float energy = 1.6;
void vertex() {
	if (billboard) {
		mat4 mv = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
		mv = mv * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0), vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, length(MODEL_MATRIX[2].xyz), 0.0), vec4(0.0, 0.0, 0.0, 1.0));
		MODELVIEW_MATRIX = mv;
	}
}
void fragment() {
	float m = 1.0;
	if (billboard) {
		float d = length(UV * 2.0 - 1.0);
		m = pow(clamp(1.0 - d, 0.0, 1.0), 2.0);
	}
	ALBEDO = COLOR.rgb * COLOR.a * m * energy;
	ALPHA = 1.0;
}
"""

const _DUST_CODE := """
shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_never, specular_disabled, fog_disabled;
void vertex() {
	mat4 mv = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	mv = mv * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0), vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, length(MODEL_MATRIX[2].xyz), 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	MODELVIEW_MATRIX = mv;
}
void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float ang = atan(p.y, p.x);
	float d = length(p) * (1.0 + 0.22 * sin(ang * 3.0 + COLOR.r * 23.0) + 0.12 * sin(ang * 7.0 + COLOR.g * 31.0));
	float m = smoothstep(1.0, 0.15, d);
	ALBEDO = COLOR.rgb * (0.8 + 0.2 * m);
	ROUGHNESS = 1.0;
	ALPHA = COLOR.a * m;
}
"""

func setup(owner_game_node: Node3D) -> void:
	owner_game = owner_game_node
	top_level = true
	global_transform = Transform3D.IDENTITY
	if get_parent() == null and owner_game != null:
		owner_game.add_child(self)
	if not _slots.is_empty(): return
	_build_pools()
	for i in SLOTS:
		_slots.append({"state": 0, "mid": 0, "age": 0.0, "reveal": -1.0, "seed": 0, "ground": Vector3.ZERO,
			"prev": Vector3.ZERO, "tdir": Vector3.UP, "progress": 0.0, "stale": 0.0, "lite": false,
			"rnd": PackedFloat32Array(), "hidden": true, "started": 0.0})
	set_process(false)

func set_zone(center: Vector3, radius: float) -> void:
	zone_center = center
	zone_radius = radius

func active_slots() -> int:
	var n := 0
	for s in _slots:
		if s.state != 0: n += 1
	return n

func watch_meteor(meteor: Node3D) -> void:
	if meteor == null or not meteor.has_signal("visual_event"): return
	var id := meteor.get_instance_id()
	if _watched.has(id): return
	_watched[id] = true
	meteor.visual_event.connect(_on_visual_event.bind(meteor))
	meteor.tree_exiting.connect(func() -> void: _forget(id), CONNECT_ONE_SHOT)

func clear() -> void:
	for s in _slots: _release(s)

func _forget(id: int) -> void:
	_watched.erase(id)
	for s in _slots:
		if s.mid == id: _release(s)

func _exit_tree() -> void:
	clear()

func _process(delta: float) -> void:
	tick(delta)

# --- events ---------------------------------------------------------------

func _on_visual_event(payload: Dictionary, meteor: Node3D) -> void:
	if _slots.is_empty() or not is_instance_valid(meteor): return
	var phase := String(payload.get("phase", ""))
	var s := _slot_for(meteor, phase == "descent" or phase == "impact")
	if s.is_empty(): return
	s.stale = 0.0
	match phase:
		"descent":
			if s.state != 1:
				_start(s, meteor, int(payload.get("seed", 0)), 1)
				sound_requested.emit("entry", meteor.global_position + Vector3.UP * 24.0, 0.7)
			s.progress = float(payload.get("progress", 0.0))
		"impact":
			if s.state != 2:
				if s.state == 0: _start(s, meteor, int(payload.get("seed", 0)), 2)
				s.state = 2
				s.age = 0.0
				s.hidden = false
				_hide_slot(s)
				s.ground = meteor.global_position
				_assign_light(s)
				for gem in _gems(meteor): gem.set_instance_shader_parameter("heat", 1.0)
				sound_requested.emit("impact", s.ground, 1.0)
				haptic_requested.emit(s.ground, 1.0, 0.18)
		"crystal_reveal":
			if s.state == 2 and s.reveal < 0.0:
				s.reveal = 0.0
				sound_requested.emit("crystal_chime", s.ground + Vector3.UP, 0.6)
		_:
			pass

func _slot_for(meteor: Node3D, allow_new: bool) -> Dictionary:
	var id := meteor.get_instance_id()
	for s in _slots:
		if s.state != 0 and s.mid == id: return s
	if not allow_new: return {}
	for s in _slots:
		if s.state == 0: return s
	# all busy: steal the oldest impact slot (extras run in lite mode)
	var oldest: Dictionary = _slots[0]
	for s in _slots:
		if s.state == 2 and (oldest.state != 2 or s.age > oldest.age): oldest = s
		elif s.state == 1 and oldest.state == 1 and s.started < oldest.started: oldest = s
	_release(oldest)
	oldest.lite = true
	return oldest

func _start(s: Dictionary, meteor: Node3D, seed_value: int, state: int) -> void:
	var lite: bool = s.lite
	_hide_slot(s)
	s.state = state
	s.mid = meteor.get_instance_id()
	s.seed = seed_value
	s.age = 0.0
	s.reveal = -1.0
	s.progress = 0.0
	s.stale = 0.0
	s.lite = lite
	s.hidden = false
	s.ground = meteor.global_position
	s.prev = _head(meteor)
	s.tdir = Vector3.UP
	s.started = Time.get_ticks_msec() / 1000.0
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value * 2654435761 + 17
	var r := PackedFloat32Array()
	r.resize(256)
	for i in 256: r[i] = rng.randf()
	s.rnd = r
	_assign_light(s)

func _release(s: Dictionary) -> void:
	if s.state != 0 or not s.hidden:
		_hide_slot(s)
	var index := _slots.find(s)
	for i in _light_owner.size():
		if _light_owner[i] == index:
			_light_owner[i] = -1
			_lights[i].visible = false
	for gem in _gems(instance_from_id(s.mid) as Node3D): gem.set_instance_shader_parameter("heat", 0.0)
	s.state = 0
	s.mid = 0
	s.lite = false

# --- per-frame ------------------------------------------------------------

func tick(delta: float) -> void:
	if _slots.is_empty(): return
	delta = clampf(delta, 0.0, 0.1)
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	for i in _slots.size():
		var s: Dictionary = _slots[i]
		if s.state == 0: continue
		var meteor := instance_from_id(s.mid) as Node3D
		if meteor == null or not is_instance_valid(meteor):
			_release(s)
			continue
		var culled := false
		var at: Vector3 = s.ground
		if cam != null and cam.global_position.distance_to(at) > cull_distance: culled = true
		if zone_radius < INF and Vector2(at.x - zone_center.x, at.z - zone_center.z).length() > zone_radius: culled = true
		if s.state == 1:
			s.stale += delta
			if s.stale > 3.0:
				_release(s)
				continue
			if culled:
				if not s.hidden: _hide_slot(s)
			else:
				_draw_descent(i, s, meteor)
		else:
			s.age += delta
			if s.reveal >= 0.0: s.reveal += delta
			if s.age >= IMPACT_LIFE:
				_release(s)
				continue
			_update_heat(s, meteor)
			if culled:
				if not s.hidden: _hide_slot(s)
			else:
				_draw_impact(i, s)
		_update_light(i, s)

func _head(meteor: Node3D) -> Vector3:
	if "core" in meteor and meteor.core is Node3D and is_instance_valid(meteor.core):
		return meteor.core.global_position
	return meteor.global_position

func _gems(meteor: Node3D) -> Array:
	if meteor == null or not is_instance_valid(meteor) or not ("gems" in meteor): return []
	return meteor.gems

func _update_heat(s: Dictionary, meteor: Node3D) -> void:
	var r: float = s.reveal if s.reveal >= 0.0 else 0.0
	var heat := 1.0 - smoothstep(0.0, HEAT_SECONDS, r)
	if s.reveal < 0.0: heat = 1.0
	for gem in _gems(meteor): gem.set_instance_shader_parameter("heat", heat)

func _rn(s: Dictionary, i: int, k: int = 0) -> float:
	return s.rnd[(i * 7 + k * 31) & 255]

# --- drawing --------------------------------------------------------------

func _draw_descent(index: int, s: Dictionary, meteor: Node3D) -> void:
	s.hidden = false
	var head := _head(meteor)
	var move: Vector3 = s.prev - head
	if move.length() > 0.001: s.tdir = (s.tdir as Vector3).lerp(move.normalized(), 0.35).normalized()
	s.prev = head
	var tdir: Vector3 = s.tdir
	var p: float = s.progress
	var heat := smoothstep(0.0, 0.3, p)
	var t := Time.get_ticks_msec() / 1000.0
	var gb := index * GQ
	var sb := index * SP
	var side := tdir.cross(Vector3.RIGHT if absf(tdir.x) < 0.9 else Vector3.FORWARD).normalized()
	var side2 := tdir.cross(side)
	_quad(gb, head, 2.0 + 0.6 * heat, Color(1.0, 0.93, 0.78, heat))
	_quad(gb + 1, head, 4.6 + 1.6 * heat, Color(1.0, 0.42, 0.1, 0.55 * heat))
	for f in 2:
		var ang := t * 7.0 + f * PI + _rn(s, f)
		var off := (side * cos(ang) + side2 * sin(ang)) * (1.5 + 0.3 * f) - tdir * 0.5
		_quad(gb + 2 + f, head + off, 0.7, Color(1.0, 0.78, 0.4, heat))
	for k in 14:
		var d := 1.2 + k * 1.05
		var wob := (side * sin(t * 9.0 + k * 1.7 + _rn(s, k, 2) * 6.0) + side2 * cos(t * 7.0 + k * 2.3)) * 0.1 * d
		var f := float(k) / 13.0
		var col := Color(1.0, 0.56, 0.16).lerp(Color(0.55, 0.14, 0.42), clampf(f + (_rn(s, k, 5) - 0.5) * 0.3, 0.0, 1.0))
		col.a = (1.0 - f) * (0.45 + 0.4 * _rn(s, k, 6)) * heat
		var jit := (0.55 + 0.9 * _rn(s, k, 7)) * (1.25 if k % 3 == 0 else 0.8)
		_quad(gb + 4 + k, head + tdir * d + wob + (side * (_rn(s, k, 8) - 0.5) + side2 * (_rn(s, k, 9) - 0.5)) * 0.5,
			lerpf(2.1, 0.5, f) * (0.6 + 0.4 * heat) * jit, col)
	_quad(gb + 18, head, 0.0, Color(0, 0, 0, 0))
	for k in 24: _quad(gb + 19 + k, head + tdir * (0.6 + 8.0 * fmod(t * 1.7 + _rn(s, k), 1.0)) + (side * (_rn(s, k, 3) - 0.5) + side2 * (_rn(s, k, 4) - 0.5)) * 1.4,
		0.12, Color(1.0, 0.7, 0.3, heat * (1.0 - fmod(t * 1.7 + _rn(s, k), 1.0)) * 0.9))
	for k in 12: _quad(gb + 43 + k, head, 0.0, Color(0, 0, 0, 0))
	_spike(sb, head, tdir, (7.0 + 9.0 * p) * heat, 0.34, Color(1.0, 0.68, 0.32, 0.8 * heat))
	_spike(sb + 1, head, (tdir + side * 0.07).normalized(), 10.0 * heat, 0.28, Color(1.0, 0.5, 0.15, 0.8 * heat))
	_spike(sb + 2, head, (tdir - side2 * 0.07).normalized(), 9.0 * heat, 0.28, Color(0.9, 0.35, 0.45, 0.7 * heat))

func _draw_impact(index: int, s: Dictionary) -> void:
	var e: float = s.age
	var g: Vector3 = s.ground
	var gb := index * GQ
	var sb := index * SP
	var cb := index * CH
	var db := index * DU
	var up := Vector3.UP
	var lite: bool = s.lite
	# trail and descent remnants
	for k in 4: _quad(gb + k, g, 0.0, Color(0, 0, 0, 0))
	for k in 14: _quad(gb + 4 + k, g, 0.0, Color(0, 0, 0, 0))
	# flash (small, ~0.15 s)
	var fk := clampf(1.0 - e / 0.12, 0.0, 1.0)
	_quad(gb + 18, g + up * 0.7, 2.4 * (0.6 + 0.4 * fk), Color(1.0, 0.88, 0.66, fk * fk * 0.85))
	# angular spall: short, fat, irregular fragments (not long rays)
	for i in 14:
		var a := TAU * i / 14.0 + _rn(s, i) * 0.9
		var h := Vector3(cos(a), 0.0, sin(a))
		var dir := (h + up * (0.25 + 0.6 * _rn(s, i, 1))).normalized()
		var burst_len := (0.5 + 1.1 * _rn(s, i, 2)) * (1.0 - exp(-e * 12.0))
		var k := pow(clampf(1.0 - e / (0.22 + 0.25 * _rn(s, i, 4)), 0.0, 1.0), 1.3)
		if lite and i % 2 == 1: k = 0.0
		var col := Color(1.0, 0.85, 0.6).lerp(Color(0.85, 0.42, 0.14), clampf(e / 0.3, 0.0, 1.0))
		col.a = k * 0.8
		_spike(sb + 3 + i, g + h * (0.5 + e * 3.0 * (0.4 + _rn(s, i, 5))) + up * 0.2, dir, burst_len, (0.22 + 0.25 * _rn(s, i, 3)) * k, col)
	# ring of jagged segments
	var ring_r := 0.8 + 4.2 * (1.0 - exp(-e * 4.0))
	var rk := clampf(1.0 - e / 0.9, 0.0, 1.0)
	for j in 12:
		var b := TAU * (j + _rn(s, j, 4) * 0.8) / 12.0
		var rj := ring_r * (0.7 + 0.5 * _rn(s, j, 5))
		var p := g + Vector3(cos(b), 0.0, sin(b)) * rj + up * (0.1 + 0.08 * _rn(s, j, 5))
		var tangent := Vector3(-sin(b + 0.5 * (_rn(s, j, 6) - 0.5)), 0.05 * (_rn(s, j, 7) - 0.5), cos(b + 0.5 * (_rn(s, j, 6) - 0.5)))
		var col := Color(0.9, 0.55, 0.28, rk * rk * (0.12 + 0.2 * _rn(s, j, 7)))
		if _rn(s, j, 9) > 0.65 or (lite and j % 2 == 1): col.a = 0.0
		_spike(sb + 17 + j, p - tangent * rj * 0.09, tangent, rj * (0.12 + 0.2 * _rn(s, j, 8)), 0.12, col)
	# lingering ground fractures: amber to crystal cyan
	var fe := smoothstep(1.0, 3.0, e)
	var fk2 := clampf(1.0 - (e - 0.2) / 1.2, 0.0, 1.0)
	for i in 10:
		var c := TAU * (i + _rn(s, i, 8) * 0.9) / 10.0
		var dir := Vector3(cos(c), 0.0, sin(c))
		var flen := (0.4 + 0.9 * _rn(s, i, 9)) * (1.0 - exp(-e * 8.0))
		var col := Color(0.9, 0.42, 0.12).lerp(Color(0.3, 0.65, 0.9), fe * 0.5)
		col.a = fk2 * 0.4
		if lite or _rn(s, i, 10) > 0.7: col.a = 0.0
		_spike(sb + 29 + i, g + dir * (0.8 + 1.8 * _rn(s, i, 12)) + up * 0.06, dir + Vector3(0, 0.3, 0), flen, 0.1, col)
	_spike(sb + 39, g, up, 0.0, 0.0, Color(0, 0, 0, 0))
	# sparks
	for i in 24:
		var a := _rn(s, i, 10) * TAU
		var v := Vector3(cos(a), 0.0, sin(a)) * (3.0 + 7.0 * _rn(s, i, 11)) + up * (4.0 + 7.0 * _rn(s, i, 12))
		var life := 0.6 + 1.0 * _rn(s, i, 13)
		var pos := g + up * 0.3 + v * e - up * (0.5 * GRAVITY * e * e)
		var k := clampf(1.0 - e / life, 0.0, 1.0)
		if pos.y < g.y or (lite and i > 11): k = 0.0
		_quad(gb + 19 + i, pos, 0.18 * (0.4 + k), Color(1.0, 0.6, 0.2).lerp(Color(1.0, 0.25, 0.08), 1.0 - k) * Color(1, 1, 1, k))
	# reveal motes: cool crystal dust drifting off the meteor
	var r: float = s.reveal
	for i in 12:
		var mote_col := Color(0, 0, 0, 0)
		var pos := g
		if r >= 0.0 and not (lite and i > 5):
			var a := TAU * i / 12.0 + r * 0.5
			var rad := 1.4 + 0.3 * sin(r * 2.0 + i)
			pos = g + Vector3(cos(a) * rad, 0.6 + 0.5 * r + 0.3 * _rn(s, i, 14), sin(a) * rad)
			mote_col = Color(0.3, 0.85, 1.0).lerp(Color(0.7, 0.4, 1.0), _rn(s, i, 15))
			mote_col.a = smoothstep(0.0, 0.4, r) * (1.0 - smoothstep(2.5, 4.5, r)) * 0.9
		_quad(gb + 43 + i, pos, 0.14, mote_col)
	_quad(gb + 55, g, 0.0, Color(0, 0, 0, 0))
	# earth chips
	for i in CH:
		var a := TAU * (i + _rn(s, i, 16)) / CH
		var h := Vector3(cos(a), 0.0, sin(a))
		var v := h * (2.5 + 5.5 * _rn(s, i, 17)) + up * (3.5 + 5.0 * _rn(s, i, 18))
		var start := g + h * (0.6 + 1.8 * _rn(s, i, 19)) + up * 0.1
		var land := (v.y + sqrt(v.y * v.y + 2.0 * GRAVITY * 0.1)) / GRAVITY
		var tt := minf(e, land)
		var pos := start + v * tt - up * (0.5 * GRAVITY * tt * tt)
		if e >= land: pos.y = _ground_y(pos, g.y) + 0.05
		var size := (0.1 + 0.16 * _rn(s, i, 20)) * (1.0 - smoothstep(3.0, 3.8, e))
		if lite and i > 9: size = 0.0
		var spin := Vector3(_rn(s, i, 21) - 0.5, _rn(s, i, 22) - 0.5, _rn(s, i, 23) - 0.5).normalized()
		var basis := Basis(spin, tt * (4.0 + 8.0 * _rn(s, i, 24))).scaled(Vector3(size, size * 0.7, size))
		var col := Color(0.38, 0.27, 0.18).lerp(Color(0.62, 0.5, 0.38), _rn(s, i, 25))
		if _rn(s, i, 26) > 0.8: col = Color(0.12, 0.12, 0.15)
		_ch.set_instance_transform(cb + i, Transform3D(basis, pos))
		_ch.set_instance_color(cb + i, col)
	# dust: fast earthy pressure burst, then staggered settling
	for i in DU:
		var a := TAU * (i + _rn(s, i, 27) * 0.7) / DU
		var delay := 0.02 + 0.5 * _rn(s, i, 28) * _rn(s, i, 28)
		var t := maxf(e - delay, 0.0)
		var spread := 1.0 + (2.2 + 3.0 * _rn(s, i, 29)) * (1.0 - exp(-t * 3.2))
		var rise := 0.3 + 0.6 * _rn(s, i, 30) + 0.35 * minf(t, 1.2) - 0.3 * maxf(t - 1.5, 0.0)
		var size := 1.3 + 2.8 * (1.0 - exp(-t * 2.0))
		var life := 3.2 + 2.4 * _rn(s, i, 32)
		var pos := g + Vector3(cos(a), 0.0, sin(a)) * spread + up * (maxf(rise, 0.15) + size * 0.3)
		var alpha := 0.55 * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(life * 0.35, life, t))
		if lite and i > 6: alpha = 0.0
		_du.set_instance_transform(db + i, Transform3D(Basis.from_scale(Vector3.ONE * size), pos))
		_du.set_instance_color(db + i, Color(lerpf(0.5, 0.36, _rn(s, i, 31)), lerpf(0.38, 0.28, _rn(s, i, 31)), 0.2 + 0.04 * _rn(s, i, 33), alpha))

func _ground_y(pos: Vector3, fallback: float) -> float:
	if owner_game != null and owner_game.has_method("terrain_height_at"):
		var y = owner_game.terrain_height_at(pos)
		if y is float and is_finite(y): return y
	return fallback

func _assign_light(s: Dictionary) -> void:
	var index := _slots.find(s)
	# Keep one representative light per selected event through descent/impact.
	if _light_owner.has(index): return
	var pick := -1
	for i in _lights.size():
		if _light_owner[i] == -1: pick = i; break
	if pick == -1:
		# take the light whose slot is oldest
		var oldest := -1.0
		for i in _lights.size():
			var owner_slot: Dictionary = _slots[_light_owner[i]]
			if owner_slot.age > oldest: oldest = owner_slot.age; pick = i
	_light_owner[pick] = index
	_lights[pick].visible = true

func _update_light(index: int, s: Dictionary) -> void:
	for i in _lights.size():
		if _light_owner[i] != index: continue
		var l := _lights[i]
		if s.hidden:
			l.visible = false
			continue
		if s.state == 1:
			var meteor:=instance_from_id(s.mid) as Node3D
			if not is_instance_valid(meteor): l.visible=false; continue
			l.global_position=_head(meteor)
			l.light_color=Color(1.0,0.55,0.18)
			l.light_energy=2.6+0.8*s.progress
			l.visible=true
			continue
		if s.state != 2:
			l.visible = false
			continue
		var e: float = s.age
		var flash := pow(clampf(1.0 - e / 0.35, 0.0, 1.0), 2.0)
		var r: float = maxf(s.reveal, 0.0)
		var afterglow := (1.0 - smoothstep(0.3, 3.5, e)) * 0.25
		l.light_energy = MAX_LIGHT_ENERGY * flash + afterglow * MAX_LIGHT_ENERGY
		l.light_color = Color(1.0, 0.62, 0.28).lerp(Color(0.4, 0.8, 1.0), smoothstep(0.1, 2.5, r))
		l.global_position = s.ground + Vector3.UP * 1.3
		l.visible = l.light_energy > 0.02

# --- pools ----------------------------------------------------------------

func _hide_slot(s: Dictionary) -> void:
	var index := _slots.find(s)
	if index < 0: return
	var zero := Transform3D(Basis.from_scale(Vector3.ZERO), s.ground if s.state != 0 else _park)
	var clear := Color(0, 0, 0, 0)
	for i in GQ:
		_gq.set_instance_transform(index * GQ + i, zero)
		_gq.set_instance_color(index * GQ + i, clear)
	for i in SP:
		_sp.set_instance_transform(index * SP + i, zero)
		_sp.set_instance_color(index * SP + i, clear)
	for i in CH: _ch.set_instance_transform(index * CH + i, zero)
	for i in DU: _du.set_instance_transform(index * DU + i, zero)
	s.hidden = true

func _quad(idx: int, pos: Vector3, size: float, col: Color) -> void:
	_gq.set_instance_transform(idx, Transform3D(Basis.from_scale(Vector3.ONE * size), pos))
	_gq.set_instance_color(idx, col)

func _spike(idx: int, pos: Vector3, dir: Vector3, length: float, width: float, col: Color) -> void:
	dir = dir.normalized()
	var x := Vector3.UP.cross(dir)
	if x.length_squared() < 0.001: x = Vector3.RIGHT
	x = x.normalized()
	var y := dir.cross(x)
	_sp.set_instance_transform(idx, Transform3D(Basis(x * width, y * width, dir * length), pos))
	_sp.set_instance_color(idx, col)

func _build_pools() -> void:
	if _glow_shader == null:
		_glow_shader = Shader.new(); _glow_shader.code = _GLOW_CODE
		_dust_shader = Shader.new(); _dust_shader.code = _DUST_CODE
		_spike_mesh = _make_spike()
		_chip_mesh = _make_chip()
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE
	var qm := ShaderMaterial.new(); qm.shader = _glow_shader
	qm.set_shader_parameter("billboard", true)
	quad.material = qm
	var sm := ShaderMaterial.new(); sm.shader = _glow_shader
	sm.set_shader_parameter("billboard", false)
	sm.set_shader_parameter("energy", 2.2)
	var spike_mesh: ArrayMesh = _spike_mesh
	spike_mesh.surface_set_material(0, sm)
	var dust_quad := QuadMesh.new()
	dust_quad.size = Vector2.ONE
	var dm := ShaderMaterial.new(); dm.shader = _dust_shader
	dust_quad.material = dm
	_gq = _make_multimesh(quad, SLOTS * GQ, true)
	_sp = _make_multimesh(spike_mesh, SLOTS * SP, true)
	_ch = _make_multimesh(_chip_mesh, SLOTS * CH, true)
	_du = _make_multimesh(dust_quad, SLOTS * DU, true)
	for mm in [_gq, _sp, _ch, _du]:
		var node := MultiMeshInstance3D.new()
		node.multimesh = mm
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(node)
		node.extra_cull_margin = 200.0
	for i in 2:
		var l := OmniLight3D.new()
		l.omni_range = 14.0
		l.shadow_enabled = false
		l.light_color = Color(1.0, 0.62, 0.28)
		l.light_energy = 0.0
		l.visible = false
		add_child(l)
		_lights.append(l)
	var zero := Transform3D(Basis.from_scale(Vector3.ZERO), _park)
	for mm in [_gq, _sp, _ch, _du]:
		for i in mm.instance_count:
			mm.set_instance_transform(i, zero)

func _make_multimesh(mesh: Mesh, count: int, colors: bool) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.mesh = mesh
	mm.instance_count = count
	return mm

func _make_spike() -> ArrayMesh:
	# two crossed diamonds along +Z; vertex colour a = brightness ramp along length
	var v := PackedVector3Array()
	var c := PackedColorArray()
	for plane in 2:
		var w := Vector3(1, 0, 0) if plane == 0 else Vector3(0, 1, 0)
		var tail := Vector3.ZERO
		var mid := Vector3(0, 0, 0.3)
		var head := Vector3(0, 0, 1)
		for tri in [[tail, mid + w, mid - w, 0.0, 1.0, 1.0], [mid + w, head, mid - w, 1.0, 0.3, 1.0]]:
			for i in 3:
				v.append(tri[i])
				c.append(Color(1, 1, 1, tri[3 + i]))
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = v
	arrays[Mesh.ARRAY_COLOR] = c
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh

func _make_chip() -> ArrayMesh:
	var p := [Vector3(1, 0.1, 0.2), Vector3(-0.6, 0.8, 0.3), Vector3(-0.3, -0.5, 0.9), Vector3(-0.2, -0.3, -1.0)]
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var centre: Vector3 = (p[0] + p[1] + p[2] + p[3]) * 0.25
	for f in [[0, 1, 2], [0, 3, 1], [1, 3, 2], [0, 2, 3]]:
		var a: Vector3 = p[f[0]]; var b: Vector3 = p[f[1]]; var d: Vector3 = p[f[2]]
		var normal := (b - a).cross(d - a).normalized()
		var order := [a, d, b]
		if normal.dot((a + b + d) / 3.0 - centre) < 0.0:
			normal = -normal
			order = [a, b, d]
		for q in order:
			v.append(q); n.append(normal); c.append(Color.WHITE)
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = v
	arrays[Mesh.ARRAY_NORMAL] = n
	arrays[Mesh.ARRAY_COLOR] = c
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.9
	mesh.surface_set_material(0, mat)
	return mesh
