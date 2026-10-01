extends SceneTree
## Native graphical review only. This is an isolated scene, never Main or saves.
## Godot --xr-mode off --audio-driver Dummy --path godot
##   --script res://guardian_motion_review.gd

const Adapter = preload("res://guardian_authored_animation.gd")
const Contact = preload("res://skeleton_attack_contact.gd")
const VARIANTS := ["mossward", "prismwatch", "cinderkeep"]
const OUTPUT := "res://../outputs/skeleton-motion-review"
const SIZE := Vector2i(1280, 760)

var failures: Array[String] = []
var captures: Array[Dictionary] = []

func _initialize() -> void:
	if DisplayServer.get_name() == "headless":
		push_error("GUARDIAN_MOTION_REVIEW needs a native renderer; run guardian_motion_checks.gd for headless checks")
		quit(1)
		return
	# Keep the renderer alive without bringing a visible/focusable application
	# over the resident game. The images come from a separate SubViewport.
	root.set_flag(Window.FLAG_NO_FOCUS, true)
	root.position = Vector2i(30000, 30000)
	root.size = Vector2i(32, 32)
	call_deferred("_run")

func _run() -> void:
	var started_ms := Time.get_ticks_msec()
	var output := ProjectSettings.globalize_path(OUTPUT)
	if DirAccess.make_dir_recursive_absolute(output) != OK:
		push_error("Could not create " + output)
		quit(1)
		return
	for filename in DirAccess.get_files_at(output):
		if filename.ends_with(".png") and filename.substr(0, 1).is_valid_int():
			DirAccess.remove_absolute(output.path_join(filename))
	var game := Fixture.new()
	root.add_child(game)
	_stage(game)
	var adapter = Adapter.new()
	game.add_child(adapter)
	adapter.setup(game)
	var actors: Array[Node3D] = []
	for index in range(VARIANTS.size()):
		var x := float(index - 1) * 2.25
		var actor := _spawn(game, adapter, str(VARIANTS[index]), Vector3(x, _ground_y(x), (index - 1) * 1.30))
		if actor != null: actors.append(actor)
	if actors.size() != VARIANTS.size():
		_finish(output, started_ms, adapter, actors)
		return
	var view := SubViewport.new()
	view.size = SIZE
	view.world_3d = game.get_world_3d()
	view.msaa_3d = Viewport.MSAA_2X
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(view)
	var camera := Camera3D.new()
	camera.fov = 56.0
	camera.near = 0.05
	camera.far = 60.0
	view.add_child(camera)
	camera.current = true
	await physics_frame
	var phases := ["idle", "walk_00", "walk_20", "walk_40", "walk_60", "walk_80",
		"turn", "left_arm_hit", "head_hit", "hop_land", "hop_flight",
		"attack_windup", "attack_strike", "attack_recovery", "restored"]
	for phase_index in range(phases.size()):
		var phase: String = phases[phase_index]
		_apply_phase(game, adapter, actors, phase)
		var stride := 0.60 if phase == "walk_00" else 0.12 if phase.begins_with("walk_") else 0.12 if phase == "hop_land" else 0.30 if phase == "hop_flight" else 0.0
		_advance(game, adapter, actors, 18, stride)
		var views := ["three_quarter"] if phase.begins_with("walk_") else ["three_quarter", "side"]
		for view_name in views:
			await _capture(view, camera, output, phase_index + 1, phase, view_name, game, adapter, actors)
		if phase in ["idle", "hop_land", "attack_strike"]:
			await _capture(view, camera, output, phase_index + 1, phase, "elevated", game, adapter, actors)
		if phase in ["hop_land", "hop_flight", "attack_strike"]:
			for actor in actors:
				await _capture_close(view, camera, output, phase_index + 1, phase, actor, game, adapter)
	_finish(output, started_ms, adapter, actors)

func _stage(game: Node3D) -> void:
	var environment := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("152029")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("b9c7cc")
	env.ambient_light_energy = 0.45
	environment.environment = env
	game.add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-42, 24, -18)
	sun.light_energy = 1.6
	game.add_child(sun)
	var fill := OmniLight3D.new()
	fill.position = Vector3(2.5, 3.5, 3.5)
	fill.light_energy = 0.45
	game.add_child(fill)
	var ground := StaticBody3D.new()
	ground.name = "ReviewSlope"
	ground.rotation.z = 0.075
	game.add_child(ground)
	var collider := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(12.0, 0.25, 8.0)
	collider.shape = box
	collider.position.y = -0.14
	ground.add_child(collider)
	var surface := MeshInstance3D.new()
	var slab := BoxMesh.new()
	slab.size = box.size
	surface.mesh = slab
	surface.position = collider.position
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("444d4d")
	material.roughness = 0.95
	surface.material_override = material
	ground.add_child(surface)
	for index in range(3):
		var nameplate := Label3D.new()
		nameplate.text = str(VARIANTS[index]).to_upper()
		nameplate.font_size = 44
		nameplate.pixel_size = 0.0028
		nameplate.modulate = Color("e1ded0")
		nameplate.position = Vector3((index - 1) * 2.25, 2.38, (index - 1) * 1.30)
		nameplate.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		game.add_child(nameplate)

