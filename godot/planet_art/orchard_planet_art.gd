extends Node
## Visual art layer for the miniature orchard planet: ground/water/atmosphere/sky materials, bounded
## geometry events (cracks, dust, root growth) and the placement palette. No lights are created; at most
## the existing DirectionalLight3D is read for the sun direction. Everything is planet-local (never world Y).
##
##   var art := preload("res://planet_art/orchard_planet_art.gd").new()
##   planet.root.add_child(art)   # or any node
##   art.setup(planet)            # planet.root / fields / terrain / center / radius / game
##   # each frame, from the planet's tick: art.tick(delta)
##   art.event("rupture", world_point, world_up, {"radius": 7.0})
const ART_DIR := "res://planet_art/"
const MAX_EVENTS := 6
const EVENT_LIFETIME := {"rupture": 4.5, "bloom": 5.5, "root_growth": 6.5, "dust": 3.0, "uplift": 5.0}
const ATMOSPHERE_HEIGHT := 13.0

var planet: Object
var root: Node3D
var fields: RefCounted
var terrain: Node3D
var radius := 85.0
var options := {"sky": false, "atmosphere": true, "quality": 1, "assign_interval": 0.5}

var ground_material: ShaderMaterial
var water_material: ShaderMaterial
var atmosphere_material: ShaderMaterial
var event_material: ShaderMaterial
var sky_material: ShaderMaterial
var sky: Sky

var _tex := {}
var _atmosphere: MeshInstance3D
var _sun: DirectionalLight3D
var _events: Array[Dictionary] = []
var _assign_clock := 0.0
var _sky_up := Vector3.ZERO
var _sky_altitude := -1.0
var _dust_mesh: QuadMesh
var _palette: Dictionary = {}
var _rng := RandomNumberGenerator.new()

func setup(planet_runtime: Object) -> void:
	var r: Object = planet_runtime
	apply(r.root, r.fields, r.terrain, r)

## apply(root, fields, terrain): sets terrain.material, assigns every existing chunk MeshInstance3D and adds
## the atmosphere shell. Safe to call again after the terrain is rebuilt.
func apply(root_node: Node3D, planet_fields: RefCounted, planet_terrain: Node3D, planet_runtime: Object = null) -> void:
	planet = planet_runtime
	root = root_node
	fields = planet_fields
	terrain = planet_terrain
	if fields != null:
		radius = float(fields.radius)
	elif planet != null and planet.get("radius") != null:
		radius = float(planet.get("radius"))
	_rng.seed = 7741
	set_process(false)  # the integrator drives tick(delta)
	_build_materials()
	terrain.set("material", ground_material)
	assign_chunks()
	if bool(options["atmosphere"]):
		_build_atmosphere()
	if bool(options["sky"]):
		_apply_sky_to_environment()
	_find_sun()
	set_quality(int(options["quality"]))
	_sync_sun()

## 0 = VR-low (shorter micro-detail range), 1 = default, 2 = high.
func set_quality(level: int) -> void:
	options["quality"] = level
	var far: float = [38.0, 70.0, 110.0][clampi(level, 0, 2)]
	var near: float = [8.0, 14.0, 22.0][clampi(level, 0, 2)]
	ground_material.set_shader_parameter("detail_fade_far", far)
	ground_material.set_shader_parameter("detail_fade_near", near)
	ground_material.set_shader_parameter("normal_strength", [0.6, 0.85, 1.0][clampi(level, 0, 2)])
	water_material.set_shader_parameter("detail_fade_far", far + 20.0)

func palette() -> Dictionary:
	if _palette.is_empty():
		var f := FileAccess.open(ART_DIR + "orchard_planet_palette.json", FileAccess.READ)
		if f != null:
			var parsed: Variant = JSON.parse_string(f.get_as_text())
			if parsed is Dictionary:
				_palette = parsed
	return _palette

# ---------------------------------------------------------------- materials
func _texture(file: String) -> Texture2D:
	if _tex.has(file):
		return _tex[file]
	var path := ART_DIR + "textures/" + file
	var out: Texture2D = null
	var disk := ProjectSettings.globalize_path(path)
	if FileAccess.file_exists(disk):
		# Raw linear data: avoids import-time sRGB/compression surprises for these data textures.
		var img := Image.load_from_file(disk)
		if img != null:
			img.generate_mipmaps()
			out = ImageTexture.create_from_image(img)
	if out == null and ResourceLoader.exists(path):
		out = load(path)
	if out == null:
		push_warning("orchard_planet_art: missing texture " + path)
		var fallback := Image.create(4, 4, true, Image.FORMAT_RGBA8)
		fallback.fill(Color(0.5, 0.5, 1.0, 0.5))
		out = ImageTexture.create_from_image(fallback)
	_tex[file] = out
	return out

