extends Node
## Lazy, self-contained globe zone. World coordinates are only used at this boundary.
const Fields = preload("res://orchard_planet_fields.gd")
const Terrain = preload("res://orchard_planet_terrain.gd")
const Gameplay = preload("res://orchard_planet_gameplay.gd")
const Art = preload("res://planet_art/orchard_planet_art.gd")
const Weather = preload("res://orchard_planet_weather.gd")
const Dressing = preload("res://planet_art/orchard_planet_dressing.gd")
const SAVE_PATH := "user://orchard_planet_v1.json"
const LOG_PATH := "user://logs/orchard_planet.log"
const ZONE := "orchard_planet"
const ENCOUNTERS := {"patrol": ["skeleton", 3], "duelist": ["skeleton", 1], "shield_patrol": ["skeleton", 2], "rat_swarm": ["rat", 3], "ghosts": ["ghost", 2], "golem": ["golem", 1]}
const ENCOUNTER_COSTS := {"patrol": 4, "duelist": 3, "shield_patrol": 5, "rat_swarm": 3, "ghosts": 5, "golem": 6}
const MAX_ACTORS := 128
var game
var center := Vector3(6000.0, 0.0, 0.0)
var radius := 85.0
var seed := 290929
var root: Node3D
var fields: RefCounted
var terrain: Node3D
var gameplay: Node3D
var art: Node
var weather: Node3D
var dressing: Node
var built := false
var _time := 0.0
var _encounter_commands: Array[Dictionary] = []
var _previous_sky: Dictionary = {}
var _water_mesh: MeshInstance3D
var _water_revision := -1
var _last_reset_backup := ""

func setup(owner_game) -> void:
	game = owner_game
	if not is_instance_valid(root):
		root = Node3D.new()
		root.name = "OrchardPlanetRoot"
		root.set_meta("zone", ZONE)
		root.set_meta("kind", "floor")
		var parent: Node = game
		if game.get("adventure") != null and game.adventure.zone_groups is Dictionary:
			if not game.adventure.zone_groups.has(ZONE):
				var group := Node3D.new()
				group.name = "LiveZone_" + ZONE
				game.add_child(group)
				group.visible = false
				game.adventure.zone_groups[ZONE] = group
			parent = game.adventure.zone_groups[ZONE]
		parent.add_child(root)
		root.global_position = center
	if game.get("scene") != null:
		game.scene.zones[ZONE] = {"name": "Orchard Planet", "root": root, "center": center,
			"spawn": center + Vector3(0.0, radius + 2.0, 0.0),
			"bounds": Rect2(Vector2(center.x - radius - 12.0, center.z - radius - 12.0), Vector2.ONE * (radius + 12.0) * 2.0),
			"tier": 4, "planet": true,
			"environment": {"ambient_color":"a1b8d9", "ambient_energy":0.65, "fog_density":0.0}}
	_log("setup seed=%d radius=%.2f center=%s" % [seed, radius, str(center)])

func ensure_built() -> void:
	if built:
		return
	var started_ms := Time.get_ticks_msec()
	if not is_instance_valid(root):
		setup(game)
	fields = Fields.new()
	fields.setup(seed, radius)
	terrain = Terrain.new()
	terrain.name = "PlanetTerrain"
	terrain.set_meta("kind", "floor")
	root.add_child(terrain)
	terrain.setup(fields, game.camera if game != null and game.get("camera") != null else null)
	for child in terrain.get_children():
		if child is StaticBody3D:
			child.set_meta("kind", "floor")
			child.set_meta("zone", ZONE)
	gameplay = Gameplay.new()
	gameplay.name = "PlanetGameplay"
	root.add_child(gameplay)
	gameplay.setup(self)
	art = Art.new()
	art.name = "PlanetArt"
	root.add_child(art)
	art.options["sky"] = false
	art.setup(self)
	weather = Weather.new()
	weather.name = "PlanetWeather"
	root.add_child(weather)
	weather.setup(game, self)
	built = true
	var restored := _restore()
	if not restored:
		gameplay.build()
	dressing = Dressing.new()
	dressing.name = "PlanetDressing"
	root.add_child(dressing)
	dressing.setup(self)
	dressing.build()
	_build_water()
	# The spawn is derived from the exact surface after saved terrain operations.
	if game != null and game.get("scene") != null:
		game.scene.zones[ZONE]["spawn"] = surface_point(Vector3.UP) + Vector3.UP * 0.12
	for actor in gameplay.actors:
		_initialize_actor(actor)
	_log("built restored=%s actors=%d elapsed_ms=%d" % [str(restored), gameplay.actors.size(), Time.get_ticks_msec() - started_ms])

