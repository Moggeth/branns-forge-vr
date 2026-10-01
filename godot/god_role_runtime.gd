extends Node3D
## Small shared-world God-role loop. Input lives in WorldBuilderView; this node
## owns bounded rat spawning, simple pursuit, visible essence, and its ledger.
const WorkshopScene = preload("res://workshop_scene.gd")
const RAT_RATE := 6.0
const RAT_MANA := 0.08
const MAX_RATS := 256
const MAX_FULL_RATS := 24
const MAX_MOTES := 128
const MOTION_BUDGET := 48
const MOTE_LIFE := 45.0
const ESSENCE_CAP := 200
const COLLECT_RADIUS := 2.4

var game
var stream_active := false
var stream_zone := ""
var stream_target := Vector3.INF
var stream_error := ""
var rats: Array[Node3D] = []
var motes: Array[Dictionary] = []
var _far_rats: Array[Node3D] = []
var _time := 0.0
var _accumulator := 0.0
var _serial := 0
var _motion_cursor := 0
var _bite_at := 0.0
var _save_due := -1.0
var _full_count := 0
var _glow: StandardMaterial3D
var _mote_mesh: SphereMesh
var _far_instances: MultiMesh
var _far_visual: MultiMeshInstance3D

func setup(owner_game) -> void:
	game = owner_game
	name = "GodRoleRuntime"
	if game != null and game.get("world_builder") != null:
		var data: Dictionary = game.world_builder.data
		data["god_essence"] = clampi(int(data.get("god_essence", 0)), 0, ESSENCE_CAP)
	_glow = StandardMaterial3D.new()
	_glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_glow.albedo_color = Color("a3f5ed")
	_glow.emission_enabled = true
	_glow.emission = Color("65f2dd")
	_glow.emission_energy_multiplier = 3.0
	_mote_mesh = SphereMesh.new()
	_mote_mesh.radius = 0.2
	_mote_mesh.height = 0.4
	_mote_mesh.radial_segments = 8
	_mote_mesh.rings = 4
	_far_instances = MultiMesh.new()
	_far_instances.transform_format = MultiMesh.TRANSFORM_3D
	_far_instances.mesh = _merged_authored_rat()
	_far_instances.instance_count = MAX_RATS
	_far_visual = MultiMeshInstance3D.new()
	_far_visual.name = "BatchedAuthoredRats"
	_far_visual.multimesh = _far_instances
	add_child(_far_visual)
	for i in MAX_RATS: _hide_far_slot(i)

func _merged_authored_rat() -> ArrayMesh:
	# Merge the actual WorkshopScene rat's static mesh pieces by material once.
	# The near model stays articulated; distant rats share these surfaces in one
	# MultiMesh while each keeps a cheap, correctly sized physical hit body.
	var source: Node3D = WorkshopScene.make_rat(0)
	var buckets: Array[Dictionary] = []
	for child in source.get_children():
		if not child is MeshInstance3D or child.mesh == null: continue
		var material: Material = child.material_override
		var index := -1
		for i in buckets.size():
			if buckets[i]["material"] == material:
				index = i
				break
		if index < 0:
			var surface := SurfaceTool.new()
			surface.begin(Mesh.PRIMITIVE_TRIANGLES)
			buckets.append({"material": material, "surface": surface})
			index = buckets.size() - 1
		var tool: SurfaceTool = buckets[index]["surface"]
		for surface_index in child.mesh.get_surface_count():
			tool.append_from(child.mesh, surface_index, child.transform)
	var merged := ArrayMesh.new()
	for bucket in buckets:
		var tool: SurfaceTool = bucket["surface"]
		tool.set_material(bucket["material"])
		tool.commit(merged)
	source.free()
	return merged

func _hide_far_slot(index: int) -> void:
	_far_instances.set_instance_transform(index, Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO), Vector3.ZERO))

