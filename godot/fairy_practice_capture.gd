extends SceneTree
func _initialize(): run.call_deferred()
func run():
	Engine.max_fps=120
	var game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game.adventure.travel("forge_yard"); game._start_fairy()
	var fairy=game.fairy; fairy.test_mode=true; fairy._focus_lost(); fairy.practice.start()
	game.hud.get_parent().hide()
	var board=fairy.practice.board
	fairy.camera.global_position=board.global_position+Vector3(0,.1,1.2); fairy.camera.look_at(board.global_position)
	var folder=ProjectSettings.globalize_path("user://reviews/fairy-practice")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture-output="): folder=arg.trim_prefix("--capture-output=")
	DirAccess.make_dir_recursive_absolute(folder)
	for i in range(40): await process_frame
	await RenderingServer.frame_post_draw
	fairy.window.get_texture().get_image().save_png(folder+"/practice.png")
	var viewport=fairy.window.get_viewport_rid(); RenderingServer.viewport_set_measure_render_time(viewport,true)
	var gpu=[]; var frames=[]; var last=Time.get_ticks_usec()
	for i in range(240):
		await process_frame; await RenderingServer.frame_post_draw
		var now=Time.get_ticks_usec()
		if i>=60:
			gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(viewport)); frames.append((now-last)/1000.0)
		last=now
	gpu.sort(); frames.sort()
	var result={"device":RenderingServer.get_video_adapter_name(),"resolution":str(fairy.window.size),"samples":180,"gpu_median_ms":gpu[90],"gpu_p95_ms":gpu[171],"frame_median_ms":frames[90],"frame_p95_ms":frames[171],"scope":"Exported solo desktop, both host and fairy windows, 120fps cap; not VR or action-heavy combat."}
	var out=FileAccess.open(folder+"/performance.json",FileAccess.WRITE); out.store_string(JSON.stringify(result,"  ")); out.close()
	print("FAIRY_PRACTICE_CAPTURE_RESULT ",JSON.stringify(result)); quit()
