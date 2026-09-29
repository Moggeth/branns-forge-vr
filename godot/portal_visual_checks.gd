extends SceneTree

const World = preload("res://world_zones.gd")
const HUB_TARGETS := ["pinewood_ruins", "sandstone_quarry", "enchanted_kitchen", "mushroom_glade", "crystal_hollow", "sky_garden", "ember_foundry"]
const BRANCHES := {"pinewood_ruins":"orchard_highlands", "mushroom_glade":"gloamfen", "crystal_hollow":"starfall_ridge", "sky_garden":"cloudbreak_keep"}

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var scene := Node3D.new()
	root.add_child(scene)
	var data: Dictionary = World.build(scene)
	var links := {}
	for portal in data.portals:
		var source := str(portal.get_meta("zone", ""))
		var target := str(portal.get_meta("target_zone", ""))
		if not data.zones.has(source) or not data.zones.has(target):
			failures.append("unknown source or destination on " + portal.name)
			continue
		if not links.has(source): links[source] = []
		links[source].append(target)
		if not portal.is_in_group("adventure_portal") or portal.get_meta("kind", "") != "portal" or portal.get_meta("action", "") != "travel:" + target:
			failures.append("interaction identity on " + portal.name)
		if portal.get_meta("base_position", Vector3.INF) != portal.position:
			failures.append("base position on " + portal.name)
		var wanted: Vector3 = Vector3(0, portal.position.y, -4) if source == "forge_yard" else Vector3(data.zones[source].center.x, portal.position.y, data.zones[source].center.z)
		var forward: Vector3 = portal.global_basis.z.normalized()
		var direction: Vector3 = (wanted - portal.global_position).normalized()
		if forward.dot(direction) < 0.99:
			failures.append("facing on " + portal.name)
		var authored := portal.get_node_or_null("PortalVisuals") as Node3D
		if authored == null:
			failures.append("missing authored kit on " + portal.name)
		else:
			if str(authored.get("zone_id")) != target:
				failures.append("wrong destination art on " + portal.name)
			_check_kit(authored, target, failures)
	if links.get("forge_yard", []) != HUB_TARGETS:
		failures.append("seven-gate hub order or identity changed")
	for target in HUB_TARGETS:
		if not links.get(target, []).has("forge_yard"):
			failures.append("missing hub return from " + target)
	for parent in BRANCHES:
		var child: String = BRANCHES[parent]
		if not links.get(parent, []).has(child) or not links.get(child, []).has(parent):
			failures.append("missing branch pair " + parent + " / " + child)
	var walkable_targets := 0
	for portal in data.portals:
		var interaction := portal.get_node_or_null("PortalInteraction") as Area3D
		if interaction == null:
			failures.append("missing nonblocking interaction surface on " + portal.name)
			continue
		var shape := interaction.get_node_or_null("CollisionShape3D") as CollisionShape3D
		if shape == null or not (shape.shape is BoxShape3D):
			failures.append("missing portal interaction shape on " + portal.name)
			continue
		if interaction.collision_layer == 0 or (shape.shape as BoxShape3D).size.x < 0.8:
			failures.append("portal ray target is too narrow on " + portal.name)
		walkable_targets += 1
		for child in portal.get_children():
			if child is StaticBody3D:
				failures.append("solid body still blocks the gateway on " + portal.name)
	if walkable_targets != data.portals.size():
		failures.append("not all portals have walkable interaction areas")
	await physics_frame
	var space := scene.get_world_3d().direct_space_state
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.27
	capsule.height = 1.5
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = capsule
	query.collision_mask = 1
	for portal in data.portals:
		for depth in [0.65, 0.0, -0.65]:
			query.transform = Transform3D(portal.global_basis, portal.to_global(Vector3(0, 1.05, depth)))
			var overlaps := space.intersect_shape(query, 8)
			if not overlaps.is_empty():
				var obstacle: CollisionObject3D = overlaps[0].collider
				var obstacle_shape := obstacle.get_child(0) as CollisionShape3D if obstacle.get_child_count() > 0 else null
				var dimensions := str((obstacle_shape.shape as BoxShape3D).size) if obstacle_shape != null and obstacle_shape.shape is BoxShape3D else (str(obstacle_shape.shape.get_class()) if obstacle_shape != null else "no shape")
				failures.append("standing player capsule blocked at " + portal.name + " depth " + str(depth) + " by " + str(obstacle.name) + " parent " + str(obstacle.get_parent().name) + " shape " + dimensions + " at " + str(obstacle_shape.global_position if obstacle_shape != null else obstacle.global_position) + " portal " + str(portal.global_position))
				break
		var from: Vector3 = portal.to_global(Vector3(0, 1.05, 1.2))
		var toward: Vector3 = portal.to_global(Vector3(0, 1.05, -0.4))
		var ray := PhysicsRayQueryParameters3D.create(from, toward, 1)
		ray.collide_with_areas = true
		var hit := space.intersect_ray(ray)
		if hit.is_empty() or hit.collider != portal.get_node_or_null("PortalInteraction"):
			failures.append("approach ray does not reach interaction surface on " + portal.name + " (hit " + str(hit.collider.name if not hit.is_empty() else "nothing") + ")")
	for arg in OS.get_cmdline_user_args():
		if not arg.begins_with("--visual-scene="): continue
		var path := arg.trim_prefix("--visual-scene=")
		var packed := load(path) as PackedScene
		if packed == null:
			failures.append("cannot load visual scene " + path)
			continue
		for target in HUB_TARGETS:
			var kit := packed.instantiate() as Node3D
			if kit == null:
				failures.append("visual scene root must be Node3D")
				break
			var portal: Node3D = _portal(data.portals, "forge_yard", target)
			portal.add_child(kit)
			_check_kit(kit, target, failures)
			if not kit.has_method("play_entrance") or not kit.has_method("play_exit"):
				failures.append(target + ": portal is missing transition effects")
			else:
				kit.call("play_entrance")
				kit.call("play_exit")
			kit.queue_free()
	for arg in OS.get_cmdline_user_args():
		if not arg.begins_with("--visual-script="): continue
		var path := arg.trim_prefix("--visual-script=")
		var visual_script := load(path) as Script
		if visual_script == null:
			failures.append("cannot load visual script " + path)
			continue
		for target in HUB_TARGETS:
			var kit := visual_script.create(target) as Node3D
			if kit == null:
				failures.append(target + ": visual factory must return Node3D")
				continue
			var portal: Node3D = _portal(data.portals, "forge_yard", target)
			portal.add_child(kit)
			_check_kit(kit, target, failures)
			kit.queue_free()
	print("PORTAL_VISUAL_RESULT ", JSON.stringify({"failures":failures, "portals":data.portals.size(), "walkable_interaction_areas":walkable_targets}))
	quit(0 if failures.is_empty() else 1)

