extends RefCounted
## Segment contact against the visible, animated rigid-puppet bone meshes.
## The broad enemy interaction box is deliberately absent from this query.
static var surface_cache := {}

static func contact(actor: Node3D, rig: Dictionary, start: Vector3, finish: Vector3) -> Dictionary:
	if rig.is_empty() or not actor.is_visible_in_tree() or not actor.get_meta("alive", true): return {}
	var best := {}
	var best_distance := start.distance_squared_to(finish)
	for home in rig.get("homes", []):
		var piece: Node3D = home.get("piece")
		if not is_instance_valid(piece) or not piece.is_visible_in_tree(): continue
		var part := _part(rig, piece)
		if part != "" and actor.get_meta("skeleton_missing_" + part, false): continue
		for mesh in piece.find_children("*", "MeshInstance3D", true, false):
			if not mesh.is_visible_in_tree() or mesh.mesh == null: continue
			var found := _mesh_contact(mesh, start, finish)
			if found.is_empty(): continue
			var distance := start.distance_squared_to(found.position)
			if distance < best_distance:
				best_distance = distance
				best = {"position": found.position, "normal": found.normal, "surface": mesh, "part": part}
	return best

static func _part(rig: Dictionary, piece: Node3D) -> String:
	if piece.name == "Skull": return "head"
	var joints: Dictionary = rig.get("joints", {})
	for part in ["head", "arm_l", "arm_r", "leg_l", "leg_r"]:
		if piece.get_parent() == joints.get(part): return part
	return "rib"

static func mesh_contact(mesh: MeshInstance3D, start: Vector3, finish: Vector3, posed_transform: Transform3D) -> Dictionary:
	var inverse := posed_transform.affine_inverse()
	var a := inverse * start
	var b := inverse * finish
	if mesh.mesh.get_aabb().intersects_segment(a, b) == null: return {}
	var direction := b - a
	var best_t := 1.0
	var best := {}
	var mesh_id := mesh.mesh.get_instance_id()
	if not surface_cache.has(mesh_id):
		var data := []
		for surface in range(mesh.mesh.get_surface_count()):
			data.append(mesh.mesh.surface_get_arrays(surface))
		surface_cache[mesh_id] = data
	for arrays in surface_cache[mesh_id]:
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		var count := indices.size() if not indices.is_empty() else vertices.size()
		for index in range(0, count - 2, 3):
			var i0 := int(indices[index]) if not indices.is_empty() else index
			var i1 := int(indices[index + 1]) if not indices.is_empty() else index + 1
			var i2 := int(indices[index + 2]) if not indices.is_empty() else index + 2
			var v0 := vertices[i0]
			var v1 := vertices[i1]
			var v2 := vertices[i2]
			var edge1 := v1 - v0
			var edge2 := v2 - v0
			var p := direction.cross(edge2)
			var determinant := edge1.dot(p)
			if absf(determinant) < 0.000001: continue
			var inv_det := 1.0 / determinant
			var offset := a - v0
			var u := offset.dot(p) * inv_det
			if u < -0.00001 or u > 1.00001: continue
			var q := offset.cross(edge1)
			var v := direction.dot(q) * inv_det
			if v < -0.00001 or u + v > 1.00001: continue
			var t := edge2.dot(q) * inv_det
			if t < 0.0 or t > best_t: continue
			best_t = t
			var normal: Vector3 = posed_transform.basis.inverse().transposed() * edge1.cross(edge2).normalized()
			best = {"position": posed_transform * (a + direction * t), "normal": normal.normalized()}
	return best

static func _mesh_contact(mesh: MeshInstance3D, start: Vector3, finish: Vector3) -> Dictionary:
	return mesh_contact(mesh,start,finish,mesh.global_transform)
