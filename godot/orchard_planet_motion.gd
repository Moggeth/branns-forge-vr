extends RefCounted
## Feet-based locomotion on a closed, deformable globe. The rig's local Y is
## radial up; the camera and tracked controllers retain their local XR poses.

const GRAVITY := 18.0
const JUMP_SPEED := 5.85
const TERMINAL_SPEED := 22.0
const FEET_GAP := 0.025
const STEP_UP := 0.42
const SNAP_DOWN := 0.38
const BODY_RADIUS := 0.20
const BODY_HEIGHT := 1.60
const BODY_CENTER := 0.87
const MOVE_SLICE := 0.35
const MAX_FRAME := 0.25

var planet
var game
var grounded := false
var vertical_speed := 0.0
var jump_locked := false
var _gravity_area: Area3D

func setup(source_planet, source_game = null):
	planet = source_planet
	game = source_game if source_game != null else source_planet.get("game")
	return self

func active() -> bool:
	return planet != null and game != null and game.adventure != null and game.adventure.zone == "orchard_planet"

func surface_up(world_point: Vector3) -> Vector3:
	var radial: Vector3 = world_point - planet.center
	return radial.normalized() if radial.length_squared() > 0.000001 else Vector3.UP

func gravity_at(world_point: Vector3) -> Vector3:
	return -surface_up(world_point) * GRAVITY

func _surface(unit_direction: Vector3) -> Vector3:
	return planet.surface_point(unit_direction.normalized())

func _feet() -> Vector3:
	var up := surface_up(game.rig.global_position)
	var offset: Vector3 = game.camera.global_position - game.rig.global_position
	return game.rig.global_position + offset.slide(up)

func _set_feet(feet: Vector3, rotation: Quaternion = Quaternion.IDENTITY) -> void:
	var rig: Node3D = game.rig
	var local_camera: Vector3 = game.camera.global_position - rig.global_position
	var lateral := local_camera.slide(surface_up(rig.global_position))
	rig.global_basis = (Basis(rotation) * rig.global_basis).orthonormalized()
	rig.global_position = feet - rotation * lateral

func _body_clear(feet: Vector3) -> bool:
	var up := surface_up(feet)
	var shape := CapsuleShape3D.new()
	shape.radius = BODY_RADIUS
	shape.height = BODY_HEIGHT
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = shape
	query.collision_mask = 1
	query.transform = Transform3D(Basis(Quaternion(Vector3.UP, up)), feet + up * BODY_CENTER)
	return game.get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty()

func _body_motion_clear(start: Vector3, finish: Vector3) -> bool:
	var up := surface_up(start)
	var shape := CapsuleShape3D.new()
	shape.radius = BODY_RADIUS
	shape.height = BODY_HEIGHT
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = shape
	query.collision_mask = 1
	query.transform = Transform3D(Basis(Quaternion(Vector3.UP, up)), start + up * BODY_CENTER)
	query.motion = finish - start
	var travel: PackedFloat32Array = game.get_world_3d().direct_space_state.cast_motion(query)
	return travel.size() > 0 and float(travel[0]) >= 0.995

func _ground_radius(direction: Vector3) -> float:
	var estimated: float = (_surface(direction) - planet.center).length()
	# Stand on the rendered/collidable triangles while chunks are morphing. The
	# analytic target can differ from their interpolated surface and is not a
	# second invisible floor. Ignore trees/props lying above the terrain.
	var terrain: Node3D = planet.get("terrain")
	if is_instance_valid(terrain):
		var query := PhysicsRayQueryParameters3D.create(planet.center + direction * (estimated+10.0), planet.center + direction * (estimated-12.0), 1)
		var excluded: Array[RID] = []
		for attempt in 8:
			var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(query)
			if hit.is_empty(): break
			if terrain.is_ancestor_of(hit.collider): return hit.position.distance_to(planet.center)+FEET_GAP
			excluded.append(hit.collider.get_rid())
			query.exclude = excluded
	return estimated + FEET_GAP

func enter() -> void:
	if not active(): return
	grounded = false
	vertical_speed = 0.0
	jump_locked = false
	var feet := _feet()
	var up := surface_up(feet)
	var correction := Quaternion(game.rig.global_basis.y.normalized(), up)
	_set_feet(feet, correction)
	# Keep the bounded point-gravity volume after player travel so loose props
	# continue to fall toward the globe on every side.
	if is_instance_valid(_gravity_area): return
	_gravity_area = Area3D.new()
	_gravity_area.name = "OrchardPlanetGravity"
	_gravity_area.position = planet.center
	_gravity_area.collision_layer = 0
	_gravity_area.collision_mask = 0x7fffffff
	_gravity_area.gravity_space_override = Area3D.SPACE_OVERRIDE_REPLACE
	_gravity_area.gravity_point = true
	_gravity_area.gravity_point_center = Vector3.ZERO
	_gravity_area.gravity_point_unit_distance = 0.0
	_gravity_area.gravity = GRAVITY
	var collision := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = float(planet.radius) + 200.0
	collision.shape = sphere
	_gravity_area.add_child(collision)
	game.add_child(_gravity_area)

