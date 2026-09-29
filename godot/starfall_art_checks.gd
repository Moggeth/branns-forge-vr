extends SceneTree

## The authored mining valley must remain a walkable, usable adventure zone.
const World = preload("res://world_zones.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var scene := Node3D.new()
	root.add_child(scene)
	var data: Dictionary = World.build(scene)
	var zone: Dictionary = data.zones.starfall_ridge
	var art: Dictionary = zone.get("authored_art", {})
	if int(art.get("assets", 0)) < 29 or int(art.get("placements", 0)) < 290:
		failures.append("authored Starfall kit missing or incomplete")
	if int(art.get("colliders", 0)) < 85:
		failures.append("major authored rock or architecture lacks physical collision")
	var resources := {"crystal": 0, "iron": 0}
	for item in data.resources:
		if item.get_meta("zone", "") == "starfall_ridge":
			var kind: String = str(item.get_meta("resource", ""))
			if resources.has(kind): resources[kind] += 1
	if resources.crystal != 4 or resources.iron != 3:
		failures.append("mineable ore changed: " + str(resources))
	var anchors := 0
	var barriers := 0
	for item in data.anchors:
		if item.get_meta("zone", "") == "starfall_ridge": anchors += 1
	for item in data.barriers:
		if item.get_meta("zone", "") == "starfall_ridge": barriers += 1
	if anchors != 3 or barriers != 1:
		failures.append("grapple targets or bomb breach changed")
	await physics_frame
	var space := scene.get_world_3d().direct_space_state
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.28
	capsule.height = 1.6
	var shape_query := PhysicsShapeQueryParameters3D.new()
	shape_query.shape = capsule
	shape_query.collision_mask = 1
	for z in [20.0, 14.0, 8.0, 2.0, -4.0, -10.0, -15.0, -22.0, -24.0]:
		shape_query.transform = Transform3D(Basis.IDENTITY, zone.center + Vector3(0, 0.9, z))
		for hit in space.intersect_shape(shape_query, 24):
			var collider: CollisionObject3D = hit.collider
			if collider.name.begins_with("ZoneArtSolid"):
				failures.append("art blocks main walking route at z=" + str(z) + ": " + collider.name)
				break
	for ore in [Vector2(-12, 3), Vector2(-4, -6), Vector2(4, 3), Vector2(12, -6),
			Vector2(-10, -17), Vector2(0, -17), Vector2(10, -17)]:
		shape_query.transform = Transform3D(Basis.IDENTITY, zone.center + Vector3(ore.x, 0.9, ore.y))
		for hit in space.intersect_shape(shape_query, 24):
			var collider: CollisionObject3D = hit.collider
			if collider.name.begins_with("ZoneArtSolid"):
				failures.append("art blocks mineable ore at " + str(ore) + ": " + collider.name)
				break
	var meteor: Vector3 = zone.center + Vector3(17.1, 1.0, 10.7)
	var rock_ray := PhysicsRayQueryParameters3D.create(meteor + Vector3(-4, 0, 0), meteor + Vector3(4, 0, 0), 1)
	var rock_hit := space.intersect_ray(rock_ray)
	if rock_hit.is_empty() or rock_hit.collider.name != "ZoneArtSolid_meteor_fragment_large":
		failures.append("meteor fragment has no tangible body")
	print("STARFALL_ART_RESULT ", JSON.stringify({"failures":failures,"art":art,"resources":resources,"anchors":anchors,"barriers":barriers}))
	quit(0 if failures.is_empty() else 1)
