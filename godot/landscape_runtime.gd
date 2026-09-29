extends Node3D
## The Orchard's one authoritative terrain state. Generation, spells, collision,
## water, and ecology all consume registered fields in local X/Z metres.
const Fields = preload("res://landscape_fields.gd")
const Hydro = preload("res://landscape_hydrology.gd")
const Ops = preload("res://landscape_operations.gd")
const Ecology = preload("res://landscape_ecology.gd")
const Water = preload("res://landscape_water.gd")
const Reprojection = preload("res://landscape_reprojection.gd")
const SpellDressing = preload("res://landscape_spell_dressing.gd")
const SAVE := "user://landscape_v1.json"
const CHUNK_CELLS := 32
const MAX_OPERATIONS := 256

var game: Node3D
var zone_root: Node3D
var model: Dictionary = {}
var seed := 290929
var recipe := "gentle_orchard"
var operations: Array = []
var chunks: Dictionary = {}
var water: Node3D
var dressing: Node3D
var reprojection
var save_enabled := true
var transition: Dictionary = {}
var last_rebuild_ms := 0.0
var last_operation_ms := 0.0
var initial_ms := 0.0
var _falling_with_earth := false
var _fall_speed := 0.0

func setup(owner_game: Node3D, orchard_root: Node3D, offline := false) -> void:
	var start := Time.get_ticks_usec()
	game = owner_game
	zone_root = orchard_root
	save_enabled = not offline
	name = "LivingLandscape"
	zone_root.add_child(self)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--landscape-seed="): seed = int(arg.trim_prefix("--landscape-seed="))
		if arg.begins_with("--landscape-recipe=") and Fields.RECIPES.has(arg.trim_prefix("--landscape-recipe=")): recipe = arg.trim_prefix("--landscape-recipe=")
	if zone_root.has_meta("landscape_model"):
		model = zone_root.get_meta("landscape_model")
		seed = int(model.seed)
		recipe = str(model.recipe)
		zone_root.remove_meta("landscape_model")
	else:
		model = Fields.create(seed, recipe)
		var controls: Array[Vector2] = []
		Hydro.run(model, controls)
		Fields.derive(model)
	model["natural_height"] = (model.height as PackedFloat32Array).duplicate()
	if save_enabled: _load_operations()
	if not operations.is_empty(): model["height"] = Ops.apply(model, operations)
	Fields.derive(model)
	Ecology.build_fields(model)
	for cz in range((int(model.size) - 1) / CHUNK_CELLS):
		for cx in range((int(model.size) - 1) / CHUNK_CELLS):
			_rebuild_chunk(Vector2i(cx, cz))
	water = Water.new()
	add_child(water)
	water.setup(model)
	dressing = SpellDressing.new()
	add_child(dressing)
	dressing.setup(model, operations)
	reprojection = Reprojection.new()
	reprojection.setup(zone_root.get_parent() as Node3D, model)
	initial_ms = float(Time.get_ticks_usec() - start) / 1000.0
	print("LANDSCAPE_READY seed=", seed, " recipe=", recipe, " chunks=", chunks.size(), " ops=", operations.size(), " terrain_ms=", snappedf(initial_ms, 0.01))

func height_at(local: Vector2) -> float:
	return Fields.sample(model, "height", local)

func water_at(local: Vector2) -> float:
	return Fields.sample(model, "water", local)

func passable(local: Vector2) -> bool:
	return height_at(local) > -100.0 and Fields.sample(model, "traversability", local) > 0.22 and water_at(local) < 0.45

func operation_count() -> int:
	return operations.size()

func apply_magic(raw: Dictionary) -> String:
	if not Ops.validate(raw): return "The earth could not understand that shape."
	if operations.size() >= MAX_OPERATIONS: return "This landscape has reached its recorded spell limit."
	var box: Rect2 = Ops.bounds(raw)
	if box.position.x < -157.0 or box.position.y < -157.0 or box.end.x > 157.0 or box.end.y > 157.0:
		return "Keep the spell within the Orchard boundary."
	if not transition.is_empty(): _finish_transition()
	var start := Time.get_ticks_usec()
	var before: PackedFloat32Array = (model.height as PackedFloat32Array).duplicate()
	var target: PackedFloat32Array = Ops.apply(model, [raw])
	var dirty: Array[Vector2i] = Ops.affected_chunks(raw, model, CHUNK_CELLS)
	if dirty.is_empty(): return "That spell missed the landscape."
	var x0 := clampi(floori((box.position.x - model.origin.x) / model.step), 0, int(model.size) - 1)
	var z0 := clampi(floori((box.position.y - model.origin.y) / model.step), 0, int(model.size) - 1)
	var x1 := clampi(ceili((box.end.x - model.origin.x) / model.step), 0, int(model.size) - 1)
	var z1 := clampi(ceili((box.end.y - model.origin.y) / model.step), 0, int(model.size) - 1)
	var changed := PackedInt32Array()
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			var i: int = z * int(model.size) + x
			if absf(target[i] - before[i]) > 0.001: changed.append(i)
	if changed.is_empty(): return "The land was already shaped that way."
	operations.append(raw.duplicate(true))
	_save_operations()
	var target_model: Dictionary = model.duplicate(false)
	target_model["height"] = target
	if dressing != null: dressing.add_operation(raw, target_model, 1.35 if str(raw.type) == "sunder" else 1.1)
	transition = {"before": before, "target": target, "indices": changed, "dirty": dirty,
		"bounds": box, "elapsed": 0.0, "duration": 1.35 if str(raw.type) == "sunder" else 1.1,
		"rebuild_elapsed": 0.0, "type": str(raw.type)}
	last_operation_ms = float(Time.get_ticks_usec() - start) / 1000.0
	print("LANDSCAPE_OP type=", raw.type, " cells=", changed.size(), " chunks=", dirty.size(), " target_ms=", snappedf(last_operation_ms, 0.01))
	return ""

