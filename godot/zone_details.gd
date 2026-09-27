extends Node
## Local scene life: bounded animations, physical props and touchable discoveries.
var game
var moving=[]
var touchables=[]
var cups=[]
var clock=0.0
var audio=[]
var sound_index=0
var notes={}
var touching={}

func setup(owner_game):
	game=owner_game
	for id in game.adventure.ZONES:
		var p=Node3D.new(); p.name="ArtDirectionDetails"; game.scene.zones[id].root.add_child(p)
		match id:
			"forge_yard":
				banner(p,Vector3(-6,3,-0.1),"344d5d","⚒")
				WorldZones.line(p,Vector3(-7.7,3.6,0),Vector3(-6.4,3.6,0),0.12,"785233")
				WorldZones.box(p,Vector3(-7,3.05,0),Vector3(1.15,0.65,0.12),"b99161")
				WorldZones.label(p,"⚒",Vector3(-7,3.08,0.075),50,"343e41")
			"sandstone_quarry": cart(p,Vector3(-5,0,6),"e6bc58")
			"enchanted_kitchen":
				for i in range(6):
					var v=Vector3(-5+i*0.34,3.5,-11.65)
					WorldZones.line(p,v,v-Vector3.UP*0.7,0.025,"856846")
					for j in range(4): WorldZones.rock(p,v+Vector3(sin(j*2.4)*0.12,-0.35-j*0.10,0.06),Vector3(0.20,0.27,0.10),"6e8f55")
				for i in range(3): cup(p,Vector3(-3+i*1.0,1.7,4),i)
			"pinewood_ruins":
				for i in range(5):
					var x=-10+i*1.3
					WorldZones.box(p,Vector3(x,0.55,7),Vector3(0.12,1.1,0.12),"87613d")
					if i<4:
						for y in [0.4,0.85]: WorldZones.line(p,Vector3(x,y,7),Vector3(x+1.3,y,7),0.08,"9c764c")
				for side in [-1,1]:
					for i in range(10):
						WorldZones.rock(p,Vector3(side*2.2+sin(i)*0.16,0.4+i*0.27,-5.42),Vector3(0.33,0.25,0.09),"6c8c4e")
			"mushroom_glade":
				for i in range(12):
					var v=Vector3(1+sin(i*2.4)*3.6,0.065,-3+cos(i*2.4)*3.2)
					WorldZones.cyl(p,v,0.24+(i%3)*0.06,0.018,"749b55","disc")
				for i in range(8):
					var streak=WorldZones.box(p,Vector3(2.2+(i%4)*0.42,1+i%3,-11.85),Vector3(0.06,0.8,0.025),"d1efeb",0.3)
					moving.append({"type":"water","node":streak,"base":streak.position,"phase":i*0.7})
				for i in range(7):
					var v=Vector3(-6+i*0.26,0,3+sin(i)*0.3)
					WorldZones.line(p,v,v+Vector3(0.12,0.7,0),0.025,"648b63")
					WorldZones.cyl(p,v+Vector3(0.13,0.64,0),0.085,0.16,"a7dce2","taper",0.3)
				var n=discovery(p,Vector3(4,0,4),"mushroom","Touch the cap · a woodland drum",Vector3(0,0.8,0),Vector3(1.1,0.3,1.1))
				WorldZones.cyl(n,Vector3(0,0.38,0),0.18,0.76,"d3c7a8")
				var cap=WorldZones.rock(n,Vector3(0,0.83,0),Vector3(1.1,0.32,1.1),"a578bd")
				n.set_meta("visual",cap); n.set_meta("touch_point",Vector3(0,0.9,0))
			"crystal_hollow":
				cart(p,Vector3(6,0,4),"79deec")
				for i in range(3):
					var n=discovery(p,Vector3(-4+i*0.8,0,3),"chime","Touch crystal · play a note",Vector3(0,1,0),Vector3(0.4,1.6,0.4))
					var shard=preload("res://crystal_art.gd").shard(n,Vector3(0,0.9,0),Vector3(0.3,1.5,0.3),Color(["65d3eb","ab9af0","ea99d4"][i]))
					n.set_meta("pitch",[1.0,1.25,1.5][i]); n.set_meta("touch_point",Vector3(0,1.2,0))
					n.set_meta("visual",shard)
			"sky_garden":
				var n=discovery(p,Vector3(-2,0,3),"wind","Trigger · start / stop the windmill",Vector3(0,1,0),Vector3(0.8,0.8,0.5))
				WorldZones.box(n,Vector3(0,0.55,0),Vector3(0.25,1.1,0.25),"8e7654")
				var wheel=Node3D.new(); n.add_child(wheel); wheel.position=Vector3(0,1.1,0)
				for i in range(6): WorldZones.line(wheel,Vector3.ZERO,Vector3(cos(i*TAU/6)*0.32,sin(i*TAU/6)*0.32,0),0.065,"ba985c")
				n.set_meta("visual",wheel)
				banner(p,Vector3(5,2.3,0),"426a91","✧")
				WorldZones.box(p,Vector3(4.35,1.7,0),Vector3(0.14,3.4,0.14),"8e7654")
			"ember_foundry":
				for side in [-1,1]:
					WorldZones.line(p,Vector3(side*5.8,5.5,-11.6),Vector3(side*5.8,5.5,-10.5),0.14,"494450")
					for i in range(12):
						var torus=TorusMesh.new(); torus.inner_radius=0.10; torus.outer_radius=0.16; torus.rings=8; torus.ring_segments=4
						var link=MeshInstance3D.new(); link.mesh=torus; link.material_override=WorldZones.mat("494450")
						p.add_child(link); link.position=Vector3(side*5.8,1.9+i*0.3,-10.5); link.rotation.x=PI/2; link.rotation.y=(i%2)*PI/2
					for i in range(5):
						var mote=WorldZones.rock(p,Vector3(side*6,0,0),Vector3.ONE*0.055,"ffd583")
						mote.material_override=WorldZones.mat("ffd583",1.0)
						moving.append({"type":"ember","node":mote,"base":mote.position,"phase":i*0.6})
		# Only static visual meshes enter this existing batching path; interactive
		# roots retain their own colliders and animated meshes stay unbatched.
		for entry in moving:
			if entry.node.get_parent()==p:
				var holder=Node3D.new(); p.add_child(holder); entry.node.reparent(holder)
		WorldZones.batch_decorations(p)
	notes.chime=make_note(440.0); notes.mushroom=make_note(130.0)
	for i in range(4):
		var player=AudioStreamPlayer3D.new(); game.add_child(player); player.max_distance=12; audio.append(player)
	print("ZONE_DETAILS ready cups=",cups.size()," discoveries=",touchables.size()," animated=",moving.size())

