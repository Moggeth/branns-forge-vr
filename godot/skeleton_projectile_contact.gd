extends RefCounted
## Segment contact against the visible, animated rigid-puppet bone meshes.
## The broad enemy interaction box is deliberately absent from this query.
static var surface_cache := {}

static func contact(actor: Node3D, rig: Dictionary, start: Vector3, finish: Vector3) -> Dictionary:
	if rig.is_empty() or not actor.is_visible_in_tree() or not actor.get_meta("alive", true): return {}
	# A rotation-invariant envelope around the actual bone mesh hierarchy rejects
	# distant skeletons before searching meshes or transforming triangles. The
	# margin covers the visual root's animated bob/recoil and damage marks.
	var radius:float=_bone_envelope(actor,rig)
	if radius>0.0:
		var local_start:=actor.to_local(start)
		var local_finish:=actor.to_local(finish)
		if Geometry3D.get_closest_point_to_segment(Vector3.ZERO,local_start,local_finish).length_squared()>radius*radius: return {}
	var best := {}
	var best_distance := start.distance_squared_to(finish)
	var groups:Array=rig.get("_projectile_mesh_groups",[])
	var homes:Array=rig.get("homes",[])
	for home_index in range(homes.size()):
		var home:Dictionary=homes[home_index]
		var piece: Node3D = home.get("piece")
		if not is_instance_valid(piece) or not piece.is_visible_in_tree(): continue
		var part := _part(rig, piece)
		if part != "" and actor.get_meta("skeleton_missing_" + part, false): continue
		for mesh in groups[home_index]:
			if not is_instance_valid(mesh) or not mesh.is_visible_in_tree() or mesh.mesh == null: continue
			var found := _mesh_contact(mesh, start, finish)
			if found.is_empty(): continue
			var distance := start.distance_squared_to(found.position)
			if distance < best_distance:
				best_distance = distance
				best = {"position": found.position, "normal": found.normal, "surface": mesh, "part": part}
	return best

static func _bone_envelope(actor: Node3D, rig: Dictionary) -> float:
	var homes:Array=rig.get("homes",[])
	var ids:PackedInt64Array=rig.get("_projectile_bound_ids",PackedInt64Array())
	var counts:PackedInt32Array=rig.get("_projectile_bound_counts",PackedInt32Array())
	var unchanged:=ids.size()==homes.size() and counts.size()==homes.size()
	if unchanged:
		for index in range(homes.size()):
			var piece:Node3D=homes[index].get("piece")
			var current_id:int=piece.get_instance_id() if is_instance_valid(piece) else 0
			var current_count:int=piece.get_child_count() if is_instance_valid(piece) else 0
			if ids[index]!=current_id or counts[index]!=current_count:
				unchanged=false
				break
	if unchanged:
		return float(rig.get("_projectile_bound_radius",0.0))
	var radius:=0.0
	var groups:=[]
	ids=PackedInt64Array()
	counts=PackedInt32Array()
	for home in homes:
		var piece:Node3D=home.get("piece")
		if not is_instance_valid(piece):
			ids.append(0)
			counts.append(0)
			groups.append([])
			continue
		ids.append(piece.get_instance_id())
		counts.append(piece.get_child_count())
		var meshes:=piece.find_children("*", "MeshInstance3D", true, false)
		groups.append(meshes)
		for mesh in meshes:
			if mesh.mesh==null: continue
			var box: AABB=mesh.mesh.get_aabb()
			var extent:float=box.get_center().length()+box.size.length()*0.5
			var node:Node3D=mesh
			while node!=actor and node!=null:
				var basis:Basis=node.transform.basis
				var stretch:float=maxf(basis.x.length(),maxf(basis.y.length(),basis.z.length()))
				extent=node.position.length()+stretch*extent
				node=node.get_parent() as Node3D
			if node==actor: radius=maxf(radius,extent)
	# Actor-local distances handle world movement and scale. The rig's tracked
	# nodes rotate in place; only its visual root adds small bob/recoil offsets.
	radius+=0.5 if radius>0.0 else 0.0
	rig["_projectile_bound_ids"]=ids
	rig["_projectile_bound_counts"]=counts
	rig["_projectile_bound_radius"]=radius
	rig["_projectile_mesh_groups"]=groups
	return radius

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
