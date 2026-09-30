extends SceneTree
## Offline native-renderer contact sheet of every implemented spatial target.
## Run graphically with --xr-mode off; no Main, service, user save or headset.
const Art = preload("res://world_builder_targeting_art.gd")
const Targeting = preload("res://world_builder_targeting.gd")
const Spells = preload("res://world_builder_spells.gd")
const CELL := Vector2i(400, 300)
const COLS := 4

class Field extends RefCounted:
	func height_at(p: Vector2) -> float: return sin(p.x * 0.04) * 0.8 + cos(p.y * 0.03) * 0.5

class Game extends Node3D:
	var landscape := Field.new()

func _initialize() -> void:
	create_timer(30.0).timeout.connect(func(): printerr("GROUND_PREVIEW_REVIEW timeout"); quit(2))
	call_deferred("_run")

func _run() -> void:
	if DisplayServer.get_name() == "headless": quit(2); return
	root.size = CELL
	root.unfocusable = true
	root.position = Vector2i(-12000, -12000)
	var game := Game.new()
	root.add_child(game)
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color("1b2630")
	game.add_child(environment)
	var floor := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(80, 80)
	floor.mesh = plane
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("33473d")
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	floor.material_override = mat
	floor.position.y = -1.0
	game.add_child(floor)
	var camera := Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 59.0
	camera.position = Vector3(0, 45, 11)
	game.add_child(camera)
	camera.look_at(Vector3.ZERO, Vector3.UP)
	camera.current = true
	var art := Art.new()
	game.add_child(art)
	art.setup(game)
	var caption := Label.new()
	caption.add_theme_font_size_override("font_size", 22)
	caption.add_theme_color_override("font_color", Color.WHITE)
	caption.position = Vector2(12, 8)
	root.add_child(caption)
	var actions: Array[String] = []
	for entry in Spells.catalogue():
		if bool(entry.get("implemented", true)) and str(entry.id) != "hire": actions.append(str(entry.id))
	var rows := ceili(float(actions.size()) / COLS)
	var sheet := Image.create_empty(CELL.x * COLS, CELL.y * rows, false, Image.FORMAT_RGBA8)
	sheet.fill(Color("1b2630"))
	for index in actions.size():
		var id := actions[index]
		var spec := Targeting.spec(id)
		camera.size = 59.0 if id == "ring" else (40.0 if str(spec.kind) in ["line", "deck"] or id == "raise" else (28.0 if id == "meteor" else 15.0))
		var state := {"id":id, "zone":"orchard_highlands", "valid":true,
			"hovered":Vector3(10, 0, 0) if str(spec.kind) in ["line", "deck"] else Vector3.ZERO,
			"first_point":Vector3(-10, 0, 0) if str(spec.kind) in ["line", "deck"] else Vector3.INF,
			"world_origin":Vector3.ZERO, "footprint":spec}
		art.update_targeting(state)
		caption.text = "%02d  %s" % [index + 1, id.replace("_", " ")]
		for frame in 2: await RenderingServer.frame_post_draw
		var image := root.get_texture().get_image()
		if image.get_size() != CELL:
			printerr("GROUND_PREVIEW_REVIEW wrong capture size: ", image.get_size())
			quit(1)
			return
		# Viewport readback is RGB8 on some renderers; blit_rect requires the
		# source and contact sheet to share an exact pixel format.
		image.convert(Image.FORMAT_RGBA8)
		sheet.blit_rect(image, Rect2i(Vector2i.ZERO, CELL), Vector2i(index % COLS * CELL.x, index / COLS * CELL.y))
	var output := ProjectSettings.globalize_path("res://../outputs/world-builder-ground-previews.png")
	var error := sheet.save_png(output)
	print("GROUND_PREVIEW_REVIEW ", JSON.stringify({"output":output,"actions":actions.size(),"size":sheet.get_size(),"error":error}))
	game.queue_free()
	quit(0 if error == OK else 1)
