extends Node
## Rigid puppet rigs reuse the actual authored meshes. Gameplay owns the root.
const PROFILES={"skeleton":{"stride":0.8,"swing":0.5,"bob":0.025},"rat":{"stride":0.22,"swing":0.65,"bob":0.008},"golem":{"stride":1.1,"swing":0.22,"bob":0.04},"boss":{"stride":1.8,"swing":0.18,"bob":0.065},"wisp":{"stride":0.7,"swing":0.1,"bob":0.04}}
var game
var actors={}
var debug_states=false
var golem_runtime

func setup(owner_game):
	game=owner_game
	golem_runtime=preload("res://golem_runtime.gd").new()
	add_child(golem_runtime)
	golem_runtime.setup(game,self)
	for actor in game.scene.enemies+game.scene.rats: register(actor)

func register(actor):
	var type=str(actor.get_meta("enemy_type","rat"))
	var s=1.8 if type=="boss" else 1.0
	var visual=Node3D.new()
	visual.name="AnimatedVisual"
	actor.add_child(visual)
	var locations={"body":Vector3(0,0.95,0),"head":Vector3(0,1.48,0),"arm_l":Vector3(-0.23,1.35,0),"arm_r":Vector3(0.23,1.35,0),"leg_l":Vector3(-0.15,0.78,0),"leg_r":Vector3(0.15,0.78,0),"tail":Vector3(0,0.1,-0.2)}
	if type in ["golem","boss"]:
		locations.head=Vector3(0,1.85,0)
		locations.arm_l=Vector3(-0.55,1.5,0)
		locations.arm_r=Vector3(0.55,1.5,0)
	if type=="rat": locations={"body":Vector3(0,0.18,0),"head":Vector3(0,0.19,0.2),"arm_l":Vector3(-0.14,0.09,0.13),"arm_r":Vector3(0.14,0.09,0.13),"leg_l":Vector3(-0.14,0.09,-0.14),"leg_r":Vector3(0.14,0.09,-0.14),"tail":Vector3(0,0.06,-0.25)}
	var joints={}
	for name in locations:
		var joint=Node3D.new()
		joint.name=name
		visual.add_child(joint)
		joint.position=locations[name]*s
		joints[name]=joint
	var pieces=[]
	var head_piece=Node3D.new()
	head_piece.name="Skull" if type=="skeleton" else "Head"
	joints.head.add_child(head_piece)
	pieces.append(head_piece)
	for mesh in actor.get_children():
		if not mesh is MeshInstance3D: continue
		var p=mesh.position/s
		var part="body"
		if type=="rat":
			if p.z< -0.25: part="tail"
			elif p.y<0.1 and absf(p.x)>0.08: part=("arm_" if p.z>0 else "leg_")+("l" if p.x<0 else "r")
			elif p.z>0.15: part="head"
		else:
			if absf(p.x)> (0.5 if type in ["golem","boss"] else 0.32): part="arm_l" if p.x<0 else "arm_r"
			elif p.y<(0.8 if type!="wisp" else 0): part="leg_l" if p.x<0 else "leg_r"
			elif p.y>(1.7 if type in ["golem","boss"] else 1.4): part="head"
		if part=="head": mesh.reparent(head_piece)
		else:
			var piece=Node3D.new()
			piece.name="Piece%d"%pieces.size()
			actor.add_child(piece)
			piece.position=mesh.position
			mesh.reparent(piece)
			piece.reparent(joints[part])
			pieces.append(piece)
	var player=AnimationPlayer.new()
	player.name="PosePlayer"
	visual.add_child(player)
	var library=AnimationLibrary.new()
	var swing=PROFILES.get(type,PROFILES.skeleton).swing
	for clip_name in ["idle","walk","attack"]:
		var clip=Animation.new()
		clip.length=1.0
		for name in joints:
			var track=clip.add_track(Animation.TYPE_VALUE)
			clip.track_set_path(track,NodePath(name+":rotation"))
			for i in range(9):
				var t=float(i)/8
				var angle=Vector3.ZERO
				if clip_name=="walk":
					var sign_value=-1.0 if name in ["arm_l","leg_r"] else 1.0
					angle.x=sin(t*TAU)*swing*sign_value if name.begins_with("arm") or name.begins_with("leg") else 0.0
					if name=="head": angle.z=sin(t*TAU)*0.035
					if name=="tail": angle.y=sin(t*TAU)*0.25
				elif clip_name=="idle":
					if name=="head": angle.y=sin(t*TAU)*0.045
					if name=="body": angle.x=sin(t*TAU)*0.012
					if name=="tail": angle.y=sin(t*TAU)*0.12
				else:
					# 0..0.65 wind-up, 0.65..0.8 strike, remainder recovery.
					var lift=sin(minf(t/0.65,1.0)*PI/2)*-1.55 if t<=0.65 else lerpf(-1.55,0.55,clampf((t-0.65)/0.15,0,1))
					if t>0.8: lift=lerpf(0.55,0.0,(t-0.8)/0.2)
					if name=="arm_r" or (type in ["golem","boss"] and name=="arm_l"): angle.x=lift
					if name=="body": angle.x=-lift*0.09
					if type=="rat" and name=="head": angle.x=lift*0.25
				clip.track_insert_key(track,t,angle)
		library.add_animation(clip_name,clip)
	player.add_animation_library("",library)
	actors[actor.get_instance_id()]={"actor":actor,"type":type,"visual":visual,"joints":joints,"pieces":pieces,"player":player,"distance":0.0,"last":actor.global_position,"state":"","clip":"","hit_at":-100.0,"hit_dir":Vector3.ZERO,"homes":pieces.map(func(p):return {"piece":p,"parent":p.get_parent(),"transform":p.transform})}
	if type=="golem" and golem_runtime!=null: golem_runtime.attach(actor,actors[actor.get_instance_id()])

