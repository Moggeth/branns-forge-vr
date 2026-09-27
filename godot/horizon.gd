extends RefCounted
## Brann's Forge VR - distant horizon generator (Godot 4.7, Mobile renderer).
##
## build(zone_id, parent, profile) adds one Node3D containing ONE MeshInstance3D
## with ONE surface and ONE ShaderMaterial: a ground apron (or cloud sea), two or
## three concentric terrain bands and low-poly silhouette props (trees, mesas,
## crystals, islands, chimneys...). Everything is static in the zone's local space
## (no camera following), opaque, unshaded, fog-disabled, shadow-free and without
## collision. Depth reads come from band spacing, per-band haze and occlusion.
##
## Colours: every layer's low/high/feature colours come from ZONES and may be
## overridden per call through `profile` (see resolve_profile()).
## Tint: tint(), set_time_of_day() and sync_to_environment().

const EYE_HEIGHT := 1.8

# Environment table mirrors world_zones.gd so haze matches the fogged sky.
const ZONES := {
	"orchard_highlands": {
		"haze": "e6cba6", "haze_density": 0.0008, "mist_top": 0.0, "mist_depth": 34.0, "mist_max": 0.75,
		"light": "fff0d4", "shade": "a59cc0", "inner_radius": 26.0,
		"ground_style": "grass", "ground_inner": "93a861", "ground_outer": "a8aa6a", "ground_y": -0.3, "ground_amp": 1.2,
		"layers": [
			{"name": "near", "style": "rolling", "r": [170.0, 230.0], "h": [12.0, 32.0], "base": -7.0, "seg": 144,
				"low": "587d33", "high": "a4b74f",
				"features": [
					{"kind": "round_tree", "count": 26, "cluster": 3, "size": [5.5, 8.5], "t": [0.55, 0.98], "low": "3b6127", "high": "86a83e"},
					{"kind": "round_tree", "count": 10, "cluster": 1, "size": [6.0, 8.0], "t": [0.2, 0.5], "low": "557631", "high": "a2bd4e"}]},
			{"name": "mid", "style": "rolling", "r": [340.0, 430.0], "h": [30.0, 72.0], "base": -26.0, "seg": 112,
				"low": "65876f", "high": "9db38c",
				"features": [
					{"kind": "round_tree", "count": 18, "cluster": 2, "size": [8.0, 12.0], "t": [0.7, 0.98], "low": "567a5a", "high": "8fa874"},
					{"kind": "windmill", "count": 2, "size": [11.0, 13.0], "t": [0.96, 0.99], "low": "cdbf9f", "high": "efe4c8"}]},
			{"name": "far", "style": "peaks", "peaks": 9, "peak_width": [0.2, 0.5], "peak_curve": 0.95, "r": [690.0, 770.0],
				"h": [60.0, 190.0], "base": -80.0, "seg": 108, "low": "8187ae", "high": "aeaccb", "snow": "f7f0e6", "snow_line": 0.78}]},

	"sandstone_quarry": {
		"haze": "adc5d8", "haze_density": 0.0006, "mist_top": 0.0, "mist_depth": 34.0, "mist_max": 0.3,
		"light": "fff0d8", "shade": "a58a9c", "inner_radius": 14.0,
		"ground_style": "grass", "ground_inner": "cfa272", "ground_outer": "c79a70", "ground_y": -0.3, "ground_amp": 1.0,
		"layers": [
			{"name": "near", "style": "mesa", "r": [165.0, 215.0], "h": [6.0, 34.0], "base": -7.0, "seg": 144,
				"low": "93502f", "high": "d98f55", "strata": "ecb97c", "strata_h": 5.0, "faceted": true,
				"features": [{"kind": "hoodoo", "count": 14, "cluster": 2, "size": [4.0, 6.5], "t": [0.08, 0.3], "low": "a45f3a", "high": "e2a468"}]},
			{"name": "mid", "style": "mesa", "r": [330.0, 420.0], "h": [18.0, 62.0], "base": -24.0, "seg": 112,
				"low": "b06a47", "high": "e3aa76", "strata": "f0c99a", "strata_h": 9.0, "faceted": true},
			{"name": "far", "style": "peaks", "peaks": 7, "peak_width": [0.25, 0.6], "peak_curve": 0.8, "r": [690.0, 770.0],
				"h": [35.0, 110.0], "base": -80.0, "seg": 96, "low": "a896a4", "high": "d2c2c4"}]},

	"pinewood_ruins": {
		"haze": "adc5d8", "haze_density": 0.0012, "mist_top": 0.0, "mist_depth": 34.0, "mist_max": 0.75,
		"light": "fff4dc", "shade": "8e9cc0", "inner_radius": 14.0,
		"ground_style": "grass", "ground_inner": "7f955a", "ground_outer": "6f8a55", "ground_y": -0.3, "ground_amp": 1.2,
		"layers": [
			{"name": "near", "style": "rolling", "r": [165.0, 225.0], "h": [10.0, 26.0], "base": -7.0, "seg": 144,
				"low": "587638", "high": "8aa255",
				"features": [
					{"kind": "pine", "count": 36, "cluster": 3, "size": [5.0, 8.0], "t": [0.45, 0.99], "low": "284f35", "high": "4f7f47"},
					{"kind": "ruin", "count": 3, "size": [5.0, 7.0], "t": [0.9, 0.98], "low": "858a88", "high": "b9bab0"}]},
			{"name": "mid", "style": "rolling", "r": [330.0, 420.0], "h": [26.0, 60.0], "base": -26.0, "seg": 112,
				"low": "56785c", "high": "86a07c",
				"features": [{"kind": "pine", "count": 34, "cluster": 2, "size": [7.0, 10.0], "t": [0.75, 0.99], "low": "42664f", "high": "688a68"}]},
			{"name": "far", "style": "peaks", "peaks": 10, "peak_width": [0.15, 0.4], "peak_curve": 1.15, "r": [680.0, 760.0],
				"h": [50.0, 170.0], "base": -80.0, "seg": 120, "low": "7b8cae", "high": "a9b6cf", "snow": "eef3f6", "snow_line": 0.72}]},

	"gloamfen": {
		"haze": "426962", "haze_density": 0.0024, "mist_top": 2.0, "mist_depth": 22.0, "mist_max": 0.85,
		"light": "bfe4d2", "shade": "62808a", "inner_radius": 26.0,
		"ground_style": "grass", "ground_inner": "506e63", "ground_outer": "3f5f58", "ground_y": -0.3, "ground_amp": 0.6,
		"layers": [
			{"name": "near", "style": "low", "r": [150.0, 205.0], "h": [3.0, 11.0], "base": -5.0, "seg": 128,
				"low": "2e4a44", "high": "557564",
				"features": [
					{"kind": "willow", "count": 20, "cluster": 2, "size": [5.0, 8.0], "t": [0.35, 0.98], "low": "27463d", "high": "5a8067"},
					{"kind": "snag", "count": 16, "cluster": 1, "size": [4.0, 7.0], "t": [0.3, 0.95], "low": "343a37", "high": "5e5f53"},
					{"kind": "lamp", "count": 7, "size": [1.6, 2.2], "t": [0.15, 0.5], "low": "b8f5cf", "high": "e8fff0", "emit": 1.0}]},
			{"name": "mid", "style": "rolling", "r": [310.0, 400.0], "h": [12.0, 30.0], "base": -22.0, "seg": 112,
				"low": "2f4c4a", "high": "4c6c66",
				"features": [{"kind": "pine", "count": 30, "cluster": 3, "size": [6.0, 9.0], "t": [0.7, 0.99], "low": "213c38", "high": "3c5b51"}]},
			{"name": "far", "style": "jagged", "peaks": 16, "peak_width": [0.06, 0.18], "peak_curve": 1.3, "jag": 0.08,
				"r": [640.0, 720.0], "h": [30.0, 120.0], "base": -70.0, "seg": 128, "low": "2d4356", "high": "4d6479"}]},

	"starfall_ridge": {
		"haze": "8492b7", "haze_density": 0.0015, "mist_top": 0.0, "mist_depth": 34.0, "mist_max": 0.75,
		"light": "e2ecff", "shade": "5c628e", "inner_radius": 26.0,
		"ground_style": "grass", "ground_inner": "6d7793", "ground_outer": "626b88", "ground_y": -0.3, "ground_amp": 1.4,
		"layers": [
			{"name": "near", "style": "jagged", "peaks": 22, "peak_width": [0.05, 0.14], "peak_curve": 1.2, "jag": 0.1,
				"r": [160.0, 215.0], "h": [8.0, 36.0], "base": -7.0, "seg": 160, "low": "4a506c", "high": "7c83a6",
				"features": [
					{"kind": "crystal", "count": 18, "cluster": 3, "size": [3.0, 6.0], "t": [0.5, 0.98], "low": "5fb9dc", "high": "c8f4ff", "emit": 0.45},
					{"kind": "crystal", "count": 8, "cluster": 2, "size": [3.0, 5.0], "t": [0.4, 0.95], "low": "9a6cc0", "high": "e7b8f5", "emit": 0.45}]},
			{"name": "mid", "style": "peaks", "peaks": 12, "peak_width": [0.1, 0.3], "peak_curve": 1.2, "r": [330.0, 420.0],
				"h": [30.0, 90.0], "base": -26.0, "seg": 128, "low": "56628c", "high": "8d9bc6",
				"features": [{"kind": "crystal", "count": 5, "size": [12.0, 18.0], "t": [0.85, 0.97], "low": "74cdea", "high": "d8f8ff", "emit": 0.55}]},
			{"name": "far", "style": "peaks", "peaks": 11, "peak_width": [0.1, 0.32], "peak_curve": 1.3, "r": [690.0, 770.0],
				"h": [70.0, 200.0], "base": -90.0, "seg": 128, "low": "7584b2", "high": "a7b3d9", "snow": "e9f0ff", "snow_line": 0.68}]},

	"cloudbreak_keep": {
		"haze": "bbd7e4", "haze_density": 0.0011, "mist_top": -22.0, "mist_depth": 150.0, "mist_max": 0.6,
		"light": "fffcf2", "shade": "9fb7d4", "inner_radius": 0.0,
		"ground_style": "cloud", "cloud_y": -40.0, "ground_amp": 3.0, "ground_inner": "9fb9cd", "ground_outer": "eef2f2",
		"sea_puffs": {"kind": "cloud", "count": 26, "r": [70.0, 210.0], "size": [7.0, 15.0], "low": "b0c7d8", "high": "fbfcf8"},
		"layers": [
			{"name": "near", "style": "clouds", "lobes": 26, "r": [230.0, 300.0], "h": [-24.0, -6.0], "base": -44.0, "seg": 156,
				"low": "b3cadb", "high": "eef3f3", "smooth": true, "jitter": 0.015,
				"features": [{"kind": "cloud", "count": 34, "cluster": 2, "size": [11.0, 22.0], "t": [0.7, 1.0], "low": "b9cfdf", "high": "fffdf6"}]},
			{"name": "mid", "style": "islands", "count": 16, "r": [150.0, 430.0], "y": [-12.0, 80.0], "size": [11.0, 34.0],
				"grass": "a8c77c", "grass_dark": "7fa062", "rock_high": "a9b5bd", "rock_low": "6f7c8e", "tree_low": "3f6b4b", "tree_high": "7ba466",
				"keep_walls": "dfe2d6", "keep_roof": "3f8290"},
			{"name": "far", "style": "peaks", "peaks": 10, "peak_width": [0.1, 0.3], "peak_curve": 1.2, "r": [700.0, 780.0],
				"h": [10.0, 150.0], "base": -160.0, "seg": 120, "low": "93a9c0", "high": "c7d6e2", "snow": "ffffff", "snow_line": 0.62}]},

	"ember_foundry": {
		"haze": "8e5e70", "haze_density": 0.0016, "mist_top": 0.0, "mist_depth": 30.0, "mist_max": 0.75,
		"light": "ffc49e", "shade": "6c4a66", "inner_radius": 14.0,
		"ground_style": "grass", "ground_inner": "4d3b45", "ground_outer": "5b4351", "ground_y": -0.3, "ground_amp": 1.4,
		"layers": [
			{"name": "near", "style": "jagged", "peaks": 18, "peak_width": [0.06, 0.16], "peak_curve": 1.15, "jag": 0.1,
				"r": [160.0, 215.0], "h": [8.0, 34.0], "base": -7.0, "seg": 144, "low": "35293a", "high": "67495c",
				"features": [
					{"kind": "chimney", "count": 6, "cluster": 2, "size": [4.0, 6.0], "t": [0.35, 0.8], "low": "443840", "high": "6d5660", "glow": "ffa24a"},
					{"kind": "lavafall", "count": 7, "size": [0.8, 1.5], "low": "c2401f", "high": "ffb24a"}]},
			{"name": "mid", "style": "peaks", "peaks": 9, "peak_width": [0.12, 0.35], "peak_curve": 1.1, "r": [330.0, 420.0],
				"h": [22.0, 70.0], "base": -26.0, "seg": 112, "low": "553d50", "high": "86606f",
				"features": [{"kind": "volcano", "count": 1, "size": [95.0, 105.0], "t": [0.92, 0.95], "low": "4b3544", "high": "7b5566", "glow": "ffb25c"}]},
			{"name": "far", "style": "peaks", "peaks": 10, "peak_width": [0.15, 0.4], "peak_curve": 1.0, "r": [680.0, 760.0],
				"h": [40.0, 130.0], "base": -80.0, "seg": 108, "low": "85606f", "high": "b28182"}]},
}

