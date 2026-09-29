extends Node
## Pocket Thunder authored visuals. setup / create_bomb / update_forming / tick /
## explosion keep their gameplay-facing signatures.
## Physics, damage, throw timing and fuse authority stay in gameplay code.
## Adds optional: update_fuse(model, elapsed_fraction) and explosion(..., direction).

const BOMB_SCENE_PATH := "res://pocket_thunder/bomb.glb"
const SHADER_DIR := "res://pocket_thunder/"
const MODEL_RADIUS := 0.095
const SNAP := 0.06                 # anticipation (seconds at duration 0.75) before the pop
const MAX_BURSTS := 8              # pooled blast rigs; oldest is recycled when exhausted
const MAX_LIGHTS := 2              # pooled OmniLight3D nodes, never permanent
const DEBRIS := 14
const SPARKS := 40
const EMBERS := 20
const SMOKE := 6
const TRAIL_POINTS := 12

var game
var audio_volume = 0.65
var trails_enabled = true
var clock = 0.0
var models: Array = []
var bursts: Array = []      # active rigs
var trails: Dictionary = {}
var stage: Node3D
var bomb_scene: PackedScene
var boom: AudioStreamWAV
var blast_serial = 0
var fuse_peak = 0.0

var disc_material: ShaderMaterial
var dome_material: ShaderMaterial
var spark_material: ShaderMaterial
var debris_material: ShaderMaterial
var smoke_material: ShaderMaterial
var trail_material: StandardMaterial3D
var mote_material: ShaderMaterial

var spark_mesh: ArrayMesh
var debris_mesh: Mesh
var smoke_mesh: SphereMesh
var dome_mesh: SphereMesh
var disc_mesh: PlaneMesh
var core_mesh: SphereMesh

var rig_pool: Array = []
var light_pool: Array = []
var heart_material: BaseMaterial3D
var heart_base_energy = 2.2

func setup(owner_game):
	game = owner_game
	stage = Node3D.new()
	stage.name = "PocketThunderEffects"
	game.add_child(stage)
	bomb_scene = load(BOMB_SCENE_PATH) as PackedScene
	disc_material = _shader_material("pt_shockwave.gdshader")
	dome_material = _shader_material("pt_dome.gdshader")
	spark_material = _shader_material("pt_spark.gdshader")
	debris_material = _shader_material("pt_debris.gdshader")
	smoke_material = _shader_material("pt_smoke.gdshader")
	mote_material = spark_material.duplicate()
	trail_material = StandardMaterial3D.new()
	trail_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	trail_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	trail_material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	trail_material.vertex_color_use_as_albedo = true
	trail_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	spark_mesh = _stretched_octahedron()
	smoke_mesh = SphereMesh.new()
	smoke_mesh.radius = 1.0
	smoke_mesh.height = 2.0
	smoke_mesh.radial_segments = 10
	smoke_mesh.rings = 5
	dome_mesh = SphereMesh.new()
	dome_mesh.radius = 1.0
	dome_mesh.height = 2.0
	dome_mesh.radial_segments = 32
	dome_mesh.rings = 16
	core_mesh = SphereMesh.new()
	core_mesh.radius = 1.0
	core_mesh.height = 2.0
	core_mesh.radial_segments = 12
	core_mesh.rings = 6
	disc_mesh = PlaneMesh.new()
	disc_mesh.size = Vector2(2, 2)
	debris_mesh = _find_segment_mesh()
	for i in range(MAX_LIGHTS):
		var light = OmniLight3D.new()
		light.light_color = Color("ffb066")
		light.shadow_enabled = false
		light.light_energy = 0.0
		light.visible = false
		stage.add_child(light)
		light_pool.append(light)
	for i in range(MAX_BURSTS):
		rig_pool.append(_build_rig())

func _shader_material(file: String) -> ShaderMaterial:
	var mat = ShaderMaterial.new()
	mat.shader = load(SHADER_DIR + file)
	return mat

func _find_segment_mesh() -> Mesh:
	if bomb_scene == null: return _stretched_octahedron()
	var inst = bomb_scene.instantiate()
	var seg = inst.find_child("Shell_Seg_00", true, false)
	var mesh: Mesh = null
	if seg is MeshInstance3D: mesh = seg.mesh
	inst.free()
	return mesh if mesh != null else _stretched_octahedron()

