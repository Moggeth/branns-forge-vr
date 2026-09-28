extends Node
## Bounded, world-anchored light shafts and brook mist for the Mobile renderer.
## Real geometry occludes them through depth; they follow the actual sun angle.
const ZONE := "orchard_highlands"
var game: Node3D
var art: Node3D
var beams: Array[MeshInstance3D] = []
var mist: Array[MeshInstance3D] = []
var beam_material: ShaderMaterial
var mist_material: ShaderMaterial
var quality := 1
static var _water_material: ShaderMaterial

func setup(owner: Node3D) -> void:
	game = owner
	for arg in OS.get_cmdline_user_args():
		if arg == "--atmosphere-quality=low": quality = 0
		elif arg == "--atmosphere-quality=high": quality = 2
	art = Node3D.new()
	art.name = "OrchardAtmosphericVolumes"
	game.scene.zones[ZONE].root.add_child(art)
	_build_beams()
	_build_mist()
	print("ORCHARD_ATMOSPHERE quality=", ["low", "balanced", "high"][quality], " shafts=", beams.size(), " mist=", mist.size())

func _build_beams() -> void:
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;
uniform float strength = 0.0;
uniform vec2 wind = vec2(0.9, 0.3);
varying vec2 beam_uv;
varying vec3 at;
void vertex() { beam_uv = UV; at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
    float radial = pow(max(0.0, 1.0 - abs(beam_uv.x * 2.0 - 1.0)), 2.4);
    float length_fade = smoothstep(0.0, 0.16, beam_uv.y) * (1.0 - smoothstep(0.79, 1.0, beam_uv.y));
    float dust = 0.84 + 0.10 * sin(at.y * 2.6 + TIME * 0.4 + at.x * 0.8) +
                 0.06 * sin(at.z * 3.1 - TIME * 0.6 + dot(wind, at.xz));
    ALBEDO = vec3(1.0, 0.80, 0.52);
    ALPHA = strength * radial * length_fade * dust;
}
"""
	beam_material = ShaderMaterial.new()
	beam_material.shader = shader
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for angle in [0.0, PI * 0.5]:
		var side := Vector3(cos(angle), 0.0, sin(angle)) * 0.68
		var vertices := [side + Vector3.UP * 0.0, -side + Vector3.UP * 0.0,
			-side + Vector3.DOWN * 6.0, side + Vector3.DOWN * 6.0]
		for index in [0, 1, 2, 0, 2, 3]:
			var uv: Vector2 = [Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)][index]
			surface.set_uv(uv)
			surface.add_vertex(vertices[index])
	var beam_mesh := surface.commit()
	beam_mesh.surface_set_material(0, beam_material)
	var fallbacks := [
		Vector3(-42, 0, 43), Vector3(-78, 0, 83), Vector3(-112, 0, -40),
		Vector3(73, 0, 93), Vector3(0, 0, 103), Vector3(82, 0, -83),
		Vector3(-25, 0, -109), Vector3(34, 0, -30),
		Vector3(-64, 0, -30), Vector3(103, 0, 18), Vector3(-18, 0, 67),
		Vector3(14, 0, -61)]
	var count: int = [4, 8, 12][quality]
	var places: Array[Vector3] = _tree_lit_positions(count, fallbacks)
	for i in range(count):
		var beam := MeshInstance3D.new()
		beam.name = "OrchardSunshaft_%02d" % i
		beam.mesh = beam_mesh
		beam.position = places[i] + Vector3(0, 6.0, 0)
		beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		beam.visibility_range_end = 70.0
		beam.visibility_range_end_margin = 9.0
		art.add_child(beam)
		beams.append(beam)

func _tree_lit_positions(count: int, fallbacks: Array) -> Array[Vector3]:
	# Anchor shafts at real crown gaps beside a walkable route. Depth testing
	# interrupts the shaft with trunks, foliage and ruins as the viewer moves.
	var positions: Array[Vector3] = []
	var root: Node3D = game.scene.zones[ZONE].root
	var trunks: Node3D = root.get_node_or_null("OrchardGroveTrunks")
	var trail: Array = root.get_meta("orchard_trail", [])
	if trunks != null:
		for child in trunks.get_children():
			if not child is CollisionShape3D: continue
			var point: Vector3 = child.position
			point.y = 0.0
			var near := false
			for i in range(trail.size() - 1):
				var a: Vector3 = trail[i]
				var b: Vector3 = trail[i + 1]
				var t := clampf((point - a).dot(b - a) / maxf((b - a).length_squared(), 0.001), 0.0, 1.0)
				var distance := point.distance_to(a.lerp(b, t))
				if distance > 4.0 and distance < 11.0: near = true; break
			if not near: continue
			if point.distance_to(Vector3(15, 0, -27)) < 13.0: continue
			var apart := true
			for chosen in positions:
				if chosen.distance_to(point) < 18.0: apart = false; break
			if not apart: continue
			positions.append(point + Vector3(1.8, 0, -1.2))
			if positions.size() >= count: break
	for fallback in fallbacks:
		if positions.size() >= count: break
		positions.append(fallback)
	return positions

func _build_mist() -> void:
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;
uniform float strength = 0.0;
uniform vec2 wind = vec2(0.9, 0.3);
varying vec2 at;
varying vec2 patch_uv;
void vertex() { at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz; patch_uv = UV; }
void fragment() {
    float edge = smoothstep(0.0, 0.20, patch_uv.x) * smoothstep(0.0, 0.20, patch_uv.y) *
                 smoothstep(0.0, 0.20, 1.0 - patch_uv.x) * smoothstep(0.0, 0.20, 1.0 - patch_uv.y);
    float drift = sin(at.x * 0.34 + at.y * 0.23 + TIME * 0.25 * wind.x);
    ALBEDO = vec3(0.70, 0.86, 0.83);
    ALPHA = strength * edge * (0.72 + 0.28 * drift);
}
"""
	mist_material = ShaderMaterial.new()
	mist_material.shader = shader
	var plane := PlaneMesh.new()
	plane.size = Vector2(20.0, 8.0)
	plane.material = mist_material
	for i in range([2, 5, 7][quality]):
		var x := -26.0 + float(i) * 17.0
		var drift := sin(x * 0.078) * 1.1 + sin(x * 0.18) * 0.25
		var patch := MeshInstance3D.new()
		patch.name = "WindfallMist_%02d" % i
		patch.mesh = plane
		patch.position = Vector3(x, 0.21 + float(i % 2) * 0.035, -48.0 + drift)
		patch.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		patch.visibility_range_end = 65.0
		art.add_child(patch)
		mist.append(patch)

