extends Node3D
## One shared material response, with bounded MultiMesh debris and spatial voices.
## Physics, damage and controller tracking stay in their authoritative systems.
const CAPACITY := 96
const MAX_MARKS := 72
const MATERIALS := ["stone", "wood", "bone", "metal", "flesh", "glass"]
var game
var pools: Dictionary = {}
var voices: Array[AudioStreamPlayer3D] = []
var sounds: Dictionary = {}
var marks: Array[Dictionary] = []
var recent: Dictionary = {}
var voice_cursor := 0
var sequence := 0
var emitted := 0
var dropped := 0
var rng := RandomNumberGenerator.new()
var art
var stats := {"active": 0, "draw_calls": 0, "update_usec": 0}

func setup(owner_game) -> void:
	game = owner_game
	name = "MaterialImpactFeedback"
	rng.seed = 612731
	if ResourceLoader.exists("res://surface_impact_art.gd"):
		art = load("res://surface_impact_art.gd")
		var profiles: Dictionary = art.profiles()
		for material in profiles:
			var index := 0
			for spec in profiles[material]:
				var multi := MultiMesh.new()
				multi.transform_format = MultiMesh.TRANSFORM_3D
				multi.use_colors = true
				multi.mesh = spec.mesh
				multi.instance_count = CAPACITY
				multi.visible_instance_count = 0
				var node := MultiMeshInstance3D.new()
				node.multimesh = multi
				node.material_override = spec.material
				node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				node.name = "%s_%s_%d" % [material, spec.kind, index]
				add_child(node)
				pools[node.name] = {"node": node, "multi": multi, "spec": spec, "material": material, "particles": []}
				index += 1
	for material in MATERIALS:
		sounds[material] = []
		for variant in 3:
			var path := "res://audio/impacts/%s-%d.wav" % [material, variant]
			if ResourceLoader.exists(path): sounds[material].append(load(path))
	for i in 8:
		var voice := AudioStreamPlayer3D.new()
		voice.name = "ImpactVoice%d" % i
		voice.unit_size = 3.0
		voice.max_distance = 32.0
		voice.volume_db = -14.0
		add_child(voice)
		voices.append(voice)

static func classify(target: Node3D) -> String:
	if target == null: return "stone"
	var declared := str(target.get_meta("surface_material", ""))
	if declared in MATERIALS: return declared
	var kind := str(target.get_meta("kind", ""))
	var enemy := str(target.get_meta("enemy_type", ""))
	if enemy == "skeleton" or kind == "skeleton_bone" or target.has_meta("skeleton_part"): return "bone"
	if enemy in ["ent", "tree_ent", "awakened_tree"] or kind in ["tree", "dummy", "log"] or target.has_meta("tree_key"): return "wood"
	if enemy in ["rat", "wolf"] or kind in ["rat", "apple", "pumpkin"]: return "flesh"
	if kind == "enemy" and enemy not in ["golem", "boss"]: return "flesh"
	if kind in ["bottle", "fire_vial"]: return "glass"
	if kind == "resource" and str(target.get_meta("requires", "")) == "axe": return "wood"
	if kind == "weapon" or declared == "brass": return "metal"
	return "stone"

func contact(target: Node3D, point: Vector3, normal: Vector3, speed: float, tool_id: String, material_override: String = "") -> bool:
	var material := material_override if material_override in MATERIALS else classify(target)
	return emit_contact({"target": target, "point": point, "normal": normal, "speed": speed,
		"energy": 0.65 * speed * speed, "relative_velocity": -normal * speed,
		"tool": tool_id, "strike_region": "working_edge", "material": material})

