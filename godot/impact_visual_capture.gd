extends SceneTree
## Native, fixed-time FPS view of a pick striking stone. No Main, saves or service.
const Adventure = preload("res://adventure_runtime.gd")
const Grips = preload("res://grip_runtime.gd")
const Pose = preload("res://desktop_weapon_pose.gd")
const Feedback = preload("res://impact_feedback.gd")
const HardContact = preload("res://hard_surface_contact.gd")
const WorldZones = preload("res://world_zones.gd")
const ActorAnimation = preload("res://actor_animation.gd")
const TIMES := [0.0, 0.025, 0.05, 0.10, 0.18, 0.30, 0.50, 0.75]

class Game extends Node3D:
	var diagnostic_offline := true
	var tuning = null
	var elapsed := 10.0
	var scene := {"enemies": [], "rats": []}
	var animation
	func _collider(_parent: Node3D, _size: Vector3, _center: Vector3) -> void: pass

func _initialize() -> void: call_deferred("_capture")

func _capture() -> void:
	if DisplayServer.get_name() == "headless": quit(2); return
	create_timer(45.0).timeout.connect(func(): quit(2))
	root.unfocusable = true
	root.size = Vector2i(1280, 800)
	root.position = Vector2i(-16000, -16000)
	var output := ProjectSettings.globalize_path("res://../outputs/impact-visual")
	DirAccess.make_dir_recursive_absolute(output)
	var game := Game.new()
	root.add_child(game)
	var world := WorldEnvironment.new()
	world.environment = Environment.new()
	world.environment.background_mode = Environment.BG_COLOR
	world.environment.background_color = Color("293940")
	world.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	world.environment.ambient_light_color = Color("c5d1d4")
	world.environment.ambient_light_energy = 0.8
	game.add_child(world)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, -34, 0)
	sun.light_energy = 2.0
	game.add_child(sun)
	var camera := Camera3D.new()
	camera.position.y = 1.65
	camera.fov = 75
	camera.current = true
	game.add_child(camera)
	var slab := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(1.8, 1.55, 0.34)
	slab.mesh = box
	slab.position = Vector3(0, 1.55, -1.82)
	var stone := StandardMaterial3D.new()
	stone.albedo_color = Color("67757b")
	stone.roughness = 0.94
	slab.material_override = stone
	slab.set_meta("surface_material", "stone")
	game.add_child(slab)
	var floor := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(10, 10)
	floor.mesh = plane
	var ground := StandardMaterial3D.new()
	ground.albedo_color = Color("545c51")
	ground.roughness = 1.0
	floor.material_override = ground
	game.add_child(floor)
	var hand := Node3D.new()
	camera.add_child(hand)
	var adventure := Adventure.new()
	game.add_child(adventure)
	adventure.game = game
	var grips := Grips.new()
	game.add_child(grips)
	var pick: Node3D = adventure._tool_model("quarry_pick")
	hand.add_child(pick)
	pick.transform = grips._default_pose(pick, hand)
	var profile: Dictionary = Pose.profile(pick)
	var duration: float = float(profile.get("duration", 0.55))
	var contact: float = float(profile.get("contact", 0.5))
	var canvas := CanvasLayer.new()
	game.add_child(canvas)
	var caption := Label.new()
	canvas.add_child(caption)
	caption.position = Vector2(24, 24)
	caption.add_theme_font_size_override("font_size", 25)
	var cross := Label.new()
	canvas.add_child(cross)
	cross.text = "+"
	cross.position = Vector2(628, 389)
	cross.add_theme_font_size_override("font_size", 24)
	root.position = Vector2i(-16000, -16000)
	var began := Time.get_ticks_usec()
	var failures: Array[String] = []
	await _capture_target(game, camera, hand, pick, slab, Vector3(0, 1.55, -1.65), Vector3.BACK,
		"stone", duration, contact, caption, output, failures)
	slab.visible = false
	# Sight along stone armour instead of the bright chest core.
	camera.position.x = 0.60
	var golem: Node3D = WorldZones.enemy(game, game.scene, "sandstone_quarry", Vector3(0, 0, -2.65), "golem")
	game.animation = ActorAnimation.new()
	game.add_child(game.animation)
	game.animation.setup(game)
	var entry: Dictionary = game.animation.golem_runtime.entries.get(golem.get_instance_id(), {})
	if entry.is_empty() or not bool(entry.get("art", false)):
		failures.append("real modular golem art did not bind")
	else:
		game.animation.pose(golem, "idle", 0.0)
		var hit := _visible_mesh_hit(golem, camera.global_position, -camera.global_basis.z)
		if hit.is_empty():
			failures.append("camera ray missed visible authored golem triangles")
		else:
			if camera.global_position.distance_to(hit.point) > 2.4:
				failures.append("golem contact exceeds desktop melee reach")
			print("IMPACT_GOLEM_SURFACE ", {"mesh": hit.mesh, "point": hit.point, "normal": hit.normal,
				"distance": camera.global_position.distance_to(hit.point)})
			await _capture_target(game, camera, hand, pick, golem, hit.point, hit.normal,
				"golem", duration, contact, caption, output, failures)
	print("IMPACT_VISUAL_CAPTURE ", {"directory": output, "failures": failures, "seconds": (Time.get_ticks_usec() - began) / 1000000.0})
	game.free()
	quit(0 if failures.is_empty() else 1)