func _spawn(game: Fixture, adapter, variant: String, position: Vector3) -> Node3D:
	var actor := Node3D.new()
	actor.name = variant.capitalize() + "ReviewActor"
	game.add_child(actor)
	actor.global_position = position
	actor.set_meta("alive", true)
	actor.set_meta("combat_phase", "idle")
	var legacy := Node3D.new()
	actor.add_child(legacy)
	var old_shield := MeshInstance3D.new()
	actor.add_child(old_shield)
	game.animation.actors[actor.get_instance_id()] = {"pieces": [legacy]}
	game.guardians.guardians[actor.get_instance_id()] = {"state": "carried", "shield": old_shield, "variant": variant}
	if not adapter.attach(actor, variant):
		failures.append("imported rig unavailable: " + variant)
		actor.queue_free()
		return null
	return actor

func _ground_y(x: float) -> float:
	# ReviewSlope's top surface in world space, to keep each root planted.
	return tan(0.075) * x - 0.015

func _apply_phase(game: Fixture, adapter, actors: Array[Node3D], phase: String) -> void:
	for actor in actors:
		if not phase.begins_with("attack_"):
			actor.set_meta("combat_phase", "idle")
			actor.set_meta("combat_progress", 0.0)
		match phase:
			"turn": actor.rotation.y += 0.28
			"left_arm_hit": adapter.react_to_hit(actor, Vector3.FORWARD, 0.72, null, "arm_l")
			"head_hit": adapter.react_to_hit(actor, Vector3.FORWARD, 0.72, null, "head")
			"hop_land":
				actor.set_meta("skeleton_missing_leg_l", true)
				adapter.hide_part(actor, "leg_l")
			"attack_windup":
				actor.set_meta("combat_phase", "windup")
				actor.set_meta("combat_progress", 0.48)
			"attack_strike":
				actor.set_meta("combat_phase", "strike")
				actor.set_meta("combat_progress", 0.725)
			"attack_recovery":
				actor.set_meta("combat_phase", "recovery")
				actor.set_meta("combat_progress", 0.89)
			"restored":
				actor.remove_meta("skeleton_missing_leg_l")
				adapter.before_shatter(actor)
				adapter.after_restore(actor)

func _advance(game: Fixture, adapter, actors: Array[Node3D], frames: int, stride: float) -> void:
	for frame in range(frames):
		game.elapsed += 1.0 / 60.0
		if stride > 0.0:
			for actor in actors: actor.global_position.z += stride / float(frames)
		adapter.tick(1.0 / 60.0)

func _capture(view: SubViewport, camera: Camera3D, output: String, number: int,
		phase: String, view_name: String, game: Fixture, adapter, actors: Array[Node3D]) -> void:
	var center := Vector3(0, 1.1, 0)
	match view_name:
		"three_quarter": camera.global_position = Vector3(4.2, 2.3, 6.9)
		"side": camera.global_position = Vector3(7.2, 2.1, 0.6)
		"elevated": camera.global_position = Vector3(3.6, 5.5, 6.5)
	camera.fov = 49.0 if view_name == "three_quarter" else 54.0
	camera.look_at(center, Vector3.UP)
	for frame in range(3): await process_frame
	await RenderingServer.frame_post_draw
	var image := view.get_texture().get_image()
	var filename := "%02d-%s-%s.png" % [number, phase, view_name]
	var path := output.path_join(filename)
	var saved := image.save_png(path)
	if saved != OK or image.is_empty(): failures.append("capture failed: " + filename + " error=" + str(saved))
	var states := []
	for actor in actors:
		var entry: Dictionary = adapter.entries[actor.get_instance_id()]
		states.append({"variant": str(entry.guardian.variant), "clip": str(entry.active_clip),
			"progress": float(actor.get_meta("combat_progress", 0.0)),
			"missing_leg_l": bool(actor.get_meta("skeleton_missing_leg_l", false))})
	captures.append({"file": filename, "phase": phase, "view": view_name,
		"width": image.get_width(), "height": image.get_height(), "states": states})

