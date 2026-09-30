extends RefCounted
const TITLES=["Basic Tools","Stocked Workshop","Enchanted Anvil","Everburning Forge"]
const MATERIALS=["rat_tail","lumber","stone","iron","apple","spore","crystal","haunted_bone","sky_bloom","ember_core"]
const COLORS={"quickwind":"dcb76b","truesight":"ffaf5c","verdant":"95d3a0","hearth":"ff9153"}

static func text(p,value,pos,size=18):
	var label=WorkshopScene.label(p,value,pos,size)
	label.pixel_size=0.003; label.width=650; label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	return label

static func material_piece(id:String)->Node3D:
	var n=Node3D.new(); n.set_meta("kind","workshop_material"); n.set_meta("resource",id)
	var gold=WorkshopScene.material("c9a168",0.5)
	match id:
		"iron":
			preload("res://workshop_details.gd").clipped_box(n,Vector3(0,0.05,0),Vector3(0.23,0.10,0.13),WorkshopScene.material("95a3aa",0.75))
			WorkshopScene.box(n,Vector3(0,0.103,0),Vector3(0.055,0.006,0.045),gold)
		"lumber":
			for i in range(3): WorkshopScene.box(n,Vector3((i-1)*0.055,0.04,0),Vector3(0.05,0.07,0.25),WorkshopScene.material("b28856"))
			for z in [-0.07,0.07]: WorkshopScene.box(n,Vector3(0,0.04,z),Vector3(0.18,0.08,0.012),WorkshopScene.material("6d5e45"))
		"haunted_bone":
			WorldZones.bone(n,Vector3(-0.10,0.04,0),Vector3(0.10,0.04,0),0.06,"dfd1ad")
			WorkshopScene.ball(n,Vector3(0,0.06,0),Vector3.ONE*0.035,WorkshopScene.material("9bcac7",0,0.5,0.5))
		"rat_tail":
			for i in range(8):
				var a=i*0.7; WorldZones.line(n,Vector3(cos(a)*0.08,0.04,sin(a)*0.08),Vector3(cos(a+0.7)*0.08,0.04,sin(a+0.7)*0.08),0.016,"af7d6d")
			WorkshopScene.box(n,Vector3(0,0.05,0),Vector3(0.035,0.055,0.05),gold)
		"crystal","ember_core":
			preload("res://crystal_art.gd").shard(n,Vector3(0,0.11,0),Vector3(0.10,0.23,0.10),Color("ad96e9" if id=="crystal" else "ffa35e"))
			WorkshopScene.cylinder(n,Vector3(0,0.03,0),0.07,0.035,gold)
		"apple":
			WorldZones.rock(n,Vector3(0,0.08,0),Vector3(0.15,0.15,0.15),"cd6048")
			WorkshopScene.cylinder(n,Vector3(0,0.17,0),0.009,0.06,WorkshopScene.material("795740"))
		"spore":
			WorkshopScene.cylinder(n,Vector3(0,0.055,0),0.05,0.10,WorkshopScene.material("6d8c77"))
			WorkshopScene.cylinder(n,Vector3(0,0.115,0),0.057,0.025,gold)
			for i in range(4): WorkshopScene.ball(n,Vector3(cos(i*2.4)*0.035,0.15,sin(i*2.4)*0.035),Vector3.ONE*0.04,WorkshopScene.material("cba5e0",0,0.5,0.5))
		"sky_bloom":
			for i in range(5): WorldZones.rock(n,Vector3(cos(i*TAU/5)*0.07,0.07,sin(i*TAU/5)*0.07),Vector3(0.10,0.04,0.075),"d7e8c6")
			WorkshopScene.ball(n,Vector3(0,0.08,0),Vector3.ONE*0.06,gold)
		_:
			WorldZones.rock(n,Vector3(0,0.06,0),Vector3(0.20,0.12,0.15),"8c9c9f")
	bake(n)
	return n

static func module_piece(kind:String)->Node3D:
	var n=Node3D.new()
	var color=Color(COLORS.get(kind,"a8c9d5"))
	WorkshopScene.cylinder(n,Vector3(0,0.025,0),0.085,0.05,WorkshopScene.material("bd9860",0.6))
	if kind=="quickwind":
		for i in range(10):
			var a=i*TAU/10
			var tooth=WorkshopScene.box(n,Vector3(cos(a)*0.075,0.06,sin(a)*0.075),Vector3(0.023,0.02,0.035),WorkshopScene.material("caae76",0.7)); tooth.rotation.y=-a
		WorkshopScene.cylinder(n,Vector3(0,0.05,0),0.06,0.04,WorkshopScene.material("798b90",0.7))
	else: preload("res://crystal_art.gd").shard(n,Vector3(0,0.105,0),Vector3(0.10,0.15,0.10),color)
	bake(n)
	return n

