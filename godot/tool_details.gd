extends RefCounted
## Small authored assemblies: bevels, joints, wraps, functional parts and restraint.
static func build(node:Node3D,id:String):
	if id=="quarry_pick" and ResourceLoader.exists("res://weapons/stonewhisper.glb"):
		var scene=load("res://weapons/stonewhisper.glb") as PackedScene
		if scene!=null:
			var authored=scene.instantiate() as Node3D
			if authored!=null:
				node.add_child(authored)
				node.set_meta("stonewhisper_authored",true)
				var crystal=authored.find_child("ResonanceCrystal",true,false) as MeshInstance3D
				if crystal!=null:
					var finish=crystal.get_active_material(0)
					if finish is StandardMaterial3D:
						var unique_finish=finish.duplicate() as StandardMaterial3D
						crystal.material_override=unique_finish
						node.set_meta("stonewhisper_crystal_material",unique_finish)
						node.set_meta("stonewhisper_crystal_rest",unique_finish.emission_energy_multiplier)
				return
	var wood=WorkshopScene.material("795334")
	var brass=WorkshopScene.material("bc955b",0.65,0.4)
	var steel=WorkshopScene.material("728b94",0.75,0.35)
	var leather=WorkshopScene.material("394449")
	WorkshopScene.cylinder(node,Vector3(0,0.27,0),0.035,0.56,wood,0.043)
	for i in range(7): WorkshopScene.cylinder(node,Vector3(0,0.04+i*0.028,0),0.043,0.019,leather)
	for y in [0.02,0.25,0.46]: WorkshopScene.cylinder(node,Vector3(0,y,0),0.049,0.028,brass)
	match id:
		"grappling_hook":
			var spool=Node3D.new(); node.add_child(spool); spool.position=Vector3(0,0.36,0)
			node.set_meta("spool",spool)
			for x in [-0.09,0.09]:
				WorkshopScene.cylinder(spool,Vector3(x,0,0),0.12,0.02,steel).rotation.z=PI/2
				for i in range(8):
					var a=i*TAU/8
					WorkshopScene.ball(spool,Vector3(x*1.15,cos(a)*0.08,sin(a)*0.08),Vector3.ONE*0.018,brass)
			for x in range(9): WorkshopScene.cylinder(spool,Vector3(-0.07+x*0.017,0,0),0.092,0.014,WorkshopScene.material("c4b394")).rotation.z=PI/2
			for i in range(3):
				var claw=Node3D.new(); node.add_child(claw); claw.rotation.y=i*TAU/3
				var arm=preload("res://workshop_details.gd").clipped_box(claw,Vector3(0.10,0.56,0),Vector3(0.055,0.28,0.055),steel); arm.rotation.z=-0.65
				var tip=WorkshopScene.cylinder(claw,Vector3(0.18,0.70,0),0.035,0.14,steel,0.0); tip.rotation.z=0.9
			WorkshopScene.ball(node,Vector3(0,0.52,0),Vector3.ONE*0.10,brass)
		"quarry_pick":
			preload("res://workshop_details.gd").clipped_box(node,Vector3(0,0.61,0),Vector3(0.24,0.13,0.12),steel)
			for side in [-1,1]:
				var point=WorkshopScene.cylinder(node,Vector3(side*0.22,0.59,0),0.07,0.36,steel,0.0)
				# CylinderMesh tapers toward local +Y. Mirror that tip outwards,
				# away from the eye, on both sides of the pick head.
				point.rotation.z=-side*1.9
			WorkshopScene.ball(node,Vector3(0,0.61,0.08),Vector3(0.07,0.095,0.04),WorkshopScene.material("80c4eb",0.1,0.3,0.5))
		"spore_lantern":
			for y in [0.39,0.75]:
				WorkshopScene.cylinder(node,Vector3(0,y,0),0.17,0.05,brass,0.13)
			for i in range(6):
				var a=i*TAU/6
				WorkshopScene.cylinder(node,Vector3(cos(a)*0.14,0.57,sin(a)*0.14),0.012,0.35,steel)
			WorkshopScene.cylinder(node,Vector3(0,0.52,0),0.026,0.20,WorkshopScene.material("e2cfa5"))
			WorkshopScene.ball(node,Vector3(0,0.63,0),Vector3(0.24,0.12,0.24),WorkshopScene.material("b387dd",0.1,0.4,1.1))
			WorkshopScene.light(node,Vector3(0,0.6,0),Color("c39bdf"),0.55,4)
		"ember_gauntlet":
			for side in [-1,1]:
				var shell=preload("res://workshop_details.gd").clipped_box(node,Vector3(side*0.08,0.51,0),Vector3(0.13,0.28,0.22),steel); shell.rotation.z=side*-0.16
			for i in range(3): WorkshopScene.box(node,Vector3(0,0.47+i*0.06,0.125),Vector3(0.13,0.012,0.013),WorkshopScene.material("ffad61",0,0.7,1.3))
			WorkshopScene.cylinder(node,Vector3(0,0.69,0),0.085,0.14,brass,0.12)
			WorkshopScene.ball(node,Vector3(0,0.73,0),Vector3.ONE*0.12,WorkshopScene.material("ff8553",0,0.5,0.8))
