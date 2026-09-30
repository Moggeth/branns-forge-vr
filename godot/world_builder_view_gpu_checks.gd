extends SceneTree
## Native offscreen, no-focus GPU capture of two cameras and one shared World3D.
## Creates no Main, game save, network service, or extra Hero renderer.

const View = preload("res://world_builder_view.gd")
const Pip = preload("res://world_builder_pip.gd")
const OUTPUT = "res://../outputs/world-builder-dual-view-gpu.png"
const SWAP_OUTPUT = "res://../outputs/world-builder-dual-view-swapped-gpu.png"

class GameFixture extends Node3D:
	var vr := false
	var desktop_look = null
	var diagnostic_offline := true

func _initialize() -> void:
	create_timer(30.0).timeout.connect(func() -> void:
		printerr("WORLD_BUILDER_DUAL_GPU timeout=30")
		quit(2))
	call_deferred("_capture")

func _capture() -> void:
	if DisplayServer.get_name() == "headless": quit(2); return
	root.unfocusable = true
	root.position = Vector2i(-12000, -12000)
	root.size = Vector2i(960, 600)
	root.content_scale_size = Vector2i.ZERO
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	var game := GameFixture.new()
	root.add_child(game)
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color("4c6974")
	environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.environment.ambient_light_color = Color.WHITE
	game.add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -35, 0)
	game.add_child(sun)
	var floor := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(40, 40)
	floor.mesh = plane
	var floor_skin := StandardMaterial3D.new()
	floor_skin.albedo_color = Color("57715a")
	floor.material_override = floor_skin
	game.add_child(floor)
	var landmark := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(2, 4, 2)
	landmark.mesh = box
	landmark.position = Vector3(0, 2, 0)
	var landmark_skin := StandardMaterial3D.new()
	landmark_skin.albedo_color = Color("f1b152")
	landmark.material_override = landmark_skin
	game.add_child(landmark)
	var hero_camera := Camera3D.new()
	game.add_child(hero_camera)
	hero_camera.position = Vector3(0, 2, 10)
	hero_camera.look_at(Vector3(0, 2, 0))
	hero_camera.current = true
	var view: Window = View.new()
	view.visible = false
	view.unfocusable = true
	view.position = Vector2i(-10900, -12000)
	view.size = Vector2i(960, 600)
	root.add_child(view)
	view.game = game
	view.companion_mode = true
	view.tactical_viewport = SubViewport.new()
	view.tactical_viewport.size = Vector2i(720, 450)
	view.tactical_viewport.world_3d = root.world_3d
	view.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	view.add_child(view.tactical_viewport)
	var survey_camera := Camera3D.new()
	view.tactical_viewport.add_child(survey_camera)
	survey_camera.position = Vector3(9, 17, 10)
	survey_camera.look_at(Vector3(0, 1, 0))
	survey_camera.current = true
	view.world_picture = TextureRect.new()
	view.world_picture.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	view.world_picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	view.world_picture.stretch_mode = TextureRect.STRETCH_SCALE
	view.add_child(view.world_picture)
	view.hero_pip = Pip.new()
	view.hero_pip.position = Vector2(532, 54)
	view.hero_pip.size = Vector2(410, 263)
	view.add_child(view.hero_pip)
	view.hero_pip.setup(game.get_viewport().get_texture())
	view._apply_primary_textures()
	view.visible = true
	await create_timer(0.8).timeout
	await RenderingServer.frame_post_draw
	var shot: Image = view.get_texture().get_image()
	var failures: Array[String] = []
	if shot.is_empty():
		print("WORLD_BUILDER_DUAL_GPU empty GPU readback")
		quit(1)
		return
	var sample_rts := shot.get_pixel(480, 340)
	var sample_hero := shot.get_pixel(735, 191)
	if sample_rts.r + sample_rts.g + sample_rts.b < 0.03: failures.append("RTS camera rendered black")
	if sample_hero.r + sample_hero.g + sample_hero.b < 0.03: failures.append("Hero inset rendered black")
	if view.tactical_viewport.world_3d != game.get_world_3d(): failures.append("different world")
	if view.hero_pip.picture.texture != game.get_viewport().get_texture(): failures.append("Hero texture copy")
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://../outputs"))
	if shot.save_png(OUTPUT) != OK: failures.append("PNG write")
	view.swap_primary()
	await create_timer(0.2).timeout
	await RenderingServer.frame_post_draw
	var swapped: Image = view.get_texture().get_image()
	if swapped.is_empty(): failures.append("swapped GPU readback")
	else:
		var primary_hero := swapped.get_pixel(480, 270)
		var inset_rts := swapped.get_pixel(735, 191)
		if primary_hero.r + primary_hero.g + primary_hero.b < 0.03: failures.append("swapped Hero primary rendered black")
		if inset_rts.r + inset_rts.g + inset_rts.b < 0.03: failures.append("swapped RTS inset rendered black")
		if swapped.save_png(SWAP_OUTPUT) != OK: failures.append("swapped PNG write")
	view.visible = false
	view.queue_free()
	await process_frame
	print("WORLD_BUILDER_DUAL_GPU ", JSON.stringify({"failures":failures, "rts":sample_rts, "hero":sample_hero, "capture":OUTPUT, "swapped":SWAP_OUTPUT}))
	quit(0 if failures.is_empty() else 1)
