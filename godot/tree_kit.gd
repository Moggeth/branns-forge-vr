class_name TreeKit
extends RefCounted
## Brann's Forge VR procedural tree kit (Godot 4.7, Mobile renderer friendly).
##
## Species: "apple", "pine", "fen" (magical willow with glowing pods) and
## "deadwood" (enchanted bare tree with glowing fungus).
##
## Every tree is generated from (species, seed, height). A seed drives the
## silhouette, lean, branch angles, cluster sizes and fruit placement; the same
## seed always produces the same tree, and the NEAR and FAR meshes share one
## skeleton so a LOD switch keeps the silhouette.
##
## All geometry is flat-shaded, vertex coloured and uses ONE shared opaque
## material: COLOR.rgb = albedo (linear), COLOR.a = wind weight (0 on the trunk
## and chop section), UV2.x = emission strength. A foreground tree is therefore
## one draw call (two when the trunk is split out for chopping), and any number
## of distant trees can be merged or MultiMesh-instanced into one draw call.
##
## Public API (all static):
##   make_tree(species, seed, opts) -> Node3D           foreground/standalone tree
##   build_into(node, species, seed, opts) -> Dictionary build children into an existing node
##   adapt_timber(resource_node, species, seed, opts)   chop-contract adapter for
##                                                      WorldZones.resource(...,"lumber","axe")
##   dress_apple_pickup(resource_node, count)           visual + body for an "apple" resource
##   tree_mesh(species, seed, lod, opts) -> ArrayMesh   cached single-surface mesh
##   make_grove(placements, opts) -> Node3D             batched distant trees
##   set_wind(strength, direction, speed)               gentle global wind (0 = off)
##   set_viewer(position)                               player head for wind calm zone (per frame)
##   set_glow(energy)                                   emission energy (day ~0.5, night ~1.6)
##   tree_material() / card_material()                  shared materials
##   clear_cache()                                      drop cached meshes/materials
## See HANDOFF.md for option tables, budgets and integration notes.

const SPECIES := ["apple", "pine", "fen", "deadwood"]
const DEFAULT_HEIGHT := {"apple": 4.8, "pine": 6.5, "fen": 5.2, "deadwood": 5.0}
const CARD_CELL := {"apple": 0, "pine": 1, "fen": 3, "deadwood": 2}
const CARD_TEXTURE := "res://textures/foliage_atlas.png"

## Palettes are sRGB hex; converted to linear when baked.
const PALETTES := {
	"apple": {"bark": ["7f5236", "6a432c", "946543"], "moss": "7c8b47",
		"leaf": ["5f8f3a", "73a142", "86b048", "4f7d38"], "leaf_light": "c9d863", "leaf_dark": "2f5230",
		"fruit": ["c8372a", "d9472f", "b8302a"], "fruit_light": "f28a4a", "fruit_dark": "86211d",
		"stem": "5c3b24", "twig_leaf": "6a9a3c"},
	"apple_autumn": {"bark": ["7f5236", "6a432c", "946543"], "moss": "8a8a45",
		"leaf": ["d08a33", "c4632b", "e0a943", "b5552a"], "leaf_light": "f3d06a", "leaf_dark": "6e3322",
		"fruit": ["c8372a", "d9472f", "b8302a"], "fruit_light": "f28a4a", "fruit_dark": "86211d",
		"stem": "5c3b24", "twig_leaf": "d08a33"},
	"pine": {"bark": ["6b4633", "5a3a2b", "7c5539"],
		"leaf": ["3f6b48", "4a7a4c", "588a52", "375f45"], "leaf_light": "93b566", "leaf_dark": "1f3a2f",
		"fruit": ["8a5a36", "7a4d2e", "9a6a40"], "fruit_light": "b58a55", "fruit_dark": "4d301e"},
	"fen": {"bark": ["5c5561", "4b4552", "6d6570"], "moss": "6f9c84",
		"leaf": ["6a9e8f", "7fb3a0", "5a8c84", "93c2ac"], "leaf_light": "c6e8d0", "leaf_dark": "2d4b4c",
		"strand": "5f9483", "strand_tip": "9fd0b8",
		"fruit": ["9ff5dc", "c7a6ff", "ffd98a"], "fruit_light": "ffffff", "fruit_dark": "5d8f84",
		"fungus": ["8fe8dc", "c3a2f5"]},
	"deadwood": {"bark": ["6c6068", "5a4f58", "7d7178"], "moss": "7b8f86",
		"leaf": ["6c6068"], "leaf_light": "a0949a", "leaf_dark": "3e3540",
		"fruit": ["a8f0ff", "c7a6ff"], "fruit_light": "ffffff", "fruit_dark": "6c6068",
		"fungus": ["9ae6ff", "c7a6ff", "ffd98a"]},
}

static var _material: ShaderMaterial
static var _shadow_material: ShaderMaterial
static var _card_materials: Dictionary = {}
static var _mesh_cache: Dictionary = {}
static var _pickup_mesh: ArrayMesh
static var _ico: Array = []  # [PackedVector3Array verts, Array faces] unit icosphere levels

# --------------------------------------------------------------------------
# Materials, wind and glow
# --------------------------------------------------------------------------

const _SHADER_CODE := """
shader_type spatial;
render_mode cull_disabled, diffuse_lambert, specular_schlick_ggx;
uniform float wind_strength = 0.0;
uniform float wind_speed = 0.8;
uniform vec2 wind_direction = vec2(0.8, 0.6);
uniform float near_calm_start = 3.0;
uniform float near_calm_end = 9.0;
// Set every frame via TreeKit.set_viewer(): the shadow pass has the light's camera in
// CAMERA_POSITION_WORLD, so without this, shadows would sway under a calm tree.
uniform vec3 viewer_position = vec3(0.0);
uniform bool use_viewer_position = false;
uniform float emission_energy = 0.6;
uniform float roughness_value : hint_range(0.0, 1.0) = 0.88;
varying float v_glow;
varying vec3 v_local;
varying vec3 v_world;
varying vec3 v_wn;
// UV2.y surface mode (flat varying): 0 legacy flat colour, 1 leaf card (UV = sprig atlas space), 2 bark (UV = around 0..1, metres along),
// 3 dark inner leaf core (never casts a leaf-shadow). UV2.x stays emission strength.
varying flat float v_mode;
varying vec2 v_uv;
float tk_hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float tk_noise(vec3 p) {
	vec3 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(tk_hash(i), tk_hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(tk_hash(i + vec3(0.0, 1.0, 0.0)), tk_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
	           mix(mix(tk_hash(i + vec3(0.0, 0.0, 1.0)), tk_hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(tk_hash(i + vec3(0.0, 1.0, 1.0)), tk_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// Leaf vertices are the green-dominant ones; bark (r > g), fruit (red) and glow fungus keep their authored colour.
float tk_leaf(vec3 c) { return smoothstep(0.0, 0.05, c.g - c.r * 0.92) * step(c.b, c.g); }
// Procedural apple-leaf sprig: seven pointed leaves fanned from the card base. Returns 1 inside a leaf (0 = cut away).
const vec3 TK_SPRIG[7] = vec3[](vec3(0.50, 0.20, 1.5708), vec3(0.33, 0.33, 2.30), vec3(0.67, 0.33, 0.84), vec3(0.27, 0.58, 2.62),
	vec3(0.73, 0.58, 0.52), vec3(0.40, 0.78, 1.95), vec3(0.60, 0.78, 1.19));
float tk_sprig(vec2 uv, out float shade, out float vein) {
	float hit = 0.0;
	shade = 0.5;
	vein = 0.0;
	for (int i = 0; i < 7; i++) {
		vec3 lp = TK_SPRIG[i];
		vec2 p = uv - lp.xy;
		vec2 d = vec2(cos(lp.z), sin(lp.z));
		float x = dot(p, d);
		float y = dot(p, vec2(-d.y, d.x));
		float t = x / 0.21;
		if (abs(t) < 1.0) {
			float w = 0.105 * pow(1.0 - t * t, 0.7) * mix(1.22, 0.68, t * 0.5 + 0.5);
			if (abs(y) < w) {
				hit = 1.0;
				shade = fract(float(i) * 0.371 + 0.13) * 0.55 + 0.15 + (t * 0.5 + 0.5) * 0.3;
				vein = 1.0 - smoothstep(0.004, 0.012, abs(y));
			}
		}
	}
	return hit;
}
void vertex() {
	v_glow = UV2.x;
	v_mode = UV2.y;
	v_uv = UV;
	v_local = VERTEX;
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wn = normalize(mat3(MODEL_MATRIX) * NORMAL);
	float w = COLOR.a;
	if (wind_strength > 0.0 && w > 0.001) {
		vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
		// Nothing within arm's reach moves: amplitude fades to zero near the viewer.
		float calm = smoothstep(near_calm_start, near_calm_end, distance(wp, use_viewer_position ? viewer_position : CAMERA_POSITION_WORLD));
		float t = TIME * wind_speed + dot(wp.xz, vec2(0.11, 0.07));
		float sway = sin(t) * 0.75 + sin(t * 2.13 + 1.7) * 0.25;
		float flutter = sin(TIME * 2.7 + dot(wp, vec3(1.3, 0.9, 1.1))) * 0.18;
		vec3 off = vec3(wind_direction.x, 0.0, wind_direction.y) * sway + vec3(0.0, flutter, 0.0);
		off *= w * wind_strength * calm;
		// World-space offset back to model space (rotation + uniform scale).
		VERTEX += (off * mat3(MODEL_MATRIX)) / max(dot(MODEL_MATRIX[0].xyz, MODEL_MATRIX[0].xyz), 1e-4);
	}
}
void fragment() {
	//TK_SHADOW_DAPPLE
	vec3 c = COLOR.rgb;
	float leaf = tk_leaf(c);
	if (v_mode > 0.5 && v_mode < 1.5) {
		// Alpha-scissor leaf card: soft volumetric normal (never flips on the back face), layered tonal leaves.
		float shade;
		float vein;
		if (tk_sprig(v_uv, shade, vein) < 0.5) discard;
		float up = clamp(v_wn.y * 0.5 + 0.5, 0.0, 1.0);
		c *= mix(0.74, 1.2, shade);
		c = mix(c, c * vec3(1.22, 1.16, 0.72), vein * 0.55);
		c = mix(c * vec3(0.86, 0.98, 1.06), c * vec3(1.1, 1.05, 0.84), smoothstep(0.3, 0.85, up));
		NORMAL = normalize((VIEW_MATRIX * vec4(v_wn, 0.0)).xyz);
		ALBEDO = c;
		ROUGHNESS = 0.82;
		SPECULAR = 0.12;
	} else {
		if (v_mode > 1.5 && v_mode < 2.5) {
			// Weathered bark: long vertical plates and grooves (periodic around the limb), warm/cool patches,
			// contact darkening and moss near the soil, plus a screen-space bump so grooves catch the light.
			vec2 ring = vec2(cos(v_uv.x * 6.2831853), sin(v_uv.x * 6.2831853));
			float n1 = tk_noise(vec3(ring * 2.2, v_uv.y * 0.55));
			float n2 = tk_noise(vec3(ring * 5.6 + 3.0, v_uv.y * 1.5));
			float n3 = tk_noise(vec3(ring * 11.0, v_uv.y * 4.6 + 7.0));
			float groove = smoothstep(0.0, 0.2, abs(n2 * 2.0 - 1.0));
			float hgt = (groove * 0.62 + n3 * 0.23 + n1 * 0.15) * 0.022;
			c = mix(c * vec3(0.9, 0.98, 1.1), c * vec3(1.16, 1.02, 0.84), n1);
			c *= mix(0.5, 1.1, groove) * mix(0.9, 1.1, n3);
			float low = 1.0 - smoothstep(0.0, 0.7, v_local.y);
			c = mix(c, c * vec3(0.55, 0.62, 0.42), low * smoothstep(0.35, 0.75, n1) * 0.6);
			c *= mix(1.0, 0.62, low * low);
			vec3 dpx = dFdx(VERTEX);
			vec3 dpy = dFdy(VERTEX);
			vec3 r1 = cross(dpy, NORMAL);
			vec3 r2 = cross(NORMAL, dpx);
			float det = dot(dpx, r1);
			vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
			NORMAL = normalize(abs(det) * NORMAL - grad);
			ROUGHNESS = 0.94;
		} else {
			if (leaf > 0.0) {
				// Canopy surface variation (legacy flat-shaded species): sun-lit tops lean warm yellow-green, undersides and
				// inner faces lean cool blue-green, and ~0.5 m / ~1.6 m clump noise (anchored in tree-local space so it
				// never swims with the wind) breaks each facet's flat fill into leaf masses.
				float up = clamp(v_wn.y * 0.5 + 0.5, 0.0, 1.0);
				float clump = tk_noise(v_local * 1.9) * 0.65 + tk_noise(v_local * 5.2 + 3.1) * 0.35;
				vec3 warm = c * vec3(1.10, 1.06, 0.82);
				vec3 cool = c * vec3(0.84, 0.97, 1.04);
				vec3 shaded = mix(cool, warm, smoothstep(0.30, 0.85, up));
				shaded *= mix(0.90, 1.10, clump);
				c = mix(c, shaded, leaf * 0.85);
			}
			ROUGHNESS = roughness_value;
		}
		ALBEDO = c;
		SPECULAR = 0.25;
	}
	EMISSION = COLOR.rgb * v_glow * emission_energy;
}
"""

