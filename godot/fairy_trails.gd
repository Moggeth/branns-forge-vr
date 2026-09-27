extends Node
## Three compact light-led places; bounded effects, no progress/save mutation.
const A=preload("res://world_zones.gd")
const ZONES=["glowroot_grotto","starlace_archive","moonwater_causeway"]
const NAMES=["Glowroot Grotto","Starlace Archive","Moonwater Causeway"]
var game
var rooms={}
var flowers=[]
var seals=[]
var steps=[]
var moths=[]
var rings=[]
var clock=0.0
var scan_clock=0.0
var archive_gate:Node3D
var gate_body:StaticBody3D
var archive_open=false
var gate_open_amount=0.0
var last_zone=""
var next_chime=0.0
func setup(g):
	game=g
	for index in range(3): build_room(index)
	for i in range(3): button(game.adventure.zone_groups.forge_yard,Vector3(-7.0,1.9-i*.42,5),"visit:"+ZONES[i],NAMES[i],2.8)
	A.label(game.adventure.zone_groups.forge_yard,"LITTLE WING · AFTER DARK\nClick a sign / fairy: J cycles places\nH: shoulder perch · R: shared pulse\nRest together to lend a little light",Vector3(-7,2.6,5),23,"b9e7ff").pixel_size=.003
	for i in range(8):
		var n=MeshInstance3D.new(); game.add_child(n); var mesh=TorusMesh.new(); mesh.inner_radius=.46; mesh.outer_radius=.50; mesh.rings=20; mesh.ring_segments=6; n.mesh=mesh
		var mat=StandardMaterial3D.new(); mat.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED; mat.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; mat.emission_enabled=true; n.material_override=mat; n.hide(); rings.append({"node":n,"age":2.0,"zone":""})
	last_zone=game.adventure.zone
	print("FAIRY_TRAILS_READY zones=3 pooled_rings=8 moths=18 shadow_lights=0 persistence=session")
func solid(parent,pos,size,color):
	A.box(parent,pos,size,color); return A.body(parent,pos,size)
func button(parent,pos,action,text,width=2.4):
	var n=Node3D.new(); parent.add_child(n); n.position=pos; n.set_meta("kind","button"); n.set_meta("action","fairytrail:"+action)
	solid(n,Vector3.ZERO,Vector3(width,.32,.12),"304352"); A.label(n,text,Vector3(0,0,.08),23,"cceeff").pixel_size=.003
	if action in ["leave","next","comfort"]: n.rotation.y=PI
