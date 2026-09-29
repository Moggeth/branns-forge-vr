extends SceneTree
## Focused material/heightfield check; does not load or write a player save.
const Ground = preload("res://orchard_ground.gd")
const Fields = preload("res://landscape_fields.gd")
const Ops = preload("res://landscape_operations.gd")
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func check(ok: bool, label: String) -> void:
	if not ok: failures.append(label)

func _run() -> void:
	var mat: ShaderMaterial = Ground.material()
	var exposure: ImageTexture = mat.get_shader_parameter("exposure_tex")
	check(exposure != null and exposure.get_width() == 320 and exposure.get_height() == 320, "320 m exposure texture bound")
	check(Ground.exposure_sample(Vector2.ZERO).r == 0.0, "fresh exposure starts black")
	var model: Dictionary = Fields.create(290929)
	var sunder := {"type":"sunder", "points":[[-16.0, 0.0], [16.0, 0.0]], "width":8.0, "depth":4.2, "height":1.2, "shoulder":4.0, "seed":11}
	var before_model := model.duplicate(false)
	var after_model := model.duplicate(false)
	after_model["height"] = Ops.apply(model, [sunder])
	var painted: int = Ground.apply_exposure_delta(before_model, after_model, Ops.bounds(sunder), "sunder")
	var floor_colour: Color = Ground.exposure_sample(Vector2.ZERO)
	var rim_colour: Color = Ground.exposure_sample(Vector2(0, 4))
	check(painted > 0 and painted < 1200, "Sunder paints a bounded region")
	check(floor_colour.r > 0.9 and floor_colour.g > 0.7 and floor_colour.b < 0.05, "Sunder floor has fresh deep cut")
	check(rim_colour.r > 0.1 and rim_colour.b > 0.1, "Sunder rim has heaped soil")
	check(Ground.exposure_sample(Vector2(80, 80)).r == 0.0, "Distant texel remains black")
	var raise := {"type":"raise", "center":[70.0, 0.0], "radius":15.0, "height":3.6}
	var raised_model := after_model.duplicate(false)
	raised_model["height"] = Ops.apply(after_model, [raise])
	var raised: int = Ground.apply_exposure_delta(after_model, raised_model, Ops.bounds(raise), "raise")
	var heap_colour: Color = Ground.exposure_sample(Vector2(70, 0))
	check(raised > 0 and raised < 1100, "Raise paints a bounded region")
	check(heap_colour.r > 0.9 and heap_colour.b > 0.9 and heap_colour.g < 0.05, "Raise shows heaped soil")
	check(Ground.exposure_sample(Vector2.ZERO).g > 0.7, "Raise preserves earlier Sunder exposure")
	check(mat.get_shader_parameter("exposure_tex") == exposure, "Texture updates preserve shader binding")
	Ground.reset_exposure()
	check(Ground.exposure_sample(Vector2.ZERO).r == 0.0 and Ground.exposure_sample(Vector2(70, 0)).r == 0.0, "Reset clears exposure")
	print("ORCHARD_EXPOSURE_RESULT ", JSON.stringify({"failures":failures, "sunder_texels":painted, "raise_texels":raised}))
	quit(0 if failures.is_empty() else 1)