# Shadow-only twin of the tree material: identical vertex (same wind) but leaves are punched with ~0.35 m
# clump holes so canopy shadows read as filtered, dappled light. It is only ever used by SHADOWS_ONLY instances.
const _SHADOW_MARK := "//TK_SHADOW_DAPPLE"
const _SHADOW_DAPPLE := """
	if (v_mode > 2.5) discard;
	if (v_mode < 0.5 && tk_leaf(COLOR.rgb) > 0.0) {
		float h = tk_noise(v_local * 3.1) * 0.6 + tk_noise(v_local * 7.7 + 5.0) * 0.4;
		if (h < 0.34) discard;
	}
"""

const _CARD_SHADER_CODE := """
shader_type spatial;
render_mode cull_disabled, diffuse_lambert, specular_disabled;
uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;
uniform float wind_strength = 0.0;
uniform float wind_speed = 0.8;
uniform vec2 wind_direction = vec2(0.8, 0.6);
uniform float near_calm_start = 3.0;
uniform float near_calm_end = 9.0;
// Set every frame via TreeKit.set_viewer(): the shadow pass has the light's camera in
// CAMERA_POSITION_WORLD, so without this, shadows would sway under a calm tree.
uniform vec3 viewer_position = vec3(0.0);
uniform bool use_viewer_position = false;
void vertex() {
	float w = COLOR.a;
	if (wind_strength > 0.0 && w > 0.001) {
		vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
		float calm = smoothstep(near_calm_start, near_calm_end, distance(wp, use_viewer_position ? viewer_position : CAMERA_POSITION_WORLD));
		float t = TIME * wind_speed + dot(wp.xz, vec2(0.11, 0.07));
		float sway = sin(t) * 0.75 + sin(t * 2.13 + 1.7) * 0.25;
		vec3 off = vec3(wind_direction.x, 0.0, wind_direction.y) * sway * w * wind_strength * calm;
		VERTEX += (off * mat3(MODEL_MATRIX)) / max(dot(MODEL_MATRIX[0].xyz, MODEL_MATRIX[0].xyz), 1e-4);
	}
}
void fragment() {
	vec4 tex = texture(atlas, UV);
	ALBEDO = tex.rgb * COLOR.rgb;
	ALPHA = tex.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ROUGHNESS = 0.9;
}
"""

## Shared opaque tree material (all trees, all LODs).
static func tree_material() -> ShaderMaterial:
	if _material == null:
		var shader = Shader.new()
		shader.code = _SHADER_CODE
		_material = ShaderMaterial.new()
		_material.shader = shader
	return _material

## Material of the dappled shadow-only twin (see _SHADOW_DAPPLE).
static func shadow_material() -> ShaderMaterial:
	if _shadow_material == null:
		var shader = Shader.new()
		shader.code = _SHADER_CODE.replace(_SHADOW_MARK, _SHADOW_DAPPLE)
		_shadow_material = ShaderMaterial.new()
		_shadow_material.shader = shader
	return _shadow_material

## Dappled canopy shadow: the visible mesh stops casting and a shadow-only instance of the SAME mesh (same
## transform, same wind vertex code, no extra triangles in the main pass) casts through a leaf-punched material.
## Trunks and fruit are never punched, so stems still throw solid shadows.
static func _dapple_shadow(visible: MeshInstance3D) -> void:
	var twin = MeshInstance3D.new()
	twin.name = visible.name + "Shadow"
	twin.mesh = visible.mesh
	twin.material_override = shadow_material()
	twin.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
	twin.visibility_range_end = visible.visibility_range_end
	twin.visibility_range_end_margin = visible.visibility_range_end_margin
	visible.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	visible.add_child(twin)

## Optional alpha-scissor leaf-card material (uses the processed painterly atlas).
static func card_material(texture: Texture2D = null) -> ShaderMaterial:
	var key = "cards"
	if _card_materials.has(key): return _card_materials[key]
	var shader = Shader.new()
	shader.code = _CARD_SHADER_CODE
	var m = ShaderMaterial.new()
	m.shader = shader
	var tex: Texture2D = texture
	if tex == null and ResourceLoader.exists(CARD_TEXTURE): tex = load(CARD_TEXTURE)
	m.set_shader_parameter("atlas", tex)
	_card_materials[key] = m
	return m

## Gentle optional wind. strength is metres of sway at a fully weighted canopy tip
## (0.0 disables; 0.04-0.08 reads as a breeze). Collision proxies never move and
## geometry within 3 m of the camera is held still (full sway from 9 m) to avoid VR jitter.
static func set_wind(strength: float, direction: Vector2 = Vector2(0.8, 0.6), speed: float = 0.8) -> void:
	for m in [tree_material(), shadow_material()] + _card_materials.values():
		m.set_shader_parameter("wind_strength", strength)
		m.set_shader_parameter("wind_direction", direction.normalized())
		m.set_shader_parameter("wind_speed", speed)

## Player head position for the near-calm zone. Call every frame while wind is on
## (e.g. TreeKit.set_viewer(xr_camera.global_position)) so shadows match the calm
## geometry. Pass `enabled = false` to fall back to the rendering camera.
static func set_viewer(position: Vector3, enabled: bool = true) -> void:
	for m in [tree_material(), shadow_material()] + _card_materials.values():
		m.set_shader_parameter("viewer_position", position)
		m.set_shader_parameter("use_viewer_position", enabled)

## Emission multiplier for pods, fungus and strand tips (day ~0.5, night ~1.6).
static func set_glow(energy: float) -> void:
	tree_material().set_shader_parameter("emission_energy", energy)

## Drops cached meshes/materials (call on zone unload or before quitting tools).
static func clear_cache() -> void:
	_mesh_cache.clear()
	_card_materials.clear()
	_material = null
	_pickup_mesh = null

# --------------------------------------------------------------------------
# Mesh buffer
# --------------------------------------------------------------------------

class MeshBuf:
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()

	## Flat triangle. `outward` is any vector pointing to the visible side.
	## `uvs` (3 entries, optional) and `mode` feed the shader's surface modes (UV2.y, see _SHADER_CODE).
	func tri(a: Vector3, b: Vector3, c: Vector3, col: Color, outward: Vector3, wa: float, wb: float, wc: float, glow: float = 0.0, uvs: Array = [], mode: float = 0.0) -> void:
		var n = (b - a).cross(c - a)
		if n.length_squared() < 1e-12: return
		n = n.normalized()
		var ua: Vector2 = uvs[0] if uvs.size() == 3 else Vector2.ZERO
		var ub: Vector2 = uvs[1] if uvs.size() == 3 else Vector2.ZERO
		var uc: Vector2 = uvs[2] if uvs.size() == 3 else Vector2.ZERO
		if n.dot(outward) < 0.0:
			var t = b; b = c; c = t
			var tw = wb; wb = wc; wc = tw
			var tu = ub; ub = uc; uc = tu
			n = -n
		# Godot front faces are clockwise as seen from the normal side.
		var lin = col.srgb_to_linear()
		for p in [[a, wa, ua], [c, wc, uc], [b, wb, ub]]:
			verts.append(p[0])
			normals.append(n)
			colors.append(Color(lin.r, lin.g, lin.b, clampf(p[1], 0.0, 1.0)))
			uv.append(p[2])
			uv2.append(Vector2(glow, mode))

	func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, col: Color, outward: Vector3, wa: float, wb: float, wc: float, wd: float, glow: float = 0.0, uvs: Array = [], mode: float = 0.0) -> void:
		var four = uvs.size() == 4
		tri(a, b, c, col, outward, wa, wb, wc, glow, [uvs[0], uvs[1], uvs[2]] if four else [], mode)
		tri(a, c, d, col, outward, wa, wc, wd, glow, [uvs[0], uvs[2], uvs[3]] if four else [], mode)

	## Double-sided leaf card (mode 1): `q` corners, per-corner soft normals `ns`, wind weights `w`, sprig UVs.
	func card(q: Array, ns: Array, col: Color, w: Array, uvs: Array) -> void:
		var lin = col.srgb_to_linear()
		for k in [0, 1, 2, 0, 2, 3]:
			verts.append(q[k])
			normals.append(ns[k])
			colors.append(Color(lin.r, lin.g, lin.b, clampf(w[k], 0.0, 1.0)))
			uv.append(uvs[k])
			uv2.append(Vector2(0.0, 1.0))

	func append_transformed(other: MeshBuf, xf: Transform3D, tint: Color = Color.WHITE) -> void:
		var basis_n = xf.basis.inverse().transposed()
		for i in other.verts.size():
			verts.append(xf * other.verts[i])
			normals.append((basis_n * other.normals[i]).normalized())
			var c = other.colors[i]
			colors.append(Color(c.r * tint.r, c.g * tint.g, c.b * tint.b, c.a))
			uv.append(other.uv[i])
			uv2.append(other.uv2[i])

	func triangle_count() -> int:
		return verts.size() / 3

	func commit(mesh: ArrayMesh = null) -> ArrayMesh:
		if mesh == null: mesh = ArrayMesh.new()
		if verts.is_empty(): return mesh
		var arrays = []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = verts
		arrays[Mesh.ARRAY_NORMAL] = normals
		arrays[Mesh.ARRAY_COLOR] = colors
		arrays[Mesh.ARRAY_TEX_UV] = uv
		arrays[Mesh.ARRAY_TEX_UV2] = uv2
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		return mesh

# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

## Build a standalone tree node. Options (all optional):
##   height: float        total height in metres (species default)
##   lod: "near"|"far"    mesh detail (default "near")
##   lod_switch: float    if > 0, adds a FAR child and swaps at this distance (visibility ranges)
##   choppable: bool      split the trunk into the unit-taper chop mesh + ChopProxy body (default false)
##   collision: bool      add the ChopProxy trunk body even if not choppable (default true)
##   fruit: bool          apples/cones/pods (default true)
##   pickups: int         number of reachable apples to leave OUT of the mesh (the adapter
##                        spawns them as harvestable resources); reach_points always returned
##   reach_height: float  target centre height of reachable apples (default 1.8)
##   cards: bool          painterly alpha-scissor leaf cards (default false)
##   palette: String      palette key override, e.g. "apple_autumn"
##   shadows: bool        cast shadows (default true)
static func make_tree(species: String, seed: int, opts: Dictionary = {}) -> Node3D:
	var node = Node3D.new()
	node.name = "Tree_%s_%d" % [species, seed]
	build_into(node, species, seed, opts)
	return node

## Builds the tree's children directly under `node` (MeshInstance3D children stay
## direct children so the game's felling copy duplicates them). Returns info:
##   {trunk, crown, far, cards, proxy, reach_points, chop_band, triangles, skeleton}
static func build_into(node: Node3D, species: String, seed: int, opts: Dictionary = {}) -> Dictionary:
	assert(species in SPECIES, "TreeKit: unknown species " + species)
	var sk = _skeleton(species, seed, opts)
	if species == "apple" and bool(opts.get("dynamic_fruit", false)) and sk.fruit.size() > 6:
		# Every visible fruit is interactive. Six well-spaced apples per tree keep
		# the orchard readable without a thousand broad-phase collision shapes.
		var selected = []
		for i in 6: selected.append(sk.fruit[floori(float(i) * float(sk.fruit.size()) / 6.0)])
		sk.fruit = selected
	var lod: String = opts.get("lod", "near")
	var choppable: bool = opts.get("choppable", false)
	var shadows: bool = opts.get("shadows", true)
	var info = {"reach_points": sk.reach_points, "chop_band": Vector2(0.35, sk.trunk.height - 0.1), "skeleton": sk}
	var crown_cached = _crown_mesh(sk, lod, not choppable, opts)
	var crown = MeshInstance3D.new()
	crown.name = "Crown"
	crown.mesh = crown_cached.mesh
	crown.material_override = tree_material()
	crown.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	node.add_child(crown)
	if shadows and lod == "near": _dapple_shadow(crown)
	info["crown"] = crown
	var triangles: int = crown_cached.triangles
	if choppable:
		var trunk = MeshInstance3D.new()
		trunk.name = "Trunk"
		trunk.mesh = _unit_trunk_mesh(sk.palette, 8 if lod == "near" else 5, float(sk.trunk.height) if sk.hero else 0.0)
		trunk.material_override = tree_material()
		trunk.transform = _trunk_transform(sk.trunk)
		# The visible crown stops casting when a dappled twin takes over (see _dapple_shadow); the trunk is never
		# punched and must keep its own solid shadow.
		trunk.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(trunk)
		info["trunk"] = trunk
		triangles += trunk.mesh.get_faces().size() / 3
	if bool(opts.get("cards", false)) and lod == "near" and species != "deadwood":
		var cards = MeshInstance3D.new()
		cards.name = "LeafCards"
		cards.mesh = _cards_mesh(sk)
		cards.material_override = card_material()
		cards.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(cards)
		info["cards"] = cards
	var lod_switch: float = opts.get("lod_switch", 0.0)
	if lod_switch > 0.0 and lod == "near":
		var far = MeshInstance3D.new()
		far.name = "Far"
		far.mesh = _crown_mesh(sk, "far", true, opts).mesh
		far.material_override = tree_material()
		far.visibility_range_begin = lod_switch
		far.visibility_range_begin_margin = 1.0
		far.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
		node.add_child(far)
		for child in [crown, info.get("trunk"), info.get("cards")]:
			if child != null:
				child.visibility_range_end = lod_switch
				child.visibility_range_end_margin = 1.0
				for twin in child.get_children():
					if twin is MeshInstance3D:
						twin.visibility_range_end = lod_switch
						twin.visibility_range_end_margin = 1.0
		info["far"] = far
	if choppable or bool(opts.get("collision", true)):
		info["proxy"] = _chop_proxy(node, sk.trunk)
	info["triangles"] = triangles
	node.set_meta("tree_species", species)
	node.set_meta("tree_seed", seed)
	node.set_meta("tree_height", sk.height)
	node.set_meta("chop_band", info.chop_band)
	node.set_meta("reach_points", sk.reach_points)
	if species == "apple" and bool(opts.get("dynamic_fruit", false)):
		node.set_meta("apple_fruit", sk.fruit.filter(func(f): return f.kind == "apple"))
		node.add_to_group("interactive_apple_tree")
	node.set_meta("trunk_color", Color(sk.palette.bark[0]))
	return info