func build_room(index):
	var id=ZONES[index]; var root=Node3D.new(); game.add_child(root); root.position=Vector3(-200-index*70,0,120); root.name=NAMES[index]; rooms[id]=root
	game.adventure.zone_groups[id]=root
	game.scene.zones[id]={"name":NAMES[index],"center":root.position,"spawn":root.position+Vector3(0,0,8),"environment":{"ambient_color":"697eae","ambient_energy":.11,"sun_color":"85a8cf","sun_energy":.015,"sky_top":"050919","sky_horizon":"101b32","fog_density":.012,"fog_color":"0b1226"}}
	root.visible=game.adventure.zone==id
	solid(root,Vector3(0,-.25,0),Vector3(16,.5,24),"273446")
	for x in [-8,8]: solid(root,Vector3(x,2.5,0),Vector3(.5,5,24),"29384a")
	solid(root,Vector3(0,2.5,-12),Vector3(16,5,.5),"273446")
	solid(root,Vector3(0,2.5,12),Vector3(16,5,.5),"273446")
	button(root,Vector3(0,1.5,10),"leave","BACK TO BRANN")
	button(root,Vector3(4,1.5,9),"next","NEXT NIGHT WALK")
	button(root,Vector3(-4,1.5,9),"comfort","BRIGHTER / MOODY")
	A.label(root,NAMES[index].to_upper(),Vector3(0,3,7),34,"a6d8ff").pixel_size=.004
	var instructions=["A living lantern garden\nFly close: sleeping caps bloom and light the way.","Three sleeping seals\nFly near each rune, then pulse (Middle / R / Y).\nYour friend can walk through the awakened gate.","A path written in moonwater\nFairy light wakes each stepping stone for 12 seconds.\nPerch together to lend your friend a little light."]
	A.label(root,instructions[index],Vector3(0,2.35,7),22,"d2ecff").pixel_size=.0033
	if index==0:
		solid(root,Vector3(0,5,0),Vector3(16,.5,24),"243047")
		for i in range(16):
			var pos=Vector3(sin(i*1.6)*5,.0,5-i*.9)
			A.cyl(root,pos+Vector3.UP*.4,.13,.8,"678090")
			var cap=A.cyl(root,pos+Vector3.UP*.86,.48,.18,"416b86","disc",.1)
			var dome=SphereMesh.new(); dome.radius=.5; dome.height=1; dome.radial_segments=12; dome.rings=5; cap.mesh=dome; cap.scale.y=.32
			for dot in range(4): A.rock(root,pos+Vector3(sin(dot*2.4)*.28,1.015,cos(dot*2.4)*.28),Vector3(.065,.025,.065),"96a7b7")
			flowers.append({"node":cap,"home":cap.scale,"until":0.0,"zone":id,"glow":0.0})
			A.rock(root,Vector3(cos(i*2.4)*6,.25,4-i*.9),Vector3(.7,.5,.6),"3b5060")
		for i in range(22):
			var x=(-1 if i%2==0 else 1)*(6.8+sin(i)*.5); var z=7-i*.85
			A.rock(root,Vector3(x,1.2,z),Vector3(2,2.8+sin(i),1.7),"384960")
			A.cyl(root,Vector3(x*.6,4.3,z),.3,1.2,"40526b","cone").rotation.z=PI
	elif index==1:
		solid(root,Vector3(0,5,0),Vector3(16,.5,24),"243047")
		for x in [-6,6]:
			for z in [-7,-3,1]:
				solid(root,Vector3(x,1.2,z),Vector3(1.3,2.4,2.5),"354054")
				for j in range(5): A.box(root,Vector3(x-.45+j*.22,1.3,z+1.27),Vector3(.14,1.6,.12),["52719b","96797b","809384"][j%3])
		for i in range(3):
			var rune=Node3D.new(); root.add_child(rune); rune.position=Vector3(-3+i*3,1.5,-2-abs(i-1)*2)
			A.cyl(rune,Vector3(0,-.8,0),.4,1.1,"3e5262")
			var jewel=A.rock(rune,Vector3.ZERO,Vector3(.22,.45,.22),"4d5c87")
			var ring=A.cyl(rune,Vector3(0,.0,-.08),.38,.025,"597a9a","disc",.15); ring.rotation.x=PI/2
			for spoke in range(3):
				var rod=A.box(rune,Vector3(0,0,.02),Vector3(.025,.52,.035),"91b9db",.4); rod.rotation.z=spoke*TAU/3
			seals.append({"node":rune,"jewel":jewel,"awake":false})
		archive_gate=Node3D.new(); root.add_child(archive_gate); archive_gate.position=Vector3(0,1.7,-7)
		gate_body=solid(archive_gate,Vector3.ZERO,Vector3(4,3.4,.3),"31455b")
		for x in [-5,5]: solid(root,Vector3(x,1.7,-7),Vector3(6,3.4,.3),"31455b")
		A.label(archive_gate,"THE STARLACE VAULT\nWake all three seals",Vector3(0,.2,.18),26,"789eb5").pixel_size=.004
		for i in range(7): A.cyl(root,Vector3(sin(i*2.4)*2,.5,-10+cos(i*2.4)),.18,1,"9ed9df","taper",.8)
	else:
		var water=A.box(root,Vector3(0,.015,0),Vector3(14,.02,19),"122b42",.07)
		var shader=Shader.new(); shader.code="shader_type spatial; render_mode cull_disabled; void fragment(){float wave=pow(max(0.0,sin(UV.x*85.0+sin(UV.y*32.0+TIME*.5)*2.0-TIME*.7)),22.0); ALBEDO=mix(vec3(.025,.08,.13),vec3(.08,.23,.30),wave*.45); EMISSION=vec3(.025,.08,.10)*wave*.22; ROUGHNESS=.34;}"
		var material=ShaderMaterial.new(); material.shader=shader; water.material_override=material
		for i in range(13):
			var pos=Vector3(sin(i*.6)*2.2,.08,6-i*1.25)
			solid(root,pos,Vector3(1.35,.16,1.5),"344757")
			var mark=A.cyl(root,pos+Vector3.UP*.1,.46,.012,"497082","disc",.05)
			steps.append({"node":mark,"until":0.0})
		for i in range(20): A.cyl(root,Vector3((-1 if i%2==0 else 1)*(5+sin(i)),.35,7-i*.9),.035,.7,"436977")
	if index==2:
		for i in range(30):
			var star=A.rock(root,Vector3(sin(i*2.4)*12,9+sin(i)*2,cos(i*1.8)*13),Vector3.ONE*.045,"bedfff"); star.material_override=A.mat("bedfff",1.2)
	for i in range(6):
		var mote=A.rock(root,Vector3(sin(i*2.4)*4,1.5,3-i*2),Vector3(.035,.018,.05),"88bfff")
		mote.material_override=A.mat("88bfff",1.2)
		moths.append({"node":mote,"home":mote.position,"zone":id,"phase":i*2.4})
