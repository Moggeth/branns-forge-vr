extends RefCounted
## Stormbell: a mounted, hollow siege chime that stores force from real impacts.
## Parent integration: build(item), setup(game), tick(delta), trigger(item, hand, source),
## and record_impact(item, speed) from the weapon branch of melee.strike().
const CHARGE_CAP := 3
const AIM_COS := 0.94
const CHIME_RANGE := 12.0
const TRIGGER_COOLDOWN := 1.1

var game
var states: Dictionary = {}
var sounds: Array[AudioStreamPlayer3D] = []
var sound_cursor := 0
var tone: AudioStreamWAV
var materials: Dictionary = {}
var pulses: Array[Dictionary] = []

func _metal(hex: String, roughness: float, metallic := 0.84) -> StandardMaterial3D:
	var result := StandardMaterial3D.new()
	result.albedo_color = Color(hex)
	result.metallic = metallic
	result.roughness = roughness
	return result

func _begin() -> void:
	materials = {
		"bronze": _metal("987045", 0.32, 0.84),
		"copper": _metal("b77749", 0.29, 0.78),
		"edge": _metal("d4ad69", 0.23, 0.88),
		"shadow": _metal("332d29", 0.48, 0.7),
		"steel": _metal("aeb9b7", 0.26, 0.88),
		"leather": _metal("45332d", 0.83, 0.0),
		"stitch": _metal("c79b57", 0.42, 0.45),
		"rune": WorkshopScene.material("f1a84f", 0.22, 0.3, 0.0)
	}
	for key in materials:
		var surface := SurfaceTool.new()
		surface.begin(Mesh.PRIMITIVE_TRIANGLES)
		surfaces[key] = surface

var surfaces: Dictionary = {}

func _triangle(key: String, a: Vector3, b: Vector3, c: Vector3) -> void:
	var surface: SurfaceTool = surfaces[key]
	surface.add_vertex(a)
	surface.add_vertex(b)
	surface.add_vertex(c)

func _quad(key: String, a: Vector3, b: Vector3, c: Vector3, d: Vector3) -> void:
	_triangle(key, a, b, c)
	_triangle(key, a, c, d)

func _lathe(key: String, profile: Array, sides := 24, double_sided := false) -> void:
	# Closed radial sections must traverse the outer wall upwards for Godot winding.
	if profile[0].is_equal_approx(profile[-1]) or (is_zero_approx(profile[0].x) and is_zero_approx(profile[-1].x)):
		var area=0.0
		for i in range(profile.size()):
			var a:Vector2=profile[i]; var b:Vector2=profile[(i+1)%profile.size()]; area+=a.x*b.y-b.x*a.y
		if area<0: profile=profile.duplicate(); profile.reverse()
	for row in range(profile.size() - 1):
		var p: Vector2 = profile[row]
		var q: Vector2 = profile[row + 1]
		for i in range(sides):
			var a := TAU * float(i) / float(sides)
			var b := TAU * float(i + 1) / float(sides)
			var p0 := Vector3(cos(a) * p.x, p.y, sin(a) * p.x)
			var p1 := Vector3(cos(b) * p.x, p.y, sin(b) * p.x)
			var q0 := Vector3(cos(a) * q.x, q.y, sin(a) * q.x)
			var q1 := Vector3(cos(b) * q.x, q.y, sin(b) * q.x)
			_quad(key, p0, p1, q1, q0)
			if double_sided:
				_quad(key, q0, q1, p1, p0)

