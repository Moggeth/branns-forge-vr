extends Node
## Glowmoth's isolated model and scout runtime. The game owns pickup, grip and trigger routing.
## Integration: call Glowmoth.build(item) in the weapon model branch; create this node,
## call setup(game), then call trigger(item, hand, source) from the item action and tick(dt).
## `trigger` returns true when this module owns the action. First press deploys; next recalls.

const SCOUT_DISTANCE := 7.0
const SCOUT_SPEED := 3.2
const LIGHT_RANGE := 5.2
const BODY_RADIUS := 0.12
const RECALL_TIMEOUT := 4.0

var game
var scout: Node3D
var source: Node3D
var held_item: Node3D
var control_hand: Node3D
var destination := Vector3.ZERO
var returning := false
var flight_age := 0.0
var active_zone := ""
var cap_angle := 0.0
var cap_target := 0.0

static func build(root: Node3D, scout_form: bool = false) -> void:
	var visual_root := root
	if not scout_form:
		visual_root = Node3D.new()
		visual_root.name = "GlowmothLanternAssembly"
		root.add_child(visual_root)
		visual_root.position.y = 0.23
		visual_root.scale = Vector3.ONE * 0.8
	var brass := WorkshopScene.material("ad824c", 0.58, 0.40)
	var bright_brass := WorkshopScene.material("d2ae6b", 0.52, 0.36)
	var loop_brass := WorkshopScene.material("987044", 0.36, 0.48, 0.02)
	var dark := WorkshopScene.material("533d2d", 0.58, 0.42)
	var glass := WorkshopScene.material("ffc66e", 0.04, 0.27, 0.9)
	var vein := WorkshopScene.material("d8bb7c", 0.30, 0.42, 0.04)
	var wing_gold: StandardMaterial3D = bright_brass.duplicate()
	wing_gold.cull_mode = BaseMaterial3D.CULL_DISABLED
	var membrane := StandardMaterial3D.new()
	membrane.albedo_color = Color("638296", 0.54)
	membrane.metallic = 0.0
	membrane.roughness = 0.74
	membrane.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	membrane.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
	membrane.cull_mode = BaseMaterial3D.CULL_DISABLED

	if scout_form:
		# Released form is a real little moth, not a flying copy of the brass cage.
		WorkshopScene.ball(visual_root, Vector3(0, 0.015, 0.035), Vector3(0.11, 0.13, 0.22), glass)
		WorkshopScene.ball(visual_root, Vector3(0, 0.04, -0.09), Vector3(0.085, 0.08, 0.09), bright_brass)
		for side in [-1.0, 1.0]:
			WorkshopScene.ball(visual_root, Vector3(side * 0.041, 0.055, -0.153), Vector3.ONE * 0.018, dark)
			var feeler := WorkshopScene.cylinder(visual_root, Vector3(side * 0.036, 0.11, -0.17), 0.004, 0.12, vein)
			feeler.rotation.z = side * -0.48
	else:
		# A tiny forged cage: crown, foot, four bowed rails and a warm faceted heart.
		WorkshopScene.cylinder(visual_root, Vector3(0, -0.13, 0), 0.047, 0.46, dark)
		WorkshopScene.cylinder(visual_root, Vector3(0, -0.34, 0), 0.063, 0.04, brass, 0.05)
		for i in range(5):
			WorkshopScene.cylinder(visual_root, Vector3(0, -0.22 + i * 0.05, 0), 0.052, 0.014, brass)
		WorkshopScene.cylinder(visual_root, Vector3(0, 0.12, 0), 0.105, 0.035, brass, 0.078)
		WorkshopScene.cylinder(visual_root, Vector3(0, 0.55, 0), 0.092, 0.034, bright_brass, 0.068)
		WorkshopScene.cylinder(visual_root, Vector3(0, 0.34, 0), 0.034, 0.36, dark)
		WorkshopScene.ball(visual_root, Vector3(0, 0.36, 0), Vector3(0.18, 0.25, 0.15), glass)
		for i in range(6):
			var a := TAU * float(i) / 6.0
			WorkshopScene.cylinder(visual_root, Vector3(cos(a) * 0.079, 0.34, sin(a) * 0.079), 0.012, 0.44, bright_brass)
		# One continuous crown loop, forged as a low-poly tube.
		WorkshopScene.piece(visual_root, _tube_loop_mesh(Vector3(0, 0.64, 0), 0.10, 0.095, 0.014), Vector3.ZERO, loop_brass)
		WorkshopScene.ball(visual_root, Vector3(0, 0.36, 0.085), Vector3(0.035, 0.08, 0.026), bright_brass)
		# A tiny hinged petal folds away from the glowing heart while the moth is away.
		var cap := Node3D.new()
		visual_root.add_child(cap)
		cap.position = Vector3(0.072, 0.54, 0)
		cap.set_meta("glowmoth_cap", true)
		var lid := preload("res://workshop_details.gd").clipped_box(cap, Vector3(0.05, 0, 0), Vector3(0.12, 0.022, 0.17), brass)
		lid.rotation.x = 0.12
		WorkshopScene.ball(cap, Vector3(0.05, 0, 0.083), Vector3(0.026, 0.026, 0.026), bright_brass)
		_batch_child_meshes(cap)

	# Four fine wings hinge from the lantern shoulders. Thin colored membranes sit inside a gold edge.
	var hinges: Array[Node3D] = []
	for side in [-1.0, 1.0]:
		for rear in [false, true]:
			var hinge := Node3D.new()
			visual_root.add_child(hinge)
			hinge.position = Vector3(side * 0.075, 0.43, -0.018 if rear else 0.018)
			hinge.set_meta("wing_side", side)
			hinge.set_meta("wing_rear", rear)
			hinges.append(hinge)
			var span := 0.29 if not rear else 0.22
			var lift := 0.10 if not rear else -0.09
			var tip := Vector3(side * span, lift, -0.035 if rear else 0.035)
			var shoulder := Vector3(side * 0.02, 0.075, 0)
			var trailing := Vector3(side * span * 0.65, -0.105 if not rear else -0.04, 0)
			var outline := _wing_outline(shoulder, tip, trailing)
			var membrane_mesh := _wing_mesh(outline)
			var wing := MeshInstance3D.new()
			wing.mesh = membrane_mesh
			wing.material_override = membrane
			hinge.add_child(wing)
			var veins := MeshInstance3D.new()
			veins.mesh = _ribbon_paths([
				PackedVector3Array([shoulder, tip]),
				PackedVector3Array([shoulder + (tip - shoulder) * 0.52, trailing]),
				PackedVector3Array([shoulder + (tip - shoulder) * 0.72, (tip + trailing) * 0.52])
			], PackedFloat32Array([0.007, 0.006, 0.005]))
			veins.material_override = wing_gold
			hinge.add_child(veins)
			var edge := MeshInstance3D.new()
			edge.mesh = _ribbon_paths([outline + PackedVector3Array([outline[0]])], PackedFloat32Array([0.012]))
			edge.material_override = wing_gold
			hinge.add_child(edge)
			_batch_child_meshes(hinge)
	root.set_meta("glowmoth_wings", hinges)
	root.set_meta("glowmoth_scout_form", scout_form)
	var heart_light := OmniLight3D.new()
	visual_root.add_child(heart_light)
	heart_light.position = Vector3(0, 0.015 if scout_form else 0.36, 0)
	heart_light.light_color = Color("ffd18a")
	heart_light.light_energy = 0.75 if scout_form else 0.45
	heart_light.omni_range = LIGHT_RANGE
	heart_light.shadow_enabled = true
	_batch_child_meshes(visual_root)