func _stretched_octahedron() -> ArrayMesh:
	# Unit-height diamond along +Y: velocity-aligned spark streak, 8 triangles.
	var surface = SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var ring = [Vector3(1, 0, 0), Vector3(0, 0, 1), Vector3(-1, 0, 0), Vector3(0, 0, -1)]
	for i in range(4):
		var a = ring[i] * 0.5
		var b = ring[(i + 1) % 4] * 0.5
		for p in [Vector3(0, 0.5, 0), a, b, Vector3(0, -0.5, 0), b, a]: surface.add_vertex(p)
	surface.generate_normals()
	return surface.commit()

func _multimesh(mesh: Mesh, count: int, material: Material) -> MultiMeshInstance3D:
	var mm = MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = count
	mm.visible_instance_count = 0
	var node = MultiMeshInstance3D.new()
	node.multimesh = mm
	node.material_override = material
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	node.custom_aabb = AABB(Vector3(-12, -12, -12), Vector3(24, 24, 24))
	return node

func _mesh_instance(mesh: Mesh, material: Material) -> MeshInstance3D:
	var node = MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node

func _build_rig() -> Dictionary:
	var root = Node3D.new()
	root.visible = false
	stage.add_child(root)
	var disc = _mesh_instance(disc_mesh, disc_material)
	var dome = _mesh_instance(dome_mesh, dome_material)
	var core = _mesh_instance(core_mesh, spark_material)
	var debris = _multimesh(debris_mesh, DEBRIS, debris_material)
	debris.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	var sparks = _multimesh(spark_mesh, SPARKS, spark_material)
	var embers = _multimesh(spark_mesh, EMBERS, spark_material)
	var smoke = _multimesh(smoke_mesh, SMOKE, smoke_material)
	for n in [disc, dome, core, debris, sparks, embers, smoke]:
		root.add_child(n)
	return {"root": root, "disc": disc, "dome": dome, "core": core, "debris": debris, "sparks": sparks, "embers": embers, "smoke": smoke, "active": false, "light": null}

# ---------------------------------------------------------------- bomb model

func create_bomb(parent: Node3D, radius: float = 0.095) -> Node3D:
	radius = clampf(radius, 0.035, 0.3)
	var root = Node3D.new()
	root.name = "PocketThunder"
	parent.add_child(root)
	root.set_meta("ready", false)
	root.set_meta("bomb_visual", true)
	root.set_meta("radius", radius)
	var inst: Node3D = bomb_scene.instantiate() if bomb_scene != null else Node3D.new()
	inst.scale = Vector3.ONE * (radius / MODEL_RADIUS)
	root.add_child(inst)
	if bomb_scene == null:
		# The throw remains visible if the optional imported art is unavailable.
		var fallback := MeshInstance3D.new()
		fallback.name = "Heart"
		var fallback_mesh := SphereMesh.new()
		fallback_mesh.radius = MODEL_RADIUS * 0.8
		fallback_mesh.height = MODEL_RADIUS * 1.6
		fallback.mesh = fallback_mesh
		var fallback_mat := StandardMaterial3D.new()
		fallback_mat.albedo_color = Color(0.04, 0.24, 0.22)
		fallback_mat.emission_enabled = true
		fallback_mat.emission = Color(0.14, 0.9, 0.7)
		fallback_mat.emission_energy_multiplier = 2.2
		fallback.material_override = fallback_mat
		inst.add_child(fallback)
	var heart = inst.find_child("Heart", true, false)
	var shell = inst.find_child("Shell", true, false)
	var crown = inst.find_child("Crown", true, false)
	var base = inst.find_child("Base", true, false)
	var binding = inst.find_child("Binding", true, false)
	var trail_origin = inst.find_child("TrailOrigin", true, false)
	var parts = []
	if shell != null:
		var index = 0
		for seg in shell.get_children():
			if not (seg is Node3D): continue
			var rest: Vector3 = seg.position
			parts.append({"node": seg, "rest": rest, "rest_basis": seg.basis, "direction": rest.normalized(), "phase": float(seg.get_meta("phase", float(index % 5) * 0.04))})
			index += 1
	if heart is MeshInstance3D and heart_material == null:
		heart_material = heart.mesh.surface_get_material(0) as BaseMaterial3D
		if heart_material != null: heart_base_energy = heart_material.emission_energy_multiplier
	var motes = []
	for i in range(5):
		var mote = _mesh_instance(spark_mesh, mote_material)
		mote.set_instance_shader_parameter("tint", Color(0.35, 1.0, 0.82, 0.9))
		mote.scale = Vector3.ONE * radius * 0.16
		root.add_child(mote)
		motes.append(mote)
	root.set_meta("parts", parts)
	if heart != null: root.set_meta("heart", heart)
	if crown != null: root.set_meta("crown", crown)
	if base != null: root.set_meta("base", base)
	if binding != null: root.set_meta("binding", binding)
	if trail_origin != null: root.set_meta("trail_origin", trail_origin)
	root.set_meta("motes", motes)
	root.set_meta("fuse", 0.0)
	root.set_meta("formation_progress", 1.0)
	models.append(root)
	update_forming(root, 1.0)
	return root

