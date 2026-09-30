extends Node3D
## One persistent meteorite. Coordinates in records and impact events are local
## to the landscape zone; strike() accepts a global hit point from physics.

signal impact_ready(event: Dictionary)
signal inventory_changed(record: Dictionary)

const FALL_SECONDS := 1.25
const GEM_VEINS := 6
const MAX_GEMS_PER_VEIN := 2
const ORE_UNITS := 8
const HIT_REACH := 3.4
const MAX_SCARS := 24

var record: Dictionary = {}
var falling := false
var fall_elapsed := 0.0
var impacted := false
var core: MeshInstance3D
var collider: StaticBody3D
var scar_display: MultiMeshInstance3D
var gems: Array[MeshInstance3D] = []
var shock: MeshInstance3D
static var _shared_rock: ArrayMesh
static var _shared_scar: ArrayMesh

static func make_record(at: Vector2, seed: int, ground_y: float) -> Dictionary:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var veins: Array = []
	for i in GEM_VEINS:
		veins.append(MAX_GEMS_PER_VEIN)
	return {"version": 1, "center": [snappedf(at.x, 0.01), snappedf(at.y, 0.01)],
		"ground_y": snappedf(ground_y, 0.01), "seed": seed,
		"veins": veins, "ore": ORE_UNITS, "scars": [], "radius": 10.0,
		"rotation": snappedf(rng.randf_range(0.0, TAU), 0.0001)}

static func crater_operation(source: Dictionary) -> Dictionary:
	return {"type": "crater", "center": source.get("center", [0.0, 0.0]),
		"radius": clampf(float(source.get("radius", 10.0)), 6.0, 14.0),
		"depth": 2.8, "height": 1.15, "seed": int(source.get("seed", 0))}

static func impact_event(source: Dictionary) -> Dictionary:
	var at: Array = source.get("center", [0.0, 0.0])
	return {"center": Vector3(float(at[0]), float(source.get("ground_y", 0.0)), float(at[1])),
		"radius": 8.0, "max_damage": 35.0, "min_damage": 0.0,
		"impulse": 7.0, "source": "meteor"}

static func damage_at(event: Dictionary, actor_position: Vector3) -> float:
	var center: Vector3 = event.center
	var radius: float = float(event.radius)
	var horizontal := Vector2(center.x, center.z).distance_to(Vector2(actor_position.x, actor_position.z))
	if horizontal >= radius or absf(actor_position.y - center.y) > 5.0: return 0.0
	var fraction := 1.0 - horizontal / radius
	return float(event.max_damage) * fraction * fraction

func setup(source: Dictionary, animate := true) -> void:
	record = source.duplicate(true)
	if not _valid_record(record):
		push_error("Invalid meteor record")
		return
	if not record.has("scars"): record["scars"] = []
	name = "StarfallMeteorite"
	var at: Array = record.center
	position = Vector3(float(at[0]), float(record.ground_y), float(at[1]))
	rotation.y = float(record.rotation)
	_build_visuals()
	_refresh_scars()
	falling = animate
	impacted = not animate
	if animate:
		core.position.y = 24.0
		collider.process_mode = Node.PROCESS_MODE_DISABLED
		for gem in gems: gem.visible = false
		shock.visible = true
		shock.scale = Vector3.ONE * 4.0
		shock.transparency = 0.4
	else:
		core.position.y = 0.65
		shock.visible = false
		if remaining_gems() == 0 and remaining_ore() == 0:
			core.scale = Vector3.ONE * 0.65
			collider.scale = core.scale
			collider.set_meta("depleted", true)
	set_process(animate)

func to_record() -> Dictionary:
	return record.duplicate(true)

func remaining_gems() -> int:
	var total := 0
	for count in record.get("veins", []): total += int(count)
	return total

func remaining_ore() -> int:
	return int(record.get("ore", 0))