static func mini(tier:int)->Node3D:
	var n=Node3D.new()
	var stone=WorkshopScene.material("9aa49c"); var wood=WorkshopScene.material("937048"); var brass=WorkshopScene.material("c5a569",0.5)
	WorkshopScene.cylinder(n,Vector3.ZERO,0.43,0.06,brass)
	match tier:
		1:
			for x in [-0.25,0.25]: WorkshopScene.box(n,Vector3(x,0.18,0),Vector3(0.05,0.35,0.05),wood)
			WorkshopScene.box(n,Vector3(0,0.28,0),Vector3(0.55,0.05,0.05),wood)
			for x in [-0.18,0,0.18]:
				WorkshopScene.cylinder(n,Vector3(x,0.18,0.065),0.012,0.28,wood)
				WorkshopScene.box(n,Vector3(x,0.32,0.065),Vector3(0.10,0.05,0.04),stone)
		2:
			WorkshopScene.box(n,Vector3(0,0.19,0),Vector3(0.46,0.38,0.35),stone)
			WorkshopScene.box(n,Vector3(0,0.15,0.19),Vector3(0.18,0.20,0.035),WorkshopScene.material("f3bd73",0,0.5,0.6))
			WorkshopScene.box(n,Vector3(-0.12,0.52,-0.1),Vector3(0.11,0.28,0.10),stone)
			for x in [-0.35,0.35]: WorkshopScene.box(n,Vector3(x,0.24,0),Vector3(0.045,0.48,0.045),wood)
			WorkshopScene.box(n,Vector3(0,0.47,0),Vector3(0.8,0.05,0.45),WorkshopScene.material("47776d"))
		3:
			WorkshopScene.box(n,Vector3(0,0.12,0),Vector3(0.38,0.20,0.32),stone)
			preload("res://workshop_details.gd").clipped_box(n,Vector3(0,0.29,0),Vector3(0.48,0.11,0.25),WorkshopScene.material("6b8293",0.7))
			for x in [-0.28,0.28]: preload("res://crystal_art.gd").shard(n,Vector3(x,0.26,0),Vector3(0.12,0.4,0.13),Color("b39cde"))
		4:
			for x in [-0.22,0.22]: WorkshopScene.box(n,Vector3(x,0.34,0),Vector3(0.15,0.65,0.22),stone)
			WorkshopScene.box(n,Vector3(0,0.58,0),Vector3(0.56,0.12,0.25),stone)
			WorkshopScene.cylinder(n,Vector3(0,0.26,0),0.10,0.42,WorkshopScene.material("ffb55e",0,0.4,1.2))
	bake(n)
	return n

static func bucket(parent,pos)->Node3D:
	var n=Node3D.new(); parent.add_child(n); n.position=pos
	var shell=CylinderMesh.new(); shell.top_radius=0.29; shell.bottom_radius=0.23; shell.height=0.30; shell.cap_top=false; shell.cap_bottom=false; shell.radial_segments=12
	var wall=MeshInstance3D.new(); n.add_child(wall); wall.mesh=shell; wall.position.y=0.15
	wall.material_override=WorkshopScene.material("987449"); wall.material_override.cull_mode=BaseMaterial3D.CULL_DISABLED
	WorkshopScene.cylinder(n,Vector3(0,0.02,0),0.23,0.035,WorkshopScene.material("886239"))
	# An open collision shell, not a solid box across the mouth.
	var solid=StaticBody3D.new(); n.add_child(solid); solid.set_meta("surface_material","wood")
	for i in range(12):
		var angle=i*TAU/12; var wall_shape=CollisionShape3D.new(); wall_shape.shape=BoxShape3D.new(); wall_shape.shape.size=Vector3(0.035,0.30,0.14)
		wall_shape.position=Vector3(cos(angle)*0.27,0.15,sin(angle)*0.27); wall_shape.rotation.y=-angle; solid.add_child(wall_shape)
	var bottom=CollisionShape3D.new(); bottom.shape=CylinderShape3D.new(); bottom.shape.radius=0.23; bottom.shape.height=0.035; bottom.position.y=0.02; solid.add_child(bottom)
	for y in [0.07,0.25]:
		var ring=TorusMesh.new(); ring.inner_radius=0.255 if y==0.07 else 0.277; ring.outer_radius=ring.inner_radius+0.016; ring.rings=12; ring.ring_segments=4
		var m=MeshInstance3D.new(); m.mesh=ring; m.material_override=WorkshopScene.material("c3a363",0.5); n.add_child(m); m.position.y=y
	bake(n)
	return n

