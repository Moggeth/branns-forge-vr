extends SceneTree

const Kit = preload("res://ground_kit.gd")
const Dressing = preload("res://orchard_dressing.gd")

func _initialize() -> void:
	var failures: Array[String] = []
	var model := {"size": 3, "step": 2.0, "origin": Vector2(-2,-2), "seed": 817,
		"water": PackedFloat32Array(), "slope": PackedFloat32Array(),
		"vegetation_suitability": PackedFloat32Array(),
		"shrub_suitability": PackedFloat32Array(), "rock_suitability": PackedFloat32Array()}
	for field in ["water", "slope", "vegetation_suitability", "shrub_suitability", "rock_suitability"]:
		var values := PackedFloat32Array()
		values.resize(9)
		values.fill(0.0 if field in ["water", "slope"] else 0.8)
		model[field] = values
	var center := Vector2.ZERO
	if Kit.field_chance(model, center, "grass") < 0.8: failures.append("healthy grass field rejected")
	if Kit.field_chance(model, center, "shrub") < 0.8: failures.append("healthy shrub field rejected")
	if Kit.field_chance(model, center, "rock") < 0.8: failures.append("healthy rock field rejected")
	var water: PackedFloat32Array = model.water
	water[4] = 0.3
	model.water = water
	for kind in ["grass", "shrub", "rock"]:
		if Kit.field_chance(model, center, kind) != 0.0: failures.append("water accepted " + kind)
	water[4] = 0.0
	model.water = water
	var slope: PackedFloat32Array = model.slope
	slope[4] = 0.8
	model.slope = slope
	if Kit.field_chance(model, center, "grass") != 0.0 or Kit.field_chance(model, center, "shrub") != 0.0:
		failures.append("steep vegetation accepted")
	if Kit.field_chance(model, center, "rock") <= 0.0: failures.append("steep rock rejected")
	var rocks: PackedFloat32Array = model.rock_suitability
	rocks[4] = 0.0
	model.rock_suitability = rocks
	if Kit.field_chance(model, center, "rock") != 0.0: failures.append("unsuitable rock accepted")
	if not Kit._allowed("orchard_highlands", Vector3(10,0,30), []): failures.append("ordinary site excluded")
	if Kit._allowed("orchard_highlands", Vector3(0,0,0), []): failures.append("trail exclusion lost")
	if Dressing._kind("fern_sword") != "fern" or Dressing._kind("rock_mossy_slab") != "rock": failures.append("dressing kind mapping")
	var authored_finishes := []
	for id in ["rock_mossy_boulder", "rock_mossy_slab", "branch_fallen_mossy", "fern_bank_patch"]:
		var asset: Dictionary = Dressing._asset(id)
		if asset.is_empty():
			failures.append("authored Orchard asset missing: " + id)
			continue
		if asset.mesh.get_surface_count() != 1: failures.append("unexpected mesh surfaces: " + id)
		var palette: Texture2D = asset.finish.get_shader_parameter("palette")
		if palette == null or palette.get_width() < 256: failures.append("authored texture missing: " + id)
		if asset.finish in authored_finishes: failures.append("texture atlas shared across distinct assets: " + id)
		authored_finishes.append(asset.finish)
	print("ORCHARD_DRESSING_FIELDS_RESULT ", failures)
	quit(0 if failures.is_empty() else 1)
