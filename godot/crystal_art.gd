extends RefCounted
## Reusable faceted shell, opaque luminous core, and inexpensive light spill.
## Art-only controls; changing these never changes tool damage or progression.
const SHELL_OPACITY = 0.68
const SHELL_GLOW = 0.65
const VEIN_SCALE = 12.0
const LIGHT_ENERGY = 0.65
const LIGHT_RANGE = 2.0
const PATTERN_ENERGY = 0.45
static var pattern: Texture2D

static func shard(parent: Node3D, position: Vector3, size: Vector3, color: Color) -> Node3D:
	var root := Node3D.new()
	parent.add_child(root)
	root.position = position
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := []
	for level in [Vector2(-0.5,0.28),Vector2(-0.32,0.5),Vector2(0.28,0.43),Vector2(0.5,0.12)]:
		var ring := PackedVector3Array()
		for i in range(6):
			var a := TAU*i/6.0
			ring.append(Vector3(cos(a)*level.y,level.x,sin(a)*level.y)*size)
		rings.append(ring)
	for j in range(3):
		for i in range(6):
			var k := (i+1)%6
			for v in [rings[j][i],rings[j+1][i],rings[j+1][k],rings[j][i],rings[j+1][k],rings[j][k]]: surface.add_vertex(v)
	for i in range(1,5):
		for v in [rings[0][0],rings[0][i],rings[0][i+1],rings[3][0],rings[3][i+1],rings[3][i]]: surface.add_vertex(v)
	surface.generate_normals()
	var shell := MeshInstance3D.new()
	shell.name = "CrystalShell"
	shell.mesh = surface.commit()
	var material := ShaderMaterial.new()
	material.shader = preload("res://crystal.gdshader")
	material.set_shader_parameter("tint",color)
	material.set_shader_parameter("opacity",SHELL_OPACITY)
	material.set_shader_parameter("glow",SHELL_GLOW)
	material.set_shader_parameter("vein_scale",VEIN_SCALE)
	shell.material_override = material
	root.add_child(shell)
	var core := MeshInstance3D.new()
	core.name = "CrystalCore"
	core.mesh = shell.mesh
	core.scale = Vector3(0.46,0.8,0.46)
	var inside := StandardMaterial3D.new()
	inside.albedo_color = color.lightened(0.3)
	inside.emission_enabled = true
	inside.emission = color.lightened(0.2)
	inside.emission_energy_multiplier = 0.65
	core.material_override = inside
	root.add_child(core)
	return root

static func illuminate(parent: Node3D, position: Vector3, color: Color) -> void:
	var light := OmniLight3D.new()
	light.position = position
	light.light_color = color
	light.light_energy = LIGHT_ENERGY
	light.omni_range = LIGHT_RANGE
	light.shadow_enabled = false
	parent.add_child(light)
	if pattern == null:
		# Small cached procedural light cookie: polygonal veins with a soft boundary.
		var pixels := Image.create(128,128,false,Image.FORMAT_RGBA8)
		for y in range(128):
			for x in range(128):
				var p := Vector2(x-63.5,y-63.5)/63.5
				var edge := clampf((1.0-p.length())*3.0,0,1)
				var seam := minf(absf(sin(p.x*12+p.y*5)),absf(sin(p.y*15-p.x*3)))
				var strength := (1.0-smoothstep(0.03,0.14,seam))*edge
				pixels.set_pixel(x,y,Color(strength,strength,strength,edge))
		pixels.generate_mipmaps()
		pattern = ImageTexture.create_from_image(pixels)
	var decal := Decal.new()
	decal.name = "CrystalLightPattern"
	decal.position = position-Vector3(0,0.6,0)
	decal.size = Vector3(1.5,1.5,1.5)
	decal.texture_emission = pattern
	decal.modulate = color
	decal.emission_energy = PATTERN_ENERGY
	decal.albedo_mix = 0
	decal.normal_fade = 0.7
	decal.upper_fade = 0.5
	decal.lower_fade = 0.5
	decal.distance_fade_enabled = true
	decal.distance_fade_begin = 8
	decal.distance_fade_length = 3
	parent.add_child(decal)

static func hammer(parent: Node3D) -> void:
	var crystal := shard(parent,Vector3(0,0.64,0),Vector3(0.31,0.61,0.30),Color("a451e0"))
	crystal.rotation.z = PI/2
	for side in [-1,1]:
		var cradle := WorldZones.box(parent,Vector3(side*0.18,0.51,0),Vector3(0.065,0.25,0.33),"bb9b64")
		cradle.rotation.z = side*-0.25
	WorldZones.cyl(parent,Vector3(0,0.44,0),0.075,0.12,"dfc78c")
	illuminate(parent,Vector3(0,0.64,0),Color("c78aff"))
