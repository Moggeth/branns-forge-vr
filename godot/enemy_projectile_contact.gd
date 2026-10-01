extends RefCounted
## Nearest visible enemy triangle or layer-1 world surface along a projectile segment.
## Physics interaction proxies remain in the scene; only this ray query skips them.
const SkeletonContact = preload("res://skeleton_projectile_contact.gd")
const PoseHandoff = preload("res://skeleton_pose_handoff.gd")

var game
var _actor_meshes := {} # actor id -> weak actor, hierarchy counts, weak visible-mesh list
var _surface_arrays := {} # mesh resource id -> weak resource and immutable surface arrays
var _posed_frame := -1
var _posed_meshes := {} # instance id -> arrays in world coordinates for this frame
var _baker

func setup(owner_game) -> void:
	game = owner_game
	_baker = PoseHandoff.new()
	_baker.setup(game)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and is_instance_valid(_baker): _baker.free()

func damage(actor: Node3D, base_damage: float, headshot: bool) -> float:
	if str(actor.get_meta("enemy_type", "")) != "skeleton": return base_damage
	if headshot:
		return maxf(base_damage * 2.0, float(actor.get_meta("max_hp", 66))) if str(actor.get_meta("guardian_variant", "")) == "" else base_damage * 2.0
	return minf(base_damage * 0.35, 32.0)

func fallen_surface(actor: Node3D, point: Vector3, part: String) -> Node3D:
	var nearest: Node3D = null
	var distance := INF
	if game.remains != null:
		for body in game.remains.bodies:
			if not is_instance_valid(body) or int(body.get_meta("source_actor", -1)) != actor.get_instance_id(): continue
			if part != "" and str(body.get_meta("skeleton_part", "")) != part: continue
			for piece in body.get_children():
				if not piece is Node3D: continue
				if piece is CollisionShape3D: continue
				var candidate: float = piece.global_position.distance_squared_to(point)
				if candidate < distance:
					distance = candidate
					nearest = piece
	return nearest if nearest != null else game.adventure.zone_groups.get(game.adventure.zone, game)

func sweep(start: Vector3, finish: Vector3, mask: int = 1, excluded: Array = [], collide_with_areas: bool = false) -> Dictionary:
	if game == null or start.is_equal_approx(finish): return {}
	var excluded_rids: Array[RID] = []
	for item in excluded:
		if item is RID: excluded_rids.append(item)
	var actors := _live_actors()
	var actor_ids := {}
	for actor in actors: actor_ids[actor.get_instance_id()] = true
	var world_hit := _world_hit(start, finish, mask, excluded_rids, actor_ids, collide_with_areas)
	var limit: float = start.distance_squared_to(world_hit.position) if not world_hit.is_empty() else start.distance_squared_to(finish)
	var best := {}
	for actor in actors:
		if not excluded_rids.is_empty() and _actor_excluded(actor, excluded_rids): continue
		var hit: Dictionary = _actor_hit(actor, start, finish, limit)
		if hit.is_empty(): continue
		var distance := start.distance_squared_to(hit.position)
		if distance < limit:
			limit = distance
			best = hit
	return best if not best.is_empty() else world_hit

func _live_actors() -> Array:
	var result := []
	var seen := {}
	for actor in game.scene.get("enemies", []) + game.scene.get("rats", []):
		if not is_instance_valid(actor) or not actor is Node3D: continue
		var id: int = actor.get_instance_id()
		if seen.has(id) or not actor.is_inside_tree() or not actor.is_visible_in_tree() or not actor.get_meta("alive", true): continue
		if game.adventure != null and str(actor.get_meta("zone", game.adventure.zone)) != str(game.adventure.zone): continue
		seen[id] = true
		result.append(actor)
	return result

func _actor_excluded(node: Node, excluded: Array[RID]) -> bool:
	if node is CollisionObject3D and excluded.has(node.get_rid()): return true
	for child in node.get_children():
		if _actor_excluded(child, excluded): return true
	return false