func undo_last() -> bool:
	if operations.is_empty(): return false
	if not transition.is_empty(): _finish_transition()
	var op: Dictionary = operations.pop_back()
	_save_operations()
	if dressing != null: dressing.remove_last()
	var box := Ops.bounds(op)
	var before: PackedFloat32Array = (model.height as PackedFloat32Array).duplicate()
	model["height"] = (model.natural_height as PackedFloat32Array).duplicate()
	var target: PackedFloat32Array = Ops.apply(model, operations)
	model["height"] = before
	var dirty: Array[Vector2i] = Ops.affected_chunks(op, model, CHUNK_CELLS)
	var changed := PackedInt32Array()
	for i in range(before.size()):
		if absf(before[i] - target[i]) > 0.001: changed.append(i)
	transition = {"before": before, "target": target, "indices": changed, "dirty": dirty,
		"bounds": box, "elapsed": 0.0, "duration": 0.8, "rebuild_elapsed": 0.0, "type": "undo"}
	return true

func _process(delta: float) -> void:
	if transition.is_empty():
		_settle_player(delta)
		return
	transition.elapsed = float(transition.elapsed) + delta
	transition.rebuild_elapsed = float(transition.rebuild_elapsed) + delta
	var t := clampf(float(transition.elapsed) / float(transition.duration), 0.0, 1.0)
	var eased := t * t * (3.0 - 2.0 * t)
	var old_player_ground := _player_ground()
	var heights: PackedFloat32Array = model.height
	var before: PackedFloat32Array = transition.before
	var target: PackedFloat32Array = transition.target
	for i in transition.indices:
		heights[i] = lerpf(before[i], target[i], eased)
	model["height"] = heights
	_lift_player(old_player_ground)
	_settle_player(delta)
	if float(transition.rebuild_elapsed) >= 0.085 or t >= 1.0:
		transition.rebuild_elapsed = 0.0
		var stamp := Time.get_ticks_usec()
		for key in transition.dirty: _rebuild_chunk(key)
		if reprojection != null: reprojection.refresh_region(zone_root.get_parent() as Node3D, model, transition.bounds)
		last_rebuild_ms = float(Time.get_ticks_usec() - stamp) / 1000.0
	if t >= 1.0: _finish_transition()

func _finish_transition() -> void:
	if transition.is_empty(): return
	model["height"] = transition.target
	var box: Rect2 = transition.bounds
	for key in transition.dirty: _rebuild_chunk(key)
	Fields.derive(model)
	Ecology.build_fields(model, box)
	if water != null: water.refresh_region(model, box)
	if reprojection != null: reprojection.refresh_region(zone_root.get_parent() as Node3D, model, box)
	if dressing != null: dressing.refresh_region(model, box)
	print("LANDSCAPE_SETTLED type=", transition.type, " dirty_chunks=", transition.dirty.size(), " last_rebuild_ms=", snappedf(last_rebuild_ms, 0.01))
	transition.clear()

func _player_ground() -> float:
	if game == null or game.rig == null: return NAN
	var local: Vector3 = game.rig.global_position - zone_root.global_position
	if absf(local.x) > 155.0 or absf(local.z) > 155.0: return NAN
	return height_at(Vector2(local.x, local.z))

func _lift_player(previous: float) -> void:
	if not is_finite(previous): return
	var now := _player_ground()
	if now > previous and game.rig.global_position.y < zone_root.global_position.y + now + 0.45:
		game.rig.global_position += Vector3.UP * (now - previous)
		_falling_with_earth = false
		_fall_speed = 0.0
	elif now < previous - 0.001 and game.rig.global_position.y < zone_root.global_position.y + previous + 0.45:
		_falling_with_earth = true