func _tube(key: String, points: Array[Vector3], radius: float, sides := 7) -> void:
	var frames: Array[Array] = []
	var previous_right := Vector3.ZERO
	for j in range(points.size()):
		var axis := (points[min(j + 1, points.size() - 1)] - points[max(0, j - 1)]).normalized()
		var right := axis.cross(Vector3.UP if absf(axis.y) < 0.95 else Vector3.RIGHT).normalized() if j == 0 else (previous_right - axis * previous_right.dot(axis)).normalized()
		previous_right = right
		var forward := axis.cross(right).normalized()
		var ring: Array[Vector3] = []
		for i in range(sides):
			var angle := TAU * float(i) / float(sides)
			ring.append(points[j] + radius * (right * cos(angle) + forward * sin(angle)))
		frames.append(ring)
	for j in range(frames.size() - 1):
		var left: Array = frames[j]
		var right: Array = frames[j + 1]
		for i in range(sides):
			var next := (i + 1) % sides
			_quad(key, left[i], right[i], right[next], left[next])

func _line(key: String, a: Vector3, b: Vector3, radius: float) -> void:
	_tube(key, [a, a.lerp(b, 0.4), a.lerp(b, 0.72), b], radius, 5)

func _collar(key: String, center_y: float, inner_radius: float, outer_radius: float, width: float, bevel: float) -> void:
	# A closed cross-section makes a complete forged cuff instead of a thin open-ended ribbon.
	var half := width * 0.5
	var profile := [
		Vector2(inner_radius, center_y-half), Vector2(inner_radius, center_y+half),
		Vector2(outer_radius-bevel, center_y+half), Vector2(outer_radius, center_y+half-bevel),
		Vector2(outer_radius, center_y-half+bevel), Vector2(outer_radius-bevel, center_y-half),
		Vector2(inner_radius, center_y-half)
	]
	_lathe(key, profile, 24)