func update_forming(model: Node3D, progress: float):
	if not is_instance_valid(model) or not model.get_meta("bomb_visual", false): return
	progress = clampf(progress, 0, 1)
	model.set_meta("formation_progress", progress)
	for part in model.get_meta("parts", []):
		var amount = smoothstep(float(part.phase), 0.92, progress)
		var node: Node3D = part.node
		node.position = part.rest + part.direction * MODEL_RADIUS * (1.0 - amount) * 2.8
		node.basis = (Basis.from_euler(Vector3((1.0 - amount) * 0.7, 0, (1.0 - amount) * 0.4)) * part.rest_basis).scaled(Vector3.ONE * maxf(0.015, amount))
		node.visible = progress > float(part.phase)
	var crown = model.get_meta("crown") if model.has_meta("crown") else null
	if crown != null:
		crown.scale = Vector3.ONE * maxf(0.02, smoothstep(0.6, 1.0, progress))
		crown.position.y = (1.0 - smoothstep(0.6, 1.0, progress)) * MODEL_RADIUS * 0.6
	var base = model.get_meta("base") if model.has_meta("base") else null
	if base != null: base.visible = progress > 0.55
	var binding = model.get_meta("binding") if model.has_meta("binding") else null
	if binding != null:
		binding.visible = progress > 0.82
		binding.scale = Vector3.ONE * maxf(0.01, smoothstep(0.82, 1.0, progress))

## Optional: 0..1 of the fuse elapsed, drives heart pulse speed/amplitude.
func update_fuse(model: Node3D, elapsed_fraction: float):
	if is_instance_valid(model): model.set_meta("fuse", clampf(elapsed_fraction, 0, 1))

# ---------------------------------------------------------------- tick

func tick(delta: float):
	clock += delta
	fuse_peak = 0.0
	for i in range(models.size() - 1, -1, -1):
		var model = models[i]
		if not is_instance_valid(model):
			models.remove_at(i)
			continue
		var body = model.get_parent()
		if body != null and body.is_in_group("magic_bomb"):
			var spawned = float(body.get_meta("spawned_at", clock))
			var fuse_at = float(body.get_meta("fuse_at", spawned + 1.0))
			update_fuse(model, (game.elapsed - spawned) / maxf(fuse_at - spawned, 0.05))
		var radius = float(model.get_meta("radius", 0.095))
		var progress = float(model.get_meta("formation_progress", 1.0))
		var fuse = float(model.get_meta("fuse", 0.0))
		fuse_peak = maxf(fuse_peak, fuse)
		var pulse = sin(clock * (6.2 + fuse * 16.0))
		var heart = model.get_meta("heart") if model.has_meta("heart") else null
		if heart != null:
			heart.scale = Vector3.ONE * maxf(0.025, smoothstep(0.0, 0.65, progress)) * (1.0 + (0.035 + 0.06 * fuse) * pulse)
		var motes = model.get_meta("motes", [])
		for j in range(motes.size()):
			var angle = clock * 1.8 + float(j) * TAU / float(motes.size())
			motes[j].position = Vector3(cos(angle), sin(angle * 1.3) * 0.35, sin(angle)) * radius * (1.24 + (1 - progress) * 1.6)
			motes[j].rotation = Vector3(clock, float(j), clock * 0.6)
	if heart_material != null:
		heart_material.emission_energy_multiplier = heart_base_energy * (1.0 + 0.16 * sin(clock * (6.2 + fuse_peak * 16.0)) + 0.5 * fuse_peak)
	for i in range(bursts.size() - 1, -1, -1):
		var rig = bursts[i]
		var age = clock - float(rig.born)
		if age > float(rig.life):
			_release_rig(rig)
			bursts.remove_at(i)
			continue
		_update_rig(rig, age)
	_update_trails()

