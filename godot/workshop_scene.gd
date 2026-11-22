class_name WorkshopScene
extends RefCounted
const SmithyArt = preload("res://smithy_art.gd")
const ForgeMaterials = preload("res://forge_materials.gd")

# Procedural art only. Main owns movement, combat, voice and forge state.
static func material(hex: String, metallic: float = 0.0, roughness: float = 0.8, glow: float = 0.0) -> StandardMaterial3D:
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_color = Color(hex)
	mat.metallic = metallic
	mat.roughness = roughness
	if glow > 0.0:
		mat.emission_enabled = true
		mat.emission = Color(hex)
		mat.emission_energy_multiplier = glow
	return mat

static func piece(parent: Node3D, mesh: Mesh, pos: Vector3, mat: Material) -> MeshInstance3D:
	var node: MeshInstance3D = MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = mat
	node.position = pos
	parent.add_child(node)
	return node

static func box(parent: Node3D, pos: Vector3, size: Vector3, mat: Material) -> MeshInstance3D:
	var mesh: BoxMesh = BoxMesh.new()
	mesh.size = size
	return piece(parent, mesh, pos, mat)

static func ball(parent: Node3D, pos: Vector3, scale_value: Vector3, mat: Material) -> MeshInstance3D:
	var mesh: SphereMesh = SphereMesh.new()
	mesh.radius = 0.5
	mesh.height = 1.0
	mesh.radial_segments = 12
	mesh.rings = 8
	var node: MeshInstance3D = piece(parent, mesh, pos, mat)
	node.scale = scale_value
	return node

static func cylinder(parent: Node3D, pos: Vector3, radius: float, height: float, mat: Material, top: float = -1.0) -> MeshInstance3D:
	var mesh: CylinderMesh = CylinderMesh.new()
	mesh.bottom_radius = radius
	mesh.top_radius = radius if top < 0.0 else top
	mesh.height = height
	mesh.radial_segments = 12
	return piece(parent, mesh, pos, mat)

static func label(parent: Node3D, text_value: String, pos: Vector3, size_value: int = 32, color: Color = Color("f9e5be")) -> Label3D:
	var node: Label3D = Label3D.new()
	node.text = text_value
	node.position = pos
	node.font_size = size_value
	node.pixel_size = 0.005
	node.modulate = color
	node.outline_size = 5
	parent.add_child(node)
	return node

static func button_face(target: Node3D, size: Vector3) -> void:
	var model := SmithyArt.place(target, "smithy/sign", Vector3.ZERO, Vector3(size.x,size.y,size.z/0.08))
	var face := model.find_child("Sign_LetterField", true, false) as MeshInstance3D
	if face != null and face.mesh.get_surface_count() == 1:
		face.material_override = face.mesh.surface_get_material(0)
		target.set_meta("button_face", face)

static func station_sign(parent: Node3D, title: String, subtitle: String, pos: Vector3, accent: Material) -> void:
	# Keep the three workshop tasks recognizable from the arrival area.
	box(parent, pos, Vector3(2.6, 0.53, 0.10), material("263a37"))
	box(parent, pos + Vector3(0, -0.27, 0.035), Vector3(2.6, 0.045, 0.11), accent)
	label(parent, title, pos + Vector3(0, 0.07, 0.065), 35)
	label(parent, subtitle, pos + Vector3(0, -0.14, 0.065), 18, Color("d6e1d4"))

static func collision(parent: Node3D, pos: Vector3, size: Vector3, surface_material: String = "") -> StaticBody3D:
	var body: StaticBody3D = StaticBody3D.new()
	body.position = pos
	if not surface_material.is_empty(): body.set_meta("surface_material", surface_material)
	parent.add_child(body)
	var shape: BoxShape3D = BoxShape3D.new()
	shape.size = size
	var collider: CollisionShape3D = CollisionShape3D.new()
	collider.shape = shape
	body.add_child(collider)
	return body

static func light(parent: Node3D, pos: Vector3, color: Color, energy: float, radius: float) -> void:
	var node: OmniLight3D = OmniLight3D.new()
	node.position = pos
	node.light_color = color
	node.light_energy = energy
	node.omni_range = radius
	parent.add_child(node)