static func stages(game)->Array:
	var groups=[]
	for tier in range(2,5):
		var p=Node3D.new(); p.name="WorkshopStage"+str(tier); game.adventure.zone_groups.forge_yard.add_child(p)
		var v=Vector3(11,0,-4) if tier==2 else (Vector3(-11,0,-4) if tier==3 else Vector3(0,0,-11))
		var width=7.0 if tier<4 else 14.0
		WorldZones.floor_patch(p,v,Vector2(width,7),"ad9575" if tier==2 else "89908b")
		for side in [-1,1]:
			WorldZones.box(p,v+Vector3(side*(width/2-0.2),2.25,-3.2),Vector3(0.35,4.5,0.35),"917455" if tier==2 else "8a9290")
			WorldZones.box(p,v+Vector3(side*(width/2-0.2),2.25,3.2),Vector3(0.35,4.5,0.35),"917455" if tier==2 else "8a9290")
		var roof=WorldZones.box(p,v+Vector3(0,4.5,0),Vector3(width+0.4,0.20,7.4),"a6784c" if tier==2 else "64767c")
		roof.rotation.z=-0.09 if tier==2 else (0.09 if tier==3 else 0.0)
		for x in range(-3,4): WorldZones.line(p,v+Vector3(x,4.30,-3.3),v+Vector3(x,4.30,3.3),0.13,"775c42" if tier==2 else "5b7176")
		for side in [-1,1]: WorldZones.line(p,v+Vector3(side*(width/2-0.2),3.6,3.2),v+Vector3(side*(width/2-1.0),4.3,3.2),0.17,"8a704e")
		WorldZones.box(p,v+Vector3(0,2,-3.35),Vector3(width,4,0.22),"b5a180" if tier==2 else "8c9998")
		text(p,["","","THE TINKER'S WING","THE ENCHANTING ALCOVE","THE EVERBURNING FOUNDRY"][tier],v+Vector3(0,3.9,3.35),26)
		if tier==2:
			for x in [-2,0,2]:
				WorldZones.crate(p,v+Vector3(x,0,-2.4),0.8)
				for y in [1.4,2.4]:
					WorldZones.box(p,v+Vector3(x,y,-2.9),Vector3(1.7,0.08,0.55),"785b40")
					for j in range(3): WorldZones.cyl(p,v+Vector3(x+(j-1)*0.4,y+0.20,-2.9),0.13,0.3,"bca479")
		elif tier==3:
			for x in [-2.2,2.2]:
				WorldZones.crystal_cluster(p,v+Vector3(x,0,-2),1.0,"9d9bea")
				WorldZones.glow_light(p,v+Vector3(x,1.8,-2),"a6bded",0.45,5)
			WorldZones.cyl(p,v+Vector3(0,0.55,-1),0.55,1.1,"657a7e")
			WorldZones.box(p,v+Vector3(0,1.16,-1),Vector3(1.5,0.18,0.8),"a6bec9",0.15)
		else:
			WorldZones.arch(p,v+Vector3(0,0,-1.8),1.4,"737982")
			for i in range(5): WorldZones.cyl(p,v+Vector3((i-2)*0.22,0.8,-1.7),0.18,1.4-(i%2)*0.3,"ffbd66","cone",1.0)
			for x in [-4,4]: WorldZones.box(p,v+Vector3(x,0.13,0),Vector3(0.12,0.05,5.5),"ffbc77",0.8)
			WorldZones.glow_light(p,v+Vector3(0,2,-0.8),"ffd193",0.8,9)
		if tier==2:
			WorldZones.lantern(p,v+Vector3(2.6,3.1,2.8))
		elif tier==3:
			for side in [-1,1]:
				var flag=WorldZones.box(p,v+Vector3(side*2.2,2.6,-3.17),Vector3(0.7,1.4,0.025),"586a8b")
				text(p,"◇",flag.position+Vector3(0,0,0.03),65)
		else:
			for side in [-1,1]:
				WorldZones.cyl(p,v+Vector3(side*2,0.8,-2),0.35,1.6,"657377")
				WorldZones.cyl(p,v+Vector3(side*2,1.7,-2),0.40,0.18,"b7a276")
				WorldZones.cyl(p,v+Vector3(side*2,1.96,-2),0.18,0.43,"ffb961","cone",0.8)
		WorldZones.batch_decorations(p)
		groups.append(p)
	return groups

static func apply_gates(game,tier:int):
	for gate in game.get_tree().get_nodes_in_group("foundry_gate"):
		gate.visible=tier<4
		game._set_collisions(gate,tier<4)

# Consolidate static opaque parts while preserving the independently movable root.
# This matters for handfuls of ingredients and modules, not only scenery.
static func bake(root:Node3D):
	var groups={}
	_collect_meshes(root,Transform3D.IDENTITY,groups)
	for group in groups.values():
		if group.size()<2: continue
		var surface=SurfaceTool.new(); surface.begin(Mesh.PRIMITIVE_TRIANGLES)
		for entry in group: surface.append_from(entry.node.mesh,0,entry.transform)
		var combined=MeshInstance3D.new(); root.add_child(combined); combined.mesh=surface.commit(); combined.material_override=group[0].node.material_override
		for entry in group: entry.node.free()

static func _collect_meshes(node:Node3D,transform:Transform3D,groups:Dictionary):
	for child in node.get_children():
		if not child is Node3D: continue
		var local=transform*child.transform
		if child is MeshInstance3D and child.mesh.get_surface_count()==1 and child.material_override is StandardMaterial3D:
			var mat=child.material_override
			if mat.transparency==BaseMaterial3D.TRANSPARENCY_DISABLED:
				var key=str([mat.albedo_color,mat.metallic,mat.roughness,mat.emission_enabled,mat.emission,mat.emission_energy_multiplier,mat.cull_mode,mat.shading_mode])
				if not groups.has(key): groups[key]=[]
				groups[key].append({"node":child,"transform":local})
		_collect_meshes(child,local,groups)