func _update_far_slot(rat: Node3D) -> void:
	var slot := _far_rats.find(rat)
	if slot < 0: return
	if game != null and game.get("adventure") != null and str(rat.get_meta("zone", "")) != str(game.adventure.zone):
		_hide_far_slot(slot)
	else:
		_far_instances.set_instance_transform(slot, global_transform.affine_inverse() * rat.global_transform)

func _remove_far_rat(rat: Node3D) -> void:
	var slot := _far_rats.find(rat)
	if slot < 0: return
	_far_rats.remove_at(slot)
	for i in range(slot, _far_rats.size()): _update_far_slot(_far_rats[i])
	_hide_far_slot(_far_rats.size())

func status() -> Dictionary:
	return {"rats": rats.size(), "rat_limit": MAX_RATS, "motes": motes.size(),
		"streaming": stream_active, "stream_error": stream_error, "essence": essence(),
		"mana": _mana()}

func essence() -> int:
	if game == null or game.get("world_builder") == null: return 0
	return clampi(int(game.world_builder.data.get("god_essence", 0)), 0, ESSENCE_CAP)

func _mana() -> float:
	if game == null or game.get("world_builder") == null: return 0.0
	return float(game.world_builder.data.get("mana", 0.0))

func _zone_live(zone: String, require_view: bool = true) -> bool:
	if game == null or game.get("scene") == null or not game.scene.zones.has(zone): return false
	if game.get("adventure") != null and str(game.adventure.zone) != zone: return false
	if require_view:
		var view = game.get("world_builder_view")
		if view != null and str(view.get("current_zone")) != zone: return false
	return true

func _target_valid(point: Vector3, zone: String) -> bool:
	if not point.is_finite() or point == Vector3.INF or not _zone_live(zone): return false
	if zone == "orchard_planet":
		if game.get("orchard_planet") == null or not game.orchard_planet.built: return false
		var separation: float = point.distance_to(game.orchard_planet.center)
		return separation > game.orchard_planet.radius * 0.65 and separation < game.orchard_planet.radius + 35.0
	var bounds: Variant = game.scene.zones[zone].get("bounds", null)
	return not bounds is Rect2 or bounds.grow(1.0).has_point(Vector2(point.x, point.z))

func start_rat_stream(world_point: Vector3, zone: String) -> Dictionary:
	stop_rat_stream()
	if not _target_valid(world_point, zone): return {"ok": false, "error": "Aim at reachable ground in the Hero's region"}
	if _mana() < RAT_MANA: return {"ok": false, "error": "Mana needs a moment to recover"}
	if rats.size() >= MAX_RATS: return {"ok": false, "error": "The rat crowd is full"}
	stream_zone = zone
	stream_target = world_point
	stream_active = true
	stream_error = ""
	_accumulator = 0.0
	var first := _emit_rat()
	if not first.get("ok", false): stop_rat_stream()
	return first

func update_rat_target(world_point: Vector3) -> bool:
	if not stream_active: return false
	if not _target_valid(world_point, stream_zone):
		stop_rat_stream()
		return false
	stream_target = world_point
	return true

func stop_rat_stream() -> void:
	stream_active = false
	stream_target = Vector3.INF
	stream_zone = ""
	_accumulator = 0.0

func tick(delta: float) -> void:
	var step := clampf(delta, 0.0, 0.25)
	_time += step
	if stream_active:
		if not _target_valid(stream_target, stream_zone):
			stream_error = "Rat Stream stopped when the target or region changed"
			stop_rat_stream()
		else:
			_accumulator += step
			var emitted := 0
			while _accumulator >= 1.0 / RAT_RATE and emitted < 2 and stream_active:
				_accumulator -= 1.0 / RAT_RATE
				var result := _emit_rat()
				if not result.get("ok", false):
					stream_error = str(result.get("error", "Rat Stream stopped"))
					stop_rat_stream()
				else: emitted += 1
	_advance_rats(step)
	_advance_motes(step)
	if _save_due >= 0.0 and _time >= _save_due:
		_save_due = -1.0
		if game != null and game.get("world_builder") != null and not game.world_builder.save():
			_schedule_save(2.0)