static func _batch_child_meshes(parent: Node3D) -> void:
	var batches := {}
	var originals: Array[MeshInstance3D] = []
	for child in parent.get_children():
		if not child is MeshInstance3D or child.mesh == null: continue
		originals.append(child)
		for surface in range(child.mesh.get_surface_count()):
			var material: Material = child.material_override if child.material_override != null else child.mesh.surface_get_material(surface)
			var key := str(material.get_instance_id()) if material != null else "default"
			if not batches.has(key):
				var tool := SurfaceTool.new()
				tool.begin(Mesh.PRIMITIVE_TRIANGLES)
				if material != null: tool.set_material(material)
				batches[key] = {"tool": tool, "material": material}
			batches[key].tool.append_from(child.mesh, surface, child.transform)
	if batches.is_empty(): return
	var combined := ArrayMesh.new()
	for key in batches:
		var batch_mesh: ArrayMesh = batches[key].tool.commit()
		for surface in range(batch_mesh.get_surface_count()):
			var index := combined.get_surface_count()
			combined.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, batch_mesh.surface_get_arrays(surface))
			combined.surface_set_material(index, batches[key].material)
	var merged := MeshInstance3D.new()
	merged.name = "GlowmothForgedBatch"
	merged.mesh = combined
	parent.add_child(merged)
	for child in originals: child.free()

