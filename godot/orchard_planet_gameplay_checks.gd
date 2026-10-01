extends SceneTree
const Fields = preload("res://orchard_planet_fields.gd")
const Gameplay = preload("res://orchard_planet_gameplay.gd")
const Terrain = preload("res://orchard_planet_terrain.gd")
const Deposits = preload("res://mining_deposits.gd")

class MockPlanet extends Node3D:
	var center := Vector3(12, -7, 31)
	var fields
	var terrain = null
	var game = null

class MockMining extends Node:
	var deposits: Node

class MockGame extends Node3D:
	var scene := {"resources": [], "enemies": [], "rats": []}
	var mining: Node
	var animation = null
	var world_builder = null

var failures: Array[String] = []

func check(condition: bool, message: String) -> void:
	if not condition: failures.append(message)

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var planet := MockPlanet.new()
	root.add_child(planet)
	planet.fields = Fields.new()
	planet.fields.setup(113, 85.0)
	var gameplay = Gameplay.new()
	planet.add_child(gameplay)
	gameplay.setup(planet)
	var point: Vector3 = planet.center + planet.fields.surface_point(Vector3.RIGHT)
	var outside: Vector3 = planet.center + planet.fields.surface_point(Vector3.LEFT)
	var before: float = planet.fields.height_at(Vector3.RIGHT)
	var preview: Dictionary = gameplay.preview("Raise", point)
	check(preview.get("ok", false), "Raise preview accepts a world surface point")
	check(preview.get("direction", Vector3.ZERO).distance_to(Vector3.RIGHT) < 0.0001, "World point converts to unit direction")
	check(preview.get("normal", Vector3.ZERO).dot(Vector3.RIGHT) > 0.5, "Preview normal follows spherical ground")
	var raised: Dictionary = gameplay.cast("Raise", point)
	check(raised.get("ok", false), "Raise operation applies")
	check(planet.fields.height_at(Vector3.RIGHT) > before + 1.0, "Raise changes the intended hemisphere")
	check(gameplay.preview("forest line", point, outside).get("length", 0.0) > 200.0, "Line preview uses geodesic distance")
	check(not gameplay.cast("unknown", point).get("ok", true), "Unknown spell is rejected")
	var crater: Dictionary = gameplay.cast("Starfall", outside)
	check(crater.get("ok", false) and crater.get("placed", 0) == 4, "Starfall forms a crater and four mineable deposits")
	for ore in gameplay.placed:
		var physical := false
		for child in ore.get_children():
			if child is StaticBody3D: physical = true
		check(ore.get_meta("kind", "") == "resource" and physical, "Ore has resource metadata and physical collision")
	var start_direction := Vector3.RIGHT
	var end_direction := Vector3(cos(0.46), 0.0, sin(0.46))
	var start_point: Vector3 = planet.center + planet.fields.surface_point(start_direction)
	var end_point: Vector3 = planet.center + planet.fields.surface_point(end_direction)
	var line_preview: Dictionary = gameplay.preview("forestline", end_point, start_point)
	var midpoint: Vector3 = Vector3(cos(0.23), 0.0, sin(0.23))
	check(absf(line_preview.length - 0.46 * planet.fields.radius) < 0.01, "Line uses world-space geodesic length")
	check(line_preview.center_direction.distance_to(midpoint) < 0.0001, "Line center lies halfway around globe")
	var line_result: Dictionary = gameplay.cast("forestline", end_point, start_point)
	check(line_result.get("ok", false), "Forest Line grows along the selected arc")
	var original_line: Array[Vector3] = []
	for placed in gameplay.placed:
		if placed.get_meta("planet_tree", false): original_line.append(placed.get_meta("planet_direction"))
	check(original_line.size() >= 5, "Forest Line places trees")
	for direction in original_line:
		check(direction.angle_to(start_direction) > 0.0 and direction.angle_to(start_direction) < 0.46, "Forest Line trees stay between endpoints")
	var middle_height: float = planet.fields.height_at(midpoint)
	var sunder_result: Dictionary = gameplay.cast("sunder", end_point, start_point)
	check(sunder_result.get("ok", false), "Sunder follows the selected arc")
	check(planet.fields.height_at(midpoint) < middle_height - 0.5, "Sunder cuts at arc midpoint")
	check(gameplay.cast("wall", end_point, start_point).get("ok", false), "Wall raises terrain along the selected arc")
	var fault_result: Dictionary = gameplay.cast("fault", end_point, start_point)
	check(fault_result.get("ok", false) and fault_result.get("placed", 0) == 4, "Fault exposes crystal-rich ore along the arc")
	var route_start := Vector3.BACK
	var route_end := Vector3(sin(0.35), 0.0, cos(0.35))
	var route_middle := Vector3(sin(0.175), 0.0, cos(0.175))
	var route_quarter := Vector3(sin(0.0875), 0.0, cos(0.0875))
	var route_start_point: Vector3 = planet.center + planet.fields.surface_point(route_start)
	var route_end_point: Vector3 = planet.center + planet.fields.surface_point(route_end)
	var path_result: Dictionary = gameplay.cast("path", route_end_point, route_start_point)
	check(path_result.get("ok", false), "Path levels a geodesic strip")
	check(absf(planet.fields.height_at(route_middle) - planet.fields.height_at(route_quarter)) < 0.02, "Path middle and quarter use the same radial level")
	var save: Dictionary = gameplay.snapshot()
	check(save.get("commands", []).size() == 7, "Cast commands serialize")
	check(save.commands[2].get("start_direction", []).size() == 3, "Forest Line stores geodesic start")
	var restored = Gameplay.new()
	planet.add_child(restored)
	restored.setup(planet)
	var revision: int = planet.fields.revision
	check(restored.load_snapshot(save), "Gameplay snapshot reloads")
	var ore_count := 0
	var replayed_line: Array[Vector3] = []
	var apples := 0
	for item in restored.placed:
		if item.get_meta("planet_starfall_ore", false): ore_count += 1
		if item.get_meta("resource", "") == "apple": apples += 1
		if item.get_meta("planet_tree", false) and item.get_meta("planet_direction", Vector3.ZERO).angle_to(start_direction) < 0.46:
			replayed_line.append(item.get_meta("planet_direction"))
	check(ore_count == 4 and planet.fields.revision == revision, "Reload reconstructs Starfall deposits without replaying terrain operations")
	for direction in original_line:
		var matched := false
		for replayed in replayed_line:
			if direction.distance_to(replayed) < 0.0001: matched = true
		check(matched, "Forest Line replay preserves each geodesic tree")
	check(apples > 0, "Seed world has physical apple pickups")
	check(restored.actors.size() == 10, "Seed world has creatures on multiple hemispheres")
	var north := false
	var south := false
	for actor in restored.actors:
		north = north or actor.position.y > 0.0
		south = south or actor.position.y < 0.0
		var outward: Vector3 = actor.position.normalized()
		check(actor.basis.y.dot(planet.fields.normal_at(outward)) > 0.9, "Creature stands along the local surface normal")
	check(north and south, "Creatures occupy both hemispheres")
	var seeded_planet := MockPlanet.new()
	seeded_planet.center = Vector3(-400.0, 0.0, 0.0)
	root.add_child(seeded_planet)
	seeded_planet.fields = Fields.new()
	seeded_planet.fields.setup(290929, 85.0)
	var mining_game := MockGame.new()
	root.add_child(mining_game)
	mining_game.mining = MockMining.new()
	mining_game.add_child(mining_game.mining)
	mining_game.mining.deposits = Deposits.new()
	mining_game.mining.add_child(mining_game.mining.deposits)
	mining_game.mining.deposits.game = mining_game
	seeded_planet.game = mining_game
	var seeded_gameplay := Gameplay.new()
	seeded_planet.add_child(seeded_gameplay)
	seeded_gameplay.setup(seeded_planet)
	seeded_gameplay.build()
	var base_placements: int = seeded_gameplay.placed.size()
	check(base_placements <= Gameplay.INITIAL_PLACEMENT_LIMIT, "Seed world leaves room for later spells")
	var orchard_trees := 0
	var chop_trees := 0
	var ore_ids := {}
	var desert_anchor: Vector3 = seeded_planet.fields.region_anchors()[4]["direction"]
	var alp_anchor: Vector3 = seeded_planet.fields.region_anchors()[3]["direction"]
	var cry_anchor: Vector3 = seeded_planet.fields.region_anchors()[5]["direction"]
	var sparse_high_trees := 0
	for item in seeded_gameplay.placed:
		check(item.get_meta("zone", "") == "orchard_planet", "Every planet placement has a zone")
		if item.get_meta("planet_tree", false):
			orchard_trees += 1
			if item.get_meta("requires", "") == "axe": chop_trees += 1
			var tree_direction: Vector3 = item.get_meta("planet_direction")
			check(tree_direction.angle_to(desert_anchor) > 0.35, "Desert remains open of seeded trees")
			if tree_direction.angle_to(alp_anchor) < 0.28 or tree_direction.angle_to(cry_anchor) < 0.28: sparse_high_trees += 1
		if item.get_meta("planet_ore", false):
			var ore_id: String = item.get_meta("id", "")
			check(not ore_ids.has(ore_id), "Ore IDs are unique for persistent mining")
			ore_ids[ore_id] = true
	check(orchard_trees >= 55 and orchard_trees <= 58, "Biome pockets use bounded TreeKit instances")
	check(chop_trees == 16, "Seed pockets include sixteen choppable trees")
	check(sparse_high_trees <= 4, "Alpine and crystal regions have sparse trees")
	check(ore_ids.size() == 12 and seeded_gameplay.actors.size() == 10, "Ore and creature population stays bounded")
	check(mining_game.mining.deposits.entries.size() == 12, "Lazy planet build registers its mineable ore")
	var seeded_starfall: Vector3 = seeded_planet.center + seeded_planet.fields.surface_point(Vector3.LEFT)
	check(seeded_gameplay.cast("starfall", seeded_starfall).get("ok", false), "Seed world accepts Starfall")
	var star_reward_kinds := {}
	for item in seeded_gameplay.placed:
		if not item.get_meta("planet_starfall_ore", false): continue
		var entry: Dictionary = mining_game.mining.deposits.entries.get(item.get_instance_id(), {})
		star_reward_kinds[entry.get("resource", "")] = true
	check(mining_game.mining.deposits.entries.size() == 16 and star_reward_kinds.has("star_iron") and star_reward_kinds.has("meteor_gem"), "Starfall ore registers physical star-material rewards")
	var physical_planet := MockPlanet.new()
	physical_planet.center = Vector3(330.0, 0.0, 0.0)
	root.add_child(physical_planet)
	physical_planet.global_position = physical_planet.center
	physical_planet.fields = Fields.new()
	physical_planet.fields.setup(491, 85.0)
	var physical_terrain := Terrain.new()
	physical_planet.add_child(physical_terrain)
	physical_terrain.setup(physical_planet.fields)
	physical_planet.terrain = physical_terrain
	var physical_gameplay := Gameplay.new()
	physical_planet.add_child(physical_gameplay)
	physical_gameplay.setup(physical_planet)
	for frame in 1200:
		physical_terrain.tick(0.5)
		var stats: Dictionary = physical_terrain.statistics()
		if int(stats.dirty) == 0 and int(stats.morphing) == 0: break
	await physics_frame
	await process_frame
	var ray_origin: Vector3 = physical_planet.center + Vector3.RIGHT * 120.0
	var ray_end: Vector3 = physical_planet.center + Vector3.RIGHT * 50.0
	var query := PhysicsRayQueryParameters3D.create(ray_origin, ray_end)
	query.collision_mask = 1
	var before_hit: Dictionary = root.get_world_3d().direct_space_state.intersect_ray(query)
	if before_hit.is_empty():
		var center_chunk: Dictionary = physical_terrain._chunks[4]
		print("PHYSICAL_DEBUG ", physical_terrain.statistics(), " planet=", physical_planet.global_position, " terrain=", physical_terrain.global_position, " ray=", ray_origin, "->", ray_end, " body=", center_chunk.collision.get_parent().global_position, " disabled=", center_chunk.collision.disabled, " shapes=", center_chunk.collision.shape.get_faces().size() if center_chunk.collision.shape != null else 0)
		print("PHYSICAL_REVERSE ", root.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(ray_end, ray_origin)))
	check(not before_hit.is_empty(), "Native physics ray reaches planet terrain")
	var wall_begin: Vector3 = physical_planet.center + physical_planet.fields.surface_point(Vector3(cos(0.08), 0.0, -sin(0.08)))
	var wall_end: Vector3 = physical_planet.center + physical_planet.fields.surface_point(Vector3(cos(0.08), 0.0, sin(0.08)))
	check(physical_gameplay.cast("wall", wall_end, wall_begin).get("ok", false), "Physical wall cast succeeds")
	for frame in 1200:
		physical_terrain.tick(0.5)
		var stats: Dictionary = physical_terrain.statistics()
		if int(stats.dirty) == 0 and int(stats.morphing) == 0: break
	await physics_frame
	await process_frame
	var after_hit: Dictionary = root.get_world_3d().direct_space_state.intersect_ray(query)
	check(not after_hit.is_empty(), "Native physics ray still reaches edited terrain")
	if not before_hit.is_empty() and not after_hit.is_empty():
		check(after_hit.position.x > before_hit.position.x + 1.0, "Native collider rises with Earthen Wall")
	var path_probe := Vector3(cos(0.07), 0.0, sin(0.07))
	var probe_query := PhysicsRayQueryParameters3D.create(physical_planet.center + path_probe * 120.0, physical_planet.center + path_probe * 50.0)
	probe_query.collision_mask = 1
	var before_path_hit: Dictionary = root.get_world_3d().direct_space_state.intersect_ray(probe_query)
	var before_path_height: float = physical_planet.fields.height_at(path_probe)
	check(physical_gameplay.cast("path", wall_end, wall_begin).get("ok", false), "Physical Path cast succeeds")
	for frame in 1200:
		physical_terrain.tick(0.5)
		var stats: Dictionary = physical_terrain.statistics()
		if int(stats.dirty) == 0 and int(stats.morphing) == 0: break
	await physics_frame
	await process_frame
	var after_path_hit: Dictionary = root.get_world_3d().direct_space_state.intersect_ray(probe_query)
	var after_path_height: float = physical_planet.fields.height_at(path_probe)
	check(not before_path_hit.is_empty() and not after_path_hit.is_empty(), "Native rays reach the Path before and after leveling")
	check(absf(after_path_height - before_path_height) > 0.1, "Path changes the off-center field height")
	if not before_path_hit.is_empty() and not after_path_hit.is_empty():
		var collision_delta: float = (after_path_hit.position - before_path_hit.position).dot(path_probe)
		check(collision_delta * (after_path_height - before_path_height) > 0.03, "Native Path collider moves with the leveled field")
	physical_planet.queue_free()
	seeded_planet.queue_free()
	mining_game.queue_free()
	planet.queue_free()
	if failures.is_empty():
		print("PLANET_GAMEPLAY_CHECKS_PASS ", {"initial_placements": base_placements, "trees": orchard_trees, "interactive_trees": chop_trees, "base_ore": ore_ids.size(), "actors": seeded_gameplay.actors.size()})
	else:
		for failure in failures: push_error(failure)
		print("PLANET_GAMEPLAY_CHECKS_FAIL count=", failures.size())
	quit(0 if failures.is_empty() else 1)