## Await complete incremental warmup before travel, then a physics frame so all
## concave shapes are registered. Work is bounded; loading never stalls an XR frame.
func prepare_arrival() -> void:
	var started_ms := Time.get_ticks_msec()
	ensure_built()
	var prior_camera: Camera3D = terrain.camera
	var warm_camera := Camera3D.new()
	warm_camera.name = "PlanetCollisionWarmupCamera"
	root.add_child(warm_camera)
	warm_camera.position = Vector3.UP * (radius + 1.0)
	terrain.camera = warm_camera
	for frame in 6000:
		terrain.tick(0.0)
		if terrain.statistics()["built"] >= terrain.statistics()["total"]:
			break
		if frame % 120 == 0:
			game._notice("Growing the Little Orchard… %d / %d terrain tiles" % [terrain.statistics()["built"], terrain.statistics()["total"]], 8)
		await get_tree().process_frame
	terrain.camera = prior_camera
	warm_camera.queue_free()
	await get_tree().physics_frame
	_select_landing()
	_log("arrival ready chunks=%d elapsed_ms=%d" % [terrain.statistics()["built"], Time.get_ticks_msec() - started_ms])

func _select_landing() -> void:
	var anchors: Array[Dictionary] = fields.region_anchors()
	var base: Vector3 = anchors[0]["direction"] if not anchors.is_empty() else Vector3.UP
	var east := base.cross(Vector3.UP).normalized()
	if east.length_squared() < 0.01:
		east = base.cross(Vector3.RIGHT).normalized()
	var north := base.cross(east).normalized()
	var selected := base
	for i in 120:
		var distance := 0.0 if i == 0 else 0.6 * sqrt(float(i))
		var angle := float(i) * 2.399963229728653
		var candidate := (base + (east * cos(angle) + north * sin(angle)) * distance / radius).normalized()
		var sample: Dictionary = fields.sample(candidate)
		if sample["water"] or float(sample["slope"]) > 0.26:
			continue
		var feet: Vector3 = center + fields.surface_point(candidate) + candidate * 0.08
		if not _landing_body_clear(feet, candidate):
			continue
		selected = candidate
		break
	game.scene.zones[ZONE]["spawn"] = center + fields.surface_point(selected) + selected * 0.08

func _landing_body_clear(feet: Vector3, up: Vector3) -> bool:
	if game == null or not game.is_inside_tree():
		return true
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.2
	capsule.height = 1.6
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = capsule
	query.collision_mask = 1
	query.transform = Transform3D(Basis(Quaternion(Vector3.UP, up)), feet + up * 0.87)
	return game.get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty()

func enter() -> void:
	ensure_built()
	var world := _world_environment()
	if world == null or world.environment == null or art == null:
		return
	var env: Environment = world.environment
	if _previous_sky.is_empty():
		_previous_sky = {"background_mode": env.background_mode, "sky": env.sky,
			"ambient_light_source": env.ambient_light_source,
			"ambient_light_energy": env.ambient_light_energy, "ambient_light_color": env.ambient_light_color}
	art.options["sky"] = true
	env.background_mode = Environment.BG_SKY
	env.sky = art.sky
	# A small world needs readable surfaces on its night-side as well. The
	# authored sky is visual; a bounded ambient fill avoids black hemispheres.
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.63, 0.72, 0.85)
	env.ambient_light_energy = 0.65

