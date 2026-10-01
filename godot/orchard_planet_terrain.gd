extends Node3D
## Six cube faces, each split into nine independently rebuilt spherical chunks.
const Fields = preload("res://orchard_planet_fields.gd")
const SPLITS := 3
const GRID := 20
const VERTICES_PER_SLICE := 16
const PREPARE_BUDGET_US := 1800
const MAX_COMMITS_PER_TICK := 1
const MAX_MORPHS_PER_TICK := 4
var fields: RefCounted
var camera: Camera3D
var material: Material
var _chunks: Array[Dictionary] = []
var _cursor := 0
var _built_total := 0
var _revision_seen := 0
var _active_job := -1

func setup(source_fields: RefCounted, view_camera: Camera3D = null) -> void:
	fields = source_fields
	camera = view_camera
	for child in get_children():
		child.queue_free()
	_chunks.clear()
	_cursor = 0
	_built_total = 0
	_revision_seen = fields.revision
	_active_job = -1
	for face in 6:
		for iy in SPLITS:
			for ix in SPLITS:
				var mesh_node := MeshInstance3D.new()
				mesh_node.name = "Planet_%d_%d_%d" % [face, ix, iy]
				mesh_node.visible = false
				add_child(mesh_node)
				var body := StaticBody3D.new()
				body.name = "Collision_%d_%d_%d" % [face, ix, iy]
				body.collision_layer = 1
				body.collision_mask = 0
				add_child(body)
				var collision := CollisionShape3D.new()
				body.add_child(collision)
				var center := _direction(face, (float(ix) + 0.5) / SPLITS * 2.0 - 1.0, (float(iy) + 0.5) / SPLITS * 2.0 - 1.0)
				var corners := [
					_direction(face, float(ix) / SPLITS * 2.0 - 1.0, float(iy) / SPLITS * 2.0 - 1.0),
					_direction(face, float(ix + 1) / SPLITS * 2.0 - 1.0, float(iy) / SPLITS * 2.0 - 1.0),
					_direction(face, float(ix) / SPLITS * 2.0 - 1.0, float(iy + 1) / SPLITS * 2.0 - 1.0),
					_direction(face, float(ix + 1) / SPLITS * 2.0 - 1.0, float(iy + 1) / SPLITS * 2.0 - 1.0)]
				var cap := 0.0
				for corner in corners:
					cap = maxf(cap, acos(clampf(center.dot(corner), -1.0, 1.0)))
				_chunks.append({"face": face, "ix": ix, "iy": iy, "direction": center, "cap": cap, "mesh_node": mesh_node, "collision": collision, "visible": false, "built": false, "dirty": true, "job": {}, "vertices": PackedVector3Array(), "target": PackedVector3Array(), "colors": PackedColorArray(), "target_colors": PackedColorArray(), "water_uv": PackedVector2Array(), "target_water_uv": PackedVector2Array(), "progress": 1.0})

func _direction(face: int, u: float, v: float) -> Vector3:
	match face:
		0: return Vector3(1, v, -u).normalized()
		1: return Vector3(-1, v, u).normalized()
		2: return Vector3(u, 1, -v).normalized()
		3: return Vector3(u, -1, v).normalized()
		4: return Vector3(u, v, 1).normalized()
		_: return Vector3(-u, v, -1).normalized()

func _visible(chunk: Dictionary) -> bool:
	var active_camera := camera
	if not is_instance_valid(active_camera):
		active_camera = get_viewport().get_camera_3d() if is_inside_tree() else null
	if not is_instance_valid(active_camera):
		return true
	var local_camera := to_local(active_camera.global_position)
	var distance := local_camera.length()
	if distance <= fields.radius + 8.0:
		return true
	var horizon := acos(clampf(fields.radius / distance, 0.0, 1.0))
	var camera_direction := local_camera / distance
	return acos(clampf(camera_direction.dot(chunk["direction"]), -1.0, 1.0)) <= horizon + chunk["cap"] + 0.06