func _settle_player(delta: float) -> void:
	if not _falling_with_earth: return
	var ground := _player_ground()
	if not is_finite(ground): _falling_with_earth = false; return
	var floor_y: float = zone_root.global_position.y + ground + 0.02
	_fall_speed = minf(_fall_speed + 9.8 * delta, 9.5)
	var pos: Vector3 = game.rig.global_position
	pos.y = maxf(floor_y, pos.y - _fall_speed * delta)
	game.rig.global_position = pos
	if pos.y <= floor_y + 0.01:
		_falling_with_earth = false
		_fall_speed = 0.0

func _rebuild_chunk(key: Vector2i) -> void:
	var size: int = model.size
	var step: float = model.step
	var origin: Vector2 = model.origin
	var first_x := key.x * CHUNK_CELLS
	var first_z := key.y * CHUNK_CELLS
	var last_x := mini(first_x + CHUNK_CELLS, size - 1)
	var last_z := mini(first_z + CHUNK_CELLS, size - 1)
	var heights: PackedFloat32Array = model.height
	var width := last_x - first_x + 1
	var depth := last_z - first_z + 1
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var indices := PackedInt32Array()
	var faces := PackedVector3Array()
	vertices.resize(width * depth)
	normals.resize(width * depth)
	indices.resize((width - 1) * (depth - 1) * 6)
	faces.resize(indices.size())
	for z in range(first_z, last_z + 1):
		var row := z * size
		var north_row := maxi(z - 1, 0) * size
		var south_row := mini(z + 1, size - 1) * size
		for x in range(first_x, last_x + 1):
			var grid_index := row + x
			var vertex_index := (z - first_z) * width + x - first_x
			vertices[vertex_index] = Vector3(origin.x + x * step, heights[grid_index], origin.y + z * step)
			normals[vertex_index] = Vector3(
				heights[row + maxi(x - 1, 0)] - heights[row + mini(x + 1, size - 1)],
				step * 2.0,
				heights[north_row + x] - heights[south_row + x]
			).normalized()
	var face_index := 0
	for z in range(depth - 1):
		for x in range(width - 1):
			var a := z * width + x
			var b := a + 1
			var c := a + width
			var d := c + 1
			# Keep the original face order: Godot's concave collider hits its upper side.
			indices[face_index] = a
			indices[face_index + 1] = b
			indices[face_index + 2] = c
			indices[face_index + 3] = b
			indices[face_index + 4] = d
			indices[face_index + 5] = c
			faces[face_index] = vertices[a]
			faces[face_index + 1] = vertices[b]
			faces[face_index + 2] = vertices[c]
			faces[face_index + 3] = vertices[b]
			faces[face_index + 4] = vertices[d]
			faces[face_index + 5] = vertices[c]
			face_index += 6
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var record: Dictionary = chunks.get(key, {})
	if record.is_empty():
		var visual := MeshInstance3D.new()
		visual.name = "Terrain_%d_%d" % [key.x, key.y]
		visual.material_override = preload("res://orchard_ground.gd").material()
		add_child(visual)
		var body := StaticBody3D.new()
		body.name = "TerrainCollision_%d_%d" % [key.x, key.y]
		# Layer 1 is Hero physics; layer 2 lets the survey select bare ground
		# through canopies, props and enemies without changing their collisions.
		body.collision_layer = 3
		body.set_meta("kind", "floor")
		add_child(body)
		var collider := CollisionShape3D.new()
		body.add_child(collider)
		record = {"visual": visual, "collider": collider}
		chunks[key] = record
	(record.visual as MeshInstance3D).mesh = mesh
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	if is_inside_tree(): (record.collider as CollisionShape3D).set_deferred("shape", shape)
	else: (record.collider as CollisionShape3D).shape = shape

func _load_operations() -> void:
	if not FileAccess.file_exists(SAVE): return
	var file := FileAccess.open(SAVE, FileAccess.READ)
	if file == null or file.get_length() > 262144: return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary or int(parsed.get("schema", 0)) != 1: return
	if int(parsed.get("seed", seed)) != seed or str(parsed.get("recipe", recipe)) != recipe: return
	var candidate: Variant = parsed.get("operations", [])
	if not candidate is Array or candidate.size() > MAX_OPERATIONS: return
	for op in candidate:
		if not op is Dictionary or not Ops.validate(op): return
	operations = candidate

func _save_operations() -> void:
	if not save_enabled: return
	var temp := SAVE + ".tmp"
	var file := FileAccess.open(temp, FileAccess.WRITE)
	if file == null: push_warning("LANDSCAPE save failed to open"); return
	file.store_string(JSON.stringify({"schema": 1, "seed": seed, "recipe": recipe, "operations": operations}))
	file.close()
	if DirAccess.rename_absolute(ProjectSettings.globalize_path(temp), ProjectSettings.globalize_path(SAVE)) != OK:
		push_warning("LANDSCAPE save replace failed")
