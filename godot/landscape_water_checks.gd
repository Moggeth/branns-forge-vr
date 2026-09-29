extends SceneTree

const Fields = preload("res://landscape_fields.gd")
const Hydro = preload("res://landscape_hydrology.gd")
const Water = preload("res://landscape_water.gd")


func _initialize() -> void:
	call_deferred("_check")


func _check() -> void:
	var failures: Array[String] = []
	var started: int = Time.get_ticks_msec()
	var model: Dictionary = Hydro.run(Fields.create(43), [])
	var water: Node3D = Water.new()
	root.add_child(water)
	water.setup(model)
	var generation_ms: int = Time.get_ticks_msec() - started
	if water.chunk_count() < 5: failures.append("creek was not divided into local chunks")
	for chunk in water.get_children():
		if not chunk is MeshInstance3D: failures.append("unexpected water child")
		elif chunk.mesh == null or chunk.mesh.get_surface_count() != 1: failures.append("water mesh absent")
		if chunk is CollisionObject3D: failures.append("water blocks collision")
	var crossing: Dictionary = Water.crossing(model)
	if crossing.is_empty(): failures.append("crossing missing")
	else:
		if Vector2(crossing.position.x, crossing.position.z).distance_to(Vector2(25, -48)) > 5.0: failures.append("bridge placement missed existing crossing")
		if crossing.position.y <= crossing.water_y: failures.append("bridge deck submerged")
		if absf(crossing.along.dot(crossing.across)) > 0.01: failures.append("bridge is not across stream")
		if crossing.span <= Water.sample(model, "river_width", Vector2(crossing.position.x, crossing.position.z)): failures.append("bridge does not reach banks")
	var original_mesh: Mesh = water.get_child(0).mesh
	var far_dirty := Rect2(Vector2(-150, 120), Vector2(8, 8))
	var unaffected: int = water.refresh_region(model, far_dirty)
	if unaffected != 0 or water.get_child(0).mesh != original_mesh: failures.append("distant water rebuilt")
	var near_dirty := Rect2(Vector2(-155, -60), Vector2(15, 15))
	var affected: int = water.refresh_region(model, near_dirty)
	if affected < 1 or affected >= water.chunk_count(): failures.append("dirty region did not rebuild locally")
	var ridge: Vector3 = model.river_polyline[70]
	var ridge_chunk: int = 70 / Water.CHUNK_SAMPLES
	var former_indices: int = (water.get_child(ridge_chunk).mesh as ArrayMesh).surface_get_array_index_len(0)
	var height: PackedFloat32Array = model.height
	var ix: int = clampi(roundi((ridge.x - model.origin.x) / model.step), 2, int(model.size) - 3)
	var iz: int = clampi(roundi((ridge.z - model.origin.y) / model.step), 2, int(model.size) - 3)
	for dz in range(-2, 3):
		for dx in range(-2, 3):
			height[(iz + dz) * int(model.size) + ix + dx] += 5.0
	model["height"] = height
	var ridge_box := Rect2(Vector2(ridge.x, ridge.z) - Vector2(5, 5), Vector2(10, 10))
	var changed: Dictionary = Hydro.refresh_after_terrain_change(model, ridge_box)
	water.refresh_region(model, changed.water_dirty)
	var blocked_mesh: ArrayMesh = water.get_child(ridge_chunk).mesh
	var blocked_indices: int = blocked_mesh.surface_get_array_index_len(0) if blocked_mesh.get_surface_count() > 0 else 0
	if blocked_indices >= former_indices: failures.append("raised ridge did not open a visual gap in creek")
	for chunk in water.get_children():
		if not chunk is MeshInstance3D or chunk.mesh == null: continue
		for surface_index in chunk.mesh.get_surface_count():
			var arrays: Array = chunk.mesh.surface_get_arrays(surface_index)
			var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var triangles: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
			for at in range(0, triangles.size(), 3):
				var a: Vector3 = vertices[triangles[at]]
				var b: Vector3 = vertices[triangles[at + 1]]
				var c: Vector3 = vertices[triangles[at + 2]]
				var centroid := (a + b + c) / 3.0
				if Vector2(centroid.x, centroid.z).distance_to(Vector2(ridge.x, ridge.z)) < 1.0:
					failures.append("water triangle crosses blocked ridge"); break
	var hollow_cell: int = 135 * int(model.size) + 135
	# A pond needs an existing source; a dry meteor crater must stay dry.
	var supplied: PackedFloat32Array = model.water
	supplied[hollow_cell] = 0.5
	model["water"] = supplied
	var cut_height: PackedFloat32Array = model.height
	cut_height[hollow_cell] -= 5.0
	model["height"] = cut_height
	var hollow_point: Vector2 = model.origin + Vector2(135, 135) * model.step
	var hollow_box := Rect2(hollow_point - Vector2(2, 2), Vector2(4, 4))
	changed = Hydro.refresh_after_terrain_change(model, hollow_box)
	water.refresh_region(model, changed.water_dirty)
	var pool_mesh: MeshInstance3D = water.get_node_or_null("LandscapePools")
	if model.hydrology_pool[hollow_cell] < 0.1 or pool_mesh == null or pool_mesh.mesh == null:
		failures.append("enclosed cut has no visible pool")
	for child in water.get_children():
		if not child is MeshInstance3D or child.mesh == null: continue
		for surface_index in child.mesh.get_surface_count():
			var arrays: Array = child.mesh.surface_get_arrays(surface_index)
			var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
			var tangents: PackedFloat32Array = arrays[Mesh.ARRAY_TANGENT]
			if normals.size() != vertices.size() or tangents.size() != vertices.size() * 4:
				failures.append("water normal-map basis missing on " + child.name)
				continue
			for vertex_index in vertices.size():
				var at: int = vertex_index * 4
				var tangent := Vector3(tangents[at], tangents[at + 1], tangents[at + 2])
				if normals[vertex_index].distance_to(Vector3.UP) > 0.001 or absf(tangent.length() - 1.0) > 0.001 or absf(tangent.dot(normals[vertex_index])) > 0.001 or tangents[at + 3] != -1.0:
					failures.append("invalid water normal-map basis on " + child.name)
					break
	var shortened: Dictionary = model.duplicate()
	var shorter: Array[Vector3] = model.river_polyline.duplicate()
	shorter.resize(shorter.size() / 2)
	shortened["river_polyline"] = shorter
	var reset: int = water.refresh_region(shortened, near_dirty)
	if reset != water.chunk_count(): failures.append("changed river route did not rebuild water")
	print("WATER_BENCHMARK grid_plus_mesh_ms=", generation_ms, " chunks=", water.chunk_count(), " local_rebuilt=", affected)
	if failures.is_empty():
		print("WATER_CHECKS_PASS")
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)