func _capture_close(view: SubViewport, camera: Camera3D, output: String, number: int,
		phase: String, actor: Node3D, game: Fixture, adapter) -> void:
	var entry: Dictionary = adapter.entries[actor.get_instance_id()]
	var hidden: Array[Node3D] = []
	for other_entry in adapter.entries.values():
		var other: Node3D = other_entry.actor
		if other != actor and other.visible:
			other.visible = false
			hidden.append(other)
	var blade := phase == "attack_strike"
	var target := actor.global_position + Vector3.UP * (1.05 if blade else 0.46)
	camera.global_position = actor.global_position + (Vector3(2.6, 1.7, 2.65) if blade else Vector3(2.25, 1.03, 1.65))
	camera.fov = 40.0 if blade else 42.0
	camera.look_at(target, Vector3.UP)
	var guide_nodes: Array[Node3D] = []
	var geometry := {}
	if blade:
		var contact = Contact.new()
		var weapon: Dictionary = contact._weapon_segment(entry)
		if weapon.is_empty(): failures.append("weapon segment unavailable: " + str(entry.guardian.variant))
		else:
			geometry = {"weapon_from": _point(weapon.a), "weapon_to": _point(weapon.b),
				"source": "RightHand/WeaponTip sockets" if contact._socket(entry, "RightHand") != Vector3.INF and contact._socket(entry, "WeaponTip") != Vector3.INF else "RightArm mesh bind bounds"}
			guide_nodes.append(_guide_line(game, weapon.a, weapon.b, Color("27fff2"), 0.014))
			guide_nodes.append(_guide_point(game, weapon.a, Color("fbec66"), 0.036))
			guide_nodes.append(_guide_point(game, weapon.b, Color("ff6a37"), 0.044))
	else:
		var skeleton: Skeleton3D = entry.skeleton
		var foot := int(entry.bones.get("RightFoot", -1))
		if foot >= 0:
			var foot_world: Vector3 = skeleton.global_transform * skeleton.get_bone_global_pose(foot).origin
			var ground := Vector3(foot_world.x, _ground_y(foot_world.x), foot_world.z)
			geometry = {"support_foot": _point(foot_world), "ground": _point(ground),
				"sole_gap": foot_world.y - ground.y}
			guide_nodes.append(_guide_point(game, foot_world, Color("49e9fc"), 0.046))
			guide_nodes.append(_guide_point(game, ground, Color("ffc34b"), 0.039))
			guide_nodes.append(_guide_line(game, foot_world, ground, Color("ef9f6b"), 0.009))
	for frame in range(3): await process_frame
	await RenderingServer.frame_post_draw
	var image := view.get_texture().get_image()
	var filename := "%02d-%s-%s-detail.png" % [number, phase, str(entry.guardian.variant)]
	var saved := image.save_png(output.path_join(filename))
	if saved != OK or image.is_empty(): failures.append("detail capture failed: " + filename)
	captures.append({"file": filename, "phase": phase, "view": "blade_detail" if blade else "support_leg_detail",
		"variant": str(entry.guardian.variant), "width": image.get_width(), "height": image.get_height(),
		"geometry": geometry, "clip": str(entry.active_clip), "progress": float(actor.get_meta("combat_progress", 0.0))})
	for node in guide_nodes: node.queue_free()
	for other in hidden: other.visible = true

func _guide_line(game: Node3D, from: Vector3, to: Vector3, color: Color, radius: float) -> MeshInstance3D:
	var line := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = maxf(0.002, from.distance_to(to))
	line.mesh = mesh
	line.material_override = _guide_material(color)
	game.add_child(line)
	line.global_position = from.lerp(to, 0.5)
	if from.distance_squared_to(to) > 0.000001:
		line.global_basis = Basis(Quaternion(Vector3.UP, (to - from).normalized()))
	return line

func _guide_point(game: Node3D, point: Vector3, color: Color, radius: float) -> MeshInstance3D:
	var dot := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	dot.mesh = mesh
	dot.material_override = _guide_material(color)
	game.add_child(dot)
	dot.global_position = point
	return dot

func _guide_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.no_depth_test = true
	material.albedo_color = color
	return material

func _point(point: Vector3) -> Array[float]:
	return [snappedf(point.x, 0.0001), snappedf(point.y, 0.0001), snappedf(point.z, 0.0001)]

func _finish(output: String, started_ms: int, adapter, actors: Array[Node3D]) -> void:
	var manifest := {"source": "guardian_motion_review.gd", "assets": [],
		"captures": captures, "failures": failures, "simulation_frames_per_phase": 18,
		"simulation_step_seconds": 1.0 / 60.0,
		"capture_note": "Walking moves the gameplay roots; attack progress is held while transition settles. Guides show actual animated sockets and support-foot height.",
		"elapsed_seconds": float(Time.get_ticks_msec() - started_ms) / 1000.0}
	for variant in VARIANTS: manifest.assets.append(adapter.asset_dir.path_join(variant + "_rig.glb"))
	var path := output.path_join("manifest.json")
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null: failures.append("Could not write manifest")
	else:
		file.store_string(JSON.stringify(manifest, "  "))
		file.close()
	print("GUARDIAN_MOTION_REVIEW ", JSON.stringify({"output": output, "captures": captures.size(),
		"seconds": manifest.elapsed_seconds, "failures": failures}))
	for failure in failures: push_error(failure)
	quit(0 if failures.is_empty() else 1)

class Fixture extends Node3D:
	var animation = AnimationState.new()
	var guardians = GuardianState.new()
	var tuning = TuningState.new()
	var skeleton_pose_handoff = null
	var elapsed := 1.0
	func _ready() -> void:
		add_child(animation)
		add_child(guardians)
		add_child(tuning)

class AnimationState extends Node:
	var actors := {}

class GuardianState extends Node:
	var guardians := {}

class TuningState extends Node:
	func value(_key: String) -> float: return 1.0
