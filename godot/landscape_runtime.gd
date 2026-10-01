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
const WorldDocument = preload("res://landscape_world_document.gd")
const Compiler = preload("res://landscape_compiler.gd")
const VisualEvents = preload("res://landscape_visual_events.gd")
const OrchardVisualKit = preload("res://orchard_visual_kit.gd")
const Ground = preload("res://orchard_ground.gd")
const SAVE := "user://landscape_v1.json"
const CHUNK_CELLS := 32
const MAX_OPERATIONS := 256

signal visual_event(payload: Dictionary)

var game: Node3D
var zone_root: Node3D
var model: Dictionary = {}
var seed := 290929
var recipe := "gentle_orchard"
var operations: Array = []
var document: Dictionary = {}
var chunks: Dictionary = {}
var water: Node3D
var dressing: Node3D
var reprojection
var save_enabled := true
var transition: Dictionary = {}
var active_visual_event: Dictionary = {}
var last_rebuild_ms := 0.0
var last_operation_ms := 0.0
var last_settle_ms := 0.0
var last_hydrology_ms := 0.0
var last_compile_stages: Dictionary = {}
var world_revision := 0
var pending_hydrology: Dictionary = {}
var deferred_hydrology_bounds := Rect2()
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
	document = WorldDocument.create(seed, recipe)
	if save_enabled: _load_operations()
	if not operations.is_empty():
		model["height"] = Ops.apply(model, operations)
		# Startup may spend the full watershed solve once, before gameplay frames.
		Hydro.refresh_after_terrain_change(model, Rect2(Vector2(-160, -160), Vector2(320, 320)))
	_rebuild_exposure_from_operations()
	Fields.derive(model)
	Ecology.build_fields(model)
	Ground.sync_bank(model)
	for cz in range((int(model.size) - 1) / CHUNK_CELLS):
		for cx in range((int(model.size) - 1) / CHUNK_CELLS):
			_rebuild_chunk(Vector2i(cx, cz))
	water = Water.new()
	add_child(water)
	water.setup(model)
	dressing = SpellDressing.new()
	add_child(dressing)
	dressing.setup(model, operations)
	OrchardVisualKit.populate(self, model)
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


func get_visual_history_events() -> Array[Dictionary]:
	# The presenter connects after setup, so expose a snapshot on demand rather
	# than emitting restore events while the saved world is being loaded.
	var events: Array[Dictionary] = []
	if zone_root == null or operations.is_empty() or operations.size() > MAX_OPERATIONS:
		return events
	var saved: Array = document.get("operations", [])
	if saved.size() != operations.size(): return events
	var size: int = int(model.get("size", 0))
	var step: float = float(model.get("step", 0.0))
	var natural: PackedFloat32Array = model.get("natural_height", PackedFloat32Array())
	if size < 2 or step <= 0.0 or natural.size() != size * size: return events
	var origin: Vector2 = model.get("origin", Vector2.ZERO)
	var stage: Dictionary = model.duplicate(false)
	stage["height"] = natural.duplicate()
	for index in range(operations.size()):
		var op: Dictionary = operations[index]
		var record: Dictionary = saved[index]
		var before: PackedFloat32Array = stage.height
		var target: PackedFloat32Array = Ops.apply(stage, [op])
		var box: Rect2 = Ops.bounds(op)
		var x0 := clampi(floori((box.position.x - origin.x) / step), 0, size - 1)
		var z0 := clampi(floori((box.position.y - origin.y) / step), 0, size - 1)
		var x1 := clampi(ceili((box.end.x - origin.x) / step), 0, size - 1)
		var z1 := clampi(ceili((box.end.y - origin.y) / step), 0, size - 1)
		var changed := PackedInt32Array()
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var cell: int = z * size + x
				if absf(target[cell] - before[cell]) > 0.001: changed.append(cell)
		if not changed.is_empty():
			var staged_transition := {"before": before, "target": target, "indices": changed,
				"bounds": box, "duration": 1.35 if str(op.type) == "sunder" else 1.1}
			var event: Dictionary = VisualEvents.started(op, str(record.get("id", "")), seed,
				staged_transition, model, zone_root, _visual_quality_budget())
			if not event.is_empty():
				event["phase"] = "restore"
				event["progress"] = 1.0
				event["eased_progress"] = 1.0
				events.append(event)
		stage["height"] = target
	return events

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
	var written: Dictionary = WorldDocument.append(document, raw)
	if not bool(written.get("ok", false)): return "The world cannot record that spell: " + str(written.get("error", "unknown error"))
	document = written.document
	operations = WorldDocument.replay_operations(document)
	world_revision += 1
	_save_operations()
	var target_model: Dictionary = model.duplicate(false)
	target_model["height"] = target
	if dressing != null: dressing.add_operation(raw, target_model, 1.35 if str(raw.type) == "sunder" else 1.1)
	transition = {"before": before, "target": target, "indices": changed, "dirty": dirty,
		"bounds": box, "elapsed": 0.0, "duration": 1.35 if str(raw.type) == "sunder" else 1.1,
		"rebuild_elapsed": 0.0, "type": str(raw.type), "exposure_applied": false}
	var operation_id: String = str((document.operations as Array).back().get("id", ""))
	active_visual_event = VisualEvents.started(raw, operation_id, seed, transition, model, zone_root, _visual_quality_budget())
	if not active_visual_event.is_empty(): visual_event.emit(active_visual_event.duplicate(false))
	last_operation_ms = float(Time.get_ticks_usec() - start) / 1000.0
	print("LANDSCAPE_OP type=", raw.type, " cells=", changed.size(), " chunks=", dirty.size(), " target_ms=", snappedf(last_operation_ms, 0.01))
	return ""