func build(parent: Node3D) -> Dictionary:
	surfaces.clear()
	_begin()
	# The haft ends below the mouth; twin forged straps carry the bell around its exterior.
	_lathe("leather", [Vector2(0.029, 0.015), Vector2(0.036, 0.035), Vector2(0.033, 0.12), Vector2(0.030, 0.29), Vector2(0.036, 0.315)], 16)
	_collar("shadow", 0.029, 0.035, 0.043, 0.024, 0.004)
	_collar("copper", 0.067, 0.033, 0.040, 0.014, 0.003)
	_collar("copper", 0.267, 0.030, 0.037, 0.014, 0.003)
	# Raised spiral cord and closely spaced keeper ridges make the leather grip readable at arm's length.
	var wrap: Array[Vector3] = []
	for i in range(145):
		var t := float(i) / 144.0
		var angle := t * TAU * 5.0
		var y := lerpf(0.083, 0.251, t)
		var radius := lerpf(0.0348, 0.0322, t)
		wrap.append(Vector3(cos(angle)*radius, y, sin(angle)*radius))
	_tube("stitch", wrap, 0.0018, 5)
	for y in [0.052, 0.277]: _collar("edge", y, 0.030, 0.038, 0.005, 0.0015)
	for side in [-1.0, 1.0]:
		_tube("steel", [Vector3(0.0,0.310,0), Vector3(side*0.075,0.343,0), Vector3(side*0.174,0.408,0), Vector3(side*0.218,0.463,0), Vector3(side*0.218,0.535,0), Vector3(side*0.193,0.598,0), Vector3(side*0.135,0.646,0), Vector3(side*0.075,0.660,0)], 0.013, 8)
		_line("edge", Vector3(side*0.218,0.48,0), Vector3(side*0.218,0.52,0), 0.003)
	# The fork bridges above the crown, leaving the entire clapper arc and bell mouth clear.
	_tube("edge", [Vector3(-0.075,0.660,0), Vector3(-0.025,0.669,0), Vector3(0.025,0.669,0), Vector3(0.075,0.660,0)], 0.010, 8)
	# Bell wall cross-section: outer flare, rolled lip, then inner wall and closed crown.
	# The lower opening is deliberately left clear so the suspended clapper is visible.
	_lathe("bronze", [
		Vector2(0.0, 0.588), Vector2(0.066, 0.588), Vector2(0.083, 0.579),
		Vector2(0.118, 0.584), Vector2(0.153, 0.570), Vector2(0.175, 0.538),
		Vector2(0.184, 0.501), Vector2(0.196, 0.474), Vector2(0.188, 0.462),
		Vector2(0.175, 0.468), Vector2(0.169, 0.508), Vector2(0.157, 0.546),
		Vector2(0.137, 0.568), Vector2(0.100, 0.580), Vector2(0.067, 0.579),
		Vector2(0.0, 0.579)
	], 32)
	# Closed rolled cuffs follow the lip and shoulder without exposed profile ends.
	_collar("edge", 0.476, 0.187, 0.202, 0.014, 0.004)
	_collar("shadow", 0.505, 0.175, 0.187, 0.009, 0.003)
	_collar("edge", 0.560, 0.151, 0.166, 0.012, 0.003)
	# Crown cap below the socket, plus a hexagonal collar with six real facets.
	_lathe("bronze", [Vector2(0, 0.567), Vector2(0.066, 0.567), Vector2(0.075, 0.577), Vector2(0.068, 0.584), Vector2(0, 0.584)], 24)
	_collar("steel", 0.588, 0.057, 0.076, 0.016, 0.004)
	_collar("copper", 0.650, 0.016, 0.024, 0.010, 0.003)
	# This capped pin physically joins the yoke bridge to the bell's crown collar.
	WorkshopScene.cylinder(parent, Vector3(0,0.624,0), 0.014, 0.074, materials.steel, 0.014)
	WorkshopScene.ball(parent, Vector3(0,0.625,0), Vector3(0.021,0.021,0.021), materials.edge)
	# Hand-forged maker marks: paired rivets, a central shield and radial scoring on the cheek.
	for side in [-1.0, 1.0]:
		WorkshopScene.ball(parent, Vector3(side * 0.111, 0.565, 0.146), Vector3(0.018, 0.018, 0.009), materials.edge)
		WorkshopScene.ball(parent, Vector3(side * 0.078, 0.542, 0.176), Vector3(0.009, 0.009, 0.009), materials.shadow)
	var shield := MeshInstance3D.new()
	shield.name = "Stormbell_Crest"
	var crest := SurfaceTool.new()
	crest.begin(Mesh.PRIMITIVE_TRIANGLES)
	var crest_points := [Vector3(-0.038,0.576,0.179),Vector3(0.038,0.576,0.179),Vector3(0.031,0.535,0.181),Vector3(0,0.516,0.182),Vector3(-0.031,0.535,0.181)]
	for i in range(1, crest_points.size() - 1):
		crest.add_vertex(crest_points[0]); crest.add_vertex(crest_points[i]); crest.add_vertex(crest_points[i + 1])
	crest.generate_normals()
	shield.mesh = crest.commit()
	shield.material_override = materials.edge
	parent.add_child(shield)
	# Open crown has a forged tuning fork motif on the forward face.
	_line("shadow", Vector3(0,0.522,0.186), Vector3(0,0.563,0.186), 0.0023)
	_line("shadow", Vector3(0,0.556,0.186), Vector3(-0.012,0.571,0.186), 0.0023)
	_line("shadow", Vector3(0,0.556,0.186), Vector3(0.012,0.571,0.186), 0.0023)
	# The clapper hangs from a visible crown loop and is independent of the impact collider.
	var clapper := Node3D.new()
	clapper.name = "Stormbell_MovingClapper"
	clapper.position = Vector3(0, 0.554, 0)
	parent.add_child(clapper)
	WorkshopScene.cylinder(clapper, Vector3(0,0.014,0), 0.0045, 0.028, materials.edge, 0.004)
	WorkshopScene.cylinder(clapper, Vector3(0,-0.050,0), 0.005, 0.103, materials.steel, 0.005)
	WorkshopScene.ball(clapper, Vector3(0,-0.112,0), Vector3(0.034,0.043,0.034), materials.edge)
	WorkshopScene.ball(clapper, Vector3(0,-0.113,0), Vector3(0.014,0.022,0.014), materials.shadow)
	var charge_rune := WorkshopScene.ball(parent, Vector3(0,0.672,0), Vector3(0.021,0.021,0.021), materials.rune.duplicate())
	# Batch all forged surfaces by material; only tiny struck details and the swinging clapper stay separate.
	var mesh_count := 0
	var triangle_count := 0
	for key in surfaces:
		var surface: SurfaceTool = surfaces[key]
		surface.generate_normals()
		var mesh := surface.commit()
		if mesh.get_surface_count() == 0: continue
		var instance := MeshInstance3D.new()
		instance.name = "Stormbell_" + str(key).capitalize()
		instance.mesh = mesh
		instance.material_override = materials[key]
		parent.add_child(instance)
		mesh_count += 1
		triangle_count += int(mesh.get_faces().size() / 3)
	parent.set_meta("stormbell_clapper", clapper)
	parent.set_meta("tip", Vector3.UP * 0.71)
	parent.set_meta("stormbell_charge", 0)
	parent.set_meta("alternate_ability", "Stormbell: swing to store up to three impacts; aim and trigger to release a directional concussive chime.")
	states[parent.get_instance_id()] = {"item": parent, "clapper": clapper, "rune": charge_rune, "rune_material": charge_rune.material_override, "charge": 0, "last_impact": -10.0, "last_trigger": -10.0, "swing": 0.0, "phase": 0.0}
	return {"mesh_count": mesh_count + 12, "batched_surface_count": mesh_count, "triangle_count": triangle_count, "height": 0.71, "bounds": Vector3(0.43, 0.71, 0.43)}