func leave() -> void:
	grounded = false
	vertical_speed = 0.0
	jump_locked = false

func jump() -> bool:
	if not active() or not grounded or jump_locked: return false
	grounded = false
	jump_locked = true
	vertical_speed = JUMP_SPEED
	return true

func move(displacement: Vector3) -> float:
	if not active(): return 0.0
	var center: Vector3 = planet.center
	var feet := _feet()
	var up := surface_up(feet)
	var tangent := displacement.slide(up)
	var requested := tangent.length()
	if requested < 0.000001: return 1.0
	var steps := maxi(1, ceili(requested / MOVE_SLICE))
	var step_length := requested / float(steps)
	var direction := tangent / requested
	var completed := 0
	for index in range(steps):
		feet = _feet()
		up = surface_up(feet)
		direction = direction.slide(up).normalized()
		if direction.length_squared() < 0.5: break
		var turn := step_length / maxf((feet - center).length(), 1.0)
		var rotation := Quaternion(up.cross(direction).normalized(), turn)
		var next_up := rotation * up
		var radius := (feet - center).length()
		var ground_radius := _ground_radius(next_up)
		var target_radius := radius
		if grounded:
			var rise := ground_radius - radius
			if rise > STEP_UP: break
			if rise >= -SNAP_DOWN: target_radius = ground_radius
		elif ground_radius > radius + 0.08:
			break
		var candidate := center + next_up * target_radius
		if not _body_motion_clear(feet, candidate) or not _body_clear(candidate): break
		_set_feet(candidate, rotation)
		direction = rotation * direction
		completed += 1
	return float(completed) / float(steps)

func tick(delta: float) -> void:
	if not active() or delta <= 0.0: return
	var count := clampi(ceili(delta / (1.0 / 90.0)), 1, 24)
	var dt := minf(delta, MAX_FRAME) / float(count)
	for index in range(count): _vertical_step(dt)

func _vertical_step(dt: float) -> void:
	var center: Vector3 = planet.center
	var feet := _feet()
	var up := surface_up(feet)
	var radius := (feet - center).length()
	var support := _ground_radius(up)
	var separation := radius - support
	# Terrain can change under stationary feet. Raise out of newly added ground;
	# removed ground starts a radial fall on this frame.
	if separation < -0.06:
		var raised := center + up * support
		if _body_clear(raised): _set_feet(raised)
		grounded = true
		vertical_speed = 0.0
		jump_locked = false
		return
	if grounded:
		if separation <= SNAP_DOWN:
			var supported := center + up * support
			if _body_clear(supported): _set_feet(supported)
			vertical_speed = 0.0
			jump_locked = false
			return
		grounded = false
	vertical_speed = maxf(-TERMINAL_SPEED, vertical_speed - GRAVITY * dt)
	var wanted_radius := radius + vertical_speed * dt
	if vertical_speed <= 0.0 and wanted_radius <= support:
		var landing := center + up * support
		if _body_clear(landing):
			_set_feet(landing)
			grounded = true
			vertical_speed = 0.0
			jump_locked = false
			return
	var wanted := center + up * wanted_radius
	if _body_clear(wanted):
		_set_feet(wanted)
		return
	# A radial ceiling/overhang: stop at the last clear capsule position.
	var clear_radius := radius
	var blocked_radius := wanted_radius
	for index in range(6):
		var middle := (clear_radius + blocked_radius) * 0.5
		if _body_clear(center + up * middle): clear_radius = middle
		else: blocked_radius = middle
	_set_feet(center + up * clear_radius)
	vertical_speed = 0.0

func orient(node: Node3D) -> void:
	if node == null or planet == null: return
	var up := surface_up(node.global_position)
	var old_up := node.global_basis.y.normalized()
	if old_up.dot(up) < -0.999:
		# Avoid Quaternion's ambiguous anti-parallel axis at the south pole.
		node.global_basis = Basis(node.global_basis.x.normalized(), up, node.global_basis.z.normalized()).orthonormalized()
	else:
		node.global_basis = (Basis(Quaternion(old_up, up)) * node.global_basis).orthonormalized()