func apply_impact_magic(raw: Dictionary) -> String:
	# Starfall needs its crater at contact, before debris and post-impact physics.
	# Keep the normal operation journal and events, but finish this one in-frame.
	var previous_ground := _player_ground()
	var result := apply_magic(raw)
	if result.is_empty():
		_finish_transition(true)
		_lift_player(previous_ground)
	return result

func undo_last() -> bool:
	if operations.is_empty(): return false
	if not transition.is_empty(): _finish_transition()
	var op: Dictionary = operations.back()
	var removed_id: String = str((document.operations as Array).back().get("id", ""))
	var result: Dictionary = WorldDocument.remove_last(document)
	if not bool(result.get("ok", false)): return false
	document = result.document
	operations = WorldDocument.replay_operations(document)
	world_revision += 1
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
		"bounds": box, "elapsed": 0.0, "duration": 0.8, "rebuild_elapsed": 0.0,
		"type": "undo", "exposure_applied": false}
	active_visual_event = VisualEvents.started(op, removed_id, seed, transition, model, zone_root, _visual_quality_budget())
	if not active_visual_event.is_empty():
		active_visual_event["direction"] = "reverse"
		visual_event.emit(active_visual_event.duplicate(false))
	return true

func _process(delta: float) -> void:
	_poll_hydrology()
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
	if t >= 0.25: _paint_transition_exposure()
	if not active_visual_event.is_empty(): visual_event.emit(VisualEvents.advance(active_visual_event, "animating", t))
	_lift_player(old_player_ground)
	_settle_player(delta)
	if float(transition.rebuild_elapsed) >= 0.085 or t >= 1.0:
		transition.rebuild_elapsed = 0.0
		var stamp := Time.get_ticks_usec()
		for key in transition.dirty: _rebuild_chunk(key)
		if reprojection != null: reprojection.refresh_region(zone_root.get_parent() as Node3D, model, transition.bounds)
		last_rebuild_ms = float(Time.get_ticks_usec() - stamp) / 1000.0
	if t >= 1.0: _finish_transition()

