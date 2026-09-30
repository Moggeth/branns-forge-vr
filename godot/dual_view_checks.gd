extends SceneTree
## Actual-Main, save-free dual-view regression and native-pixel/GPU review.
## Native: --xr-mode off --audio-driver Dummy --path godot --script res://dual_view_checks.gd -- --world-builder-check
const View = preload("res://world_builder_view.gd")
const Layout = preload("res://dual_view_layout.gd")
var failures: Array[String] = []
var reports: Array[Dictionary] = []
var started := Time.get_ticks_usec()
var native := false
var output := "res://../outputs/dual-view-oct1"
const CASES = [
	{"name":"split-960", "size":Vector2i(960,620), "mode":"split", "ratio":0.5, "left":"fps", "primary":true},
	{"name":"split-1280-40", "size":Vector2i(1280,800), "mode":"split", "ratio":0.4, "left":"fps", "primary":true},
	{"name":"split-1920-flipped", "size":Vector2i(1920,1080), "mode":"split", "ratio":0.5, "left":"rts", "primary":false},
	{"name":"split-4k-60", "size":Vector2i(3840,2160), "mode":"split", "ratio":0.6, "left":"fps", "primary":true},
	{"name":"pip-rts", "size":Vector2i(1920,1080), "mode":"pip", "ratio":0.5, "left":"fps", "primary":false},
	{"name":"pip-hero", "size":Vector2i(1920,1080), "mode":"pip", "ratio":0.5, "left":"fps", "primary":true},
]
func _initialize() -> void:
	create_timer(60.0).timeout.connect(func() -> void: printerr("DUAL_VIEW_RESULT timeout=60"); quit(2))
	call_deferred("_run")

func _check(condition: bool, label: String) -> void:
	if not condition: failures.append(label)

