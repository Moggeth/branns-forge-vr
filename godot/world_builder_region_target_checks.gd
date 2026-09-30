extends SceneTree
## Isolated region-plan and floor-art contract. No main scene or user save.
const Targeting = preload("res://world_builder_targeting.gd")
const Art = preload("res://world_builder_targeting_art.gd")
const W = preload("res://world_zones.gd")
const ACTIONS = ["patrol", "duelist", "shield_patrol", "rat_swarm", "ghosts", "golem"]

class FakeLandscape extends RefCounted:
	var calls := 0
	func height_at(_point: Vector2) -> float:
		calls += 1
		return 99.0

class FakeGame extends Node3D:
	var scene := {"zones": {"pinewood_ruins": {"center": Vector3(-52, 0, 0)}}}
	var camera: Camera3D
	var landscape := FakeLandscape.new()

class FakeBuilder extends Node:
	const MAX_THREATS := 8
	var center := Vector3(-360, 0, 0)
	var data := {"threats": []}
	var calls: Array[Dictionary] = []
	var blocked := false
	func encounter_target_error(action: String, point: Vector3, zone: String = "") -> String:
		calls.append({"action": action, "point": point, "zone": zone})
		return "Blocked site." if blocked else ""

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	game.camera = Camera3D.new()
	game.add_child(game.camera)
	game.camera.global_position = Vector3(-52, 1.8, 11)
	W.body(game, Vector3(-52, -0.25, 0), Vector3(30, 0.5, 30), "floor")
	var builder := FakeBuilder.new()
	game.add_child(builder)
	var art := Art.new()
	game.add_child(art)
	art.setup(game)
	await physics_frame
	var colours := {}
	for action in ACTIONS:
		var point := Vector3(3, 0, -5)
		var plan: Dictionary = Targeting.plan(action, Vector3.INF, point, builder, game, "", "pinewood_ruins")
		if not plan.valid or plan.unit_positions.size() != int(plan.get("count", 3)): failures.append("encounter plan/formation %s" % action)
		var last: Dictionary = builder.calls.back()
		if str(last.action) != action or str(last.zone) != "pinewood_ruins" or last.point != Vector3(-49, 0, -5): failures.append("plan used Orchard coordinates %s" % action)
		var state := {"id": action, "zone": "pinewood_ruins", "valid": true, "hovered": point,
			"world_origin": Vector3(-52, 0, 0), "footprint": Targeting.spec(action),
			"unit_positions": plan.unit_positions, "hero_clearance_center": plan.hero_clearance_center}
		art.clear_preview()
		art.update_targeting(state)
		if not art.instance.visible or int(art.stats.triangles) <= 0: failures.append("missing region glyph %s" % action)
		if int(art.stats.height_samples) <= 0 or int(game.landscape.calls) != 0: failures.append("non-Orchard art queried Orchard terrain %s" % action)
		if art.mesh.get_surface_count() > 0:
			for surface in art.mesh.get_surface_count():
				var vertices: PackedVector3Array = art.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]
				for vertex in vertices:
					if vertex.y < 0.055: failures.append("region glyph below floor %s" % action); break
		colours[str(Art.PALETTE[action])] = true
		builder.blocked = true
		if Targeting.plan(action, Vector3.INF, point, builder, game, "", "pinewood_ruins").valid: failures.append("invalid region site previewed valid %s" % action)
		builder.blocked = false
	if colours.size() != ACTIONS.size(): failures.append("encounter colours are not distinct")
	print("WORLD_BUILDER_REGION_TARGET_RESULT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
