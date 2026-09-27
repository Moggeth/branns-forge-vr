extends RefCounted
const ForgeMaterials = preload("res://forge_materials.gd")

static func boot(root:Node3D,side:int):
	var leather=WorkshopScene.material("44342b")
	var sole=WorkshopScene.material("252725")
	var brass=WorkshopScene.material("ac8350",0.5)
	clipped_box(root,Vector3(side*0.19,0.07,0.09),Vector3(0.30,0.09,0.46),sole)
	clipped_box(root,Vector3(side*0.19,0.16,0.10),Vector3(0.28,0.15,0.43),leather)
	WorkshopScene.cylinder(root,Vector3(side*0.19,0.27,0),0.135,0.25,leather,0.15)
	WorkshopScene.cylinder(root,Vector3(side*0.19,0.38,0),0.157,0.055,sole)
	for y in [0.22,0.30]:
		WorkshopScene.box(root,Vector3(side*0.19,y,0.135),Vector3(0.24,0.027,0.025),sole)
		clipped_box(root,Vector3(side*0.25,y,0.154),Vector3(0.049,0.043,0.016),brass)

static func arm(root:Node3D,shirt:Material,skin:Material):
	WorkshopScene.ball(root,Vector3.ZERO,Vector3(0.29,0.27,0.28),shirt)
	WorkshopScene.cylinder(root,Vector3(0,-0.14,0.018),0.115,0.27,shirt,0.15).rotation.x=-0.14
	WorkshopScene.cylinder(root,Vector3(0,-0.265,0.04),0.124,0.07,WorkshopScene.material("79928a"))
	var forearm=WorkshopScene.cylinder(root,Vector3(0,-0.355,0.09),0.075,0.20,skin,0.105)
	forearm.rotation.x=-0.48
	clipped_box(root,Vector3(0,-0.46,0.16),Vector3(0.18,0.16,0.19),skin)
	WorkshopScene.ball(root,Vector3(0.075,-0.45,0.22),Vector3(0.065,0.11,0.075),skin)
	for x in [-0.055,0.0,0.055]:
		WorkshopScene.ball(root,Vector3(x,-0.475,0.25),Vector3(0.049,0.09,0.04),skin)

static func apron_wrap(root:Node3D,mat:Material):
	# Thick faceted panels follow the belly rather than a flat floating rectangle.
	for i in range(9):
		var angle=(i-4)*0.235
		var panel=clipped_box(root,Vector3(sin(angle)*0.40,0.83,cos(angle)*0.29),Vector3(0.103,0.62,0.028),mat)
		panel.rotation.y=angle

static func clipped_box(parent:Node3D,pos:Vector3,size:Vector3,mat:Material)->MeshInstance3D:
	# Eight-sided cross-section makes visible bevels with just 32 triangles.
	var h=size*0.5
	var b=minf(h.x,h.z)*0.22
	var outline=[Vector2(-h.x+b,-h.z),Vector2(h.x-b,-h.z),Vector2(h.x,-h.z+b),Vector2(h.x,h.z-b),Vector2(h.x-b,h.z),Vector2(-h.x+b,h.z),Vector2(-h.x,h.z-b),Vector2(-h.x,-h.z+b)]
	var mesh=SurfaceTool.new()
	mesh.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(8):
		var a=outline[i]
		var c=outline[(i+1)%8]
		var points=[Vector3(a.x,-h.y,a.y),Vector3(c.x,-h.y,c.y),Vector3(c.x,h.y,c.y),Vector3(a.x,h.y,a.y)]
		for j in [0,1,2,0,2,3]: mesh.add_vertex(points[j])
		for v in [Vector3(0,h.y,0),points[3],points[2],Vector3(0,-h.y,0),points[1],points[0]]: mesh.add_vertex(v)
	mesh.generate_normals()
	return WorkshopScene.piece(parent,mesh.commit(),pos,mat)