func strike(hit_world_position: Vector3, tool_id: String, energy: float = 1.0,
		surface_normal: Vector3 = Vector3.ZERO) -> Dictionary:
	if not impacted: return {"ok": false, "reason": "falling"}
	if tool_id not in ["quarry_pick", "crystal_resonator"]: return {"ok": false, "reason": "pick_required"}
	if not is_finite(energy) or energy < 0.35: return {"ok": false, "reason": "weak_strike"}
	if hit_world_position.distance_to(global_position + Vector3.UP * 0.8) > HIT_REACH:
		return {"ok": false, "reason": "out_of_reach"}
	var best := -1
	var best_distance := INF
	for i in gems.size():
		if int(record.veins[i]) <= 0: continue
		var d := hit_world_position.distance_squared_to(gems[i].global_position)
		if d < best_distance: best_distance = d; best = i
	var kind := ""
	# Aim the pick at a visible vein for a gem. Rock elsewhere yields iron;
	# otherwise the six veins would unintentionally block ore until exhausted.
	if best >= 0 and best_distance <= 0.8 * 0.8 and energy >= 0.7:
		record.veins[best] = int(record.veins[best]) - 1
		_update_gem(best)
		kind = "meteor_gem"
	elif remaining_ore() > 0:
		record.ore = remaining_ore() - 1
		kind = "star_iron"
	else:
		return {"ok": false, "reason": "depleted"}
	_record_scar(hit_world_position, surface_normal, energy)
	if remaining_gems() == 0 and remaining_ore() == 0:
		core.scale = Vector3.ONE * 0.65
		collider.scale = core.scale
		collider.set_meta("depleted", true)
	inventory_changed.emit(to_record())
	return {"ok": true, "kind": kind, "units": 1,
		"remaining_gems": remaining_gems(), "remaining_ore": remaining_ore(),
		"damage_result": "fresh_chip", "scar_count": record.scars.size()}

func _record_scar(point: Vector3, surface_normal: Vector3, energy: float) -> void:
	# Gem markers sit partially inside the rock. Project their reward point to
	# the first visible facet so a saved mark never disappears under the shell.
	var outward: Vector3 = (point-core.global_position).normalized()
	if outward.length_squared() < 0.25: outward = Vector3.UP
	if is_inside_tree():
		var query := PhysicsRayQueryParameters3D.create(core.global_position+outward*4.0,core.global_position)
		var surface_hit: Dictionary = get_world_3d().direct_space_state.intersect_ray(query)
		if surface_hit.get("collider") == collider:
			point = surface_hit.position
			surface_normal = surface_hit.normal
	var local_point: Vector3 = core.to_local(point)
	var normal: Vector3 = core.global_basis.inverse() * surface_normal
	if normal.length_squared() < 0.25: normal = local_point.normalized()
	if normal.length_squared() < 0.25: normal = Vector3.UP
	normal = normal.normalized()
	var scar := {"point": [snappedf(local_point.x,0.001),snappedf(local_point.y,0.001),snappedf(local_point.z,0.001)],
		"normal": [snappedf(normal.x,0.001),snappedf(normal.y,0.001),snappedf(normal.z,0.001)],
		"size": snappedf(clampf(0.055 + energy * 0.018,0.055,0.12),0.001)}
	record.scars.append(scar)
	if record.scars.size() > MAX_SCARS: record.scars.pop_front()
	_refresh_scars()

func _refresh_scars() -> void:
	var batch := MultiMesh.new()
	batch.transform_format = MultiMesh.TRANSFORM_3D
	batch.mesh = _scar_mesh()
	batch.instance_count = record.scars.size()
	for i in record.scars.size():
		var scar: Dictionary = record.scars[i]
		var p: Array = scar.point
		var n: Array = scar.normal
		var normal := Vector3(float(n[0]),float(n[1]),float(n[2])).normalized()
		var position := Vector3(float(p[0]),float(p[1]),float(p[2])) + normal * 0.006
		var basis := Basis.looking_at(-normal,Vector3.UP if absf(normal.y)<0.9 else Vector3.RIGHT)
		batch.set_instance_transform(i,Transform3D(basis.scaled(Vector3.ONE*float(scar.size)),position))
	scar_display.multimesh = batch

