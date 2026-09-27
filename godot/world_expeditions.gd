extends RefCounted
const TreeAdapter = preload("res://tree_adapter.gd")
const OrchardArt = preload("res://orchard_art.gd")
## The outer ring is kept separate from the original eight authored zones.
## Every reward uses the existing harvesting/loot contract, and each return
## portal points to its parent region. Geometry is batched by WorldZones.

static func populate(root:Node3D,data:Dictionary)->void:
	var w=load("res://world_zones.gd")
	orchard(root,data,w)
	fen(root,data,w)
	ridge(root,data,w)
	keep(root,data,w)

static func orchard(root:Node3D,data:Dictionary,w:Script)->void:
	var id="orchard_highlands"
	var p:Node3D=data.zones[id].root
	var c:Vector3=data.zones[id].center
	# A long, quiet apple walk gives way to a timber line and guarded ruin.
	for i in range(26):
		var side=-1 if i%2==0 else 1
		var row=floori(float(i)/2.0)
		var v=Vector3(side*(6.0+float(row%3)*2.5),0,17.0-float(row)*2.8)
		var orchard_tree: Node3D = w.tree(p,v,4.6+float(i%4)*0.4,false,true,1 if i<5 else 0)
		OrchardArt.upgrade_tree_visual(orchard_tree)
		if i<5: TreeAdapter.hanging_apple(w,root,data,id,orchard_tree)
	for i in range(10):
		var a=TAU*float(i)/10.0
		w.tree(p,Vector3(cos(a)*22,0,sin(a)*21),6.0+float(i%3)*0.8,true)
	for i in range(7): w.flowers(p,Vector3(-15+i*5,0,8-i%3*5),22,2.0,"fff0cf")
	OrchardArt.trail(p,[Vector3(0,0,21),Vector3(0,0,-20)],w)
	for i in range(5):
		# Keep the path clear until the actual fallen-gate chopping challenge.
		var v=Vector3(-18+i*9+(4 if i==2 else 0),0,-4.5-(i%2)*9)
		var timber=w.resource(root,data,id,c+v,"lumber","axe",3)
		# These lumber trees have no apple harvest interaction; reserve visible
		# fruit for the reachable orchard-tree pickups above.
		w.tree(timber,Vector3.ZERO,5.4,false,false)
	w.arch(p,Vector3(0,0,-18),2.4,"aab29c",true)
	for side in [-1,1]:
		w.box(p,Vector3(side*5,0.8,-17),Vector3(8,1.6,1.1),"a1a892")
		w.rock(p,Vector3(side*15,1.2,-20),Vector3(6,2.4,5),"b8b2a0")
	w.barrier(root,data,id,c+Vector3(0,0,-19),"chop")
	for v in [Vector3(-6,0,-13),Vector3(8,0,-16),Vector3(0,0,-23)]: w.enemy(root,data,id,c+v,"skeleton","mossward")
	w.label(p,"THE LONG ORCHARD  ·  TIMBER BEYOND THE FALLEN GATE",Vector3(0,3.3,-15),23,"fff1d5")
	w.lantern(p,Vector3(0,1.4,13))
	_windfall_meadow(root,data,w,p,c)
	load("res://orchard_expansion.gd").populate(root,data,w)