func _capture_target(game: Game, camera: Camera3D, hand: Node3D, pick: Node3D,
		target: Node3D, point: Vector3, normal: Vector3, label: String,
		duration: float, contact: float, caption: Label, output: String,
		failures: Array[String]) -> void:
	var feedback := Feedback.new()
	game.add_child(feedback)
	feedback.setup(game)
	var rest: Transform3D = Pose.idle(0, 0, 0)
	var reach := clampf(camera.global_position.distance_to(point), 0.8, 2.4)
	var contact_pose: Transform3D = Pose.swing(pick, contact, rest, reach)
	var regions: Array[Dictionary] = HardContact.regions(pick)
	var tip: Vector3 = regions[0].local
	# Align the real authored pick point, not the broad proxy, with the ray hit.
	contact_pose.origin += camera.to_local(point) - contact_pose * (pick.transform * tip)
	var tip_error: float = (camera.global_transform * contact_pose * pick.transform * tip).distance_to(point)
	if tip_error > 0.001: failures.append("%s tip misses surface: %.5f" % [label, tip_error])
	var struck := feedback.emit_contact({"target": target, "point": point, "normal": normal,
		"material": "stone", "tool": "quarry_pick", "tool_material": "steel",
		"strike_region": "pick_point", "relative_velocity": -normal * 7.0, "energy": 24.0})
	if not struck: failures.append(label + " contact rejected")
	var previous := 0.0
	for index in TIMES.size():
		var seconds: float = TIMES[index]
		while previous < seconds - 0.00001:
			var step: float = minf(1.0 / 120.0, seconds - previous)
			game.elapsed += step
			feedback.tick(step)
			previous += step
		var progress := clampf(contact + seconds / duration, 0.0, 1.0)
		hand.transform = HardContact.desktop_pose(contact_pose, rest, progress)
		caption.text = "Stonewhisper | %s impact | +%03d ms | %d fragments" % [label, roundi(seconds * 1000.0), int(feedback.stats.active)]
		await process_frame
		await RenderingServer.frame_post_draw
		var path := output.path_join("pick-%s-%03d.png" % [label, roundi(seconds * 1000.0)])
		var image: Image = root.get_texture().get_image()
		if image.is_empty() or image.save_png(path) != OK: failures.append(path)
	feedback.free()

func _visible_mesh_hit(actor: Node3D, origin: Vector3, direction: Vector3) -> Dictionary:
	var best := {}
	var nearest := INF
	for node in actor.find_children("*", "MeshInstance3D", true, false):
		var mesh_node := node as MeshInstance3D
		if not mesh_node.is_visible_in_tree() or mesh_node.mesh == null: continue
		var faces: PackedVector3Array = mesh_node.mesh.get_faces()
		for i in range(0, faces.size(), 3):
			var a: Vector3 = mesh_node.to_global(faces[i])
			var b: Vector3 = mesh_node.to_global(faces[i + 1])
			var c: Vector3 = mesh_node.to_global(faces[i + 2])
			var hit = Geometry3D.ray_intersects_triangle(origin, direction, a, b, c)
			if hit == null: continue
			var distance: float = origin.distance_to(hit)
			if distance >= nearest: continue
			nearest = distance
			var normal: Vector3 = (c - a).cross(b - a).normalized()
			if normal.dot(-direction) < 0.0: normal = -normal
			best = {"mesh": mesh_node.name, "point": hit, "normal": normal}
	return best