# Hub zones without bespoke art borrow the nearest style with their own haze.
const ALIASES := {
	"forge_yard": ["orchard_highlands", "adc5d8"],
	"enchanted_kitchen": ["orchard_highlands", "c5ba9e"],
	"mushroom_glade": ["pinewood_ruins", "adc5d8"],
	"crystal_hollow": ["starfall_ridge", "35486a"],
	"sky_garden": ["cloudbreak_keep", "adc5d8"],
}

const SHADER_CODE := """
shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, shadows_disabled;

uniform vec3 haze_color : source_color = vec3(0.75, 0.82, 0.88);
uniform vec3 light_color : source_color = vec3(1.0, 0.96, 0.88);
uniform vec3 shade_color : source_color = vec3(0.62, 0.66, 0.80);
uniform vec3 light_dir = vec3(0.35, 0.75, 0.55);
uniform float haze_strength : hint_range(0.0, 2.0) = 1.0;
uniform float emission_strength : hint_range(0.0, 4.0) = 1.0;
uniform float wrap : hint_range(0.0, 1.0) = 0.45;

varying vec3 v_color;

void vertex() {
	// Normals are baked per face (non-indexed mesh) so lighting is faceted and
	// stable per eye; lighting runs per vertex because the mesh is far away.
	vec3 n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	float d = clamp((dot(n, normalize(light_dir)) + wrap) / (1.0 + wrap), 0.0, 1.0);
	vec3 lit = COLOR.rgb * mix(shade_color, light_color, d);
	float emit = UV.x;
	lit = mix(lit, COLOR.rgb * emission_strength, emit);
	float haze = clamp(COLOR.a * haze_strength, 0.0, 1.0) * (1.0 - 0.6 * emit);
	v_color = mix(lit, haze_color, haze);
}

void fragment() {
	ALBEDO = v_color;
}
"""

