extends SceneTree
## Save-isolated native GPU review: installed terrain, crater, crystals and effects.
## --xr-mode off --audio-driver Dummy --path godot --script res://starfall_visual_review.gd
##   -- --world-builder-check --landscape-seed=290929
const Meteor = preload("res://landscape_meteor.gd")
const OUTPUT := "res://../outputs/starfall-review"
var failures: Array[String] = []
var started := Time.get_ticks_usec()
var game: Node3D
var builder: Node
var view: SubViewport
var survey: Camera3D
var files: Array[String] = []
var performance_samples: Array[Dictionary] = []

func _initialize() -> void:
	if DisplayServer.get_name()=="headless" or not OS.get_cmdline_user_args().has("--world-builder-check"):
		push_error("Starfall review requires native GPU and save-isolated --world-builder-check")
		quit(2)
		return
	create_timer(60.0).timeout.connect(func() -> void: push_error("Starfall review timed out"); quit(2))
	call_deferred("_run")

func _run() -> void:
	root.unfocusable=true
	root.position=Vector2i(-12000,-12000)
	root.size=Vector2i(1280,800)
	root.content_scale_size=Vector2i.ZERO
	root.content_scale_mode=Window.CONTENT_SCALE_MODE_DISABLED
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUTPUT))
	game=load("res://main.tscn").instantiate()
	root.add_child(game)
	# Safe travel may wait for the first collider broadphase publication.
	for index in 24:
		if game.adventure.zone=="orchard_highlands" and not game.adventure.travelling: break
		await create_timer(0.05).timeout
	game.set_process(false)
	game.set_physics_process(false)
	Input.mouse_mode=Input.MOUSE_MODE_VISIBLE
	if not game.diagnostic_offline or game.adventure.zone!="orchard_highlands":
		failures.append("offline Orchard unavailable")
		_finish()
		return
	builder=game.world_builder
	game.adventure.hp=9999
	for child in game.get_children():
		if child is CanvasLayer: child.visible=false
	view=SubViewport.new()
	view.size=Vector2i(1280,800)
	view.world_3d=game.get_world_3d()
	view.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	root.add_child(view)
	survey=Camera3D.new()
	survey.fov=54.0
	view.add_child(survey)
	survey.current=true
	var site:=Vector2(-78,35)
	var ground:float=game.landscape.height_at(site)
	var world:Vector3=builder.center+Vector3(site.x,ground,site.y)
	game.camera.global_position=world+Vector3(0,2.0,7.5)
	game.camera.look_at(world+Vector3.UP*1.0)
	survey.global_position=world+Vector3(10,16,12)
	survey.look_at(world)
	await _frames(6)
	var record:Dictionary=Meteor.make_record(site,421,ground)
	record.id="visual-review-meteor"
	record.phase="falling"
	builder.data.meteors.append(record)
	builder._render_meteor(record,true)
	var meteor:Node3D=builder.meteor_nodes[record.id]
	meteor.set_process(false)
	meteor.advance(0.8)
	builder.starfall_presentation.tick(1.0/120.0)
	game.camera.global_position=world+Vector3(0,2.0,11)
	game.camera.look_at(meteor.core.global_position+Vector3.UP*2.0)
	await _pair("01-entry")
	meteor.advance(0.3)
	builder.starfall_presentation.tick(1.0/120.0)
	game.camera.look_at(world+Vector3.UP*1.0)
	await _pair("02-descent")
	meteor.advance(0.15)
	await physics_frame
	for index in 4: builder.starfall_presentation.tick(1.0/120.0)
	await _pair("03-contact")
	for index in 36: builder.starfall_presentation.tick(1.0/120.0)
	await _pair("04-spall-dust")
	for index in 180: builder.starfall_presentation.tick(1.0/120.0)
	await _pair("05-crystal-reveal")
	for index in 570: builder.starfall_presentation.tick(1.0/120.0)
	await create_timer(0.2).timeout
	world=meteor.global_position
	game.camera.global_position=world+Vector3(0,2.0,6.2)
	game.camera.look_at(world+Vector3.UP*1.0)
	survey.global_position=world+Vector3(8,10,9)
	survey.look_at(world)
	await _pair("06-meteor-day")
	builder.data.star_gems=2
	builder.data.mana=20.0
	var error:String=builder.cast_prism_fault(Vector3(-71,0,40),Vector3(-49,0,40))
	if not error.is_empty(): failures.append("fault: "+error)
	game.landscape._finish_transition()
	await create_timer(1.7).timeout
	var fault_record:Dictionary=game.landscape.dressing._records.back()
	var fault_world:Vector3=Vector3.ZERO
	for anchor in fault_record.anchors: fault_world+=anchor.node.global_position
	fault_world/=maxi(1,fault_record.anchors.size())
	game.camera.global_position=fault_world+Vector3(0,1.7,7.2)
	game.camera.look_at(fault_world+Vector3.UP*0.7)
	survey.global_position=fault_world+Vector3(15,13,16)
	survey.look_at(fault_world)
	builder.starfall_presentation.next_sources=0.0
	for index in 60: builder.starfall_presentation.tick(1.0/120.0)
	await _pair("07-fault-day")
	var sun:=game.get_node("AdventureSun") as DirectionalLight3D
	var env:Environment=game.get_world_3d().environment
	sun.light_energy=0.16
	sun.light_color=Color("a0acff")
	env.ambient_light_energy=0.3
	env.background_mode=Environment.BG_COLOR
	env.background_color=Color("0d1225")
	env.fog_light_color=Color("252748")
	await _pair("08-fault-dusk")
	game.camera.global_position=world+Vector3(0,2.0,6.2)
	game.camera.look_at(world+Vector3.UP*1.0)
	survey.global_position=world+Vector3(8,10,9)
	survey.look_at(world)
	builder.starfall_presentation.next_sources=0.0
	for index in 60: builder.starfall_presentation.tick(1.0/120.0)
	await _pair("09-meteor-dusk")
	await _benchmark(world)
	_finish()

