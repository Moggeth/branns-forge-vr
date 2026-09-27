extends SceneTree
## Offline archive pagination, action routing and optional native capture.
class Facade:
	extends RefCounted
	var inspect_enabled=false
	var requests=[]
	func request_version(entry): requests.append(["retrieve",entry])
	func rollback(id,version): requests.append(["rollback",id,version])
	func publish(package): requests.append(["publish",package.id,package.version])
	func visit_arena(): requests.append(["visit"])
	func safe_travel(destination): requests.append(["travel",destination]); return true
class Feedback:
	extends RefCounted
	func press(_target,_hand): return true
class Fixture:
	extends Node3D
	var diagnostic_offline=true
	var smoke=true
	var adventure={}
	var living=Facade.new()
	var button_feedback=Feedback.new()
	var elapsed=0.0
	func _notice(_message): pass

func _initialize(): call_deferred("_run")

func _run():
	var game=Fixture.new(); root.add_child(game)
	var zone=Node3D.new(); game.add_child(zone); game.adventure={"zone_groups":{"forge_yard":zone}}
	var museum=preload("res://living_museum.gd").new(); game.add_child(museum); museum.setup(game)
	var failures=[]
	museum.checks(failures)
	var history=[]
	for i in range(137):
		history.append({"id":"invention-"+str(i),"version":1,"name":"Invention "+str(i),"kind":"item","entities":[],"links":[],"rules":[],
			"provenance":{"origin":"demo","prompt":"Make a lantern that remembers where it has travelled.","interpretation":"A grabbable crystal lamp with a stored route.","parentIds":[]}})
	var demos=JSON.parse_string(FileAccess.get_file_as_string("res://living_demo_packages.json"))
	museum.sync({"history":history,"catalog":{"demoPackages":demos},"deployments":{}})
	var legacy={"id":"legacy-original","version":1,"kind":"legacy","name":"Original Siegebird"}
	history.append(legacy)
	museum.sync({"history":history,"catalog":{"demoPackages":demos},"deployments":{}})
	var legacy_home=museum.home_order.find(museum.key(legacy))
	var added={"id":"new-package","version":1,"name":"New arrival"}
	history.push_front(added)
	museum.sync({"history":history,"catalog":{"demoPackages":demos},"deployments":{}})
	if museum.home_order.find(museum.key(legacy))!=legacy_home: failures.append("legacy home moved after new package")
	museum.act("next"); museum.act("select:2")
	var expected=museum.entries[8]
	if museum.selected().id!=expected.id: failures.append("archive selection maps to wrong home")
	museum.act("retrieve")
	if game.living.requests[-1][0]!="retrieve" or game.living.requests[-1][1].id!=expected.id: failures.append("retrieval wrong version")
	museum.act("remove")
	if game.living.requests[-1]!=["rollback",expected.id,0]: failures.append("remove must unpublish only selected package")
	museum.act("lens")
	if not game.living.inspect_enabled: failures.append("lens toggle")
	museum.act("visit")
	if game.living.requests[-1]!=["visit"]: failures.append("arena interaction")
	museum.act("enter")
	if game.living.requests[-1]!=["travel",Vector3(-120,0,0)]: failures.append("museum entry")
	museum.act("leave")
	if game.living.requests[-1]!=["travel",Vector3(-9,0,2)]: failures.append("museum exit")
	await museum._publish_demo(demos[-1])
	var publishes=game.living.requests.filter(func(value): return value[0]=="publish")
	if publishes.size()!=3 or publishes[-2][2]!=1 or publishes[-1][2]!=2: failures.append("demo version history/dependencies order")
	if museum.stands.size()!=6: failures.append("unbounded museum exhibit nodes")
	print("LIVING_MUSEUM_RESULT ",JSON.stringify(failures))
	var capture=""
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--museum-capture="): capture=argument.trim_prefix("--museum-capture=")
	if not capture.is_empty():
		history=demos.duplicate(true)
		history[0].name="The Open-Hand Garden"
		museum.sync({"history":history,"catalog":{"demoPackages":demos},"deployments":{}})
		museum.page=0; museum.selected_key=museum.key(demos[0]); museum._refresh()
		var environment=WorldEnvironment.new(); game.add_child(environment); environment.environment=Environment.new()
		environment.environment.background_mode=Environment.BG_COLOR
		environment.environment.background_color=Color("a6c6c8")
		environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
		environment.environment.ambient_light_color=Color("d3e4dc")
		environment.environment.ambient_light_energy=.8
		var sun=DirectionalLight3D.new(); game.add_child(sun); sun.rotation_degrees=Vector3(-50,-30,0)
		var camera=Camera3D.new(); game.add_child(camera); camera.position=museum.root.to_global(Vector3(0,2.6,-4)); camera.look_at(museum.root.to_global(Vector3(0,1.9,12))); camera.current=true; camera.fov=70
		if OS.get_cmdline_user_args().has("--museum-interior"):
			camera.position=museum.root.to_global(Vector3(0,2.0,4.8)); camera.look_at(museum.root.to_global(Vector3(-2.1,1.2,12)))
		for i in range(8): await process_frame
		await RenderingServer.frame_post_draw
		var result=root.get_texture().get_image().save_png(capture)
		print("LIVING_MUSEUM_CAPTURE ",capture," result=",result)
	game.queue_free(); await process_frame
	quit(0 if failures.is_empty() else 1)
