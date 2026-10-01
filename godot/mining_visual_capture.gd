extends SceneTree
## Offline native review of the installed meteor and natural Quarry deposits.
## Run with --world-builder-check; never opens a focusable or visible desktop window.
const Meteor = preload("res://landscape_meteor.gd")
const Damage = preload("res://mining_damage.gd")
const Adventure = preload("res://adventure_runtime.gd")
const Grips = preload("res://grip_runtime.gd")
const Pose = preload("res://desktop_weapon_pose.gd")

var failures: Array[String] = []
var output := "res://../outputs/mining-update"
var started := Time.get_ticks_usec()

func _initialize() -> void:
	create_timer(45.0).timeout.connect(func() -> void: printerr("MINING_VISUAL_CAPTURE timeout=45"); quit(2))
	call_deferred("_run")

func _run() -> void:
	if DisplayServer.get_name() == "headless" or not OS.get_cmdline_user_args().has("--world-builder-check"):
		printerr("MINING_VISUAL_CAPTURE needs native GPU and --world-builder-check")
		quit(2)
		return
	root.unfocusable = true
	root.position = Vector2i(-16000, -16000)
	root.size = Vector2i(1280, 800)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	_check(bool(game.diagnostic_offline), "Main entered isolated offline mode")
	var viewport := SubViewport.new()
	viewport.size = Vector2i(1280, 800)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.world_3d = game.get_world_3d()
	root.add_child(viewport)
	var camera := Camera3D.new()
	camera.fov = game.camera.fov
	viewport.add_child(camera)
	camera.current = true
	var hand := Node3D.new()
	camera.add_child(hand)
	hand.transform = Pose.idle(0.0, 0.0, 0.0)
	var adventure := Adventure.new()
	game.add_child(adventure)
	adventure.game = game
	var grips := Grips.new()
	game.add_child(grips)
	var pick: Node3D = adventure._tool_model("quarry_pick")
	hand.add_child(pick)
	pick.transform = grips._default_pose(pick, hand)
	# Meteor records and landscape operations use Orchard-local metres.
	var at := Vector2(15.0, -32.0)
	var source: Dictionary = Meteor.make_record(at, 421, game.landscape.height_at(at))
	source.id = "mining-capture-meteor"
	source.phase = "landed"
	var crater_result: String = game.landscape.apply_impact_magic(Meteor.crater_operation(source))
	_check(crater_result.is_empty(), "real crater terrain operation: " + crater_result)
	var bed: float = game.landscape.height_at(at)
	var shell_bottom: float = Meteor._rock_mesh().get_aabb().position.y + 0.65
	source.ground_y = bed - shell_bottom - 0.12
	game.world_builder.data.meteors.append(source)
	game.world_builder._render_meteor(source, false)
	var meteor: Node3D = game.world_builder.meteor_nodes[source.id]
	# Streaming uses the Hero rig even when the review camera is elsewhere.
	game.rig.global_position = meteor.global_position + Vector3(0.0, 0.0, 4.0)
	game.rig.visible = false
	game.world_builder.meteor_refresh_remaining = 1000000.0
	for i in 4: await physics_frame
	var target: Vector3 = meteor.core.global_position
	var eye := target + Vector3(0.0, 0.85, 4.25)
	var ray := PhysicsRayQueryParameters3D.create(eye, target)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	_check(hit.get("collider") == meteor.collider, "pick aims at rendered meteor triangle")
	if hit.get("collider") == meteor.collider:
		await _pair(viewport, camera, pick, target, eye, "meteor-before")
		var first: Dictionary = meteor.strike(hit.position, "quarry_pick", 2.4, hit.normal, {"strike_region":"pick_point", "incidence":1.0})
		_check(bool(first.get("ok",false)) and not bool(first.get("extracted",false)), "first meteor chip staged")
		await _pair(viewport, camera, pick, target, eye, "meteor-first-hit")
		var exposed := false
		var extracted := false
		for i in 8:
			var step: Dictionary = meteor.strike(hit.position, "quarry_pick", 2.4, hit.normal, {"strike_region":"pick_point", "incidence":1.0})
			if not bool(step.get("ok",false)):
				failures.append("meteor stage rejected: " + str(step.get("reason","")))
				break
			if not exposed and str(step.get("damage_result","")) == "exposed":
				exposed = true
				await _pair(viewport, camera, pick, target, eye, "meteor-exposed")
			if bool(step.get("extracted",false)):
				extracted = true
				var reward := {"id":"capture:"+str(step.reward_id), "kind":str(step.kind), "units":1}
				var chunk: Node3D = game.mining.pickups.spawn(reward, hit.position, hit.normal)
				_check(chunk != null, "real physical chunk spawned after extraction")
				for frame in 12: await physics_frame
				await _pair(viewport, camera, pick, target, eye, "meteor-extracted")
				break
		_check(exposed and extracted, "meteor reached exposed and extracted stages")
	await game.adventure.travel("sandstone_quarry")
	for i in 5: await physics_frame
	var deposits: Array = game.mining.deposits.natural
	_check(not deposits.is_empty(), "natural Quarry deposits generated")
	if not deposits.is_empty():
		var natural: Node3D = null
		for candidate in deposits:
			if str(candidate.get_meta("zone", "")) == "sandstone_quarry": natural = candidate; break
		_check(natural != null, "natural Quarry deposit selected")
		if natural != null:
			var focus := natural.global_position + Vector3.UP * 0.58
			await _pair(viewport, camera, pick, focus, focus + Vector3(0.0, 0.85, 2.8), "natural-quarry")
	var metrics := _profile(game)
	print("MINING_VISUAL_CAPTURE ", JSON.stringify({"failures":failures,"output":ProjectSettings.globalize_path(output),"metrics":metrics,"seconds":(Time.get_ticks_usec()-started)/1000000.0}))
	game.queue_free()
	quit(0 if failures.is_empty() else 1)