# ---------------------------------------------------------------- explosion

## direction: optional world direction of travel (bomb velocity) to bias the fragment burst.
func explosion(position: Vector3, radius: float, intensity: float = 1.0, duration: float = 0.75, spark_count: int = 24, direction: Vector3 = Vector3.ZERO):
	if stage == null: return
	radius = clampf(radius, 0.3, 10)
	intensity = clampf(intensity, 0, 2)
	if intensity <= 0:
		_sound(position, 1.0)
		return
	duration = clampf(duration, 0.2, 2)
	var rig = _acquire_rig()
	blast_serial += 1
	var rng = RandomNumberGenerator.new()
	rng.seed = 7001 + blast_serial * 131
	rig.root.global_position = position
	rig.root.visible = true
	rig.active = true
	rig.born = clock
	rig.ts = duration / 0.75
	rig.life = rig.ts * 2.6
	rig.radius = radius
	rig.intensity = intensity
	rig.floor_y = _floor_offset(position)
	rig.core_size = clampf(radius * 0.09, 0.05, 0.35)
	rig.spark_n = clampi(spark_count, 0, SPARKS)
	rig.debris_n = clampi(int(round(DEBRIS * clampf(intensity, 0.4, 1.0))), 4, DEBRIS)
	var dir = direction.normalized() if direction.length() > 0.01 else Vector3.ZERO
	var d_vel = []
	var d_spin = []
	var d_size = []
	for i in range(DEBRIS):
		var a = float(i) * 2.399963 + rng.randf() * 0.4
		var h = lerpf(-0.05, 0.95, fmod(float(i) * 0.61803, 1.0))
		var v = Vector3(cos(a), h, sin(a)).normalized()
		if dir != Vector3.ZERO: v = (v + dir * 0.9).normalized()
		d_vel.append(v * radius * rng.randf_range(2.2, 4.0))
		d_spin.append(Vector3(rng.randf_range(-9, 9), rng.randf_range(-9, 9), rng.randf_range(-9, 9)))
		d_size.append(rng.randf_range(0.28, 0.6) * clampf(radius * 0.9, 1.0, 3.0))
	var s_vel = []
	var s_teal = []
	for i in range(SPARKS):
		var a = float(i) * 2.399963 + rng.randf() * 0.5
		var v = Vector3(cos(a), rng.randf_range(-0.1, 1.0), sin(a)).normalized()
		if dir != Vector3.ZERO: v = (v + dir * 0.6).normalized()
		s_vel.append(v * radius * rng.randf_range(2.0, 4.2))
		s_teal.append(i % 4 == 0)
	var e_start = []
	var e_vel = []
	var e_phase = []
	for i in range(EMBERS):
		var v = Vector3(rng.randf_range(-1, 1), rng.randf_range(0.1, 1), rng.randf_range(-1, 1)).normalized()
		e_start.append(v * radius * rng.randf_range(0.05, 0.3))
		e_vel.append(v * radius * rng.randf_range(0.15, 0.55) + Vector3.UP * rng.randf_range(0.3, 0.7))
		e_phase.append(rng.randf() * TAU)
	rig.d_vel = d_vel
	rig.d_spin = d_spin
	rig.d_size = d_size
	rig.s_vel = s_vel
	rig.s_teal = s_teal
	rig.e_start = e_start
	rig.e_vel = e_vel
	rig.e_phase = e_phase
	rig.light = _acquire_light()
	rig.disc.visible = false
	rig.dome.visible = false
	rig.disc.set_instance_shader_parameter("progress", 0.0)
	rig.dome.set_instance_shader_parameter("progress", 0.0)
	bursts.append(rig)
	_update_rig(rig, 0.0)
	_sound(position, intensity)

func _acquire_rig() -> Dictionary:
	for rig in rig_pool:
		if not rig.active: return rig
	var oldest = bursts[0]
	bursts.remove_at(0)
	_release_rig(oldest)
	return oldest