func _shader_material(file: String) -> ShaderMaterial:
	var mat := ShaderMaterial.new()
	mat.shader = load(ART_DIR + file) as Shader
	return mat

func _build_materials() -> void:
	ground_material = _shader_material("orchard_planet_ground.gdshader")
	ground_material.set_shader_parameter("detail_noise", _texture("planet_detail_noise.png"))
	ground_material.set_shader_parameter("detail_normal", _texture("planet_detail_normal.png"))
	ground_material.set_shader_parameter("sparkle_tex", _texture("planet_sparkle.png"))
	ground_material.set_shader_parameter("planet_radius", radius)
	water_material = _shader_material("orchard_planet_water.gdshader")
	water_material.set_shader_parameter("ripple_normal", _texture("planet_detail_normal.png"))
	water_material.set_shader_parameter("ripple_noise", _texture("planet_detail_noise.png"))
	atmosphere_material = _shader_material("orchard_planet_atmosphere.gdshader")
	event_material = _shader_material("orchard_planet_event.gdshader")
	event_material.set_shader_parameter("crack_noise", _texture("planet_detail_noise.png"))
	sky_material = _shader_material("orchard_planet_sky.gdshader")
	sky = Sky.new()
	sky.sky_material = sky_material
	sky.radiance_size = Sky.RADIANCE_SIZE_64
	sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL

## Assign the ground material to every existing chunk; the terrain re-applies terrain.material on rebuilds
## and material_override on the node survives mesh replacement. Also called from tick() at a low rate.
func assign_chunks() -> void:
	if terrain == null:
		return
	terrain.set("material", ground_material)
	for child in terrain.get_children():
		var mi := child as MeshInstance3D
		if mi != null and mi.material_override != ground_material:
			mi.material_override = ground_material
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

## Water for river/lake meshes owned by the integrator. Opaque, local-space, optional COLOR.r shore mask.
func make_water_material() -> ShaderMaterial:
	return water_material.duplicate() as ShaderMaterial

func _build_atmosphere() -> void:
	if is_instance_valid(_atmosphere):
		return
	var sphere := SphereMesh.new()
	var shell := radius + ATMOSPHERE_HEIGHT
	sphere.radius = shell
	sphere.height = shell * 2.0
	sphere.radial_segments = 40 if int(options["quality"]) < 2 else 64
	sphere.rings = 20 if int(options["quality"]) < 2 else 32
	_atmosphere = MeshInstance3D.new()
	_atmosphere.name = "OrchardPlanetAtmosphere"
	_atmosphere.mesh = sphere
	_atmosphere.material_override = atmosphere_material
	_atmosphere.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(_atmosphere)

func _apply_sky_to_environment() -> void:
	if not is_inside_tree():
		return
	var tree := get_tree()
	for node in tree.root.find_children("*", "WorldEnvironment", true, false):
		var env: Environment = (node as WorldEnvironment).environment
		if env != null:
			env.background_mode = Environment.BG_SKY
			env.sky = sky
			env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
			return

func _find_sun() -> void:
	_sun = null
	if not is_inside_tree():
		return
	var tree := get_tree()
	for node in tree.root.find_children("*", "DirectionalLight3D", true, false):
		var light := node as DirectionalLight3D
		if light != null and light.visible:
			_sun = light
			return

func _sun_direction() -> Vector3:
	if is_instance_valid(_sun):
		return _sun.global_basis.z.normalized()  # light shines along -Z, so the sun is toward +Z
	return Vector3(0.5, 0.7, 0.4).normalized()

func _sync_sun() -> void:
	var sun := _sun_direction()
	atmosphere_material.set_shader_parameter("sun_dir_world", sun)
	sky_material.set_shader_parameter("sun_dir", sun)

# ---------------------------------------------------------------- tick
func tick(delta: float) -> void:
	if root == null:
		return
	_assign_clock += delta
	if _assign_clock >= float(options["assign_interval"]):
		_assign_clock = 0.0
		assign_chunks()
		if _sun == null or not is_instance_valid(_sun):
			_find_sun()
		_sync_sun()
	_update_sky()
	_tick_events(delta)

func _update_sky() -> void:
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	if cam == null:
		return
	var local := root.to_local(cam.global_position)
	var dist := local.length()
	if dist < 0.001:
		return
	var up_local := local / dist
	var altitude := clampf((dist - radius) / (ATMOSPHERE_HEIGHT * 3.0), 0.0, 1.0)
	if _sky_up.dot(up_local) > 0.9997 and absf(altitude - _sky_altitude) < 0.02:
		return  # keep sky radiance updates rare
	_sky_up = up_local
	_sky_altitude = altitude
	sky_material.set_shader_parameter("planet_up", (root.global_basis * up_local).normalized())
	sky_material.set_shader_parameter("altitude01", altitude)