func act(action):
	if action.begins_with("visit:"): game.adventure.travel(action.trim_prefix("visit:")); return
	if action=="leave": game.adventure.travel("forge_yard"); return
	if action=="next":
		var index=ZONES.find(game.adventure.zone); game.adventure.travel(ZONES[(index+1)%3]); return
	if action=="comfort" and rooms.has(game.adventure.zone):
		var env=game.scene.zones[game.adventure.zone].environment
		env.ambient_energy=.30 if env.ambient_energy<.2 else .11
		game.adventure._apply_zone_environment(game.adventure.zone)
func ripple(pos,color):
	var chosen=rings[0]
	for ring in rings:
		if ring.age>=1.5: chosen=ring; break
	if game.playful_feedback!=null: game.playful_feedback.pulse(pos,"progress",.45)
	chosen.age=0; chosen.zone=game.adventure.zone; chosen.node.global_position=pos; chosen.node.show()
	chosen.node.material_override.albedo_color=color; chosen.node.material_override.emission=color; chosen.node.material_override.emission_energy_multiplier=.7
func pulse(fairy):
	if not fairy.active or fairy.health<=0: return
	ripple(fairy.avatar.global_position,Color("9deaff"))
	if game.adventure.zone!="starlace_archive": return
	for seal in seals:
		if not seal.awake and fairy.avatar.global_position.distance_to(seal.node.global_position)<2.4 and fairy._clear(fairy.avatar.global_position,seal.node.global_position):
			seal.awake=true; seal.jewel.material_override=A.mat("a7eaff",1.5); fairy.art.burst(seal.node.global_position,Color("b3e9ff")); fairy.note("A seal remembers the stars.")
	if not archive_open and seals.all(func(s):return s.awake):
		archive_open=true; fairy.note("All three seals awake. The vault opens for your friend!")
		print("FAIRY_TRAILS archive_open=true")
func tick(dt):
	clock+=dt
	var fairy=game.fairy
	var available=fairy!=null and fairy.active and fairy.health>0
	if available:
		fairy.lamp.omni_range=4.2 if rooms.has(game.adventure.zone) else 3.0
		fairy.lamp.light_energy=1.1 if rooms.has(game.adventure.zone) else .65
	for ring in rings:
		ring.age+=dt; ring.node.visible=ring.age<1.5 and ring.zone==game.adventure.zone
		if ring.node.visible:
			ring.node.scale=Vector3.ONE*(.35 if game.playful_feedback.reduced_motion else (.08+ring.age*2.8)); var color=ring.node.material_override.albedo_color; color.a=maxf(0,1-ring.age/1.5)*.5; ring.node.material_override.albedo_color=color
	if game.adventure.zone=="starlace_archive":
		gate_open_amount=move_toward(gate_open_amount,1.0 if archive_open else 0.0,dt*.6); archive_gate.position.y=1.7+gate_open_amount*3.8
	for moth in moths:
		if moth.zone!=game.adventure.zone: continue
		var destination=moth.home+Vector3(sin(clock+moth.phase)*.35,sin(clock*1.4+moth.phase)*.2,cos(clock+moth.phase)*.3)
		if game.playful_feedback.reduced_motion: destination=moth.home
		if available and fairy.avatar.global_position.distance_to(moth.node.global_position)<3:
			destination=moth.node.get_parent().to_local(fairy.avatar.global_position)+Vector3(sin(clock+moth.phase)*.45,.25,cos(clock+moth.phase)*.45)
		moth.node.position=moth.node.position.lerp(destination,minf(1,dt*2))
	scan_clock-=dt
	if scan_clock>0: return
	scan_clock=.1
	for flower in flowers:
		if flower.zone!=game.adventure.zone: continue
		if available and fairy.avatar.global_position.distance_to(flower.node.global_position)<2.5 and fairy._clear(fairy.avatar.global_position,flower.node.global_position):
			if flower.until<game.elapsed: fairy.art.sprinkle(flower.node.global_position,Vector3.UP*.3,Color("c6a4ff"),1.2)
			flower.until=game.elapsed+8
		flower.glow=move_toward(flower.glow,1.0 if flower.until>game.elapsed else 0.0,.08)
		flower.node.scale=flower.home*(1+flower.glow*.35); flower.node.material_override=A.mat("8679c6" if flower.glow>.1 else "416b86",snappedf(flower.glow,.2))
	for step in steps:
		if game.adventure.zone!="moonwater_causeway": continue
		if available and fairy.avatar.global_position.distance_to(step.node.global_position)<2.5 and fairy._clear(fairy.avatar.global_position,step.node.global_position+Vector3.UP*.05): step.until=game.elapsed+12
		step.node.material_override=A.mat("83dfe6" if step.until>game.elapsed else "497082",1.3 if step.until>game.elapsed else .05)
