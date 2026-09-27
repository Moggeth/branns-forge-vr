extends Node
## Offline developer stage. Uses the same rigs, clips and physical remains.
var game
var samples=[]
var selected=0
var clip="walk"
var paused=false
var speed=1.0
var clock=0.0
var turning=false
var markers=[]
var show_markers=false

func setup(owner_game):
	game=owner_game
	game.adventure.test_mode=true
	game.tuning.schema=JSON.parse_string(FileAccess.get_file_as_string("res://tuning_schema.json"))
	game.rig.position=Vector3(0,0,3)
	game.camera.position=Vector3(0,1.7,0)
	game.camera.rotation=Vector3.ZERO
	var crystal_tool = game.adventure._tool_model("crystal_resonator")
	game.add_child(crystal_tool)
	crystal_tool.position = Vector3(0.9,0.8,0.2)
	game.adventure._box(game,Vector3(0.9,0.4,0.2),Vector3(0.65,0.8,0.65),Color("38434e"))
	game.qol._label(game,"Hollow's Song · crystal hammer",Vector3(0.9,0.76,0.55),18)
	for type in ["skeleton","golem","rat"]:
		var actor
		if type=="rat":
			actor=preload("res://workshop_scene.gd").make_rat(99)
			game.add_child(actor)
		else:
			var data={"enemies":[]}
			preload("res://world_zones.gd").enemy(game,data,"forge_yard",Vector3.ZERO,type)
			actor=data.enemies[0]
		actor.set_meta("lab",true)
		game.animation.register(actor)
		samples.append(actor)
	for i in range(9):
		game.adventure._box(game,Vector3(i*0.5-2,0.012,0),Vector3(0.01,0.01,4),Color("638a8c"))
		game.adventure._box(game,Vector3(0,0.012,i*0.5-2),Vector3(4,0.01,0.01),Color("638a8c"))
	game.adventure._box(game,Vector3(0,0.03,0.65),Vector3(0.035,0.03,1.1),Color("f3cc71"))
	var controls=[["Next character","next"],["Idle","idle"],["Walk","walk"],["Attack","attack"],["Pause / play","pause"],["Slow / normal","slow"],["Turntable","turn"],["Joints","markers"],["Crumple","crumple"],["Explode","explode"],["Reset","reset"],["Hit reaction","hit"]]
	for i in range(controls.size()):
		var button=StaticBody3D.new()
		game.add_child(button)
		button.position=Vector3(-1.5,1.75-i*0.12,0.6)
		button.set_meta("action","lab:"+controls[i][1])
		game.adventure._box(button,Vector3.ZERO,Vector3(0.8,0.09,0.05),Color("30585a"))
		var shape=CollisionShape3D.new()
		shape.shape=BoxShape3D.new()
		shape.shape.size=Vector3(0.8,0.09,0.05)
		button.add_child(shape)
		game.qol._label(button,controls[i][0],Vector3(0,0,0.035),22)
	game._notice("ANIMATION LAB · point and trigger controls. B → Tuning changes Enemy Feel. No voice or saved rewards.",60)

func action(value):
	var actor=samples[selected]
	match value:
		"next": selected=(selected+1)%samples.size()
		"pause": paused=not paused
		"slow": speed=0.25 if speed==1.0 else 1.0
		"turn": turning=not turning
		"markers": show_markers=not show_markers
		"reset":
			game.animation.restore(actor)
			actor.set_meta("alive",true)
			actor.rotation=Vector3.ZERO
			clock=0
		"hit": game.animation.hit(actor,Vector3(1,0,-1))
		"crumple","explode":
			if actor.get_meta("alive",true):
				actor.set_meta("alive",false)
				game.remains.shatter(actor,Vector3(0,3,1.5) if value=="explode" else Vector3.ZERO)
		_: clip=value; clock=0

func _process(delta):
	if game==null: return
	if not paused: clock+=delta*speed
	for i in range(samples.size()):
		var actor=samples[i]
		actor.visible=i==selected and actor.get_meta("alive",true)
		game._set_collisions(actor,i==selected and actor.get_meta("alive",true))
		if i!=selected or not actor.visible: continue
		if turning and not paused: actor.rotation.y+=delta*0.5
		var progress=fposmod(clock/game.tuning.value("enemy.stride"),1)
		if clip=="attack":
			var windup=game.tuning.value("enemy.windup")
			var recovery=game.tuning.value("enemy.recovery")
			var age=fposmod(clock,windup+0.18+recovery)
			progress=age/windup*0.65 if age<windup else (0.65+(age-windup)/0.18*0.15 if age<windup+0.18 else 0.8+(age-windup-0.18)/recovery*0.2)
		game.animation.pose(actor,clip,progress)
		var rig=game.animation.actors[actor.get_instance_id()]
		var recoil=maxf(0,1-(game.elapsed-rig.hit_at)/0.3)*game.tuning.value("enemy.recoil")
		rig.visual.position=rig.hit_dir*recoil*0.07
		if clip=="walk": rig.visual.position.y=absf(sin(progress*TAU))*game.animation.PROFILES[rig.type].bob*game.tuning.value("enemy.bob")
	for marker in markers: marker.queue_free()
	markers=[]
	if show_markers:
		var rig=game.animation.actors[samples[selected].get_instance_id()]
		for joint in rig.joints.values():
			var marker=game._sphere(game,joint.global_position,0.025,Color("83edc6"))
			markers.append(marker)
