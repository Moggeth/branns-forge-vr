extends SceneTree

## Check that the authored islands still support arrival and grapple traversal.
const World = preload("res://world_zones.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var scene := Node3D.new()
	root.add_child(scene)
	var data: Dictionary = World.build(scene)
	var expectations := {
		"sky_garden": {"assets": 35, "placements": 200, "colliders": 35, "floors": 3, "anchors": 3,
			"solid_probe": Vector3(-10, 4.0, -11), "solid_name": "ZoneArtSolid_windmill_tower",
			"islands": [Vector3(0,0,6),Vector3(-10,1.8,-11),Vector3(10,3.2,-10)],
			"arrival": [Vector3(0,1.15,8),Vector3(0,1.15,12),Vector3(-1,1.15,4)]},
		"cloudbreak_keep": {"assets": 30, "placements": 250, "colliders": 50, "floors": 4, "anchors": 4,
			"solid_probe": Vector3(-12.1, 2.0, 20.5), "solid_name": "ZoneArtSolid_keep_tower",
			"islands": [Vector3(0,0,10),Vector3(-16,2.2,-8),Vector3(15,4.2,-15),Vector3(-3,6,-25)],
			"arrival": [Vector3(0,1.15,10),Vector3(0,1.15,15),Vector3(0,1.15,6)]}
	}
	var report := {}
	for zone_id in expectations:
		var need: Dictionary = expectations[zone_id]
		var zone: Dictionary = data.zones[zone_id]
		var art: Dictionary = zone.get("authored_art", {})
		if int(art.get("assets", 0)) < int(need.assets) or int(art.get("placements", 0)) < int(need.placements):
			failures.append(zone_id + ": authored environment is missing or incomplete")
		if int(art.get("colliders", 0)) < int(need.colliders):
			failures.append(zone_id + ": authored trees or architecture lost their physical proxies")
		var floors := 0
		for child in zone.root.get_children():
			if child is StaticBody3D and child.get_meta("kind", "") == "floor": floors += 1
		if floors != int(need.floors): failures.append(zone_id + ": island floor colliders changed")
		var anchors := 0
		var blooms := 0
		for anchor in data.anchors:
			if anchor.get_meta("zone", "") == zone_id: anchors += 1
		for pickup in data.resources:
			if pickup.get_meta("zone", "") == zone_id and pickup.get_meta("resource", "") == "sky_bloom": blooms += 1
		if anchors != int(need.anchors): failures.append(zone_id + ": grapple anchors changed")
		if blooms != 3: failures.append(zone_id + ": sky-bloom pickups changed")
		report[zone_id] = {"art":art,"floors":floors,"anchors":anchors,"blooms":blooms}
	var rotor: Node = data.zones.sky_garden.root.find_child("WindmillRotor", true, false)
	if rotor == null or rotor.get_child_count() != 1:
		failures.append("authored windmill rotor is not separately animated")
	await physics_frame
	var space := scene.get_world_3d().direct_space_state
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.27
	capsule.height = 1.5
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = capsule
	query.collision_mask = 1
	for zone_id in expectations:
		var zone: Dictionary = data.zones[zone_id]
		var need: Dictionary = expectations[zone_id]
		var probe: Vector3 = zone.center + need.solid_probe
		var solid_ray := PhysicsRayQueryParameters3D.create(probe + Vector3(-3, 0, 0), probe + Vector3(3, 0, 0), 1)
		var solid_hit := space.intersect_ray(solid_ray)
		if solid_hit.is_empty() or solid_hit.collider.name != need.solid_name:
			failures.append(zone_id + ": solid visual is missing physical collision at " + str(probe))
		for local: Vector3 in need.islands:
			var above: Vector3 = zone.center + local + Vector3.UP * 1.5
			var below: Vector3 = zone.center + local + Vector3.DOWN * 0.7
			var ray := PhysicsRayQueryParameters3D.create(above, below, 1)
			var grounded := false
			var touched: Array[String] = []
			var excluded: Array[RID] = []
			# A windmill or harvestable may stand over a valid island floor.
			for layer in range(8):
				var hit := space.intersect_ray(ray)
				if hit.is_empty(): break
				touched.append(hit.collider.name + ":" + str(hit.collider.get_meta("kind", "")))
				if hit.collider.get_meta("kind", "") == "floor":
					grounded = true
					break
				excluded.append(hit.collider.get_rid())
				ray.exclude = excluded
			if not grounded:
				failures.append(zone_id + ": missing standing floor at " + str(local) + " hits=" + str(touched))
		for local: Vector3 in need.arrival:
			query.transform = Transform3D(Basis.IDENTITY, zone.center + local)
			var overlaps := space.intersect_shape(query, 16)
			for overlap in overlaps:
				var blocker: CollisionObject3D = overlap.collider
				if blocker.name.begins_with("ZoneArtSolid"):
					failures.append(zone_id + ": art blocks arrival route at " + str(local) + " via " + blocker.name)
					break
	print("SKYLANDS_ART_RESULT ", JSON.stringify({"failures":failures,"zones":report}))
	quit(0 if failures.is_empty() else 1)