## Crown / far mesh with a shared cache: every tree of one (species, seed, height, palette, fruit options) shares the
## same ArrayMesh, so orchard load cost scales with distinct seeds. Pass opts.cache_meshes = false to build a private copy.
static func _crown_mesh(sk: Dictionary, lod: String, include_trunk: bool, opts: Dictionary) -> Dictionary:
	var key = "crown|%s|%d|%s|%s|%s|%s|%s|%s|%s|%s|%s" % [sk.species, sk.seed, str(sk.height), str(opts.get("palette", "")), lod, include_trunk,
		str(opts.get("fruit", true)), str(opts.get("dynamic_fruit", false)), str(opts.get("pickups", 0)), str(opts.get("reach_height", 1.8)), str(opts.get("form", ""))]
	var cached: bool = bool(opts.get("cache_meshes", true))
	if cached and _mesh_cache.has(key): return _mesh_cache[key]
	var buf = MeshBuf.new()
	_mesh_skeleton(buf, sk, lod, include_trunk, opts)
	var entry = {"mesh": buf.commit(), "triangles": buf.triangle_count()}
	if cached: _mesh_cache[key] = entry
	return entry

## Integration adapter for choppable timber. `resource_node` is the Node3D returned by
## WorldZones.resource(root, data, zone, pos, "lumber", "axe", amount); gameplay meta
## on it is untouched. Adds Crown + Trunk + ChopProxy and sets the `trunk`/`trunk_mesh`
## meta that melee_contact.notch() and adventure_runtime respawn expect.
## Do NOT also call WorldZones.body() for this node; the ChopProxy replaces it.
static func adapt_timber(resource_node: Node3D, species: String = "apple", seed: int = 0, opts: Dictionary = {}) -> Dictionary:
	var o = opts.duplicate()
	o["choppable"] = true
	o["collision"] = true
	var info = build_into(resource_node, species, seed, o)
	resource_node.set_meta("trunk", info.trunk)
	resource_node.set_meta("trunk_mesh", info.trunk.mesh)
	return info

## Visual for an "apple" harvest resource (WorldZones.resource(..., "apple", "", 3)):
## a small hanging cluster with twig and one 0.45 m box body, the same body size the
## current pinewood pickup uses. Place the resource node at a reach point from a tree.
static func dress_apple_pickup(resource_node: Node3D, count: int = 3, twig_length: float = 0.18) -> void:
	var mesh = _apple_pickup_mesh(count, twig_length)
	var mi = MeshInstance3D.new()
	mi.name = "Apples"
	mi.mesh = mesh
	mi.material_override = tree_material()
	resource_node.add_child(mi)
	var body = StaticBody3D.new()
	body.name = "AppleBody"
	var col = CollisionShape3D.new()
	var shape = BoxShape3D.new()
	shape.size = Vector3.ONE * 0.45
	col.shape = shape
	body.add_child(col)
	resource_node.add_child(body)

## Cached single-surface mesh (trunk included) for instancing / merging.
static func tree_mesh(species: String, seed: int, lod: String = "far", opts: Dictionary = {}) -> ArrayMesh:
	var key = "%s|%d|%s|%s|%s|%s" % [species, seed, lod, str(opts.get("height", 0.0)), str(opts.get("palette", "")), str(opts.get("fruit", true))]
	if _mesh_cache.has(key): return _mesh_cache[key]
	var buf = MeshBuf.new()
	_mesh_skeleton(buf, _skeleton(species, seed, opts), lod, true, opts)
	var mesh = buf.commit()
	_mesh_cache[key] = mesh
	return mesh

## Batched grove. placements: Array of Dictionary
##   {species: String, position: Vector3, seed: int, yaw: float = seeded, scale: float = 1}
## opts: lod ("far"), mode ("multimesh" | "merged"), variants (3 meshes per species for
## multimesh), shadows (false), palette/height overrides.
## multimesh: one draw call per (species, variant). merged: ONE draw call for the grove
## (every tree baked uniquely; use for static chunks up to a few thousand triangles x N).
static func make_grove(placements: Array, opts: Dictionary = {}) -> Node3D:
	var root = Node3D.new()
	root.name = "TreeGrove"
	var lod: String = opts.get("lod", "far")
	var mode: String = opts.get("mode", "multimesh")
	var variants: int = maxi(1, int(opts.get("variants", 3)))
	var shadows: bool = opts.get("shadows", false)
	var cast = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if mode == "merged":
		var buf = MeshBuf.new()
		for p in placements:
			var sp: String = p.species
			var o = opts.duplicate()
			o.merge(p, true)
			var tree_buf = MeshBuf.new()
			_mesh_skeleton(tree_buf, _skeleton(sp, int(p.get("seed", 0)), o), lod, true, o)
			buf.append_transformed(tree_buf, _placement_transform(p))
		var mi = MeshInstance3D.new()
		mi.name = "Merged"
		mi.mesh = buf.commit()
		mi.material_override = tree_material()
		mi.cast_shadow = cast
		root.add_child(mi)
		root.set_meta("triangles", buf.triangle_count())
		return root
	var groups = {}
	for p in placements:
		var key = "%s:%d" % [p.species, posmod(int(p.get("seed", 0)), variants)]
		if not groups.has(key): groups[key] = []
		groups[key].append(p)
	var tri_total = 0
	for key in groups:
		var list: Array = groups[key]
		var sp: String = list[0].species
		var mesh = tree_mesh(sp, posmod(int(list[0].get("seed", 0)), variants) + 1, lod, opts)
		var mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = list.size()
		for i in list.size(): mm.set_instance_transform(i, _placement_transform(list[i]))
		var mmi = MultiMeshInstance3D.new()
		mmi.name = "Grove_" + key.replace(":", "_")
		mmi.multimesh = mm
		if bool(opts.get("builder_addresses", false)):
			var addresses: Array = []
			var builder_origin: Vector3 = opts.get("builder_origin", Vector3.ZERO)
			for placement in list: addresses.append(placement.position + builder_origin)
			mmi.set_meta("builder_positions", addresses)
		mmi.material_override = tree_material()
		mmi.cast_shadow = cast
		root.add_child(mmi)
		tri_total += mesh.get_faces().size() / 3 * list.size()
	root.set_meta("triangles", tri_total)
	return root

## Convenience scatter: deterministic mixed placements inside an annulus.
static func scatter(species_weights: Dictionary, count: int, center: Vector3, inner: float, outer: float, seed: int) -> Array:
	var rng = RandomNumberGenerator.new()
	rng.seed = seed
	var total = 0.0
	for k in species_weights: total += float(species_weights[k])
	var out = []
	for i in count:
		var a = rng.randf() * TAU
		var r = sqrt(lerpf(inner * inner, outer * outer, rng.randf()))
		var pick = rng.randf() * total
		var sp: String = species_weights.keys()[0]
		for k in species_weights:
			pick -= float(species_weights[k])
			if pick <= 0.0: sp = k; break
		out.append({"species": sp, "position": center + Vector3(cos(a) * r, 0, sin(a) * r), "seed": rng.randi() % 100000, "scale": rng.randf_range(0.85, 1.15)})
	return out

# --------------------------------------------------------------------------
# Skeleton generation (LOD independent)
# --------------------------------------------------------------------------

static func _rng(species: String, seed: int, salt: int = 0) -> RandomNumberGenerator:
	var rng = RandomNumberGenerator.new()
	rng.seed = hash([species, seed, salt])
	return rng

static func _skeleton(species: String, seed: int, opts: Dictionary) -> Dictionary:
	var h: float = opts.get("height", DEFAULT_HEIGHT[species])
	var pal_key: String = opts.get("palette", species)
	var sk = {"species": species, "seed": seed, "height": h, "palette": PALETTES.get(pal_key, PALETTES[species]),
		"tubes": [], "blobs": [], "fruit": [], "skirts": [], "strands": [], "fungus": [], "twigs": [],
		"reach_points": [], "clumps": [], "hero": false, "fruit_enabled": bool(opts.get("fruit", true))}
	var rng = _rng(species, seed)
	match species:
		"apple": _skel_apple(sk, rng, opts)
		"pine": _skel_pine(sk, rng, opts)
		"fen": _skel_fen(sk, rng, opts)
		"deadwood": _skel_deadwood(sk, rng, opts)
	return sk

static func _dir(azimuth: float, from_vertical: float) -> Vector3:
	return Vector3(sin(from_vertical) * cos(azimuth), cos(from_vertical), sin(from_vertical) * sin(azimuth))

static func _trunk(sk: Dictionary, rng: RandomNumberGenerator, height: float, radius: float, max_lean: float) -> void:
	var lean_az = rng.randf() * TAU
	var lean = rng.randf_range(0.0, max_lean)
	var axis = _dir(lean_az, lean)
	sk["trunk"] = {"base": Vector3.ZERO, "axis": axis, "height": height, "radius": radius, "lean_az": lean_az}

static func _trunk_top(sk: Dictionary) -> Vector3:
	return sk.trunk.base + sk.trunk.axis * sk.trunk.height

static func _roots(sk: Dictionary, rng: RandomNumberGenerator, count: int, spread: float, rise: float, radius: float, stilt: bool = false) -> void:
	var r0: float = sk.trunk.radius
	var off = rng.randf() * TAU
	for i in count:
		var a = off + TAU * float(i) / float(count) + rng.randf_range(-0.3, 0.3)
		var out = Vector3(cos(a), 0, sin(a))
		var top: Vector3 = sk.trunk.axis * rise * rng.randf_range(0.8, 1.2) + out * r0 * 0.55
		var reach = spread * rng.randf_range(0.8, 1.25)
		if stilt:
			# Mangrove-style arch: leaves the trunk, bows outward, plunges into the bog.
			var p1: Vector3 = top + out * reach * 0.32 + Vector3.UP * 0.06
			var p2: Vector3 = out * reach * 0.78 + Vector3.UP * top.y * 0.45
			sk.tubes.append({"points": [top, p1, p2, out * reach + Vector3.DOWN * 0.12], "radii": [radius, radius * 0.85, radius * 0.7, radius * 0.5], "wind": 0.0, "kind": "root"})
		else:
			var pts = [top, out * (r0 + reach * 0.45) + Vector3.UP * 0.06, out * (r0 + reach) + Vector3.DOWN * 0.08]
			sk.tubes.append({"points": pts, "radii": [radius, radius * 0.75, radius * 0.4], "wind": 0.0, "kind": "root"})

## Smooth, direction-dependent radius jitter shared by blob meshing and fruit placement.
static func _blob_jitter(b: Dictionary, d: Vector3) -> float:
	var ph: Vector3 = b.phase
	return 1.0 + 0.085 * sin(d.x * 3.1 + d.y * 1.7 + ph.x) + 0.06 * sin(d.z * 4.3 - d.x * 2.2 + ph.y) + 0.04 * sin(d.y * 6.1 + d.z * 2.9 + ph.z)

static func _blob_surface(b: Dictionary, d: Vector3) -> Vector3:
	var r: Vector3 = b.radius
	var p = d.normalized() * _blob_jitter(b, d.normalized())
	if p.y < -b.flat: p.y = lerpf(p.y, -b.flat, 0.6)
	return b.center + Vector3(p.x * r.x, p.y * r.y, p.z * r.z)

static func _add_blob(sk: Dictionary, rng: RandomNumberGenerator, center: Vector3, radius: Vector3, color_index: int, flat: float = 0.45) -> Dictionary:
	var b = {"center": center, "radius": radius, "ci": color_index, "flat": flat,
		"phase": Vector3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU), "spin": rng.randf() * TAU}
	sk.blobs.append(b)
	return b

## rev-4 (Opus art-family pass): seeded growth FORMS break the cloned-orchard look (captures 08/09).
## Drawn from a separate RNG stream, so the main sequence (trunk, low fruit limb, fruit, reach points)
## is unchanged for every existing seed. Forms only touch upper limbs and crown masses.
##   [spread_k, elev_k, crown_y, top_k, side_bias, extra_filler]
const APPLE_FORMS := {
	"classic":   [1.0, 1.0, 1.0, 1.0, 0.0, 0],
	"spreading": [1.28, 1.22, 0.78, 0.82, 0.0, 1],   # wide, flat-topped, old orchard tree
	"upright":   [0.86, 0.72, 1.16, 1.14, 0.0, 0],   # narrow, tall crown, young vigorous tree
	"lopsided":  [1.12, 1.08, 0.92, 0.95, 0.38, 1],  # wind/light-bent, one heavy side
	"billowy":   [1.05, 0.95, 1.05, 1.24, 0.0, 2],   # big domed crown with extra clusters
}
const APPLE_FORM_WEIGHTS := {"classic": 0.24, "spreading": 0.22, "upright": 0.18, "lopsided": 0.2, "billowy": 0.16}

