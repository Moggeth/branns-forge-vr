extends RefCounted
## Reviewed, reusable geological vocabulary. Structure comes from the shared
## fields; these meshes only supply silhouettes and materials.
const Fields = preload("res://landscape_fields.gd")
const BOULDER_A = "res://assets/landscape/geo_boulder_mossy_a.glb"
const BOULDER_B = "res://assets/landscape/geo_boulder_split_b.glb"
const BANK = "res://assets/landscape/geo_outcrop_bank_straight.glb"

static func populate(root: Node3D, model: Dictionary, ecology: Dictionary) -> Dictionary:
	var mossy: Array[Dictionary] = []
	var split: Array[Dictionary] = []
	var banks: Array[Dictionary] = []
	for rock in ecology.rocks:
		var id: int = abs(str(rock.id).hash())
		if id % 5 != 0: continue
		var point: Vector3 = rock.position
		if Fields.sample(model, "water", Vector2(point.x, point.z)) > 0.08: continue
		if Fields.sample(model, "slope", Vector2(point.x, point.z)) > 0.65: continue
		var pose := {"position": Vector3(point.x, 0.0, point.z), "angle": float(rock.rotation), "scale": 0.66 * float(rock.scale)}
		if id % 2 == 0: mossy.append(pose)
		else: split.append(pose)
	var course: Array = model.get("river_polyline", [])
	for i in range(10, course.size() - 10, 19):
		var a: Vector3 = course[i - 2]
		var b: Vector3 = course[i + 2]
		var tangent := Vector2(b.x - a.x, b.z - a.z).normalized()
		if tangent.length_squared() < 0.5: continue
		var side := Vector2(-tangent.y, tangent.x) * (1.0 if i % 2 == 0 else -1.0)
		var centre := Vector2(course[i].x, course[i].z)
		if centre.distance_to(Vector2(25, -48)) < 18.0: continue
		var width: float = Fields.sample(model, "river_width", centre)
		var bank := centre + side * (width * 0.5 + 1.6)
		if Fields.sample(model, "water", bank) > 0.12: continue
		banks.append({"position": Vector3(bank.x, 0.0, bank.y), "angle": atan2(side.x, side.y), "scale": 0.72})
	_batch(root, BOULDER_A, "LandscapeRock_Mossy", mossy)
	_batch(root, BOULDER_B, "LandscapeRock_Split", split)
	_batch(root, BANK, "LandscapeOutcrop_Bank", banks)
	var counts := {"mossy": mossy.size(), "split": split.size(), "bank": banks.size()}
	print("LANDSCAPE_VOCABULARY ", counts)
	return counts

static func _batch(root: Node3D, path: String, label: String, poses: Array[Dictionary]) -> void:
	if poses.is_empty(): return
	var source_mesh := tuned_mesh(path)
	if source_mesh == null: return
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.mesh = source_mesh
	multi.instance_count = poses.size()
	var locations: Array[Vector3] = []
	for i in poses.size():
		var pose: Dictionary = poses[i]
		var position: Vector3 = pose.position
		locations.append(position)
		var basis := Basis(Vector3.UP, float(pose.angle)).scaled(Vector3.ONE * float(pose.scale))
		multi.set_instance_transform(i, Transform3D(basis, position))
	multi.custom_aabb = AABB(Vector3(-165, -10, -165), Vector3(330, 40, 330))
	var holder := MultiMeshInstance3D.new()
	holder.name = label
	holder.multimesh = multi
	holder.set_meta("dressing_positions", locations)
	root.add_child(holder)

static func tuned_mesh(path: String) -> ArrayMesh:
	var source: PackedScene = load(path)
	if source == null: push_warning("Missing landscape asset " + path); return null
	var sample: Node3D = source.instantiate()
	var mesh_nodes := sample.find_children("*", "MeshInstance3D", true, false)
	if mesh_nodes.is_empty(): sample.free(); push_warning("Empty landscape asset " + path); return null
	var imported: Mesh = (mesh_nodes[0] as MeshInstance3D).mesh
	if imported == null or not imported is ArrayMesh: sample.free(); return null
	var result: ArrayMesh = imported.duplicate(true)
	for surface in result.get_surface_count():
		var material: Material = result.surface_get_material(surface)
		if material is BaseMaterial3D:
			var tuned: BaseMaterial3D = material.duplicate(true)
			# Godot preserved the vertex colours but disabled their albedo use,
			# making the commissioned stones appear chalk white.
			tuned.vertex_color_use_as_albedo = true
			result.surface_set_material(surface, tuned)
	sample.free()
	return result