static func build(root: Node3D) -> Dictionary:
	var wood: Material = ForgeMaterials.material("timber","876c54")
	var iron: Material = ForgeMaterials.material("iron","a3b3bc")
	var brass: Material = material("c49746", 0.6, 0.4)
	var world: WorldEnvironment = WorldEnvironment.new()
	var env: Environment = Environment.new()
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("438dd5")
	sky_mat.sky_horizon_color = Color("82b8e2")
	sky_mat.ground_bottom_color = Color("9cab8c")
	sky_mat.ground_horizon_color = Color("82b8e2")
	sky.sky_material = sky_mat
	env.sky = sky
	env.background_mode = Environment.BG_SKY
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("c5d7df")
	env.ambient_light_energy = 0.38
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.fog_enabled = true
	env.fog_light_color = Color("adc5d8")
	env.fog_density = 0.001
	world.environment = env
	world.name = "AdventureEnvironment"
	root.add_child(world)
	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48.0, -28.0, 0.0)
	sun.light_color = Color("ffe6bd")
	sun.light_energy = 1.05
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 50
	sun.name = "AdventureSun"
	root.add_child(sun)
	var adventure: Dictionary = preload("res://world_zones.gd").build(root)
	var furnace := SmithyArt.place(root, "smithy/furnace", Vector3(-3.1,0,-4.7))
	furnace.add_child(preload("res://assets/smithy/smithy/forge_fire.gd").new())
	collision(root, Vector3(-3.1,0.92,-4.7), Vector3(1.90,1.84,1.16), "stone")
	SmithyArt.place(root, "smithy/anvil", Vector3(-0.35,0,-2.9))
	# Keep the wooden stump distinct from the metal working face for contacts.
	collision(root, Vector3(-0.35,0.35,-2.9),Vector3(0.95,0.7,0.95),"wood")
	collision(root, Vector3(-0.35,0.96,-2.9),Vector3(1.25,0.52,0.8),"metal")
	var brann := SmithyArt.place(root, "brann/brann", Vector3(0,0,-4))
	brann.name = "BrannCopperpot"
	brann.set_meta("kind", "brann")
	brann.set_meta("surface_material", "flesh")
	var head := brann.find_child("HeadPivot", true, false) as Node3D
	var beard := brann.find_child("BeardPivot", true, false) as Node3D
	var arm := brann.find_child("StrikePivot", true, false) as Node3D
	if arm.get_parent() != brann: arm.reparent(brann)
	var speech_driver := Node3D.new()
	beard.get_parent().add_child(speech_driver)
	beard.reparent(speech_driver)
	brann.set_meta("speech_head", head)
	brann.set_meta("speech_beard", speech_driver)
	brann.set_meta("rest_arm", brann.find_child("RestPivot", true, false))
	var eyes: Array[Node3D] = []
	for eye_name in ["EyeL", "EyeR"]:
		var eye := head.find_child(eye_name, true, false) as Node3D
		if eye != null: eyes.append(eye)
	brann.set_meta("eyes", eyes)
	var presence_anchor := brann.find_child("PresenceAnchor", true, false) as Node3D
	presence_anchor.position = Vector3(0,1.12,0.36)
	var rune := brann.find_child("PresenceIndicator", true, false) as MeshInstance3D
	var glow := (rune.mesh.surface_get_material(0) as StandardMaterial3D).duplicate() as StandardMaterial3D
	rune.set_surface_override_material(0, glow)
	brann.set_meta("presence_rune", rune)
	brann.set_meta("presence_glow", glow)
	brann.set_meta("presence_label", label(brann,"",Vector3(0,0.96,0.43),16))
	var smith_hammer: Node3D = make_hammer(wood,iron,brass)
	smith_hammer.position = Vector3(0,-0.45,0.16)
	smith_hammer.rotation.x = PI/2.0
	smith_hammer.rotate_object_local(Vector3.UP,PI/2.0)
	smith_hammer.position-=smith_hammer.basis*Vector3(0,0.13,0)
	arm.add_child(smith_hammer)
	brann.set_meta("smith_hammer",smith_hammer)
	collision(brann,Vector3(0,0.9,0),Vector3(0.95,1.8,0.65),"flesh")
	var smith_name := label(brann,"Brann Copperpot",Vector3(0,2.10,0),23)
	smith_name.pixel_size = 0.0038
	smith_name.visibility_range_begin = 2.5
	smith_name.visibility_range_end = 7.5
	var question: Label3D = label(brann,"Reward ready",Vector3(0,2.25,0),18,Color("ffce79"))
	question.pixel_size = 0.0034
	question.visibility_range_end = 8.5
	question.visible = false
	var rack: Node3D = Node3D.new()
	rack.position = preload("res://smithy_layout.gd").STARTER_BENCH + Vector3.UP
	rack.name = "FinishedWeaponRack"
	root.add_child(rack)
	SmithyArt.place(rack, "smithy/bench", Vector3(0,-1,0), Vector3(0.85,1.0,1.0))
	collision(rack,Vector3(0,-0.06,0),Vector3(1.4,0.12,0.9),"wood")
	var hammer: Node3D = make_hammer(wood,iron,brass)
	hammer.position = rack.position + Vector3.UP * 0.02
	hammer.set_meta("kind","weapon")
	hammer.set_meta("id","starter_hammer")
	hammer.name = "StarterHammer"
	root.add_child(hammer)
	collision(hammer,Vector3(0,0.29,0),Vector3(0.42,0.68,0.24))
	var board: Node3D = Node3D.new()
	# Put talk, voice and commissions beside the smith. Previously the donation
	# table covered the entire board and disabled its buttons by world X.
	board.name = "CommissionLedger"
	board.position = Vector3(1.9,1.83,-5.38)
	root.add_child(board)
	SmithyArt.place(board, "fixtures/furniture_plaque", Vector3(0,0,0.025), Vector3(2.12,2.32,1.25))
	label(board,"BRANN’S LEDGER",Vector3(0,0.91,0.10),31).pixel_size = 0.0032
	var bounty_label := label(board,"",Vector3(0,0.42,0.10),23)
	bounty_label.pixel_size = 0.00285
	var status_label := label(board,"",Vector3(0,-0.10,0.10),18)
	status_label.pixel_size = 0.0024
	var voice_label := label(board,"",Vector3(0,-0.31,0.10),17,Color("ddbb74"))
	voice_label.pixel_size = 0.0025
	var buttons: Array[Node3D] = []
	var actions := ["retry","voice","upgrade","commission"]
	var captions := ["TALK TO BRANN","CHANGE VOICE","FORGE TIERS","INVENT AN ITEM"]
	for i in actions.size():
		var button := Node3D.new()
		board.add_child(button)
		button.position = Vector3(-0.47+(i%2)*0.94,-0.55-floorf(float(i)/2)*0.30,0.12)
		button.set_meta("action",actions[i])
		button.set_meta("hint_position",board.global_position + Vector3(0,1.25,0.22))
		button.set_meta("kind","button")
		button.set_meta("surface_material","wood")
		button_face(button,Vector3(0.88,0.23,0.10))
		label(button,captions[i],Vector3(0,0,0.058),18).pixel_size = 0.0028
		collision(button,Vector3.ZERO,Vector3(0.88,0.23,0.11))
		buttons.append(button)
	# Physical commissioning controls are accessible by a controller ray in VR.
	SmithyArt.place(root, "fixtures/furniture_plaque", Vector3(-6.9,1.9,-4.51), Vector3(3.4,2.7,1.7))
	label(root,"TOOLS · POINT + TRIGGER",Vector3(-6.9,3.0,-4.39),27)
	var tool_ids := ["apprentice_hammer","woodland_axe","quarry_pick","bomb_glove","grappling_hook","spore_lantern","crystal_resonator","ember_gauntlet"]
	var tool_names := ["COPPERPOT'S PROMISE","ORCHARD'S EDGE","STONEWHISPER","POCKET THUNDER","SWALLOWLINE","MOONCAP LANTERN","HOLLOW'S SONG","THE LAST HEARTH"]
	for i in range(tool_ids.size()):
		var button := Node3D.new()
		button.position = Vector3(-7.72+(i%2)*1.64,2.52-floorf(float(i)/2.0)*0.48,-4.26)
		button.set_meta("kind","button")
		button.set_meta("surface_material","wood")
		button.set_meta("action","tool:"+tool_ids[i])
		button.set_meta("hint_position",Vector3(-6.9,0.25,-4.02))
		root.add_child(button)
		button_face(button,Vector3(1.54,0.38,0.16))
		label(button,tool_names[i],Vector3(0,0.055,0.10),19)
		button.set_meta("availability_label",label(button,"",Vector3(0,-0.095,0.105),15,Color("ddbb74")))
		collision(button,Vector3.ZERO,Vector3(1.56,0.40,0.19))
		buttons.append(button)
	var upgrade := Node3D.new()
	upgrade.position = Vector3(-6.9,0.59,-4.21)
	upgrade.set_meta("kind","button")
	upgrade.set_meta("surface_material","wood")
	upgrade.set_meta("action","upgrade")
	upgrade.set_meta("hint_position",Vector3(-6.9,0.25,-4.02))
	root.add_child(upgrade)
	button_face(upgrade,Vector3(3.16,0.30,0.18))
	label(upgrade,"KINDLE THE NEXT FORGE TIER",Vector3(0,0,0.11),22)
	collision(upgrade,Vector3.ZERO,Vector3(3.2,0.32,0.21))
	buttons.append(upgrade)
	var rats: Array[Node3D] = []
	for i in range(7):
		var rat: Node3D = make_rat(i)
		rat.position = Vector3(-4.0+(i%4)*2.4,0,55.0+floorf(float(i)/4.0)*1.65)
		rat.rotation.y = i*0.93
		rat.set_meta("base_position",rat.position)
		root.add_child(rat)
		rats.append(rat)
	var dummies: Array[Node3D] = []
	for x in [-7.2,-5.2]:
		var dummy: Node3D = Node3D.new()
		dummy.position = Vector3(x,0,2.2)
		dummy.set_meta("kind","dummy")
		root.add_child(dummy)
		SmithyArt.place(dummy, "smithy/dummy")
		collision(dummy,Vector3(0,1.2,0),Vector3(1.15,1.8,0.6),"wood")
		label(dummy,"TEST YOUR CRAFT",Vector3(0,2.4,0),25)
		dummies.append(dummy)
	var result: Dictionary = {"brann":brann,"arm":arm,"question":question,"rack":rack,"board":board,"hammer":hammer,"rats":rats,"dummies":dummies,"buttons":buttons,"status_label":status_label,"bounty_label":bounty_label,"voice_label":voice_label}
	result.merge(adventure)
	return result

