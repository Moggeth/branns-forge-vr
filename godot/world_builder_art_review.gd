extends SceneTree
## Quick, deterministic native renderer review of the installed visual vocabulary.
## No Main, service, player saves, headset or live scene is involved.
const Trees = preload("res://tree_kit.gd")
const Ent = preload("res://world_builder_ent_presentation.gd")
const Construction = preload("res://world_builder_construction_presentation.gd")
var stage: Node3D
var camera: Camera3D
var output := "res://../outputs/worldbuilder-art"
var start := Time.get_ticks_usec()

class Ground extends Node:
	func height_at(_point: Vector2) -> float: return -1.9

func _initialize() -> void:
	create_timer(30.0).timeout.connect(func():
		printerr("WORLD_BUILDER_ART_RESULT timeout=30")
		quit(2))
	call_deferred("_run")

func _run() -> void:
	if DisplayServer.get_name() == "headless": quit(2); return
	root.size = Vector2i(1440,1000)
	root.content_scale_size = Vector2i.ZERO
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	root.unfocusable = true
	root.position = Vector2i(-12000,-12000)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	stage = Node3D.new()
	root.add_child(stage)
	var sampled_ground := Ground.new()
	stage.add_child(sampled_ground)
	var world := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("bacbbe")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("d3e2d0")
	environment.ambient_light_energy = 0.6
	world.environment = environment
	stage.add_child(world)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48,-25,0)
	sun.light_energy = 1.5
	sun.shadow_enabled = true
	stage.add_child(sun)
	camera = Camera3D.new()
	camera.current = true
	camera.fov = 56
	stage.add_child(camera)
	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(40,40)
	floor_mesh.mesh = plane
	var floor_skin := StandardMaterial3D.new()
	floor_skin.albedo_color = Color("718473")
	floor_skin.roughness = 1.0
	floor_mesh.material_override = floor_skin
	stage.add_child(floor_mesh)
	var tree := Trees.make_tree("apple",1001,{"height":5.0,"choppable":true})
	stage.add_child(tree)
	var art := Ent.new()
	tree.add_child(art)
	# Match the live enemy's -Z facing, including the trunk-to-art coordinate conversion.
	art.rotation.y = PI
	art.setup(tree,"apple",1.0,"healthy")
	var triangles := 0
	var draws := 0
	for child in art.find_children("*","MeshInstance3D",true,false):
		triangles += int(child.mesh.get_faces().size() / 3)
		draws += child.mesh.get_surface_count()
	print("WORLD_BUILDER_ENT_BUDGET triangles=",triangles," surfaces=",draws," particles=30")
	art.set_process(false)
	art.react({"phase":"restore"})
	art.update_motion(0,0.5)
	camera.position = Vector3(4.6,2.3,-8)
	camera.look_at(Vector3(0,2.1,0),Vector3.UP)
	await _save("apple-ent-ground.png")
	camera.position = Vector3(7,10,-10)
	camera.look_at(Vector3(0,1.8,0),Vector3.UP)
	await _save("apple-ent-strategic.png")
	art.react({"phase":"calm"})
	art.update_motion(0,1.0)
	camera.position = Vector3(1.6,1.7,-3.5)
	camera.look_at(Vector3(0,1.2,0),Vector3.UP)
	await _save("apple-ent-calm-close.png")
	art.react({"phase":"ignite"})
	art.update_motion(0,0.2)
	await _save("apple-ent-burning-close.png")
	tree.queue_free()
	await process_frame
	var record := {"kind":"bridge","a":[-7,1.9,0],"b":[7,2.3,0],"width":4.0}
	var built := Node3D.new()
	stage.add_child(built)
	built.position = Vector3(0,2.1,0)
	built.rotation.y = PI * 0.5
	Construction.render(record,built,sampled_ground)
	camera.position = Vector3(8,5.2,14)
	camera.look_at(Vector3(0,2.1,0),Vector3.UP)
	await _save("timber-bridge-ground.png")
	camera.position = Vector3(8,16,12)
	camera.look_at(Vector3(0,2.1,0),Vector3.UP)
	await _save("timber-bridge-strategic.png")
	built.queue_free()
	await process_frame
	built = Node3D.new()
	stage.add_child(built)
	built.position = Vector3(0,1.5,0)
	built.rotation.y = PI * 0.5
	record = {"kind":"stairs","a":[-4,0,0],"b":[4,3,0],"width":3.0}
	Construction.render(record,built,sampled_ground)
	camera.position = Vector3(9,5,10)
	camera.look_at(Vector3(0,1.5,0),Vector3.UP)
	await _save("timber-stairs.png")
	print("WORLD_BUILDER_ART_RESULT ",JSON.stringify({"failures":[],"seconds":(Time.get_ticks_usec()-start)/1000000.0}))
	quit()

func _save(filename: String) -> void:
	for frame in 3: await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	var result := image.save_png(output + "/" + filename)
	print("WORLD_BUILDER_ART_CAPTURE ",filename," result=",result)
	if result != OK: quit(2)
