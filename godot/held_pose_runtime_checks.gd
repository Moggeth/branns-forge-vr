extends SceneTree
## Save-free integration through the real Main, grip, Living and throw paths.
var failures: Array[String] = []
var checks := 0
var game
var metrics := {}
const DT := 1.0 / 90.0
const STRENGTH := 0.65


func _initialize() -> void:
	_run.call_deferred()
	create_timer(45.0).timeout.connect(func():
		push_error("Held-pose integration timed out")
		quit(2))


func check(ok: bool, label: String) -> void:
	checks += 1
	if not ok: failures.append(label)


func steady(hand: XRController3D, strength: float = STRENGTH, active: bool = true) -> void:
	game.held_pose.update_hand(game, hand, DT, strength, active)


func _run() -> void:
	if not OS.get_cmdline_user_args().has("--held-pose-check"):
		push_error("Pass -- --held-pose-check to isolate Main from live services/saves")
		quit(2)
		return
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	game.set_process(false)
	await physics_frame
	game.vr = true
	var left := XRController3D.new()
	var right := XRController3D.new()
	for hand in [left, right]:
		hand.tracker = StringName("left_hand" if hand == left else "right_hand")
		game.rig.add_child(hand)
		game.hands.append(hand)
		var visual := Node3D.new()
		game.hand_socket(hand).add_child(visual)
		hand.set_meta("hand_visual", visual)
	left.position = Vector3(-0.3, 1.35, -0.5)
	right.position = Vector3(0.3, 1.35, -0.5)
	var left_key := str(left.get_instance_id())
	var socket: Node3D = game.hand_socket(left)
	var camera_pose: Transform3D = game.camera.transform
	steady(left)
	check(not socket.is_set_as_top_level() and game.held_pose.states.is_empty(), "empty glove stays raw")
	var axe: Node3D = game.adventure._tool_model("woodland_axe")
	game.add_child(axe)
	game.grips._attach(left, axe)
	steady(left)
	var calibrated := left.global_transform * Transform3D(game._hand_basis(left), Vector3.ZERO)
	check(socket.global_transform.is_equal_approx(calibrated), "pickup is immediate")
	check(socket.is_set_as_top_level(), "socket excludes later raw-parent pose updates")
	var origin: Vector3 = left.position
	var raw_energy := 0.0
	var output_energy := 0.0
	game.adventure.motion[left_key] = {"velocity": Vector3(4, 2, -3), "angular": Vector3(1, 0, 2)}
	game.tuning.sample(left, Vector3(6, 1, -2), Vector3.ONE)
	var motion_before: Dictionary = game.adventure.motion[left_key].duplicate(true)
	var history_before: Array = game.tuning.history[left_key].duplicate(true)
	var tracking_unchanged := true
	for frame in range(270):
		var jitter := 0.0011 * sin(TAU * 37.0 * float(frame) * DT)
		left.position = origin + Vector3(jitter, 0, 0)
		left.rotation.y = deg_to_rad(0.12) * sin(TAU * 34.0 * float(frame) * DT)
		var tracked: Transform3D = left.transform
		steady(left)
		tracking_unchanged = tracking_unchanged and left.transform.is_equal_approx(tracked)
		if frame > 90:
			raw_energy += jitter * jitter
			output_energy += (game.rig.to_local(socket.global_position).x - origin.x) ** 2
	var ratio := sqrt(output_energy / raw_energy)
	metrics.jitter_rms_ratio = ratio
	check(ratio < 0.6, "actual socket damps jitter")
	check(tracking_unchanged, "controller remains raw throughout jitter trace")
	check(game.camera.transform.is_equal_approx(camera_pose), "HMD/camera is never filtered")
	check(game.adventure.motion[left_key] == motion_before and game.tuning.history[left_key] == history_before, "release velocity history remains raw")
	check(axe.get_parent() == socket and axe.transform.is_equal_approx(game.grips.pose_for(axe, left)), "authored item/glove attachment retained")
	var held_pose: Transform3D = socket.global_transform
	var tracked_pose: Transform3D = left.global_transform
	var calibrated_raw := tracked_pose * Transform3D(game._hand_basis(left), Vector3.ZERO)
	check(held_pose.origin.distance_to(calibrated_raw.origin) <= 0.003901, "default offset is bounded to 3.9 mm")
	var before_late_update: Transform3D = socket.global_transform
	var before_late_tracking: Transform3D = left.transform
	left.position.x += 0.002
	check(socket.global_transform.is_equal_approx(before_late_update), "later raw controller update cannot bypass socket steadiness")
	left.transform = before_late_tracking
	var pose_in_rig: Transform3D = game.rig.global_transform.affine_inverse() * held_pose
	var original_rig: Transform3D = game.rig.transform
	game.rig.position += Vector3(20, 3, -15)
	game.rig.rotate_y(PI / 2)
	game.held_pose.refresh(game)
	check(socket.global_transform.is_equal_approx(game.rig.global_transform * pose_in_rig), "teleport/snap applies immediately in rig space")
	game.rig.transform = original_rig
	game.held_pose.refresh(game)
	steady(left, 0.0)
	check(not socket.is_set_as_top_level() and socket.global_transform.is_equal_approx(calibrated_raw), "zero steadiness restores exact calibrated tracking")
	steady(left)
	left.position += Vector3(0.004, 0, 0)
	steady(left)
	steady(left, STRENGTH, false)
	check(not socket.is_set_as_top_level() and not game.held_pose.states.has(left_key), "tracking loss clears stale pose")
	left.position += Vector3(0.3, 0, 0)
	steady(left)
	check(socket.global_position.is_equal_approx(left.global_position), "tracking regained snaps exactly")
	game.grips.adjusting[left_key] = true
	steady(left)
	check(not socket.is_set_as_top_level(), "manual grip calibration stays immediate")
	game.grips.adjusting.erase(left_key)
	steady(left)
	# The production two-hand solver must use the same filtered palm anchors.
	game.held[str(right.get_instance_id())] = axe
	game.grips.bind(right, axe)
	axe.reparent(game)
	steady(right)
	left.position.x += 0.004
	right.position.z += 0.004
	steady(left)
	steady(right)
	game.grips.tick(DT)
	for hand in [left, right]:
		var entry: Dictionary = game.grips.grips[str(hand.get_instance_id())]
		check(axe.to_global(entry.point).distance_to(game.hand_socket(hand).global_position) < 0.008, "two-hand contact uses filtered palm " + str(hand.tracker))
	game.held.erase(str(right.get_instance_id()))
	game.grips.grips.erase(str(right.get_instance_id()))
	axe.reparent(socket)
	axe.transform = game.grips.pose_for(axe, left)
	# A real release inherits the visible pose and the existing raw throw estimate.
	var expected_launch: Vector3 = game.tuning.estimate(history_before, motion_before.velocity)
	var expected_release_pose: Transform3D = axe.global_transform
	game.adventure.release(left)
	var body = axe.get_meta("drop_body", null)
	check(is_instance_valid(body) and body.linear_velocity.is_equal_approx(expected_launch), "physical throw uses unfiltered release velocity")
	check(axe.global_transform.is_equal_approx(expected_release_pose), "physical release preserves visible pose")
	game.held_pose.refresh(game)
	check(not socket.is_set_as_top_level(), "empty hand resumes raw tracking on release")
	# Managed props do not all appear in game.held.
	var matchbox := Node3D.new()
	matchbox.set_meta("kind", "fire_supply")
	socket.add_child(matchbox)
	steady(left)
	check(game.held_pose.states.has(left_key), "separately owned matchbox is steadied")
	check(game.held_pose.mass_for(matchbox, left) < game.held_pose.mass_for(axe, left), "light prop and heavy weapon have distinct weight")
	matchbox.reparent(game)
	steady(left)
	var arrow := Node3D.new()
	game.add_child(arrow)
	game.archery.nocked = {"hand": left, "node": arrow}
	left.set_meta("archery_arrow", true)
	steady(left)
	check(game.held_pose.states.has(left_key), "nocked draw hand still uses steady socket")
	game.archery.nocked = {}
	left.set_meta("archery_arrow", false)
	steady(left)
	var bolt: Node3D = game.siegebird.make_bolt()
	bolt.reparent(socket)
	steady(left)
	check(game.held_pose.mass_for(bolt, left) == 0.08 and game.held_pose.states.has(left_key), "managed crossbow bolt has light perceived weight")
	bolt.reparent(game)
	steady(left)
	# Actual declarative held creation: its offset must remain calibrated, while
	# its velocity estimator and a climb anchor stay raw.
	var engine = game.living.components
	var fixture = engine.build({"id": "steadiness-fixture", "schema": 1, "version": 1, "kind": "region", "region": {"origin": [0, 10, 0]}, "entities": [
		{"id": "prop", "shape": "box", "color": "aa8866", "position": [0, 0, 0], "size": [0.2, 0.2, 0.2], "static": false, "components": [{"type": "grabbable", "config": {"mass": 4}}]},
		{"id": "climb", "shape": "box", "color": "aa8866", "position": [0, 0, 0], "size": [1, 1, 1], "static": true, "components": [{"type": "climbable", "config": {}}]}
	]}, game)
	check(fixture.errors.is_empty(), "valid runtime creation fixture: " + str(fixture.errors))
	if not fixture.errors.is_empty():
		game.free()
		print("HELD_POSE_RUNTIME_RESULT ", JSON.stringify({"checks": checks, "failures": failures, "metrics": metrics}))
		quit(1)
		return
	var prop: Dictionary = fixture.entities.prop
	check(engine._hold_entry(prop, left), "runtime creation can be grabbed")
	steady(left)
	left.position.x += 0.003
	steady(left)
	engine.tick(DT)
	check(prop.node.global_transform.is_equal_approx(socket.global_transform * engine.held[left_key].offset), "runtime creation follows filtered calibrated offset")
	check(engine.held[left_key].velocity.length() > 0.1, "runtime creation velocity remains raw")
	engine.release(left)
	steady(left)
	check(engine._hold_entry(fixture.entities.climb, left), "climbable can be anchored")
	steady(left)
	check(not socket.is_set_as_top_level(), "climbing stays raw without free-object inertia")
	engine.release(left)
	fixture.root.free()
	# Desktop mouse aim and mock tracked-hand orientation captures stay exact.
	matchbox.reparent(socket)
	game.vr = false
	steady(left)
	check(not socket.is_set_as_top_level(), "FPS does not filter XR fixture poses")
	check(game.hand_socket(game.desktop_hand) == game.desktop_hand, "desktop input path remains unchanged")
	matchbox.reparent(game)
	# Time the complete per-hand adapter, including ownership and scene writes.
	game.vr = true
	game.held[left_key] = matchbox
	var started := Time.get_ticks_usec()
	for frame in range(10000):
		left.position.x = origin.x + 0.001 * sin(float(frame))
		steady(left)
	metrics.adapter_us_per_hand = float(Time.get_ticks_usec() - started) / 10000.0
	game.held.erase(left_key)
	steady(left)
	game.vr = false
	game.free()
	print("HELD_POSE_RUNTIME_RESULT ", JSON.stringify({"checks": checks, "failures": failures, "metrics": metrics}))
	quit(0 if failures.is_empty() else 1)
