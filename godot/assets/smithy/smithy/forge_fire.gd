## Furnace FX companion (Godot 4.7, Mobile renderer).
## Add as a child Node3D of the imported furnace.glb root. Position is preset to the fire mouth.
## - Warm local OmniLight flicker (layered sines + noise, no per-frame allocation)
## - "Braided" flame tongues: gently scales/sways the imported Furnace_Fire node
## - Drifting sparks: small GPUParticles3D (CPUParticles3D fallback if desired)
extends Node3D

@export var base_energy := 2.4
@export var light_range := 4.5
@export var spark_amount := 24

var _light: OmniLight3D
var _fire: Node3D
var _t := 0.0
var _noise := FastNoiseLite.new()

func _ready() -> void:
	position = Vector3(0, 1.15, 0.45)  # fire mouth centre, furnace local space
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.55, 0.22)
	_light.omni_range = light_range
	_light.omni_attenuation = 1.6
	_light.shadow_enabled = false  # mobile: keep cheap
	_light.position = Vector3(0, 0.05, 0.35)
	add_child(_light)
	_fire = get_parent().find_child("Furnace_Fire", true, false) as Node3D
	_noise.frequency = 2.5
	_make_sparks()

func _process(dt: float) -> void:
	if not is_visible_in_tree(): return
	_t += dt
	var f := 0.82 + 0.10 * sin(_t * 7.3) + 0.06 * sin(_t * 13.1 + 1.7) + 0.12 * _noise.get_noise_1d(_t * 40.0)
	_light.light_energy = base_energy * f
	if _fire:
		_fire.scale = Vector3(1.0 + 0.03 * sin(_t * 5.0), 0.92 + 0.12 * f, 1.0)
		_fire.rotation.z = 0.025 * sin(_t * 3.1)

func _make_sparks() -> void:
	var p := GPUParticles3D.new()
	p.amount = spark_amount
	p.lifetime = 1.8
	p.position = Vector3(0, 0.0, 0.15)
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(0.28, 0.03, 0.08)
	m.direction = Vector3(0, 1, 0.35)
	m.spread = 25.0
	m.initial_velocity_min = 0.4
	m.initial_velocity_max = 1.1
	m.gravity = Vector3(0, 0.25, 0)  # buoyant drift
	m.turbulence_enabled = true
	m.turbulence_noise_strength = 0.4
	m.scale_min = 0.6
	m.scale_max = 1.2
	var g := Gradient.new()
	g.set_color(0, Color(1.0, 0.9, 0.5, 1))
	g.set_color(1, Color(0.9, 0.2, 0.02, 0))
	var gt := GradientTexture1D.new(); gt.gradient = g
	m.color_ramp = gt
	p.process_material = m
	var q := QuadMesh.new(); q.size = Vector2(0.012, 0.012)
	var sm := StandardMaterial3D.new()
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	sm.vertex_color_use_as_albedo = true
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	q.material = sm
	p.draw_pass_1 = q
	p.visibility_aabb = AABB(Vector3(-1, -0.2, -0.5), Vector3(2, 2.5, 2))
	add_child(p)
