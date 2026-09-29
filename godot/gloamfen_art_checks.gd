extends SceneTree

const World = preload("res://world_zones.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var scene := Node3D.new()
	root.add_child(scene)
	var data: Dictionary = World.build(scene)
	var zone: Dictionary = data.zones.gloamfen
	var art: Dictionary = zone.get("authored_art", {})
	if int(art.get("assets", 0)) < 25 or int(art.get("placements", 0)) < 190 or int(art.get("colliders", 0)) < 35:
		failures.append("authored wetland kit is missing or too sparse")
	var spores := 0
	for resource in data.resources:
		if resource.get_meta("zone", "") == "gloamfen" and resource.get_meta("resource", "") == "spore": spores += 1
	if spores != 5: failures.append("spore pickups changed")
	var wisps := 0
	for enemy in data.enemies:
		if enemy.get_meta("zone", "") == "gloamfen" and enemy.get_meta("enemy_type", "") == "wisp": wisps += 1
	if wisps != 3: failures.append("wisp inhabitants changed")
	var board_floors := 0
	for child in zone.root.get_children():
		if child is StaticBody3D and child.get_meta("kind", "") == "floor": board_floors += 1
	if board_floors != 18: failures.append("walkable boardwalk or link colliders changed")
	await physics_frame
	var space := scene.get_world_3d().direct_space_state
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.27
	capsule.height = 1.5
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = capsule
	query.collision_mask = 1
	var combatants: Array[RID] = []
	for enemy in data.enemies:
		if enemy.get_meta("zone", "") != "gloamfen": continue
		for child in enemy.get_children():
			if child is CollisionObject3D: combatants.append(child.get_rid())
	query.exclude = combatants
	for step in range(95):
		var local_z: float = 21.0-float(step)*0.5
		query.transform = Transform3D(Basis.IDENTITY, zone.center + Vector3(0,1.15,local_z))
		var overlaps := space.intersect_shape(query, 8)
		if not overlaps.is_empty():
			var blocker: CollisionObject3D = overlaps[0].collider
			var shape_node := blocker.get_child(0) as CollisionShape3D if blocker.get_child_count() > 0 else null
			failures.append("central fen walking line blocked at z=%.1f by %s kind=%s at %s shape=%s" % [local_z, blocker.name, blocker.get_meta("kind", ""), blocker.global_position, shape_node.shape.get_class() if shape_node != null else "none"])
			break
	print("GLOAMFEN_ART_RESULT ", JSON.stringify({"failures":failures,"kit":art,"board_floors":board_floors,"spores":spores,"wisps":wisps}))
	quit(0 if failures.is_empty() else 1)