func _finish_transition(immediate_collision: bool = false) -> void:
	if transition.is_empty(): return
	_paint_transition_exposure()
	var started := Time.get_ticks_usec()
	model["height"] = transition.target
	var box: Rect2 = transition.bounds
	if float(transition.elapsed) < float(transition.duration):
		for key in transition.dirty: _rebuild_chunk(key, immediate_collision)
	Fields.derive_region(model, box)
	# Height/collision move first. The drainage graph is calculated from an
	# isolated snapshot, then merged only if no newer spell superseded it.
	var hydro_box: Rect2 = box if not deferred_hydrology_bounds.has_area() else box.merge(deferred_hydrology_bounds)
	deferred_hydrology_bounds = Rect2()
	_start_hydrology(hydro_box)
	if reprojection != null: reprojection.refresh_region(zone_root.get_parent() as Node3D, model, box)
	if dressing != null: dressing.refresh_region(model, box)
	last_settle_ms = float(Time.get_ticks_usec() - started) / 1000.0
	print("LANDSCAPE_SETTLED type=", transition.type, " dirty_chunks=", transition.dirty.size(), " geometry_ms=", snappedf(last_settle_ms, 0.01), " hydro_pending=", not pending_hydrology.is_empty())
	if not active_visual_event.is_empty(): visual_event.emit(VisualEvents.advance(active_visual_event, "settled", 1.0))
	active_visual_event.clear()
	transition.clear()


func _paint_transition_exposure() -> void:
	if transition.is_empty() or bool(transition.get("exposure_applied", false)): return
	transition["exposure_applied"] = true
	if str(transition.type) == "undo":
		_rebuild_exposure_from_operations()
		return
	var before_model: Dictionary = model.duplicate(false)
	before_model["height"] = transition.before
	var target_model: Dictionary = model.duplicate(false)
	target_model["height"] = transition.target
	Ground.apply_exposure_delta(before_model, target_model, transition.bounds, str(transition.type))


func _rebuild_exposure_from_operations() -> void:
	Ground.reset_exposure()
	if operations.is_empty(): return
	var stage: Dictionary = model.duplicate(false)
	stage["height"] = (model.natural_height as PackedFloat32Array).duplicate()
	for op in operations:
		var next_height: PackedFloat32Array = Ops.apply(stage, [op])
		var target_stage: Dictionary = stage.duplicate(false)
		target_stage["height"] = next_height
		Ground.apply_exposure_delta(stage, target_stage, Ops.bounds(op), str(op.get("type", "")))
		stage = target_stage


func _visual_quality_budget() -> Dictionary:
	# Fixed bounded event data for the visual presenter; the artist owns its
	# quality-tier implementation, while terrain/collision never depend on it.
	return {"max_terrain_samples": 384, "max_live_debris": 36, "max_dust_particles": 160,
		"max_temporary_lights": 2, "max_effect_seconds": 4.0}


func _start_hydrology(bounds: Rect2) -> void:
	# One worker at a time. A newer edit may invalidate its result; in that case
	# the next frame schedules a fresh snapshot against the latest heightfield.
	if not pending_hydrology.is_empty():
		var pending_box: Rect2 = pending_hydrology.reschedule_bounds
		pending_hydrology.reschedule_bounds = bounds if not pending_box.has_area() else pending_box.merge(bounds)
		return
	var snapshot: Dictionary = Hydro.isolated_refresh_snapshot(model)
	var thread := Thread.new()
	var error: Error = thread.start(Callable(self, "_hydrology_worker").bind(snapshot, bounds))
	if error != OK:
		push_warning("Hydrology thread unavailable; completing watershed on main thread")
		var computed: Dictionary = _hydrology_worker(snapshot, bounds)
		_apply_hydrology(computed, world_revision, bounds)
		return
	pending_hydrology = {"thread":thread, "revision":world_revision, "bounds":bounds, "reschedule_bounds":Rect2(), "start":Time.get_ticks_usec()}


static func _hydrology_worker(snapshot: Dictionary, bounds: Rect2) -> Dictionary:
	var stats: Dictionary = Hydro.refresh_after_terrain_change(snapshot, bounds)
	return {"snapshot":snapshot, "stats":stats}


