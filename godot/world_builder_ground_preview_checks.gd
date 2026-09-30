extends SceneTree
## Save-free catalogue sweep for ground-preview identity, footprint and invalid colour.
const Art = preload("res://world_builder_targeting_art.gd")
const Targeting = preload("res://world_builder_targeting.gd")
const Spells = preload("res://world_builder_spells.gd")

class Field extends RefCounted:
	func height_at(p: Vector2) -> float: return sin(p.x * 0.04) * 0.8 + cos(p.y * 0.03) * 0.5

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
	var catalogue := Spells.catalogue()
	var spatial := 0
	var unavailable := 0
	var peak_triangles := 0
	var peak_build_usec := 0
	if catalogue.size() != 29: failures.append("catalogue count changed")
	for entry in catalogue:
		var id := str(entry.id)
		if not bool(entry.get("implemented", true)):
			unavailable += 1
			if Targeting.is_targetable(entry): failures.append("unavailable action targetable: " + id)
			continue
		if not Targeting.is_targetable(entry): failures.append("implemented action lacks spec: " + id)
		if id == "hire": continue
		spatial += 1
		var state := {"id": id, "zone": "orchard_highlands", "valid": true,
			"hovered": Vector3(10, 0, 0), "first_point": Vector3.INF,
			"world_origin": Vector3(170, 3, -90), "footprint": Targeting.spec(id)}
		if str(state.footprint.kind) in ["line", "deck"]: state.first_point = Vector3(-10, 0, 0)
		art.update_targeting(state)
		if not art.instance.visible or art.mesh.get_surface_count() == 0:
			failures.append("missing spatial preview: " + id)
			continue
		peak_triangles = maxi(peak_triangles, int(art.stats.triangles))
		peak_build_usec = maxi(peak_build_usec, int(art.stats.build_usec))
		if art.stats.triangles > 4000 or art.stats.surfaces > 2:
			failures.append("preview draw budget: " + id)
		var bound := _bounds(art)
		if not bound.position.is_finite() or not bound.size.is_finite(): failures.append("nonfinite geometry: " + id)
		if id == "sunder":
			# The operation has an 8 m core and two 4 m shoulders, centred on Z=0.
			if bound.position.z < -98.05 or bound.end.z > -81.95:
				failures.append("Sunder preview exceeds its 16 m affected corridor")
		state.valid = false
		art.update_targeting(state)
		if not art.instance.visible: failures.append("invalid preview disappeared: " + id)
		for surface in art.mesh.get_surface_count():
			var colors: PackedColorArray = art.mesh.surface_get_arrays(surface)[Mesh.ARRAY_COLOR]
			for color in colors:
				if color.a > 0.1 and (color.r < color.g * 1.4 or color.r < color.b * 1.4):
					failures.append("invalid preview retained noncrimson color: " + id)
					break
	# Switching a long line to a small point effect must discard every old vertex.
	var long_line := {"id":"sunder", "zone":"orchard_highlands", "valid":true,
		"hovered":Vector3(30, 0, 0), "first_point":Vector3(-30, 0, 0),
		"world_origin":Vector3(170, 3, -90), "footprint":Targeting.spec("sunder")}
	art.update_targeting(long_line)
	var seed := {"id":"seed", "zone":"orchard_highlands", "valid":true,
		"hovered":Vector3.ZERO, "first_point":Vector3.INF,
		"world_origin":Vector3(170, 3, -90), "footprint":Targeting.spec("seed")}
	art.update_targeting(seed)
	var seed_bounds := _bounds(art)
	if seed_bounds.position.x < 165.0 or seed_bounds.end.x > 175.0:
		failures.append("previous action geometry survived selection change")
	art.update_targeting({})
	if art.instance.visible or not art._pending.is_empty(): failures.append("cleared target remains visible or queued")
	if unavailable != 5 or spatial != 23: failures.append("catalogue coverage changed")
	print("GROUND_PREVIEW_RESULT ", JSON.stringify({"failures": failures, "catalogue": catalogue.size(),
		"spatial": spatial, "unavailable": unavailable, "peak_triangles": peak_triangles,
		"peak_build_usec": peak_build_usec}))
	game.queue_free()
	quit(0 if failures.is_empty() else 1)

func _bounds(art) -> AABB:
	var lo := Vector3.INF
	var hi := -Vector3.INF
	for surface in art.mesh.get_surface_count():
		var vertices: PackedVector3Array = art.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]
		for vertex in vertices:
			lo = lo.min(vertex)
			hi = hi.max(vertex)
	return AABB(lo, hi - lo)