static func _windfall_meadow(root:Node3D,data:Dictionary,w:Script,p:Node3D,c:Vector3)->void:
	# A deliberately open, much larger combat/throwing loop beyond the original
	# orchard. Repeated assets are batched by WorldZones at the end of build.
	OrchardArt.trail(p,[Vector3(0,0,-20),Vector3(0,0,-38),Vector3(32,0,-31),Vector3(33,0,14),Vector3(15,0,22)],w)
	for i in range(38):
		var angle=float(i)*2.399963
		var radial=29.0+float(i%6)*2.4
		var v=Vector3(cos(angle)*radial,0,sin(angle)*radial)
		if absf(v.x)<5.0 and v.z < -16.0: continue
		if absf(v.x-33.0)<4.0 and v.z>-35.0 and v.z<16.0: continue
		w.tree(p,v,4.0+float(i%5)*0.48,i%4==0,i%8==0)
	for i in range(18):
		var a=float(i)*2.399963
		var v=Vector3(cos(a)*(19.0+float(i%4)*4.0),0,sin(a)*(22.0+float(i%3)*5.0))
		if absf(v.x)<4.0 and v.z<0.0: continue
		w.rock(p,v+Vector3.UP*0.28,Vector3(1.3+float(i%3)*0.5,0.65,1.0+float(i%4)*0.25),"aaa999" if i%2 else "8b988b")
	for i in range(16):
		var v=Vector3(-30.0+float(i%8)*8.0,0,-33.0+float(floori(float(i)/8.0))*18.0)
		if absf(v.x)<5.0: continue
		w.flowers(p,v,12,1.7,"fff0cd" if i%2 else "e9d7a8")
	# Scattered structural props and resources create reasons to try a long
	# throw, approach from another direction, or use the axe and grapple.
	for i in range(3):
		var v=Vector3(-28.0+float(i)*25.0,0,-34.0+float(i%2)*7.0)
		var timber=w.resource(root,data,"orchard_highlands",c+v,"lumber","axe",2)
		w.tree(timber,Vector3.ZERO,4.8+float(i)*0.3,false,false)
	for i in range(4):
		var v=Vector3(-21.0+float(i)*13.0,0,-31.0+float(i%2)*8.0)
		w.enemy(root,data,"orchard_highlands",c+v,"skeleton","mossward")
	w.box(p,Vector3(27,1.0,-30),Vector3(4.0,2.0,4.0),"9f9c89")
	w.box(p,Vector3(27,2.15,-30),Vector3(5.0,0.3,5.0),"bbb49a")
	w.anchor(root,data,"orchard_highlands",c+Vector3(27,3.4,-30),c+Vector3(27,0,-26))
	w.label(p,"WINDFALL MEADOW",Vector3(0,2.3,-33.5),25,"f7e8bd")

static func fen(root:Node3D,data:Dictionary,w:Script)->void:
	var id="gloamfen"
	var p:Node3D=data.zones[id].root
	var c:Vector3=data.zones[id].center
	# Pale stepping stones and cap light make the fairy useful in the dim bog.
	for i in range(3): w.cyl(p,Vector3(-12+i*12,0.035,-8+i%2*10),4.5+i,0.04,"587f7b","disc",0.12)
	for i in range(32):
		var a=float(i)*2.39996
		var r=sqrt(float(i)/32.0)*24.0
		var v=Vector3(cos(a)*r,0,sin(a)*r)
		# Stems have collision, so leave the entire boardwalk route clear.
		if absf(v.x)<3.5 and v.z>-17: continue
		var h=1.3+float(i%4)*0.48
		w.cyl(p,v+Vector3(0,h*0.5,0),0.16,h,"b4bba6","taper")
		var cap=w.rock(p,v+Vector3(0,h,0),Vector3(0.9+float(i%3)*0.25,0.28,0.9+float(i%3)*0.25),"88aaa1")
		cap.material_override=w.mat("9cd2c4" if i%3 else "b3d1ed",0.3)
		var tree_pos=v+Vector3(1.0,0,-1.0)
		if i%4==0 and not (absf(tree_pos.x)<3.5 and tree_pos.z>-17):
			TreeAdapter.fen_tree(p,tree_pos,3.5+float(i%3),i%8==0)
	for i in range(18):
		var v=Vector3(-5+float(i%3)*4,0.08,18-float(floori(float(i)/3.0))*6)
		w.rock(p,v,Vector3(1.3,0.17,1.05),"a6b9aa")
	# The weathered boardwalk is a readable route even when the bog is dark.
	for i in range(9):
		var z=19.0-float(i)*4.3
		w.box(p,Vector3(0,0.25,z),Vector3(4.3,0.16,2.8),"6a5148")
		for side in [-1,1]:
			w.box(p,Vector3(side*2.05,0.54,z),Vector3(0.16,0.6,0.17),"927764")
			if i%3==0: w.rock(p,Vector3(side*2.65,0.22,z),Vector3(1.6,0.35,1.25),"536966")
	for i in range(7):
		var v=Vector3((-1 if i%2==0 else 1)*(6.0+float(i%3)*2.2),0,14.0-float(i)*5.1)
		w.cyl(p,v+Vector3(0,1.1,0),0.14,2.2,"536653","taper")
		w.rock(p,v+Vector3(0,2.25,0),Vector3(1.55,0.36,1.35),"a797c7")
		w.glow_light(p,v+Vector3(0,2.18,0),"83d9c8",0.35,3.8)
	for i in range(5):
		var v=Vector3(-16+i*8,0,-11+(i%2)*7)
		var patch=w.resource(root,data,id,c+v,"spore","",3)
		for j in range(4):
			w.cyl(patch,Vector3((j-1.5)*0.27,0.23,0),0.045,0.46,"bad2b8")
			w.rock(patch,Vector3((j-1.5)*0.27,0.52,0),Vector3(0.38,0.18,0.38),"a78fc4")
		w.body(patch,Vector3(0,0.36,0),Vector3(1.2,0.75,0.8))
	for i in range(3): w.enemy(root,data,id,c+Vector3(-10+i*10,0,-8-i%2*7),"wisp")
	w.arch(p,Vector3(0,0,-20),2.3,"647c80",true)
	for side in [-1,1]:
		w.box(p,Vector3(side*3.3,0.8,-18.7),Vector3(0.85,1.6,0.85),"829999")
		w.rock(p,Vector3(side*3.3,1.85,-18.7),Vector3(1.25,0.55,1.25),"a1c8ae")
	for side in [-1,1]:
		w.rock(p,Vector3(side*7,1.5,-19),Vector3(5,3,3),"52696e")
		w.glow_light(p,Vector3(side*8,2,-12),"76c5bc",0.5,5)
	w.label(p,"GLOAMFEN  ·  FOLLOW THE PALE STONES",Vector3(0,3.1,2),24,"d9f3d7")