static func apple_form(seed: int) -> String:
	var frng := _rng("apple_form", seed, 91)
	var roll := frng.randf()
	for name in APPLE_FORM_WEIGHTS:
		roll -= float(APPLE_FORM_WEIGHTS[name])
		if roll <= 0.0: return name
	return "classic"

static func _skel_apple_base(sk: Dictionary, rng: RandomNumberGenerator, opts: Dictionary) -> void:
	var h: float = sk.height
	var form_name: String = opts.get("form", apple_form(int(sk.seed)))
	var F: Array = APPLE_FORMS.get(form_name, APPLE_FORMS.classic)
	var frng := _rng("apple_form", int(sk.seed), 92)
	sk["form"] = form_name
	var r0 = h * rng.randf_range(0.056, 0.066)
	_trunk(sk, rng, h * rng.randf_range(0.30, 0.33), r0, 0.07)
	_roots(sk, rng, 5, r0 * 1.5, 0.42, r0 * 0.42)
	var top = _trunk_top(sk)
	# Short upper trunk that the limbs grow from; continues the chop taper.
	var collar: Vector3 = top + sk.trunk.axis * h * 0.06 + Vector3(rng.randf_range(-0.08, 0.08), 0, rng.randf_range(-0.08, 0.08))
	sk.tubes.append({"points": [top - sk.trunk.axis * 0.12, collar], "radii": [r0 * 0.5, r0 * 0.46], "wind": 0.0, "kind": "trunk"})
	var limbs = 3 + rng.randi_range(0, 1)
	var az0 = rng.randf() * TAU
	var lowest = []
	for i in limbs:
		var az = az0 + TAU * float(i) / float(limbs) + rng.randf_range(-0.35, 0.35)
		# Limb 0 is a low, spreading limb: it carries the reachable fruit and gives
		# each tree an asymmetric, hand-made silhouette.
		var low: bool = i == 0
		var elev = rng.randf_range(1.2, 1.35) if low else rng.randf_range(0.8, 1.1)
		var length = h * (rng.randf_range(0.3, 0.34) if low else rng.randf_range(0.26, 0.32))
		if not low:   # rev-4 form: upper limbs only (low fruit limb and its reach points untouched)
			var side: float = 1.0 + float(F[4]) * cos(az - az0 - 0.6)
			length *= float(F[0]) * side * frng.randf_range(0.9, 1.12)
			elev = minf(elev * float(F[1]), 1.45)
		var o: Vector3 = collar + Vector3.DOWN * rng.randf_range(0.0, 0.12)
		var d1 = _dir(az, elev)
		var d2 = _dir(az + rng.randf_range(-0.25, 0.25), elev * (0.85 if low else 0.72))
		var mid = o + d1 * length * 0.55
		var tip = mid + d2 * length * 0.5
		sk.tubes.append({"points": [o, mid, tip], "radii": [r0 * 0.44, r0 * 0.32, r0 * 0.18], "wind": 0.0, "kind": "limb"})
		var br = h * (rng.randf_range(0.17, 0.19) if low else rng.randf_range(0.2, 0.23))
		var cy: float = 1.0 if low else float(F[2]) * frng.randf_range(0.9, 1.1)
		var cw: float = 1.0 if low else frng.randf_range(0.85, 1.2)
		var b = _add_blob(sk, rng, tip + Vector3.UP * br * 0.05, Vector3(br * cw, br * 0.84 * cy, br * cw) * Vector3(rng.randf_range(0.95, 1.1), 1, rng.randf_range(0.95, 1.1)), i % 4, 0.68)
		lowest.append(b)
		# Two small lumps on the sunlit outer shoulder break the silhouette into clusters.
		for k in 2:
			var la = az + rng.randf_range(-0.9, 0.9)
			var lr = br * rng.randf_range(0.42, 0.52)
			var lp = _blob_surface(b, Vector3(cos(la), rng.randf_range(0.1, 0.6), sin(la)).normalized())
			_add_blob(sk, rng, b.center + (lp - b.center) * 0.78, Vector3(lr, lr * 0.86, lr), (i + k + 1) % 4, 0.7)
		# One side branch per limb carries a smaller cluster.
		var saz = az + (0.75 if rng.randf() < 0.5 else -0.75) + rng.randf_range(-0.2, 0.2)
		var sd = _dir(saz, rng.randf_range(0.6, 0.9))
		var stip = mid + sd * length * 0.5
		sk.tubes.append({"points": [mid, mid + sd * length * 0.28 + Vector3.UP * 0.05, stip], "radii": [r0 * 0.2, r0 * 0.14, r0 * 0.09], "wind": 0.0, "kind": "branch"})
		var sr = br * rng.randf_range(0.72, 0.85)
		_add_blob(sk, rng, stip + Vector3.UP * sr * 0.25, Vector3(sr, sr * 0.84, sr), (i + 2) % 4, 0.68)
	# Crown top and filler clusters close the canopy into one rounded mass.
	var tr = h * rng.randf_range(0.22, 0.25)
	var tk: float = float(F[3]) * frng.randf_range(0.92, 1.08)
	var top_off := Vector3(rng.randf_range(-0.2, 0.2), 0, rng.randf_range(-0.2, 0.2)) + Vector3(cos(az0 - 0.6), 0, sin(az0 - 0.6)) * h * 0.08 * float(F[4])
	_add_blob(sk, rng, collar + top_off + Vector3.UP * (h - collar.y - tr * 0.84 * float(F[2])), Vector3(tr * tk, tr * 0.84 * tk * float(F[2]), tr * tk), 2, 0.68)
	for j in 2:
		var fr = h * rng.randf_range(0.17, 0.19)
		var faz = az0 + TAU * (float(j) + 0.5) / 2.0 + rng.randf_range(-0.4, 0.4)
		_add_blob(sk, rng, collar + Vector3(0, h * rng.randf_range(0.26, 0.32), 0) + Vector3(cos(faz), 0, sin(faz)) * h * 0.14 * float(F[0]), Vector3(fr, fr * 0.84 * float(F[2]), fr), (j + 1) % 4, 0.68)
	# rev-4 form: extra outer clusters (separate RNG) give billowy/spreading crowns a broken, clumped edge
	for j in int(F[5]):
		var ea: float = az0 + frng.randf_range(0.0, TAU)
		var er := h * frng.randf_range(0.12, 0.16)
		var ep := collar + Vector3(cos(ea), 0, sin(ea)) * h * frng.randf_range(0.22, 0.3) * float(F[0]) + Vector3.UP * h * frng.randf_range(0.2, 0.34)
		_add_blob(sk, frng, ep, Vector3(er, er * 0.8 * float(F[2]), er), (j + 3) % 4, 0.7)
	if not sk.fruit_enabled: return
	# Apples sit on the lower/outer surface of clusters, embedded so they read as hanging in leaves.
	var apples = []
	var axis_xz = Vector3(collar.x, 0, collar.z)
	for b in sk.blobs:
		var count = int(round(b.radius.x * 2.0)) + rng.randi_range(-1, 1)
		var tries = 0
		while count > 0 and tries < 24:
			tries += 1
			var out: Vector3 = Vector3(b.center.x, 0, b.center.z) - axis_xz
			var az = atan2(out.z, out.x) + rng.randf_range(-1.9, 1.9) if out.length() > 0.2 else rng.randf() * TAU
			var d = Vector3(cos(az), rng.randf_range(-0.8, 0.35), sin(az)).normalized()
			var p = _blob_surface(b, d)
			p = b.center + (p - b.center) * 0.94 + Vector3.DOWN * 0.02
			var ok = p.y > 1.9 and Vector2(p.x - collar.x, p.z - collar.z).length() > 0.55
			for q in apples:
				if q.distance_to(p) < 0.3: ok = false
			if not ok: continue
			apples.append(p)
			sk.fruit.append({"pos": p, "kind": "apple", "ci": rng.randi() % 3, "spin": rng.randf() * TAU, "tilt": rng.randf_range(-0.35, 0.35)})
			count -= 1
	# Reachable fruit: hang from the underside of the lowest limb clusters on a short twig.
	lowest.sort_custom(func(a, b): return a.center.y < b.center.y)
	var reach_h: float = opts.get("reach_height", 1.8)
	var pickups: int = opts.get("pickups", 0)
	for i in mini(2, lowest.size()):
		var b: Dictionary = lowest[i]
		var out: Vector3 = (Vector3(b.center.x, 0, b.center.z) - axis_xz).normalized()
		var under = _blob_surface(b, (out * 0.35 + Vector3.DOWN).normalized())
		var y = clampf(reach_h, under.y - 0.55, under.y - 0.12)
		var p = Vector3(under.x, y, under.z)
		sk.reach_points.append(p)
		sk.twigs.append({"from": under + Vector3.UP * 0.12, "to": p + Vector3.UP * 0.1, "leaf": true})
		if i >= pickups:
			sk.fruit.append({"pos": p, "kind": "apple", "ci": i % 3, "spin": rng.randf() * TAU, "tilt": 0.0})

## Apple = the proven base skeleton (trunk, low fruit limb, blobs, fruit, reach points: identical for every seed) plus a hero
## growth layer drawn from its own RNG stream.
static func _skel_apple(sk: Dictionary, rng: RandomNumberGenerator, opts: Dictionary) -> void:
	_skel_apple_base(sk, rng, opts)
	sk["hero"] = true
	_hero_apple(sk)

static func _path_at(pts: Array, t: float) -> Array:
	var n = pts.size() - 1
	var f = clampf(t, 0.0, 0.999) * float(n)
	var k = int(f)
	var u = f - float(k)
	return [pts[k].lerp(pts[k + 1], u), (pts[k + 1] - pts[k]).normalized()]

static func _radius_at(radii: Array, t: float) -> float:
	var n = radii.size() - 1
	var f = clampf(t, 0.0, 0.999) * float(n)
	var k = int(f)
	return lerpf(float(radii[k]), float(radii[k + 1]), f - float(k))

## Gnarled growth layer: crotch swell, a curving central leader, two extra scaffold limbs, forked secondary branches and
## twigs that end in small leaf clumps (sk.clumps), plus three long surface roots. Never touches sk.blobs/fruit/reach_points.
static func _hero_apple(sk: Dictionary) -> void:
	var h: float = sk.height
	var hr = _rng("apple_hero", int(sk.seed), 93)
	var r0: float = sk.trunk.radius
	var axis: Vector3 = sk.trunk.axis
	var top = _trunk_top(sk)
	var collar: Vector3 = top
	var parents = []
	for tb in sk.tubes:
		if tb.kind == "trunk": collar = tb.points.back()
		elif tb.kind == "limb": parents.append({"points": tb.points, "radii": tb.radii})
	sk.tubes.append({"points": [top - axis * 0.22, top + axis * 0.05, collar + Vector3.UP * 0.07], "radii": [r0 * 0.5, r0 * 0.6, r0 * 0.5], "wind": 0.0, "kind": "trunk"})
	var lean = Vector3(hr.randf_range(-1.0, 1.0), 0, hr.randf_range(-1.0, 1.0)) * h * 0.045
	var lead_len: float = maxf(h - collar.y - h * 0.1, 1.0)
	var lead = [collar - axis * 0.05, collar + Vector3.UP * lead_len * 0.35 + lean * 0.5, collar + Vector3.UP * lead_len * 0.7 - lean * 0.35, collar + Vector3.UP * lead_len + lean * 0.2]
	sk.tubes.append({"points": lead, "radii": [r0 * 0.4, r0 * 0.3, r0 * 0.17, r0 * 0.06], "wind": 0.0, "kind": "leader"})
	var az0 = hr.randf() * TAU
	for i in 2:
		var az = az0 + PI * float(i) + hr.randf_range(-0.6, 0.6)
		var elev = hr.randf_range(0.85, 1.25)
		var length = h * hr.randf_range(0.2, 0.27)
		var o: Vector3 = collar + Vector3.DOWN * hr.randf_range(0.05, 0.2)
		var mid: Vector3 = o + _dir(az, elev) * length * 0.5
		var tip: Vector3 = mid + _dir(az + hr.randf_range(-0.3, 0.3), elev * 0.8) * length * 0.5 + Vector3.UP * 0.08
		var tube = {"points": [o, mid, tip], "radii": [r0 * 0.36, r0 * 0.25, r0 * 0.12], "wind": 0.0, "kind": "scaffold"}
		sk.tubes.append(tube)
		parents.append({"points": tube.points, "radii": tube.radii})
	for pr in parents:
		for j in 2:
			var t = (0.34 + 0.34 * float(j)) + hr.randf_range(-0.06, 0.06)
			var at = _path_at(pr.points, t)
			var rad = _radius_at(pr.radii, t)
			var length = h * hr.randf_range(0.1, 0.15)
			var side = Vector3(hr.randf_range(-1.0, 1.0), hr.randf_range(-0.2, 0.5), hr.randf_range(-1.0, 1.0)).normalized()
			var d = (at[1] * 0.5 + side * 0.8).normalized()
			_hero_branch(sk, hr, at[0], d, length, rad * 0.5, 1)
	var off = hr.randf() * TAU
	for i in 3:
		var a = off + TAU * float(i) / 3.0 + hr.randf_range(-0.5, 0.5)
		var out = Vector3(cos(a), 0, sin(a))
		var reach = r0 * hr.randf_range(2.2, 3.4)
		sk.tubes.append({"points": [axis * 0.34 + out * r0 * 0.5, out * r0 * 1.2 + Vector3.UP * 0.09, out * (r0 + reach * 0.6) + Vector3.UP * 0.02, out * (r0 + reach) + Vector3.DOWN * 0.1],
			"radii": [r0 * 0.3, r0 * 0.22, r0 * 0.14, r0 * 0.06], "wind": 0.0, "kind": "root"})

