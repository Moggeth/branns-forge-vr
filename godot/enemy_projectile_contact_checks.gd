extends SceneTree
const Contact = preload("res://enemy_projectile_contact.gd")

class FixtureGame extends Node3D:
	var scene := {"enemies": [], "rats": []}
	var adventure := {"zone": "test", "zone_groups": {}}
	var animation := {"actors": {}}
	var guardians = null
	var remains = null
	func _owner(node):
		while node != null and node != self:
			if node.has_meta("kind"): return node
			node = node.get_parent()
		return null

var failures := []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var game := FixtureGame.new()
	root.add_child(game)
	game.adventure.zone_groups.test = game
	var contact := Contact.new()
	contact.setup(game)
	var enemy := _actor(game, "enemy", Vector3.ZERO)
	var body := _box(enemy, "Body", Vector3(0, 0.55, 0), Vector3(0.6, 0.28, 0.2))
	var head := Node3D.new()
	head.name = "Head"
	enemy.add_child(head)
	head.position = Vector3(0, 1.3, 0)
	_box(head, "SkullMesh", Vector3.ZERO, Vector3(0.3, 0.28, 0.2))
	var proxy := StaticBody3D.new()
	enemy.add_child(proxy)
	var shape := CollisionShape3D.new()
	proxy.add_child(shape)
	var box := BoxShape3D.new()
	box.size = Vector3(0.9, 1.8, 0.8)
	shape.shape = box
	proxy.position.y = 0.9
	await physics_frame
	await physics_frame
	var gap := contact.sweep(Vector3(0, 0.95, 1), Vector3(0, 0.95, -1))
	_check(gap.is_empty(), "interaction proxy stopped shot through visible gap")
	var shadow := _box(enemy, "BodyShadow", Vector3(0, 0.95, 0), Vector3(0.6, 0.2, 0.2))
	shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
	_check(contact.sweep(Vector3(0, 0.95, 1), Vector3(0, 0.95, -1)).is_empty(), "shadow-only art stopped shot")
	var skull := contact.sweep(Vector3(0, 1.3, 1), Vector3(0, 1.3, -1))
	_check(skull.get("collider") == enemy and skull.get("part") == "head", "visible head triangle missed")
	_check(skull.get("surface") is MeshInstance3D, "enemy surface missing")
	var torso := contact.sweep(Vector3(0, 0.55, 1), Vector3(0, 0.55, -1))
	_check(torso.get("collider") == enemy and torso.get("surface") == body, "visible body triangle missed")
	var excluded_actor: Array = [proxy.get_rid()]
	_check(contact.sweep(Vector3(0, 0.55, 1), Vector3(0, 0.55, -1), 1, excluded_actor).is_empty(), "excluded actor proxy still hit through mesh")
	head.position.x = 0.5
	_check(contact.sweep(Vector3(0, 1.3, 1), Vector3(0, 1.3, -1)).is_empty(), "old head pose remained hittable")
	_check(contact.sweep(Vector3(0.5, 1.3, 1), Vector3(0.5, 1.3, -1)).get("part") == "head", "current head pose missed")
	_box(head, "Brow", Vector3(0.3, 0, 0), Vector3(0.1, 0.1, 0.1))
	_check(contact.sweep(Vector3(0.8, 1.3, 1), Vector3(0.8, 1.3, -1)).get("part") == "head", "nested new model mesh missing from cache")
	head.hide()
	_check(contact.sweep(Vector3(0.5, 1.3, 1), Vector3(0.5, 1.3, -1)).is_empty(), "hidden head remained hittable")
	head.show()
	var wall := StaticBody3D.new()
	game.add_child(wall)
	var wall_shape := CollisionShape3D.new()
	wall.add_child(wall_shape)
	var wall_box := BoxShape3D.new()
	wall_box.size = Vector3(2, 2, 0.1)
	wall_shape.shape = wall_box
	wall.position = Vector3(0, 0.9, 0.5)
	await physics_frame
	_check(contact.sweep(Vector3(0, 0.55, 1), Vector3(0, 0.55, -1)).get("collider") == wall, "nearest wall lost to farther enemy")
	var excluded: Array[RID] = [wall.get_rid()]
	_check(contact.sweep(Vector3(0, 0.55, 1), Vector3(0, 0.55, -1), 1, excluded).get("collider") == enemy, "explicit excluded RID blocked enemy")
	wall.queue_free()
	await physics_frame
	enemy.set_meta("alive", false)
	_check(contact.sweep(Vector3(0, 0.55, 1), Vector3(0, 0.55, -1)).is_empty(), "dead actor remained hittable")
	enemy.set_meta("alive", true)
	enemy.set_meta("zone", "elsewhere")
	_check(contact.sweep(Vector3(0, 0.55, 1), Vector3(0, 0.55, -1)).is_empty(), "inactive zone remained hittable")
	enemy.set_meta("zone", "test")
	var rat := _actor(game, "rat", Vector3(2, 0, 0))
	_box(rat, "RatBody", Vector3(0, 0.2, 0), Vector3(0.3, 0.3, 0.4))
	var rat_hit := contact.sweep(Vector3(2, 0.2, 1), Vector3(2, 0.2, -1))
	_check(rat_hit.get("collider") == rat, "rat list was not included")
	var area := Area3D.new()
	game.add_child(area)
	area.collision_layer = 1
	area.position = Vector3(3, 0.5, 0)
	var area_shape := CollisionShape3D.new()
	area.add_child(area_shape)
	var area_box := BoxShape3D.new()
	area_box.size = Vector3(0.5, 0.5, 0.2)
	area_shape.shape = area_box
	await physics_frame
	_check(contact.sweep(Vector3(3, 0.5, 1), Vector3(3, 0.5, -1)).is_empty(), "areas unexpectedly block default sweep")
	var untyped_empty: Array = []
	_check(contact.sweep(Vector3(3, 0.5, 1), Vector3(3, 0.5, -1), 1, untyped_empty, true).get("collider") == area, "untyped array or area opt-in failed")
	var long_actor := _actor(game, "enemy", Vector3(5, 0, 0))
	var tail := _box(long_actor, "Tail", Vector3(5, 0.5, 0), Vector3(0.4, 0.4, 0.2))
	_check(contact.sweep(Vector3(10, 0.5, 1), Vector3(10, 0.5, -1)).get("collider") == long_actor, "long tail rejected by actor envelope")
	var wider := BoxMesh.new()
	wider.size = Vector3(2.4, 0.4, 0.2)
	tail.mesh = wider
	_check(contact.sweep(Vector3(11, 0.5, 1), Vector3(11, 0.5, -1)).get("collider") == long_actor, "replacement model bounds remained stale")
	# Mutating an existing mesh resource must invalidate its cached triangles too.
	wider.size = Vector3(4.4, 0.4, 0.2)
	_check(contact.sweep(Vector3(12, 0.5, 1), Vector3(12, 0.5, -1)).get("collider") == long_actor, "in-place expanded mesh retained old triangles")
	wider.size = Vector3(2.4, 0.4, 1.2)
	var resized_hit := contact.sweep(Vector3(10, 0.5, 1), Vector3(10, 0.5, -1))
	_check(not resized_hit.is_empty() and absf(float(resized_hit.get("position", Vector3.ZERO).z) - 0.6) < 0.001, "in-place depth change retained old impact surface")
	var connections := wider.changed.get_connections().size()
	for revision in range(8):
		wider.size.z = 0.4 + revision * 0.1
		var changed_hit := contact.sweep(Vector3(10, 0.5, 1), Vector3(10, 0.5, -1))
		_check(not changed_hit.is_empty() and absf(float(changed_hit.get("position", Vector3.ZERO).z) - wider.size.z * 0.5) < 0.001, "repeated mesh edit lost invalidation")
	_check(wider.changed.get_connections().size() == connections, "mesh edits accumulated invalidation listeners")
	var temporary_contact = Contact.new()
	temporary_contact._arrays(wider)
	var weak_contact: WeakRef = weakref(temporary_contact)
	temporary_contact = null
	_check(weak_contact.get_ref() == null, "mesh invalidation listener retained retired contact manager")
	_check(wider.changed.get_connections().size() == connections, "retired contact manager left invalidation listeners")
	var boss := _actor(game, "enemy", Vector3(20, 0, 0))
	boss.scale = Vector3.ONE * 6.0
	_box(boss, "Body", Vector3(2, 0.5, 0), Vector3(1, 1, 1))
	_check(contact.sweep(Vector3(32, 3, 8), Vector3(32, 3, -8)).get("collider") == boss, "large scaled boss rejected by actor envelope")
	boss.scale = Vector3.ONE * 8.0
	_check(contact.sweep(Vector3(36, 4, 8), Vector3(36, 4, -8)).get("collider") == boss, "current actor scale rejected by envelope")
	enemy.set_meta("enemy_type", "skeleton")
	_check(is_equal_approx(contact.damage(enemy, 95, false), 32.0), "skeleton body damage changed")
	_check(contact.damage(enemy, 20, true) >= 66.0, "ordinary skeleton headshot damage changed")
	# Repeated rays near the player should not traverse every distant actor's art.
	for index in range(48):
		var distant := _actor(game, "enemy", Vector3(100 + index * 3, 0, 0))
		for part in range(8):
			_box(distant, "Part%d" % part, Vector3(part * 0.12, 0.5, 0), Vector3(0.1, 0.1, 0.1))
	var started := Time.get_ticks_usec()
	for index in range(200):
		contact.sweep(Vector3(0, 3.5, 1), Vector3(0, 3.5, -1))
	print("ENEMY_PROJECTILE_FAR_BATCH_MS ", (Time.get_ticks_usec() - started) * 0.001)
	print("ENEMY_PROJECTILE_CONTACT_RESULT ", failures)
	game.queue_free()
	quit(0 if failures.is_empty() else 1)

func _actor(game: FixtureGame, kind: String, position: Vector3) -> Node3D:
	var actor := Node3D.new()
	game.add_child(actor)
	actor.global_position = position
	actor.set_meta("kind", kind)
	actor.set_meta("enemy_type", "rat" if kind == "rat" else "wisp")
	actor.set_meta("zone", "test")
	actor.set_meta("alive", true)
	if kind == "rat": game.scene.rats.append(actor)
	else: game.scene.enemies.append(actor)
	return actor

func _box(parent: Node3D, label: String, offset: Vector3, size: Vector3) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	mesh.name = label
	parent.add_child(mesh)
	mesh.position = offset
	var box := BoxMesh.new()
	box.size = size
	mesh.mesh = box
	return mesh

func _check(condition: bool, message: String) -> void:
	if not condition: failures.append(message)