func _world_hit(start: Vector3, finish: Vector3, mask: int, excluded: Array[RID], actor_ids: Dictionary, collide_with_areas: bool) -> Dictionary:
	var space: PhysicsDirectSpaceState3D = game.get_world_3d().direct_space_state
	var skip: Array[RID] = excluded.duplicate()
	for attempt in range(128):
		var query := PhysicsRayQueryParameters3D.create(start, finish, mask, skip)
		query.collide_with_areas = collide_with_areas
		var hit: Dictionary = space.intersect_ray(query)
		if hit.is_empty(): return {}
		var collider: CollisionObject3D = hit.get("collider") as CollisionObject3D
		if collider == null: return hit
		var owner = game._owner(collider) if game.has_method("_owner") else _ancestor_actor(collider, actor_ids)
		var kind := str(owner.get_meta("kind", "")) if owner != null else ""
		if owner == null or (kind != "enemy" and kind != "rat" and not actor_ids.has(owner.get_instance_id())): return hit
		var rid: RID = collider.get_rid()
		if skip.has(rid): return hit
		skip.append(rid)
	return {} # More overlapping enemy proxies than the defensive query limit.

func _ancestor_actor(node: Node, actor_ids: Dictionary):
	while node != null:
		if actor_ids.has(node.get_instance_id()): return node
		node = node.get_parent()
	return null

func _actor_hit(actor: Node3D, start: Vector3, finish: Vector3, limit: float) -> Dictionary:
	var best := {}
	if str(actor.get_meta("enemy_type", "")) == "skeleton":
		if game.guardians != null and game.guardians.has_method("projectile_contact"):
			best = game.guardians.projectile_contact(actor, start, finish)
		if best.is_empty() and game.animation != null:
			best = SkeletonContact.contact(actor, game.animation.actors.get(actor.get_instance_id(), {}), start, finish)
		if not best.is_empty():
			best["collider"] = actor
		return best if best.is_empty() or start.distance_squared_to(best.position) < limit else {}
	var frame := Engine.get_process_frames()
	if frame != _posed_frame:
		_posed_frame = frame
		_posed_meshes.clear()
		if frame % 128 == 0: _prune_caches()
	var meshes := _meshes(actor)
	var envelope: float = float(_actor_meshes[actor.get_instance_id()].get("radius", INF))
	if envelope < INF:
		var a := actor.to_local(start)
		var b := actor.to_local(finish)
		if Geometry3D.get_closest_point_to_segment(Vector3.ZERO, a, b).length_squared() > envelope * envelope:
			return {}
	for mesh in meshes:
		if not is_instance_valid(mesh) or not mesh.is_visible_in_tree() or mesh.mesh == null: continue
		var part := _part(mesh, actor)
		if str(actor.get_meta("enemy_type", "")) == "skeleton" and actor.get_meta("skeleton_missing_" + part, false): continue
		var skeleton := _skeleton(mesh)
		var surfaces: Array
		if skeleton != null and mesh.skin != null:
			var bounds := _posed_bounds(mesh, skeleton)
			if bounds.intersects_segment(start, finish) == null: continue
			surfaces = _posed_surfaces(mesh, skeleton)
		else:
			var transform: Transform3D = mesh.global_transform
			if (transform * mesh.mesh.get_aabb()).intersects_segment(start, finish) == null: continue
			surfaces = _arrays(mesh.mesh)
		var found := _triangles(surfaces, start, finish, mesh.global_transform if skeleton == null or mesh.skin == null else Transform3D.IDENTITY)
		if found.is_empty(): continue
		var distance: float = start.distance_squared_to(found.position)
		if distance >= limit: continue
		limit = distance
		best = {"collider": actor, "position": found.position, "normal": found.normal, "surface": mesh, "part": part}
	return best