static func anvil(root:Node3D):
	var metal=ForgeMaterials.material("iron","b9c3c5")
	var rim=WorkshopScene.material("9ca7a6",0.8,0.28)
	clipped_box(root,Vector3(-0.35,1.223,-2.9),Vector3(0.85,0.025,0.45),rim)
	clipped_box(root,Vector3(-0.35,0.785,-2.9),Vector3(0.69,0.045,0.45),metal)
	for side in [-1,1]:
		var brace=clipped_box(root,Vector3(-0.35+side*0.22,0.94,-2.9),Vector3(0.14,0.28,0.29),metal)
		brace.rotation.z=side*-0.33
	# The existing stump becomes a coopered barrel without changing its collision envelope.
	for i in range(14):
		var angle=i*TAU/14
		var stave=WorkshopScene.box(root,Vector3(-0.35+cos(angle)*0.443,0.35,-2.9+sin(angle)*0.443),Vector3(0.035,0.63,0.185),ForgeMaterials.material("timber","9d7758" if i%2 else "ac8663"))
		stave.rotation.y=-angle
	for y in [0.10,0.57,0.65]: WorkshopScene.cylinder(root,Vector3(-0.35,y,-2.9),0.472,0.036,metal)
	for side in [-1,1]:
		WorkshopScene.ball(root,Vector3(-0.35+side*0.2,0.58,-2.473),Vector3.ONE*0.032,rim)
	for i in range(3):
		var mark=WorkshopScene.box(root,Vector3(-0.47+i*0.105,1.238,-2.87+i*0.06),Vector3(0.06,0.001,0.012),metal)
		mark.rotation.y=0.5+i*0.3

static func hammer(parent:Node3D,height=0.60):
	preload("res://apprentice_refined.gd").new().build(parent,height)

static func hammer_legacy(parent:Node3D,height=0.60):
	var wood=WorkshopScene.material("865331")
	var leather=WorkshopScene.material("3e3431")
	var copper=WorkshopScene.material("b9814d",0.65,0.38)
	var steel=WorkshopScene.material("71888e",0.8,0.32)
	WorkshopScene.cylinder(parent,Vector3(0,height*0.47,0),0.031,height*0.94,wood,0.038)
	for i in range(7):
		WorkshopScene.cylinder(parent,Vector3(0,0.045+i*0.03,0),0.039,0.023,leather)
	for y in [0.018,0.26,height-0.11]: WorkshopScene.cylinder(parent,Vector3(0,y,0),0.044,0.022,copper)
	clipped_box(parent,Vector3(0,height,0),Vector3(0.39,0.19,0.20),steel)
	for side in [-1,1]:
		clipped_box(parent,Vector3(side*0.197,height,0),Vector3(0.035,0.21,0.215),copper)
		clipped_box(parent,Vector3(side*0.22,height,0),Vector3(0.017,0.18,0.18),steel)
	WorkshopScene.box(parent,Vector3(0,height,0.106),Vector3(0.06,0.09,0.018),copper)
	WorkshopScene.ball(parent,Vector3(0,height,0.125),Vector3(0.029,0.044,0.019),WorkshopScene.material("83ccb0",0.3,0.4,0.2))

static func brann(root:Node3D):
	var thread=WorkshopScene.material("ba9671")
	var copper=WorkshopScene.material("b88349",0.5,0.5)
	for side in [-1,1]:
		for i in range(7): WorkshopScene.box(root,Vector3(side*0.25,0.59+i*0.058,0.305),Vector3(0.014,0.028,0.009),thread)
		WorkshopScene.ball(root,Vector3(side*0.195,1.08,0.329),Vector3.ONE*0.037,copper)
		WorkshopScene.ball(root,Vector3(side*0.308,1.56,0.059),Vector3(0.064,0.12,0.018),WorkshopScene.material("bd8769"))
		WorkshopScene.ball(root,Vector3(side*0.17,1.50,0.251),Vector3(0.065,0.035,0.015),WorkshopScene.material("c18d70"))
	WorkshopScene.box(root,Vector3(0,0.76,0.334),Vector3(0.23,0.016,0.015),thread)
	WorkshopScene.box(root,Vector3(0,1.785,0.295),Vector3(0.09,0.048,0.018),copper)
