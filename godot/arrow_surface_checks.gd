extends SceneTree
## Actual Main, Emberwing flight and damage against isolated visible enemy surfaces.
## Run headlessly with --script res://arrow_surface_checks.gd -- --world-builder-check.

const Bow = preload("res://phoenix_bow.gd")
var failures: Array[String] = []
var checks := 0
var game: Node3D
var bow: Node
var fixture: Node3D
var actor: Node3D
var skull: MeshInstance3D
var rib: MeshInstance3D

func _initialize() -> void:
	call_deferred("_run")

func _check(condition: bool, label: String) -> void:
	checks += 1
	if not condition: failures.append(label)

func _run() -> void:
	var started := Time.get_ticks_usec()
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		push_error("Arrow surface check requires isolated --world-builder-check mode")
		quit(2)
		return
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	game.adventure.test_mode = true
	bow = game.archery
	_check(is_instance_valid(bow) and is_instance_valid(bow.bow), "actual Emberwing missing")
	_check(game.enemy_contacts != null, "shared enemy contact service missing")
	if not failures.is_empty():
		_finish(started)
		return
	_fixture()
	await physics_frame
	await physics_frame
	var origin := actor.global_position
	var gap := origin + Vector3(0.40, 1.70, 0)
	var broad: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(gap + Vector3.BACK, gap + Vector3.FORWARD, 1))
	_check(not broad.is_empty() and game._owner(broad.collider) == actor, "fixture lacks oversized interaction box")
	_check(game.enemy_contacts.sweep(gap + Vector3.BACK, gap + Vector3.FORWARD, 1).is_empty(), "empty visible gap acquired enemy contact")
	var gap_shot := _shot(gap + Vector3.BACK * 0.8, 42.0, 62.0)
	bow._tick_shots(0.045)
	_check(bow.shots.has(gap_shot) and bool(actor.get_meta("alive")), "arrow hit empty gap inside interaction box")
	_check(bow.embedded.is_empty(), "gap arrow embedded in proxy")
	bow._retire_shot(gap_shot)
	var head_start := skull.global_position + Vector3.BACK * 0.8
	var head_hit: Dictionary = game.enemy_contacts.sweep(head_start, head_start + Vector3.FORWARD * 1.4, 1)
	_check(head_hit.get("part", "") == "head" and head_hit.get("surface") == skull, "visible skull surface mislabeled or missed")
	var head_shot := _shot(head_start, 42.0, 62.0)
	bow._tick_shots(0.04)
	_check(not bow.shots.has(head_shot) and not bool(actor.get_meta("alive")), "skull arrow did not one-hit ordinary skeleton")
	_check(float(actor.get_meta("hp", 66.0)) <= 0.0, "headshot damage did not reach actual enemy health")
	_check(bow.embedded.size() == 1 and is_instance_valid(head_shot.node), "head arrow did not persist after impact")
	if is_instance_valid(head_shot.node) and not bow.embedded.is_empty():
		var head_surface: Node3D = bow.embedded.back().get("surface")
		_check(is_instance_valid(head_surface) and head_surface != actor and head_surface != skull and head_surface.is_visible_in_tree(), "fatal arrow lost visible fallen bone surface")
	# A second actor starts fresh so the rib arrow can remain on a moving visible mesh.
	var first_actor := actor
	var first_rig: Dictionary = game.animation.actors.get(first_actor.get_instance_id(), {})
	_spawn_actor(Vector3(10004, 5, 9995))
	await physics_frame
	var body_start := rib.global_position + Vector3.BACK * 0.8
	var body_hit: Dictionary = game.enemy_contacts.sweep(body_start, body_start + Vector3.FORWARD * 1.4, 1)
	_check(body_hit.get("part", "") != "head" and body_hit.get("surface") == rib, "rib arrow confused with skull")
	var body_shot := _shot(body_start, 42.0, 62.0)
	bow._tick_shots(0.04)
	_check(not bow.shots.has(body_shot) and bool(actor.get_meta("alive")), "body arrow incorrectly one-hit ordinary skeleton")
	_check(float(actor.get_meta("hp", 66.0)) > 0.0 and float(actor.get_meta("hp", 66.0)) < 66.0, "body arrow did not deal bounded damage")
	_check(not bow.embedded.is_empty() and bow.embedded.back().get("surface") == rib, "body arrow did not embed in visible rib surface")
	var embedded_before: Transform3D = body_shot.node.global_transform
	var rig: Dictionary = game.animation.actors[actor.get_instance_id()]
	(rig.joints.body as Node3D).rotation.y = 0.38
	await process_frame
	bow.tick(0.0)
	_check(body_shot.node.global_position.distance_to(embedded_before.origin) > 0.01, "embedded arrow did not follow animated rib")
	# An earlier layer-1 wall must win the same shot before the skull.
	var wall := StaticBody3D.new()
	fixture.add_child(wall)
	wall.global_position = skull.global_position + Vector3.BACK * 0.48
	var wall_shape := CollisionShape3D.new()
	wall_shape.shape = BoxShape3D.new()
	wall_shape.shape.size = Vector3(1.0, 1.0, 0.07)
	wall.add_child(wall_shape)
	await physics_frame
	var blocked_start := skull.global_position + Vector3.BACK * 0.8
	var blocked_shot := _shot(blocked_start, 42.0, 62.0)
	var hp_before: float = float(actor.get_meta("hp", 66.0))
	bow._tick_shots(0.04)
	_check(not bow.shots.has(blocked_shot) and is_equal_approx(float(actor.get_meta("hp", 66.0)), hp_before), "wall failed to block arrow before enemy")
	_check(not bow.embedded.is_empty() and bow.embedded.back().get("surface") == wall, "blocked arrow embedded beyond nearest world surface")
	await _model_family_checks()
	if not first_rig.is_empty():
		for home in first_rig.homes:
			if home.has("template") and is_instance_valid(home.template): home.template.free()
		game.animation.actors.erase(first_actor.get_instance_id())
	_finish(started)