func _schedule_save(after_seconds: float) -> void:
	var due := _time + after_seconds
	if _save_due < 0.0 or due < _save_due: _save_due = due

func _surface(point: Vector3, zone: String) -> Dictionary:
	if zone == "orchard_planet" and game != null and game.get("orchard_planet") != null:
		var planet = game.orchard_planet
		var direction: Vector3 = (point - planet.center).normalized()
		return {"position": planet.surface_point(direction), "normal": planet.normal_at(direction), "direction": direction}
	if zone == "orchard_highlands" and game != null and game.get("landscape") != null:
		var root_node: Node3D = game.landscape.zone_root
		var local: Vector3 = root_node.to_local(point)
		return {"position": root_node.to_global(Vector3(local.x, game.landscape.height_at(Vector2(local.x, local.z)), local.z)),
			"normal": Vector3.UP, "direction": Vector3.ZERO}
	var position := point
	var normal := Vector3.UP
	if game != null and game.is_inside_tree():
		var ray := PhysicsRayQueryParameters3D.create(point + Vector3.UP * 8.0, point - Vector3.UP * 16.0, 1)
		var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
		if not hit.is_empty() and hit.normal.y > 0.55:
			var owner: Node = hit.collider
			while owner != null and owner != game and not owner.has_meta("kind"): owner = owner.get_parent()
			if owner != null and owner.get_meta("kind", "") == "floor":
				position = hit.position
				normal = hit.normal
	return {"position": position, "normal": normal, "direction": Vector3.ZERO}

func _emit_rat() -> Dictionary:
	if rats.size() >= MAX_RATS: return {"ok": false, "error": "The rat crowd is full"}
	if _mana() + 0.00001 < RAT_MANA: return {"ok": false, "error": "Mana needs a moment to recover"}
	var site := _surface(stream_target, stream_zone)
	var normal: Vector3 = site.normal
	var tangent := normal.cross(Vector3.FORWARD).normalized()
	if tangent.length_squared() < 0.01: tangent = normal.cross(Vector3.RIGHT).normalized()
	var side := normal.cross(tangent).normalized()
	var phase := float(_serial) * 2.39996323
	var offset := (tangent * cos(phase) + side * sin(phase)) * (0.3 + 0.15 * float(_serial % 5))
	var origin: Vector3 = site.position + offset
	if stream_zone == "orchard_planet": origin = _surface(origin, stream_zone).position
	var hero_distance := INF
	if game != null and game.get("rig") != null: hero_distance = origin.distance_to(game.rig.global_position)
	var full := hero_distance < 16.0 and _full_count < MAX_FULL_RATS
	var rat: Node3D = WorkshopScene.make_rat(_serial) if full else _light_rat()
	var parent: Node = game.adventure.zone_groups.get(stream_zone, game) if game.get("adventure") != null else game
	parent.add_child(rat)
	if stream_zone == "orchard_planet": rat.global_basis = Basis.looking_at(tangent, normal)
	else: rat.rotation.y = phase
	rat.global_position = origin + normal * 0.05
	rat.set_meta("kind", "rat")
	rat.set_meta("enemy_type", "rat")
	rat.set_meta("zone", stream_zone)
	rat.set_meta("alive", true)
	rat.set_meta("god_role_rat", true)
	rat.set_meta("god_role_full", full)
	rat.set_meta("id", "god-rat-%d-%d" % [int(Time.get_unix_time_from_system()), _serial])
	rat.set_meta("home", rat.global_position)
	rat.set_meta("god_home", rat.global_position)
	rat.set_meta("god_phase", phase)
	if game.get("scene") != null: game.scene.rats.append(rat)
	if full:
		if game.get("animation") != null: game.animation.register(rat)
		_full_count += 1
	elif not full:
		_far_rats.append(rat)
		_update_far_slot(rat)
	rats.append(rat)
	_serial += 1
	game.world_builder.data.mana = maxf(0.0, _mana() - RAT_MANA)
	_schedule_save(2.0)
	return {"ok": true, "rat": rat, "rats": rats.size(), "mana": _mana()}