static func _wing_outline(a: Vector3, b: Vector3, c: Vector3) -> PackedVector3Array:
	var outline := PackedVector3Array([a])
	var side := signf(b.x - a.x)
	var leading_one := a + (b - a) * 0.32 + Vector3(0, 0.12, 0)
	var leading_two := b - (b - a) * 0.16 + Vector3(0, 0.035, 0)
	for i in range(1, 9): outline.append(_cubic(a, leading_one, leading_two, b, float(i) / 8.0))
	var trailing_one := b + (c - b) * 0.12 - Vector3(0, 0.02, 0)
	var trailing_two := c - (c - b) * 0.23 + Vector3(0, 0.035, 0)
	for i in range(1, 17):
		var t := float(i) / 16.0
		var point := _cubic(b, trailing_one, trailing_two, c, t)
		point.y -= sin(t * PI * 3.0) * 0.018 * side
		outline.append(point)
	return outline

static func _wing_mesh(outline: PackedVector3Array) -> ArrayMesh:
	var center := Vector3.ZERO
	for point in outline: center += point
	center /= outline.size()
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(outline.size()):
		surface.add_vertex(center); surface.add_vertex(outline[i]); surface.add_vertex(outline[(i + 1) % outline.size()])
	surface.generate_normals()
	return surface.commit()

static func _ribbon_paths(paths: Array, widths: PackedFloat32Array) -> ArrayMesh:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for path_index in range(paths.size()):
		var path: PackedVector3Array = paths[path_index]
		var half_width := widths[path_index] * 0.5
		for i in range(path.size() - 1):
			var a := path[i]
			var b := path[i + 1]
			var along := b - a
			var side := Vector3(-along.y, along.x, 0).normalized() * half_width
			var a0 := a - side; var a1 := a + side
			var b0 := b - side; var b1 := b + side
			surface.add_vertex(a0); surface.add_vertex(b0); surface.add_vertex(b1)
			surface.add_vertex(a0); surface.add_vertex(b1); surface.add_vertex(a1)
	surface.generate_normals()
	return surface.commit()

static func _quadratic(a: Vector3, control: Vector3, b: Vector3, t: float) -> Vector3:
	return a * (1.0 - t) * (1.0 - t) + control * 2.0 * (1.0 - t) * t + b * t * t

static func _cubic(a: Vector3, control_a: Vector3, control_b: Vector3, b: Vector3, t: float) -> Vector3:
	var u := 1.0 - t
	return a * u * u * u + control_a * 3.0 * u * u * t + control_b * 3.0 * u * t * t + b * t * t * t

static func _tube_loop_mesh(center: Vector3, major_radius: float, major_height: float, tube_radius: float) -> ArrayMesh:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	const MAJOR := 24
	const MINOR := 6
	for u in range(MAJOR):
		for v in range(MINOR):
			var p00 := _torus_point(center, major_radius, major_height, tube_radius, float(u) / MAJOR, float(v) / MINOR)
			var p10 := _torus_point(center, major_radius, major_height, tube_radius, float(u + 1) / MAJOR, float(v) / MINOR)
			var p11 := _torus_point(center, major_radius, major_height, tube_radius, float(u + 1) / MAJOR, float(v + 1) / MINOR)
			var p01 := _torus_point(center, major_radius, major_height, tube_radius, float(u) / MAJOR, float(v + 1) / MINOR)
			surface.add_vertex(p00); surface.add_vertex(p10); surface.add_vertex(p11)
			surface.add_vertex(p00); surface.add_vertex(p11); surface.add_vertex(p01)
	surface.generate_normals()
	return surface.commit()

static func _torus_point(center: Vector3, major_radius: float, major_height: float, tube_radius: float, u: float, v: float) -> Vector3:
	var around := u * TAU
	var cross := v * TAU
	var radius := major_radius + cos(cross) * tube_radius
	return center + Vector3(cos(around) * radius, sin(around) * (major_height + cos(cross) * tube_radius), sin(cross) * tube_radius)

func setup(owner_game) -> void:
	game = owner_game

