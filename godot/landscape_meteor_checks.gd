extends SceneTree

const Meteor = preload("res://landscape_meteor.gd")
const Ops = preload("res://landscape_operations.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var source: Dictionary = Meteor.make_record(Vector2(10.0, -12.0), 421, 3.0)
	var roundtrip: Dictionary = JSON.parse_string(JSON.stringify(source))
	if int(roundtrip.ore) != int(source.ore) or roundtrip.veins.size() != source.veins.size(): failures.append("record JSON roundtrip")
	var op: Dictionary = Meteor.crater_operation(source)
	if not Ops.validate(op): failures.append("crater operation rejected")
	var event: Dictionary = Meteor.impact_event(source)
	if Meteor.damage_at(event, Vector3(10, 3, -12)) != 35.0: failures.append("impact center damage")
	if Meteor.damage_at(event, Vector3(19, 3, -12)) != 0.0: failures.append("impact escaped radius")
	if Meteor.damage_at(event, Vector3(10, 11, -12)) != 0.0: failures.append("impact crossed vertical limit")
	var meteor := Meteor.new()
	root.add_child(meteor)
	var mesh: ArrayMesh = Meteor._rock_mesh()
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var normals: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_NORMAL]
	var edges: Dictionary = {}
	for i in range(0, vertices.size(), 3):
		var centroid: Vector3 = (vertices[i] + vertices[i+1] + vertices[i+2]) / 3.0
		var winding: Vector3 = (vertices[i+1]-vertices[i]).cross(vertices[i+2]-vertices[i])
		for edge in 3:
			var a: Vector3=vertices[i+edge]
			var b: Vector3=vertices[i+(edge+1)%3]
			var ka := "%d,%d,%d" % [roundi(a.x*10000),roundi(a.y*10000),roundi(a.z*10000)]
			var kb := "%d,%d,%d" % [roundi(b.x*10000),roundi(b.y*10000),roundi(b.z*10000)]
			var edge_key: String=ka+"|"+kb if ka<kb else kb+"|"+ka
			edges[edge_key]=int(edges.get(edge_key,0))+1
		if winding.length_squared() < 0.000001: continue
		if winding.dot(centroid) >= 0.00001 or normals[i].dot(centroid) <= 0.00001:
			failures.append("meteor front winding or normal faces inward at triangle %d" % (i / 3))
			break
	for count in edges.values():
		if int(count) != 2:
			failures.append("meteor mesh has an open or nonmanifold edge")
			break
	var impacts := [0]
	meteor.impact_ready.connect(func(_value): impacts[0] += 1)
	meteor.setup(source, true)
	if meteor.impacted or not meteor.strike(meteor.global_position, "quarry_pick").reason == "falling": failures.append("fall gate")
	meteor.advance(1.5)
	meteor.advance(1.5)
	await physics_frame
	if not meteor.collider.get_child(0).shape is ConcavePolygonShape3D:
		failures.append("meteor collider is not the visible triangle mesh")
	var space := root.world_3d.direct_space_state
	var center: Vector3 = meteor.collider.global_position
	var top_hit: Dictionary = space.intersect_ray(PhysicsRayQueryParameters3D.create(center+Vector3.UP*4.0,center))
	if top_hit.is_empty() or top_hit.collider != meteor.collider or top_hit.normal.dot(Vector3.UP) < 0.6:
		failures.append("top pick ray did not reach outward meteor surface")
	var side_hit: Dictionary = space.intersect_ray(PhysicsRayQueryParameters3D.create(center+Vector3.RIGHT*4.0,center))
	if side_hit.is_empty() or side_hit.collider != meteor.collider or side_hit.normal.dot(Vector3.RIGHT) < 0.45:
		failures.append("side pick ray did not reach outward meteor surface")
	if impacts[0] != 1 or not meteor.impacted: failures.append("impact emitted more or less than once: " + str(impacts[0]))
	var near: Vector3 = meteor.gems[0].global_position
	if meteor.strike(near, "woodland_axe").get("ok", false): failures.append("wrong tool mined")
	if meteor.strike(near, "quarry_pick", 0.2).get("ok", false): failures.append("weak strike mined")
	var mined := meteor.strike(near, "quarry_pick", 1.0)
	if mined.get("kind", "") != "meteor_gem" or meteor.remaining_gems() != 11: failures.append("gem extraction")
	if int(mined.get("scar_count",0)) != 1 or meteor.scar_display.multimesh.instance_count != 1:
		failures.append("successful strike left no local surface mark")
	var scar_point: Array = meteor.record.scars[0].point
	var scar_world: Vector3 = meteor.core.to_global(Vector3(float(scar_point[0]),float(scar_point[1]),float(scar_point[2])))
	var scar_direction: Vector3 = (scar_world-meteor.core.global_position).normalized()
	var scar_ray: Dictionary = space.intersect_ray(PhysicsRayQueryParameters3D.create(
		meteor.core.global_position+scar_direction*4.0,meteor.core.global_position))
	if scar_ray.is_empty() or scar_ray.collider != meteor.collider or scar_ray.position.distance_to(scar_world) > 0.02:
		failures.append("gem strike mark is buried inside the meteor")
	var saved: Dictionary = JSON.parse_string(JSON.stringify(meteor.to_record()))
	meteor.queue_free()
	var restored := Meteor.new()
	root.add_child(restored)
	restored.setup(saved, false)
	if restored.remaining_gems() != 11 or not restored.impacted: failures.append("mined state restore")
	if restored.record.scars.size() != 1 or restored.scar_display.multimesh.instance_count != 1:
		failures.append("mining scar was lost on save restore")
	for gem in restored.gems:
		for i in 2: restored.strike(gem.global_position, "quarry_pick", 1.0)
	if restored.remaining_gems() != 0 or restored.gems[0].visible: failures.append("finite veins")
	var rock_top := restored.global_position + Vector3.UP * 2.55
	for i in 8: restored.strike(rock_top, "quarry_pick", 0.5)
	if restored.remaining_ore() != 0 or restored.strike(rock_top, "quarry_pick").get("reason", "") != "depleted": failures.append("finite ore")
	if restored.record.scars.size() != 20: failures.append("cumulative meteor scars were not saved")
	print("LANDSCAPE_METEOR_RESULT ", failures)
	quit(0 if failures.is_empty() else 1)
