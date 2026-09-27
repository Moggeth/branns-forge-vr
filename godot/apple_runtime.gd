extends Node
## Tree fruit stays cheap while attached; a struck apple becomes a real rigid body.
const TreeKit = preload("res://tree_kit.gd")
const HEAL = 40.0
const DETACH_SPEED = 2.7
const GRAB_REACH = 0.20
const MOUTH_REACH = 0.19
const REGROW_SECONDS = 65.0

var game
var entries: Array = []
var apple_mesh: ArrayMesh
var material: Material
var crunch: AudioStreamWAV
var sounds: Array = []
var sound_cursor := 0

func setup(owner_game):
	game = owner_game
	apple_mesh = TreeKit.apple_object_mesh()
	material = TreeKit.tree_material()
	for tree in game.get_tree().get_nodes_in_group("interactive_apple_tree"):
		var fruit: Array = tree.get_meta("apple_fruit", [])
		if fruit.is_empty(): continue
		var multimesh = MultiMesh.new()
		multimesh.transform_format = MultiMesh.TRANSFORM_3D
		multimesh.mesh = apple_mesh
		multimesh.instance_count = fruit.size()
		var visual = MultiMeshInstance3D.new()
		visual.name = "ShootableApples"
		visual.multimesh = multimesh
		visual.material_override = material
		tree.add_child(visual)
		for index in fruit.size():
			_add(tree, fruit[index].pos, str(_zone(tree)), null, visual, index, fruit[index])
	for resource in game.scene.get("resources", []):
		if str(resource.get_meta("resource", "")) != "apple": continue
		resource.set_meta("amount", 1)
		# Older static-cluster visuals are removed only from apple resources.
		for child in resource.get_children():
			if child.name in ["Apples", "AppleBody"]: child.queue_free()
		_add(resource, Vector3.ZERO, str(resource.get_meta("zone", "forge_yard")), resource, null, -1, {})
	crunch = _crunch_wave()
	for i in range(3):
		var player = AudioStreamPlayer3D.new()
		game.add_child(player)
		player.max_distance = 8.0
		player.stream = crunch
		sounds.append(player)
	print("APPLE_RUNTIME attached=", entries.size(), " trees=", game.get_tree().get_nodes_in_group("interactive_apple_tree").size())

func _zone(node: Node) -> String:
	var current = node
	while current != null and current != game:
		if current.has_meta("zone"): return str(current.get_meta("zone"))
		current = current.get_parent()
	return "forge_yard"

func _add(parent: Node3D, local_pos: Vector3, zone: String, source: Node3D, visual: MultiMeshInstance3D, instance: int, fruit: Dictionary):
	var collider = StaticBody3D.new()
	collider.name = "AppleStem"
	collider.position = local_pos
	collider.collision_layer = 1
	collider.collision_mask = 9
	parent.add_child(collider)
	var shape = CollisionShape3D.new()
	var sphere = SphereShape3D.new()
	sphere.radius = 0.13
	shape.shape = sphere
	collider.add_child(shape)
	var art: MeshInstance3D = null
	if visual == null:
		art = MeshInstance3D.new()
		art.name = "Apple"
		art.mesh = apple_mesh
		art.material_override = material
		collider.add_child(art)
	var entry = {"collider": collider, "art": art, "visual": visual, "instance": instance,
		"fruit": fruit, "home": local_pos, "zone": zone, "source": source,
		"body": null, "state": "attached", "wobble": 0.0, "wobble_speed": 0.0,
		"last_impact": -10.0, "bite_count": 0, "next_bite": 0.0, "held_by": null,
		"respawn_at": -1.0}
	var id = entries.size()
	entries.append(entry)
	collider.set_meta("kind", "apple")
	collider.set_meta("apple_entry", id)
	_draw(entry)

func _draw(entry: Dictionary):
	if entry.visual != null:
		var f: Dictionary = entry.fruit
		var basis = Basis(Vector3.UP, float(f.get("spin", 0))) * Basis(Vector3.RIGHT, float(f.get("tilt", 0)))
		basis = basis * Basis(Vector3.FORWARD, entry.wobble)
		if entry.state != "attached": basis = basis.scaled(Vector3.ZERO)
		entry.visual.multimesh.set_instance_transform(entry.instance, Transform3D(basis, entry.home))
	elif is_instance_valid(entry.art):
		entry.art.visible = entry.state == "attached"
		entry.art.rotation.z = entry.wobble

func impact(target: Node3D, speed: float, point: Vector3, direction: Vector3) -> Node3D:
	if target == null or not target.has_meta("apple_entry"): return null
	var index = int(target.get_meta("apple_entry"))
	if index < 0 or index >= entries.size(): return null
	var entry: Dictionary = entries[index]
	if entry.zone != game.adventure.zone: return null
	if entry.state == "loose" and is_instance_valid(entry.body):
		entry.body.apply_central_impulse(direction.normalized() * minf(speed * 0.09, 1.2))
		return entry.body
	if entry.state != "attached": return null
	if game.elapsed - float(entry.last_impact) < 0.14: return entry.collider
	entry.last_impact = game.elapsed
	entry.wobble_speed += clampf(speed * 0.28, 0.2, 2.1) * (-1 if direction.x < 0 else 1)
	game._effect(point, Color("f1b66b"), 0.08, 0.10)
	if speed >= DETACH_SPEED:
		return _detach(entry, direction.normalized() * minf(speed * 0.32, 8.0) + Vector3.UP * 0.6)
	return entry.collider