func setup(owner_game) -> void:
	game = owner_game
	sounds.clear()
	for i in range(3):
		var player := AudioStreamPlayer3D.new()
		player.name = "Stormbell_Chime_%d" % i
		player.max_distance = 28.0
		player.unit_size = 3.0
		player.volume_db = -12.0
		game.add_child(player)
		sounds.append(player)
	tone = _make_tone()

func _make_tone() -> AudioStreamWAV:
	var sample_rate := 22050
	var samples := int(sample_rate * 0.92)
	var data := PackedByteArray()
	data.resize(samples * 2)
	for i in range(samples):
		var time := float(i) / sample_rate
		var envelope := exp(-time * 3.3) * minf(1.0, time / 0.006)
		var fundamental := sin(TAU * 392.0 * time) * 0.52
		var partial := sin(TAU * 587.3 * time + 0.18) * 0.24
		var shimmer := sin(TAU * 1174.6 * time + 0.4) * 0.09
		var value := clampf((fundamental + partial + shimmer) * envelope, -0.9, 0.9)
		data.encode_s16(i * 2, int(value * 32767.0))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.data = data
	return stream

func _state(item: Node3D) -> Dictionary:
	var id := item.get_instance_id()
	if not states.has(id):
		var clapper: Node3D = item.get_meta("stormbell_clapper", null)
		if not is_instance_valid(clapper): return {}
		var rune: MeshInstance3D
		for child in item.get_children():
			if child is MeshInstance3D and child.position.y > 0.64 and child.scale == Vector3(0.021,0.021,0.021):
				rune = child
				break
		states[id] = {"item": item, "clapper": clapper, "rune": rune, "rune_material": rune.material_override if is_instance_valid(rune) else null, "charge": int(item.get_meta("stormbell_charge", 0)), "last_impact": -10.0, "last_trigger": -10.0, "swing": 0.0, "phase": randf() * TAU}
	return states[id]

func record_impact(item, speed: float) -> bool:
	if not is_instance_valid(item) or not item.has_meta("stormbell_clapper") or speed < 1.0: return false
	var state := _state(item)
	if state.is_empty() or game == null: return false
	if game.elapsed - float(state.last_impact) < 0.24: return false
	state.last_impact = game.elapsed
	state.swing = maxf(float(state.swing), clampf(speed * 0.07, 0.16, 0.58))
	var added := 1 if speed < 2.5 else (2 if speed >= 5.0 else 1)
	state.charge = mini(CHARGE_CAP, int(state.charge) + added)
	item.set_meta("stormbell_charge", state.charge)
	_update_rune(state)
	_play_charge_tap(item.global_position + Vector3.UP * 0.58, state.charge)
	return true