func _release_rig(rig: Dictionary):
	rig.active = false
	rig.root.visible = false
	if rig.light != null:
		rig.light.light_energy = 0.0
		rig.light.visible = false
		rig.light = null

func _acquire_light():
	for light in light_pool:
		if not light.visible: return light
	return null

func _floor_offset(position: Vector3) -> float:
	if not (game is Node3D): return -100.0
	var world = game.get_world_3d()
	if world == null: return -100.0
	var query = PhysicsRayQueryParameters3D.create(position + Vector3.UP * 0.3, position + Vector3.DOWN * 6.0)
	var hit = world.direct_space_state.intersect_ray(query)
	if hit.is_empty(): return -100.0
	return float(hit.position.y - position.y)

func _hidden_transform() -> Transform3D:
	return Transform3D(Basis.from_scale(Vector3.ONE * 0.0001), Vector3.ZERO)

func _update_rig(rig: Dictionary, age: float):
	var u = age / rig.ts
	var e = u - SNAP
	var radius = float(rig.radius)
	var inten = minf(float(rig.intensity), 1.0)
	var floor_y = maxf(float(rig.floor_y), -radius * 1.5)
	# Anticipatory snap: heart-sized glow inhales, then pops (amber, alpha-capped: no white wash).
	var core: MeshInstance3D = rig.core
	if e < 0.0:
		var k = clampf(u / SNAP, 0, 1)
		core.visible = true
		core.scale = Vector3.ONE * rig.core_size * lerpf(0.9, 0.32, k * k)
		core.set_instance_shader_parameter("tint", Color(1.0, 0.72, 0.38, (0.3 + 0.5 * k) * inten))
	else:
		var k = clampf(e / 0.2, 0, 1)
		core.visible = k < 1.0
		core.scale = Vector3.ONE * rig.core_size * lerpf(0.6, 2.1, 1.0 - pow(1.0 - k, 3.0))
		core.set_instance_shader_parameter("tint", Color(1.0, 0.62, 0.28, (1.0 - k) * 0.6 * inten))
	# Spatial light pulse: soft ramp during snap, sharp peak, exponential settle, then released.
	var light: OmniLight3D = rig.light
	if light != null:
		var energy = 0.0
		if e < 0.0: energy = 0.35 * clampf(u / SNAP, 0, 1)
		else: energy = 3.4 * exp(-e * 7.5) * smoothstep(0.0, 0.015, e)
		energy *= float(rig.intensity)
		light.global_position = rig.root.global_position + Vector3.UP * radius * 0.15
		light.omni_range = clampf(radius * 2.4, 2.0, 8.0)
		light.omni_attenuation = 1.5
		light.light_energy = energy
		light.visible = energy > 0.02 or e < 0.0
		if not light.visible and e > 0.1:
			# Give the scarce light back before the long ember/smoke tail ends.
			rig.light = null
	if e < 0.0:
		rig.disc.visible = false
		rig.dome.visible = false
		rig.debris.multimesh.visible_instance_count = 0
		rig.sparks.multimesh.visible_instance_count = 0
		rig.embers.multimesh.visible_instance_count = 0
		rig.smoke.multimesh.visible_instance_count = 0
		return
	# Shockwave disc on the floor + fresnel dome.
	var wave = clampf(e / 0.55, 0, 1)
	rig.disc.visible = wave < 1.0
	rig.disc.position = Vector3(0, floor_y + 0.02, 0)
	rig.disc.scale = Vector3(radius, 1, radius)
	rig.disc.set_instance_shader_parameter("progress", wave)
	var dome_p = clampf(e / 0.22, 0, 1)
	rig.dome.visible = dome_p < 1.0
	rig.dome.scale = Vector3.ONE * radius * 0.6 * (1.0 - pow(1.0 - dome_p, 3.0)) + Vector3.ONE * 0.02
	rig.dome.set_instance_shader_parameter("progress", dome_p)
	# Shell debris: real chips from the bomb's own segment mesh; cool from ember glow, settle at the floor.
	var dm: MultiMesh = rig.debris.multimesh
	dm.visible_instance_count = rig.debris_n
	var drag = 1.7
	var fade_out = clampf((u - rig.ts * 1.1) / (rig.ts * 0.9), 0, 1)
	for i in range(rig.debris_n):
		var v: Vector3 = rig.d_vel[i]
		var pos = v * (1.0 - exp(-drag * e)) / drag + Vector3.DOWN * 4.0 * e * e
		var grounded = pos.y < floor_y + 0.02
		if grounded: pos.y = floor_y + 0.02
		var spin: Vector3 = rig.d_spin[i] * (0.08 if grounded else 1.0) * exp(-e * 1.4)
		var basis = Basis.from_euler(spin * e + Vector3(float(i), float(i) * 0.7, 0)).scaled(Vector3.ONE * rig.d_size[i] * (1.0 - fade_out))
		dm.set_instance_transform(i, Transform3D(basis, pos))
		var heat = clampf(1.0 - e / 0.9, 0, 1)
		dm.set_instance_color(i, Color(1.0, 0.5, 0.2, heat) if i % 3 != 0 else Color(0.3, 0.95, 0.8, heat))
	# Sparks: velocity-aligned streaks (not billboards).
	var sm: MultiMesh = rig.sparks.multimesh
	sm.visible_instance_count = rig.spark_n
	var spark_life = 0.75
	for i in range(rig.spark_n):
		var v: Vector3 = rig.s_vel[i]
		var pos = v * (1.0 - exp(-3.0 * e)) / 3.0 + Vector3.DOWN * 3.0 * e * e
		if pos.y < floor_y + 0.02: pos.y = floor_y + 0.02
		var vel = v * exp(-3.0 * e) + Vector3.DOWN * 6.0 * e
		var k = clampf(e / spark_life, 0, 1)
		if k >= 1.0:
			sm.set_instance_transform(i, _hidden_transform())
			continue
		var y = vel.normalized()
		var x = y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
		var z = x.cross(y)
		var width = 0.014 * clampf(radius * 0.9, 0.8, 2.4) * (1.0 - k)
		var length = clampf(vel.length() * 0.04, 0.03, 0.4) * (1.0 - k * 0.7)
		sm.set_instance_transform(i, Transform3D(Basis(x * width, y * length, z * width), pos))
		var a = (1.0 - k * k) * inten
		sm.set_instance_color(i, Color(0.35, 1.0, 0.82, a) if rig.s_teal[i] else Color(1.0, lerpf(0.72, 0.3, k), lerpf(0.3, 0.1, k), a))
	# Settling embers: slow, drifting, long-lived.
	var em: MultiMesh = rig.embers.multimesh
	em.visible_instance_count = EMBERS
	for i in range(EMBERS):
		var t = e - float(i) * 0.012
		var life = rig.ts * 1.9
		if t < 0.0 or t > life:
			em.set_instance_transform(i, _hidden_transform())
			continue
		var v: Vector3 = rig.e_vel[i]
		var ph = float(rig.e_phase[i])
		var pos = rig.e_start[i] + v * (1.0 - exp(-2.0 * t)) / 2.0 + Vector3(sin(t * 3.0 + ph), 0.0, cos(t * 2.6 + ph)) * 0.03
		pos.y = maxf(pos.y - 0.25 * t * t, floor_y + 0.02)
		var k = t / life
		var flick = 0.75 + 0.25 * sin(t * 30.0 + ph)
		var s = 0.014 * clampf(radius * 0.6, 0.8, 2.0) * (1.0 - k * 0.6)
		em.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3(s, s * 2.0, s)), pos))
		em.set_instance_color(i, Color(1.0, lerpf(0.6, 0.18, k), lerpf(0.22, 0.05, k), (1.0 - k) * flick * inten))
	# Smoke: few noise-dissolved spheres, warm underlight cooling to grey.
	var sk: MultiMesh = rig.smoke.multimesh
	sk.visible_instance_count = SMOKE
	for i in range(SMOKE):
		var t = e - 0.08 - float(i) * 0.05
		var life = rig.ts * 1.7
		if t < 0.0 or t > life:
			sk.set_instance_transform(i, _hidden_transform())
			continue
		var k = t / life
		var ang = float(i) * TAU / float(SMOKE) + 0.5
		var pos = Vector3(cos(ang) * radius * 0.16 * (0.4 + k), floor_y + 0.08 + t * 0.6 * (1.0 - k * 0.4), sin(ang) * radius * 0.16 * (0.4 + k))
		var s = radius * lerpf(0.06, 0.2, 1.0 - pow(1.0 - k, 2.0))
		sk.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ONE * s), pos))
		var warm = clampf(1.0 - k * 2.2, 0, 1)
		sk.set_instance_color(i, Color(lerpf(0.26, 0.6, warm), lerpf(0.28, 0.38, warm), lerpf(0.3, 0.24, warm), 1.0 - k))