func leave() -> void:
	if _previous_sky.is_empty():
		return
	var world := _world_environment()
	if world != null and world.environment != null:
		var env: Environment = world.environment
		env.background_mode = _previous_sky["background_mode"]
		env.sky = _previous_sky["sky"]
		env.ambient_light_source = _previous_sky["ambient_light_source"]
		env.ambient_light_energy = _previous_sky["ambient_light_energy"]
		env.ambient_light_color = _previous_sky["ambient_light_color"]
	_previous_sky.clear()
	if art != null:
		art.options["sky"] = false

func _world_environment() -> WorldEnvironment:
	if game == null:
		return null
	var direct := game.get_node_or_null("AdventureEnvironment") as WorldEnvironment
	if direct != null:
		return direct
	for node in get_tree().root.find_children("*", "WorldEnvironment", true, false):
		return node as WorldEnvironment
	return null

func _water_vertex(direction: Vector3, surface_height: float) -> Vector3:
	# Equal radial height across a cross-section: water fills the carved bed,
	# rather than following its bottom and becoming a second bowl-shaped floor.
	return direction * (radius + surface_height)

func _build_water() -> void:
	if fields == null or art == null:
		return
	if not is_instance_valid(_water_mesh):
		_water_mesh = MeshInstance3D.new()
		_water_mesh.name = "PlanetRiversAndLakes"
		_water_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(_water_mesh)
		_water_mesh.material_override = art.make_water_material()
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	for channel in fields._river:
		var path: Array[Vector3] = channel["path"]
		if path.size() >= 2:
			var first := vertices.size()
			for i in path.size():
				var d: Vector3 = path[i]
				var previous: Vector3 = path[maxi(0, i - 1)]
				var following: Vector3 = path[mini(path.size() - 1, i + 1)]
				var along := (following - previous * following.dot(previous)).normalized()
				var side := d.cross(along).normalized()
				for sign_value in [-1.0, 1.0]:
					var edge := (d + side * float(sign_value) * 1.1 / radius).normalized()
					vertices.append(_water_vertex(edge, fields.height_at(d) + 1.0))
					normals.append(edge)
					colors.append(Color(0.68, 0.0, 0.0, 1.0))
					uvs.append(Vector2(float(i) * 0.5, float(sign_value) * 0.5 + 0.5))
				if i > 0:
					var a := first + (i - 1) * 2
					var b := a + 1
					var c := a + 2
					var e := a + 3
					var outward := (vertices[c] - vertices[a]).cross(vertices[b] - vertices[a]).dot(vertices[a]) > 0.0
					if not outward:
						indices.append_array(PackedInt32Array([a, c, b, b, c, e]))
					else:
						indices.append_array(PackedInt32Array([a, b, c, b, e, c]))
		var lake: Vector3 = channel["lake"]
		var tangent := lake.cross(Vector3.UP).normalized()
		if tangent.length_squared() < 0.01:
			tangent = lake.cross(Vector3.RIGHT).normalized()
		var side := lake.cross(tangent).normalized()
		var center_index := vertices.size()
		var lake_level: float = fields.height_at(lake) + 1.9
		vertices.append(_water_vertex(lake, lake_level))
		normals.append(lake)
		colors.append(Color(0.0, 0.0, 0.0, 1.0))
		uvs.append(Vector2(0.5, 0.5))
		for i in 17:
			var angle := TAU * float(i) / 16.0
			var edge := (lake + (tangent * cos(angle) + side * sin(angle)) * 3.0 / radius).normalized()
			vertices.append(_water_vertex(edge, lake_level))
			normals.append(edge)
			colors.append(Color(1.0, 0.0, 0.0, 1.0))
			uvs.append(Vector2(0.5 + cos(angle) * 0.5, 0.5 + sin(angle) * 0.5))
			if i > 0:
				var a := center_index
				var b := center_index + i
				var c := b + 1
				if (vertices[b] - vertices[a]).cross(vertices[c] - vertices[a]).dot(vertices[a]) < 0.0:
					indices.append_array(PackedInt32Array([a, b, c]))
				else:
					indices.append_array(PackedInt32Array([a, c, b]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_water_mesh.mesh = mesh
	_water_revision = fields.revision

func surface_point(direction: Vector3) -> Vector3:
	ensure_built()
	return center + fields.surface_point(direction)

func normal_at(direction: Vector3) -> Vector3:
	ensure_built()
	return fields.normal_at(direction)

func height_at(direction: Vector3) -> float:
	ensure_built()
	return fields.height_at(direction)

func direction_at(world_point: Vector3) -> Vector3:
	return (world_point - center).normalized()

func local_up_at(world_point: Vector3) -> Vector3:
	return direction_at(world_point)

func gravity_direction_at(world_point: Vector3) -> Vector3:
	return -direction_at(world_point)

func preview(action: String, world_point: Vector3, start_world_point: Vector3 = Vector3.INF) -> Dictionary:
	ensure_built()
	var key := action.to_lower()
	if ENCOUNTERS.has(key):
		var direction := direction_at(world_point)
		if direction == Vector3.ZERO:
			return {"ok": false, "error": "Aim at the planet surface"}
		return {"ok": true, "action": key, "direction": direction, "position": surface_point(direction), "normal": normal_at(direction), "radius": 5.0, "cost": ENCOUNTER_COSTS[key], "biome": fields.sample(direction)["biome"]}
	return gameplay.preview(action, world_point, start_world_point)

func cast(action: String, world_point: Vector3, start_world_point: Vector3 = Vector3.INF) -> Dictionary:
	ensure_built()
	var key := action.to_lower()
	var result: Dictionary
	if ENCOUNTERS.has(key):
		result = _cast_encounter(key, world_point)
	else:
		result = gameplay.cast(action, world_point, start_world_point)
	if result.get("ok", false):
		if dressing != null and result.has("angular_radius"):
			dressing.refresh_cap(result["center"], result["angular_radius"])
		save()
		if art != null:
			var event_kind := ""
			match key:
				"raise": event_kind = "uplift"
				"sunder": event_kind = "rupture"
				"grove", "forestline", "treering", "forest", "ring": event_kind = "root_growth"
				"starfall", "meteor": event_kind = "dust"
			if not event_kind.is_empty():
				art.event(event_kind, result.get("position", world_point), normal_at(direction_at(world_point)), {"radius": result.get("radius", 5.0)})
		_log("cast action=%s revision=%d" % [key, fields.revision])
	return result

func _cast_encounter(key: String, world_point: Vector3, record: bool = true) -> Dictionary:
	var plan := preview(key, world_point)
	if not plan.get("ok", false):
		return plan
	var spec: Array = ENCOUNTERS[key]
	var kind: String = spec[0]
	var count: int = spec[1]
	if gameplay.actors.size() + count > MAX_ACTORS:
		return {"ok": false, "error": "This planet has reached its active creature limit"}
	var direction: Vector3 = plan["direction"]
	var tangent := direction.cross(Vector3.UP).normalized()
	if tangent.length_squared() < 0.1:
		tangent = direction.cross(Vector3.RIGHT).normalized()
	var side := direction.cross(tangent).normalized()
	for index in count:
		var offset := tangent * cos(float(index) * TAU / count) + side * sin(float(index) * TAU / count)
		var at := (direction + offset * 2.0 / radius).normalized()
		var actor: Node3D
		if kind == "ghost":
			if game == null or game.get("firecraft") == null:
				return {"ok": false, "error": "Firecraft is unavailable"}
			actor = game.firecraft._ghost(ZONE, surface_point(at))
			actor.reparent(gameplay, true)
			actor.position = fields.surface_point(at)
			actor.set_meta("planet_direction", at)
			actor.set_meta("home_direction", at)
			actor.set_meta("planet_actor", true)
			gameplay.actors.append(actor)
			gameplay.placed.append(actor)
		else:
			actor = gameplay._enemy(at, kind)
		if key == "shield_patrol":
			actor.set_meta("shield_guardian", true)
		_initialize_actor(actor)
	if record:
		_encounter_commands.append({"action": key, "direction": [direction.x, direction.y, direction.z]})
	return {"ok": true, "action": key, "spawned": count, "cost": ENCOUNTER_COSTS[key], "position": plan["position"]}

func _initialize_actor(actor: Node3D) -> void:
	if game == null or game.get("adventure") == null:
		return
	if str(actor.get_meta("enemy_type", "")) not in ["", "ghost"] and game.adventure.has_method("_initialize_enemy"):
		game.adventure._initialize_enemy(actor)
	if str(actor.get_meta("enemy_type", "")) == "skeleton" and not actor.get_meta("planet_guardian_ready", false):
		if game.get("guardians") != null and game.get("guardian_authored") != null:
			game.guardians.attach(actor, "mossward")
			game.guardian_authored.attach(actor, "mossward")
			actor.set_meta("planet_guardian_ready", true)
	# Planet AI owns movement and keeps the whole actor upright on radial ground.
	actor.set_meta("planet_actor", true)
	actor.set_meta("planet_attack_at", 0.0)

func tick(delta: float) -> void:
	if not built:
		return
	_time += maxf(delta, 0.0)
	terrain.tick(delta)
	gameplay.tick(delta)
	if _water_revision != fields.revision:
		_build_water()
	if art != null:
		art.tick(delta)
	if weather != null:
		weather.tick(delta)
	if dressing != null:
		dressing.tick(delta)
	if game == null or game.get("adventure") == null or game.adventure.zone != ZONE:
		return
	_tick_actors(minf(maxf(delta, 0.0), 0.1))

func _tick_actors(delta: float) -> void:
	if game.get("rig") == null:
		return
	var target := direction_at(game.rig.global_position)
	if target == Vector3.ZERO:
		return
	for actor in gameplay.actors:
		if not is_instance_valid(actor) or not actor.get_meta("alive", true):
			continue
		var current: Vector3 = actor.get_meta("planet_direction", direction_at(actor.global_position))
		var distance := radius * acos(clampf(current.dot(target), -1.0, 1.0))
		var kind := str(actor.get_meta("enemy_type", "rat"))
		var step_speed := 0.58 if kind == "golem" else (0.92 if kind == "skeleton" else 1.15)
		var goal: Vector3 = target if distance < 14.0 else actor.get_meta("home_direction", current)
		var tangent: Vector3 = (goal - current * goal.dot(current)).normalized()
		if tangent.length_squared() > 0.001 and distance > 1.9:
			var angle := minf(step_speed * delta / radius, acos(clampf(current.dot(goal), -1.0, 1.0)))
			var candidate := (current * cos(angle) + tangent * sin(angle)).normalized()
			var ground: Dictionary = fields.sample(candidate)
			if not ground["water"] and float(ground["slope"]) <= 0.42 and _actor_path_clear(actor, current, candidate):
				current = candidate
				actor.set_meta("planet_direction", current)
		actor.position = fields.surface_point(current)
		var up: Vector3 = fields.normal_at(current)
		var facing := (target - current * target.dot(current)).normalized()
		if facing.length_squared() > 0.001:
			actor.basis = Basis.looking_at(-facing, up)
		var phase := str(actor.get_meta("planet_attack_phase", "idle"))
		var phase_started := float(actor.get_meta("planet_attack_started", 0.0))
		if phase == "idle" and distance < 2.5 and _time >= float(actor.get_meta("planet_attack_at", 0.0)):
			phase = "windup"
			phase_started = _time
			actor.set_meta("planet_attack_started", _time)
			actor.set_meta("attack_damage_done", false)
		if phase == "windup":
			actor.set_meta("combat_progress", clampf((_time - phase_started) / 0.9 * 0.65, 0.0, 0.65))
			if _time - phase_started >= 0.9:
				phase = "strike"
		if phase == "strike":
			actor.set_meta("combat_progress", 0.76)
			if not actor.get_meta("attack_damage_done", false):
				actor.set_meta("attack_damage_done", true)
				if distance < 2.7 and game.adventure.has_method("take_damage"):
					game.adventure.take_damage(float(actor.get_meta("damage", 12.0)), kind)
			if _time - phase_started >= 1.15:
				phase = "recovery"
		if phase == "recovery":
			actor.set_meta("combat_progress", 0.8 + clampf((_time - phase_started - 1.15) / 1.1, 0.0, 1.0) * 0.2)
			if _time - phase_started >= 2.25:
				phase = "idle"
				actor.set_meta("planet_attack_at", _time + (1.5 if kind == "golem" else 0.6))
		actor.set_meta("planet_attack_phase", phase)
		actor.set_meta("combat_phase", phase)

func _actor_path_clear(actor: Node3D, from_direction: Vector3, to_direction: Vector3) -> bool:
	if game == null or not game.is_inside_tree():
		return true
	var from: Vector3 = center + fields.surface_point(from_direction) + from_direction * 0.6
	var to: Vector3 = center + fields.surface_point(to_direction) + to_direction * 0.6
	var query := PhysicsRayQueryParameters3D.create(from, to, 1)
	var result: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(query)
	return result.is_empty() or result.get("collider") == actor

func snapshot() -> Dictionary:
	ensure_built()
	return {"version": 1, "seed": seed, "radius": radius, "fields": fields.snapshot(), "gameplay": gameplay.snapshot(), "encounters": _encounter_commands.duplicate(true)}

func save() -> bool:
	if _diagnostic():
		return true
	var payload := JSON.stringify(snapshot())
	var temporary := SAVE_PATH + ".tmp"
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		_log("save failed open error=%d" % FileAccess.get_open_error())
		return false
	file.store_string(payload)
	file.close()
	var error := DirAccess.rename_absolute(ProjectSettings.globalize_path(temporary), ProjectSettings.globalize_path(SAVE_PATH))
	if error != OK:
		_log("save failed rename error=%d" % error)
		return false
	return true

func _restore() -> bool:
	if _diagnostic():
		return false
	if not FileAccess.file_exists(SAVE_PATH):
		return false
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		_log("restore failed open error=%d" % FileAccess.get_open_error())
		return false
	var data = JSON.parse_string(file.get_as_text())
	file.close()
	if not data is Dictionary or int(data.get("version", 0)) != 1:
		_log("restore invalid document")
		return false
	if not fields.load_snapshot(data.get("fields", {})):
		_log("restore invalid fields")
		return false
	seed = fields.seed
	radius = fields.radius
	if not gameplay.load_snapshot(data.get("gameplay", {})):
		_log("restore invalid gameplay")
		return false
	for entry in data.get("encounters", []):
		if not entry is Dictionary:
			continue
		var components: Array = entry.get("direction", [])
		if components.size() != 3:
			continue
		var action := str(entry.get("action", ""))
		if ENCOUNTERS.has(action):
			_cast_encounter(action, center + Vector3(float(components[0]), float(components[1]), float(components[2])) * radius, false)
			_encounter_commands.append(entry.duplicate(true))
	return true

func reset() -> bool:
	if not _backup_state(): return false
	if not _diagnostic() and not _delete_saved_state(SAVE_PATH): return false
	leave()
	_clear_reset_transients()
	if built:
		for node in gameplay.placed:
			if not is_instance_valid(node) or game == null: continue
			# Mining keeps authored ore by instance ID outside the planet root. Drop
			# those references before the old ore is queued for deletion/rebuilt.
			if game.get("mining") != null and game.mining.get("deposits") != null:
				game.mining.deposits.entries.erase(node.get_instance_id())
			if game.get("scene") == null: continue
			for collection in ["enemies", "rats", "resources"]:
				if game.scene.get(collection) is Array:
					game.scene[collection].erase(node)
			if game.get("firecraft") != null:
				game.firecraft.ghosts.erase(node)
			if game.get("animation") != null:
				game.animation.actors.erase(node.get_instance_id())
		for child in root.get_children():
			child.queue_free()
		built = false
		fields = null
		terrain = null
		gameplay = null
		art = null
		weather = null
		dressing = null
		_water_mesh = null
		_water_revision = -1
	_encounter_commands.clear()
	ensure_built()
	_log("reset")
	return true

func _backup_state() -> bool:
	if _diagnostic(): return true
	return _backup_state_path(SAVE_PATH)

func _backup_state_path(path: String) -> bool:
	_last_reset_backup = ""
	if not FileAccess.file_exists(path): return not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(path))
	var source := FileAccess.open(path, FileAccess.READ)
	if source == null:
		_log("reset backup failed open error=%d" % FileAccess.get_open_error())
		return false
	var length := source.get_length()
	var contents := source.get_buffer(length)
	source.close()
	if contents.size() != length:
		_log("reset backup failed read")
		return false
	var stamp := Time.get_datetime_string_from_system().replace(":", "-")
	var destination := "%s.backup-%s-%d.json" % [path.get_basename(), stamp, Time.get_ticks_usec()]
	var temporary := destination + ".tmp"
	var backup := FileAccess.open(temporary, FileAccess.WRITE)
	if backup == null:
		_log("reset backup failed write error=%d" % FileAccess.get_open_error())
		return false
	backup.store_buffer(contents)
	backup.flush()
	var error := backup.get_error()
	backup.close()
	if error != OK:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(temporary))
		_log("reset backup failed flush error=%d" % error)
		return false
	error = DirAccess.rename_absolute(ProjectSettings.globalize_path(temporary), ProjectSettings.globalize_path(destination))
	if error != OK:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(temporary))
		_log("reset backup failed rename error=%d" % error)
		return false
	var verify := FileAccess.open(destination, FileAccess.READ)
	if verify == null:
		_log("reset backup failed verification open")
		return false
	var copied := verify.get_buffer(verify.get_length())
	verify.close()
	if copied != contents:
		_log("reset backup failed verification content")
		return false
	_last_reset_backup = destination
	_log("reset backup created %s" % destination)
	return true