# ---------------------------------------------------------------- events
## kind: "rupture" | "uplift" | "bloom" | "root_growth" | "dust".
## worldpoint/up are WORLD space unless params.local == true (then planet-local). `up` may be ZERO: the
## radial direction is used. params: radius (m), color (Color), seed (int), duration (s), roots (int).
func event(kind: String, worldpoint: Vector3, up: Vector3, params: Dictionary = {}) -> Dictionary:
	if root == null or not EVENT_LIFETIME.has(kind):
		return {"ok": false, "error": "unknown kind or art not applied"}
	var local_point := worldpoint if bool(params.get("local", false)) else root.to_local(worldpoint)
	if local_point.length() < 0.001:
		return {"ok": false, "error": "point at planet centre"}
	var d := local_point.normalized()
	# `up` is advisory: ground-hugging geometry always follows the true radial; dust uses the supplied up.
	var up_local := d
	if up.length_squared() > 0.0001:
		var u := up.normalized()
		up_local = u if bool(params.get("local", false)) else (root.global_basis.inverse() * u).normalized()
	var size := clampf(float(params.get("radius", 6.0)), 1.5, 16.0)
	var seed_value := int(params.get("seed", _rng.randi()))
	var color: Color = params.get("color", Color(0.72, 0.45, 1.0) if kind != "root_growth" else Color(0.55, 0.95, 0.45))
	while _events.size() >= MAX_EVENTS:
		_free_event(_events[0])
		_events.remove_at(0)
	var ev := {"kind": kind, "age": 0.0, "life": float(params.get("duration", EVENT_LIFETIME[kind])), "nodes": []}
	var holder := Node3D.new()
	holder.name = "OrchardEvent_" + kind
	root.add_child(holder)
	ev["holder"] = holder
	if kind != "dust":
		var mesh_node := MeshInstance3D.new()
		mesh_node.mesh = _build_roots(d, size, seed_value) if kind == "root_growth" else _build_disc(d, size)
		mesh_node.material_override = event_material
		mesh_node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		holder.add_child(mesh_node)
		mesh_node.set_instance_shader_parameter("mode", 1.0 if kind == "root_growth" else 0.0)
		mesh_node.set_instance_shader_parameter("seed", float(seed_value % 97) / 97.0 * 4.0)
		mesh_node.set_instance_shader_parameter("tint", color)
		mesh_node.set_instance_shader_parameter("progress", 0.0)
		ev["mesh"] = mesh_node
	if kind != "root_growth":
		var dust := _make_dust(kind, size, color)
		var basis := _basis_from_up(up_local)
		var surface_point: Vector3 = fields.surface_point(d) if fields != null else d * radius
		dust.transform = Transform3D(basis, surface_point + up_local * 0.1)
		holder.add_child(dust)
		dust.emitting = true
		ev["dust"] = dust
	_events.append(ev)
	return {"ok": true, "kind": kind, "radius": size, "active_events": _events.size()}