func _pair(viewport: SubViewport, camera: Camera3D, pick: Node3D, focus: Vector3, eye: Vector3, label: String) -> void:
	pick.visible = true
	camera.global_position = eye
	camera.look_at(focus)
	await _save(viewport, label + "-fps")
	pick.visible = false
	camera.global_position = focus + Vector3(6.0, 9.0, 7.0)
	camera.look_at(focus)
	await _save(viewport, label + "-rts")

func _save(viewport: SubViewport, label: String) -> void:
	for i in 3: await process_frame
	await RenderingServer.frame_post_draw
	var picture: Image = viewport.get_texture().get_image()
	_check(not picture.is_empty() and picture.get_size() == Vector2i(1280,800), label + " native pixels")
	if not picture.is_empty():
		_check(picture.save_png(ProjectSettings.globalize_path(output.path_join(label + ".png"))) == OK, label + " saved")

func _profile(game: Node3D) -> Dictionary:
	var sites: Array = []
	var began := Time.get_ticks_usec()
	var accepted := 0
	for i in 1000:
		var result: Dictionary = Damage.apply(sites, Vector3(0.1,0.3,0.7), "meteor", 2.4, {"strike_region":"pick_point","incidence":1.0})
		if bool(result.accepted): accepted += 1
		sites = result.sites
	var damage_us := Time.get_ticks_usec()-began
	var pickups: Node3D = game.mining.pickups
	for i in 16:
		pickups.spawn({"id":"capture-profile-%02d"%i,"kind":"stone","units":1},game.camera.global_position+Vector3(i*0.3,0,0),Vector3.UP)
	for i in 8: pickups.tick(0.016)
	began = Time.get_ticks_usec()
	for i in 1000: pickups.tick(0.016)
	var pending_us := Time.get_ticks_usec()-began
	return {"staged_apply_1000_ms":snappedf(float(damage_us)/1000.0,0.001),"accepted":accepted,
		"pickup_tick_16x1000_ms":snappedf(float(pending_us)/1000.0,0.001),"pending":pickups.pending_count()}

func _check(condition: bool, label: String) -> void:
	if not condition: failures.append(label)
