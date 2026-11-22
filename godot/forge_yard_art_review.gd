extends SceneTree
## Compare actual native-game views with the current world, rigs, distance tiers and lights.

const LAYOUT_OUTPUT := "res://../outputs/forge-yard-review"

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview") or DisplayServer.get_name() == "headless":
		push_error("Forge Yard review needs graphical Godot with --world-builder-preview")
		quit(1)
		return
	call_deferred("_run")

func _run() -> void:
	var output := ProjectSettings.globalize_path(LAYOUT_OUTPUT)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--smithy-review-output="):
			output = arg.trim_prefix("--smithy-review-output=")
	DirAccess.make_dir_recursive_absolute(output)
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	for tick in 3: await physics_frame
	if not game.diagnostic_offline:
		push_error("Forge Yard review requires offline game state")
		quit(1)
		return
	await game.adventure.travel("forge_yard")
	game.state = JSON.parse_string(FileAccess.get_file_as_string("res://workshop_fixture.json"))
	for recipe in game.state.recipes:
		recipe.available = true
	game.collection.sync()
	game.rig.hide()
	game.player_avatar.hide()
	var view := SubViewport.new()
	view.size = Vector2i(1120, 700)
	view.world_3d = game.get_world_3d()
	view.msaa_3d = Viewport.MSAA_2X
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(view)
	var camera := Camera3D.new()
	view.add_child(camera)
	camera.current = true
	var frames := [
		["arrival", Vector3(0,1.67,2.0), Vector3(-0.2,1.25,-3.6), 72.0],
		["smithy", Vector3(5.8,2.1,5.8), Vector3(-1.1,1.9,-3.4), 69.0],
		["brann", Vector3(0.61,1.73,-2.19), Vector3(-0.02,1.56,-3.98), 35.0],
		["portal_approach", Vector3(0,2.45,-0.2), Vector3(0,1.51,11), 75.0],
		["side_garden", Vector3(3.8,1.68,3.8), Vector3(17.8,1.45,3.8), 68.0],
		["armory", Vector3(14.25,1.63,4.1), Vector3(21.2,1.30,3.65), 71.0],
		["armory_interior", Vector3(22.4,1.75,4.4), Vector3(18.25,1.18,1.96), 67.0],
		["overhead", Vector3(15.5,34,30), Vector3(5.4,0,0), 58.0],
	]
	for portal in game.scene.portals:
		if portal.get_meta("zone") == "forge_yard":
			frames.append([str(portal.get_meta("target_zone")), portal.to_global(Vector3(0.52,1.61,4.25)), portal.to_global(Vector3(0,1.44,0)), 53.0])
	for gate in game.adventure.zone_groups.forge_yard.get_children():
		if gate.get_meta("action","") in ["museum:enter","playful_encounter:enter"]:
			var title := "museum" if gate.get_meta("action") == "museum:enter" else "bellworks"
			frames.append([title,gate.to_global(Vector3(0.35,1.62,4.0)),gate.to_global(Vector3(0,1.55,0)),51.0])
	var stand: Node3D = game.collection.homes.quarry_pick.stand
	frames.append(["display",stand.to_global(Vector3(0.88,1.57,1.58)),stand.to_global(Vector3(-0.1,1.1,0)),53.0])
	frames.append(["hammer_strike", Vector3(-1.90,1.62,-1.9), Vector3(-0.32,1.39,-3.37), 49.0])
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--smithy-motion-output="):
			var motion_dir := arg.trim_prefix("--smithy-motion-output=")
			var captured := await _capture_motion(game,view,camera,frames,motion_dir)
			quit(0 if captured else 1)
			return
	var counts := {}
	var failures: Array[String] = []
	for frame in frames:
		camera.global_position = frame[1]
		camera.look_at(frame[2], Vector3.UP)
		camera.fov = frame[3]
		# Distance tiers and character gaze consult the actual gameplay camera.
		game.camera.global_transform = camera.global_transform
		for gate in game.scene.portals:
			var art = gate.get_node("PortalVisuals")
			art._process(0.25)
			if gate.get_meta("target_zone") == "sky_garden":
				art._mat_near.set_shader_parameter("storm_phase",0.64 if frame[0] == "sky_garden" else -1.0)
		if frame[0] == "hammer_strike":
			game.workshop_delivery.set_process(false)
			game.workshop_delivery.billet.show()
			game.workshop_delivery.working_pose(0)
			game.workshop_delivery.strike()
		for tick in 4: await process_frame
		await RenderingServer.frame_post_draw
		counts[frame[0]] = [view.get_render_info(Viewport.RENDER_INFO_TYPE_VISIBLE,Viewport.RENDER_INFO_DRAW_CALLS_IN_FRAME), view.get_render_info(Viewport.RENDER_INFO_TYPE_VISIBLE,Viewport.RENDER_INFO_PRIMITIVES_IN_FRAME)]
		if view.get_texture().get_image().save_png(output.path_join(str(frame[0]) + ".png")) != OK:
			failures.append(str(frame[0]))
	print("FORGE_YARD_ART_REVIEW ", JSON.stringify({"views": frames.size(), "failures": failures, "draw_calls_and_primitives":counts}))
	quit(0 if failures.is_empty() else 1)

## Use --fixed-fps 24 to record the same simulation cadence as the encoded clip.
func _capture_motion(game: Node3D, view: SubViewport, camera: Camera3D, views: Array, output: String) -> bool:
	if DirAccess.make_dir_recursive_absolute(output) != OK: return false
	view.size = Vector2i(896,560)
	var by_name := {}
	for frame in views: by_name[frame[0]] = frame
	var number := 0
	var strikes_before: int = game.workshop_delivery.strike_count
	for cut in [["smithy",42],["hammer_strike",71],["armory_interior",39],["sky_garden",108]]:
		var shot: Array = by_name[cut[0]]
		var base: Vector3 = shot[1]
		var aim: Vector3 = shot[2]
		camera.global_position = base
		camera.look_at(aim,Vector3.UP)
		camera.fov = shot[3]
		game.workshop_delivery.finishing = cut[0] == "hammer_strike"
		var sweep := camera.global_basis.x * (0.13 if cut[0] == "hammer_strike" else 0.35)
		for frame in int(cut[1]):
			var progress := float(frame) / maxf(1.0,cut[1] - 1.0)
			camera.global_position = base + sweep * (smoothstep(0.0,1.0,progress) - 0.5)
			camera.look_at(aim,Vector3.UP)
			game.camera.global_transform = camera.global_transform
			await process_frame
			await RenderingServer.frame_post_draw
			if view.get_texture().get_image().save_jpg(output.path_join("%04d.jpg" % number),0.92) != OK:
				return false
			number += 1
	game.workshop_delivery.finishing = false
	var strikes: int = game.workshop_delivery.strike_count - strikes_before
	print("SMITHY_MOTION_REVIEW ",JSON.stringify({"frames":number,"strikes":strikes}))
	return strikes >= 3