static func make_hammer(_wood: Material, _iron: Material, _brass: Material) -> Node3D:
	return (load("res://assets/smithy/brann/hammer.glb") as PackedScene).instantiate() as Node3D

static func make_rat(index: int) -> Node3D:
	var node: Node3D = Node3D.new()
	node.name = "KitchenRat%d" % index
	node.set_meta("kind","rat")
	node.set_meta("id","kitchen_rat_%d" % index)
	# Keep a compact, readable body: coat detail lives in the albedo, while the
	# muzzle, large ears and moving tail establish the silhouette in headset.
	var fur: StandardMaterial3D = material("d8cab6" if index%3==0 else ("b3afa5" if index%3==1 else "e2c9a0"))
	fur.albedo_texture=load("res://assets/creatures/rat-fur.png")
	fur.roughness=0.93
	var underfur=material("b8a38c" if index%3!=1 else "9a968c")
	var ear=material("bb807c")
	var inner_ear=material("dfaca5")
	var nose=material("b8797b",0.05,0.3)
	var dark=material("171b1f",0.25,0.16)
	var eye_glint=material("dff5ef",0.0,0.2,0.2)
	var whisker=material("d6c6aa")
	ball(node,Vector3(0,0.19,-0.035),Vector3(0.35,0.32,0.58),fur)
	ball(node,Vector3(0,0.105,0.035),Vector3(0.26,0.13,0.40),underfur)
	ball(node,Vector3(0,0.215,0.285),Vector3(0.27,0.235,0.32),fur)
	ball(node,Vector3(0,0.155,0.405),Vector3(0.13,0.10,0.13),underfur)
	ball(node,Vector3(0,0.19,0.49),Vector3(0.085,0.060,0.052),nose)
	for side in [-1,1]:
		ball(node,Vector3(side*0.142,0.36,0.205),Vector3(0.165,0.21,0.075),fur)
		ball(node,Vector3(side*0.15,0.366,0.251),Vector3(0.117,0.15,0.022),inner_ear)
		ball(node,Vector3(side*0.119,0.257,0.354),Vector3(0.073,0.071,0.055),dark)
		ball(node,Vector3(side*0.105,0.279,0.386),Vector3.ONE*0.018,eye_glint)
		ball(node,Vector3(side*0.055,0.16,0.425),Vector3(0.095,0.065,0.095),underfur)
		for z in [-0.18,0.18]:
			ball(node,Vector3(side*0.145,0.057,z),Vector3(0.15,0.07,0.19),fur)
			ball(node,Vector3(side*0.185,0.027,z+0.047),Vector3(0.14,0.037,0.10),ear)
			for claw in range(3):
				ball(node,Vector3(side*(0.21+claw*0.025),0.025,z+0.11),Vector3(0.022,0.022,0.075),whisker)
		for w in range(3):
			var whisker_tip=Vector3(side*(0.40+0.025*w),0.18+0.04*(w-1),0.45-0.032*w)
			var whisker_root=Vector3(side*0.065,0.155,0.44)
			var hair=cylinder(node,(whisker_root+whisker_tip)*0.5,0.0025,whisker_root.distance_to(whisker_tip),whisker)
			hair.basis=Basis.looking_at((whisker_tip-whisker_root).normalized(),Vector3.UP)*Basis(Vector3.RIGHT,PI/2)
	# Segments remain individual physical death pieces and articulate as one tail
	# joint during life. A taper and curved centreline read better than a rod.
	for i in range(8):
		var z=-0.31-i*0.085
		var y=0.09+0.008*i+0.012*sin(i*0.75)
		var tail=cylinder(node,Vector3(0.032*sin(i*0.55),y,z),maxf(0.006,0.031-i*0.003),0.105,ear)
		tail.rotation.x=PI/2.0+0.10*sin(i*0.8)
	for i in range(3):
		var tuft=ball(node,Vector3((i-1)*0.075,0.33,-0.11+i*0.09),Vector3(0.085,0.06,0.15),fur)
		tuft.rotation.z=(i-1)*0.3
	collision(node,Vector3(0,0.19,0.04),Vector3(0.38,0.4,0.78),"flesh")
	return node