func tick(hour: float, weather: String, wind: Vector2) -> void:
	if not is_instance_valid(art): return
	var daylight := clampf(sin((hour - 6.0) / 24.0 * TAU) * 2.0, 0.0, 1.0)
	var damp := 1.0 if weather == "rain" else (0.45 if weather == "snow" else 0.0)
	var low_sun := clampf(1.0 - absf(hour - 16.5) / 2.5, 0.0, 1.0) * daylight
	beam_material.set_shader_parameter("strength", (daylight * 0.14 + low_sun * 0.20) * (0.45 if damp > 0.5 else 1.0))
	beam_material.set_shader_parameter("wind", wind)
	mist_material.set_shader_parameter("strength", 0.065 + damp * 0.052)
	mist_material.set_shader_parameter("wind", wind)
	if _water_material != null: _water_material.set_shader_parameter("rain", damp)
	var sun: DirectionalLight3D = game.get_node_or_null("AdventureSun")
	var direction := -sun.global_basis.z.normalized()
	if direction.y > -0.12: direction = Vector3(0.4, -0.6, 0.2).normalized()
	var alignment := Quaternion(Vector3.DOWN, direction)
	var reach := clampf(6.0 / maxf(-direction.y, 0.32), 6.0, 15.0) / 6.0
	for beam in beams:
		beam.quaternion = alignment
		beam.scale.y = reach
		beam.visible = daylight > 0.12

static func water_material() -> ShaderMaterial:
	if _water_material != null: return _water_material
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;
uniform float rain = 0.0;
varying vec3 at;
varying vec2 brook_local;
varying vec4 source_tint;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void vertex() { at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; brook_local = VERTEX.xz; source_tint = COLOR; }
void fragment() {
    float wave = sin(at.x * 1.82 + TIME * 0.64) * sin(at.z * 3.1 - TIME * 0.78);
    vec2 cell = floor(at.xz * 1.4);
    float ring = fract(TIME * 1.6 + hash21(cell));
    float radius = length(fract(at.xz * 1.4) - vec2(0.5));
    float ripple = exp(-abs(radius - ring * 0.54) * 27.0) * rain;
    float drift = sin(brook_local.x * 0.078) * 1.1 + sin(brook_local.x * 0.18) * 0.25;
    float bank = smoothstep(1.52, 2.25, abs(brook_local.y + 48.0 - drift));
    float current = sin(brook_local.x * 2.8 - TIME * 1.15 + sin(brook_local.y * 2.2)) * 0.5 + 0.5;
    vec3 deep = vec3(0.025, 0.16, 0.18);
    vec3 shallow = vec3(0.08, 0.26, 0.23);
    vec3 water = mix(deep, shallow, bank * 0.62) + source_tint.rgb * 0.025;
    water += vec3(0.06, 0.10, 0.09) * current * (0.16 + wave * 0.09);
    float foam = bank * (0.04 + current * 0.06) + ripple * 0.12;
    ALBEDO = water + vec3(0.42, 0.50, 0.45) * foam;
    vec3 n = normalize(vec3(0.047 * cos(at.x * 1.82 + TIME * 0.64), 1.0,
                            0.058 * sin(at.z * 3.1 - TIME * 0.78)));
    NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
    ROUGHNESS = mix(0.32, 0.43, rain) + bank * 0.10 + wave * 0.025;
    SPECULAR = 0.54;
    METALLIC = 0.02;
}
"""
	_water_material = ShaderMaterial.new()
	_water_material.shader = shader
	return _water_material