func _light_rat() -> Node3D:
	var rat := Node3D.new()
	rat.name = "GodRatBatched"
	var body_collision := StaticBody3D.new()
	body_collision.name = "GodRatHitBody"
	body_collision.collision_layer = 1
	body_collision.collision_mask = 0
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(0.38, 0.4, 0.78)
	shape.shape = box
	shape.position.y = 0.22
	body_collision.add_child(shape)
	rat.add_child(body_collision)
	return rat

func _promote_near(rat: Node3D) -> Node3D:
	if not is_instance_valid(rat) or bool(rat.get_meta("god_role_full", false)) or _full_count >= MAX_FULL_RATS: return rat
	var replacement: Node3D = WorkshopScene.make_rat(int(rat.get_meta("god_phase", 0.0) * 100.0))
	rat.get_parent().add_child(replacement)
	replacement.global_transform = rat.global_transform
	for key in ["kind", "enemy_type", "zone", "alive", "god_role_rat", "id", "home", "god_home", "god_phase", "god_essence_emitted"]:
		if rat.has_meta(key): replacement.set_meta(key, rat.get_meta(key))
	replacement.set_meta("god_role_full", true)
	var index := rats.find(rat)
	if index >= 0: rats[index] = replacement
	if game.get("scene") != null:
		var scene_index: int = game.scene.rats.find(rat)
		if scene_index >= 0: game.scene.rats[scene_index] = replacement
	_remove_far_rat(rat)
	if game.get("animation") != null: game.animation.register(replacement)
	_full_count += 1
	rat.queue_free()
	return replacement

func _advance_rats(delta: float) -> void:
	if rats.is_empty() or game == null or game.get("rig") == null: return
	var planet_zone := str(game.adventure.zone) == "orchard_planet"
	var near_hero := false
	if planet_zone:
		for candidate in rats:
			if is_instance_valid(candidate) and candidate.global_position.distance_squared_to(game.rig.global_position) < 400.0:
				near_hero = true
				break
	var count := mini(MOTION_BUDGET if not planet_zone or near_hero else 24, rats.size())
	var travel_step := minf(0.25 if planet_zone and not near_hero else 0.13, delta * float(rats.size()) / float(count))
	for i in count:
		if rats.is_empty(): break
		_motion_cursor %= rats.size()
		var rat: Node3D = rats[_motion_cursor]
		_motion_cursor += 1
		if not is_instance_valid(rat) or not rat.get_meta("alive", false): continue
		if str(rat.get_meta("zone", "")) != str(game.adventure.zone): continue
		var home: Vector3 = rat.get_meta("god_home", rat.global_position)
		var hero: Vector3 = game.rig.global_position
		var distance := rat.global_position.distance_to(hero)
		var phase: float = rat.get_meta("god_phase", 0.0)
		var goal := hero if distance < 12.0 else home + Vector3(sin(_time * 0.5 + phase), 0, cos(_time * 0.37 + phase)) * 1.1
		var step: Vector3
		var up := Vector3.UP
		if str(rat.get_meta("zone", "")) == "orchard_planet":
			var planet = game.orchard_planet
			var direction: Vector3 = (rat.global_position - planet.center).normalized()
			var destination: Vector3 = (goal - planet.center).normalized()
			step = (destination - direction * destination.dot(direction)).normalized()
			var next_direction: Vector3 = (direction + step * travel_step * 0.85 / planet.radius).normalized()
			var ground: Dictionary = planet.fields.sample(next_direction)
			if ground.get("water", false) or float(ground.get("slope", 0.0)) > 0.5: continue
			var next_position: Vector3 = planet.center + next_direction * (planet.radius + float(ground.height) + 0.05)
			if distance < 25.0 and not _obstacle_clear(rat, next_position, direction): continue
			rat.global_position = next_position
			up = ground.normal
		else:
			step = goal - rat.global_position
			step.y = 0.0
			step = step.normalized()
			var next := rat.global_position + step * travel_step * 0.85
			var ground_site: Dictionary = _surface(next, str(rat.get_meta("zone")))
			if ground_site.normal.y < 0.55 or absf(float(ground_site.position.y) - rat.global_position.y) > 0.45: continue
			var next_position: Vector3 = ground_site.position + Vector3.UP * 0.05
			if distance < 25.0 and not _obstacle_clear(rat, next_position, Vector3.UP): continue
			rat.global_position = next_position
		if step.length_squared() > 0.01: rat.global_basis = Basis.looking_at(-step, up)
		if not bool(rat.get_meta("god_role_full", false)):
			if distance < 11.0 and _full_count < MAX_FULL_RATS: rat = _promote_near(rat)
			else: _update_far_slot(rat)
		if distance < 0.55 and _time >= _bite_at and game.get("adventure") != null:
			_bite_at = _time + 1.2
			game.adventure.take_damage(4.0, "rat")