func _update_rune(state: Dictionary) -> void:
	var rune = state.get("rune")
	if not is_instance_valid(rune):
		var item = state.get("item")
		if is_instance_valid(item):
			for child in item.get_children():
				if child is MeshInstance3D and child.position.y > 0.64 and child.scale == Vector3(0.021,0.021,0.021):
					rune = child
					state.rune = child
					break
	if not is_instance_valid(rune): return
	var level := float(state.charge) / float(CHARGE_CAP)
	var mat := state.get("rune_material") as StandardMaterial3D
	if mat != null:
		mat.emission_energy_multiplier = 0.15 + level * 2.2
		mat.albedo_color = Color("f1a84f").lerp(Color("ffe4a2"), level)

func trigger(item, hand, source) -> bool:
	if not is_instance_valid(item) or not item.has_meta("stormbell_clapper"): return false
	var state := _state(item)
	if state.is_empty(): return true
	if game == null: return true
	if game.elapsed - float(state.last_trigger) < TRIGGER_COOLDOWN:
		game._notice("Stormbell · the chime is still settling.", 2)
		return true
	if int(state.charge) <= 0:
		game._notice("Stormbell · strike a solid target to load the bell.", 3)
		return true
	var direction: Vector3 = -source.global_basis.z.normalized()
	var origin: Vector3 = source.global_position + direction * 0.12
	var excluded: Array[RID] = []
	for collider in item.find_children("*", "CollisionObject3D", true, false):
		excluded.append(collider.get_rid())
	var candidates: Array[Dictionary] = []
	for enemy in game.scene.get("enemies", []):
		if not is_instance_valid(enemy) or not enemy.is_visible_in_tree() or not bool(enemy.get_meta("alive", true)): continue
		if str(enemy.get_meta("zone", game.adventure.zone)) != game.adventure.zone: continue
		var point: Vector3 = enemy.global_position + Vector3.UP * (1.0 if str(enemy.get_meta("enemy_type", "")) in ["golem", "boss"] else 0.65)
		var offset := point - origin
		var distance := offset.length()
		if distance < 0.1 or distance > CHIME_RANGE or offset.normalized().dot(direction) < AIM_COS: continue
		var query := PhysicsRayQueryParameters3D.create(origin, point, 1)
		query.exclude = excluded
		var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(query)
		var target = game._owner(hit.get("collider")) if not hit.is_empty() else null
		if target != enemy: continue
		candidates.append({"enemy": enemy, "point": point, "distance": distance})
	for dummy in game.scene.get("dummies", []):
		if not is_instance_valid(dummy) or not dummy.is_visible_in_tree(): continue
		var point: Vector3 = dummy.global_position + Vector3.UP * 0.65
		var offset := point - origin
		var distance := offset.length()
		if distance < 0.1 or distance > CHIME_RANGE or offset.normalized().dot(direction) < AIM_COS: continue
		var query := PhysicsRayQueryParameters3D.create(origin, point, 1)
		query.exclude = excluded
		var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(query)
		var target = game._owner(hit.get("collider")) if not hit.is_empty() else null
		if target == dummy: candidates.append({"dummy": dummy, "point": point, "distance": distance})
	state.last_trigger = game.elapsed
	var charge := int(state.charge)
	state.charge = 0
	item.set_meta("stormbell_charge", 0)
	_update_rune(state)
	state.swing = maxf(float(state.swing), 0.8)
	_play_chime(origin, direction, charge)
	_spawn_wave(origin, direction, charge)
	var dealt := 0
	for candidate in candidates:
		if candidate.has("enemy"):
			var enemy: Node3D = candidate.enemy
			var away := (enemy.global_position + Vector3.UP * 0.4 - origin).normalized()
			var damage := 12.0 + float(charge) * 8.0
			var impulse := away * (2.0 + float(charge) * 1.2) + Vector3.UP * 0.5
			game.adventure.hurt_enemy(enemy, damage, hand, impulse, "blast")
		else:
			game._dummy_hit(candidate.dummy)
		dealt += 1
	game.adventure.haptic(hand, "release")
	game._notice("Stormbell · %d resonance released%s." % [charge, ", striking %d target%s" % [dealt, "" if dealt == 1 else "s"] if dealt > 0 else " into the open air"], 4)
	return true

