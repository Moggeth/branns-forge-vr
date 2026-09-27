extends Node
## One strike clock owns the pose, contact event, sparks and sound.
const STRIKE_PERIOD=0.90
const CONTACT_PHASE=0.72
const CONTACT=Vector3(-0.43,1.315,-2.9)
const HAMMER_FACE=Vector3(-0.2285,0.48,0)
var game
var finishing=false
var revealing=false
var next_slot=0
var delivered={}
var queue=[]
var billet:Node3D
var fragments=[]
var progress_panel:MeshInstance3D
var progress_label:Label3D
var progress_fill:MeshInstance3D
var strike_clock=0.0
var strike_count=0
var was_working=false
var home:Vector3
var impacts=[]
var sound_index=0
var audio_players=[]
var reveal_sound:AudioStreamWAV
var active_job={}

func setup(owner_game):
	game=owner_game
	home=game.scene.brann.position
	var parent=game.adventure.zone_groups.forge_yard
	billet=Node3D.new()
	parent.add_child(billet)
	billet.position=CONTACT-Vector3.UP*0.03
	var glow=WorkshopScene.material("df9c55",0.35,0.45,0.6)
	WorkshopScene.box(billet,Vector3.ZERO,Vector3(0.23,0.06,0.14),glow)
	for i in range(6):
		var part=WorkshopScene.box(billet,Vector3((i-2.5)*0.09,0.025,-0.15),Vector3(0.065,0.025,0.07),glow)
		fragments.append(part)
	billet.visible=false
	progress_panel=WorkshopScene.box(parent,Vector3(-1.55,1.82,-2.87),Vector3(1.42,0.57,0.035),WorkshopScene.material("263b38"))
	progress_label=WorkshopScene.label(parent,"",Vector3(-1.55,1.87,-2.83),21)
	progress_label.pixel_size=0.0031
	progress_label.width=430
	progress_label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	progress_fill=WorkshopScene.box(parent,Vector3(-1.55,1.61,-2.83),Vector3(1.05,0.022,0.025),glow)
	for i in range(8): impacts.append(load("res://audio/forge-impact-%d.wav"%(i+1)))
	reveal_sound=load("res://audio/forge-reveal.wav")
	for i in range(3):
		var player=AudioStreamPlayer3D.new()
		parent.add_child(player)
		player.unit_size=3.0
		player.max_distance=16.0
		player.volume_db=-18.0
		audio_players.append(player)

func working_pose(angle:float):
	var hammer:Node3D=game.scene.brann.get_meta("smith_hammer")
	var face:Vector3=hammer.transform*HAMMER_FACE
	var shoulder:Vector3=game.scene.arm.position
	var dy=CONTACT.y-(home.y+shoulder.y)
	var radius=sqrt(face.y*face.y+face.z*face.z)
	var dz=sqrt(maxf(0.01,radius*radius-dy*dy))
	var strike_angle=atan2(dz,dy)-atan2(face.z,face.y)
	game.scene.brann.position=Vector3(CONTACT.x-shoulder.x-face.x,home.y,CONTACT.z-shoulder.z-dz)
	game.scene.arm.rotation.x=strike_angle+angle

func _process(delta):
	if game==null: return
	active_job={}
	for job in game.state.get("jobs",[]):
		if job.get("status","") in ["building","validating","queued"]:
			active_job=job
			break
	var working=not revealing and (finishing or (not active_job.is_empty() and active_job.status!="queued"))
	billet.visible=working
	progress_label.visible=not active_job.is_empty() or finishing
	progress_panel.visible=progress_label.visible
	progress_fill.visible=progress_label.visible
	var estimate=active_job.get("estimatedProgress")
	var progress=clampf(float(estimate),0,1) if estimate!=null else 0.15+0.25*(sin(game.elapsed*0.8)+1.0)
	if finishing: progress=0.98
	var elapsed_build=float(active_job.get("elapsedSeconds",0))
	var shape_progress=progress if estimate!=null or finishing else 0.75*elapsed_build/(elapsed_build+120.0)
	progress_fill.scale.x=maxf(0.04,progress)
	progress_fill.position.x=-1.55-(1.0-progress)*0.525
	for i in range(fragments.size()):
		var part=fragments[i]
		part.visible=working and shape_progress>float(i)/8.0
		part.position.y=0.022+(1.0-shape_progress)*0.10+sin(game.elapsed*2.0+i)*0.008
		part.rotation.y=(1.0-shape_progress)*sin(game.elapsed+i)*0.5
	var message="A new creation!" if revealing else ("Finishing touches…" if finishing else progress_text(active_job))
	if progress_label.text!=message: progress_label.text=message
	if working:
		if not was_working: strike_clock=0.0
		var before=strike_clock/STRIKE_PERIOD
		strike_clock+=delta
		var after=strike_clock/STRIKE_PERIOD
		var phase=fposmod(after,1.0)
		var swing=-0.65*sin(PI*clampf(phase/CONTACT_PHASE,0,1)) if phase<CONTACT_PHASE else 0.0
		working_pose(swing)
		if floorf(before-CONTACT_PHASE)<floorf(after-CONTACT_PHASE):
			# Contact is sampled exactly, even if a low frame rate crosses the strike instant.
			working_pose(0.0)
			strike()
	else:
		game.scene.brann.position=game.scene.brann.position.lerp(home,1.0-exp(-delta*6))
		game.scene.arm.rotation.x=lerpf(game.scene.arm.rotation.x,sin(game.elapsed)*0.035,1.0-exp(-delta*6))
	was_working=working