# Sack seams, bindings and replaceable target plates retain the existing hit body.
static func detail_dummy(dummy:Node3D,wood:Material,cream:Material):
	var rope=material("806444")
	var straw=material("d8b96c")
	var dark=material("463b32")
	for y in [0.19,0.23]: cylinder(dummy,Vector3(0,y,0),0.36,0.025,rope)
	for y in [1.02,1.06,1.68,1.72]: cylinder(dummy,Vector3(0,y,0),0.13,0.024,rope)
	for side in [-1,1]:
		for x in [0.42,0.46,0.50]:
			var tie=cylinder(dummy,Vector3(side*x,1.55,0),0.089,0.025,rope)
			tie.rotation.z=PI/2
		for i in range(5):
			var stem=box(dummy,Vector3(side*(0.53+i*0.015),1.55+(i-2)*0.025,0.01),Vector3(0.21,0.014,0.018),straw)
			stem.rotation.z=side*(i-2)*0.15
		ball(dummy,Vector3(side*0.073,1.95,0.16),Vector3(0.035,0.04,0.024),dark)
	for i in range(6):
		var stitch=box(dummy,Vector3(-0.20,1.17+i*0.06,0.175),Vector3(0.065,0.014,0.018),cream)
		stitch.rotation.z=0.45
	for i in range(4):
		box(dummy,Vector3(-0.058+i*0.038,1.83,0.15),Vector3(0.012,0.039,0.014),dark)
	for side in [-1,1]:
		var foot=box(dummy,Vector3(side*0.29,0.17,0),Vector3(0.11,0.29,0.44),wood)
		foot.rotation.z=side*0.55
	var patch=box(dummy,Vector3(0.16,1.15,0.195),Vector3(0.13,0.14,0.014),material("658178"))
	patch.rotation.z=-0.18
	for x in [-0.045,0.045]: box(patch,Vector3(x,0,0.01),Vector3(0.009,0.11,0.008),cream)
	for radius in [0.175,0.125]:
		var ring=TorusMesh.new()
		ring.inner_radius=radius-0.009
		ring.outer_radius=radius+0.009
		ring.rings=20
		ring.ring_segments=6
		var rim=piece(dummy,ring,Vector3(0,1.37,0.258),cream)
		rim.rotation.x=PI/2