func tick(delta: float) -> void:
	if fields == null:
		return
	if fields.revision != _revision_seen:
		_revision_seen = fields.revision
		_active_job = -1
		for chunk in _chunks:
			if chunk["built"]:
				chunk["dirty"] = true
			chunk["job"] = {}
	for chunk in _chunks:
		var visible_now := _visible(chunk)
		chunk["visible"] = visible_now
		chunk["mesh_node"].visible = visible_now and chunk["built"]
		# A nearby Hero can stand on the opposite hemisphere from an RTS camera.
		# Visibility only culls rendering; built terrain collision stays global.
		chunk["collision"].disabled = not chunk["built"]
	var started_us := Time.get_ticks_usec()
	var commits := 0
	while Time.get_ticks_usec() - started_us < PREPARE_BUDGET_US and commits < MAX_COMMITS_PER_TICK:
		if _active_job < 0 or not _chunks[_active_job]["visible"] or not _chunks[_active_job]["dirty"]:
			_active_job = _next_dirty_visible()
		if _active_job < 0:
			break
		var chunk := _chunks[_active_job]
		if _prepare_slice(chunk):
			_commit_prepared(chunk)
			commits += 1
			_cursor = (_active_job + 1) % _chunks.size()
			_active_job = -1
	var morphs := 0
	for chunk in _chunks:
		if morphs >= MAX_MORPHS_PER_TICK:
			break
		if chunk["progress"] < 1.0:
			chunk["progress"] = minf(1.0, chunk["progress"] + maxf(delta, 0.0) * 3.0)
			var p: float = chunk["progress"]
			var vertices := PackedVector3Array()
			var from_vertices: PackedVector3Array = chunk["vertices"]
			var to_vertices: PackedVector3Array = chunk["target"]
			for i in to_vertices.size():
				vertices.append(from_vertices[i].lerp(to_vertices[i], p))
			_set_geometry(chunk, vertices, chunk["target_colors"], chunk["target_water_uv"])
			if p >= 1.0:
				chunk["vertices"] = to_vertices
				chunk["colors"] = chunk["target_colors"]
				chunk["water_uv"] = chunk["target_water_uv"]
			morphs += 1

func _next_dirty_visible() -> int:
	for offset in _chunks.size():
		var index := (_cursor + offset) % _chunks.size()
		if _chunks[index]["visible"] and _chunks[index]["dirty"]:
			return index
	return -1

func _prepare_slice(chunk: Dictionary) -> bool:
	var job: Dictionary = chunk["job"]
	if job.is_empty() or int(job["revision"]) != fields.revision:
		job = {"revision": fields.revision, "next": 0, "vertices": PackedVector3Array(), "colors": PackedColorArray(), "water_uv": PackedVector2Array()}
	var verts: PackedVector3Array = job["vertices"]
	var colors: PackedColorArray = job["colors"]
	var water_uv: PackedVector2Array = job["water_uv"]
	var finish: int = mini(int(job["next"]) + VERTICES_PER_SLICE, (GRID + 1) * (GRID + 1))
	for index in range(int(job["next"]), finish):
		var x := index % (GRID + 1)
		var y := index / (GRID + 1)
		var u := (float(chunk["ix"]) + float(x) / GRID) / SPLITS * 2.0 - 1.0
		var v := (float(chunk["iy"]) + float(y) / GRID) / SPLITS * 2.0 - 1.0
		var d := _direction(chunk["face"], u, v)
		var field_sample: Dictionary = fields.sample(d, true)
		verts.append(d * (fields.radius + field_sample["height"]))
		var weights: Dictionary = field_sample["weights"]
		# RGBA groups: fertile, mountain, arid, enchanted; full weights remain in fields.sample.
		colors.append(Color(weights["temperate"] + weights["forest"] + weights["wetland"], weights["highland"] + weights["alpine"], weights["desert"] + weights["ruins"], weights["crystal"] + weights["magical"]))
		water_uv.append(Vector2(maxf(field_sample["river"], field_sample["lake"]), field_sample["moisture"]))
	job["vertices"] = verts
	job["colors"] = colors
	job["water_uv"] = water_uv
	job["next"] = finish
	chunk["job"] = job
	return finish == (GRID + 1) * (GRID + 1)

