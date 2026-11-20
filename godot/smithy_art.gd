extends RefCounted
## Runtime adapters for the metre-scale authored smithy kit. Mechanics own collision.
const KIT := "res://assets/smithy/"
const Layout = preload("res://smithy_layout.gd")
const ZoneArt = preload("res://authored_zone_kit.gd")

static func place(parent: Node3D, asset: String, at := Vector3.ZERO, size := Vector3.ONE) -> Node3D:
	var scene := load(KIT + asset + ".glb") as PackedScene
	var model := scene.instantiate() as Node3D
	model.position = at
	model.scale = size
	parent.add_child(model)
	return model

## glTF COLOR_0 drives these landscape materials. Godot imports the array but can
## leave the StandardMaterial vertex-colour flag disabled for untextured surfaces.
static func use_authored_colors(model: Node3D) -> void:
	var materials := {}
	for part: MeshInstance3D in model.find_children("*","MeshInstance3D",true,false):
		for index in part.mesh.get_surface_count():
			if not part.mesh.surface_get_format(index) & Mesh.ARRAY_FORMAT_COLOR: continue
			var base := part.get_active_material(index) as StandardMaterial3D
			if base == null: continue
			if not materials.has(base):
				var finish := base.duplicate() as StandardMaterial3D
				finish.vertex_color_use_as_albedo = true
				materials[base] = finish
			part.set_surface_override_material(index,materials[base])

## Draw repeated static artwork in batches while keeping each original material and local pose.
static func repeat_model(parent: Node3D, asset: String, poses: Array[Transform3D]) -> void:
	if poses.is_empty(): return
	var scene := load(KIT + asset + ".glb") as PackedScene
	var model := scene.instantiate() as Node3D
	var parts: Array = []
	ZoneArt.collect_mesh_parts(model, Transform3D.IDENTITY, parts)
	if model is MeshInstance3D: parts.append({"mesh":model.mesh, "pose":model.transform, "material":model.material_override})
	model.free()
	for part in parts:
		var batch := MultiMesh.new()
		batch.transform_format = MultiMesh.TRANSFORM_3D
		batch.mesh = part.mesh
		if asset == "landscape/meadow_edge":
			var colored := (part.mesh as ArrayMesh).duplicate() as ArrayMesh
			for index in colored.get_surface_count():
				var finish := (colored.surface_get_material(index) as StandardMaterial3D).duplicate() as StandardMaterial3D
				finish.vertex_color_use_as_albedo = true
				colored.surface_set_material(index,finish)
			batch.mesh = colored
		batch.instance_count = poses.size()
		for i in poses.size(): batch.set_instance_transform(i, poses[i] * part.pose)
		var holder := MultiMeshInstance3D.new()
		holder.name = asset.get_file().to_pascal_case()
		holder.material_override = part.material
		holder.multimesh = batch
		parent.add_child(holder)

static func paved_court(parent: Node3D) -> void:
	var center := Vector3(0,0,4)
	var lanes := [[Layout.SPAWN, center], [center, Vector3(16,0,4)], [Vector3(-8,0,1), Vector3(8,0,1)]]
	for i in Layout.DESTINATIONS.size(): lanes.append([center, Layout.gate_position(i)])
	var squares := {}
	for lane in lanes:
		var start: Vector3 = lane[0]
		var finish: Vector3 = lane[1]
		var steps := ceili(start.distance_to(finish) / 0.5)
		for step in steps + 1:
			var point := start.lerp(finish, float(step) / maxi(1,steps))
			squares[Vector2i(roundi(point.x / 2.0),roundi(point.z / 2.0))] = true
	var poses: Array[Transform3D] = []
	for cell: Vector2i in squares:
		var quarter := posmod(cell.x * 7 + cell.y, 4)
		poses.append(Transform3D(Basis(Vector3.UP, quarter * PI/2), Vector3(cell.x * 2, 0.01, cell.y * 2)))
	repeat_model(parent, "smithy/court_tile", poses)

## Pocket doors work with the existing trigger or click action. The ray target leaves feet free.
static func doorway(parent: Node3D, asset: String, at: Vector3, action: String) -> Node3D:
	var gate := Node3D.new()
	parent.add_child(gate)
	gate.position = at
	gate.set_meta("kind", "button")
	gate.set_meta("action", action)
	var archive := action.begins_with("museum:")
	var portal = preload("res://portal_kit/portal_kit.gd").create("starfall_ridge" if archive else "sky_garden")
	portal.name = "PortalVisuals"
	portal.pocket_frame = KIT + asset + ".glb"
	portal.view_id = ("museum" if archive else "bellworks") if action.ends_with("enter") else "forge_yard"
	portal.glow_color = Color("7abfbd" if archive else "ebb666")
	gate.add_child(portal)
	var area := Area3D.new()
	area.name = "DoorwayInteraction"
	area.collision_mask = 0
	area.position.y = 1.2
	gate.add_child(area)
	var box := BoxShape3D.new()
	box.size = Vector3(1.30,2.35,0.14)
	var collider := CollisionShape3D.new()
	collider.shape = box
	area.add_child(collider)
	return gate