func _play_chime(point: Vector3, direction: Vector3, charge: int) -> void:
	if sounds.is_empty() or DisplayServer.get_name() == "headless": return
	var player: AudioStreamPlayer3D = sounds[sound_cursor % sounds.size()]
	sound_cursor += 1
	player.stop()
	player.stream = tone
	player.pitch_scale = 0.88 + float(charge) * 0.055
	player.volume_db = -16.0 + float(charge) * 1.8
	player.global_position = point + direction * 0.2
	player.play()

func _play_charge_tap(point: Vector3, charge: int) -> void:
	if sounds.is_empty() or DisplayServer.get_name() == "headless": return
	var player: AudioStreamPlayer3D = sounds[sound_cursor % sounds.size()]
	sound_cursor += 1
	player.stop()
	player.stream = tone
	player.pitch_scale = 1.25 + float(charge) * 0.09
	player.volume_db = -27.0
	player.global_position = point
	player.play()

func _spawn_wave(origin: Vector3, direction: Vector3, charge: int) -> void:
	if game == null: return
	var node := MeshInstance3D.new()
	node.name = "Stormbell_ConcussiveWave"
	var torus := TorusMesh.new()
	torus.inner_radius = 0.014
	torus.outer_radius = 0.027
	torus.rings = 8
	torus.ring_segments = 12
	node.mesh = torus
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1.0, 0.72, 0.36, 0.82)
	mat.emission_enabled = true
	mat.emission = Color("ffb955")
	mat.emission_energy_multiplier = 1.4
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	node.material_override = mat
	game.add_child(node)
	node.global_position = origin + direction * 0.4
	node.quaternion = Quaternion(Vector3.UP, direction)
	node.scale = Vector3.ONE * (0.8 + 0.15 * float(charge))
	pulses.append({"node": node, "age": 0.0, "life": 0.38, "direction": direction, "charge": charge})
	if pulses.size() > 8:
		var oldest: Dictionary = pulses.pop_front()
		if is_instance_valid(oldest.node): oldest.node.queue_free()

func tick(delta: float) -> void:
	for id in states.keys():
		var state: Dictionary = states[id]
		var item = state.get("item")
		if not is_instance_valid(item):
			states.erase(id)
			continue
		var clapper: Node3D = state.get("clapper")
		if is_instance_valid(clapper):
			state.phase = float(state.phase) + delta * 9.0
			state.swing = move_toward(float(state.swing), 0.0, delta * 1.4)
			var swing := float(state.swing)
			clapper.rotation.z = sin(float(state.phase)) * swing
			clapper.rotation.x = cos(float(state.phase) * 0.73) * swing * 0.35
	for pulse in pulses.duplicate():
		if not is_instance_valid(pulse.node): pulses.erase(pulse); continue
		pulse.age = float(pulse.age) + delta
		var t := clampf(float(pulse.age) / float(pulse.life), 0.0, 1.0)
		var scale_value := (0.8 + float(pulse.charge) * 0.18) * (1.0 + t * 15.0)
		pulse.node.scale = Vector3.ONE * scale_value
		pulse.node.global_position += pulse.direction * delta * 18.0
		var material := pulse.node.material_override as StandardMaterial3D
		material.albedo_color.a = (1.0 - t) * 0.82
		material.emission_energy_multiplier = (1.0 - t) * 1.4
		if t >= 1.0:
			pulse.node.queue_free()
			pulses.erase(pulse)