func trigger(item: Node3D, hand: Node3D, from: Node3D) -> bool:
	if game == null or not is_instance_valid(item) or not is_instance_valid(hand) or not is_instance_valid(from): return false
	if item not in game.held.values(): return false
	if is_instance_valid(scout):
		if held_item != item: return false
		returning = true
		flight_age = 0.0
		return true
	source = from
	held_item = item
	control_hand = hand
	var origin := _socket_position()
	var ray := PhysicsRayQueryParameters3D.create(origin, origin - from.global_basis.z * SCOUT_DISTANCE, 1)
	ray.exclude = _held_body_rids()
	ray.hit_from_inside = true
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	if not hit.is_empty() and origin.distance_to(hit.position) < 0.18:
		game._notice("Glowmoth cannot unfold inside a wall", 3)
		return true
	destination = hit.position + hit.normal * 0.75 if not hit.is_empty() else origin - from.global_basis.z * SCOUT_DISTANCE
	# Stay on the near side of walls and surfaces. The body sweep also guards movement at runtime.
	var delta := destination - origin
	if not hit.is_empty(): delta = delta.limit_length(maxf(0.0, origin.distance_to(hit.position) - 0.55))
	destination = origin + delta
	scout = Node3D.new()
	scout.name = "GlowmothScout"
	game.adventure.zone_groups[game.adventure.zone].add_child(scout)
	build(scout, true)
	scout.scale = Vector3.ONE * 0.72
	scout.global_position = origin
	returning = false
	flight_age = 0.0
	active_zone = str(game.adventure.zone)
	cap_target = -0.8
	game.adventure.haptic(hand, "ready")
	game._notice("Glowmoth released · trigger again to recall", 4)
	return true

func _held_body_rids() -> Array[RID]:
	var excluded: Array[RID] = []
	if is_instance_valid(held_item):
		var pending: Array[Node] = [held_item]
		while not pending.is_empty():
			var body: Node = pending.pop_back()
			if body is CollisionObject3D: excluded.append(body.get_rid())
			for child in body.get_children(): pending.append(child)
	return excluded

func tick(delta: float) -> void:
	cap_angle = move_toward(cap_angle, cap_target, delta * 4.0)
	if is_instance_valid(held_item):
		var cap := _find_cap(held_item)
		if cap != null: cap.rotation.z = cap_angle
	if not is_instance_valid(scout): return
	var current_group: Node = game.adventure.zone_groups.get(game.adventure.zone)
	if not is_instance_valid(held_item) or held_item not in game.held.values() or str(game.adventure.zone) != active_zone or current_group != scout.get_parent():
		_dispose_scout(); return
	flight_age += delta
	var wings: Array = scout.get_meta("glowmoth_wings", [])
	for i in range(wings.size()):
		var hinge: Node3D = wings[i]
		var side := float(hinge.get_meta("wing_side"))
		var rear := bool(hinge.get_meta("wing_rear"))
		hinge.rotation.z = side * (0.18 + sin(flight_age * (23.0 if not rear else 20.0) + i * 1.7) * 0.44)
		hinge.rotation.x = sin(flight_age * 13.0 + i) * 0.12
	var goal := held_item.to_global(Vector3(0, 0.39, 0)) if returning else destination
	var offset := goal - scout.global_position
	if offset.length() < 0.22:
		if returning:
			scout.queue_free(); scout = null; returning = false
			cap_target = 0.0
			game.adventure.haptic(control_hand, "release")
		else:
			scout.global_position.y = destination.y + sin(flight_age * 2.4) * 0.06
		return
	if returning and flight_age > RECALL_TIMEOUT:
		returning = false
		destination = scout.global_position
		game._notice("Glowmoth recall paused by a wall · trigger again after clearing the path", 4)
		return
	var step := offset.normalized() * minf(SCOUT_SPEED * delta, offset.length())
	var shape := SphereShape3D.new(); shape.radius = BODY_RADIUS
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = shape
	query.transform = Transform3D(Basis.IDENTITY, scout.global_position)
	query.motion = step
	query.collision_mask = 1
	query.exclude = _held_body_rids()
	var travel: PackedFloat32Array = game.get_world_3d().direct_space_state.cast_motion(query)
	var safe_fraction := float(travel[0]) if not travel.is_empty() else 0.0
	if safe_fraction > 0.001:
		scout.global_position += step * maxf(0.0, safe_fraction - 0.025)
		var up := Vector3.RIGHT if absf(offset.normalized().dot(Vector3.UP)) > 0.98 else Vector3.UP
		scout.look_at(scout.global_position + offset.normalized(), up)
	elif not returning:
		# The ray's chosen hover point can be blocked by unusual geometry; settle just before contact.
		destination = scout.global_position

func _find_cap(root: Node) -> Node3D:
	for child in root.get_children():
		if child is Node3D and child.get_meta("glowmoth_cap", false): return child
		var nested := _find_cap(child)
		if nested != null: return nested
	return null

func _socket_position() -> Vector3:
	return held_item.to_global(Vector3(0, 0.52, 0)) if is_instance_valid(held_item) else source.global_position

func _dispose_scout() -> void:
	if is_instance_valid(scout): scout.queue_free()
	scout = null
	returning = false
	cap_target = 0.0