static func _hero_branch(sk: Dictionary, hr: RandomNumberGenerator, o: Vector3, dir: Vector3, length: float, radius: float, depth: int) -> void:
	var side = dir.cross(Vector3(hr.randf_range(-1.0, 1.0), hr.randf_range(-0.3, 0.3), hr.randf_range(-1.0, 1.0))).normalized()
	var d1 = (dir.rotated(side, hr.randf_range(-0.2, 0.4)) + Vector3.UP * 0.16).normalized()
	var d2 = (d1.rotated(side, hr.randf_range(-0.35, 0.45)) + Vector3.UP * 0.1).normalized()
	var mid: Vector3 = o + d1 * length * 0.55
	var tip: Vector3 = mid + d2 * length * 0.45
	sk.tubes.append({"points": [o, mid, tip], "radii": [radius, radius * 0.62, radius * 0.32], "wind": 0.0, "kind": "branch" if depth > 0 else "twig"})
	if depth > 0:
		var fork_axis = d2.cross(Vector3.UP)
		if fork_axis.length_squared() < 0.01: fork_axis = Vector3.RIGHT
		fork_axis = fork_axis.normalized()
		_hero_branch(sk, hr, mid, d1.rotated(fork_axis, -0.7).rotated(Vector3.UP, hr.randf_range(-0.6, 0.6)), length * 0.62, radius * 0.5, depth - 1)
		_hero_branch(sk, hr, tip, d2.rotated(fork_axis, 0.45).rotated(Vector3.UP, hr.randf_range(-0.6, 0.6)), length * 0.62, radius * 0.5, depth - 1)
	else:
		var cr = hr.randf_range(0.34, 0.5)
		sk.clumps.append({"center": tip + d2 * cr * 0.35 + Vector3.UP * cr * 0.1, "radius": Vector3(cr, cr * 0.8, cr), "ci": hr.randi() % 4, "flat": 0.6,
			"phase": Vector3(hr.randf() * TAU, hr.randf() * TAU, hr.randf() * TAU), "spin": hr.randf() * TAU})

static func _skel_pine(sk: Dictionary, rng: RandomNumberGenerator, opts: Dictionary) -> void:
	var h: float = sk.height
	var r0 = h * rng.randf_range(0.04, 0.047)
	var first = maxf(h * 0.24, 1.75)
	_trunk(sk, rng, first + 0.15, r0, 0.05)
	_roots(sk, rng, 4, r0 * 1.3, 0.3, r0 * 0.4)
	var top = _trunk_top(sk)
	var tip: Vector3 = sk.trunk.axis * h * 0.97 + Vector3(rng.randf_range(-0.1, 0.1), 0, rng.randf_range(-0.1, 0.1))
	sk.tubes.append({"points": [top - sk.trunk.axis * 0.1, top.lerp(tip, 0.5), tip], "radii": [r0 * 0.5, r0 * 0.3, r0 * 0.08], "wind": 0.0, "kind": "trunk"})
	var tiers = 5 + rng.randi_range(0, 1)
	var rot = rng.randf() * TAU
	for i in tiers:
		var t = float(i) / float(tiers - 1)
		var y = lerpf(first, h * 0.8, pow(t, 0.9))
		var radius = lerpf(h * 0.35, h * 0.1, t) * rng.randf_range(0.9, 1.08)
		var height = lerpf(h * 0.26, h * 0.2, t)
		var centre: Vector3 = tip.lerp(top, 1.0 - (y - top.y) / maxf(tip.y - top.y, 0.1)) * Vector3(1, 0, 1) + Vector3.UP * y
		rot += rng.randf_range(0.4, 1.2)
		sk.skirts.append({"center": centre, "radius": radius, "height": height, "rot": rot, "lobes": 9 if radius > h * 0.2 else 7,
			"droop": rng.randf_range(0.08, 0.14) * radius, "ci": i % 4, "seed": rng.randi(), "tier": t})
	if not sk.fruit_enabled: return
	for i in 5:
		var s: Dictionary = sk.skirts[1 + i % maxi(1, tiers - 2)]
		var a: float = s.rot + TAU * float(rng.randi() % int(s.lobes)) / float(s.lobes) + PI / float(s.lobes)
		var p: Vector3 = s.center + Vector3(cos(a), 0, sin(a)) * s.radius * rng.randf_range(0.5, 0.7) + Vector3.DOWN * s.droop * 0.3
		sk.fruit.append({"pos": p, "kind": "cone", "ci": i % 3, "spin": rng.randf() * TAU, "tilt": rng.randf_range(-0.3, 0.3)})

static func _skel_fen(sk: Dictionary, rng: RandomNumberGenerator, opts: Dictionary) -> void:
	var h: float = sk.height
	var r0 = h * rng.randf_range(0.055, 0.065)
	_trunk(sk, rng, h * rng.randf_range(0.28, 0.32), r0, 0.2)
	_roots(sk, rng, 4, r0 * 3.4, 0.8, r0 * 0.4, true)
	_roots(sk, rng, 4, r0 * 1.2, 0.35, r0 * 0.4)
	var top = _trunk_top(sk)
	# S-curve: the upper trunk swings back over the base.
	var back: Vector3 = -Vector3(sk.trunk.axis.x, 0, sk.trunk.axis.z).normalized() if Vector2(sk.trunk.axis.x, sk.trunk.axis.z).length() > 0.01 else Vector3.RIGHT
	var collar = top + Vector3.UP * h * 0.12 + back * h * 0.06
	sk.tubes.append({"points": [top - sk.trunk.axis * 0.12, top + Vector3.UP * h * 0.06 + back * 0.02, collar], "radii": [r0 * 0.5, r0 * 0.45, r0 * 0.4], "wind": 0.0, "kind": "trunk"})
	var limbs = 3 + rng.randi_range(0, 1)
	var az0 = rng.randf() * TAU
	for i in limbs:
		var az = az0 + TAU * float(i) / float(limbs) + rng.randf_range(-0.3, 0.3)
		var out = Vector3(cos(az), 0, sin(az))
		var reach = h * rng.randf_range(0.3, 0.38)
		var rise = h * rng.randf_range(0.2, 0.3)
		var p1 = collar + out * reach * 0.35 + Vector3.UP * rise * 0.8
		var p2 = collar + out * reach * 0.75 + Vector3.UP * rise
		var p3 = collar + out * reach + Vector3.UP * rise * 0.6
		sk.tubes.append({"points": [collar, p1, p2, p3], "radii": [r0 * 0.36, r0 * 0.26, r0 * 0.18, r0 * 0.1], "wind": 0.0, "kind": "limb"})
		var br = h * rng.randf_range(0.17, 0.21)
		var b = _add_blob(sk, rng, p2 + Vector3.UP * br * 0.15, Vector3(br * 1.15, br * 0.62, br), i % 4, 0.35)
		var b2 = _add_blob(sk, rng, p1.lerp(p2, 0.3) + Vector3.UP * br * 0.3, Vector3(br * 0.85, br * 0.58, br * 0.85), (i + 1) % 4, 0.35)
		# Willow curtains hang from the outer under-edge of each canopy pad.
		for blob in [b, b2]:
			var n = 10 if blob == b else 6
			for j in n:
				var a = az + rng.randf_range(-1.8, 1.8)
				var d = Vector3(cos(a), -0.45, sin(a)).normalized()
				var s = _blob_surface(blob, d) + Vector3.DOWN * 0.03
				var length = clampf(rng.randf_range(0.6, 1.7), 0.4, s.y - 1.35)
				if length < 0.35: continue
				sk.strands.append({"from": s, "length": length, "bow": d * Vector3(1, 0, 1) * rng.randf_range(0.05, 0.18), "w": 0.35})
		if sk.fruit_enabled:
			for j in 2:
				var a = az + rng.randf_range(-1.2, 1.2)
				var s = _blob_surface(b, Vector3(cos(a), -0.7, sin(a)).normalized())
				var drop = rng.randf_range(0.25, 0.55)
				sk.fruit.append({"pos": s + Vector3.DOWN * drop, "kind": "pod", "ci": (i + j) % 3, "spin": rng.randf() * TAU, "tilt": 0.0, "thread": s})
	var tr = h * 0.16
	_add_blob(sk, rng, collar + Vector3.UP * h * 0.3, Vector3(tr * 1.1, tr * 0.6, tr * 1.1), 3, 0.3)
	for i in 4:
		var a = rng.randf() * TAU
		var y = rng.randf_range(0.15, 0.55) if i < 2 else rng.randf_range(sk.trunk.height * 0.55, sk.trunk.height * 0.95)
		sk.fungus.append({"a": a, "y": y, "size": rng.randf_range(0.18, 0.28), "ci": i % 2})

static func _skel_deadwood(sk: Dictionary, rng: RandomNumberGenerator, opts: Dictionary) -> void:
	var h: float = sk.height
	var r0 = h * rng.randf_range(0.05, 0.06)
	_trunk(sk, rng, h * rng.randf_range(0.32, 0.36), r0, 0.12)
	_roots(sk, rng, 5, r0 * 2.0, 0.45, r0 * 0.42)
	var top = _trunk_top(sk)
	var collar: Vector3 = top + sk.trunk.axis * h * 0.1 + Vector3(rng.randf_range(-0.15, 0.15), 0, rng.randf_range(-0.15, 0.15))
	sk.tubes.append({"points": [top - sk.trunk.axis * 0.12, collar], "radii": [r0 * 0.5, r0 * 0.42], "wind": 0.0, "kind": "trunk"})
	_branch(sk, rng, collar, Vector3.UP, h * 0.34, r0 * 0.4, 3, h)
	for i in 5:
		var a = rng.randf() * TAU
		var y = rng.randf_range(0.2, 0.5) if i < 2 else rng.randf_range(sk.trunk.height * 0.55, sk.trunk.height * 0.95)
		sk.fungus.append({"a": a, "y": y, "size": rng.randf_range(0.16, 0.26), "ci": i % 3})

static func _branch(sk: Dictionary, rng: RandomNumberGenerator, from: Vector3, dir: Vector3, length: float, radius: float, depth: int, h: float) -> void:
	var children = 3 if depth == 3 else 2 + rng.randi_range(0, 1)
	var az0 = rng.randf() * TAU
	for i in children:
		var az = az0 + TAU * float(i) / float(children) + rng.randf_range(-0.4, 0.4)
		var spread = rng.randf_range(0.45, 0.8)
		var d = (dir * cos(spread) + Vector3(cos(az), 0, sin(az)) * sin(spread) + Vector3.UP * 0.15).normalized()
		var l = length * rng.randf_range(0.8, 1.1)
		var kink = Vector3(rng.randf_range(-1, 1), rng.randf_range(-0.3, 0.3), rng.randf_range(-1, 1)) * l * 0.12
		var mid = from + d * l * 0.5 + kink
		var end = mid + (d + Vector3.DOWN * 0.15 * float(3 - depth)).normalized() * l * 0.5
		sk.tubes.append({"points": [from, mid, end], "radii": [radius, radius * 0.7, radius * 0.45], "wind": 0.0, "kind": "branch", "depth": depth})
		if depth > 1:
			_branch(sk, rng, end, d, length * 0.66, radius * 0.5, depth - 1, h)
		elif sk.fruit_enabled and rng.randf() < 0.35:
			sk.fruit.append({"pos": end + Vector3.DOWN * 0.22, "kind": "pod", "ci": rng.randi() % 2, "spin": 0.0, "tilt": 0.0, "thread": end})

# --------------------------------------------------------------------------
# Meshing
# --------------------------------------------------------------------------

static func _wind_weight(sk: Dictionary, p: Vector3) -> float:
	var h: float = sk.height
	var start: float = sk.trunk.height + 0.2
	var vertical = clampf((p.y - start) / maxf(h - start, 0.5), 0.0, 1.0)
	var horizontal = clampf(Vector2(p.x, p.z).length() / (h * 0.45), 0.0, 1.0)
	return vertical * (0.45 + 0.55 * horizontal)

static func _shade(base: Color, n: Vector3, light: Color, dark: Color, jitter: float) -> Color:
	var c = base
	if n.y > 0.0: c = c.lerp(light, clampf(n.y, 0.0, 1.0) * 0.38)
	else: c = c.lerp(dark, clampf(-n.y, 0.0, 1.0) * 0.42)
	return Color(c.r * (1.0 + jitter), c.g * (1.0 + jitter), c.b * (1.0 + jitter * 0.6))