func _obstacle_clear(rat: Node3D, destination: Vector3, up: Vector3) -> bool:
	if game == null or not game.is_inside_tree(): return true
	var ray := PhysicsRayQueryParameters3D.create(rat.global_position + up * 0.18, destination + up * 0.18, 1)
	var own_body := rat.get_node_or_null("GodRatHitBody")
	if own_body is CollisionObject3D: ray.exclude = [own_body.get_rid()]
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	if hit.is_empty(): return true
	var owner: Node = hit.collider
	while owner != null and owner != game and not owner.has_meta("kind"): owner = owner.get_parent()
	if owner == rat or (owner != null and str(owner.get_meta("kind", "")) in ["rat", "floor"]): return true
	return false

func on_enemy_defeated(enemy: Node3D, point: Vector3 = Vector3.INF) -> bool:
	if not is_instance_valid(enemy) or enemy.get_meta("god_essence_emitted", false): return false
	var zone := str(enemy.get_meta("zone", ""))
	if not _zone_live(zone, false): return false
	enemy.set_meta("god_essence_emitted", true)
	var kind := str(enemy.get_meta("enemy_type", enemy.get_meta("kind", "enemy")))
	var value := 4 if kind == "golem" else (2 if kind in ["skeleton", "ghost", "wisp"] else 1)
	var at: Vector3 = enemy.global_position if point == Vector3.INF else point
	_add_mote(at, zone, value)
	if not enemy.get_meta("god_role_rat", false): return false
	enemy.set_meta("alive", false)
	if bool(enemy.get_meta("god_role_full", false)):
		_full_count = maxi(0, _full_count - 1)
		if game.get("remains") != null and _time >= float(get_meta("next_shatter", 0.0)):
			set_meta("next_shatter", _time + 0.25)
			game.remains.shatter(enemy)
	else: _remove_far_rat(enemy)
	if game.get("scene") != null: game.scene.rats.erase(enemy)
	if game.get("animation") != null: game.animation.actors.erase(enemy.get_instance_id())
	rats.erase(enemy)
	enemy.queue_free()
	return true

func _add_mote(point: Vector3, zone: String, value: int) -> void:
	if motes.size() >= MAX_MOTES:
		var oldest: Dictionary = motes.pop_front()
		if is_instance_valid(oldest.node): oldest.node.queue_free()
	var site := _surface(point, zone)
	var up: Vector3 = site.normal
	var mote := Node3D.new()
	mote.name = "GodEssenceMote"
	mote.set_meta("kind", "god_essence")
	mote.set_meta("zone", zone)
	var mesh := MeshInstance3D.new()
	mesh.mesh = _mote_mesh
	mesh.material_override = _glow
	mote.add_child(mesh)
	var halo := MeshInstance3D.new()
	halo.mesh = _mote_mesh
	halo.material_override = _glow
	halo.scale = Vector3(1.65, 0.18, 1.65)
	halo.position.y = -0.25
	mote.add_child(halo)
	var parent: Node = game.adventure.zone_groups.get(zone, game) if game.get("adventure") != null else game
	parent.add_child(mote)
	mote.global_basis = Basis.looking_at(up.cross(Vector3.FORWARD).normalized() if absf(up.dot(Vector3.FORWARD)) < 0.98 else up.cross(Vector3.RIGHT).normalized(), up)
	mote.global_position = site.position + up * 0.46
	motes.append({"node": mote, "zone": zone, "value": value, "expires": _time + MOTE_LIFE, "ground": site.position, "normal": up})