func pose(actor,clip_name,progress):
	var rig=actors.get(actor.get_instance_id(),{})
	if rig.is_empty(): return
	if rig.clip!=clip_name:
		rig.player.play(clip_name)
		rig.player.pause()
		rig.clip=clip_name
	rig.player.seek(clampf(progress,0,0.9999),true)

func hit(actor,direction):
	var rig=actors.get(actor.get_instance_id(),{})
	if rig.is_empty(): return
	rig.hit_at=game.elapsed
	rig.hit_dir=actor.global_basis.inverse()*direction.normalized()

func tick(delta):
	for rig in actors.values():
		var actor=rig.actor
		if not is_instance_valid(actor) or not actor.get_meta("alive",true): continue
		if actor.get_meta("lab",false): continue
		var difference=actor.global_position-rig.last
		rig.last=actor.global_position
		if not actor.is_visible_in_tree(): continue
		var travelled=Vector2(difference.x,difference.z).length()
		if game.adventure.zone=="orchard_planet":
			var local_up:Vector3=game.local_up_at(actor.global_position) if game.has_method("local_up_at") else actor.global_basis.y.normalized()
			travelled=difference.slide(local_up).length()
		if travelled>0.5: travelled=0
		rig.distance+=travelled
		var phase=str(actor.get_meta("combat_phase","idle"))
		var progress=float(actor.get_meta("combat_progress",0))
		var moving=travelled>0.0001
		var state=phase if phase in ["windup","strike","recovery"] else ("walk" if moving else "idle")
		if rig.state!=state:
			rig.state=state
			if debug_states: print("ACTOR_STATE ",rig.type," ",state)
		var profile=PROFILES.get(rig.type,PROFILES.skeleton)
		var gait=fposmod(rig.distance/(profile.stride*game.tuning.value("enemy.stride")),1.0)
		if state in ["windup","strike","recovery"]: pose(actor,"attack",progress)
		else: pose(actor,state,gait if moving else fposmod(game.elapsed*0.2+float(actor.get_instance_id()%17)/17,1))
		var recoil=maxf(0,1-(game.elapsed-rig.hit_at)/0.3)*game.tuning.value("enemy.recoil")
		var stride_bob=absf(sin(gait*TAU*2.0))*profile.bob*game.tuning.value("enemy.bob") if moving else 0.0
		rig.visual.position=Vector3(0,stride_bob,0)+rig.hit_dir*recoil*0.07
		if rig.type=="rat":
			# A fast four-foot scurry, breathing/sniffing head and loose tail make
			# the larger ears and coat silhouette feel alive without root-motion
			# surprises. Attack windup is still owned by the shared animation clip.
			var scamper=sin(gait*TAU*2.0)
			rig.joints.body.rotation.z+=scamper*0.045 if moving else 0.0
			rig.joints.head.rotation.x+=sin(game.elapsed*9.0+float(actor.get_instance_id()%13))*0.035
			rig.joints.tail.rotation.y+=sin(game.elapsed*5.0+gait*TAU)*0.17
			if state=="strike": rig.visual.position.z=0.075*sin(clampf(progress,0,1)*PI)
		rig.visual.rotation=Vector3(rig.hit_dir.z*recoil*0.12,0,-rig.hit_dir.x*recoil*0.12)
	if golem_runtime!=null: golem_runtime.tick(delta)

func restore(actor):
	var rig=actors.get(actor.get_instance_id(),{})
	if rig.is_empty(): return
	# Dead meshes moved to bodies. Restore fresh visuals from the retained templates.
	for home in rig.homes:
		if is_instance_valid(home.piece): continue
		var replacement=home.template.duplicate()
		home.parent.add_child(replacement)
		replacement.transform=home.transform
		home.piece=replacement
	rig.pieces=rig.homes.map(func(h):return h.piece)
	rig.last=actor.global_position
	rig.distance=0
	rig.hit_at=-100
	actor.set_meta("combat_phase","idle")
	actor.set_meta("attack_at",0.0)
	actor.set_meta("rest_until",0.0)
	actor.set_meta("bite_at",-100.0)
	rig.visual.transform=Transform3D.IDENTITY
	pose(actor,"idle",0)
	if golem_runtime!=null: golem_runtime.restore(actor)
	if game.guardian_authored!=null: game.guardian_authored.after_restore(actor)