static func _mesh_skeleton(buf: MeshBuf, sk: Dictionary, lod: String, include_trunk: bool, opts: Dictionary) -> void:
	var near = lod == "near"
	var pal: Dictionary = sk.palette
	var rng = _rng(sk.species, sk.seed, 99)
	if include_trunk:
		_mesh_trunk(buf, sk, 8 if near else 5)
	var hero: bool = sk.hero
	if hero: _mesh_flare(buf, sk, near)
	for t in sk.tubes:
		var kind: String = t.kind
		if not near and kind == "root" and (rng.randf() < 0.4 or (sk.species == "fen" and t.points.size() < 4)): continue
		if not near and (int(t.get("depth", 3)) < 2 or (kind in ["branch", "twig"] and sk.species == "apple")): continue
		var sides = (7 if kind in ["trunk", "limb", "leader"] else (6 if kind == "scaffold" else (4 if kind == "twig" else 5))) if near else (4 if kind != "trunk" else 5)
		_mesh_tube(buf, sk, t.points, t.radii, sides, pal, rng, kind == "root")
	for tw in sk.twigs:
		if near: _mesh_twig(buf, sk, tw, pal)
	if hero and near:
		_mesh_canopy(buf, sk, pal)
	var ico = _icosphere(1 if near else 0)
	var biggest = -1.0
	for b in sk.blobs: biggest = maxf(biggest, b.radius.x)
	for b in sk.blobs:
		if hero and near: break
		var use: Array = ico
		if not near:
			# Far LOD: small lumps vanish at 15 m+; only the dominant cluster stays round.
			if b.radius.x < sk.height * 0.13: continue
			if b.radius.x >= biggest: use = _icosphere(1)
			if hero:   # far hull sits at the mean card-shell radius so the LOD swap keeps the silhouette
				b = b.duplicate()
				b.radius = b.radius * 0.93
		_mesh_blob(buf, sk, b, use, pal, rng)
	for s in sk.skirts:
		_mesh_skirt(buf, sk, s, near, pal)
	for st in sk.strands:
		if near or rng.randf() < 0.28: _mesh_strand(buf, sk, st, 3 if near else 2, pal)
	for f in sk.fruit:
		if f.kind == "apple" and bool(opts.get("dynamic_fruit", false)): continue
		if not near and f.kind == "apple" and rng.randf() < 0.5: continue
		if not near and f.kind == "cone": continue
		_mesh_fruit(buf, sk, f, near, pal)
	if near:
		for f in sk.fungus: _mesh_fungus(buf, sk, f, pal)

static func _trunk_transform(t: Dictionary) -> Transform3D:
	var axis: Vector3 = t.axis
	var side = axis.cross(Vector3.FORWARD if absf(axis.z) < 0.9 else Vector3.RIGHT).normalized()
	var fwd = side.cross(axis).normalized()
	var r: float = t.radius
	var basis = Basis(side * r * 2.0, axis * float(t.height), fwd * r * 2.0)
	return Transform3D(basis, t.base + axis * float(t.height) * 0.5)

## The chop trunk in unit-taper space (y -0.5..0.5, radius 0.5 -> 0.25), matching
## melee_contact.notch() so the first axe hit does not change the silhouette.
static func _unit_trunk_mesh(pal: Dictionary, sides: int, uv_height: float = 0.0) -> ArrayMesh:
	var buf = MeshBuf.new()
	_unit_trunk(buf, pal, sides, Transform3D.IDENTITY, uv_height)
	return buf.commit()

## uv_height > 0 maps bark UVs (u around 0..1, v metres up the trunk of that height; shader mode 2). The trunk keeps its
## exact ring/side layout, so notch(), split_mesh() and the stump continuity are unchanged.
static func _unit_trunk(buf: MeshBuf, pal: Dictionary, sides: int, xf: Transform3D, uv_height: float = 0.0) -> void:
	var rings = [-0.5, -0.1, 0.25, 0.5]
	var bark: Array = pal.bark
	for j in rings.size() - 1:
		for i in sides:
			var a0 = TAU * float(i) / float(sides)
			var a1 = TAU * float(i + 1) / float(sides)
			var y0: float = rings[j]
			var y1: float = rings[j + 1]
			var r0 = lerpf(0.5, 0.25, y0 + 0.5)
			var r1 = lerpf(0.5, 0.25, y1 + 0.5)
			var p = [xf * Vector3(cos(a0) * r0, y0, sin(a0) * r0), xf * Vector3(cos(a1) * r0, y0, sin(a1) * r0),
				xf * Vector3(cos(a1) * r1, y1, sin(a1) * r1), xf * Vector3(cos(a0) * r1, y1, sin(a0) * r1)]
			var mid = xf * Vector3(cos((a0 + a1) * 0.5), (y0 + y1) * 0.5, sin((a0 + a1) * 0.5))
			var centre = xf * Vector3(0, (y0 + y1) * 0.5, 0)
			var c = Color(bark[(i + j) % bark.size()]) if (i % 3 != 0) else Color(bark[1])
			var uvs: Array = []
			if uv_height > 0.0:
				var u0 = float(i) / float(sides)
				var u1 = float(i + 1) / float(sides)
				var v0 = (y0 + 0.5) * uv_height
				var v1 = (y1 + 0.5) * uv_height
				uvs = [Vector2(u0, v0), Vector2(u1, v0), Vector2(u1, v1), Vector2(u0, v1)]
			buf.quad(p[0], p[1], p[2], p[3], c.darkened(0.08 * float(rings.size() - 2 - j)), mid - centre, 0, 0, 0, 0, 0.0, uvs, 2.0 if uv_height > 0.0 else 0.0)
	var top_c = xf * Vector3(0, 0.5, 0)
	for i in sides:
		var a0 = TAU * float(i) / float(sides)
		var a1 = TAU * float(i + 1) / float(sides)
		var cap_uv: Array = [Vector2(0.5, uv_height), Vector2(float(i) / float(sides), uv_height), Vector2(float(i + 1) / float(sides), uv_height)] if uv_height > 0.0 else []
		buf.tri(top_c, xf * Vector3(cos(a0) * 0.25, 0.5, sin(a0) * 0.25), xf * Vector3(cos(a1) * 0.25, 0.5, sin(a1) * 0.25), Color(bark[0]), xf.basis * Vector3.UP, 0, 0, 0, 0.0, cap_uv, 2.0 if uv_height > 0.0 else 0.0)

static func _mesh_trunk(buf: MeshBuf, sk: Dictionary, sides: int) -> void:
	_unit_trunk(buf, sk.palette, sides, _trunk_transform(sk.trunk), float(sk.trunk.height) if sk.hero else 0.0)

static func _frame(t: Vector3, prev: Vector3) -> Vector3:
	var n = prev - t * prev.dot(t)
	if n.length_squared() < 1e-6:
		n = t.cross(Vector3.RIGHT if absf(t.x) < 0.9 else Vector3.FORWARD)
	return n.normalized()

## Catmull-Rom subdivision with a deterministic gnarl wobble (interior points only, roots stay on the ground plane).
static func _smooth_path(pts: Array, radii: Array, per: int, gnarl: float, flat: bool) -> Array:
	var out_p = []
	var out_r = []
	var n = pts.size()
	for k in n - 1:
		var p0: Vector3 = pts[maxi(k - 1, 0)]
		var p1: Vector3 = pts[k]
		var p2: Vector3 = pts[k + 1]
		var p3: Vector3 = pts[mini(k + 2, n - 1)]
		for s in per:
			var t = float(s) / float(per)
			var p: Vector3 = 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t)
			var r = lerpf(float(radii[k]), float(radii[k + 1]), t)
			if k > 0 or s > 0:
				var w = Vector3(sin(p.y * 7.1 + p.z * 3.3), 0.0 if flat else sin(p.z * 6.3 + p.x * 2.9) * 0.5, sin(p.x * 8.2 + p.y * 4.1))
				p += w * gnarl * r
				r *= 1.0 + 0.1 * sin(p.x * 5.0 + p.y * 9.0 + p.z * 4.0)
			out_p.append(p)
			out_r.append(r)
	out_p.append(pts[n - 1])
	out_r.append(radii[n - 1])
	return [out_p, out_r]

static func _mesh_tube(buf: MeshBuf, sk: Dictionary, pts: Array, radii: Array, sides: int, pal: Dictionary, rng: RandomNumberGenerator, is_root: bool) -> void:
	var hero: bool = sk.hero
	if hero and sides > 4:
		var big: float = radii[0]
		var sm = _smooth_path(pts, radii, 3 if big > 0.1 else (2 if big > 0.035 else 1), 0.4, is_root)
		pts = sm[0]
		radii = sm[1]
	var lengths = [0.0]
	for k in range(1, pts.size()): lengths.append(lengths[k - 1] + (pts[k] - pts[k - 1]).length())
	var rings = []
	var n = Vector3.ZERO
	for k in pts.size():
		var a: Vector3 = pts[maxi(k - 1, 0)]
		var b: Vector3 = pts[mini(k + 1, pts.size() - 1)]
		var t = (b - a).normalized()
		n = _frame(t, n if k > 0 else Vector3.RIGHT)
		var bn = t.cross(n)
		var ring = []
		for i in sides:
			var ang = TAU * float(i) / float(sides)
			ring.append(pts[k] + (n * cos(ang) + bn * sin(ang)) * float(radii[k]))
		rings.append(ring)
	var bark: Array = pal.bark
	var moss = Color(pal.get("moss", bark[0]))
	for k in pts.size() - 1:
		for i in sides:
			var i1 = (i + 1) % sides
			var q = [rings[k][i], rings[k][i1], rings[k + 1][i1], rings[k + 1][i]]
			var centre: Vector3 = (pts[k] + pts[k + 1]) * 0.5
			var face_c: Vector3 = (q[0] + q[1] + q[2] + q[3]) * 0.25
			var out = face_c - centre
			var c = Color(bark[(i + k) % bark.size()])
			if hero: c = Color(bark[1]).lerp(c, 0.4)
			var fn = out.normalized()
			if fn.y > 0.45 and not is_root: c = c.lerp(moss, 0.35)
			c = c.darkened(rng.randf_range(0.0, 0.08))
			var uvs: Array = []
			if hero:
				var u0 = float(i) / float(sides)
				var u1 = float(i + 1) / float(sides)
				uvs = [Vector2(u0, lengths[k]), Vector2(u1, lengths[k]), Vector2(u1, lengths[k + 1]), Vector2(u0, lengths[k + 1])]
			buf.quad(q[0], q[1], q[2], q[3], c, out, _wind_weight(sk, q[0]), _wind_weight(sk, q[1]), _wind_weight(sk, q[2]), _wind_weight(sk, q[3]), 0.0, uvs, 2.0 if hero else 0.0)
	# Tip cap (pointed) so thin branch ends never show an open hole.
	var last: int = pts.size() - 1
	var dir: Vector3 = (pts[last] - pts[last - 1]).normalized()
	var apex: Vector3 = pts[last] + dir * float(radii[last]) * 1.5
	for i in sides:
		var i1 = (i + 1) % sides
		var cap_uv: Array = [Vector2(float(i) / float(sides), lengths[last]), Vector2(float(i1) / float(sides), lengths[last]), Vector2(0.5, lengths[last] + float(radii[last]) * 1.5)] if hero else []
		buf.tri(rings[last][i], rings[last][i1], apex, Color(bark[0]), (rings[last][i] + rings[last][i1]) * 0.5 - pts[last] + dir * 0.3 * float(radii[last]), _wind_weight(sk, rings[last][i]), _wind_weight(sk, rings[last][i1]), _wind_weight(sk, apex), 0.0, cap_uv, 2.0 if hero else 0.0)

## Buttressed root flare: lobes line up with the root tubes, sink 0.18 m below the soil line and blend into the trunk
## (the last ring is buried inside the chop trunk, which keeps its exact notch-compatible shape above ~0.5 m).
static func _mesh_flare(buf: MeshBuf, sk: Dictionary, near: bool) -> void:
	var t: Dictionary = sk.trunk
	var r0: float = t.radius
	var height: float = t.height
	var axis: Vector3 = t.axis
	var side = axis.cross(Vector3.FORWARD if absf(axis.z) < 0.9 else Vector3.RIGHT).normalized()
	var fwd = side.cross(axis).normalized()
	var azs = []
	for tb in sk.tubes:
		if tb.kind == "root": azs.append(atan2(tb.points.back().z, tb.points.back().x))
	var ys = [-0.18, 0.0, 0.14, 0.3, 0.55]
	var fs = [0.85, 1.0, 0.62, 0.26, 0.0]
	var sides = 12 if near else 8
	var bark: Array = sk.palette.bark
	var rings = []
	for j in ys.size():
		var y: float = ys[j]
		var tr = r0 * (1.0 - 0.5 * maxf(y, 0.0) / height)
		var ring = []
		for i in sides:
			var a = TAU * float(i) / float(sides)
			var dir: Vector3 = side * cos(a) + fwd * sin(a)
			var az = atan2(dir.z, dir.x)
			var lobe = 0.0
			for ra in azs: lobe = maxf(lobe, pow(maxf(cos(az - ra), 0.0), 4.0))
			var rad = tr * (1.0 + float(fs[j]) * (0.26 + 0.95 * lobe)) if j < ys.size() - 1 else tr * 0.9
			ring.append(t.base + axis * y + dir * rad)
		rings.append(ring)
	var moss = Color(sk.palette.get("moss", bark[0]))
	for j in ys.size() - 1:
		for i in sides:
			var i1 = (i + 1) % sides
			var q = [rings[j][i], rings[j][i1], rings[j + 1][i1], rings[j + 1][i]]
			var face_c: Vector3 = (q[0] + q[1] + q[2] + q[3]) * 0.25
			var out = face_c - (t.base + axis * (float(ys[j]) + float(ys[j + 1])) * 0.5)
			var c = Color(bark[1]).lerp(Color(bark[(i + j) % bark.size()]), 0.4)
			if out.normalized().y > 0.35: c = c.lerp(moss, 0.3)
			var u0 = float(i) / float(sides)
			var u1 = float(i + 1) / float(sides)
			buf.quad(q[0], q[1], q[2], q[3], c, out, 0, 0, 0, 0, 0.0, [Vector2(u0, ys[j]), Vector2(u1, ys[j]), Vector2(u1, ys[j + 1]), Vector2(u0, ys[j + 1])], 2.0)

