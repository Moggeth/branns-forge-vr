extends SceneTree
## Installed art geometry contracts over a non-flat field, with actual world offset.
const Art = preload("res://world_builder_targeting_art.gd")
const Targeting = preload("res://world_builder_targeting.gd")
class Field extends RefCounted:
	var revision := 0
	func height_at(p: Vector2) -> float: return sin(p.x * 0.04) * 2.0 + cos(p.y * 0.03) * 1.2 + revision
class Game extends Node3D:
	var landscape := Field.new()
func _initialize() -> void: call_deferred("_run")
func _run() -> void:
	var failures: Array[String] = []
	var game := Game.new()
	root.add_child(game)
	var art := Art.new()
	game.add_child(art)
	art.setup(game)
	var worst := 0
	var max_tris := 0
	var origin := Vector3(190, 2, -90)
	for action in Targeting.SPECS:
		if action == "hire": continue
		var state := {"id":action,"valid":true,"hovered":Vector3(30,0,15),"first_point":Vector3(-30,0,-15),"footprint":Targeting.spec(action),"world_origin":origin,"terrain_revision":0}
		if action not in ["path","sunder","wall","forest","fault","bridge","ramp","stairs","boardwalk"]: state.first_point = Vector3.INF
		if action in ["forest","ring"]: state.tree_positions = [Vector3(26,0,12),Vector3(32,0,18)]
		art.clear_preview()
		art.update_targeting(state)
		worst = maxi(worst, int(art.stats.build_usec))
		max_tris = maxi(max_tris, int(art.stats.triangles))
		if not art.instance.visible or art.stats.triangles == 0: failures.append("missing bespoke target: " + action)
		if art.stats.surfaces > 2 or art.stats.triangles > 4000: failures.append("target exceeds geometry budget: " + action)
		if not art.global_transform.is_equal_approx(Transform3D.IDENTITY): failures.append("target origin applied twice")
		for surface in art.mesh.get_surface_count():
			var arrays := art.mesh.surface_get_arrays(surface)
			var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			for vertex in vertices:
				var local := vertex - origin
				var floor_y: float = game.landscape.height_at(Vector2(local.x,local.z))
				if local.y < floor_y + 0.055: failures.append("preview vertex below ground: " + action); break
		state.valid = false
		art.clear_preview()
		art.update_targeting(state)
		if art._base != Art.CRIMSON: failures.append("invalid target is not crimson")
		var rebuilds: int = art.stats.rebuilds
		art.update_targeting(state)
		if art.stats.rebuilds != rebuilds: failures.append("unchanged preview rebuilt")
	# The same cursor must resample after an authoritative terrain edit.
	var edited := {"id":"raise","valid":true,"hovered":Vector3.ZERO,"footprint":Targeting.spec("raise"),"world_origin":origin,"terrain_revision":0}
	art.clear_preview()
	art.update_targeting(edited)
	var prior: float = art.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX][0].y
	game.landscape.revision = 2
	edited.terrain_revision = 2
	art.update_targeting(edited)
	var deadline := Time.get_ticks_usec() + 1000000
	while not art._pending.is_empty() and Time.get_ticks_usec() < deadline: await process_frame
	var after: float = art.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX][0].y
	if after < prior + 1.9: failures.append("unchanged cursor ignored terrain revision")
	print("TARGET_ART_REVISION ", {"before":prior,"after":after,"pending":not art._pending.is_empty(),"rebuilds":art.stats.rebuilds})
	print("TARGET_ART_RESULT ", {"failures":failures,"max_triangles":max_tris,"worst_build_usec":worst})
	quit(0 if failures.is_empty() else 1)
