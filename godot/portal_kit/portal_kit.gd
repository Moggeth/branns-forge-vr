class_name PortalKit
extends Node3D
## Drop-in visual for one gateway. Place at the gate's ground position with the same facing the old
## portal used (local +Z = player side). The game keeps its own collision/trigger proxy and calls
## play_entrance() when the player is committed, play_exit() at the destination gate.
##   var gate := PortalKit.create("crystal_hollow"); root.add_child(gate); gate.global_transform = old.global_transform

const ROOT := "res://portal_kit/"
const SURFACE_SHADER := preload("res://assets/smithy/portals/portal_surface.gdshader")
const MOTES_SHADER := preload("res://portal_kit/portal_motes.gdshader")
const DRAW_SHADER := preload("res://portal_kit/portal_mote_draw.gdshader")

# The shader and the corresponding landscape use this stable destination order.
const ZONES := {
	"pinewood_ruins": "a7c76b", "sandstone_quarry": "efbf64", "enchanted_kitchen": "ffab73",
	"mushroom_glade": "c09aeb", "crystal_hollow": "7edcea", "sky_garden": "b3e4e8",
	"ember_foundry": "ff9747", "forge_yard": "e5ad61", "orchard_highlands": "e3c27a",
	"gloamfen": "8cdaae", "starfall_ridge": "a4dff3", "cloudbreak_keep": "bceef1",
}

@export var zone_id := ""
@export var near_distance := 8.5     # full detail + motes + light inside this
@export var far_distance := 42.0      # distant gate artwork uses mesh import LOD
@export var cull_distance := 120.0
@export var mote_amount := 18
@export var light_energy := 0.7
@export var auto_approach := true     # swell follows the camera's distance in front of the gate

var glow_color := Color("f0c86a")
var pocket_frame := ""
var view_id := ""

var _mat_near: ShaderMaterial
var _motes: GPUParticles3D
var _burst: GPUParticles3D
var _light: OmniLight3D
var _tier := -1
var _dormant := false
var _tick := 0.0
var _swell := 0.0
var _swell_target := 0.0
var _swell_tween: Tween
var _release_tween: Tween
var _flash_tween: Tween

static func create(zone: String) -> PortalKit:
	var k := PortalKit.new()
	k.zone_id = zone
	return k

func _ready() -> void:
	var standard := "res://assets/smithy/portals/" + zone_id + ".glb"
	if pocket_frame.is_empty(): glow_color = Color(ZONES[zone_id])
	if view_id.is_empty(): view_id = zone_id
	var packed := load(standard if pocket_frame.is_empty() else pocket_frame) as PackedScene
	var frame := packed.instantiate() as Node3D
	add_child(frame)
	var veil := frame.find_child("Veil", true, false) as MeshInstance3D
	if not pocket_frame.is_empty():
		# Fit an existing textured arch opening to the museum and fair masonry.
		var reference := (load(standard) as PackedScene).instantiate() as Node3D
		var shaped := reference.find_child("Veil", true, false) as MeshInstance3D
		veil = MeshInstance3D.new()
		veil.name = "Veil"
		veil.mesh = shaped.mesh
		var aperture := veil.mesh.get_aabb()
		veil.scale = Vector3(1.34 / aperture.size.x, 2.70 / aperture.size.y, 1.0)
		frame.add_child(veil)
		reference.free()
	if veil == null:
		push_error("Portal frame is missing its aperture mesh: " + zone_id)
		set_process(false)
		return
	veil.set_meta("portal_translucent_interior", true)
	veil.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_mat_near = ShaderMaterial.new()
	_mat_near.shader = SURFACE_SHADER
	_mat_near.set_shader_parameter("theme", ZONES.keys().find(zone_id))
	_mat_near.set_shader_parameter("destination_view", load(ROOT + "views/" + view_id + ".webp"))
	_mat_near.set_shader_parameter("view_strength", 0.94)
	if pocket_frame.is_empty() and zone_id in ["sky_garden", "cloudbreak_keep"]:
		_mat_near.set_shader_parameter("storm_amount", 1.0)
	_mat_near.set_shader_parameter("edge_color", glow_color)
	_mat_near.set_shader_parameter("core_color", glow_color.lerp(Color.WHITE, 0.38))
	_mat_near.set_shader_parameter("deep_color", glow_color.darkened(0.6))
	_mat_near.set_shader_parameter("time_offset", float(ZONES.keys().find(zone_id)) * 0.97)
	veil.material_override = _mat_near
	_build_effects()
	_apply_tier(3)

func _quad(size: float) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2.ONE
	var dm := ShaderMaterial.new()
	dm.shader = DRAW_SHADER
	dm.set_shader_parameter("mote_size", size)
	q.material = dm
	return q

