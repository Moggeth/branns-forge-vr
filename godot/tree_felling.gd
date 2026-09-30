extends Node3D
## Owns a felled resource until its existing gather/respawn cycle completes.
## All split geometry stays in resource-local coordinates; only the upper half
## moves around the selected cut plane.

const LOG_SCRIPT = preload("res://physical_lumber_log.gd")
const CUT_SURFACES = ["Crown", "Trunk", "Far", "LeafCards"]
const ENDCAP_ART_PATH := "res://assets/tree_cutting/cut_endcap.glb"

var source: Node3D
var game: Node
var stump: Node3D
var upper: Node3D
var log: RigidBody3D
var hidden: Array = []
var cut_y := 0.0
var fall_normal := Vector3.FORWARD
var collected := false

static func split_mesh(mesh: Mesh, transform: Transform3D, height: float, keep_above: bool) -> ArrayMesh:
	var result := ArrayMesh.new()
	if mesh == null: return result
	for surface in mesh.get_surface_count():
		if mesh.surface_get_primitive_type(surface) != Mesh.PRIMITIVE_TRIANGLES: continue
		var arrays: Array = mesh.surface_get_arrays(surface)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
		var colors: PackedColorArray = arrays[Mesh.ARRAY_COLOR] if arrays[Mesh.ARRAY_COLOR] != null else PackedColorArray()
		var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV] if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
		var uv2s: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV2] if arrays[Mesh.ARRAY_TEX_UV2] != null else PackedVector2Array()
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
		var out_vertices := PackedVector3Array()
		var out_normals := PackedVector3Array()
		var out_colors := PackedColorArray()
		var out_uvs := PackedVector2Array()
		var out_uv2s := PackedVector2Array()
		var count := indices.size() if not indices.is_empty() else vertices.size()
		for tri in range(0, count - 2, 3):
			var polygon: Array = []
			for corner in 3:
				var at: int = indices[tri + corner] if not indices.is_empty() else tri + corner
				polygon.append({"p": vertices[at], "n": normals[at] if not normals.is_empty() else Vector3.UP,
					"c": colors[at] if not colors.is_empty() else Color.WHITE,
					"uv": uvs[at] if not uvs.is_empty() else Vector2.ZERO,
					"uv2": uv2s[at] if not uv2s.is_empty() else Vector2.ZERO})
			var clipped: Array = []
			for edge in 3:
				var a: Dictionary = polygon[edge]
				var b: Dictionary = polygon[(edge + 1) % 3]
				var ay: float = (transform * a.p).y - height
				var by: float = (transform * b.p).y - height
				var a_inside: bool = ay >= -0.00001 if keep_above else ay <= 0.00001
				var b_inside: bool = by >= -0.00001 if keep_above else by <= 0.00001
				if a_inside: clipped.append(a)
				if a_inside != b_inside:
					var t: float = clampf(ay / (ay - by), 0.0, 1.0)
					clipped.append({"p": a.p.lerp(b.p, t), "n": a.n.lerp(b.n, t).normalized(),
						"c": a.c.lerp(b.c, t), "uv": a.uv.lerp(b.uv, t), "uv2": a.uv2.lerp(b.uv2, t)})
			for fan in range(1, clipped.size() - 1):
				for vertex in [clipped[0], clipped[fan], clipped[fan + 1]]:
					out_vertices.append(vertex.p)
					if not normals.is_empty(): out_normals.append(vertex.n)
					if not colors.is_empty(): out_colors.append(vertex.c)
					if not uvs.is_empty(): out_uvs.append(vertex.uv)
					if not uv2s.is_empty(): out_uv2s.append(vertex.uv2)
		if out_vertices.is_empty(): continue
		var output: Array = []
		output.resize(Mesh.ARRAY_MAX)
		output[Mesh.ARRAY_VERTEX] = out_vertices
		if not out_normals.is_empty(): output[Mesh.ARRAY_NORMAL] = out_normals
		if not out_colors.is_empty(): output[Mesh.ARRAY_COLOR] = out_colors
		if not out_uvs.is_empty(): output[Mesh.ARRAY_TEX_UV] = out_uvs
		if not out_uv2s.is_empty(): output[Mesh.ARRAY_TEX_UV2] = out_uv2s
		result.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, output)
		result.surface_set_material(result.get_surface_count() - 1, mesh.surface_get_material(surface))
	return result

func start(owner_game: Node, resource: Node3D, height: float, normal: Vector3) -> void:
	game = owner_game
	source = resource
	cut_y = height
	fall_normal = (source.global_basis.inverse() * normal).normalized()
	global_transform = source.global_transform
	stump = Node3D.new()
	stump.name = "RootedStump"
	add_child(stump)
	upper = Node3D.new()
	upper.name = "FallingUpperTree"
	upper.position.y = cut_y
	add_child(upper)
	for child in source.get_children():
		if child is MeshInstance3D and child.name in CUT_SURFACES:
			hidden.append({"node": child, "visible": child.visible})
			child.visible = false
			_add_piece(child, stump, false)
			_add_piece(child, upper, true)
		elif child.name == "CutWedge":
			hidden.append({"node": child, "visible": child.visible})
			child.visible = false
	game._set_collisions(source, false)
	_add_endgrain()
	_add_stump_collision()
	var axis := Vector3.UP.cross(-fall_normal).normalized()
	if axis.length_squared() < 0.01: axis = Vector3.RIGHT
	var tween := create_tween()
	tween.tween_property(upper, "quaternion", Quaternion(axis, -0.10), 0.22).set_trans(Tween.TRANS_SINE)
	tween.tween_property(upper, "quaternion", Quaternion(axis, 0.13), 0.22).set_trans(Tween.TRANS_SINE)
	tween.tween_property(upper, "quaternion", Quaternion(axis, 1.50), 1.05).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN)
	tween.tween_callback(_drop_log)
	tween.tween_interval(2.5)
	tween.tween_callback(func(): if is_instance_valid(upper): upper.queue_free())
	set_process(true)