func _meshes(actor: Node3D) -> Array:
	var id := actor.get_instance_id()
	var cache: Dictionary = _actor_meshes.get(id, {})
	var valid: bool = not cache.is_empty() and cache.actor.get_ref() == actor
	if valid:
		for entry in cache.hierarchy:
			var node = entry.node.get_ref()
			if node == null or node.get_child_count() != int(entry.count):
				valid = false
				break
			if node != actor and node is Node3D and (node.position != entry.position or _node_stretch(node) != float(entry.stretch)):
				valid = false
				break
	if valid:
		for entry in cache.meshes:
			var mesh: MeshInstance3D = entry.node.get_ref()
			if mesh == null or not actor.is_ancestor_of(mesh) or mesh.mesh == null or mesh.mesh.get_instance_id() != int(entry.resource) or mesh.mesh.get_aabb() != entry.aabb:
				valid = false
				break
	if not valid:
		var found := []
		var hierarchy := []
		_collect_meshes(actor, found, hierarchy)
		var refs := []
		var radius := 0.0
		for mesh in found:
			var resource: Mesh = mesh.mesh
			refs.append({"node": weakref(mesh), "resource": resource.get_instance_id() if resource != null else 0, "aabb": resource.get_aabb() if resource != null else AABB()})
			if resource == null: continue
			# Weighted skins need current bone bounds, so do not use the rigid envelope.
			if mesh.skin != null:
				radius = INF
				continue
			if radius < INF:
				var box: AABB = resource.get_aabb()
				var extent := box.get_center().length() + box.size.length() * 0.5
				var node: Node3D = mesh
				while node != actor and node != null:
					extent = node.position.length() + _node_stretch(node) * extent
					node = node.get_parent() as Node3D
				if node == actor: radius = maxf(radius, extent)
				else: radius = INF
		_actor_meshes[id] = {"actor": weakref(actor), "hierarchy": hierarchy, "meshes": refs, "radius": radius}
		return found
	var result := []
	for entry in cache.meshes: result.append(entry.node.get_ref())
	return result

func _collect_meshes(node: Node, found: Array, hierarchy: Array) -> void:
	hierarchy.append({"node": weakref(node), "count": node.get_child_count(),
		"position": node.position if node is Node3D else Vector3.ZERO,
		"stretch": _node_stretch(node) if node is Node3D else 1.0})
	for child in node.get_children():
		if child is MeshInstance3D and not _decorative_mesh(child): found.append(child)
		if child is Node3D and not _decorative_branch(child): _collect_meshes(child, found, hierarchy)

func _node_stretch(node: Node3D) -> float:
	var basis: Basis = node.transform.basis
	var x := basis.x.length()
	var y := basis.y.length()
	var z := basis.z.length()
	if absf(basis.x.dot(basis.y)) > 0.000001 or absf(basis.x.dot(basis.z)) > 0.000001 or absf(basis.y.dot(basis.z)) > 0.000001:
		return sqrt(x * x + y * y + z * z) # Conservative for imported shear.
	return maxf(x, maxf(y, z))

func _prune_caches() -> void:
	for id in _actor_meshes.keys():
		if _actor_meshes[id].actor.get_ref() == null: _actor_meshes.erase(id)
	for id in _surface_arrays.keys():
		if _surface_arrays[id].mesh.get_ref() == null: _surface_arrays.erase(id)

func _decorative_branch(node: Node3D) -> bool:
	var label := str(node.name).to_lower()
	return label in ["chopproxy", "collisionproxy", "hitproxy", "particlefx", "vfx", "effects"]

func _decorative_mesh(mesh: MeshInstance3D) -> bool:
	var label := str(mesh.name).to_lower()
	return label in ["far", "chopproxy"] or "shadow" in label or mesh.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY or mesh.get_meta("shadow_only", false)

func _part(mesh: MeshInstance3D, actor: Node3D) -> String:
	var node: Node = mesh
	while node != null and node != actor:
		var label := str(node.name).to_lower()
		if "head" in label or "skull" in label: return "head"
		if "shield" in label: return "shield"
		if "arm_l" in label or "leftarm" in label: return "arm_l"
		if "arm_r" in label or "rightarm" in label: return "arm_r"
		if "leg_l" in label or "leftleg" in label: return "leg_l"
		if "leg_r" in label or "rightleg" in label: return "leg_r"
		if "tail" in label: return "tail"
		node = node.get_parent()
	return "body"

