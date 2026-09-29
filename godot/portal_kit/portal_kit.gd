class_name PortalKit
extends Node3D
## Drop-in visual for one gateway. Place at the gate's ground position with the same facing the old
## portal used (local +Z = player side). The game keeps its own collision/trigger proxy and calls
## play_entrance() when the player is committed, play_exit() at the destination gate.
##   var gate := PortalKit.create("crystal_hollow"); root.add_child(gate); gate.global_transform = old.global_transform

const ROOT := "res://portal_kit/"
const SURFACE_SHADER := preload("res://portal_kit/portal_surface.gdshader")
const MOTES_SHADER := preload("res://portal_kit/portal_motes.gdshader")
const DRAW_SHADER := preload("res://portal_kit/portal_mote_draw.gdshader")

# zone id -> GLB variant + palette (stone/glow taken from the game's portal theme table)
const ZONES := {
	"forge_yard": {"glb": "quarry", "stone": "8d7765", "glow": "e5ad61"},
	"sandstone_quarry": {"glb": "quarry", "stone": "c79565", "glow": "efbf64"},
	"enchanted_kitchen": {"glb": "kitchen", "stone": "b79d7a", "glow": "e7a25f"},
	"pinewood_ruins": {"glb": "orchard", "stone": "7c8b75", "glow": "a7c76b"},
	"mushroom_glade": {"glb": "mushroom", "stone": "757c8a", "glow": "bc8deb"},
	"crystal_hollow": {"glb": "crystal", "stone": "636d87", "glow": "7edcea"},
	"sky_garden": {"glb": "sky", "stone": "d1d3bc", "glow": "b3e4e8"},
	"ember_foundry": {"glb": "foundry", "stone": "48434b", "glow": "ff9747"},
	"orchard_highlands": {"glb": "orchard", "stone": "778568", "glow": "e3c27a"},
	"gloamfen": {"glb": "mushroom", "stone": "46566a", "glow": "8cdaae"},
	"starfall_ridge": {"glb": "crystal", "stone": "586486", "glow": "a4dff3"},
	"cloudbreak_keep": {"glb": "sky", "stone": "b8c6c9", "glow": "bceef1"},
}

@export var zone_id := ""
@export var near_distance := 16.0     # full detail + motes + light inside this
@export var far_distance := 42.0      # cheap LOD mesh beyond this
@export var cull_distance := 120.0
@export var mote_amount := 18
@export var light_energy := 0.7
@export var auto_approach := true     # swell follows the camera's distance in front of the gate

var glow_color := Color("f0c86a")
var _near: Node3D
var _far: Node3D
var _surface_near: MeshInstance3D
var _surface_far: MeshInstance3D
var _mat_near: ShaderMaterial
var _mat_far: ShaderMaterial
var _motes: GPUParticles3D
var _burst: GPUParticles3D
var _light: OmniLight3D
var _tier := -1
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
	var spec: Dictionary = ZONES.get(zone_id, ZONES["forge_yard"])
	glow_color = Color(spec["glow"])
	var packed := load(ROOT + "portals/portal_%s.glb" % spec["glb"]) as PackedScene
	if packed == null:
		push_error("PortalKit: missing GLB for " + zone_id)
		return
	var inst := packed.instantiate() as Node3D
	add_child(inst)
	_near = inst.find_child("Near", true, false) as Node3D
	_far = inst.find_child("Far", true, false) as Node3D
	_recolor(inst, Color(spec["stone"]), glow_color)
	_build_surface()
	_build_effects(inst)
	# Until a camera exists, keep distant/unvisited gateways inert.
	_apply_tier(3)
	set_process(true)

func _recolor(root: Node, stone: Color, glow: Color) -> void:
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		for s in mi.mesh.get_surface_count():
			var base := mi.mesh.surface_get_material(s) as BaseMaterial3D
			if base == null:
				continue
			if base.resource_name.begins_with("PK_Stone"):
				var m := base.duplicate() as BaseMaterial3D
				m.albedo_color = stone
				mi.set_surface_override_material(s, m)
			elif base.resource_name.begins_with("PK_Glow"):
				var m2 := base.duplicate() as BaseMaterial3D
				m2.emission = glow
				mi.set_surface_override_material(s, m2)

func _build_surface() -> void:
	_surface_near = _near.get_node("Surface_Near") as MeshInstance3D
	_surface_far = _far.get_node("Surface_Far") as MeshInstance3D
	_mat_near = _surface_material(1.0)
	_mat_far = _surface_material(0.0)
	_surface_near.material_override = _mat_near
	_surface_far.material_override = _mat_far
	_surface_near.set_meta("portal_translucent_interior", true)
	_surface_far.set_meta("portal_translucent_interior", true)
	_surface_near.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_surface_far.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _surface_material(detail: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = SURFACE_SHADER
	m.set_shader_parameter("edge_color", glow_color)
	m.set_shader_parameter("core_color", glow_color.lerp(Color.WHITE, 0.55))
	m.set_shader_parameter("deep_color", glow_color.darkened(0.6))
	m.set_shader_parameter("time_offset", float(get_instance_id() % 97) * 0.37)
	m.set_shader_parameter("lod_detail", detail)
	return m

func _quad(size: float) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2.ONE
	var dm := ShaderMaterial.new()
	dm.shader = DRAW_SHADER
	dm.set_shader_parameter("mote_size", size)
	q.material = dm
	return q

func _build_effects(inst: Node3D) -> void:
	var emitter := inst.find_child("FX_MoteEmitter", true, false) as Node3D
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
	emitter.add_child(_motes)

	var burst_node := inst.find_child("FX_ExitBurst", true, false) as Node3D
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
	burst_node.add_child(_burst)

	var light_node := inst.find_child("FX_Light", true, false) as Node3D
	_light = OmniLight3D.new()
	_light.name = "PortalLight"
	_light.shadow_enabled = false
	_light.light_color = glow_color
	_light.light_energy = light_energy
	_light.omni_range = 3.4
	_light.light_specular = 0.0
	_light.omni_attenuation = 1.6
	light_node.add_child(_light)

# ---- LOD: 0 near (motes + light), 1 mid (full mesh, no extras), 2 far (proxy mesh), 3 culled
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
	_near.visible = t <= 1
	_far.visible = t == 2
	_motes.emitting = t == 0
	_light.visible = t == 0
	_mat_near.set_shader_parameter("lod_detail", 1.0 if t == 0 else 0.0)
	visible = t != 3

func _process(delta: float) -> void:
	_tick -= delta
	if _tick <= 0.0:
		_tick = 0.25
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
	if _tier == 3:
		return
	_swell = move_toward(_swell, _swell_target, delta * 1.6)
	_mat_near.set_shader_parameter("swell", _swell)
	_light.light_energy = light_energy * (1.0 + 0.6 * _swell)

## Entrance swell: called when the player commits to the gate. Surface bulges and flares, then settles open.
func play_entrance() -> void:
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
	_mat_near.set_shader_parameter("energy", 0.25 if dormant else 1.0)
	_motes.emitting = (not dormant) and _tier == 0