func _advance_motes(_delta: float) -> void:
	for i in range(motes.size() - 1, -1, -1):
		var item: Dictionary = motes[i]
		if _time >= float(item.expires) or not is_instance_valid(item.node):
			if is_instance_valid(item.node): item.node.queue_free()
			motes.remove_at(i)
			continue
		var node: Node3D = item.node
		var up: Vector3 = item.normal
		node.global_position = item.ground + up * (0.46 + 0.11 * sin(_time * 3.5 + float(i)))
		node.scale = Vector3.ONE * (1.0 + 0.12 * sin(_time * 4.0 + float(i)))

func collect_near(world_point: Vector3) -> Dictionary:
	if not world_point.is_finite(): return {"ok": false, "error": "Aim at an essence mote"}
	var zone := str(game.adventure.zone) if game != null and game.get("adventure") != null else ""
	var collected := 0
	for i in range(motes.size() - 1, -1, -1):
		if collected >= 24: break
		var item: Dictionary = motes[i]
		if item.zone != zone or not is_instance_valid(item.node): continue
		if item.node.global_position.distance_to(world_point) > COLLECT_RADIUS: continue
		collected += int(item.value)
		item.node.queue_free()
		motes.remove_at(i)
	if collected > 0 and game != null and game.get("world_builder") != null:
		game.world_builder.data["god_essence"] = mini(ESSENCE_CAP, essence() + collected)
		_schedule_save(0.6)
	return {"ok": true, "collected": collected, "essence": essence()}

func cast_skeleton(world_point: Vector3, zone: String) -> Dictionary:
	if not _target_valid(world_point, zone): return {"ok": false, "error": "Aim at reachable ground in the Hero's region"}
	if essence() < 2: return {"ok": false, "error": "Need 2 Essence for a skeleton squad"}
	var remaining := float(game.world_builder.data.get("spell_cooldowns", {}).get("patrol", 0.0))
	if remaining > 0.001: return {"ok": false, "error": "Skeleton Squad recharges in %.1f s" % remaining}
	var result: Dictionary
	if zone == "orchard_planet":
		if _mana() < 4.0: return {"ok": false, "error": "Need 4 Mana for a skeleton squad"}
		result = game.orchard_planet.cast("patrol", world_point)
		if result.get("ok", false):
			game.world_builder.data.mana = _mana() - 4.0
			if not game.world_builder.data.has("spell_cooldowns"): game.world_builder.data["spell_cooldowns"] = {}
			game.world_builder.data.spell_cooldowns["patrol"] = 12.0
	else:
		var error: String = game.world_builder.summon_encounter("patrol", world_point, zone)
		result = {"ok": error.is_empty(), "error": error}
	if result.get("ok", false):
		game.world_builder.data["god_essence"] = essence() - 2
		_schedule_save(0.1)
	return result

func cast_workers(world_point: Vector3, zone: String) -> Dictionary:
	if not _target_valid(world_point, zone): return {"ok": false, "error": "Aim at reachable ground in the Hero's region"}
	if game.get("god_workers") == null: return {"ok": false, "error": "Lumberjacks are not ready"}
	var use_mana := _mana() >= 3.0
	if not use_mana and essence() < 3: return {"ok": false, "error": "Need 3 Mana or 3 Essence to summon a lumberjack"}
	var result: Dictionary = game.god_workers.summon(world_point, zone)
	if not result.get("ok", false): return result
	if use_mana: game.world_builder.data.mana = _mana() - 3.0
	else: game.world_builder.data["god_essence"] = essence() - 3
	result["paid"] = "mana" if use_mana else "essence"
	_schedule_save(0.1)
	return result