static func _scar_mesh() -> ArrayMesh:
	if _shared_scar != null: return _shared_scar
	var ring := [Vector2(-0.9,0.1),Vector2(-0.43,0.72),Vector2(0.17,0.9),Vector2(0.82,0.43),Vector2(0.7,-0.47),Vector2(-0.05,-0.8)]
	var points := PackedVector3Array()
	var face_normals := PackedVector3Array()
	for i in ring.size():
		for v in [Vector2.ZERO,ring[i],ring[(i+1)%ring.size()]]:
			points.append(Vector3(v.x,v.y,0.0))
			face_normals.append(Vector3.BACK)
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = points
	arrays[Mesh.ARRAY_NORMAL] = face_normals
	_shared_scar = ArrayMesh.new()
	_shared_scar.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.105,0.105,0.13)
	material.roughness = 0.95
	_shared_scar.surface_set_material(0,material)
	return _shared_scar

func _process(delta: float) -> void:
	advance(delta)

func advance(delta: float) -> void:
	if not falling: return
	fall_elapsed = minf(fall_elapsed + maxf(delta, 0.0), FALL_SECONDS)
	var t := fall_elapsed / FALL_SECONDS
	core.position.y = lerpf(24.0, 0.65, t * t)
	core.rotation.x = t * 3.2
	shock.scale = Vector3.ONE * (3.3 + 0.55 * sin(t * TAU * 7.0))
	shock.transparency = 0.2 + 0.25 * sin(t * TAU * 7.0)
	if t < 1.0: return
	falling = false
	impacted = true
	core.rotation.x = 0.0
	collider.process_mode = Node.PROCESS_MODE_INHERIT
	for i in gems.size(): _update_gem(i)
	shock.visible = true
	shock.scale = Vector3.ONE * 0.3
	shock.transparency = 0.0
	if is_inside_tree():
		var tween := create_tween().set_parallel(true)
		tween.tween_property(shock, "scale", Vector3.ONE * 8.0, 0.5)
		tween.tween_property(shock, "transparency", 1.0, 0.5)
		tween.chain().tween_callback(func(): shock.visible = false)
	impact_ready.emit(impact_event(record))
	set_process(false)

func _build_visuals() -> void:
	core = MeshInstance3D.new()
	core.name = "MeteoriteCore"
	core.mesh = _rock_mesh()
	add_child(core)
	core.position.y = 0.65
	scar_display = MultiMeshInstance3D.new()
	scar_display.name = "MiningScars"
	core.add_child(scar_display)
	collider = StaticBody3D.new()
	collider.name = "MineableMeteorite"
	collider.set_meta("requires", "pick")
	collider.set_meta("kind", "meteor_ore")
	add_child(collider)
	collider.position.y = 0.65
	var shape := CollisionShape3D.new()
	# Keep the mineable surface on the rendered facets. A bounding sphere made
	# the pick stop in empty air around the narrower shoulders and poles.
	shape.shape = core.mesh.create_trimesh_shape()
	collider.add_child(shape)
	var gem_mesh := CylinderMesh.new()
	gem_mesh.top_radius = 0.025
	gem_mesh.bottom_radius = 0.38
	gem_mesh.height = 1.35
	gem_mesh.radial_segments = 6
	var gem_mat := _material(Color(0.34, 0.91, 0.98), true)
	gem_mesh.material = gem_mat
	for i in GEM_VEINS:
		var gem := MeshInstance3D.new()
		gem.name = "GemVein_%02d" % i
		gem.mesh = gem_mesh
		var angle := TAU * float(i) / GEM_VEINS + float(record.rotation)
		gem.position = Vector3(cos(angle) * 1.55, 0.95 + 0.50 * sin(angle * 2.0), sin(angle) * 1.55)
		gem.rotation = Vector3(0.35 * sin(angle), angle, 0.65 * cos(angle))
		add_child(gem)
		gems.append(gem)
		_update_gem(i)
	shock = MeshInstance3D.new()
	shock.name = "ImpactWave"
	var ring := TorusMesh.new()
	ring.inner_radius = 0.9
	ring.outer_radius = 1.0
	ring.rings = 8
	ring.ring_segments = 32
	shock.mesh = ring
	shock.material_override = _material(Color(1.0, 0.55, 0.22, 0.68), true)
	shock.position.y = 0.15
	add_child(shock)

