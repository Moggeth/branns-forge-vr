extends Node3D
## Bounded precipitation around the viewer. Physics/terrain remain owned by the
## planet; this module only reads biome and the existing weather mode.
const RAIN_COUNT := 240
const SNOW_COUNT := 120

var game
var planet
var rain: GPUParticles3D
var snow: GPUParticles3D
var rain_process: ParticleProcessMaterial
var snow_process: ParticleProcessMaterial

func setup(source_game, source_planet) -> void:
	game = source_game
	planet = source_planet
	set_process(false)
	rain_process = ParticleProcessMaterial.new()
	rain_process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	rain_process.emission_box_extents = Vector3(8, 0.7, 8)
	rain_process.direction = Vector3.DOWN
	rain_process.spread = 5.0
	rain_process.initial_velocity_min = 9.0
	rain_process.initial_velocity_max = 13.0
	rain_process.gravity = Vector3.DOWN * 8.0
	rain_process.particle_flag_align_y = true
	rain_process.scale_min = 0.7
	rain_process.scale_max = 1.1
	rain_process.color = Color(0.74, 0.85, 1.0, 0.65)
	var streak := BoxMesh.new()
	streak.size = Vector3(0.012, 0.22, 0.012)
	var rain_mat := StandardMaterial3D.new()
	rain_mat.albedo_color = Color(0.69, 0.81, 1.0, 0.54)
	rain_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rain_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rain_mat.no_depth_test = false
	streak.material = rain_mat
	rain = _emitter("PlanetRain", RAIN_COUNT, 1.0, rain_process, streak)
	snow_process = ParticleProcessMaterial.new()
	snow_process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	snow_process.emission_box_extents = Vector3(8, 0.7, 8)
	snow_process.direction = Vector3.DOWN
	snow_process.spread = 30.0
	snow_process.initial_velocity_min = 0.5
	snow_process.initial_velocity_max = 1.2
	snow_process.gravity = Vector3.DOWN * 1.8
	snow_process.scale_min = 0.6
	snow_process.scale_max = 1.2
	snow_process.color = Color(0.95, 0.97, 1.0, 0.8)
	var flake := SphereMesh.new()
	flake.radius = 0.025
	flake.height = 0.05
	flake.radial_segments = 6
	flake.rings = 3
	var snow_mat := StandardMaterial3D.new()
	snow_mat.albedo_color = Color(0.91, 0.95, 1.0)
	snow_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	flake.material = snow_mat
	snow = _emitter("PlanetSnow", SNOW_COUNT, 5.0, snow_process, flake)

func _emitter(label: String, count: int, lifetime: float, process: ParticleProcessMaterial, mesh: Mesh) -> GPUParticles3D:
	var node := GPUParticles3D.new()
	node.name = label
	node.amount = count
	node.lifetime = lifetime
	node.explosiveness = 0.0
	node.local_coords = false
	node.process_material = process
	node.draw_pass_1 = mesh
	node.visibility_aabb = AABB(Vector3(-20, -22, -20), Vector3(40, 44, 40))
	node.emitting = false
	add_child(node)
	return node

func tick(_delta: float) -> void:
	if game == null or planet == null or game.adventure.zone != "orchard_planet":
		_hide()
		return
	var weather = game.get("weather")
	if weather == null or not weather.enabled or weather.engine == null:
		_hide()
		return
	var mode: String = str(weather.engine.weather)
	if mode not in ["rain", "snow"]:
		_hide()
		return
	var eye: Vector3 = game.camera.global_position
	var up: Vector3 = (eye - planet.center).normalized()
	var forward: Vector3 = (-game.camera.global_basis.z).slide(up).normalized()
	if forward.length_squared() < 0.01: forward = (-game.rig.global_basis.z).slide(up).normalized()
	var frame := Basis.looking_at(forward, up)
	var anchor := Transform3D(frame, eye + up * 5.0)
	rain.global_transform = anchor
	snow.global_transform = anchor
	var sample: Dictionary = planet.fields.sample(up)
	var weights: Dictionary = sample.get("weights", {})
	var highland: float = float(weights.get("alpine", 0.0)) + float(weights.get("highland", 0.0)) * 0.45
	var cold: float = clampf((0.45 - float(sample.get("temperature", 0.5))) * 2.0 + highland * 0.65, 0.0, 1.0)
	if mode == "snow": cold = maxf(cold, 0.9)
	# Particles live in world space so stepping and turning do not drag old drops;
	# their acceleration follows the current radial gravity direction.
	rain_process.gravity = -up * 8.0
	snow_process.gravity = -up * 1.8
	rain.amount_ratio = 1.0 - cold
	snow.amount_ratio = cold
	rain.emitting = rain.amount_ratio > 0.03
	snow.emitting = snow.amount_ratio > 0.03

func _hide() -> void:
	if is_instance_valid(rain): rain.emitting = false
	if is_instance_valid(snow): snow.emitting = false