func banner(p,v,color,symbol):
	WorldZones.line(p,v+Vector3(-0.65,1,0),v+Vector3(0.65,1,0),0.08,"7d603e")
	WorldZones.box(p,v,Vector3(1,1.9,0.035),color)
	WorldZones.label(p,symbol,v+Vector3(0,0,0.035),55,"e9d7a6")

func discovery(p,v,id,hint,center,size):
	var n=Node3D.new(); p.add_child(n); n.position=v
	n.set_meta("kind","discovery"); n.set_meta("discovery",id); n.set_meta("hint",hint)
	WorldZones.body(n,center,size)
	var label=WorldZones.label(n,hint,Vector3(0,1.8,0),16); label.pixel_size=0.002
	touchables.append(n)
	return n

func cart(p,v,color):
	var wheels=[]
	var n=discovery(p,v,"cart","Trigger · send the ore cart",Vector3(0,0.7,0),Vector3(1.1,0.8,1.4))
	for side in [-1,1]:
		WorldZones.line(p,v+Vector3(side*0.48,0.055,-2),v+Vector3(side*0.48,0.055,2.5),0.08,"53565c")
		WorldZones.box(n,Vector3(side*0.57,0.8,0),Vector3(0.1,0.65,1.35),"795c43")
		for z in [-0.48,0.48]:
			var wheel=WorldZones.cyl(n,Vector3(side*0.57,0.24,z),0.23,0.09,"4c5258"); wheel.rotation.z=PI/2; wheels.append(wheel)
	for z in [-0.67,0.67]: WorldZones.box(n,Vector3(0,0.8,z),Vector3(1.2,0.65,0.09),"947452")
	for z in [-0.73,0.73]:
		WorldZones.line(n,Vector3(-0.5,0.55,z),Vector3(0.5,1.06,z),0.055,"594b3d")
		WorldZones.line(n,Vector3(0.5,0.55,z),Vector3(-0.5,1.06,z),0.055,"594b3d")
	WorldZones.box(n,Vector3(0,0.48,0),Vector3(1.1,0.1,1.3),"73563f")
	for i in range(5): WorldZones.rock(n,Vector3(sin(i*2.4)*0.3,0.8,cos(i*2.4)*0.4),Vector3(0.45,0.55,0.4),color)
	n.set_meta("wheels",wheels)
	n.set_meta("base",v); n.set_meta("travel",0.0); n.set_meta("destination",0.0)