func _delete_saved_state(path: String) -> bool:
	var absolute := ProjectSettings.globalize_path(path)
	if DirAccess.dir_exists_absolute(absolute):
		_log("reset save path is a directory")
		return false
	if not FileAccess.file_exists(path): return true
	var error := DirAccess.remove_absolute(absolute)
	if error != OK:
		_log("reset save deletion failed error=%d" % error)
		return false
	return true

func _clear_reset_transients() -> void:
	if game == null: return
	var role = game.get("god_role")
	if role != null:
		role.stop_rat_stream()
		for index in range(role.rats.size() - 1, -1, -1):
			var rat: Node3D = role.rats[index]
			if not is_instance_valid(rat) or str(rat.get_meta("zone", "")) != ZONE: continue
			if bool(rat.get_meta("god_role_full", false)): role._full_count = maxi(0, role._full_count - 1)
			else: role._remove_far_rat(rat)
			if game.get("scene") != null: game.scene.rats.erase(rat)
			if game.get("animation") != null: game.animation.actors.erase(rat.get_instance_id())
			role.rats.remove_at(index)
			rat.queue_free()
		for index in range(role.motes.size() - 1, -1, -1):
			var mote: Dictionary = role.motes[index]
			if str(mote.get("zone", "")) != ZONE: continue
			if is_instance_valid(mote.get("node", null)): mote.node.queue_free()
			role.motes.remove_at(index)
		role._motion_cursor = 0
	var worker_module = game.get("god_workers")
	if worker_module != null:
		for entry in worker_module.workers:
			if is_instance_valid(entry.get("node", null)): entry.node.queue_free()
		worker_module.workers.clear()

func _log(message: String) -> void:
	if _diagnostic():
		return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("user://logs"))
	var file := FileAccess.open(LOG_PATH, FileAccess.READ_WRITE if FileAccess.file_exists(LOG_PATH) else FileAccess.WRITE)
	if file == null:
		return
	file.seek_end()
	file.store_line("%s %s" % [Time.get_datetime_string_from_system(), message])
	file.close()

func _diagnostic() -> bool:
	return game != null and (bool(game.get("diagnostic_offline")) or bool(game.get("smoke")))
