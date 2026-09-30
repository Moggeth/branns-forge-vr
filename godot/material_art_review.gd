extends SceneTree
## Offscreen native-GPU review of the installed Sonnet impact and target layers.
const Feedback = preload("res://impact_feedback.gd")
const TargetArt = preload("res://world_builder_targeting_art.gd")
const Specs = preload("res://world_builder_targeting.gd")
const Ground = preload("res://ground_surface_palette.gd")
class Field extends RefCounted:
	func height_at(p: Vector2) -> float: return sin(p.x * 0.04) * 2.0 + cos(p.y * 0.03) * 1.2
class Game extends Node3D:
	var landscape := Field.new()
	var diagnostic_offline := true
	var tuning = null
	var elapsed := 20.0
func _initialize() -> void: call_deferred("_run")
func _run() -> void:
	if DisplayServer.get_name() == "headless": quit(2); return
	create_timer(25.0).timeout.connect(func(): quit(2))
	root.unfocusable = true
	root.position = Vector2i(-12000,-12000)
	root.size = Vector2i(960,640)
	root.content_scale_size = Vector2i.ZERO
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	var began := Time.get_ticks_usec()
	var directory := ProjectSettings.globalize_path("res://../outputs/material-art-review")
	DirAccess.make_dir_recursive_absolute(directory)
	var game := Game.new()
	root.add_child(game)
	var world := WorldEnvironment.new()
	world.environment = Environment.new()
	world.environment.background_mode = Environment.BG_COLOR
	world.environment.background_color = Color("1c2831")
	world.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	world.environment.ambient_light_color = Color("a2b8c5")
	world.environment.ambient_light_energy = 0.55
	game.add_child(world)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48,-35,0)
	sun.light_energy = 1.7
	game.add_child(sun)
	var camera := Camera3D.new()
	game.add_child(camera)
	camera.current = true
	camera.fov = 45.0
	var target := MeshInstance3D.new()
	var slab := BoxMesh.new()
	slab.size = Vector3(2.8,1.6,0.4)
	target.mesh = slab
	target.position = Vector3(0,0.8,-0.2)
	game.add_child(target)
	var feedback := Feedback.new()
	game.add_child(feedback)
	feedback.setup(game)
	var failures: Array[String] = []
	for material in Feedback.MATERIALS:
		for pool in feedback.pools.values(): pool.particles.clear()
		for mark in feedback.marks: mark.node.queue_free()
		feedback.marks.clear()
		var finish := StandardMaterial3D.new()
		finish.albedo_color = {"stone":Color("68737b"),"wood":Color("785539"),"bone":Color("d6d0a7"),"metal":Color("637889"),"flesh":Color("bc755a"),"glass":Color("70a9b5")}[material]
		finish.roughness = 0.35 if material in ["metal","glass"] else 0.85
		finish.metallic = 0.7 if material == "metal" else 0.0
		target.material_override = finish
		game.elapsed += 0.2
		feedback.emit_contact({"target":target,"point":Vector3(0,0.95,0.015),"normal":Vector3.BACK,"material":material,"tool":"quarry_pick","strike_region":"pick_point","relative_velocity":Vector3.FORWARD*7.0,"energy":24.0})
		feedback.tick(0.025)
		camera.position = Vector3(1.5,1.4,2.8)
		camera.look_at(Vector3(0,0.85,0),Vector3.UP)
		await _save(directory.path_join("impact-"+material+".png"),failures)
	target.visible = false
	feedback.visible = false
	var terrain := MeshInstance3D.new()
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for iz in range(-35,35):
		for ix in range(-35,35):
			var a := Vector2(ix*2,iz*2)
			for corner in [a,a+Vector2(2,0),a+Vector2(2,2),a,a+Vector2(2,2),a+Vector2(0,2)]:
				surface.set_uv(corner*0.3)
				surface.add_vertex(Vector3(corner.x,game.landscape.height_at(corner),corner.y))
	surface.generate_normals()
	terrain.mesh = surface.commit()
	terrain.material_override = Ground.material("forge_yard")
	game.add_child(terrain)
	var target_art := TargetArt.new()
	game.add_child(target_art)
	target_art.setup(game)
	camera.position = Vector3(23,46,52)
	camera.look_at(Vector3.ZERO,Vector3.UP)
	for action in ["path","sunder","raise","forest","ring","meteor","patrol","bridge"]:
		var state := {"id":action,"valid":true,"hovered":Vector3.ZERO,"first_point":Vector3.INF,"footprint":Specs.spec(action)}
		if action in ["path","sunder","forest","bridge"]:
			state.first_point = Vector3(-24,0,-9)
			state.hovered = Vector3(24,0,9)
		if action in ["ring","forest"]:
			var positions: Array[Vector3] = []
			for i in 20:
				positions.append(Vector3(cos(i*TAU/20)*19.0,0,sin(i*TAU/20)*19.0) if action == "ring" else Vector3(-22+i*2.3,0,sin(i)*3.0))
			state.tree_positions = positions
		target_art.clear_preview()
		target_art.update_targeting(state)
		await _save(directory.path_join("target-"+action+".png"),failures)
	state_invalid(target_art)
	await _save(directory.path_join("target-invalid.png"),failures)
	print("MATERIAL_ART_REVIEW ",{"failures":failures,"wall_seconds":(Time.get_ticks_usec()-began)/1000000.0,"captures":15})
	quit(0 if failures.is_empty() else 1)
func state_invalid(art: Node3D) -> void:
	art.clear_preview()
	art.update_targeting({"id":"meteor","valid":false,"hovered":Vector3.ZERO,"footprint":Specs.spec("meteor")})
func _save(path: String, failures: Array[String]) -> void:
	for i in 4: await process_frame
	await RenderingServer.frame_post_draw
	if root.get_texture().get_image().save_png(path) != OK: failures.append("capture failed: "+path)