static var _shader: Shader


class Buf:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var uv := PackedVector2Array()
	var rng := RandomNumberGenerator.new()
	var density := 0.001
	var mist_top := 0.0
	var mist_depth := 30.0
	var mist_max := 0.8
	var jitter := 0.04
	var eye := Vector3(0.0, 1.8, 0.0)

	func haze_at(p: Vector3) -> float:
		var d := Vector2(p.x, p.z).length()
		var a := 1.0 - exp(-d * density)
		var m := clampf((mist_top - p.y) / mist_depth, 0.0, 1.0) * mist_max
		return clampf(1.0 - (1.0 - a) * (1.0 - m), 0.0, 1.0)

	# Colour alpha < 1 marks emission (emit = 1 - alpha); see H.glow().
	func tri(a: Vector3, b: Vector3, d: Vector3, ca: Color, cb: Color, cd: Color) -> void:
		var nrm := (b - a).cross(d - a)
		if nrm.length_squared() < 1e-8:
			return
		nrm = nrm.normalized()
		if nrm.dot(eye - (a + b + d) / 3.0) < 0.0:
			nrm = -nrm
		var shade := 1.0 + rng.randf_range(-jitter, jitter)
		for pair in [[a, ca], [b, cb], [d, cd]]:
			var p: Vector3 = pair[0]
			var col: Color = pair[1]
			var lin := Color(col.r, col.g, col.b).srgb_to_linear()
			v.append(p)
			n.append(nrm)
			c.append(Color(lin.r * shade, lin.g * shade, lin.b * shade, haze_at(p)))
			uv.append(Vector2(1.0 - col.a, 0.0))

	func quad(a: Vector3, b: Vector3, d: Vector3, e: Vector3, ca: Color, cb: Color, cd: Color, ce: Color, flip := false) -> void:
		# a-b on one row, e-d on the next (a,b,d,e walk around the quad).
		if flip:
			tri(a, b, e, ca, cb, ce)
			tri(b, d, e, cb, cd, ce)
		else:
			tri(a, b, d, ca, cb, cd)
			tri(a, d, e, ca, cd, ce)

	func triangle_count() -> int:
		return v.size() / 3


# ---------------------------------------------------------------- public API