func _run() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		printerr("DUAL_VIEW_RESULT requires --world-builder-check for save isolation"); quit(2); return
	native = DisplayServer.get_name() != "headless"
	root.unfocusable = true
	root.position = Vector2i(-12000,-12000)
	root.size = Vector2i(1280,800)
	root.content_scale_size = Vector2i.ZERO
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	Engine.max_fps = 120
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	await game.adventure.travel("orchard_highlands")
	_check(game.diagnostic_offline,"offline save isolation")
	var landing: Dictionary = game.respawn_recovery.find(game.world_builder.center + Vector3(18,0,-21))
	_check(not landing.is_empty(),"clear supported Orchard eye-height review position")
	if not landing.is_empty(): game.rig.global_position = landing.feet
	game.camera.position = Vector3(0,1.65,0)
	var aim := Vector2(15,-32)
	game.camera.look_at(game.world_builder.center + Vector3(aim.x,game.landscape.height_at(aim)+1.1,aim.y))
	game.desktop_pitch = game.camera.rotation.x
	game.shield_until = game.elapsed + 60.0
	print("DUAL_REVIEW_POSE ",game.camera.global_position)
	var original_size := root.content_scale_size
	var original_mode := root.content_scale_mode
	var original_factor := root.content_scale_factor
	var original_scale: float = root.scaling_3d_scale
	var view: Window = View.new()
	view.visible = false
	game.add_child(view)
	game.world_builder_view = view
	view.setup(game,game.world_builder)
	view._advance_arrival(view.ARRIVAL_SECONDS)
	view.overlay.modulate.a = 1.0
	view.hero_input_requested.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed: reports.append({"forwarded_mouse":true}))
	_check(view.render_scale == 1.0,"native RTS default")
	_check(view.tactical_viewport.world_3d == game.get_world_3d(),"same authoritative World3D")
	_check(not native or (view.unfocusable and view.position.x < -10000),"native diagnostic does not cover or focus resident game: focusable=%s position=%s" % [not view.unfocusable, view.position])
	for spec in CASES:
		_configure(view,spec)
		await _settle(view)
		var fps_rect: Rect2 = view.pane_layout.fps
		var rts_rect: Rect2 = view.pane_layout.rts
		var wanted: Vector2i = Layout.viewport_size(fps_rect)
		_check(root.content_scale_size == wanted,"%s Hero viewport config" % spec.name)
		_check(root.get_texture().get_size() == Vector2(wanted),"%s actual Hero texture pixels: %s vs %s" % [spec.name,root.get_texture().get_size(),wanted])
		_check(view.tactical_viewport.size == Vector2i(rts_rect.size),"%s actual RTS viewport pixels" % spec.name)
		_check(root.scaling_3d_scale == 1.0,"%s full Hero 3D scale" % spec.name)
		_check(view.hero_pip.get_children().filter(func(n: Node) -> bool: return n is SubViewport or n is Camera3D).is_empty(),"%s no third camera" % spec.name)
		_check(view.command_panel.global_position == rts_rect.position,"%s panel origin" % spec.name)
		_check(view.command_panel.size == rts_rect.size,"%s panel bounded to RTS" % spec.name)
		_check(view.hero_pip.get_index() < view.command_panel.get_index(),"%s secondary picture cannot cover RTS controls" % spec.name)
		if native:
			var quick_button := Rect2()
			for button in view.view_chrome.hit_boxes:
				_check(button.rect.end.x <= view.size.x,"%s toolbar clipped: %s" % [spec.name,button.id])
				if button.id == "quickcast": quick_button = button.rect
			_check(quick_button.has_area(),"%s visible quick-cast toggle" % spec.name)
			if quick_button.has_area():
				var previous_quick: bool = view.quick_cast_enabled
				var toggle := InputEventMouseButton.new()
				toggle.pressed = true
				toggle.button_index = MOUSE_BUTTON_LEFT
				toggle.position = quick_button.get_center()
				view.view_chrome._gui_input(toggle)
				_check(view.quick_cast_enabled != previous_quick and view.view_chrome.quick_cast_enabled == view.quick_cast_enabled,"%s toggle routes and redraws" % spec.name)
				view.set_quick_cast(previous_quick)
		if spec.mode == "split":
			_check(not fps_rect.intersects(rts_rect),"%s panes do not overlap" % spec.name)
			_check(view.hero_pip.split_mode,"%s full split content" % spec.name)
			_check(view.command_panel.visible,"%s RTS controls survive Hero focus" % spec.name)
			var before_focus: bool = view.hero_focus
			var rect_before: Rect2 = view.pane_layout.fps
			var tab := InputEventKey.new()
			tab.keycode = KEY_TAB
			tab.pressed = true
			view._route_input(tab)
			_check(view.hero_focus != before_focus and view.pane_layout.fps == rect_before,"%s Tab focus without layout change" % spec.name)
			view._view_command("flip")
			# An odd usable width has one unavoidable rounding pixel when mirroring.
			_check(absf(view.pane_layout.fps.size.x-fps_rect.size.x)<=1.0,"%s flip preserves pane size" % spec.name)
			view._view_command("flip")
		# Chrome/panel clicks must never become weapon clicks.
		var mouse := InputEventMouseButton.new()
		mouse.button_index = MOUSE_BUTTON_LEFT
		mouse.pressed = true
		mouse.position = Vector2(12,12)
		var report_count := reports.size()
		view._route_input(mouse)
		_check(reports.size()==report_count,"%s toolbar click did not fire" % spec.name)
		reports.append({"case":spec.name,"fps_pixels":root.get_texture().get_size(),"rts_pixels":view.tactical_viewport.size})
	# Keep costly GPU readbacks entirely after frame timing.
	if native:
		for case_index in [2,3]:
			_configure(view,CASES[case_index])
			await _settle(view)
			await create_timer(1.2).timeout
			reports.append(await _sample(view,2.0))
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
		for spec in CASES:
			_configure(view,spec)
			await _settle(view)
			await RenderingServer.frame_post_draw
			var shot: Image = view.get_texture().get_image()
			_check(not shot.is_empty(),"%s nonempty native capture" % spec.name)
			if not shot.is_empty():
				var rts: Rect2 = view.pane_layout.rts
				var fps: Rect2 = view.pane_layout.fps
				for pane in [rts,fps]:
					var at: Vector2i = Vector2i(pane.position+Vector2(pane.size.x*0.5,pane.size.y*0.25))
					var color: Color = shot.get_pixel(at.x,at.y)
					_check(color.r+color.g+color.b>0.03,"%s camera rendered black" % spec.name)
				_check(shot.save_png(output+"/"+str(spec.name)+".png")==OK,"%s capture saved" % spec.name)
		# Inspect the installed authored golem from eye height and RTS in the real Quarry.
		await game.adventure.travel("sandstone_quarry")
		view.tick(0.01)
		var golem: Node3D
		for actor in game.scene.enemies:
			if actor.get_meta("enemy_type","")=="golem" and actor.get_meta("zone","")=="sandstone_quarry": golem=actor; break
		_check(golem!=null,"authored golem exists in real Quarry")
		if golem!=null:
			game.set_process(false)
			game._update_text()
			game.camera.global_position=golem.global_position+golem.global_basis.z*4.4+Vector3.UP*1.6
			game.camera.look_at(golem.global_position+Vector3.UP*1.15)
			view.focus_point=golem.global_position+Vector3.UP
			view.zoom=13.0
			view.arrival_elapsed=view.ARRIVAL_SECONDS
			view._position_camera()
			_configure(view,{"size":Vector2i(1920,1080),"mode":"split","ratio":0.5,"left":"fps","primary":true})
			await _settle(view)
			await RenderingServer.frame_post_draw
			_check(view.get_texture().get_image().save_png(output+"/golem-in-game.png")==OK,"Quarry golem capture")
	view._finish_close()
	await process_frame
	_check(root.content_scale_size==original_size and root.content_scale_mode==original_mode and root.content_scale_factor==original_factor and root.scaling_3d_scale==original_scale,"close restores original Hero rendering")
	# A VR companion must never touch HMD viewport scale or size.
	game.vr=true
	var companion: Window=View.new()
	companion.visible=false
	game.add_child(companion)
	companion.setup(game,game.world_builder)
	companion.layout_mode="split"
	companion._layout_ui()
	companion._sync_hero_resolution()
	_check(root.content_scale_size==original_size and root.scaling_3d_scale==original_scale,"VR companion preserves HMD resolution")
	companion._finish_close()
	await process_frame
	game.queue_free()
	await process_frame
	print("DUAL_VIEW_RESULT ",JSON.stringify({"failures":failures,"reports":reports,"native":native,"seconds":(Time.get_ticks_usec()-started)/1000000.0,"capture":output}))
	quit(0 if failures.is_empty() else 1)