static func ridge(root:Node3D,data:Dictionary,w:Script)->void:
	var id="starfall_ridge"
	var p:Node3D=data.zones[id].root
	var c:Vector3=data.zones[id].center
	for i in range(18):
		var a=TAU*float(i)/18.0
		var v=Vector3(cos(a)*23,2.5+float(i%4),sin(a)*23)
		w.rock(p,v,Vector3(3.8,6+float(i%4)*2.0,4),"69718c")
		if i%3==0: w.crystal_cluster(p,v+Vector3(0,3.0,0),1.2,"85d7ef")
	for i in range(13):
		var v=Vector3(-16+float(i%4)*8,0,-16+float(floori(float(i)/4.0))*8)
		w.crystal_cluster(p,v,0.9+float(i%3)*0.35,"96d9ef" if i%2 else "c491dd")
	for i in range(4): w.ore(root,data,id,c+Vector3(-12+i*8,0,3-i%2*9),"crystal","9ec5e9")
	for i in range(3): w.ore(root,data,id,c+Vector3(-10+i*10,0,-17),"iron","e6c57d")
	w.path(p,Vector3(0,0,21),Vector3(0,0,-16),"a5b2c4")
	w.arch(p,Vector3(0,0,-18),2.4,"8290a7",true)
	w.barrier(root,data,id,c+Vector3(0,0,-19),"bomb")
	for i in range(3):
		var v=Vector3(-13+i*13,0,-8)
		w.box(p,v+Vector3(0,2.5,0),Vector3(0.5,5,0.5),"8d9bb0")
		w.anchor(root,data,id,c+v+Vector3(0,4.5,0),c+v+Vector3(0,0,1.5))
	w.enemy(root,data,id,c+Vector3(6,0,-12),"golem")
	w.enemy(root,data,id,c+Vector3(-7,0,-21),"skeleton","prismwatch")
	w.label(p,"STARFALL RIDGE  ·  ORE BEHIND THE BREACH",Vector3(0,3.3,-13),24,"e5efff")
	w.glow_light(p,Vector3(0,2,-13),"8bbce8",0.75,9)

