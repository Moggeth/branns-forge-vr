extends SceneTree
const Legacy=preload("res://bankshot_checks.gd")
const Gallery=preload("res://lantern_gallery.gd")
class Travel extends Legacy.Travel:
	var clear=true
	var destinations=[]
	func safe_travel(destination):
		if clear: destinations.append(destination)
		return clear
var checks=0
var failures=[]
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func context(id,position=Gallery.LANDING+Vector3.UP*1.7):
	return {"throwId":id,"bounceCount":0,"launchPosition":position,"lastBounceCollider":null,"lastBounceAt":-1.0,"flightAge":.8}
func flight(game,gallery,index):
	var toy=game.playful_tools
	game.camera.position=Gallery.LANDING+Vector3.UP*1.7
	var estimate=(gallery.targets[index].global_position-game.camera.position).length()/9.0
	var destination=Gallery.CENTER+gallery._lantern_position(index,gallery.motion_clock+estimate)
	destination.y+=.55*estimate*estimate-.32*estimate
	game.camera.look_at(destination); game.desktop_hand.global_transform=game.camera.global_transform
	toy._home(); toy.last_camera_position=game.camera.position; toy.mode=1
	check(toy.retrieve(game.desktop_hand) and toy.release(game.desktop_hand),"Actual release starts flight toward moving lantern "+str(index))
	check(toy.velocity.length()>8.9 and toy.velocity.length()<9.2,"Actual flight uses unmodified COURTYARD speed")
	var original=gallery.targets[index].global_position
	var recalled=false
	for step in range(220):
		gallery.tick(1.0/60.0)
		await physics_frame
		toy.tick(1.0/60.0)
		if toy.state=="returning": recalled=true
		if toy.state=="held": break
	check(original.distance_to(gallery.targets[index].global_position)>.02,"Target genuinely moves during swept flight")
	check(recalled and toy.state=="held" and toy.holder==game.desktop_hand,"Lantern collision recalls the single ring into its unoccupied original hand")
	print("LANTERN_FLIGHT index=",index," stage=",gallery.stage," shots=",gallery.shots," bounces=",toy.bounce_count," displacement=",original.distance_to(gallery.targets[index].global_position))
