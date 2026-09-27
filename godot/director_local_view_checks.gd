extends SceneTree
## Fast isolated parser and lifecycle check: godot --headless --path godot --script res://director_local_view_checks.gd

const LocalView = preload("res://director_local_view.gd")

class FakeGame extends Node3D:
	var adventure = {"hp": 100.0}
	var camera: Camera3D
	func _ready() -> void:
		camera = Camera3D.new()
		add_child(camera)

class FakeDirector extends Node:
	const ROUND_SECONDS = 150.0
	const LANES = {"west": Vector3(-11, 0, -1), "north": Vector3(0, 0, -11), "east": Vector3(11, 0, -1)}
	var center = Vector3.ZERO
	var phase = "waiting"
	var round_time = 0.0
	var beacons = []
	var warnings = []
	var summons = []
	var commands = []
	func apply_command(command: Dictionary) -> void:
		commands.append(command)
		if command.type == "start": phase = "running"

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var game = FakeGame.new()
	root.add_child(game)
	var director = FakeDirector.new()
	game.add_child(director)
	var view = LocalView.new()
	game.add_child(view)
	view.setup(game, director)
	if view.tactical_viewport.world_3d != game.get_world_3d() or view.camera.get_viewport() != view.tactical_viewport or view.camera.far != 90.0:
		push_error("DIRECTOR_LOCAL_CHECK failed shared world/camera")
		quit(1)
		return
	view.tick(0.016)
	view._on_action_pressed()
	view.tick(1.0)
	view._play_card("wisps", "west")
	view.selected_lane = "east"
	view._cast_hotkey(0)
	view._on_quality_selected(2)
	view._on_refresh_selected(0)
	var frames_before: int = view.requested_frames
	view.tick(0.01)
	view.tick(0.01)
	if view.requested_frames != frames_before:
		push_error("DIRECTOR_LOCAL_CHECK 30 fps cap refreshed early")
		quit(1)
		return
	view.tick(0.02)
	if director.commands.size() != 3 or director.commands[1].lane != "west" or director.commands[2].lane != "east" or view.tactical_viewport.size != Vector2i(640, 400) or view.requested_frames != frames_before + 1:
		push_error("DIRECTOR_LOCAL_CHECK failed command routing")
		quit(1)
		return
	view._on_refresh_selected(2)
	if view.tactical_viewport.render_target_update_mode != SubViewport.UPDATE_ALWAYS:
		push_error("DIRECTOR_LOCAL_CHECK uncapped mode inactive")
		quit(1)
		return
	view._on_refresh_selected(0)
	view.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	director.round_time = 14.0
	view.tick(0.005)
	if not view.status.text.contains("02:16"):
		push_error("DIRECTOR_LOCAL_CHECK UI stopped when 3D paused")
		quit(1)
		return
	if DisplayServer.get_name() != "headless":
		view.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		var first = view.tactical_viewport.get_texture().get_image()
		view.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
		await RenderingServer.frame_post_draw
		var held = view.tactical_viewport.get_texture().get_image()
		if first.is_empty() or first.get_data() != held.get_data():
			push_error("DIRECTOR_LOCAL_CHECK last 3D frame was not retained")
			quit(1)
			return
	view.close()
	await process_frame
	if is_instance_valid(view):
		push_error("DIRECTOR_LOCAL_CHECK failed close lifecycle")
		quit(1)
		return
	print("DIRECTOR_LOCAL_CHECK passed")
	quit(0)