func _detach(entry: Dictionary, velocity: Vector3) -> RigidBody3D:
	if entry.state != "attached": return entry.body
	var point: Vector3 = entry.collider.global_position
	entry.state = "loose"
	entry.collider.collision_layer = 0
	entry.collider.visible = false
	_draw(entry)
	var body = RigidBody3D.new()
	body.name = "FallenApple"
	body.collision_layer = 8
	body.collision_mask = 9
	body.mass = 0.16
	body.continuous_cd = true
	body.linear_damp = 0.35
	body.angular_damp = 0.9
	var physics = PhysicsMaterial.new()
	physics.friction = 0.75
	physics.bounce = 0.18
	body.physics_material_override = physics
	game.adventure.zone_groups.get(entry.zone, game).add_child(body)
	body.global_position = point
	var shape = CollisionShape3D.new()
	var sphere = SphereShape3D.new()
	sphere.radius = 0.10
	shape.shape = sphere
	body.add_child(shape)
	var art = MeshInstance3D.new()
	art.mesh = apple_mesh
	art.material_override = material
	body.add_child(art)
	body.set_meta("kind", "apple")
	body.set_meta("apple_entry", entries.find(entry))
	body.linear_velocity = velocity.limit_length(11)
	body.angular_velocity = Vector3(velocity.z, 0, -velocity.x) * 0.5
	entry.body = body
	return body

func try_grab(hand: Node3D, desktop: bool = false) -> bool:
	var chosen: Dictionary = {}
	var distance = GRAB_REACH
	if desktop:
		var hit = game._ray(game.camera, 3.0)
		var owner = game._owner(hit.get("collider"))
		if owner != null and owner.has_meta("apple_entry"):
			chosen = entries[int(owner.get_meta("apple_entry"))]
	for entry in entries:
		if entry.zone != game.adventure.zone or entry.state not in ["attached", "loose"]: continue
		var node: Node3D = entry.body if entry.state == "loose" else entry.collider
		if not is_instance_valid(node) or not node.is_visible_in_tree(): continue
		var gap = hand.global_position.distance_to(node.global_position)
		if gap < distance:
			chosen = entry
			distance = gap
	if chosen.is_empty() or chosen.state not in ["attached", "loose"]: return false
	var body: RigidBody3D = _detach(chosen, Vector3.ZERO) if chosen.state == "attached" else chosen.body
	if not is_instance_valid(body): return false
	body.freeze = true
	body.collision_layer = 0
	body.collision_mask = 0
	body.reparent(game.hand_socket(hand))
	body.position = Vector3(0, -0.025, -0.055)
	body.rotation = Vector3.ZERO
	chosen.state = "held"
	chosen.held_by = hand
	chosen.bite_count = 0
	chosen.next_bite = game.elapsed + 0.24
	game.held[str(hand.get_instance_id())] = body
	game.adventure.haptic(hand, "ready")
	game._notice("Apple in hand · bring it to your mouth and hold for three bites." if not desktop else "Apple in hand · left-click three times to eat.", 5)
	return true

func release(hand: Node3D) -> bool:
	var key = str(hand.get_instance_id())
	var body = game.held.get(key)
	if not is_instance_valid(body) or str(body.get_meta("kind", "")) != "apple": return false
	var entry: Dictionary = entries[int(body.get_meta("apple_entry"))]
	game.held.erase(key)
	entry.state = "loose"
	entry.held_by = null
	body.reparent(game.adventure.zone_groups.get(entry.zone, game))
	body.freeze = false
	body.collision_layer = 8
	body.collision_mask = 9
	body.linear_velocity = (-game.camera.global_basis.z * 4 + Vector3.UP * 0.7) if hand == game.desktop_hand else game.tuning.release_velocity(hand, false)
	body.angular_velocity = game.adventure.motion.get(key, {}).get("angular", Vector3.ZERO).limit_length(12)
	return true

