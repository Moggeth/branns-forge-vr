extends SceneTree

const Palette = preload("res://ground_surface_palette.gd")
const Kit = preload("res://ground_kit.gd")

func _initialize() -> void:
	var failures: Array[String] = []
	var shader: Shader = load("res://ground_surface_palette.gdshader")
	if shader == null: failures.append("surface shader missing")
	for id in Palette.FAMILY:
		var finish: ShaderMaterial = Palette.material(id)
		if finish == null or finish.shader != shader:
			failures.append("material missing: " + id)
			continue
		for uniform_name in ["base_albedo","accent_albedo","base_normal","base_orm","accent_orm"]:
			if not finish.get_shader_parameter(uniform_name) is Texture2D:
				failures.append("texture missing: " + id + "/" + uniform_name)
		var floor := MeshInstance3D.new()
		floor.mesh = BoxMesh.new()
		Palette.apply_floor(floor,id)
		if floor.material_override != finish: failures.append("floor finish missing: " + id)
		floor.free()
	if Palette.material("orchard_highlands") != null: failures.append("orchard shader replaced")
	Palette.weather(0.64,0.31)
	if not is_equal_approx(float(Palette.material("forge_yard").get_shader_parameter("rain_wetness")),0.64): failures.append("weather did not update")
	var model := {"size":3,"step":1.0,"origin":Vector2(-1,-1),"height":PackedFloat32Array([0,1,2,0,1,2,0,1,2])}
	var normal: Vector3 = Kit._surface_normal(model,Vector3.ZERO)
	if normal.x > -0.5 or normal.y < 0.5: failures.append("terrain normal alignment")
	var pose: Transform3D = Kit._surface_pose(model,Vector3.ZERO,"stone",1.0,0.0)
	if pose.basis.y.normalized().dot(normal) < 0.98: failures.append("stone does not follow terrain normal")
	if Kit._surface_normal({},Vector3.ZERO) != Vector3.UP: failures.append("flat terrain normal")
	print("GROUND_SURFACE_RESULT ",failures)
	quit(0 if failures.is_empty() else 1)