func emit_contact(event: Dictionary) -> bool:
	if game == null or not event.has("point"): return false
	var point: Vector3 = event.point
	if not point.is_finite(): return false
	var normal: Vector3 = event.get("normal", Vector3.UP)
	if normal.length_squared() < 0.001: normal = Vector3.UP
	normal = normal.normalized()
	var target: Node3D = event.get("target")
	var material: String = str(event.get("material", classify(target)))
	var sound_material := "metal" if material == "star_iron" else material
	if material == "star_iron": material = "stone"
	if material not in MATERIALS: material = "stone"
	var target_key: int = target.get_instance_id() if is_instance_valid(target) else 0
	var now: float = game.elapsed
	var last: Dictionary = recent.get(target_key, {})
	if not last.is_empty() and now - float(last.time) < 0.065 and point.distance_to(last.point) < 0.18: return false
	recent[target_key] = {"time": now, "point": point}
	if recent.size() > 256:
		for key in recent.keys():
			if now - float(recent[key].time) > 1.0: recent.erase(key)
	var energy: float = maxf(float(event.get("energy", 1.0)), 0.02)
	var strength := clampf(sqrt(energy) / 2.7, 0.35, 2.0)
	var tangent: Vector3 = normal.cross(Vector3.FORWARD if absf(normal.z) < 0.85 else Vector3.RIGHT).normalized()
	var bitangent := normal.cross(tangent).normalized()
	var tool: String = str(event.get("tool", ""))
	for pool in pools.values():
		if str(pool.material) != material: continue
		var spec: Dictionary = pool.spec
		if str(spec.get("gate", "")) == "metal_tool" and not _metal_tool(event): continue
		if str(spec.kind) == "spark" and (str(event.get("strike_region", "")).contains("shaft") or str(event.get("strike_region", "")) == "handle" or tool.contains("bone")): continue
		var count := clampi(roundi(float(spec.get("count", 4)) * strength), 1, 16)
		for i in count:
			if pool.particles.size() >= CAPACITY:
				dropped += 1
				break
			var direction: Vector3 = (normal * rng.randf_range(0.35, 1.15) + tangent * rng.randf_range(-0.8, 0.8) + bitangent * rng.randf_range(-0.8, 0.8)).normalized()
			var lifetime := float(spec.get("life", 0.55)) * rng.randf_range(0.85, 1.15)
			var velocity := direction * float(spec.get("speed", 2.0)) * rng.randf_range(0.65, 1.15) * strength
			var orientation := Basis.from_euler(Vector3(rng.randf(), rng.randf(), rng.randf()) * TAU)
			if str(spec.kind) == "spark": orientation = _streak_basis(velocity)
			pool.particles.append({"position": point + normal * 0.012, "velocity": velocity, "age": 0.0,
				"life": lifetime, "basis": orientation,
				"scale": float(spec.get("size", 0.04)) * rng.randf_range(0.75, 1.2),
				"spin": Vector3(rng.randf(), rng.randf(), rng.randf()) * 7.0,
				"color": Color(spec.get("tint", Color.WHITE)).lightened(rng.randf_range(0.0, 0.12))})
	_sound(sound_material if sound_material in MATERIALS else material, point, strength, bool(event.get("glance", false)))
	_mark(target, point, normal, material, strength)
	emitted += 1
	return true

static func _metal_tool(event: Dictionary) -> bool:
	var declared := str(event.get("tool_material", ""))
	if declared != "": return declared in ["metal", "iron", "steel", "brass", "star_iron"]
	var tool := str(event.get("tool", ""))
	return tool in ["quarry_pick", "woodland_axe", "ember_hammer", "siegebird", "crossbow", "crossbow_bolt", "bolt", "chakram", "sunfall_sledge", "copperpot_hammer"] or tool.contains("sword") or tool.contains("blade")

static func _streak_basis(velocity: Vector3) -> Basis:
	var x := velocity.normalized() if velocity.length_squared() > 0.001 else Vector3.RIGHT
	var z := x.cross(Vector3.UP if absf(x.y) < 0.9 else Vector3.FORWARD).normalized()
	return Basis(x, z.cross(x).normalized(), z)