## Builds the horizon for `zone_id` under `parent` (normally the zone root, whose
## origin is the zone centre). Returns the created Node3D ("Horizon").
static func build(zone_id: String, parent: Node3D, profile: Dictionary = {}) -> Node3D:
	var P := resolve_profile(zone_id, profile)
	var b := Buf.new()
	b.rng.seed = int(P.get("seed", hash(zone_id)))
	b.density = float(P.haze_density)
	b.mist_top = float(P.mist_top)
	b.mist_depth = maxf(1.0, float(P.mist_depth))
	b.mist_max = float(P.mist_max)
	b.eye = Vector3(0.0, float(P.get("eye_height", EYE_HEIGHT)), 0.0)
	var layers: Array = P.layers
	_ground(b, P, layers[0])
	var counts := {}
	for L in layers:
		var before := b.triangle_count()
		_layer(b, L)
		counts[str(L.get("name", "layer"))] = b.triangle_count() - before
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = b.v
	arrays[Mesh.ARRAY_NORMAL] = b.n
	arrays[Mesh.ARRAY_COLOR] = b.c
	arrays[Mesh.ARRAY_TEX_UV] = b.uv
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := ShaderMaterial.new()
	mat.shader = _get_shader()
	var mi := MeshInstance3D.new()
	mi.name = "HorizonMesh"
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	var root := Node3D.new()
	root.name = "Horizon"
	root.add_child(mi)
	root.set_meta("horizon_material", mat)
	root.set_meta("zone_id", zone_id)
	root.set_meta("profile", P)
	root.set_meta("stats", {"triangles": b.triangle_count(), "vertices": b.v.size(), "surfaces": mesh.get_surface_count(),
		"materials": 1, "mesh_instances": 1, "layer_triangles": counts})
	parent.add_child(root)
	tint(root, Color(P.haze), Color(P.light), Color(P.shade), Vector3(0.35, 0.75, 0.55))
	return root


## Merges zone defaults with a caller profile. Supported overrides:
##  any top-level key of ZONES entries (haze, light, shade, haze_density, mist_*,
##  ground_inner/outer, inner_radius, cloud_y, seed, eye_height),
##  "near_low"/"near_high"/"mid_low"/"mid_high"/"far_low"/"far_high" (hex strings),
##  "radius_scale" / "height_scale" (float), or a full "layers" array.
static func resolve_profile(zone_id: String, profile: Dictionary = {}) -> Dictionary:
	var key := zone_id
	var alias_haze := ""
	if not ZONES.has(key):
		var alias: Array = ALIASES.get(zone_id, ["orchard_highlands", ""])
		key = alias[0]
		alias_haze = alias[1]
	var P: Dictionary = ZONES[key].duplicate(true)
	if alias_haze != "":
		P.haze = alias_haze
	for k in profile:
		P[k] = profile[k] if not (profile[k] is Dictionary or profile[k] is Array) else profile[k].duplicate(true)
	var layer_names := ["near", "mid", "far"]
	var rs := float(P.get("radius_scale", 1.0))
	var hs := float(P.get("height_scale", 1.0))
	for i in range(P.layers.size()):
		var L: Dictionary = P.layers[i]
		var nm: String = layer_names[mini(i, 2)]
		for part in ["low", "high"]:
			if P.has(nm + "_" + part):
				L[part] = P[nm + "_" + part]
		L.r = [float(L.r[0]) * rs, float(L.r[1]) * rs]
		if L.has("h"):
			L.h = [float(L.h[0]) * hs, float(L.h[1]) * hs]
	return P


## Low-level tint. Colours are sRGB. light_dir points TOWARDS the light (world space).
static func tint(horizon: Node3D, haze: Color, light: Color, shade: Color, light_dir: Vector3,
		haze_strength := 1.0, emission := 1.0) -> void:
	var mat: ShaderMaterial = horizon.get_meta("horizon_material")
	mat.set_shader_parameter("haze_color", haze)
	mat.set_shader_parameter("light_color", light)
	mat.set_shader_parameter("shade_color", shade)
	mat.set_shader_parameter("light_dir", light_dir.normalized() if light_dir.length() > 0.001 else Vector3.UP)
	mat.set_shader_parameter("haze_strength", haze_strength)
	mat.set_shader_parameter("emission_strength", emission)


## Stand-alone day cycle: hour in [0,24). Blends the zone's day palette towards
## dusk and night. Use sync_to_environment() when the game drives its own sky.
static func set_time_of_day(horizon: Node3D, hour: float) -> void:
	var P: Dictionary = horizon.get_meta("profile")
	var h := fposmod(hour, 24.0)
	var elev := sin((h - 6.0) / 12.0 * PI)  # +1 noon, -1 midnight
	var day := smoothstep(-0.18, 0.3, elev)
	var golden := (1.0 - smoothstep(0.05, 0.5, absf(elev))) * smoothstep(-0.25, 0.0, elev)
	var base_haze := Color(P.haze)
	var night_haze := Color(P.get("night_haze", base_haze.darkened(0.72).lerp(Color("1a2440"), 0.55).to_html(false)))
	var dusk := Color(P.get("dusk_color", "f0a27a"))
	var haze := night_haze.lerp(base_haze, day).lerp(dusk, golden * 0.35)
	var light := Color("4d5f8e").lerp(Color(P.light), day).lerp(Color("ffb07a"), golden * 0.5)
	var shade := Color("1c2440").lerp(Color(P.shade), day).lerp(Color("8a6a8e"), golden * 0.3)
	var az := (h - 6.0) / 12.0 * PI
	var dir := Vector3(cos(az), maxf(absf(elev), 0.15), 0.45).normalized()
	tint(horizon, haze, light, shade, dir, lerpf(0.85, 1.0, day), 1.0)


## Pulls haze/light from the live Environment + sun so the silhouettes follow the
## game's own dynamic day/night and weather. Call when those change (cheap).
static func sync_to_environment(horizon: Node3D, env: Environment, sun: DirectionalLight3D = null) -> void:
	var P: Dictionary = horizon.get_meta("profile")
	var haze := Color(P.haze)
	if env.sky != null and env.sky.sky_material is ProceduralSkyMaterial:
		haze = (env.sky.sky_material as ProceduralSkyMaterial).sky_horizon_color
	if env.fog_enabled:
		# Godot fogs the sky by fog_sky_affect, so the visible horizon is the fog colour.
		haze = haze.lerp(env.fog_light_color * env.fog_light_energy, clampf(env.fog_sky_affect, 0.0, 1.0))
	var amb := env.ambient_light_color * clampf(0.45 + env.ambient_light_energy, 0.25, 1.0)
	var shade := amb.lerp(haze, 0.3)
	var light := Color(P.light)
	var dir := Vector3(0.35, 0.75, 0.55)
	if sun != null:
		var e := clampf(sun.light_energy, 0.0, 1.2) if sun.visible else 0.0
		light = shade.lerp(Color.WHITE.lerp(sun.light_color, 0.6), clampf(0.35 + 0.65 * e, 0.0, 1.15))
		dir = sun.global_transform.basis.z
	tint(horizon, haze, light, shade, dir, 1.0, 1.0)