func run():
	var began=Time.get_ticks_usec()
	var game=Legacy.Game.new(); game.living.free(); game.living=Travel.new(); root.add_child(game); game.initialize()
	game.camera.position=Gallery.LANDING+Vector3.UP*1.7; game.desktop_hand.transform=game.camera.transform
	game.playful_tools=preload("res://playful_tools.gd").new(); game.add_child(game.playful_tools); game.playful_tools.setup(game)
	var gallery=Gallery.new(); game.add_child(gallery); gallery.setup(game)
	check(gallery.receiver_ready and not gallery.persistence_enabled and Gallery._valid(gallery.state),"Diagnostic setup registers receiver without touching ordinary saves")
	check(gallery.targets.size()==3 and gallery.label.pixel_size*gallery.label.font_size>=.1,"Three bounded targets and large readable board exist")
	check(not gallery.try_grab(game.desktop_hand),"Stand retrieval rejects distant hands")
	game.desktop_hand.position=gallery.stand.global_position+Vector3.UP*1.15
	game.held[str(game.desktop_hand.get_instance_id())]={"occupied":true}
	check(not gallery.try_grab(game.desktop_hand),"Activity stand cannot steal an occupied hand")
	game.held.clear(); check(gallery.try_grab(game.desktop_hand),"Nearby free hand retrieves existing single Sunskipper")
	game.playful_tools._home()
	gallery.act("start")
	var idle_snapshot=gallery.progress_snapshot()
	await physics_frame
	await flight(game,gallery,2)
	check(gallery.stage==0 and gallery.shots==1 and gallery.active,"Real wrong-target flight consumes an attempt and recalls without advancing")
	check(game.notices.any(func(message):return "That was" in message and "AMBER SUN" in message),"Wrong hit explicitly names both hit and requested shape")
	check(gallery.progress_snapshot()==idle_snapshot,"An unfinished/wrong round changes no durable achievement")
	gallery.act("retry")
	for stage in range(6):
		await flight(game,gallery,Gallery.PARADE[stage])
		check(gallery.stage==stage+1,"Authentic default flight advances announced call "+str(stage+1))
	check(not gallery.active and gallery.state.medal and gallery.state.completions==1 and gallery.state.bestShots==6,"Six moving lantern flights earn medal with genuine six-throw best")
	var earned=gallery.progress_snapshot(); earned.bestShots=100
	check(gallery.state.bestShots==6,"Public progress snapshot cannot mutate achievements")
	gallery.act("retry")
	check(gallery.active and gallery.stage==0 and gallery.shots==0 and gallery.state.bestShots==6,"Retry preserves earned medal and best while resetting live attempts")
	var count=gallery.last_throw+10
	var event=context(count); gallery.on_throw(event); gallery.on_throw(event)
	check(gallery.shots==1,"Duplicate on_throw counts only one authentic attempt")
	gallery.hit_target(gallery.targets[0],gallery.targets[0].global_position,Vector3.FORWARD*9,event)
	gallery.hit_target(gallery.targets[0],gallery.targets[0].global_position,Vector3.FORWARD*9,event)
	check(gallery.stage==1,"A throw identity can advance at most once")
	var outside=context(count+1,Gallery.CENTER); gallery.on_throw(outside)
	gallery.hit_target(gallery.targets[2],gallery.targets[2].global_position,Vector3.FORWARD*9,outside)
	check(gallery.stage==1 and gallery.shots==1,"Off-lane release cannot earn progress or count as an attempt")
	var foreign=StaticBody3D.new(); game.add_child(foreign)
	check(not gallery.hit_target(foreign,Vector3.ZERO,Vector3.FORWARD*9,event),"Unrelated collider leaves existing Bellworks fallback available")
	var stale=context(count+2); gallery.on_throw(stale); gallery.act("retry")
	gallery.hit_target(gallery.targets[0],gallery.targets[0].global_position,Vector3.FORWARD*9,stale)
	check(gallery.stage==0 and gallery.shots==0,"Retry rejects an in-flight throw from the previous round")
	gallery.act("abandon"); check(not gallery.active and gallery.state.medal,"Abandon retains completed achievements")
	gallery.act("start"); game.living.clear=false; gallery.act("leave")
	check(gallery.active,"Obstructed travel does not silently abandon the current round")
	game.living.clear=true; gallery.act("leave")
	check(not gallery.active and game.living.destinations.back()==Vector3(120,0,70),"Safe leave ends live round and uses ordinary safe travel")
	gallery.act("start"); game.camera.position=Gallery.CENTER+Vector3(40,1.7,0); gallery.tick(.1)
	check(not gallery.active,"External departure safely abandons stale scoring state")
	var good=gallery.progress_snapshot(); gallery.active=true; gallery.stage=2; gallery.shots=8; gallery.current_throw=count+3; gallery.motion_clock=9
	check(gallery.restore_progress(good) and not gallery.active and gallery.stage==0 and gallery.shots==0 and gallery.current_throw==-1 and gallery.motion_clock==0,"Restore clears all live round/throw/motion fields")
	check(gallery.targets[0].position==gallery._lantern_position(0,0),"Restore resets moving targets to their authored parade phase")
	for bad in [null,[],"bad"]: check(not Gallery._valid(bad),"Wrong durable payload type rejected safely")
	for pair in [["revision",NAN],["revision",INF],["revision",100000001],["completions",1000001],["completions",.5],["bestShots",5],["bestShots",1000001],["bestShots","6"],["medal",false]]:
		var invalid=good.duplicate(true); invalid[pair[0]]=pair[1]
		check(not Gallery._valid(invalid),"Invalid persistent bound rejected: "+str(pair))
	var transient=good.duplicate(true); transient["stage"]=2
	check(not Gallery._valid(transient) and not gallery.restore_progress(transient),"Transient fields never enter durable state")
	var folder=OS.get_environment("TEMP").replace("\\","/").path_join("brann-lantern-gallery-"+str(OS.get_process_id())+"-"+str(Time.get_ticks_usec()))
	DirAccess.make_dir_recursive_absolute(folder); gallery.save_path=folder+"/lantern.json"; gallery.persistence_enabled=true
	check(gallery.save_progress(),"Native standalone save writes only isolated fixture")
	gallery.state.revision+=1; gallery.state.completions=2; check(gallery.save_progress(),"Second completed snapshot preserves a valid recovery backup")
	var loaded=Gallery.new(); loaded.persistence_enabled=true; loaded.save_path=gallery.save_path; loaded.load_progress()
	check(loaded.state.completions==2 and loaded.state.bestShots==6 and not loaded.active,"Fresh module loads achievements only, with no active round")
	var file=FileAccess.open(gallery.save_path,FileAccess.WRITE); file.store_string("broken"); file.close(); loaded.load_progress()
	check(loaded.state.completions==1 and loaded.state.medal,"Corrupt standalone primary recovers validated earned medal backup")
	loaded.free(); game.playful_tools.sound.stop(); await create_timer(.1).timeout
	game.free(); await create_timer(.1).timeout
	print("LANTERN_GALLERY_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