func _commit_prepared(chunk: Dictionary) -> void:
	var job: Dictionary = chunk["job"]
	var verts: PackedVector3Array = job["vertices"]
	var colors: PackedColorArray = job["colors"]
	var water_uv: PackedVector2Array = job["water_uv"]
	chunk["job"] = {}
	chunk["dirty"] = false
	if not chunk["built"]:
		chunk["built"] = true
		_built_total += 1
		chunk["vertices"] = verts
		chunk["colors"] = colors
		chunk["water_uv"] = water_uv
		chunk["progress"] = 1.0
		_set_geometry(chunk, verts, colors, water_uv)
	else:
		chunk["target"] = verts
		chunk["target_colors"] = colors
		chunk["target_water_uv"] = water_uv
		chunk["progress"] = 0.0

func _indices(face: int) -> PackedInt32Array:
	var indices := PackedInt32Array()
	for y in GRID:
		for x in GRID:
			var a := y * (GRID + 1) + x
			var b := a + 1
			var c := a + GRID + 1
			var d := c + 1
			# All face maps use the same outward winding.
			indices.append_array(PackedInt32Array([a, c, b, b, c, d]))
	return indices

func _set_geometry(chunk: Dictionary, verts: PackedVector3Array, colors: PackedColorArray, water_uv: PackedVector2Array) -> void:
	var indices := _indices(chunk["face"])
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	for i in verts.size():
		normals.append(verts[i].normalized())
		uvs.append(Vector2(float(i % (GRID + 1)) / GRID, float(i / (GRID + 1)) / GRID))
	# Godot treats CLOCKWISE triangles as front faces, including concave physics.
	# A mathematical outward cross product describes the opposite winding here.
	# Check real vertices so render geometry and exterior collision agree on every face.
	if (verts[indices[1]] - verts[indices[0]]).cross(verts[indices[2]] - verts[indices[0]]).dot(verts[indices[0]]) > 0.0:
		for t in range(0, indices.size(), 3):
			var tmp := indices[t + 1]
			indices[t + 1] = indices[t + 2]
			indices[t + 2] = tmp
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_TEX_UV2] = water_uv
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	if material != null:
		mesh.surface_set_material(0, material)
	chunk["mesh_node"].mesh = mesh
	var faces := PackedVector3Array()
	for index in indices:
		faces.append(verts[index])
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	chunk["collision"].shape = shape
	chunk["mesh_node"].visible = chunk["visible"]
	chunk["collision"].disabled = false

func queue_operation(operation: Dictionary) -> Dictionary:
	if fields == null:
		return {"ok": false, "error": "Terrain has no fields"}
	var result: Dictionary = fields.apply_operation(operation)
	if not result["ok"]:
		return result
	var center: Vector3 = result["center"]
	var cap: float = result["angular_radius"]
	for chunk in _chunks:
		if acos(clampf(center.dot(chunk["direction"]), -1.0, 1.0)) <= cap + chunk["cap"]:
			chunk["dirty"] = true
			chunk["job"] = {}
	_active_job = -1
	_revision_seen = fields.revision
	return result

func statistics() -> Dictionary:
	var visible := 0
	var dirty := 0
	var built := 0
	var morphing := 0
	var preparing := 0
	for chunk in _chunks:
		visible += int(chunk["visible"])
		dirty += int(chunk["dirty"])
		built += int(chunk["built"])
		morphing += int(chunk["progress"] < 1.0)
		preparing += int(not chunk["job"].is_empty())
	return {"total": _chunks.size(), "visible": visible, "built": built, "dirty": dirty, "preparing": preparing, "morphing": morphing, "built_total": _built_total, "revision": fields.revision if fields != null else -1}
