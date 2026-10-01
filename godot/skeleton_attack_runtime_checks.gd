extends SceneTree
## Actual Main, offline and save-isolated. Run:
## Godot --headless --xr-mode off --audio-driver Dummy --path godot
##   --script res://skeleton_attack_runtime_checks.gd -- --world-builder-preview

const WorldZones = preload("res://world_zones.gd")
var failures: Array[String] = []
var facts := {}

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview"):
		push_error("SKELETON_ATTACK_RUNTIME_CHECK requires --world-builder-preview for offline isolation")
		quit(2)
		return
	create_timer(35.0).timeout.connect(func() -> void: printerr("SKELETON_ATTACK_RUNTIME_CHECK timeout"); quit(2))
	call_deferred("_run")

func _run() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	_check(bool(game.diagnostic_offline), "Main did not enter offline mode")
	game.set_process(false)
	game.set_physics_process(false)
	game.adventure.test_mode = true
	game.adventure.zone = "pinewood_ruins"
	if game.fairy != null: game.fairy.active = false
	game.rig.global_position = Vector3(300, 0, 300)
	game.camera.global_position = game.rig.global_position + Vector3.UP * 1.65
	var hero: Vector3 = game.camera.global_position
	var data := {"enemies": []}
	var actor: Node3D = WorldZones.enemy(game, data, "pinewood_ruins", Vector3(hero.x, game.rig.global_position.y, hero.z + 2.4), "skeleton", "mossward")
	actor.rotation.y = PI
	actor.set_meta("hp", 200.0)
	actor.set_meta("max_hp", 200.0)
	actor.set_meta("home", actor.global_position)
	game.animation.register(actor)
	game.guardians.attach(actor, "mossward")
	_check(game.guardian_authored.attach(actor, "mossward"), "actual guardian rig did not attach")
	game.scene.enemies = [actor]
	await physics_frame
	var reach: float = game.skeleton_attack_contact.engagement_distance(actor)
	facts.reach = reach
	_check(reach > 0.8 and reach < 1.4, "measured Mossward reach outside expected range")
	var started_at: Vector3 = actor.global_position
	game.adventure.hp = 100.0
	game.hurts_until = -100.0
	game.shield_until = -100.0
	var began := false
	for frame in range(300):
		_tick(game, 1.0 / 60.0, true)
		if actor.get_meta("combat_phase", "idle") == "windup":
			began = true
			break
	_check(began, "ordinary enemy pursuit never entered authored attack range")
	facts.approach_m = started_at.distance_to(actor.global_position)
	facts.start_distance_m = Vector2(actor.global_position.x - game.camera.global_position.x,
		actor.global_position.z - game.camera.global_position.z).length()
	_check(facts.approach_m > 0.9 and facts.start_distance_m <= reach + 0.05,
		"skeleton did not close to its measured weapon range")
	var root_on_windup: Transform3D = actor.global_transform
	var damage_frames := 0
	for frame in range(190):
		var hp_before: float = game.adventure.hp
		game.hurts_until = -100.0 # Remove ordinary invulnerability as a mask for repeat hits.
		_tick(game, 1.0 / 60.0, true)
		if game.adventure.hp < hp_before: damage_frames += 1
		if bool(actor.get_meta("attack_damage_done", false)) and str(actor.get_meta("combat_phase", "")) == "recovery" and frame > 30:
			break
	facts.damage_frames = damage_frames
	facts.hp_after_swing = game.adventure.hp
	facts.attack_root_planted = root_on_windup.origin.distance_to(actor.global_position) < 0.005
	_check(damage_frames == 1 and game.adventure.hp < 100.0, "one centered authored swing did not damage Hero exactly once")
	_check(bool(actor.get_meta("attack_damage_done", false)), "runtime never latched actual weapon contact")
	_check(bool(facts.attack_root_planted), "skeleton attack displaced its gameplay root")
	# Complete recovery without letting a second attack hide a repeat hit.
	for frame in range(25):
		var hp_before: float = game.adventure.hp
		game.hurts_until = -100.0
		_tick(game, 1.0 / 60.0, false)
		_check(is_equal_approx(game.adventure.hp, hp_before), "same attack repeated damage during recovery")
	# A committed swing continues even after the Hero steps beyond weapon reach.
	actor.set_meta("combat_phase", "idle")
	actor.set_meta("attack_damage_done", true)
	actor.global_position = game.rig.global_position + Vector3(0, 0, reach - 0.04)
	actor.rotation.y = PI
	game.guardian_authored.tick(0.016)
	game.adventure._step_attack(actor, reach - 0.04, "skeleton")
	_check(str(actor.get_meta("combat_phase", "")) == "windup", "nearby dodge fixture did not begin attack")
	game.rig.global_position.z -= 0.75
	game.camera.global_position = game.rig.global_position + Vector3.UP * 1.65
	var hp_before_dodge: float = game.adventure.hp
	for frame in range(110):
		game.hurts_until = -100.0
		_tick(game, 1.0 / 60.0, false)
	_check(is_equal_approx(game.adventure.hp, hp_before_dodge), "target beyond weapon reach took proximity damage")
	# Severe injury and stagger suppress attack initiation even inside range.
	actor.set_meta("combat_phase", "idle")
	actor.set_meta("skeleton_missing_arm_r", true)
	game.adventure._step_attack(actor, 0.5, "skeleton")
	_check(str(actor.get_meta("combat_phase", "")) == "idle", "missing right arm began attack")
	actor.set_meta("skeleton_missing_arm_r", false)
	actor.set_meta("skeleton_stagger_until", game.elapsed + 1.0)
	game.adventure._step_attack(actor, 0.5, "skeleton")
	_check(str(actor.get_meta("combat_phase", "")) == "idle", "staggered skeleton began attack")
	actor.set_meta("skeleton_stagger_until", 0.0)
	# Ordinary impacts alter visible bones while leaving the gameplay root fixed.
	var root_before_hit: Transform3D = actor.global_transform
	game.adventure.hurt_enemy(actor, 3.0, null, Vector3.RIGHT, "physical", actor.global_position + Vector3.UP)
	game.animation.tick(0.016)
	game.guardian_authored.tick(0.016)
	_check(actor.global_transform.is_equal_approx(root_before_hit), "ordinary hit displaced skeleton gameplay root")
	_check(actor.get_meta("alive", true), "ordinary hit unexpectedly killed skeleton")
	facts.root_planted = actor.global_transform.is_equal_approx(root_before_hit)
	# World Builder duelists and Director skeletons use the procedural ActorAnimation
	# rig without guardian art. Their visible right-arm sweep must still hurt.
	var duelist_data := {"enemies": []}
	var duelist: Node3D = WorldZones.enemy(game, duelist_data, "pinewood_ruins",
		Vector3(game.camera.global_position.x, game.rig.global_position.y, game.camera.global_position.z + 2.0), "skeleton")
	duelist.rotation.y = PI
	duelist.set_meta("hp", 200.0)
	duelist.set_meta("home", duelist.global_position)
	game.animation.register(duelist)
	game.scene.enemies = [duelist]
	_check(not game.guardian_authored.entries.has(duelist.get_instance_id()), "ordinary duelist unexpectedly has guardian art")
	var duelist_rig: Dictionary = game.animation.actors[duelist.get_instance_id()]
	var duelist_clip_before: String = (duelist_rig.player as AnimationPlayer).current_animation
	var duelist_segment: Dictionary = game.skeleton_attack_contact._procedural_segment(duelist_rig)
	_check(not duelist_segment.is_empty() and duelist_segment.a.distance_to(duelist_segment.b) > 0.1,
		"procedural right arm has no measurable visible weapon")
	var duelist_reach: float = game.skeleton_attack_contact.engagement_distance(duelist)
	_check((duelist_rig.player as AnimationPlayer).current_animation == duelist_clip_before,
		"reach probe left a temporary clip on a newly registered procedural actor")
	facts.duelist_reach = duelist_reach
	var source: Dictionary = game.skeleton_attack_contact._source(duelist)
	var saved_pose: Dictionary = game.skeleton_attack_contact._save_source(source)
	game.skeleton_attack_contact._seek_source(source, 0.725)
	var sampled: Dictionary = game.skeleton_attack_contact._source_segment(source)
	if not sampled.is_empty():
		facts.duelist_weapon_local_from = duelist.to_local(sampled.a)
		facts.duelist_weapon_local_to = duelist.to_local(sampled.b)
	game.skeleton_attack_contact._restore_source(source, saved_pose)
	_check(duelist_reach >= 0.75 and duelist_reach <= 1.6, "duelist reach invalid")
	game.adventure.hp = 100.0
	game.hurts_until = -100.0
	game.shield_until = -100.0
	var duelist_began := false
	for frame in range(300):
		_tick(game, 1.0 / 60.0, true)
		if str(duelist.get_meta("combat_phase", "idle")) == "windup":
			duelist_began = true
			break
	_check(duelist_began, "ordinary duelist never approached its procedural weapon range")
	var duelist_damage_frames := 0
	for frame in range(190):
		var hp_before: float = game.adventure.hp
		game.hurts_until = -100.0
		_tick(game, 1.0 / 60.0, true)
		if game.adventure.hp < hp_before: duelist_damage_frames += 1
		if bool(duelist.get_meta("attack_damage_done", false)) and str(duelist.get_meta("combat_phase", "")) == "recovery" and frame > 30:
			break
	facts.duelist_damage_frames = duelist_damage_frames
	facts.duelist_hp_after = game.adventure.hp
	_check(duelist_damage_frames == 1 and bool(duelist.get_meta("attack_damage_done", false)),
		"ordinary duelist's visible swing did not hurt Hero exactly once")
	duelist.set_meta("combat_phase", "idle")
	duelist.set_meta("attack_damage_done", true)
	duelist.global_position = game.rig.global_position + Vector3(0, 0, duelist_reach - 0.04)
	duelist.rotation.y = PI
	game.adventure._step_attack(duelist, duelist_reach - 0.04, "skeleton")
	_check(str(duelist.get_meta("combat_phase", "")) == "windup", "ordinary duelist dodge fixture did not begin attack")
	game.rig.global_position.z -= 0.75
	game.camera.global_position = game.rig.global_position + Vector3.UP * 1.65
	var duelist_before_dodge: float = game.adventure.hp
	for frame in range(110):
		game.hurts_until = -100.0
		_tick(game, 1.0 / 60.0, false)
	_check(is_equal_approx(game.adventure.hp, duelist_before_dodge), "ordinary duelist damaged Hero beyond visible right-arm reach")
	duelist.set_meta("combat_phase", "idle")
	duelist.set_meta("skeleton_missing_arm_r", true)
	game.adventure._step_attack(duelist, 0.5, "skeleton")
	_check(str(duelist.get_meta("combat_phase", "")) == "idle", "disarmed duelist began another attack")
	print("SKELETON_ATTACK_RUNTIME_CHECK ", JSON.stringify({"failures": failures, "facts": facts}))
	for failure in failures: push_error(failure)
	quit(0 if failures.is_empty() else 1)

func _tick(game: Node3D, delta: float, chase: bool) -> void:
	game.elapsed += delta
	if chase: game.adventure._enemies(delta)
	else:
		for actor in game.scene.get("enemies", []):
			if is_instance_valid(actor) and str(actor.get_meta("enemy_type", "")) == "skeleton" and actor.has_meta("attack_started"):
				game.adventure._step_attack(actor, INF, "skeleton")
	game.animation.tick(delta)
	game.guardians.tick(delta)
	game.guardian_authored.tick(delta)
	game.adventure.tick_skeleton_contacts()

func _check(ok: bool, message: String) -> void:
	if not ok: failures.append(message)