func _frames(count:int) -> void:
	for index in count: await process_frame
	await RenderingServer.frame_post_draw

func _pair(label:String) -> void:
	await _frames(5)
	for shot in [[root,label+"-ground.png"],[view,label+"-survey.png"]]:
		var path:String=ProjectSettings.globalize_path(OUTPUT).path_join(shot[1])
		if shot[0].get_texture().get_image().save_png(path)!=OK: failures.append("capture "+shot[1])
		files.append(path)

func _benchmark(world:Vector3) -> void:
	# Fixed dual 1280x800 views. Draw readbacks happen only outside timing windows.
	var hero_rid:RID=root.get_viewport_rid()
	var survey_rid:RID=view.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(hero_rid,true)
	RenderingServer.viewport_set_measure_render_time(survey_rid,true)
	for stress in [false,true]:
		var meteors:Array[Node3D]=[]
		if stress:
			for index in 6:
				var at:=world+Vector3((index%3-1)*9,0,-floorf(index/3.0)*9)
				var m:=Meteor.new()
				game.add_child(m)
				m.setup(Meteor.make_record(Vector2.ZERO,9900+index,0),false)
				m.global_position=at
				builder.starfall_presentation.watch_meteor(m)
				m.visual_event.emit({"phase":"impact","seed":9900+index})
				m.visual_event.emit({"phase":"crystal_reveal","seed":9900+index})
				meteors.append(m)
		await _frames(12)
		var cpu:Array[float]=[]
		var hero_gpu:Array[float]=[]
		var survey_gpu:Array[float]=[]
		var begin:=Time.get_ticks_usec()
		while Time.get_ticks_usec()-begin<1200000:
			var t:=Time.get_ticks_usec()
			builder.starfall_presentation.tick(1.0/120.0)
			cpu.append((Time.get_ticks_usec()-t)/1000.0)
			await process_frame
			hero_gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(hero_rid))
			survey_gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(survey_rid))
		performance_samples.append({"six_simultaneous_impacts":stress,"effects_cpu_p95_ms":_p95(cpu),"hero_gpu_p95_ms":_p95(hero_gpu),"survey_gpu_p95_ms":_p95(survey_gpu),"frames":cpu.size()})
		if stress: await _pair("10-six-impact-stress")
		for meteor in meteors: meteor.queue_free()
		await process_frame
	RenderingServer.viewport_set_measure_render_time(hero_rid,false)
	RenderingServer.viewport_set_measure_render_time(survey_rid,false)

func _p95(values:Array[float]) -> float:
	values.sort()
	return snappedf(values[mini(ceili(values.size()*.95)-1,values.size()-1)],0.01) if not values.is_empty() else 0.0

func _finish() -> void:
	var report:Dictionary={"failures":failures,"captures":files,"performance":performance_samples,"seconds":(Time.get_ticks_usec()-started)/1000000.0,"scope":"Installed offline Orchard; dual 1280x800 desktop Vulkan views, not a headset/4K guarantee."}
	var file:=FileAccess.open(OUTPUT+"/review.json",FileAccess.WRITE)
	if file!=null: file.store_string(JSON.stringify(report,"\t"))
	print("STARFALL_VISUAL_REVIEW ",JSON.stringify(report))
	if is_instance_valid(game): game.queue_free()
	if is_instance_valid(view): view.queue_free()
	await process_frame
	quit(0 if failures.is_empty() else 1)
