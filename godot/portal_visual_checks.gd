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
	if links.get("forge_yard", []) != HUB_TARGETS:
		failures.append("seven-gate hub order or identity changed")
	for target in HUB_TARGETS:
		if not links.get(target, []).has("forge_yard"):
			failures.append("missing hub return from " + target)
	for parent in BRANCHES:
		var child: String = BRANCHES[parent]
		if not links.get(parent, []).has(child) or not links.get(child, []).has(parent):
			failures.append("missing branch pair " + parent + " / " + child)
	var baseline_blocks := 0
	for portal in data.portals:
		for child in portal.get_children():
			if child is StaticBody3D:
				baseline_blocks += 1
	if baseline_blocks != data.portals.size():
		failures.append("legacy trigger-body count changed; revisit aperture migration")
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
			kit.queue_free()
	print("PORTAL_VISUAL_RESULT ", JSON.stringify({"failures":failures, "portals":data.portals.size(), "legacy_blocked_apertures":baseline_blocks}))
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
			if bounds.intersects(clearance) and not bool(node.get_meta("portal_translucent_interior", false)):
				failures.append(target + ": opaque visual crosses walkable aperture at " + node.name)