func _portal(portals: Array, source: String, target: String) -> Node3D:
	for portal in portals:
		if portal.get_meta("zone", "") == source and portal.get_meta("target_zone", "") == target:
			return portal
	return null

func _check_kit(kit: Node3D, target: String, failures: Array[String]) -> void:
	if kit.position.length() > 0.01 or kit.rotation.length() > 0.01 or kit.scale.distance_to(Vector3.ONE) > 0.01:
		failures.append(target + ": visual root must use portal-local identity transform")
	for node in kit.find_children("*", "", true, false):
		if node is CollisionObject3D or node is CollisionShape3D:
			failures.append(target + ": visual kit contains collision " + node.name)
		if node is MeshInstance3D and node.mesh != null:
			var aabb: AABB = node.mesh.get_aabb()
			var to_portal: Transform3D = kit.global_transform.affine_inverse() * node.global_transform
			var bounds: AABB = to_portal * aabb
			# Clear 0.8 m width, 1.65 m standing height, and 0.6 m depth.
			var clearance := AABB(Vector3(-0.4, 0.35, -0.3), Vector3(0.8, 1.65, 0.6))
			if bounds.intersects(clearance) and not bool(node.get_meta("portal_translucent_interior", false)) and _opaque_triangles_cross(node.mesh, to_portal, clearance):
				failures.append(target + ": opaque visual crosses walkable aperture at " + node.name)

func _opaque_triangles_cross(mesh: Mesh, to_portal: Transform3D, clearance: AABB) -> bool:
	# An arch's combined AABB covers its opening; inspect the component triangles.
	for surface in mesh.get_surface_count():
		if mesh.surface_get_primitive_type(surface) != Mesh.PRIMITIVE_TRIANGLES: continue
		var arrays := mesh.surface_get_arrays(surface)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		var indexed := not indices.is_empty()
		var triangle_count: int = indices.size() / 3 if indexed else vertices.size() / 3
		for face in triangle_count:
			var a: Vector3 = to_portal * vertices[indices[face * 3] if indexed else face * 3]
			var b: Vector3 = to_portal * vertices[indices[face * 3 + 1] if indexed else face * 3 + 1]
			var c: Vector3 = to_portal * vertices[indices[face * 3 + 2] if indexed else face * 3 + 2]
			if AABB(a, Vector3.ZERO).expand(b).expand(c).intersects(clearance) and _triangle_crosses_aperture_xy(a, b, c, Rect2(clearance.position.x, clearance.position.y, clearance.size.x, clearance.size.y)):
				return true
	return false

func _triangle_crosses_aperture_xy(a: Vector3, b: Vector3, c: Vector3, rect: Rect2) -> bool:
	# The portal opening is front-facing; a 2D SAT avoids false positives from
	# a distant arch's large individual triangle bounds crossing the centre.
	var triangle := [Vector2(a.x, a.y), Vector2(b.x, b.y), Vector2(c.x, c.y)]
	var corners := [rect.position, Vector2(rect.end.x, rect.position.y), rect.end, Vector2(rect.position.x, rect.end.y)]
	var axes := [Vector2.RIGHT, Vector2.UP]
	for edge in 3:
		var delta: Vector2 = triangle[(edge + 1) % 3] - triangle[edge]
		axes.append(Vector2(-delta.y, delta.x))
	for axis in axes:
		if axis.length_squared() < 0.000001: continue
		var tmin: float = triangle[0].dot(axis)
		var tmax: float = tmin
		var rmin: float = corners[0].dot(axis)
		var rmax: float = rmin
		for point in triangle:
			tmin = minf(tmin, point.dot(axis))
			tmax = maxf(tmax, point.dot(axis))
		for point in corners:
			rmin = minf(rmin, point.dot(axis))
			rmax = maxf(rmax, point.dot(axis))
		if tmax < rmin or rmax < tmin: return false
	return true