func cup(p,v,index):
	var n=Node3D.new(); p.add_child(n); n.position=v
	n.set_meta("mass",0.12)
	n.set_meta("kind","weapon"); n.set_meta("id","enchanted_teacup"); n.set_meta("display_name","Wandering Teacup")
	n.set_meta("use_instructions","Grip to catch · trigger to sip tea (+5 health, 30s refill)")
	n.add_to_group("pickup")
	var porcelain=WorldZones.mat("e2d1df")
	var shell=TorusMesh.new(); shell.inner_radius=0.085; shell.outer_radius=0.12; shell.rings=12; shell.ring_segments=6
	var wall=CylinderMesh.new(); wall.top_radius=0.105; wall.bottom_radius=0.075; wall.height=0.10; wall.radial_segments=16; wall.cap_top=false; wall.cap_bottom=false
	var body_visual=MeshInstance3D.new(); body_visual.mesh=wall; body_visual.material_override=porcelain.duplicate(); body_visual.material_override.cull_mode=BaseMaterial3D.CULL_DISABLED
	n.add_child(body_visual); body_visual.position.y=0.073
	var rim=MeshInstance3D.new(); rim.mesh=shell; rim.material_override=porcelain; n.add_child(rim); rim.position.y=0.122
	WorldZones.cyl(n,Vector3(0,0.022,0),0.078,0.025,"e2d1df")
	WorldZones.cyl(n,Vector3(0,0.112,0),0.095,0.005,"b37b51")
	var handle=MeshInstance3D.new(); handle.mesh=shell; handle.material_override=porcelain; n.add_child(handle); handle.scale=Vector3.ONE*0.55; handle.position=Vector3(0.13,0.065,0); handle.rotation.z=PI/2
	WorldZones.body(n,Vector3(0,0.065,0),Vector3(0.34,0.17,0.24))
	cups.append({"node":n,"parent":p,"home":v,"phase":index*2.0,"caught":false})

func interact(target,hand=null)->bool:
	if target==null or not target.has_meta("discovery"): return false
	if game.elapsed<float(target.get_meta("ready",0)): return true
	target.set_meta("ready",game.elapsed+0.7)
	var id=str(target.get_meta("discovery"))
	match id:
		"cart": target.set_meta("destination",2.0 if float(target.get_meta("destination"))==0 else 0.0)
		"wind":
			var wheel=target.get_meta("visual")
			create_tween().tween_property(wheel,"rotation:z",wheel.rotation.z+PI/3,0.3)
			var rotor=game.scene.zones.sky_garden.root.find_child("WindmillRotor",true,false)
			if rotor!=null: rotor.set_meta("running",not rotor.get_meta("running",true))
		"chime","mushroom":
			game._effect(target.global_position+Vector3.UP,Color("b5d9ef"),0.4,0.4)
			var visual=target.get_meta("visual"); var base=visual.scale
			var tween=create_tween(); tween.tween_property(visual,"scale",base*Vector3(1.08,0.85,1.08),0.10); tween.tween_property(visual,"scale",base,0.3)
	if not game.diagnostic_offline:
		var player=audio[sound_index%audio.size()]; sound_index+=1
		player.stream=notes.get(id,game.siegebird.sounds.seat); player.pitch_scale=float(target.get_meta("pitch",0.65)); player.volume_db=-16+linear_to_db(maxf(0.001,game.tuning.value("audio.volume"))); player.global_position=target.global_position; player.play()
	game.adventure.haptic(hand,"ready")
	print("ZONE_DISCOVERY ",id)
	return true

func held_action(hand)->bool:
	var item=game.held.get(str(hand.get_instance_id()))
	if not is_instance_valid(item) or item.get_meta("id","")!="enchanted_teacup": return false
	if game.elapsed<float(item.get_meta("refill",0)): game._notice("The teacup is brewing another sip."); return true
	game.adventure.hp=minf(100,game.adventure.hp+5); item.set_meta("refill",game.elapsed+30)
	game._notice("A warm sip · +5 health. Tea refills in 30 seconds.")
	game.adventure.haptic(hand,"ready")
	return true

