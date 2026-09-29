extends RefCounted
## Deterministic, registered 2D fields for the Orchard. Coordinates are local X/Z metres.
## Fields are row-major: index = z * size + x. Height is metres above the old floor.

const RECIPES := {
	"gentle_orchard": {"broad": 2.3, "hills": 1.5, "ridges": 0.45, "detail": 0.22, "hill": 5.8, "valley": 2.5, "moisture": 0.22},
	"haunted_woodland": {"broad": 2.5, "hills": 2.3, "ridges": 0.9, "detail": 0.32, "hill": 6.8, "valley": 4.1, "moisture": 0.36},
	"highland": {"broad": 4.2, "hills": 3.2, "ridges": 2.1, "detail": 0.48, "hill": 9.5, "valley": 5.2, "moisture": 0.04},
	"arcane_scar": {"broad": 2.3, "hills": 1.7, "ridges": 1.1, "detail": 0.34, "hill": 6.0, "valley": 3.5, "moisture": 0.08},
}
## The game's authored work sites remain usable in every seed. The surrounding
## landform still varies; only the centres and their immediate approach relax.
const ORCHARD_SITES := [Vector2(-78,83), Vector2(-112,-40), Vector2(-25,-109), Vector2(82,-83), Vector2(73,93), Vector2(0,103)]


static func create(seed: int, recipe: String = "gentle_orchard", size: int = 161, step: float = 2.0) -> Dictionary:
	assert(size >= 3 and step > 0.0)
	assert(RECIPES.has(recipe), "Unknown landscape recipe: " + recipe)
	var p: Dictionary = RECIPES[recipe]
	var origin := Vector2.ONE * (-0.5 * float(size - 1) * step)
	var count := size * size
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var span := float(size - 1) * step
	var hill_center := origin + Vector2(span * rng.randf_range(0.16, 0.84), span * rng.randf_range(0.55, 0.88))
	var hill_radius := span * rng.randf_range(0.18, 0.25)
	var second_hill := origin + Vector2(span * rng.randf_range(0.12, 0.88), span * rng.randf_range(0.12, 0.34))
	var second_radius := span * rng.randf_range(0.14, 0.20)
	var valley_center_z := origin.y + span * rng.randf_range(0.20, 0.72)
	var valley_slant := rng.randf_range(-0.30, 0.30)
	var valley_phase := rng.randf_range(-100.0, 100.0)
	var valley_wavelength := rng.randf_range(0.011, 0.025)
	var landform := PackedFloat32Array()
	var regional := PackedFloat32Array()
	var detail := PackedFloat32Array()
	var base_height := PackedFloat32Array()
	var moisture := PackedFloat32Array()
	landform.resize(count)
	regional.resize(count)
	detail.resize(count)
	base_height.resize(count)
	moisture.resize(count)
	var broad := _noise(seed + 101, 0.0045, 3, 0.52, 0.0030, 14.0)
	var hills := _noise(seed + 211, 0.013, 3, 0.48, 0.010, 5.5)
	var ridge := _noise(seed + 307, 0.008, 2, 0.50, 0.005, 10.0)
	var small := _noise(seed + 401, 0.046, 2, 0.45, 0.022, 1.8)
	var wet := _noise(seed + 503, 0.006, 2, 0.52, 0.004, 9.0)
	for zi in range(size):
		var z := origin.y + float(zi) * step
		for xi in range(size):
			var x := origin.x + float(xi) * step
			var i := zi * size + xi
			var point := Vector2(x, z)
			var hill_distance := point.distance_to(hill_center)
			var hill_shape := pow(maxf(0.0, 1.0 - hill_distance / hill_radius), 2.0) * float(p.hill)
			var second_distance := point.distance_to(second_hill)
			hill_shape += pow(maxf(0.0, 1.0 - second_distance / second_radius), 2.0) * float(p.hill) * 0.42
			var valley_axis := valley_center_z + valley_slant * x + 12.0 * sin((x + valley_phase) * valley_wavelength) + 4.0 * sin(x * 0.055 + valley_phase * 0.021)
			var valley_shape := exp(-pow((z - valley_axis) / 25.0, 2.0)) * float(p.valley)
			var camp_weight := _smooth(22.0, 42.0, point.distance_to(Vector2(15.0, -27.0)))
			var crossing_weight := _smooth(7.0, 18.0, point.distance_to(Vector2(25.0, -48.0)))
			var protected_weight := minf(camp_weight, crossing_weight)
			for site in ORCHARD_SITES:
				protected_weight = minf(protected_weight, _smooth(7.0, 20.0, point.distance_to(site)))
			var broad_shape := broad.get_noise_2d(x, z) * float(p.broad)
			var hill_shape_noise := hills.get_noise_2d(x, z) * float(p.hills)
			var ridged_shape := pow(1.0 - absf(ridge.get_noise_2d(x, z)), 3.0) * float(p.ridges)
			var low_frequency := (broad_shape + hill_shape_noise) * protected_weight
			var structure := (ridged_shape + hill_shape - valley_shape) * protected_weight
			var fine := small.get_noise_2d(x, z) * float(p.detail) * protected_weight
			landform[i] = low_frequency
			regional[i] = structure
			detail[i] = fine
			base_height[i] = low_frequency + structure + fine
			var valley_wet := exp(-pow((z - valley_axis) / 35.0, 2.0)) * 0.42
			moisture[i] = clampf(0.40 + wet.get_noise_2d(x, z) * 0.27 + valley_wet + float(p.moisture), 0.0, 1.0)
	var model := {
		"size": size, "step": step, "origin": origin, "seed": seed, "recipe": recipe,
		"protected_sites": ORCHARD_SITES + [Vector2(15,-27)],
		"feature_controls": {"hill_center": hill_center, "hill_radius": hill_radius, "second_hill": second_hill, "second_radius": second_radius, "valley_center_z": valley_center_z, "valley_slant": valley_slant, "valley_phase": valley_phase, "valley_wavelength": valley_wavelength},
		"landform": landform, "regional": regional, "detail": detail, "base_height": base_height,
		"height": base_height.duplicate(), "moisture": moisture,
	}
	derive(model)
	return model