func _model_family_checks() -> void:
	# Reuse the instances built by the real Main setup, including their animation
	# rig and mesh resources. Isolating each in the disposable scene avoids
	# unrelated terrain and another actor winning the measured ray.
	var scene_enemies: Array = game.scene.enemies
	var scene_rats: Array = game.scene.rats
	var chosen := {}
	for candidate in scene_enemies + scene_rats:
		if not is_instance_valid(candidate): continue
		var kind := str(candidate.get_meta("enemy_type", "rat"))
		if kind in ["golem", "wisp", "boss", "ghost", "rat"] and not chosen.has(kind): chosen[kind] = candidate
	var builder: Node = game.world_builder
	if builder != null and builder.ents != null and not builder.resource_by_key.is_empty():
		var tree_key: String = str(builder.resource_by_key.keys()[0])
		var tree: Node3D = builder.resource_by_key[tree_key]
		builder.ents._activate(tree, {"key": tree_key, "state": "active", "species": "pine", "scale": 1.0, "condition": "healthy", "hp": 130.0, "calm_left": 0.0})
		chosen["ent"] = tree
	for kind in ["rat", "golem", "wisp", "boss", "ghost", "ent"]:
		_check(chosen.has(kind), "installed " + kind + " model unavailable")
		if not chosen.has(kind): continue
		var model: Node3D = chosen[kind]
		model.reparent(fixture)
		model.global_position = Vector3(10030 + chosen.keys().find(kind) * 12, 5, 9995)
		model.set_meta("zone", game.adventure.zone)
		model.set_meta("alive", true)
		model.show()
		game.scene.enemies = [model]
		game.scene.rats = []
		if game.animation.actors.has(model.get_instance_id()): game.animation.pose(model, "attack", 0.72)
		await process_frame
		await physics_frame
		var sample := _visible_sample(model, kind)
		_check(not sample.is_empty(), "installed " + kind + " visible triangles missed by sweep")
		if sample.is_empty(): continue
		var hit: Dictionary = game.enemy_contacts.sweep(sample.start, sample.finish, 1)
		_check(hit.get("collider") == model and hit.get("surface") == sample.mesh and hit.position.distance_to(sample.center) < 0.035, "installed " + kind + " hit differs from source triangle")
		if kind == "boss":
			_check(absf(sample.center.x - model.global_position.x) > 1.3 or sample.center.y - model.global_position.y > 3.65, "boss protrusion beyond proxy not exercised")
			sample.mesh.hide()
			_check(game.enemy_contacts.sweep(sample.start, sample.finish, 1).get("surface") != sample.mesh, "hidden boss armour still catches projectile")
			sample.mesh.show()
		if kind == "rat": _check(str(hit.get("part", "")) == "tail", "animated rat tail lost part label")
		if kind == "ghost":
			var art: Node3D = model.get_meta("art")
			art.hide()
			_check(game.enemy_contacts.sweep(sample.start, sample.finish, 1).is_empty(), "hidden ghost art still catches projectile")
			art.show()
		if kind == "golem":
			var before: Vector3 = sample.center
			game.animation.pose(model, "attack", 0.95)
			await process_frame
			var moved: Dictionary = game.enemy_contacts.sweep(sample.start, sample.finish, 1)
			_check(moved.is_empty() or moved.get("collider") == model, "golem animation leaked a foreign surface")
			_check(sample.mesh.global_position.distance_to(before) > 0.01, "golem sampled piece did not articulate")
	var benchmark: Node3D = chosen.get("boss")
	if is_instance_valid(benchmark):
		game.scene.enemies = [benchmark]
		game.scene.rats = []
		var start := benchmark.global_position + Vector3(3, 2, 0)
		var finish := start + Vector3(0, 0, -2)
		game.enemy_contacts.sweep(start, finish, 1)
		var began := Time.get_ticks_usec()
		for i in 1000: game.enemy_contacts.sweep(start, finish, 1)
		print("ARROW_SURFACE_COST ", JSON.stringify({"warm_1000_ms": float(Time.get_ticks_usec() - began) / 1000.0, "scene_enemies": scene_enemies.size(), "scene_rats": scene_rats.size()}))
	game.scene.enemies = scene_enemies
	game.scene.rats = scene_rats