# ---------------------------------------------------------------- geometry

static func _get_shader() -> Shader:
	if _shader == null:
		_shader = Shader.new()
		_shader.code = SHADER_CODE
	return _shader


static func glow(hex: String, emit: float) -> Color:
	var c := Color(hex)
	c.a = 1.0 - clampf(emit, 0.0, 1.0)
	return c


static func _fourier(rng: RandomNumberGenerator, n: int, kmin: int, kmax: int, falloff: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(n)
	out.fill(0.0)
	for k in range(kmin, kmax + 1):
		var a := rng.randf_range(0.5, 1.0) / pow(float(k), falloff)
		var ph := rng.randf() * TAU
		for i in range(n):
			out[i] += a * sin(float(k) * TAU * float(i) / float(n) + ph)
	var lo := INF
	var hi := -INF
	for x in out:
		lo = minf(lo, x)
		hi = maxf(hi, x)
	for i in range(n):
		out[i] = (out[i] - lo) / maxf(hi - lo, 1e-5)
	return out


static func _heights(rng: RandomNumberGenerator, L: Dictionary, seg: int) -> PackedFloat32Array:
	var hmin := float(L.h[0])
	var hmax := float(L.h[1])
	var style := str(L.get("style", "rolling"))
	var out := PackedFloat32Array()
	out.resize(seg)
	match style:
		"mesa":
			var f := _fourier(rng, seg, 2, 11, 1.1)
			var g := _fourier(rng, seg, 8, 30, 0.8)
			for i in range(seg):
				var tier := 0.12 + 0.12 * g[i]
				if f[i] > 0.66:
					tier = 0.93 + 0.07 * g[i]
				elif f[i] > 0.42:
					tier = 0.58 + 0.06 * g[i]
				out[i] = lerpf(hmin, hmax, tier)
		"peaks", "jagged":
			var basen := _fourier(rng, seg, 2, 9, 1.1)
			for i in range(seg):
				out[i] = hmin + (hmax - hmin) * 0.22 * basen[i]
			var count := int(L.get("peaks", 8))
			var w: Array = L.get("peak_width", [0.12, 0.4])
			var curve := float(L.get("peak_curve", 1.2))
			for p in range(count):
				var centre := (float(p) + rng.randf_range(-0.35, 0.35)) / float(count) * TAU
				var ph := lerpf(hmin + (hmax - hmin) * 0.4, hmax, rng.randf())
				var wl := rng.randf_range(float(w[0]), float(w[1]))
				var wr := rng.randf_range(float(w[0]), float(w[1]))
				for i in range(seg):
					var d := wrapf(TAU * float(i) / float(seg) - centre, -PI, PI)
					var ww := wl if d < 0.0 else wr
					if absf(d) < ww:
						out[i] = maxf(out[i], ph * pow(1.0 - absf(d) / ww, curve))
			var jag := float(L.get("jag", 0.035))
			for i in range(seg):
				var s := 1.0 if i % 2 == 0 else -0.6
				out[i] = maxf(hmin * 0.5, out[i] + s * rng.randf() * jag * hmax)
		"clouds":
			var f := _fourier(rng, seg, 2, 7, 1.0)
			var lobes := float(L.get("lobes", 30))
			for i in range(seg):
				var th := TAU * float(i) / float(seg)
				var l := absf(sin(th * lobes * 0.5 + f[i] * 3.0))
				out[i] = lerpf(hmin, hmax, 0.55 * f[i] + 0.45 * sqrt(l))
		_:  # rolling / low
			var f := _fourier(rng, seg, 3, 14, 1.25)
			var g := _fourier(rng, seg, 12, 40, 0.7)
			for i in range(seg):
				out[i] = lerpf(hmin, hmax, 0.82 * f[i] + 0.18 * g[i])
	return out


static func _band_color(L: Dictionary, y: float, lo: Color, hi: Color) -> Color:
	var base := float(L.base)
	var hmax := float(L.h[1])
	var t := clampf((y - base) / maxf(hmax - base, 0.1), 0.0, 1.0)
	var col := lo.lerp(hi, pow(t, 0.85))
	if L.has("strata"):
		var band := int(floorf((y - base) / float(L.get("strata_h", 5.0))))
		if band % 2 == 1:
			col = col.lerp(Color(L.strata), 0.45)
	if L.has("snow") and t > float(L.get("snow_line", 0.75)):
		col = Color(L.snow)
	return col


static func _layer(b: Buf, L: Dictionary) -> void:
	if str(L.get("style", "")) == "islands":
		_islands(b, L)
		return
	var seg := int(L.get("seg", 128))
	var r0 := float(L.r[0])
	var r1 := float(L.r[1])
	var base := float(L.base)
	var h := _heights(b.rng, L, seg)
	var jr := _fourier(b.rng, seg, 3, 16, 1.0)
	var smooth := bool(L.get("smooth", false))
	var old_jitter := b.jitter
	b.jitter = float(L.get("jitter", old_jitter))
	var foot := PackedVector3Array()
	var shoulder := PackedVector3Array()
	var crest := PackedVector3Array()
	for i in range(seg):
		var th := TAU * float(i) / float(seg)
		var dir := Vector3(cos(th), 0.0, sin(th))
		var rc := r1 + (jr[i] - 0.5) * (r1 - r0) * 0.6
		var rs := r0 + (rc - r0) * (0.5 if smooth else b.rng.randf_range(0.42, 0.6))
		var ys := base + (h[i] - base) * (0.72 if smooth else b.rng.randf_range(0.5, 0.68))
		foot.append(dir * (r0 + b.rng.randf_range(-2.0, 2.0)) + Vector3(0.0, base, 0.0))
		shoulder.append(dir * rs + Vector3(0.0, ys, 0.0))
		crest.append(dir * rc + Vector3(0.0, h[i], 0.0))
	var rows := [foot, shoulder, crest]
	var lo := Color(L.low)
	var hi := Color(L.high)
	var faceted := bool(L.get("faceted", false))
	for k in range(2):
		var A: PackedVector3Array = rows[k]
		var B: PackedVector3Array = rows[k + 1]
		for i in range(seg):
			var j := (i + 1) % seg
			var p := [A[i], A[j], B[j], B[i]]
			var cs := []
			if faceted:
				var cy: float = (p[0].y + p[1].y + p[2].y + p[3].y) * 0.25
				var fc := _band_color(L, cy, lo, hi)
				cs = [fc, fc, fc, fc]
			else:
				for q in p:
					cs.append(_band_color(L, q.y, lo, hi))
			b.quad(p[0], p[1], p[2], p[3], cs[0], cs[1], cs[2], cs[3], (i + k) % 2 == 0)
	for F in L.get("features", []):
		_scatter(b, F, rows, seg)
	b.jitter = old_jitter


static func _terrain_at(rows: Array, seg: int, theta: float, t: float) -> Vector3:
	var x := fposmod(theta, TAU) / TAU * float(seg)
	var i0 := int(floorf(x)) % seg
	var i1 := (i0 + 1) % seg
	var f := x - floorf(x)
	var k := 0 if t < 0.5 else 1
	var u := t * 2.0 if t < 0.5 else (t - 0.5) * 2.0
	var ra: PackedVector3Array = rows[k]
	var rb: PackedVector3Array = rows[k + 1]
	return ra[i0].lerp(ra[i1], f).lerp(rb[i0].lerp(rb[i1], f), u)


static func _scatter(b: Buf, F: Dictionary, rows: Array, seg: int) -> void:
	var count := int(F.get("count", 10))
	var cluster := int(F.get("cluster", 1))
	var size: Array = F.get("size", [4.0, 6.0])
	var trange: Array = F.get("t", [0.6, 0.97])
	var offset := b.rng.randf() * TAU
	for k in range(count):
		var th := offset + (float(k) + b.rng.randf_range(-0.4, 0.4)) / float(count) * TAU
		for c in range(cluster):
			var tt := th + (float(c) - float(cluster - 1) * 0.5) * b.rng.randf_range(0.012, 0.022)
			var t := b.rng.randf_range(float(trange[0]), float(trange[1]))
			var s := b.rng.randf_range(float(size[0]), float(size[1]))
			var pos := _terrain_at(rows, seg, tt, t)
			var kind := str(F.get("kind", "round_tree"))
			if kind == "lavafall":
				_lavafall(b, rows, seg, tt, s, F)
			else:
				pos.y -= s * 0.12
				_prop(b, kind, pos, s, F)


static func _prop(b: Buf, kind: String, p: Vector3, s: float, F: Dictionary) -> void:
	var lo := glow(str(F.get("low", "556b3a")), float(F.get("emit", 0.0)))
	var hi := glow(str(F.get("high", "8aa84e")), float(F.get("emit", 0.0)))
	var mid := lo.lerp(hi, 0.5)
	var rot := b.rng.randf() * TAU
	match kind:
		"round_tree":
			_lathe(b, p - Vector3(0.0, 0.25 * s, 0.0), [[0.0, 0.45 * s, lo], [1.0 * s, 0.8 * s, mid], [0.72 * s, 1.5 * s, hi], [0.0, 1.95 * s, hi]], 6, rot, 0.12)
		"pine":
			_lathe(b, p, [[0.0, 0.25 * s, lo], [0.62 * s, 0.35 * s, lo], [0.0, 1.55 * s, mid]], 5, rot, 0.08)
			_lathe(b, p, [[0.0, 1.0 * s, mid], [0.45 * s, 1.05 * s, mid], [0.0, 2.3 * s, hi]], 5, rot + 0.5, 0.08)
		"willow":
			_lathe(b, p, [[0.0, 0.3 * s, lo], [0.95 * s, 0.0, lo], [1.05 * s, 0.6 * s, mid], [0.75 * s, 1.15 * s, hi], [0.0, 1.4 * s, hi]], 6, rot, 0.15)
		"snag":
			_lathe(b, p, [[0.14 * s, 0.0, lo], [0.0, 2.6 * s, hi]], 4, rot, 0.0)
			for side in [-1.0, 1.0]:
				var basis := Basis(Vector3(cos(rot), 0.0, sin(rot)), side * 0.9)
				_lathe(b, p + Vector3(0.0, 1.3 * s + side * 0.3 * s, 0.0), [[0.06 * s, 0.0, lo], [0.0, 1.1 * s, hi]], 3, rot, 0.0, basis)
		"crystal":
			var basis := Basis(Vector3(cos(rot), 0.0, sin(rot)), b.rng.randf_range(-0.35, 0.35))
			_lathe(b, p, [[0.28 * s, 0.0, lo], [0.36 * s, 1.9 * s, mid], [0.0, 3.1 * s, hi]], 5, rot, 0.1, basis)
		"hoodoo":
			_lathe(b, p, [[0.42 * s, 0.0, lo], [0.28 * s, 1.9 * s, mid], [0.6 * s, 2.0 * s, hi], [0.52 * s, 2.45 * s, hi], [0.0, 2.5 * s, hi]], 5, rot, 0.15)
		"ruin":
			_lathe(b, p, [[0.55 * s, 0.0, lo], [0.48 * s, 2.3 * s, hi, 0.5 * s], [0.0, 2.1 * s, mid]], 6, rot, 0.05)
		"lamp":
			_lathe(b, p + Vector3(0.0, 0.6 * s, 0.0), [[0.0, 0.0, lo], [0.5 * s, 0.5 * s, hi], [0.0, 1.0 * s, hi]], 4, rot, 0.0)
		"cloud":
			_lathe(b, p, [[0.0, 0.1 * s, lo], [1.1 * s, 0.0, lo], [0.95 * s, 0.45 * s, mid], [0.55 * s, 0.8 * s, hi], [0.0, 0.9 * s, hi]], 7, rot, 0.2)
		"chimney":
			var g := glow(str(F.get("glow", "ffa24a")), 1.0)
			_lathe(b, p, [[0.5 * s, 0.0, lo], [0.32 * s, 3.0 * s, hi], [0.4 * s, 3.05 * s, hi], [0.4 * s, 3.35 * s, g], [0.0, 3.25 * s, g]], 6, rot, 0.0)
		"windmill":
			_windmill(b, p, s, lo, hi)
		"volcano":
			_volcano(b, p, s, lo, hi, glow(str(F.get("glow", "ffb25c")), 1.0))
		_:
			_lathe(b, p, [[0.0, 0.0, lo], [s, s, mid], [0.0, 2.0 * s, hi]], 5, rot, 0.1)


## Revolves rings [radius, y, colour, (optional top jitter)] around `centre`.
## Radius 0 is a pole. Per-column radial jitter is shared by all rings.
static func _lathe(b: Buf, centre: Vector3, rings: Array, sides: int, rot: float, irregular: float, basis := Basis.IDENTITY) -> void:
	var jit := PackedFloat32Array()
	for s in range(sides):
		jit.append(1.0 + b.rng.randf_range(-irregular, irregular))
	var pts := []
	for ring in rings:
		var row := PackedVector3Array()
		var yj := float(ring[3]) if ring.size() > 3 else 0.0
		for s in range(sides):
			var a := rot + TAU * float(s) / float(sides)
			var r := float(ring[0]) * jit[s]
			var y := float(ring[1]) - b.rng.randf() * yj
			row.append(centre + basis * Vector3(cos(a) * r, y, sin(a) * r))
		pts.append(row)
	for k in range(rings.size() - 1):
		var A: PackedVector3Array = pts[k]
		var B: PackedVector3Array = pts[k + 1]
		var ca: Color = rings[k][2]
		var cb: Color = rings[k + 1][2]
		var a_pole := float(rings[k][0]) == 0.0
		var b_pole := float(rings[k + 1][0]) == 0.0
		for s in range(sides):
			var t := (s + 1) % sides
			if a_pole:
				b.tri(A[0], B[s], B[t], ca, cb, cb)
			elif b_pole:
				b.tri(A[s], A[t], B[0], ca, ca, cb)
			else:
				b.quad(A[s], A[t], B[t], B[s], ca, ca, cb, cb, s % 2 == 0)


static func _windmill(b: Buf, p: Vector3, s: float, lo: Color, hi: Color) -> void:
	var face := -Vector3(p.x, 0.0, p.z).normalized()
	var rot := atan2(face.z, face.x)
	_lathe(b, p, [[0.42 * s, 0.0, lo], [0.28 * s, 1.7 * s, hi], [0.36 * s, 1.72 * s, Color("9b5a3c")], [0.0, 2.3 * s, Color("b86a45")]], 6, rot, 0.0)
	var hub := p + Vector3(0.0, 1.75 * s, 0.0) + face * 0.45 * s
	var side := face.cross(Vector3.UP).normalized()
	var blade_col := Color("e9dcbc")
	var spin := b.rng.randf() * TAU
	for k in range(4):
		var a := spin + float(k) * PI * 0.5
		var along := side * cos(a) + Vector3.UP * sin(a)
		var across := side * cos(a + PI * 0.5) + Vector3.UP * sin(a + PI * 0.5)
		var p0 := hub + along * 0.15 * s
		var p1 := hub + along * 1.25 * s
		b.quad(p0, p1, p1 + across * 0.28 * s, p0 + across * 0.2 * s, blade_col, blade_col, blade_col, blade_col)


static func _volcano(b: Buf, p: Vector3, s: float, lo: Color, hi: Color, g: Color) -> void:
	var rot := b.rng.randf() * TAU
	var h := s * 0.75
	var base := p - Vector3(0.0, 0.25 * h, 0.0)
	_lathe(b, base, [[s, 0.0, lo], [0.62 * s, 0.55 * h, lo.lerp(hi, 0.5)], [0.26 * s, h, hi], [0.2 * s, 0.95 * h, g], [0.0, 0.9 * h, g]], 9, rot, 0.08)
	# Lava rivulets down the flank facing the zone.
	var face := atan2(-p.z, -p.x)
	for k in range(3):
		var a := face + (float(k) - 1.0) * 0.35 + b.rng.randf_range(-0.08, 0.08)
		var d := Vector3(cos(a), 0.0, sin(a))
		var side := d.cross(Vector3.UP) * s * 0.02
		var top := base + d * 0.27 * s * 1.03 + Vector3(0.0, 0.98 * h, 0.0)
		var mid := base + d * 0.64 * s * 1.03 + Vector3(0.0, 0.52 * h, 0.0)
		var bot := base + d * 0.9 * s * 1.03 + Vector3(0.0, 0.18 * h, 0.0)
		b.quad(top - side, top + side, mid + side * 1.6, mid - side * 1.6, g, g, g, g)
		b.tri(mid - side * 1.6, mid + side * 1.6, bot, g, g, g)


static func _lavafall(b: Buf, rows: Array, seg: int, th: float, s: float, F: Dictionary) -> void:
	var hi := glow(str(F.get("high", "ffc25a")), 1.0)
	var lo := glow(str(F.get("low", "ff7a2e")), 1.0)
	var pts := []
	for t in [0.98, 0.7, 0.4, 0.0]:
		var c := _terrain_at(rows, seg, th, t)
		var inward := -Vector3(c.x, 0.0, c.z).normalized()
		var side: Vector3 = inward.cross(Vector3.UP) * s * (0.5 + 1.2 * (1.0 - t))
		pts.append([c + inward * 0.8 - side, c + inward * 0.8 + side])
	for k in range(pts.size() - 1):
		var ca := hi.lerp(lo, float(k) / 3.0)
		var cb := hi.lerp(lo, float(k + 1) / 3.0)
		b.quad(pts[k][0], pts[k][1], pts[k + 1][1], pts[k + 1][0], ca, ca, cb, cb)


static func _islands(b: Buf, L: Dictionary) -> void:
	var count := int(L.get("count", 12))
	var ry: Array = L.get("y", [0.0, 60.0])
	var rsz: Array = L.get("size", [10.0, 30.0])
	var grass := Color(L.grass)
	var grass_dark := Color(L.grass_dark)
	var rock_hi := Color(L.rock_high)
	var rock_lo := Color(L.rock_low)
	var tree_lo := Color(L.get("tree_low", "3f6b4b"))
	var tree_hi := Color(L.get("tree_high", "7ba466"))
	var offset := b.rng.randf() * TAU
	var keep_at := int(L.get("keep_index", 0))
	for k in range(count):
		var th := offset + (float(k) + b.rng.randf_range(-0.3, 0.3)) / float(count) * TAU
		var r := b.rng.randf_range(float(L.r[0]), float(L.r[1]))
		var s := b.rng.randf_range(float(rsz[0]), float(rsz[1]))
		if k == keep_at:
			s = float(rsz[1]) * 1.15
			r = maxf(r, float(L.r[1]) * 0.75)
		var y := lerpf(float(ry[0]), float(ry[1]), pow(b.rng.randf(), 1.3))
		var c := Vector3(cos(th) * r, y, sin(th) * r)
		var rot := b.rng.randf() * TAU
		_lathe(b, c, [[0.0, 0.0, grass], [s, 0.0, grass], [1.03 * s, -0.12 * s, grass_dark], [0.8 * s, -0.45 * s, rock_hi],
			[0.38 * s, -1.0 * s, rock_hi.lerp(rock_lo, 0.5)], [0.0, -1.6 * s, rock_lo]], 7, rot, 0.18)
		if k == keep_at:
			_keep(b, c, s, Color(L.get("keep_walls", "dfe2d6")), Color(L.get("keep_roof", "3f8290")))
		else:
			var trees := b.rng.randi_range(1, 3)
			for t in range(trees):
				var a := b.rng.randf() * TAU
				var d := b.rng.randf_range(0.1, 0.55) * s
				var ts := s * b.rng.randf_range(0.12, 0.2)
				_lathe(b, c + Vector3(cos(a) * d, -0.05 * ts, sin(a) * d),
					[[0.0, 0.2 * ts, tree_lo], [0.6 * ts, 0.3 * ts, tree_lo], [0.0, 2.2 * ts, tree_hi]], 5, a, 0.1)


static func _keep(b: Buf, c: Vector3, s: float, walls: Color, roof: Color) -> void:
	var dark := walls.darkened(0.18)
	var towers := [[Vector3.ZERO, 0.2, 1.0], [Vector3(0.32, 0.0, 0.18), 0.12, 0.62], [Vector3(-0.3, 0.0, -0.2), 0.12, 0.7]]
	for t in towers:
		var o: Vector3 = c + t[0] * s
		var r := float(t[1]) * s
		var h := float(t[2]) * s
		_lathe(b, o, [[r, -0.05 * s, dark], [r * 0.92, h, walls], [r * 1.3, h, roof.darkened(0.2)], [0.0, h + r * 2.4, roof]], 6, 0.3, 0.0)
	# Curtain wall ring linking the towers.
	_lathe(b, c, [[0.46 * s, -0.05 * s, dark], [0.46 * s, 0.22 * s, walls], [0.0, 0.22 * s, walls]], 8, 0.1, 0.0)


static func _ground(b: Buf, P: Dictionary, near: Dictionary) -> void:
	var style := str(P.get("ground_style", "grass"))
	if style == "none":
		return
	var seg := 72
	var r0 := float(near.r[0])
	var r1 := float(near.r[1])
	var amp := float(P.get("ground_amp", 1.0))
	var inner := glow(str(P.get("ground_inner", "8fa55e")), 0.0)
	var outer := glow(str(P.get("ground_outer", "a5aa6a")), 0.0)
	var radii := []
	var ys := []
	var cols := []
	if style == "cloud":
		var cy := float(P.get("cloud_y", -40.0))
		for r in [0.0, 50.0, 110.0, 180.0, r0 + 10.0, r1 + 40.0]:
			radii.append(r)
			ys.append(cy)
	else:
		var ri := float(P.get("inner_radius", 26.0))
		var gy := float(P.get("ground_y", -0.3))
		var nb := float(near.base)
		for f in [0.0, 0.1, 0.25, 0.45, 0.7, 1.0]:
			radii.append(lerpf(ri, r0, f))
			ys.append(lerpf(gy, nb - 1.0, pow(f, 1.6)))
		radii.append(r0 + 0.4 * (r1 - r0))
		ys.append(nb - 1.0 - 0.4 * (r1 - r0) * 0.3)
	var grid := []
	var gcol := []
	for k in range(radii.size()):
		var row := PackedVector3Array()
		var crow := []
		var f := float(k) / float(radii.size() - 1)
		var bumps := _fourier(b.rng, seg, 3, 14, 0.9)
		for i in range(seg):
			var th := TAU * float(i) / float(seg)
			var bump := bumps[i]
			var amp_k := amp if style == "cloud" else amp * minf(1.0, f * 3.0)
			var y := float(ys[k]) + (bump - 0.5) * 2.0 * amp_k
			row.append(Vector3(cos(th) * radii[k], y, sin(th) * radii[k]))
			if style == "cloud":
				crow.append(inner.lerp(outer, clampf(bump * 1.2 - 0.1, 0.0, 1.0)))
			else:
				crow.append(inner.lerp(outer, f).lerp(inner.darkened(0.12), (1.0 - bump) * 0.35))
		grid.append(row)
		gcol.append(crow)
	if P.has("sea_puffs"):
		var F: Dictionary = P.sea_puffs
		var n := int(F.get("count", 20))
		for k in range(n):
			var th := (float(k) + b.rng.randf_range(-0.4, 0.4)) / float(n) * TAU
			var r := b.rng.randf_range(float(F.r[0]), float(F.r[1]))
			var s := b.rng.randf_range(float(F.size[0]), float(F.size[1]))
			_prop(b, "cloud", Vector3(cos(th) * r, float(P.get("cloud_y", -40.0)) - 0.2 * s, sin(th) * r), s, F)
	for k in range(radii.size() - 1):
		var A: PackedVector3Array = grid[k]
		var B: PackedVector3Array = grid[k + 1]
		for i in range(seg):
			var j := (i + 1) % seg
			if float(radii[k]) == 0.0:
				b.tri(A[0], B[i], B[j], gcol[k][0], gcol[k + 1][i], gcol[k + 1][j])
			else:
				b.quad(A[i], A[j], B[j], B[i], gcol[k][i], gcol[k][j], gcol[k + 1][j], gcol[k + 1][i], (i + k) % 2 == 0)