func _sound(material: String, point: Vector3, strength: float, glance: bool) -> void:
	if game.diagnostic_offline or sounds.get(material, []).is_empty(): return
	var voice: AudioStreamPlayer3D = voices[voice_cursor % voices.size()]
	voice_cursor += 1
	voice.stop()
	voice.stream = sounds[material][sequence % sounds[material].size()]
	sequence += 1
	voice.global_position = point
	voice.pitch_scale = rng.randf_range(0.94, 1.07) * (1.08 if glance else 1.0)
	var volume: float = game.tuning.value("audio.volume") if game.tuning != null else 1.0
	voice.volume_db = linear_to_db(maxf(volume * clampf(strength * 0.22, 0.05, 0.4), 0.001))
	voice.play()

func _mark(target: Node3D, point: Vector3, normal: Vector3, material: String, strength: float) -> void:
	if art == null or not art.has_method("mark_profile") or not is_instance_valid(target): return
	# Meteor scars are authoritative/persistent and come from its mining record.
	if str(target.get_meta("kind", "")) == "meteor_ore": return
	if material not in ["stone", "wood", "bone", "metal"]: return
	var profile: Dictionary = art.mark_profile(material)
	if profile.is_empty(): return
	var mark := MeshInstance3D.new()
	mark.mesh = profile.mesh
	mark.material_override = profile.material
	mark.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mark)
	var up := normal.normalized()
	var x: Vector3 = up.cross(Vector3.FORWARD if absf(up.z) < 0.8 else Vector3.RIGHT).normalized()
	var pose := Transform3D(Basis(x, up, x.cross(up)), point + normal * 0.008)
	pose.basis = pose.basis.scaled(Vector3.ONE * float(profile.get("size", 0.08)) * strength)
	mark.global_transform = pose
	marks.append({"node": mark, "target": weakref(target), "local_pose": target.global_transform.affine_inverse() * pose, "until": game.elapsed + 28.0})
	while marks.size() > MAX_MARKS:
		marks.pop_front().node.queue_free()

func tick(delta: float) -> void:
	var start := Time.get_ticks_usec()
	var active := 0
	var calls := 0
	for pool in pools.values():
		var particles: Array = pool.particles
		var write := 0
		var spec: Dictionary = pool.spec
		var lower := Vector3.INF
		var upper := -Vector3.INF
		for p in particles:
			p.age += delta
			if p.age >= p.life: continue
			var kind: String = str(spec.kind)
			if kind == "dust":
				p.velocity *= exp(-delta * 4.0)
				p.velocity += Vector3.UP * delta * 0.2
			else: p.velocity += Vector3.DOWN * delta * 7.5
			p.position += p.velocity * delta
			if kind == "spark": p.basis = _streak_basis(p.velocity)
			if kind == "chip": p.basis = p.basis.rotated(p.spin.normalized(), p.spin.length() * delta)
			var fade := clampf((float(p.life) - float(p.age)) / maxf(float(p.life) * 0.35, 0.01), 0.0, 1.0)
			var scale: float = p.scale * (1.0 + float(p.age) * 1.2 if kind == "dust" else fade)
			var color: Color = p.color
			color.a = fade
			pool.multi.set_instance_transform(write, Transform3D(p.basis.scaled(Vector3.ONE * scale), p.position))
			pool.multi.set_instance_color(write, color)
			lower = lower.min(p.position - Vector3.ONE * scale)
			upper = upper.max(p.position + Vector3.ONE * scale)
			particles[write] = p
			write += 1
		particles.resize(write)
		pool.multi.visible_instance_count = write
		if write > 0:
			pool.multi.custom_aabb = AABB(lower, upper - lower)
			calls += 1
		active += write
	for record in marks.duplicate():
		var target: Node3D = record.target.get_ref()
		if target == null or not target.is_visible_in_tree() or game.elapsed > record.until:
			record.node.queue_free()
			marks.erase(record)
		else: record.node.global_transform = target.global_transform * record.local_pose
	stats = {"active": active, "draw_calls": calls + marks.size(), "update_usec": Time.get_ticks_usec() - start}

func _exit_tree() -> void:
	for voice in voices:
		if is_instance_valid(voice): voice.stop()