func _visible_sample(model: Node3D, kind: String) -> Dictionary:
	var meshes: Array = game.enemy_contacts._meshes(model)
	var scored := []
	for mesh in meshes:
		if not is_instance_valid(mesh) or not mesh.is_visible_in_tree() or mesh.mesh == null: continue
		var part := str(game.enemy_contacts._part(mesh, model))
		if kind == "rat" and part != "tail": continue
		var extent: float = absf(mesh.global_position.x - model.global_position.x)
		if kind == "boss": extent = maxf(extent, mesh.global_position.y - model.global_position.y)
		scored.append({"mesh": mesh, "score": extent})
	scored.sort_custom(func(a, b): return float(a.score) > float(b.score))
	for entry in scored:
		var mesh: MeshInstance3D = entry.mesh
		var faces: PackedVector3Array = mesh.mesh.get_faces()
		for index in range(0, mini(faces.size() - 2, 450), 3):
			var center_local: Vector3 = (faces[index] + faces[index + 1] + faces[index + 2]) / 3.0
			var normal_local: Vector3 = (faces[index + 1] - faces[index]).cross(faces[index + 2] - faces[index]).normalized()
			if normal_local.length_squared() < 0.5: continue
			var center: Vector3 = mesh.to_global(center_local)
			if kind == "boss" and absf(center.x - model.global_position.x) <= 1.3 and center.y - model.global_position.y <= 3.65: continue
			var normal: Vector3 = (mesh.global_basis.inverse().transposed() * normal_local).normalized()
			var start: Vector3 = center + normal * 0.08
			var finish: Vector3 = center - normal * 0.08
			var hit: Dictionary = game.enemy_contacts.sweep(start, finish, 1)
			if hit.get("collider") == model and hit.get("surface") == mesh and hit.position.distance_to(center) < 0.035:
				return {"mesh": mesh, "center": center, "start": start, "finish": finish}
	return {}

