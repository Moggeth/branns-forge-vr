extends SceneTree
## Main-scene offline contract for F/G, Map, terrain-aware travel and input gating.
var failures: Array[String] = []
var started := Time.get_ticks_usec()

class FakeFairy:
	extends RefCounted
	var focused := false
	var keys := {}
	var pad_buttons := {}
	var buttons := {}
	var lost := 0
	var captured := 0
	func _focus_lost() -> void:
		lost += 1
	func _capture_mouse() -> void:
		captured += 1

class FakeSurvey:
	extends Window
	var hero_primary := false

func _initialize() -> void:
	_run.call_deferred()

func _check(ok: bool, why: String) -> void:
	if not ok: failures.append(why)

func _key(code: Key) -> InputEventKey:
	var event := InputEventKey.new()
	event.physical_keycode = code
	event.pressed = true
	return event

func _await_travel(game: Node3D) -> void:
	for i in 150:
		if not game.adventure.travelling: return
		await physics_frame

func _blocker(game: Node3D, point: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.set_meta("kind", "solid")
	game.add_child(body)
	body.global_position = point
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(.25, 1.8, .5)
	collision.shape = shape
	body.add_child(collision)
	return body

func _modal_ownership(game: Node3D) -> void:
	var nav = game.travel_navigation
	var fairy_window := Window.new()
	fairy_window.visible = false
	root.add_child(fairy_window)
	var fairy := FakeFairy.new()
	game.archery.desktop_down = true
	game.desktop_swing_started = game.elapsed - .1
	game.desktop_swing_item = game.desktop_hand
	nav.show_for(fairy_window, "map", fairy)
	_check(nav.is_open_for(fairy_window) and not nav.hero_modal_open(),
		"Fairy folio belongs only to its own window")
	_check(game.archery.desktop_down and game.desktop_swing_started >= 0 and not game.archery._blocked(),
		"Fairy folio preserves Hero draw, swing and bow ability")
	var hero_pose: Vector3 = game.rig.global_position
	game.rig.global_position += Vector3.UP
	game.desktop_locomotion.reset()
	var suspended: Vector3 = game.rig.global_position
	game._desktop_input(.1)
	_check(game.rig.global_position.y < suspended.y,
		"Fairy folio does not gate Hero locomotion")
	game.rig.global_position = hero_pose
	game.desktop_locomotion.reset()
	var selected: String = nav.selected
	_check(nav.input_event(_key(KEY_F),fairy_window,fairy) and nav.selected != selected,
		"Fairy folio consumes its own travel input")
	_check(not nav.input_event(_key(KEY_F),game.get_window()),
		"Fairy folio leaves Hero window input available")
	nav.close_all()
	_check(fairy.captured == 1 and not nav.is_open_for(fairy_window),
		"closing Fairy folio restores only Fairy capture")
	var fairy_id := fairy_window.get_instance_id()
	fairy_window.free()
	_check(not nav.views.has(fairy_id), "freed Fairy window removes its folio view")
	var survey := FakeSurvey.new()
	survey.visible = false
	root.add_child(survey)
	var prior_view = game.world_builder_view
	game.world_builder_view = survey
	nav.show_for(survey)
	_check(nav.is_open_for(survey) and not nav.hero_modal_open() and game.archery.desktop_down,
		"strategic RTS folio does not block Hero bow")
	nav.close_all()
	survey.hero_primary = true
	game.archery.desktop_down = true
	game.desktop_swing_started = game.elapsed - .1
	nav.show_for(survey)
	_check(nav.hero_modal_open() and not game.archery.desktop_down and game.desktop_swing_started < 0,
		"Hero-primary RTS folio cancels Hero combat input")
	_check(game.archery._blocked(), "Hero-primary RTS folio blocks bow ability")
	var survey_id := survey.get_instance_id()
	survey.free()
	_check(not nav.any_open() and not nav.views.has(survey_id), "freed RTS window removes open folio view")
	game.world_builder_view = prior_view

func _run() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		push_error("Use isolated --world-builder-check mode")
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	game.set_process(false)
	root.add_child(game)
	await _await_travel(game)
	await physics_frame
	_check(not game.adventure.travelling and game.adventure.zone == "orchard_highlands",
		"initial World Builder startup completes Orchard travel")
	var startup: Dictionary = game.respawn_recovery.find(game.scene.zones.orchard_highlands.spawn)
	_check(not startup.is_empty() and game.respawn_recovery.overlaps(game.camera.global_position - Vector3.UP * game.camera.position.y).is_empty(),
		"initial Orchard landing is supported and clear")
	var nav = game.travel_navigation
	_check(nav != null and nav.selected == "orchard_highlands", "startup target is visible Orchard selection")
	var old_zone: String = game.adventure.zone
	var old_position: Vector3 = game.rig.global_position
	game._unhandled_input(_key(KEY_F))
	nav.next_refresh = 0.0
	nav.tick()
	_check(nav.selected != old_zone and game.adventure.zone == old_zone and game.rig.global_position == old_position,
		"F visibly changes target without travel")
	_check(game.travel_target != null and str(game.travel_target.text).contains(nav.destination_name()),
		"selected destination appears in HUD")
	game._unhandled_input(_key(KEY_G))
	await _await_travel(game)
	_check(game.adventure.zone == nav.selected and game.rig.global_position.distance_to(old_position) > 10.0,
		"G travels to the selected destination")
	old_zone = game.adventure.zone
	old_position = game.rig.global_position
	game._unhandled_input(_key(KEY_M))
	_check(nav.any_open() and nav.hero_modal_open(), "M opens Hero-owned Map")
	var direct := "forge_yard" if old_zone != "forge_yard" else "sandstone_quarry"
	nav.select_destination(direct)
	_check(nav.selected == direct and game.adventure.zone == old_zone and game.rig.global_position == old_position,
		"direct Map selection does not teleport")
	# The folio cancels a draw and gates all Hero controls behind its GUI.
	game.archery.desktop_down = true
	game.desktop_swing_started = game.elapsed - .1
	game.desktop_swing_item = game.desktop_hand
	game.wyrmspout.diagnostic_force_trigger = true
	_check(not game.wyrmspout._pressed(game.desktop_hand), "Map suppresses Wyrmspout trigger")
	var original_pose: Vector3 = game.rig.global_position
	game.rig.global_position += Vector3.UP
	var before: Vector3 = game.rig.global_position
	game._desktop_input(.2)
	game._desktop_weapon_motion(.016)
	game.archery.tick(.016)
	_check(game.rig.global_position == before and game.desktop_swing_started < 0,
		"Map suppresses Hero gravity/motion and active melee")
	_check(not game.archery.desktop_down and game.archery._blocked(), "Map cancels and blocks bow draw")
	game.rig.global_position = original_pose
	game.wyrmspout.diagnostic_force_trigger = false
	game._unhandled_input(_key(KEY_G))
	await _await_travel(game)
	_check(not nav.any_open() and game.adventure.zone == direct, "G executes direct Map target")
	# Raise the original Orchard arrival after startup, leave, then use ordinary
	# travel. This catches the previous under-ground spawn path without death.
	var orchard: Dictionary = game.scene.zones.orchard_highlands
	var local: Vector3 = game.landscape.zone_root.to_local(orchard.spawn)
	var error: String = game.landscape.apply_impact_magic({"type":"raise",
		"center":[local.x,local.z], "radius":12.0, "height":7.5})
	_check(error.is_empty(), "offline Orchard raise accepted")
	await physics_frame
	await game.adventure.travel("orchard_highlands")
	_check(game.adventure.zone == "orchard_highlands" and not game.adventure.travelling,
		"ordinary travel arrives in raised Orchard")
	var landing: Vector3 = game.camera.global_position - Vector3.UP * game.camera.position.y
	var raised_floor: Dictionary = game.respawn_recovery.support(orchard.spawn)
	_check(not raised_floor.is_empty() and landing.y > orchard.spawn.y + 6.0 and game.respawn_recovery.overlaps(landing).is_empty(),
		"travel uses modified floor and clear HMD-aligned capsule")
	# An unavailable destination must leave the previous zone and pose untouched.
	var void_id := "travel_void_fixture"
	game.scene.zones[void_id] = {"name":"Unbuilt Void", "spawn":Vector3(2000,0,2000)}
	before = game.rig.global_position
	await game.adventure.travel(void_id)
	_check(game.adventure.zone == "orchard_highlands" and game.rig.global_position == before and not game.adventure.travelling,
		"unavailable floor fails closed without changing zone or rig")
	game.scene.zones.erase(void_id)
	# The room-scale lateral offset must move the tested body volume away from
	# the rig centre. A narrow blocker misses the ray but overlaps that volume.
	await game.adventure.travel("forge_yard")
	var hmd_local: Vector3 = game.camera.position
	game.camera.position.x += .35
	var lateral: Vector3 = Vector3(game.camera.global_position.x-game.rig.global_position.x,0,
		game.camera.global_position.z-game.rig.global_position.z)
	var destination: Vector3 = game.rig.global_position + Vector3(0,0,-.25)
	var head_feet: Vector3 = destination + lateral
	var blocker := _blocker(game, head_feet + Vector3(.28,.9,0))
	await physics_frame
	_check(game._player_capsule_clear(destination) and not game._player_capsule_clear(head_feet),
		"room-scale fixture blocks HMD-aligned capsule only")
	before = game.rig.global_position
	game._move_to(destination, false)
	_check(game.rig.global_position == before, "VR-style move refuses a blocked HMD-aligned body")
	blocker.queue_free()
	game.camera.position = hmd_local
	_modal_ownership(game)
	print("TRAVEL_NAVIGATION_RESULT ", JSON.stringify({"failures":failures,
		"seconds":float(Time.get_ticks_usec()-started)/1000000.0}))
	quit(0 if failures.is_empty() else 1)