func _process(delta):
	clock+=delta
	for entry in moving:
		if not entry.node.is_visible_in_tree(): continue
		var t=fposmod(clock+entry.phase,3.0)/3.0
		entry.node.position=Vector3(entry.base.x,0.3+(1-t)*5.4,entry.base.z) if entry.type=="water" else entry.base+Vector3.UP*t*1.6
		if entry.type=="ember": entry.node.scale=Vector3.ONE*0.055*sin(PI*t)
	for entry in cups:
		if entry.node.get_parent()!=entry.parent: entry.caught=true
		if not entry.caught and entry.node.is_visible_in_tree():
			entry.node.position=entry.home+Vector3(0,sin(clock+entry.phase)*0.10,0)
			entry.node.rotation.y=sin(clock*0.4+entry.phase)*0.2
	for n in touchables:
		if not n.is_visible_in_tree(): continue
		if n.get_meta("discovery")=="cart":
			var travel=move_toward(float(n.get_meta("travel")),float(n.get_meta("destination")),delta*0.6)
			for wheel in n.get_meta("wheels",[]): wheel.rotate_object_local(Vector3.UP,-(travel-float(n.get_meta("travel")))/0.23)
			n.set_meta("travel",travel); n.position=n.get_meta("base")+Vector3(0,0,travel)
		if n.get_meta("discovery") in ["chime","mushroom"]:
			for hand in game.hands:
				var key=str(n.get_instance_id())+":"+str(hand.get_instance_id())
				var contact=hand.global_position.distance_to(n.to_global(n.get_meta("touch_point")))<0.22
				if contact and not touching.get(key,false): interact(n,hand)
				touching[key]=contact
	var rotor=game.scene.zones.sky_garden.root.find_child("WindmillRotor",true,false)
	if rotor!=null and rotor.is_visible_in_tree() and rotor.get_meta("running",true): rotor.rotate_z(delta*0.25)

func make_note(frequency:float)->AudioStreamWAV:
	var bytes=PackedByteArray(); bytes.resize(22050*2)
	for i in range(22050):
		var t=float(i)/22050.0
		var sample=(sin(TAU*frequency*t)+0.3*sin(TAU*frequency*2.01*t))*exp(-t*6)*minf(1,t*200)
		bytes.encode_s16(i*2,int(sample*17000))
	var wav=AudioStreamWAV.new(); wav.format=AudioStreamWAV.FORMAT_16_BITS; wav.mix_rate=22050; wav.data=bytes
	return wav

func checks(failures:Array):
	var entry=cups[0]; var cup_node=entry.node
	var parent=cup_node.get_parent(); var transform=cup_node.transform
	var hand=Node3D.new(); game.add_child(hand); hand.global_position=cup_node.global_position
	game.grips._attach(hand,cup_node)
	_process(0.01)
	if not entry.caught: failures.append("caught teacup still floating")
	var health=game.adventure.hp; game.adventure.hp=50
	if not held_action(hand): failures.append("teacup trigger not handled")
	held_action(hand)
	if game.adventure.hp!=55: failures.append("tea healing or refill cooldown")
	game.adventure.hp=health; cup_node.remove_meta("refill")
	var key=str(hand.get_instance_id()); game.held.erase(key); game.grips.grips.erase(key)
	game.tool_physics.drop(cup_node,Vector3.ZERO,Vector3.ZERO)
	var body=cup_node.get_meta("drop_body")
	if body.collision_layer!=8 or absf(body.mass-0.12)>0.001: failures.append("cup physics mass/layer")
	game.tool_physics.detach(cup_node); cup_node.reparent(parent); cup_node.transform=transform
	game._set_collisions(cup_node,true); entry.caught=false; hand.queue_free()
	for n in touchables:
		if n.get_meta("discovery")=="cart":
			interact(n)
			if float(n.get_meta("destination"))!=2: failures.append("cart activation")
			n.set_meta("destination",0.0); n.remove_meta("ready")
		if n.get_meta("discovery")=="wind":
			var rotor=game.scene.zones.sky_garden.root.find_child("WindmillRotor",true,false)
			var running=rotor.get_meta("running",true); interact(n)
			if rotor.get_meta("running")==running: failures.append("windmill control")
			rotor.set_meta("running",running); n.remove_meta("ready")
	print("ZONE_DETAIL_CHECK ",JSON.stringify(failures))