func _basis_from_up(up_local: Vector3) -> Basis:
	var ref := Vector3.RIGHT if absf(up_local.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	var x := ref.cross(up_local).normalized()
	var z := x.cross(up_local).normalized()
	return Basis(x, up_local, z)

func _tangent_frame(d: Vector3) -> Array:
	var t := d.cross(Vector3.UP)
	if t.length_squared() < 0.01:
		t = d.cross(Vector3.RIGHT)
	t = t.normalized()
	return [t, d.cross(t).normalized()]

func _surface(d: Vector3, lift: float) -> Vector3:
	var dir := d.normalized()
	return (fields.surface_point(dir) if fields != null else dir * radius) + dir * lift

func _build_disc(d: Vector3, size: float) -> ArrayMesh:
	const RINGS := 9
	const SEGS := 30
	var frame := _tangent_frame(d)
	var t: Vector3 = frame[0]
	var b: Vector3 = frame[1]
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	for i in range(RINGS + 1):
		var rr := float(i) / RINGS
		for j in range(SEGS + 1):
			var a := float(j) / SEGS * TAU
			var dir := (d + (t * cos(a) + b * sin(a)) * (rr * size / radius)).normalized()
			verts.append(_surface(dir, 0.09))
			uvs.append(Vector2(float(j) / SEGS, rr))
	var indices := PackedInt32Array()
	for i in range(RINGS):
		for j in range(SEGS):
			var p := i * (SEGS + 1) + j
			indices.append_array(PackedInt32Array([p, p + SEGS + 1, p + 1, p + 1, p + SEGS + 1, p + SEGS + 2]))
	return _mesh_from(verts, uvs, indices)

func _build_roots(d: Vector3, size: float, seed_value: int) -> ArrayMesh:
	const STEPS := 16
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var frame := _tangent_frame(d)
	var t: Vector3 = frame[0]
	var b: Vector3 = frame[1]
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	var count := 6
	for k in range(count):
		var heading := float(k) / count * TAU + rng.randf_range(-0.3, 0.3)
		var pos := d
		var length := size * rng.randf_range(0.7, 1.0)
		var start := verts.size()
		for s in range(STEPS + 1):
			heading += rng.randf_range(-0.38, 0.38)
			var radial := pos.normalized()
			var fr := _tangent_frame(radial)
			var step_dir: Vector3 = (fr[0] as Vector3) * cos(heading) + (fr[1] as Vector3) * sin(heading)
			var along := float(s) / STEPS
			var forward := step_dir
			var side := radial.cross(forward).normalized()
			var width := lerpf(0.2, 0.04, along)
			var centre := _surface(pos, 0.1)
			verts.append(centre - side * width)
			verts.append(centre + side * width)
			uvs.append(Vector2(along, 0.0))
			uvs.append(Vector2(along, 1.0))
			pos = (pos + step_dir * (length / STEPS / radius)).normalized()
		for s in range(STEPS):
			var q := start + s * 2
			indices.append_array(PackedInt32Array([q, q + 1, q + 2, q + 1, q + 3, q + 2]))
	return _mesh_from(verts, uvs, indices)

func _mesh_from(verts: PackedVector3Array, uvs: PackedVector2Array, indices: PackedInt32Array) -> ArrayMesh:
	var normals := PackedVector3Array()
	for v in verts:
		normals.append(v.normalized())
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh

func _make_dust(kind: String, size: float, color: Color) -> GPUParticles3D:
	if _dust_mesh == null:
		_dust_mesh = QuadMesh.new()
		_dust_mesh.size = Vector2(0.9, 0.9)
		var tex := GradientTexture2D.new()
		tex.fill = GradientTexture2D.FILL_RADIAL
		tex.fill_from = Vector2(0.5, 0.5)
		tex.fill_to = Vector2(0.5, 0.0)
		var grad := Gradient.new()
		grad.set_color(0, Color(1, 1, 1, 0.8))
		grad.set_color(1, Color(1, 1, 1, 0.0))
		tex.gradient = grad
		tex.width = 64
		tex.height = 64
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		mat.vertex_color_use_as_albedo = true
		mat.albedo_texture = tex
		mat.no_depth_test = false
		_dust_mesh.material = mat
	var p := GPUParticles3D.new()
	p.amount = 26 if kind != "dust" else 18
	p.lifetime = 2.4
	p.one_shot = true
	p.explosiveness = 0.85
	p.local_coords = true
	p.draw_pass_1 = _dust_mesh
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-size, -1.0, -size), Vector3(size * 2.0, size, size * 2.0))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
	pm.emission_ring_axis = Vector3.UP
	pm.emission_ring_radius = size * 0.6
	pm.emission_ring_inner_radius = size * 0.1
	pm.emission_ring_height = 0.2
	pm.direction = Vector3.UP
	pm.spread = 55.0
	pm.initial_velocity_min = 0.6
	pm.initial_velocity_max = 2.2 if kind == "uplift" else 1.5
	pm.gravity = Vector3(0, -0.5, 0)
	pm.damping_min = 0.4
	pm.damping_max = 0.9
	pm.scale_min = 0.5
	pm.scale_max = 1.7
	var dust_color := Color(0.78, 0.62, 0.40, 0.55)
	if kind == "bloom" or kind == "rupture":
		dust_color = dust_color.lerp(color, 0.28)
	pm.color = dust_color
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0.0))
	fade.add_point(0.15, Color(1, 1, 1, 1.0))
	fade.set_color(1, Color(1, 1, 1, 0.0))
	var ramp := GradientTexture1D.new()
	ramp.gradient = fade
	pm.color_ramp = ramp
	p.process_material = pm
	return p

func _tick_events(delta: float) -> void:
	var i := _events.size() - 1
	while i >= 0:
		var ev: Dictionary = _events[i]
		ev["age"] = float(ev["age"]) + delta
		var progress := clampf(float(ev["age"]) / float(ev["life"]), 0.0, 1.0)
		if ev.has("mesh") and is_instance_valid(ev["mesh"]):
			(ev["mesh"] as GeometryInstance3D).set_instance_shader_parameter("progress", progress)
		if progress >= 1.0:
			_free_event(ev)
			_events.remove_at(i)
		i -= 1

func _free_event(ev: Dictionary) -> void:
	if ev.has("holder") and is_instance_valid(ev["holder"]):
		(ev["holder"] as Node).queue_free()

func active_event_count() -> int:
	return _events.size()