static func _rock_mesh() -> ArrayMesh:
	# A tiny shared, flat-shaded shell gives every meteorite readable stone
	# facets without importing a heavy asset or multiplying draw calls.
	if _shared_rock != null: return _shared_rock
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var rings := 6
	var sides := 11
	for latitude in rings:
		for longitude in sides:
			var a := _rock_point(latitude, longitude, rings, sides)
			var b := _rock_point(latitude, longitude + 1, rings, sides)
			var c := _rock_point(latitude + 1, longitude, rings, sides)
			var d := _rock_point(latitude + 1, longitude + 1, rings, sides)
			var hue := float((latitude * 17 + longitude * 7) % 13) / 12.0
			var tint := Color(0.23, 0.25, 0.31).lerp(Color(0.35, 0.28, 0.25), hue * 0.58)
			if latitude > 0:
				_rock_face(vertices, normals, colors, a, b, c, tint)
			if latitude < rings - 1:
				_rock_face(vertices, normals, colors, b, d, c, tint.darkened(0.10))
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	_shared_rock = ArrayMesh.new()
	_shared_rock.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var stone := StandardMaterial3D.new()
	stone.vertex_color_use_as_albedo = true
	stone.roughness = 0.75
	stone.metallic = 0.18
	_shared_rock.surface_set_material(0, stone)
	return _shared_rock

static func _rock_point(latitude: int, longitude: int, rings: int, sides: int) -> Vector3:
	var phi := PI * float(latitude) / float(rings)
	var theta := TAU * float(longitude) / float(sides)
	var irregular := 0.92 + 0.08 * sin(float(latitude * 43 + longitude * 29))
	if latitude == 0 or latitude == rings: irregular = 0.92
	return Vector3(sin(phi) * cos(theta) * 2.05 * irregular,
		cos(phi) * 1.7 * irregular,
		sin(phi) * sin(theta) * 2.05 * irregular)

static func _rock_face(vertices: PackedVector3Array, normals: PackedVector3Array, colors: PackedColorArray,
		a: Vector3, b: Vector3, c: Vector3, tint: Color) -> void:
	var normal := (b - a).cross(c - a).normalized()
	for point in [a, c, b]:
		# Godot renders clockwise fronts. The geometric cross product above is
		# outward, so reverse emission order while retaining that outward normal.
		vertices.append(point)
		normals.append(normal)
		colors.append(tint)

func _update_gem(i: int) -> void:
	var count := int(record.veins[i])
	gems[i].visible = count > 0
	gems[i].scale = Vector3.ONE * (0.65 + 0.22 * count)

static func _material(color: Color, glow: bool) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = 0.22
	material.roughness = 0.6
	if glow:
		material.emission_enabled = true
		material.emission = Color(color.r, color.g, color.b)
		material.emission_energy_multiplier = 1.8
	return material

static func _valid_record(source: Dictionary) -> bool:
	if not source.get("center") is Array or source.center.size() != 2: return false
	if not source.get("veins") is Array or source.veins.size() != GEM_VEINS: return false
	if not is_finite(float(source.get("ground_y", NAN))): return false
	if not is_finite(float(source.get("rotation", NAN))): return false
	for count in source.veins:
		if not (count is int or count is float) or not is_finite(float(count)): return false
		if float(count) != float(int(count)) or int(count) < 0 or int(count) > MAX_GEMS_PER_VEIN: return false
	var scars = source.get("scars", [])
	if not scars is Array or scars.size() > MAX_SCARS: return false
	for scar in scars:
		if not scar is Dictionary or not scar.get("point") is Array or not scar.get("normal") is Array: return false
		if scar.point.size() != 3 or scar.normal.size() != 3: return false
		if not is_finite(float(scar.get("size", NAN))): return false
	return int(source.get("ore", -1)) >= 0 and int(source.get("ore", -1)) <= ORE_UNITS