func _skeleton(mesh: MeshInstance3D) -> Skeleton3D:
	if mesh.skeleton == NodePath(""): return null
	return mesh.get_node_or_null(mesh.skeleton) as Skeleton3D

func _posed_bounds(mesh: MeshInstance3D, skeleton: Skeleton3D) -> AABB:
	var rest: AABB = mesh.mesh.get_aabb()
	var skin: Skin = mesh.skin
	var bounds := AABB()
	var found := false
	for bind in range(skin.get_bind_count()):
		var name := skin.get_bind_name(bind)
		var bone := skeleton.find_bone(name) if name != "" else skin.get_bind_bone(bind)
		if bone < 0 or bone >= skeleton.get_bone_count(): continue
		var box: AABB = (skeleton.global_transform * skeleton.get_bone_global_pose(bone) * skin.get_bind_pose(bind)) * rest
		bounds = bounds.merge(box) if found else box
		found = true
	return bounds if found else mesh.global_transform * rest

func _posed_surfaces(mesh: MeshInstance3D, skeleton: Skeleton3D) -> Array:
	var id := mesh.get_instance_id()
	if _posed_meshes.has(id): return _posed_meshes[id]
	var baked: ArrayMesh = _baker._bake(mesh, skeleton, Transform3D.IDENTITY)
	var surfaces := []
	for index in range(baked.get_surface_count()):
		if baked.surface_get_primitive_type(index) == Mesh.PRIMITIVE_TRIANGLES: surfaces.append(baked.surface_get_arrays(index))
	_posed_meshes[id] = surfaces
	return surfaces

func _arrays(resource: Mesh) -> Array:
	var id := resource.get_instance_id()
	var cache: Dictionary = _surface_arrays.get(id, {})
	if not cache.is_empty() and cache.mesh.get_ref() == resource: return cache.arrays
	var result := []
	for index in range(resource.get_surface_count()):
		if not resource is ArrayMesh or resource.surface_get_primitive_type(index) == Mesh.PRIMITIVE_TRIANGLES:
			result.append(resource.surface_get_arrays(index))
	_surface_arrays[id] = {"mesh": weakref(resource), "arrays": result}
	return result

func _triangles(surfaces: Array, start: Vector3, finish: Vector3, transform: Transform3D) -> Dictionary:
	var inverse := transform.affine_inverse()
	var a := inverse * start
	var direction := inverse * finish - a
	var best_t := 1.0
	var best := {}
	for arrays in surfaces:
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] is PackedInt32Array else PackedInt32Array()
		var count := indices.size() if not indices.is_empty() else vertices.size()
		for offset in range(0, count - 2, 3):
			var i0 := int(indices[offset]) if not indices.is_empty() else offset
			var i1 := int(indices[offset + 1]) if not indices.is_empty() else offset + 1
			var i2 := int(indices[offset + 2]) if not indices.is_empty() else offset + 2
			var edge1 := vertices[i1] - vertices[i0]
			var edge2 := vertices[i2] - vertices[i0]
			var p := direction.cross(edge2)
			var determinant := edge1.dot(p)
			if absf(determinant) < 0.000001: continue
			var relative := a - vertices[i0]
			var u := relative.dot(p) / determinant
			if u < -0.00001 or u > 1.00001: continue
			var q := relative.cross(edge1)
			var v := direction.dot(q) / determinant
			if v < -0.00001 or u + v > 1.00001: continue
			var t := edge2.dot(q) / determinant
			if t < 0.0 or t > best_t: continue
			best_t = t
			var normal: Vector3 = transform.basis.inverse().transposed() * edge1.cross(edge2)
			best = {"position": transform * (a + direction * t), "normal": normal.normalized()}
	return best
