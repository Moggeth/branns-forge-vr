extends SceneTree
## Visual check: run windowed with --xr-mode off --audio-driver Dummy --resolution 960x540.
## Captures actual Vulkan mobile renders in ../logs/planet-preview-*.png.
## Artist handoff repair: orchard_planet_art.gd::_apply_sky_to_environment needed
## `var tree := get_tree()` before using tree.root (verified by first render).
## The artist's isolated overview PNG came from an earlier shader iteration and
## showed a hole; this harness verifies the promoted shader against a neutral
## material from the same camera, plus standing-height and event views.
const Fields = preload("res://orchard_planet_fields.gd")
const Terrain = preload("res://orchard_planet_terrain.gd")
const Art = preload("res://planet_art/orchard_planet_art.gd")

var stage := 0
var frame := 0
var fields
var terrain
var art
var camera: Camera3D
var planet_root: Node3D
var atmosphere: Node3D
var baseline: StandardMaterial3D
var output_dir := ""

func _initialize() -> void:
	output_dir = ProjectSettings.globalize_path("res://../logs")
	DirAccess.make_dir_recursive_absolute(output_dir)
	fields = Fields.new()
	fields.setup(229, 85.0)
	planet_root = Node3D.new()
	planet_root.position = Vector3(140, 25, -90)
	root.add_child(planet_root)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, 40, 0)
	sun.light_energy = 1.3
	root.add_child(sun)
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.02, 0.03, 0.08)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.55, 0.6, 0.75)
	environment.ambient_light_energy = 0.7
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	root.add_child(world_environment)
	camera = Camera3D.new()
	camera.far = 800.0
	camera.fov = 75
	root.add_child(camera)
	camera.current = true
	_overview_camera.call_deferred()
	terrain = Terrain.new()
	planet_root.add_child(terrain)
	terrain.setup(fields, camera)
	art = Art.new()
	planet_root.add_child(art)
	art.options["sky"] = false
	art.apply(planet_root, fields, terrain)
	baseline = StandardMaterial3D.new()
	baseline.albedo_color = Color(0.70, 0.75, 0.67)
	baseline.cull_mode = BaseMaterial3D.CULL_DISABLED
	baseline.roughness = 1.0
	for child in planet_root.get_children():
		if child is MeshInstance3D and child.name == "OrchardPlanetAtmosphere": atmosphere = child
	if atmosphere != null: atmosphere.hide()
	print("PLANET_ART_CHECK output=", output_dir)

func _overview_camera() -> void:
	camera.global_position = planet_root.global_position + Vector3(0, 40, 250)
	camera.look_at(planet_root.global_position, Vector3.UP)

func _ground_camera() -> void:
	var local_ground: Vector3 = fields.surface_point(Vector3(0.8, 0.25, 0.4).normalized())
	var up := local_ground.normalized()
	var sideways := up.cross(Vector3.RIGHT).normalized()
	var world_ground := planet_root.to_global(local_ground)
	camera.global_position = world_ground + up * 2.0
	camera.look_at(world_ground + sideways * 12.0 + up * 0.5, up)

func _capture(label: String) -> void:
	var image := root.get_texture().get_image()
	var path := output_dir.path_join("planet-preview-" + label + ".png")
	var error := image.save_png(path)
	print("PLANET_ART_CAPTURE ", label, " ", image.get_size(), " ", error, " ", path)

func _set_baseline(enabled: bool) -> void:
	for child in terrain.get_children():
		if child is MeshInstance3D: child.material_override = baseline if enabled else art.ground_material

func _process(delta: float) -> bool:
	if terrain == null or art == null:
		push_error("Planet art harness could not initialize; inspect the first script error above")
		quit(1)
		return false
	frame += 1
	terrain.tick(delta)
	art.tick(delta)
	if frame > 90 and frame <= 100: _set_baseline(true)
	match frame:
		90:
			print("PLANET_ART_TERRAIN ", JSON.stringify(terrain.statistics()))
			_capture("overview-art")
		100:
			_capture("overview-baseline")
			_set_baseline(false)
			if atmosphere != null: atmosphere.show()
			art._apply_sky_to_environment()
		115:
			_capture("overview-sky-art")
			_ground_camera()
		130:
			_capture("ground-art")
			var point := planet_root.to_global(fields.surface_point(Vector3.UP))
			var event_result: Dictionary = art.event("rupture", point, Vector3.UP, {"radius": 8.0})
			print("PLANET_ART_EVENT ", JSON.stringify(event_result))
			camera.global_position = point + Vector3.UP * 3.0 + Vector3.BACK * 9.0
			camera.look_at(point, Vector3.UP)
		160:
			_capture("event-art")
			quit(0)
	return false