func _build_effects() -> void:
	_motes = GPUParticles3D.new()
	_motes.name = "Motes"
	_motes.amount = mote_amount
	_motes.lifetime = 2.4
	_motes.local_coords = true
	_motes.fixed_fps = 30
	_motes.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_motes.visibility_aabb = AABB(Vector3(-1.6, -1.6, -0.4), Vector3(3.2, 3.2, 2.2))
	var pm := ShaderMaterial.new()
	pm.shader = MOTES_SHADER
	pm.set_shader_parameter("tint", glow_color.lerp(Color.WHITE, 0.35))
	_motes.process_material = pm
	_motes.draw_pass_1 = _quad(0.05)
	add_child(_motes)
	_motes.position = Vector3(0,1.12,0.04)

	_burst = GPUParticles3D.new()
	_burst.name = "ExitBurst"
	_burst.amount = 16
	_burst.lifetime = 0.8
	_burst.one_shot = true
	_burst.emitting = false
	_burst.explosiveness = 1.0
	_burst.local_coords = false
	_burst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_burst.visibility_aabb = AABB(Vector3(-2, -2, -1), Vector3(4, 4, 5))
	var bp := ParticleProcessMaterial.new()
	bp.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
	bp.emission_ring_axis = Vector3(0, 0, 1)
	bp.emission_ring_radius = 0.65
	bp.emission_ring_inner_radius = 0.2
	bp.emission_ring_height = 0.0
	bp.direction = Vector3(0, 0, 1)
	bp.spread = 55.0
	bp.initial_velocity_min = 1.2
	bp.initial_velocity_max = 2.6
	bp.damping_min = 2.0
	bp.damping_max = 3.5
	bp.gravity = Vector3(0, 0.4, 0)
	bp.scale_min = 0.6
	bp.scale_max = 1.3
	bp.color = glow_color.lerp(Color.WHITE, 0.4)
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 1))
	fade.set_color(1, Color(1, 1, 1, 0))
	var ramp := GradientTexture1D.new()
	ramp.gradient = fade
	bp.color_ramp = ramp
	_burst.process_material = bp
	_burst.draw_pass_1 = _quad(0.07)
	add_child(_burst)
	_burst.position = Vector3(0,1.12,0.13)

	_light = OmniLight3D.new()
	_light.name = "PortalLight"
	_light.shadow_enabled = false
	_light.light_color = glow_color
	_light.light_energy = light_energy
	_light.omni_range = 3.4
	_light.light_specular = 0.0
	_light.omni_attenuation = 1.6
	add_child(_light)
	_light.position = Vector3(0,1.26,0.36)

# ---- LOD: 0 near (motes + light), 1 mid (full mesh, no extras), 2 far (imported LOD), 3 culled
func _tier_for(dist: float) -> int:
	if dist > cull_distance:
		return 3
	if dist > far_distance:
		return 2
	if dist > near_distance:
		return 1
	return 0

func _apply_tier(t: int) -> void:
	if t == _tier:
		return
	_tier = t
	_motes.emitting = t == 0 and not _dormant
	_light.visible = t == 0 and not _dormant
	_mat_near.set_shader_parameter("lod_detail", 1.0 if t == 0 else 0.0)
	visible = t != 3

func _process(delta: float) -> void:
	_tick -= delta
	if _tick <= 0.0:
		_tick = 0.25
		if not get_parent_node_3d().is_visible_in_tree():
			_apply_tier(3)
			return
		var cam := get_viewport().get_camera_3d()
		if cam != null:
			var to_cam := cam.global_position - global_position
			_apply_tier(_tier_for(to_cam.length()))
			if auto_approach:
				var local := global_transform.affine_inverse() * cam.global_position
				# only in front of the gate (+Z) and roughly within its width
				var lateral := absf(local.x)
				var front := local.z
				var near_gate := 1.0 - smoothstep(1.0, 4.5, sqrt(front * front + lateral * lateral))
				_swell_target = near_gate if front > -0.3 else 0.0
	if _tier == 3 or _dormant:
		return
	_swell = move_toward(_swell, _swell_target, delta * 1.6)
	_mat_near.set_shader_parameter("swell", _swell)
	_light.light_energy = light_energy * (1.0 + 0.6 * _swell)

## Entrance swell: called when the player commits to the gate. Surface bulges and flares, then settles open.
func play_entrance() -> void:
	if _dormant: return
	if _swell_tween:
		_swell_tween.kill()
	_refresh_tier_now()
	auto_approach = false
	_swell_tween = create_tween()
	_swell_tween.tween_property(self, "_swell_target", 1.0, 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	_swell_tween.tween_interval(0.32)
	_swell_tween.tween_callback(_finish_entrance)
	_flash(1.8, 0.5)

func _finish_entrance() -> void:
	auto_approach = true
	_swell_target = 0.0

## Exit release: called on the destination gate as the player arrives. Ring sweeps outward, burst of motes leaves.
func play_exit() -> void:
	if _dormant: return
	if _release_tween:
		_release_tween.kill()
	_refresh_tier_now()
	_mat_near.set_shader_parameter("release", 0.0001)
	_release_tween = create_tween()
	_release_tween.tween_method(func(v: float) -> void: _mat_near.set_shader_parameter("release", v), 0.0001, 1.0, 0.85).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_release_tween.tween_callback(func() -> void: _mat_near.set_shader_parameter("release", 0.0))
	_burst.restart()
	_burst.emitting = true
	_flash(1.5, 0.6)
	auto_approach = true
	_swell_target = 0.0

func _refresh_tier_now() -> void:
	var cam := get_viewport().get_camera_3d()
	if cam != null:
		_apply_tier(_tier_for(cam.global_position.distance_to(global_position)))

func _flash(peak: float, seconds: float) -> void:
	if _flash_tween:
		_flash_tween.kill()
	_flash_tween = create_tween()
	_flash_tween.tween_method(func(v: float) -> void: _mat_near.set_shader_parameter("energy", v), peak, 1.0, seconds).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)

## Dormant gates (locked/unavailable): dim surface, no motes.
func set_dormant(dormant: bool) -> void:
	_dormant = dormant
	if _flash_tween: _flash_tween.kill()
	_mat_near.set_shader_parameter("energy", 0.25 if dormant else 1.0)
	_motes.emitting = not dormant and _tier == 0
	_light.visible = not dormant and _tier == 0