static func derive(model: Dictionary) -> void:
	## Recompute after the authoritative height array changes. Edge derivatives use one-sided samples.
	var size: int = model.size
	var step: float = model.step
	var height: PackedFloat32Array = model.height
	var slope := PackedFloat32Array()
	var curvature := PackedFloat32Array()
	var traversability := PackedFloat32Array()
	slope.resize(size * size)
	curvature.resize(size * size)
	traversability.resize(size * size)
	for z in range(size):
		var zm := maxi(z - 1, 0)
		var zp := mini(z + 1, size - 1)
		for x in range(size):
			var xm := maxi(x - 1, 0)
			var xp := mini(x + 1, size - 1)
			var i := z * size + x
			var dx := (height[z * size + xp] - height[z * size + xm]) / (float(xp - xm) * step)
			var dz := (height[zp * size + x] - height[zm * size + x]) / (float(zp - zm) * step)
			var grade := Vector2(dx, dz).length()
			slope[i] = grade
			curvature[i] = (height[z * size + xp] + height[z * size + xm] + height[zp * size + x] + height[zm * size + x] - 4.0 * height[i]) / (step * step)
			traversability[i] = 1.0 - _smooth(0.16, 0.65, grade)
	model["slope"] = slope
	model["curvature"] = curvature
	model["traversability"] = traversability


static func sample(model: Dictionary, field: String, local: Vector2) -> float:
	var values: PackedFloat32Array = model.get(field, PackedFloat32Array())
	if values.is_empty():
		return 0.0
	var size: int = model.size
	var step: float = model.step
	var origin: Vector2 = model.origin
	var gx := clampf((local.x - origin.x) / step, 0.0, float(size - 1))
	var gz := clampf((local.y - origin.y) / step, 0.0, float(size - 1))
	var x0 := floori(gx)
	var z0 := floori(gz)
	var x1 := mini(x0 + 1, size - 1)
	var z1 := mini(z0 + 1, size - 1)
	var a := lerpf(values[z0 * size + x0], values[z0 * size + x1], gx - float(x0))
	var b := lerpf(values[z1 * size + x0], values[z1 * size + x1], gx - float(x0))
	return lerpf(a, b, gz - float(z0))


static func index(model: Dictionary, x: int, z: int) -> int:
	return z * int(model.size) + x


static func _noise(seed: int, frequency: float, octaves: int, gain: float, warp_frequency: float, warp_amplitude: float) -> FastNoiseLite:
	var noise := FastNoiseLite.new()
	noise.seed = seed
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.frequency = frequency
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = octaves
	noise.fractal_gain = gain
	noise.domain_warp_enabled = true
	noise.domain_warp_frequency = warp_frequency
	noise.domain_warp_amplitude = warp_amplitude
	return noise


static func _smooth(edge0: float, edge1: float, value: float) -> float:
	var t := clampf((value - edge0) / (edge1 - edge0), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)