static func progress_text(job:Dictionary)->String:
	if job.is_empty(): return ""
	var phase=str(job.get("status",""))
	if phase=="queued": return "Commission accepted\nWaiting for the forge"
	var stage="Checking the enchantment" if phase=="validating" else "Shaping your invention"
	if job.get("overEstimate",false): return stage+"\nTaking longer than usual · still working"
	var remaining=job.get("remainingHighSeconds")
	if remaining==null: return stage+"\nLearning how long new creations take"
	var low=maxi(1,ceili(float(job.get("remainingLowSeconds",0))/60.0))
	var high=maxi(low,ceili(float(remaining)/60.0))
	return stage+"\nAbout %d–%d min left"%[low,high]+(" · early estimate" if int(job.get("sampleCount",0))<3 else " · estimate")

func play_sound(stream:AudioStream,point:Vector3,volume:float):
	if game.smoke or game.diagnostic_offline or not billet.is_visible_in_tree(): return
	var player=audio_players[sound_index%audio_players.size()]
	sound_index+=1
	player.global_position=point
	player.stream=stream
	player.volume_db=volume
	player.play()

func strike():
	strike_count+=1
	var hammer:Node3D=game.scene.brann.get_meta("smith_hammer")
	var point=hammer.to_global(HAMMER_FACE)
	# Coprime step visits all eight timbres without immediate repetition.
	play_sound(impacts[(strike_count*3)%impacts.size()],point,-18.0)
	flourish(point,7,Color("ffbc60"),0.30)
	if strike_count==1: print("FORGE_STRIKE contact_error_m=",point.distance_to(CONTACT)," sound_variants=",impacts.size())

func flourish(point:Vector3,count:int,color:Color,life:float):
	if not game.adventure.zone_groups.forge_yard.is_visible_in_tree(): return
	for i in range(count):
		var spark=game.adventure._box(game.adventure.zone_groups.forge_yard,point,Vector3(0.014,0.014,0.04),color)
		var angle=TAU*i/count+strike_count
		var destination=point+Vector3(cos(angle)*0.20,0.08+0.08*(i%3),sin(angle)*0.20)
		var tween=create_tween().set_parallel(true)
		tween.tween_property(spark,"global_position",destination,life).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tween.tween_property(spark,"scale",Vector3.ZERO,life)
		tween.chain().tween_callback(spark.queue_free)

func present(item:Node3D, key:String):
	if delivered.has(key): return
	delivered[key]=item
	item.set_meta("delivery_ready",false)
	queue.append(key)
	item.visible=false
	item.remove_from_group("pickup")
	game._set_collisions(item,false)
	while finishing or queue[0]!=key: await get_tree().process_frame
	finishing=true
	item.reparent(game.adventure.zone_groups.forge_yard)
	item.position=Vector3(-0.05,1.42,-2.9)
	item.rotation=Vector3(0,0,PI/2)
	game._notice("Brann is putting the finishing touches on "+str(item.get_meta("display_name","your tool"))+".",5)
	print("WORKSHOP_DELIVERY finishing=",key)
	var goal=strike_count+3
	while strike_count<goal: await get_tree().process_frame
	item.visible=true
	flourish(item.global_position,14,Color("a9e9d4"),0.65)
	play_sound(reveal_sound,item.global_position,-14.0)
	revealing=true
	var destination=game.scene.rack.global_position+Vector3((next_slot%4)*0.30-0.45,0.1,floorf(next_slot/4.0)*0.32)
	if game.collection!=null:
		var home=game.collection.ensure_home(str(item.get_meta("id","")),str(item.get_meta("display_name","Your creation")))
		destination=home.stand.global_position+Vector3.UP*0.98
	next_slot+=1
	var full_scale=item.scale
	item.scale=full_scale*0.8
	var tween=create_tween()
	tween.tween_property(item,"global_position",item.global_position+Vector3.UP*0.3,0.35).set_trans(Tween.TRANS_SINE)
	tween.parallel().tween_property(item,"scale",full_scale,0.35)
	tween.tween_property(item,"global_position",destination+Vector3.UP*0.25,1.15).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	tween.parallel().tween_property(item,"rotation",Vector3.ZERO,1.15)
	tween.tween_property(item,"global_position",destination,0.4).set_trans(Tween.TRANS_SINE)
	await tween.finished
	item.add_to_group("pickup")
	game._set_collisions(item,true)
	item.set_meta("delivery_ready",true)
	if game.collection!=null: game.collection.register(item)
	game._notice(str(item.get_meta("display_name","Your tool"))+" is on its named collection stand in the yard. Grip it to collect.",10)
	print("WORKSHOP_DELIVERY bench_ready=",key)
	queue.pop_front()
	revealing=false
	finishing=false