func _add_piece(original: MeshInstance3D, parent: Node3D, above: bool) -> void:
	var mesh := split_mesh(original.mesh, original.transform, cut_y, above)
	if mesh.get_surface_count() == 0: return
	var copy := MeshInstance3D.new()
	copy.name = original.name
	copy.mesh = mesh
	copy.material_override = original.material_override
	copy.cast_shadow = original.cast_shadow
	copy.visibility_range_begin = original.visibility_range_begin
	copy.visibility_range_end = original.visibility_range_end
	copy.visibility_range_begin_margin = original.visibility_range_begin_margin
	copy.visibility_range_end_margin = original.visibility_range_end_margin
	copy.visibility_range_fade_mode = original.visibility_range_fade_mode
	parent.add_child(copy)
	copy.transform = original.transform
	if above: copy.position.y -= cut_y

func _add_endgrain() -> void:
	var trunk: MeshInstance3D = source.get_meta("trunk", null)
	if not is_instance_valid(trunk): return
	var local_y: float = (cut_y - trunk.position.y) / maxf(absf(trunk.transform.basis.y.y), 0.001)
	var unit_radius: float = lerpf(0.5, 0.25, clampf(local_y + 0.5, 0.0, 1.0))
	var radius: float = unit_radius * maxf(trunk.transform.basis.x.length(), trunk.transform.basis.z.length())
	var centre: Vector3 = trunk.transform * Vector3(0, local_y, 0)
	centre.y = cut_y
	var placements: Array[Node3D] = [stump]
	if is_instance_valid(upper): placements.append(upper)
	for placement in placements:
		var cap: Node3D
		if ResourceLoader.exists(ENDCAP_ART_PATH):
			cap = load(ENDCAP_ART_PATH).instantiate()
			cap.scale = Vector3.ONE * radius
			if placement == upper: cap.rotation.x = PI
		else:
			var fallback := MeshInstance3D.new()
			var cylinder := CylinderMesh.new()
			cylinder.top_radius = radius
			cylinder.bottom_radius = radius
			cylinder.height = 0.012
			cylinder.radial_segments = 16
			fallback.mesh = cylinder
			fallback.material_override = _material(Color("d1a472"))
			cap = fallback
		cap.name = "CutEndgrain"
		placement.add_child(cap)
		cap.position = centre - (Vector3.UP * cut_y if placement == upper else Vector3.ZERO)
		cap.position.y += -0.006 if placement == upper else 0.006

func _add_stump_collision() -> void:
	var body := StaticBody3D.new()
	body.name = "StumpCollision"
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(0.48, maxf(cut_y, 0.1), 0.48)
	shape.shape = box
	body.position.y = cut_y * 0.5
	body.add_child(shape)
	stump.add_child(body)

static func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.95
	return material

func _drop_log() -> void:
	if not is_instance_valid(source): return
	log = LOG_SCRIPT.new()
	log.name = "PhysicalLumberLog"
	get_parent().add_child(log)
	var outward: Vector3 = (source.global_basis * fall_normal).normalized()
	log.global_position = source.to_global(Vector3(0, maxf(cut_y, 0.3) + 0.30, 0)) + outward * 1.0
	log.setup(game, source, self)
	log.apply_central_impulse((outward + Vector3.UP * 0.25).normalized() * 1.3)

func log_collected() -> void:
	collected = true
	if is_instance_valid(source) and source.has_meta("scenic_builder_key"):
		# The World Builder ledger is permanent; retain this actual clipped stump
		# instead of running the ordinary 35-second resource respawn.
		set_process(false)
		if is_instance_valid(upper): upper.queue_free()

func restore_stump(resource: Node3D, height: float) -> void:
	# Rebuild the same clipped stump from persisted scenic cut height on load.
	source = resource
	cut_y = height
	global_transform = resource.global_transform
	stump = Node3D.new()
	stump.name = "RootedStump"
	add_child(stump)
	for child in resource.get_children():
		if child is MeshInstance3D and child.name in CUT_SURFACES:
			_add_piece(child, stump, false)
	_add_endgrain()
	_add_stump_collision()
	set_process(false)

func _process(_delta: float) -> void:
	if not is_instance_valid(source):
		queue_free()
		return
	if collected and source.visible and not source.get_meta("collecting", false):
		for entry in hidden:
			if is_instance_valid(entry.node):
				if entry.node.name == "CutWedge": entry.node.queue_free()
				else: entry.node.visible = entry.visible
		game._set_collisions(source, true)
		source.set_meta("felled", false)
		source.set_meta("cut_bands", [])
		queue_free()