## Layered canopy: every blob and clump becomes a shell of double-sided alpha-scissor leaf cards (soft volumetric normals,
## inner cards darker) around a dark low-poly core, so branches show through and the edge breaks into small clusters.
static func _mesh_canopy(buf: MeshBuf, sk: Dictionary, pal: Dictionary) -> void:
	var crng = _rng(sk.species, sk.seed, 77)
	var avoid = []
	for f in sk.fruit: avoid.append(f.pos)
	for p in sk.reach_points: avoid.append(p)
	for b in sk.blobs:
		_mesh_core(buf, sk, b, pal)
		_mesh_leaf_mass(buf, sk, b, pal, crng, avoid, 1.0, 0.5)
	for c in sk.clumps:
		_mesh_leaf_mass(buf, sk, c, pal, crng, avoid, 1.25, 0.6)

static func _mesh_core(buf: MeshBuf, sk: Dictionary, b: Dictionary, pal: Dictionary) -> void:
	var ico: Array = _icosphere(0)
	var col = Color(pal.leaf_dark).lerp(Color(pal.leaf[int(b.ci) % pal.leaf.size()]), 0.22)
	var c: Vector3 = b.center + Vector3.DOWN * b.radius.y * 0.08
	var r: Vector3 = b.radius * 0.5
	for face in ico[1]:
		var p = []
		for k in 3: p.append(c + Vector3(ico[0][face[k]].x * r.x, ico[0][face[k]].y * r.y, ico[0][face[k]].z * r.z))
		buf.tri(p[0], p[1], p[2], col, (p[0] + p[1] + p[2]) / 3.0 - c, _wind_weight(sk, p[0]), _wind_weight(sk, p[1]), _wind_weight(sk, p[2]), 0.0, [], 3.0)