func _configure(view: Window, spec: Dictionary) -> void:
	view.size=spec.size
	view.layout_mode=spec.mode
	view.split_ratio=spec.ratio
	view.split_left=spec.left
	view.hero_primary=spec.primary
	view.hero_focus=spec.primary
	view.preferred_pip_position=Vector2(-1,-1)
	view.preferred_pip_size=Vector2(540,340)
	view.pip_layout_touched=false
	view.clock+=0.10
	view._apply_primary_textures()
	view._sync_hero_resolution()
	view._position_camera()

func _settle(view: Window) -> void:
	for i in 5:
		view.tick(0.01)
		await process_frame
	view.overlay.modulate.a = 1.0
	if native: await RenderingServer.frame_post_draw

func _sample(view: Window, seconds: float) -> Dictionary:
	var frames: Array[float]=[]
	var cpu: Array[float]=[]
	var begin := Time.get_ticks_usec()
	var last := begin
	while (Time.get_ticks_usec()-begin)/1000000.0 < seconds:
		await process_frame
		var now:=Time.get_ticks_usec()
		frames.append((now-last)/1000.0); last=now
		cpu.append(Performance.get_monitor(Performance.TIME_PROCESS)*1000.0)
	frames.sort(); cpu.sort()
	return {"sample_size":view.size,"observed_fps":snappedf(frames.size()*1000000.0/(Time.get_ticks_usec()-begin),0.1),"frame_p95_ms":frames[mini(frames.size()-1,ceili(frames.size()*0.95))],"cpu_p95_ms":cpu[mini(cpu.size()-1,ceili(cpu.size()*0.95))],"scope":"actual offline Main; desktop native renderer; no screenshot readback in sample"}