func _fixture() -> void:
	fixture = Node3D.new()
	fixture.name = "ArrowSurfaceFixture"
	game.add_child(fixture)
	_spawn_actor(Vector3(10000, 5, 9995))

func _spawn_actor(position: Vector3) -> void:
	actor = Node3D.new()
	actor.name = "SkeletonSurfaceFixture"
	actor.set_meta("kind", "enemy")
	actor.set_meta("enemy_type", "skeleton")
	actor.set_meta("zone", game.adventure.zone)
	actor.set_meta("alive", true)
	actor.set_meta("hp", 66.0)
	actor.set_meta("max_hp", 66.0)
	actor.set_meta("home", position)
	actor.set_meta("loot", {})
	actor.set_meta("director_spawned", true)
	fixture.add_child(actor)
	actor.global_position = position
	var proxy := StaticBody3D.new()
	proxy.name = "InteractionProxy"
	actor.add_child(proxy)
	proxy.position.y = 1.25
	var collision := CollisionShape3D.new()
	collision.shape = BoxShape3D.new()
	collision.shape.size = Vector3(1.4, 2.4, 1.0)
	proxy.add_child(collision)
	var visual := Node3D.new()
	visual.name = "AnimatedVisual"
	actor.add_child(visual)
	var body_joint := Node3D.new()
	body_joint.name = "body"
	visual.add_child(body_joint)
	body_joint.position.y = 1.06
	var body_piece := Node3D.new()
	body_piece.name = "RibCage"
	body_joint.add_child(body_piece)
	rib = MeshInstance3D.new()
	rib.name = "VisibleRib"
	body_piece.add_child(rib)
	var body_mesh := BoxMesh.new()
	body_mesh.size = Vector3(0.34, 0.36, 0.22)
	rib.mesh = body_mesh
	var head_joint := Node3D.new()
	head_joint.name = "head"
	visual.add_child(head_joint)
	head_joint.position.y = 1.68
	var skull_piece := Node3D.new()
	skull_piece.name = "Skull"
	head_joint.add_child(skull_piece)
	skull = MeshInstance3D.new()
	skull.name = "VisibleSkull"
	skull_piece.add_child(skull)
	var head_mesh := BoxMesh.new()
	head_mesh.size = Vector3(0.26, 0.25, 0.22)
	skull.mesh = head_mesh
	game.animation.actors[actor.get_instance_id()] = {"actor": actor, "type": "skeleton", "homes": [{"piece": body_piece, "parent": body_joint, "transform": body_piece.transform}, {"piece": skull_piece, "parent": head_joint, "transform": skull_piece.transform}], "joints": {"body": body_joint, "head": head_joint}, "pieces": [body_piece, skull_piece], "visual": visual, "hit_at": -100.0, "hit_dir": Vector3.ZERO}
	game.scene.enemies.append(actor)

func _shot(start: Vector3, speed: float, damage: float) -> Dictionary:
	var arrow: Node3D = bow.arrow_scene.instantiate()
	game.add_child(arrow)
	arrow.global_basis = Basis.looking_at(Vector3.FORWARD, Vector3.UP)
	arrow.global_position = start - arrow.global_basis * Bow.ARROW_TIP
	var wings: Node3D = bow.wing_scene.instantiate()
	game.add_child(wings)
	wings.visible = false
	var shot := {"node": arrow, "wings": wings, "position": start, "velocity": Vector3.FORWARD * speed, "curve": Vector3.ZERO, "age": 0.0, "hand": game.desktop_hand, "zone": game.adventure.zone, "until": game.elapsed + 12.0, "damage": damage}
	bow.shots.append(shot)
	return shot

func _finish(started: int) -> void:
	print("ARROW_SURFACE_RESULT ", JSON.stringify({"checks": checks, "failures": failures, "elapsed_seconds": float(Time.get_ticks_usec() - started) / 1000000.0}))
	if is_instance_valid(game):
		game.free()
	game = null
	bow = null
	fixture = null
	actor = null
	skull = null
	rib = null
	await process_frame
	quit(0 if failures.is_empty() else 1)