static func _mesh_leaf_mass(buf: MeshBuf, sk: Dictionary, b: Dictionary, pal: Dictionary, crng: RandomNumberGenerator, avoid: Array, density: float, shell: float) -> void:
	var leaves: Array = pal.leaf
	var base = Color(leaves[int(b.ci) % leaves.size()])
	var light = Color(pal.leaf_light)
	var dark = Color(pal.leaf_dark)
	var r: Vector3 = b.radius
	var rm = (r.x + r.z) * 0.5
	var n = clampi(int(density * rm * rm * 62.0), 7, 120)
	var inv = Vector3(1.0 / (r.x * r.x), 1.0 / (r.y * r.y), 1.0 / (r.z * r.z))
	var crown_axis = Vector3(0, b.center.y, 0)
	var reach: float = sk.height * 0.42
	var uvs = [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
	for i in n:
		# Fixed draw order per card keeps the sequence identical whether or not a card is skipped.
		var d = Vector3(crng.randf_range(-1.0, 1.0), crng.randf_range(-0.8, 1.0), crng.randf_range(-1.0, 1.0))
		var dev = Vector3(crng.randf_range(-1.0, 1.0), crng.randf_range(-1.0, 1.0), crng.randf_range(-1.0, 1.0))
		var jit = crng.randf_range(-0.07, 0.07)
		var tone = Color(leaves[crng.randi() % leaves.size()])
		var roll = crng.randf() * TAU
		var ragged = crng.randf() < 0.14
		var depth = pow(crng.randf(), 1.6) * shell
		var size_k = crng.randf_range(0.36, 0.58)
		# Ragged tip sprigs stay close to the leaf mass (was up to +16 %, which left them floating); the tight offset keeps them attached.
		var k = 1.0 + (crng.randf_range(1.02, 1.16) - 1.0) * 0.4 if ragged else 1.0 - depth
		if d.length_squared() < 0.04: continue
		d = d.normalized()
		var surf = _blob_surface(b, d)
		var p: Vector3 = b.center + (surf - b.center) * k
		var nrm_e = ((p - b.center) * inv).normalized()
		var horiz = clampf(Vector2(p.x, p.z).length() / reach, 0.0, 1.0)
		var size = size_k * lerpf(1.0, 0.72, horiz) * (0.8 if ragged else 1.0) * (1.0 - 0.2 * depth / shell)
		var blocked = false
		for q in avoid:
			if p.distance_to(q) < size * 0.5 + 0.14:
				blocked = true
				break
		if blocked: continue
		var face = (nrm_e + Vector3.UP * 0.55 + dev * 0.5).normalized()
		var right = face.cross(Vector3.UP)
		if right.length_squared() < 0.05: right = Vector3.RIGHT
		right = right.normalized()
		var upv = face.cross(right).normalized()
		var rr = right.rotated(face, roll) * size * 0.5
		var uu = upv.rotated(face, roll) * size * 0.5
		var q4 = [p - rr - uu, p + rr - uu, p + rr + uu, p - rr + uu]
		var col = base.lerp(tone, 0.45)
		col = col.lerp(light, clampf(nrm_e.y, 0.0, 1.0) * 0.35) if nrm_e.y > 0.0 else col.lerp(dark, clampf(-nrm_e.y, 0.0, 1.0) * 0.45)
		col = col.darkened(depth / shell * 0.35)
		if (p - crown_axis).dot(nrm_e) < 0.0: col = col.darkened(0.14)
		col = Color(col.r * (1.0 + jit), col.g * (1.0 + jit), col.b * (1.0 + jit * 0.6))
		var ns = []
		var ws = []
		for corner in q4:
			ns.append((((corner - b.center) * inv).normalized() * 0.7 + Vector3.UP * 0.3).normalized())
			ws.append(_wind_weight(sk, corner))
		buf.card(q4, ns, col, ws, uvs)

static func _mesh_twig(buf: MeshBuf, sk: Dictionary, tw: Dictionary, pal: Dictionary) -> void:
	var a: Vector3 = tw.from
	var b: Vector3 = tw.to
	var side = Vector3(0.018, 0, 0.012)
	var fwd = Vector3(-0.012, 0, 0.018)
	var c = Color(pal.get("stem", pal.bark[0]))
	var ring_a = [a + side, a + fwd, a - side - fwd * 0.3]
	var ring_b = [b + side * 0.6, b + fwd * 0.6, b - (side + fwd * 0.3) * 0.6]
	for i in 3:
		var i1 = (i + 1) % 3
		var mid: Vector3 = (ring_a[i] + ring_a[i1]) * 0.5
		buf.quad(ring_a[i], ring_a[i1], ring_b[i1], ring_b[i], c, mid - a, 0, 0, 0, 0)
	if tw.get("leaf", false):
		var lc = Color(pal.get("twig_leaf", pal.leaf[0]))
		var base = a.lerp(b, 0.45)
		var tip = base + Vector3(0.14, 0.03, 0.06)
		var l = base + Vector3(0.06, 0.05, -0.02)
		var r = base + Vector3(0.08, -0.02, 0.07)
		buf.tri(base, l, tip, lc, Vector3.UP, 0, 0, 0)
		buf.tri(base, r, tip, lc.darkened(0.1), Vector3.UP, 0, 0, 0)
		buf.tri(base, l, tip, lc.darkened(0.25), Vector3.DOWN, 0, 0, 0)
		buf.tri(base, r, tip, lc.darkened(0.3), Vector3.DOWN, 0, 0, 0)

static func _icosphere(level: int) -> Array:
	if _ico.size() > level: return _ico[level]
	var t = (1.0 + sqrt(5.0)) / 2.0
	var v = [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0),
		Vector3(0, -1, t), Vector3(0, 1, t), Vector3(0, -1, -t), Vector3(0, 1, -t),
		Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	for i in v.size(): v[i] = v[i].normalized()
	var f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
	if _ico.is_empty(): _ico.append([v, f])
	while _ico.size() <= level:
		var prev: Array = _ico[_ico.size() - 1]
		var verts: Array = prev[0].duplicate()
		var faces = []
		var cache = {}
		for face in prev[1]:
			var m = []
			for e in 3:
				var a: int = face[e]
				var b: int = face[(e + 1) % 3]
				var key = "%d_%d" % [mini(a, b), maxi(a, b)]
				if not cache.has(key):
					cache[key] = verts.size()
					verts.append(((verts[a] + verts[b]) * 0.5).normalized())
				m.append(cache[key])
			faces.append([face[0], m[0], m[2]])
			faces.append([face[1], m[1], m[0]])
			faces.append([face[2], m[2], m[1]])
			faces.append([m[0], m[1], m[2]])
		_ico.append([verts, faces])
	return _ico[level]

static func _mesh_blob(buf: MeshBuf, sk: Dictionary, b: Dictionary, ico: Array, pal: Dictionary, rng: RandomNumberGenerator) -> void:
	var leaves: Array = pal.leaf
	var base = Color(leaves[int(b.ci) % leaves.size()])
	var light = Color(pal.leaf_light)
	var dark = Color(pal.leaf_dark)
	var rot = Basis(Vector3.UP, b.spin)
	var pts = []
	for v in ico[0]: pts.append(_blob_surface(b, rot * v))
	var crown_axis = Vector3(0, b.center.y, 0)
	for face in ico[1]:
		var a: Vector3 = pts[face[0]]
		var c1: Vector3 = pts[face[1]]
		var c2: Vector3 = pts[face[2]]
		var centroid = (a + c1 + c2) / 3.0
		var out = centroid - b.center
		var n = (c1 - a).cross(c2 - a).normalized()
		if n.dot(out) < 0: n = -n
		var col = _shade(base, n, light, dark, rng.randf_range(-0.07, 0.07))
		# Faces turned toward the crown centre are mostly occluded: darken for depth.
		if (centroid - crown_axis).dot(n) < 0.0: col = col.darkened(0.15)
		buf.tri(a, c1, c2, col, out, _wind_weight(sk, a), _wind_weight(sk, c1), _wind_weight(sk, c2))

static func _mesh_skirt(buf: MeshBuf, sk: Dictionary, s: Dictionary, near: bool, pal: Dictionary) -> void:
	var lobes: int = s.lobes if near else maxi(6, int(s.lobes) - 2)
	var r: float = s.radius
	var c: Vector3 = s.center
	var apex = c + Vector3.UP * float(s.height)
	var under = c + Vector3.UP * float(s.height) * 0.28
	var leaves: Array = pal.leaf
	var base = Color(leaves[int(s.ci) % leaves.size()])
	var light = Color(pal.leaf_light)
	var dark = Color(pal.leaf_dark)
	var rng = RandomNumberGenerator.new()
	rng.seed = s.seed
	var tips = []
	var notches = []
	for i in lobes:
		var a: float = s.rot + TAU * float(i) / float(lobes)
		var tr = r * rng.randf_range(0.88, 1.1)
		tips.append(c + Vector3(cos(a) * tr, -float(s.droop) * rng.randf_range(0.8, 1.2), sin(a) * tr))
		var an = a + PI / float(lobes)
		notches.append(c + Vector3(cos(an) * r * 0.66, float(s.height) * 0.1, sin(an) * r * 0.66))
	for i in lobes:
		var prev_n: Vector3 = notches[(i - 1 + lobes) % lobes]
		var t: Vector3 = tips[i]
		var nx: Vector3 = notches[i]
		var w_apex = _wind_weight(sk, apex)
		if near:
			# A ridge vertex part-way up each lobe gives the needles a faceted, layered read.
			var ridge = apex.lerp(t, 0.55) + Vector3.UP * float(s.height) * 0.08
			var faces = [[apex, prev_n, ridge], [apex, ridge, nx], [prev_n, t, ridge], [ridge, t, nx]]
			for k in faces.size():
				var f: Array = faces[k]
				var nrm: Vector3 = (f[1] - f[0]).cross(f[2] - f[0]).normalized()
				if nrm.y < 0: nrm = -nrm
				var col = _shade(base, nrm, light, dark, rng.randf_range(-0.06, 0.06))
				if k >= 2: col = col.lerp(light, 0.12)  # sunlit needle tips
				buf.tri(f[0], f[1], f[2], col, Vector3.UP + (f[1] - c).normalized() * 0.2, _wind_weight(sk, f[0]), _wind_weight(sk, f[1]), _wind_weight(sk, f[2]))
		else:
			for f in [[apex, prev_n, t], [apex, t, nx]]:
				var nrm: Vector3 = (f[1] - f[0]).cross(f[2] - f[0]).normalized()
				if nrm.y < 0: nrm = -nrm
				buf.tri(f[0], f[1], f[2], _shade(base, nrm, light, dark, rng.randf_range(-0.05, 0.05)), Vector3.UP, w_apex, _wind_weight(sk, f[1]), _wind_weight(sk, f[2]))
		# Underside: dark, concave, closes the skirt so it reads solid from below.
		var dcol = dark.lerp(base, 0.25)
		buf.tri(under, prev_n, t, dcol, Vector3.DOWN, _wind_weight(sk, under), _wind_weight(sk, prev_n), _wind_weight(sk, t))
		buf.tri(under, t, nx, dcol.darkened(0.08), Vector3.DOWN, _wind_weight(sk, under), _wind_weight(sk, t), _wind_weight(sk, nx))

static func _mesh_strand(buf: MeshBuf, sk: Dictionary, st: Dictionary, segments: int, pal: Dictionary) -> void:
	var top: Vector3 = st.from
	var length: float = st.length
	var bow: Vector3 = st.bow
	var w0 = _wind_weight(sk, top)
	var base_c = Color(pal.strand)
	var tip_c = Color(pal.strand_tip)
	var pts = []
	var ws = []
	for k in segments + 1:
		var t = float(k) / float(segments)
		var zig = Vector3(sin(float(k) * 2.3 + top.x * 5.0), 0, cos(float(k) * 1.7 + top.z * 5.0)) * 0.035 * t
		pts.append(top + Vector3.DOWN * length * t + bow * sin(t * PI * 0.8) + zig)
		ws.append(w0 + 0.55 * t)
	var width = 0.045
	for k in segments:
		var t0 = float(k) / float(segments)
		var t1 = float(k + 1) / float(segments)
		var r0 = width * (1.0 - t0 * 0.8)
		var r1 = width * (1.0 - t1 * 0.8)
		var col = base_c.lerp(tip_c, t1)
		var glow = 0.18 if k == segments - 1 else 0.0
		var last = k == segments - 1
		for i in 3:
			var a0 = TAU * float(i) / 3.0
			var a1 = TAU * float(i + 1) / 3.0
			var d0 = Vector3(cos(a0), 0, sin(a0))
			var d1 = Vector3(cos(a1), 0, sin(a1))
			var out = (d0 + d1) * 0.5
			if last:
				buf.tri(pts[k] + d0 * r0, pts[k] + d1 * r0, pts[k + 1], col, out, ws[k], ws[k], ws[k + 1], glow)
			else:
				buf.quad(pts[k] + d0 * r0, pts[k] + d1 * r0, pts[k + 1] + d1 * r1, pts[k + 1] + d0 * r1, col, out, ws[k], ws[k], ws[k + 1], ws[k + 1], glow)

## Low-poly lathe (fruit, pods). Profile is [radius, y] from bottom to top.
static func _lathe(buf: MeshBuf, sk: Dictionary, centre: Vector3, basis: Basis, profile: Array, sides: int, col_fn: Callable, glow: float) -> void:
	var rings = []
	for p in profile:
		var ring = []
		for i in sides:
			var a = TAU * float(i) / float(sides)
			ring.append(centre + basis * Vector3(cos(a) * float(p[0]), float(p[1]), sin(a) * float(p[0])))
		rings.append(ring)
	var w = _wind_weight(sk, centre) if sk.size() > 0 else 0.0
	for k in profile.size() - 1:
		for i in sides:
			var i1 = (i + 1) % sides
			var q = [rings[k][i], rings[k][i1], rings[k + 1][i1], rings[k + 1][i]]
			var face_c: Vector3 = (q[0] + q[1] + q[2] + q[3]) * 0.25
			var axis_pt: Vector3 = centre + basis * Vector3(0, (float(profile[k][1]) + float(profile[k + 1][1])) * 0.5, 0)
			var out = face_c - axis_pt
			var col: Color = col_fn.call(out.normalized(), k, i)
			if float(profile[k][0]) < 1e-4:
				buf.tri(q[0], q[2], q[3], col, out, w, w, w, glow)
			elif float(profile[k + 1][0]) < 1e-4:
				buf.tri(q[0], q[1], q[2], col, out, w, w, w, glow)
			else:
				buf.quad(q[0], q[1], q[2], q[3], col, out, w, w, w, w, glow)

const _APPLE_PROFILE := [[0.0, -0.072], [0.06, -0.062], [0.09, -0.012], [0.083, 0.045], [0.04, 0.07], [0.0, 0.05]]
const _APPLE_PROFILE_FAR := [[0.0, -0.09], [0.11, -0.01], [0.065, 0.07], [0.0, 0.06]]

static func _mesh_fruit(buf: MeshBuf, sk: Dictionary, f: Dictionary, near: bool, pal: Dictionary) -> void:
	var fruit: Array = pal.fruit
	var base = Color(fruit[int(f.ci) % fruit.size()])
	var light = Color(pal.fruit_light)
	var dark = Color(pal.fruit_dark)
	var basis = Basis(Vector3.UP, f.spin) * Basis(Vector3.RIGHT, f.tilt)
	var p: Vector3 = f.pos
	match f.kind:
		"apple":
			var shade = func(n: Vector3, k: int, i: int) -> Color:
				var c = base.lerp(light, clampf(n.y, 0.0, 1.0) * 0.45) if n.y > 0 else base.lerp(dark, clampf(-n.y, 0.0, 1.0) * 0.5)
				return c.lerp(Color("e0b24a"), 0.25) if (i == 1 and k == 2) else c
			_lathe(buf, sk, p, basis, _APPLE_PROFILE if near else _APPLE_PROFILE_FAR, 7 if near else 4, shade, 0.0)
			if near:
				var stem_top = p + basis * Vector3(0.018, 0.13, 0.0)
				var stem_c = Color(pal.get("stem", "5c3b24"))
				var s0 = p + basis * Vector3(-0.011, 0.055, 0.0)
				var s1 = p + basis * Vector3(0.011, 0.055, 0.0)
				buf.tri(s0, s1, stem_top, stem_c, basis * Vector3.BACK, 0, 0, 0)
				buf.tri(s0, s1, stem_top, stem_c, basis * Vector3.FORWARD, 0, 0, 0)
		"cone":
			var shade = func(n: Vector3, k: int, i: int) -> Color:
				return (base if (i + k) % 2 == 0 else light.lerp(base, 0.5)).darkened(0.25 * clampf(-n.y, 0, 1))
			var prof = [[0.0, -0.16], [0.05, -0.1], [0.07, 0.0], [0.045, 0.08], [0.0, 0.1]] if near else [[0.0, -0.16], [0.07, -0.02], [0.0, 0.1]]
			_lathe(buf, sk, p, basis, prof, 6 if near else 4, shade, 0.0)
		"pod":
			var thread: Vector3 = f.get("thread", p + Vector3.UP * 0.3)
			var shade = func(n: Vector3, k: int, i: int) -> Color:
				return base.lerp(light, 0.35 if n.y > 0.2 else 0.0)
			var prof = [[0.0, -0.14], [0.07, -0.08], [0.095, 0.0], [0.06, 0.08], [0.0, 0.12]] if near else [[0.0, -0.14], [0.11, 0.0], [0.0, 0.12]]
			_lathe(buf, sk, p, Basis.IDENTITY, prof, 6 if near else 4, shade, 1.0)
			if near:
				var tc = Color(pal.bark[0])
				buf.tri(thread + Vector3(-0.01, 0, 0), thread + Vector3(0.01, 0, 0), p + Vector3.UP * 0.12, tc, Vector3.BACK, 0, 0, 0)
				buf.tri(thread + Vector3(-0.01, 0, 0), thread + Vector3(0.01, 0, 0), p + Vector3.UP * 0.12, tc, Vector3.FORWARD, 0, 0, 0)

static func _mesh_fungus(buf: MeshBuf, sk: Dictionary, f: Dictionary, pal: Dictionary) -> void:
	var fungus: Array = pal.get("fungus", ["9ae6ff"])
	var col = Color(fungus[int(f.ci) % fungus.size()])
	var t: Dictionary = sk.trunk
	var y: float = f.y
	var along = clampf(y / float(t.height), 0.0, 1.5)
	var r: float = float(t.radius) * lerpf(1.0, 0.5, minf(along, 1.0)) * (1.25 if y < 0.6 else 1.0)
	var out = Vector3(cos(f.a), 0, sin(f.a))
	var anchor: Vector3 = t.base + t.axis * y + out * r * 0.8
	var size: float = f.size
	var side = out.cross(Vector3.UP)
	var rim = []
	for i in 6:
		var a = lerpf(-1.3, 1.3, float(i) / 5.0)
		rim.append(anchor + (out * cos(a) + side * sin(a)) * size + Vector3.DOWN * size * 0.12)
	var cap = anchor + out * size * 0.35 + Vector3.UP * size * 0.18
	var belly = anchor + out * size * 0.3 + Vector3.DOWN * size * 0.2
	for i in 5:
		buf.tri(cap, rim[i], rim[i + 1], col, Vector3.UP, 0, 0, 0, 0.8)
		buf.tri(belly, rim[i], rim[i + 1], col.darkened(0.3), Vector3.DOWN, 0, 0, 0, 0.5)

static func _cards_mesh(sk: Dictionary) -> ArrayMesh:
	var buf = MeshBuf.new()
	var cell: int = CARD_CELL[sk.species]
	var uv0 = Vector2(float(cell % 2) * 0.5, float(cell / 2) * 0.5)
	var rng = _rng(sk.species, sk.seed, 7)
	var tint_light = Color(sk.palette.leaf_light).lerp(Color.WHITE, 0.4)
	for b in sk.blobs:
		var n = 3 if b.radius.x > sk.height * 0.15 else 2
		for i in n:
			var d = Vector3(rng.randf_range(-1, 1), rng.randf_range(-0.1, 0.9), rng.randf_range(-1, 1)).normalized()
			var centre = _blob_surface(b, d)
			var size: float = b.radius.x * rng.randf_range(0.85, 1.1)
			var up = (Vector3.UP - d * d.dot(Vector3.UP)).normalized()
			if up.length_squared() < 0.1: up = Vector3.FORWARD
			var right = up.cross(d).normalized()
			up = up.rotated(d, rng.randf_range(-0.4, 0.4))
			right = right.rotated(d, rng.randf_range(-0.4, 0.4))
			# Card pivot is the bottom centre, sunk slightly into the cluster.
			var o = centre - up * size * 0.25 - d * size * 0.12
			var q = [o - right * size * 0.5, o + right * size * 0.5, o + right * size * 0.5 + up * size, o - right * size * 0.5 + up * size]
			var uvs = [uv0 + Vector2(0, 0.5), uv0 + Vector2(0.5, 0.5), uv0 + Vector2(0.5, 0), uv0]
			var tint = Color.WHITE.lerp(tint_light, rng.randf_range(0.0, 0.3))
			for tri_idx in [[0, 1, 2], [0, 2, 3]]:
				for k in tri_idx:
					buf.verts.append(q[k])
					buf.normals.append((q[k] - b.center).normalized())
					var lin = tint.srgb_to_linear()
					buf.colors.append(Color(lin.r, lin.g, lin.b, _wind_weight(sk, q[k])))
					buf.uv.append(uvs[k])
					buf.uv2.append(Vector2.ZERO)
	return buf.commit()

static func _apple_pickup_mesh(count: int, twig_length: float) -> ArrayMesh:
	var buf = MeshBuf.new()
	var pal: Dictionary = PALETTES.apple
	var sk = {}
	var offsets = [Vector3(0, 0, 0), Vector3(0.11, 0.04, 0.04), Vector3(-0.08, 0.05, 0.08), Vector3(0.02, 0.06, -0.1)]
	for i in clampi(count, 1, 4):
		_mesh_fruit(buf, sk, {"pos": offsets[i], "kind": "apple", "ci": i % 3, "spin": float(i) * 2.1, "tilt": 0.15 * float(i)}, true, pal)
	var twig_sk = {"palette": pal}
	_mesh_twig(buf, twig_sk, {"from": Vector3(0, 0.09 + twig_length, 0), "to": Vector3(0, 0.12, 0), "leaf": true}, pal)
	return buf.commit()

static func apple_object_mesh() -> ArrayMesh:
	return _apple_pickup_mesh(1, 0.08)

static func _chop_proxy(node: Node3D, t: Dictionary) -> StaticBody3D:
	var body = StaticBody3D.new()
	body.name = "ChopProxy"
	var col = CollisionShape3D.new()
	var shape = BoxShape3D.new()
	var r: float = t.radius
	# Generous square box around the chop trunk (the old proxy was 0.7 x 2.7 x 0.7).
	shape.size = Vector3(maxf(r * 2.0 + 0.2, 0.55), float(t.height), maxf(r * 2.0 + 0.2, 0.55))
	col.shape = shape
	body.add_child(col)
	var axis: Vector3 = t.axis
	var tx = _trunk_transform(t)
	body.transform = Transform3D(tx.basis.orthonormalized(), t.base + axis * float(t.height) * 0.5)
	node.add_child(body)
	return body

static func _placement_transform(p: Dictionary) -> Transform3D:
	var rng = RandomNumberGenerator.new()
	rng.seed = hash([p.get("seed", 0), "yaw"])
	var yaw: float = p.get("yaw", rng.randf() * TAU)
	var s: float = p.get("scale", 1.0)
	return Transform3D(Basis(Vector3.UP, yaw).scaled(Vector3.ONE * s), p.position)