static func keep(root:Node3D,data:Dictionary,w:Script)->void:
	var id="cloudbreak_keep"
	var p:Node3D=data.zones[id].root
	var c:Vector3=data.zones[id].center
	# Open-air traversal and several safe landing islands give Swallow Line room.
	w.island(p,Vector3(0,0,10),Vector2(28,24))
	w.island(p,Vector3(-16,2.2,-8),Vector2(13,12))
	w.island(p,Vector3(15,4.2,-15),Vector2(12,12))
	w.island(p,Vector3(-3,6.0,-25),Vector2(14,12))
	# Teal-roofed watch posts and gold-edged railings add scale cues to the
	# grapple course without filling the airspace used by the player's line.
	for spec in [[Vector3(-16,2.2,-8),6.0],[Vector3(15,4.2,-15),5.5],[Vector3(-3,6.0,-25),5.8]]:
		var center:Vector3=spec[0]
		var size:float=spec[1]
		for side in [-1,1]:
			w.box(p,center+Vector3(side*size*0.35,1.7,-size*0.25),Vector3(0.32,3.4,0.32),"87745f")
			w.box(p,center+Vector3(side*size*0.35,1.7,size*0.25),Vector3(0.32,3.4,0.32),"87745f")
		w.box(p,center+Vector3(0,3.45,0),Vector3(size*0.9,0.23,size*0.7),"407e87")
		w.box(p,center+Vector3(0,3.66,0),Vector3(size*0.94,0.08,size*0.74),"d9b675")
		for side in [-1,1]:
			w.box(p,center+Vector3(side*size*0.22,2.45,size*0.26),Vector3(0.7,1.25,0.08),"438e9d")
			w.box(p,center+Vector3(side*size*0.22,1.82,size*0.26),Vector3(0.76,0.08,0.1),"e4bd72")
		w.box(p,center+Vector3(0,0.48,0),Vector3(size*0.8,0.18,size*0.65),"d5d7bc")
		for side in [-1,1]:
			w.box(p,center+Vector3(side*size*0.39,0.78,0),Vector3(0.13,0.52,size*0.75),"a09271")
		w.lantern(p,center+Vector3(0,3.0,0))
	for side in [-1,1]:
		w.box(p,Vector3(side*9.2,0.65,9.0),Vector3(0.55,1.3,1.0),"9b9c87")
		w.box(p,Vector3(side*9.2,1.45,9.0),Vector3(1.3,0.18,1.6),"d3bb83")
		w.cyl(p,Vector3(side*9.2,1.95,9.0),0.34,0.9,"799f9e","taper")
		w.glow_light(p,Vector3(side*9.2,2.5,9.0),"a4e5ea",0.4,4.0)
	var landings=[Vector3(-13,2.2,-7),Vector3(13,4.2,-13),Vector3(-2,6,-24),Vector3(0,0,4)]
	for v in landings:
		w.box(p,v+Vector3(0,2.6,0),Vector3(0.35,5.2,0.35),"b3c4bc")
		w.box(p,v+Vector3(0.8,5,0),Vector3(1.9,0.20,0.24),"a8bab7")
		w.anchor(root,data,id,c+v+Vector3(1.55,4.5,0),c+v+Vector3(0,0,0))
	for i in range(3):
		var v=Vector3(-5+float(i)*2.5,6,-25)
		var flower=w.resource(root,data,id,c+v,"sky_bloom","",3)
		w.cyl(flower,Vector3(0,0.45,0),0.045,0.9,"8cbfa0")
		for j in range(6): w.rock(flower,Vector3(cos(j*TAU/6)*0.22,0.95,sin(j*TAU/6)*0.22),Vector3(0.34,0.14,0.25),"eaf7e3")
		w.body(flower,Vector3(0,0.5,0),Vector3(0.8,1.1,0.8))
	for v in [Vector3(-16,2.2,-8),Vector3(15,4.2,-15),Vector3(-3,6,-25)]: w.arch(p,v,1.2,"b7c7be",true)
	for i in range(2): w.enemy(root,data,id,c+Vector3(-15+i*13,2.2+i*3.8,-9-i*16),"skeleton","prismwatch")
	for i in range(9):
		var v=Vector3(-38+float(i)*9,-4+float(i%3)*2.0,-39-float(i%2)*7)
		w.rock(p,v,Vector3(7,2.2,4),"dae6e5")
	# Put the guidance in front of the first grapple pole, with enough contrast
	# against the bright sky to read it from the arrival island.
	w.label(p,"CLOUDBREAK KEEP  ·  THE LINE IS YOUR BRIDGE",Vector3(0,3.5,6.5),24,"386b76")