# ---------------------------------------------------------------- trail (same concept: fading ribbon behind flying bomb)

func _update_trails():
	var live = {}
	if trails_enabled:
		var camera = game.get_viewport().get_camera_3d()
		for body in game.get_tree().get_nodes_in_group("magic_bomb"):
			if not is_instance_valid(body) or body.get_meta("exploded", false): continue
			var key = body.get_instance_id()
			live[key] = true
			if not trails.has(key):
				var node = MeshInstance3D.new()
				node.mesh = ImmediateMesh.new()
				node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				node.material_override = trail_material
				node.custom_aabb = AABB(Vector3(-200, -200, -200), Vector3(400, 400, 400))
				stage.add_child(node)
				trails[key] = {"node": node, "points": [], "at": clock}
			var trail = trails[key]
			if clock < float(trail.at): continue
			trail.at = clock + 0.03
			trail.points.push_front(body.global_position)
			if trail.points.size() > TRAIL_POINTS: trail.points.pop_back()
			var mesh: ImmediateMesh = trail.node.mesh
			mesh.clear_surfaces()
			var n = trail.points.size()
			if n < 2: continue
			var eye = camera.global_position if camera != null else Vector3.ZERO
			mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
			for i in range(n):
				var p: Vector3 = trail.points[i]
				var tangent: Vector3 = (trail.points[maxi(i - 1, 0)] - trail.points[mini(i + 1, n - 1)]).normalized()
				var side = tangent.cross((eye - p).normalized())
				side = side.normalized() if side.length() > 0.001 else Vector3.RIGHT
				var f = float(i) / float(n - 1)
				var w = 0.022 * (1.0 - f)
				var c = Color(0.35, 1.0, 0.82, 0.85 * (1.0 - f) * (1.0 - f))
				mesh.surface_set_color(c)
				mesh.surface_add_vertex(p + side * w)
				mesh.surface_set_color(c)
				mesh.surface_add_vertex(p - side * w)
			mesh.surface_end()
	for key in trails.keys():
		if not live.has(key):
			trails[key].node.queue_free()
			trails.erase(key)