func _poll_hydrology() -> void:
	if pending_hydrology.is_empty(): return
	var thread: Thread = pending_hydrology.thread
	if thread.is_alive(): return
	var record: Dictionary = pending_hydrology
	pending_hydrology = {}
	var computed: Dictionary = thread.wait_to_finish()
	if int(record.revision) == world_revision:
		_apply_hydrology(computed, int(record.revision), record.bounds)
	else:
		var reschedule: Rect2 = record.reschedule_bounds
		var stale_bounds: Rect2 = record.bounds if not reschedule.has_area() else record.bounds.merge(reschedule)
		if transition.is_empty(): _start_hydrology(stale_bounds)
		else: deferred_hydrology_bounds = stale_bounds if not deferred_hydrology_bounds.has_area() else deferred_hydrology_bounds.merge(stale_bounds)


func _exit_tree() -> void:
	if not pending_hydrology.is_empty():
		var thread: Thread = pending_hydrology.thread
		thread.wait_to_finish()


func _apply_hydrology(computed: Dictionary, revision: int, bounds: Rect2) -> void:
	if revision != world_revision: return
	var source: Dictionary = computed.get("snapshot", {})
	for field in ["flow_direction", "flow_accumulation", "flow_surface", "water", "water_level", "hydrology_pool", "moisture", "hydrology_last_height"]:
		if source.has(field): model[field] = source[field]
	var stats: Dictionary = computed.get("stats", {})
	var dirty: Rect2 = stats.get("water_dirty", bounds)
	var stamp := Time.get_ticks_usec()
	Ground.sync_bank(model, dirty)
	last_compile_stages = Compiler.settle_after_hydrology(model, dirty, water)
	OrchardVisualKit.populate(self, model)
	last_hydrology_ms = float(Time.get_ticks_usec() - stamp) / 1000.0
	print("LANDSCAPE_HYDRO revision=", revision, " solve_ms=", snappedf(float(stats.get("elapsed_ms", 0.0)), 0.01), " main_ms=", snappedf(last_hydrology_ms, 0.01), " stages=", last_compile_stages, " changed_water=", stats.get("changed_water_cells", 0))

func _player_ground() -> float:
	if game == null or game.rig == null: return NAN
	var tracked: Vector3 = game.camera.global_position if game.vr else game.rig.global_position
	var local: Vector3 = zone_root.to_local(tracked)
	if absf(local.x) > 155.0 or absf(local.z) > 155.0: return NAN
	return height_at(Vector2(local.x, local.z))

func _lift_player(previous: float) -> void:
	if not is_finite(previous): return
	var now := _player_ground()
	if now > previous and game.rig.global_position.y < zone_root.global_position.y + now + 0.45:
		var raised: Vector3 = game.rig.global_position + Vector3.UP * (now - previous)
		if game._player_capsule_clear(raised):
			game.rig.global_position = raised
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
	if not game._player_capsule_clear(pos): return
	game.rig.global_position = pos
	if pos.y <= floor_y + 0.01:
		_falling_with_earth = false
		_fall_speed = 0.0

func _rebuild_chunk(key: Vector2i, immediate_collision: bool = false) -> void:
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
	if is_inside_tree() and not immediate_collision: (record.collider as CollisionShape3D).set_deferred("shape", shape)
	else: (record.collider as CollisionShape3D).shape = shape

func _load_operations() -> void:
	var loaded: Dictionary = WorldDocument.load_document(SAVE, seed, recipe)
	if not bool(loaded.get("ok", false)):
		save_enabled = false
		push_warning("LANDSCAPE save protected: " + str(loaded.get("error", "unknown error")))
		return
	document = loaded.document
	operations = WorldDocument.replay_operations(document)
	if bool(loaded.get("migrated", false)): _save_operations()

func _save_operations() -> void:
	if not save_enabled: return
	var result: Dictionary = WorldDocument.save(SAVE, document)
	if not bool(result.get("ok", false)):
		push_warning("LANDSCAPE save failed: " + str(result.get("error", "unknown error")))