func bite(hand: Node3D) -> bool:
	var body = game.held.get(str(hand.get_instance_id()))
	if not is_instance_valid(body) or str(body.get_meta("kind", "")) != "apple": return false
	var entry: Dictionary = entries[int(body.get_meta("apple_entry"))]
	if game.elapsed < float(entry.next_bite): return true
	entry.next_bite = game.elapsed + 0.32
	entry.bite_count += 1
	body.scale = Vector3.ONE * (1.0 - 0.19 * int(entry.bite_count))
	_play_crunch(body.global_position, int(entry.bite_count))
	game.adventure.haptic(hand, "impact")
	game._effect(body.global_position, Color("ffe9ac"), 0.13, 0.16)
	if entry.bite_count < 3:
		game._notice("Nom".repeat(int(entry.bite_count)) + "…", 0.8)
		return true
	game.adventure.hp = minf(100.0, game.adventure.hp + HEAL)
	game._notice("Nom nom nom · restored 40 health!", 4)
	game.held.erase(str(hand.get_instance_id()))
	entry.held_by = null
	entry.body = null
	entry.state = "eaten"
	entry.respawn_at = game.elapsed + REGROW_SECONDS
	body.queue_free()
	_give_material("apple-eaten-%d-%d" % [entries.find(entry), Time.get_ticks_msec()])
	return true

func _give_material(id: String):
	if game.diagnostic_offline or not game.online: return
	var response = await game._request("/api/vr/gather", {"id": id, "resource": "apple", "amount": 1})
	if not response.has("error"):
		if game.quests != null: game.quests.ingest(response.get("rpg", {}), true)
		await game._poll()

func blast(point: Vector3, radius: float):
	for entry in entries:
		if entry.zone != game.adventure.zone or entry.state != "attached": continue
		var p: Vector3 = entry.collider.global_position
		if p.distance_to(point) < radius:
			impact(entry.collider, DETACH_SPEED + 1.0, p, (p - point + Vector3.UP * 0.5).normalized() * 4)

func on_tool_contact(body: RigidBody3D, other: Node3D):
	var target = game._owner(other)
	if target != null and str(target.get_meta("kind", "")) == "apple":
		impact(target, body.linear_velocity.length(), target.global_position, body.linear_velocity)

func tick(delta: float):
	for entry in entries:
		if entry.zone != game.adventure.zone: continue
		if entry.state == "attached":
			var host = entry.source.get_meta("host_tree") if is_instance_valid(entry.source) and entry.source.has_meta("host_tree") else null
			if host != null and not host.visible:
				_detach(entry, Vector3.UP * 0.8)
				continue
			if absf(entry.wobble) > 0.001 or absf(entry.wobble_speed) > 0.001:
				entry.wobble_speed += (-entry.wobble * 28.0 - entry.wobble_speed * 7.0) * delta
				entry.wobble += entry.wobble_speed * delta
				_draw(entry)
			for hand in game.hands:
				if not hand.get_is_active(): continue
				if hand.global_position.distance_to(entry.collider.global_position) > 0.17: continue
				var velocity: Vector3 = game.adventure.motion.get(str(hand.get_instance_id()), {}).get("velocity", Vector3.ZERO)
				if velocity.length() > 0.55:
					impact(entry.collider, velocity.length(), entry.collider.global_position, velocity)
		elif entry.state == "held":
			var hand: Node3D = entry.held_by
			if not is_instance_valid(hand): continue
			if hand == game.desktop_hand: continue
			var mouth = game.camera.global_position + game.camera.global_basis * Vector3(0, -0.10, -0.12)
			if entry.body.global_position.distance_to(mouth) < MOUTH_REACH: bite(hand)
		elif entry.state == "loose":
			if not is_instance_valid(entry.body): continue
			entry.body.freeze = not entry.body.is_visible_in_tree()
			if entry.body.global_position.y < -12: _reset(entry)
		elif entry.state == "eaten" and game.elapsed >= float(entry.respawn_at):
			_reset(entry)

func _reset(entry: Dictionary):
	if is_instance_valid(entry.body): entry.body.queue_free()
	entry.body = null
	entry.state = "attached"
	entry.wobble = 0.0
	entry.wobble_speed = 0.0
	entry.bite_count = 0
	entry.collider.collision_layer = 1
	entry.collider.visible = true
	_draw(entry)

func _crunch_wave() -> AudioStreamWAV:
	var sample_rate = 22050
	var count = int(sample_rate * 0.13)
	var data = PackedByteArray()
	data.resize(count * 2)
	var rng = RandomNumberGenerator.new()
	rng.seed = 87521
	for i in count:
		var t = float(i) / sample_rate
		var crackle = rng.randf_range(-1.0, 1.0) * exp(-t * 24.0)
		var body = sin(t * TAU * 270.0) * exp(-t * 32.0) * 0.25
		data.encode_s16(i * 2, int(clampf(crackle * 0.55 + body, -1, 1) * 18000))
	var wave = AudioStreamWAV.new()
	wave.format = AudioStreamWAV.FORMAT_16_BITS
	wave.mix_rate = sample_rate
	wave.data = data
	return wave

func _play_crunch(point: Vector3, bite_number: int):
	if game.diagnostic_offline or DisplayServer.get_name() == "headless": return
	var player: AudioStreamPlayer3D = sounds[sound_cursor % sounds.size()]
	sound_cursor += 1
	player.global_position = point
	player.pitch_scale = 0.9 + 0.08 * bite_number
	player.volume_db = -17
	player.play()