# ---------------------------------------------------------------- audio (unchanged contract, deterministic layered snap + thud + crack + tail)

func _sound(position: Vector3, intensity: float):
	if audio_volume <= 0 or DisplayServer.get_name() == "headless": return
	if boom == null: boom = _synthesize_boom()
	var player = AudioStreamPlayer3D.new()
	stage.add_child(player)
	player.global_position = position
	player.stream = boom
	player.max_distance = 22
	player.unit_size = 3
	player.volume_db = linear_to_db(clampf(audio_volume, 0.001, 1) * minf(intensity, 1.1)) - 5
	player.finished.connect(player.queue_free)
	player.play()

func _synthesize_boom() -> AudioStreamWAV:
	var sample_rate = 22050
	var samples = int(sample_rate * 0.7)
	var data = PackedByteArray()
	data.resize(samples * 2)
	var random = RandomNumberGenerator.new()
	random.seed = 709
	var noise = 0.0
	for i in range(samples):
		var t = float(i) / sample_rate
		noise = lerpf(noise, random.randf_range(-1, 1), 0.45)
		var snap = sin(TAU * 1900.0 * t) * exp(-t * 90.0) * 0.35 if t < 0.06 else 0.0  # anticipation tick
		var te = maxf(t - SNAP, 0.0)
		var bass = sin(TAU * (88.0 * te - 45.0 * te * te)) * exp(-te * 8.5)
		var crack = noise * exp(-te * 18.0)
		var rumble = sin(TAU * 41.0 * te) * exp(-te * 4.0) * 0.25
		var attack = 1.0 if t < SNAP else minf(1.0, te / 0.004)
		var value = clampf(snap + (bass * 0.6 + crack * 0.42 + rumble) * attack * (0.0 if t < SNAP else 1.0), -0.86, 0.86)
		data.encode_s16(i * 2, int(value * 32767))
	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.data = data
	return stream
