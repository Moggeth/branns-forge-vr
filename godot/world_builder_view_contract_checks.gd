extends SceneTree
## Native, save-free dual-view and targeting contract. No Main or service startup.

const View = preload("res://world_builder_view.gd")
const Pip = preload("res://world_builder_pip.gd")
const Targeting = preload("res://world_builder_targeting.gd")
const Spells = preload("res://world_builder_spells.gd")
const Fields = preload("res://landscape_fields.gd")
const Ecology = preload("res://landscape_ecology.gd")

class LandscapeFixture extends Node:
	const MAX_OPERATIONS := 128
	const CHUNK_CELLS := 32
	var model: Dictionary = {}
	var seed := 814
	var world_revision := 0
	var edits := 0
	func operation_count() -> int: return edits

class GameFixture extends Node3D:
	var vr := false
	var desktop_look = null
	var diagnostic_offline := true
	var landscape: LandscapeFixture
	var camera: Camera3D

class BuilderFixture extends Node:
	const MAX_FOREST_SPELLS := 64
	const MAX_THREATS := 8
	var center := Vector3.ZERO
	var data := {"mana": 20.0, "wood": 20, "revision": 0, "forest_spells": [], "groves": [], "meteors": [], "ent_seeds": [], "threats": []}
	func can_path(a: Vector3, b: Vector3) -> String: return "" if a.distance_to(b) >= 3.0 else "Choose a longer route."
	func _inside(_point: Vector3) -> bool: return true
	func _pack(point: Vector3) -> Array: return [snappedf(point.x, 0.1), snappedf(point.z, 0.1)]

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game := GameFixture.new()
	root.add_child(game)
	game.landscape = LandscapeFixture.new()
	game.add_child(game.landscape)
	game.camera = Camera3D.new()
	game.add_child(game.camera)
	var view: Window = View.new()
	view.visible = false
	root.add_child(view)
	view.game = game
	view.companion_mode = true  # fixture never changes the root 3D scale
	view.tactical_viewport = SubViewport.new()
	view.tactical_viewport.size = Vector2i(640, 400)
	view.add_child(view.tactical_viewport)
	view.world_picture = TextureRect.new()
	view.add_child(view.world_picture)
	view.hero_pip = Pip.new()
	view.hero_pip.position = Vector2(400, 80)
	view.hero_pip.size = Vector2(410, 263)
	view.add_child(view.hero_pip)
	view.hero_pip.setup(game.get_viewport().get_texture())
	view._apply_primary_textures()
	if view.world_picture.texture != view.tactical_viewport.get_texture(): failures.append("RTS primary texture")
	if view.hero_pip.picture.texture != game.get_viewport().get_texture(): failures.append("Hero inset texture")
	view.swap_primary()
	if not view.hero_primary: failures.append("swap primary state")
	if view.world_picture.texture != game.get_viewport().get_texture(): failures.append("Hero primary texture")
	if view.hero_pip.picture.texture != view.tactical_viewport.get_texture(): failures.append("RTS inset texture")
	if view.hero_pip.get_children().filter(func(n: Node) -> bool: return n is SubViewport or n is Camera3D).size() != 0:
		failures.append("inset allocated a third renderer")
	var content: Rect2 = view.hero_pip.content_rect_screen()
	if not view.hero_pip.contains_screen_point(content.get_center()): failures.append("inset hit region")
	for entry in Spells.catalogue():
		if bool(entry.get("implemented", true)) and not Targeting.is_targetable(entry): failures.append("missing target plan: " + str(entry.id))
		if not bool(entry.get("implemented", true)) and Targeting.is_targetable(entry): failures.append("unavailable target plan: " + str(entry.id))
	var builder := BuilderFixture.new()
	root.add_child(builder)
	var path: Dictionary = Targeting.plan("path", Vector3.ZERO, Vector3(14, 0, 0), builder, game, "")
	if not path.valid or int(path.cost) != 2 or float(path.width) != 4.0 or float(path.paint_width) != 9.0:
		failures.append("path plan cost or painted footprint")
	var short_path: Dictionary = Targeting.plan("path", Vector3.ZERO, Vector3(2, 0, 0), builder, game, "")
	if short_path.valid: failures.append("short path was shown as castable")
	var ring: Dictionary = Targeting.spec("ring")
	if float(ring.inner) != 14.0 or float(ring.outer) != 24.0: failures.append("tree ring annulus bounds")
	var model: Dictionary = Fields.create(814)
	var water := PackedFloat32Array()
	water.resize(int(model.size) * int(model.size))
	model["water"] = water
	Ecology.build_fields(model)
	game.landscape.model = model
	var ring_at := Vector3(60, 0, 45)
	var ring_started := Time.get_ticks_usec()
	var planned_ring: Dictionary = Targeting.plan("ring", Vector3.INF, ring_at, builder, game, "")
	var ring_ms := (Time.get_ticks_usec() - ring_started) / 1000.0
	var actual_ring: Array[Dictionary] = Ecology.grow_ring(model, Vector2(60, 45), 19.0, 814 + 8357)
	if actual_ring.size() < 10: failures.append("fixture ring is not a valid positive case")
	if planned_ring.valid != (actual_ring.size() >= 10): failures.append("ring validity differs from pure ecology")
	if planned_ring.valid and planned_ring.get("tree_positions", []).size() != mini(actual_ring.size(), 30): failures.append("ring ghost count differs")
	var forest_a := Vector3(-95, 0, 55)
	var forest_b := Vector3(-35, 0, 75)
	var forest_started := Time.get_ticks_usec()
	var planned_forest: Dictionary = Targeting.plan("forest", forest_a, forest_b, builder, game, "")
	var forest_ms := (Time.get_ticks_usec() - forest_started) / 1000.0
	var forest_region := {"type":"line", "points":[builder._pack(forest_a), builder._pack(forest_b)], "width":11.0}
	var actual_forest: Array[Dictionary] = Ecology.grow(model, forest_region, 814 + 7501)
	if actual_forest.is_empty(): failures.append("fixture forest is not a valid positive case")
	if planned_forest.valid != not actual_forest.is_empty(): failures.append("forest validity differs from pure ecology")
	if planned_forest.valid and planned_forest.get("tree_positions", []).size() != mini(actual_forest.size(), 30): failures.append("forest ghost count differs")
	var flooded := PackedFloat32Array()
	flooded.resize(water.size())
	flooded.fill(1.0)
	model["water"] = flooded
	game.landscape.world_revision += 1
	if Targeting.plan("ring", Vector3.INF, ring_at, builder, game, "").valid: failures.append("flooded ring showed valid")
	if Targeting.plan("forest", forest_a, forest_b, builder, game, "").valid: failures.append("flooded forest showed valid")
	game.landscape.edits = game.landscape.MAX_OPERATIONS
	if Targeting.plan("raise", Vector3.INF, Vector3.ZERO, builder, game, "").valid: failures.append("full landscape ledger showed valid raise")
	game.landscape.edits = 0
	if not Targeting.plan("raise", Vector3.INF, Vector3.ZERO, builder, game, "").valid: failures.append("valid hill rejected")
	if Targeting.plan("raise", Vector3.INF, Vector3(145, 0, 0), builder, game, "").valid: failures.append("out-of-bounds raised hill showed valid")
	view.queue_free()
	game.queue_free()
	builder.queue_free()
	await process_frame
	print("WORLD_BUILDER_VIEW_CONTRACT ", JSON.stringify({"failures": failures, "ring_query_ms": ring_ms, "forest_query_ms": forest_ms}))
	quit(0 if failures.is_empty() else 1)
