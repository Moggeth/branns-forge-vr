extends SceneTree
## Offline focused check: --headless --xr-mode off --audio-driver Dummy
## --path godot --script res://golem_checks.gd
const WorldZones = preload("res://world_zones.gd")
const ActorAnimation = preload("res://actor_animation.gd")
const Adventure = preload("res://adventure_runtime.gd")
const Remains = preload("res://physical_remains.gd")
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var fixture := Fixture.new()
	root.add_child(fixture)
	var enemy: Node3D = WorldZones.enemy(fixture, fixture.scene, "sandstone_quarry", Vector3.ZERO, "golem")
	# WorldZones writes construction defaults; AdventureRuntime raises the live
	# encounter's attack damage to 15 during setup.
	enemy.set_meta("damage", 15)
	_check(enemy != null and fixture.scene.enemies.has(enemy), "spawn returns tracked actor")
	_check(enemy.get_meta("loot", {}).get("iron", 0) == 3, "iron reward preserved")
	fixture.animation = ActorAnimation.new()
	fixture.add_child(fixture.animation)
	fixture.animation.setup(fixture)
	var runtime = fixture.animation.golem_runtime
	_check(runtime.entries.has(enemy.get_instance_id()), "every golem binds gameplay")
	if FileAccess.file_exists("res://assets/golem/golem.glb"):
		_check(runtime.entries[enemy.get_instance_id()].art, "installed GLB imported and all six modular parts bound")
		_check(fixture.animation.actors[enemy.get_instance_id()].homes.size() >= 6, "authored parts feed physical remains")
		var core_mesh = runtime.entries[enemy.get_instance_id()].core
		_check(core_mesh is MeshInstance3D, "authored CoreGlow is a mesh")
		if core_mesh is MeshInstance3D:
			var source_material = core_mesh.mesh.surface_get_material(0)
			print("GOLEM_CORE art_name=", core_mesh.name, " scale=", core_mesh.scale,
				" local_position=", enemy.to_local(core_mesh.global_position),
				" bounds=", core_mesh.mesh.get_aabb(),
				" imported_material=", source_material.get_class() if source_material != null else "missing")
			if source_material is StandardMaterial3D:
				print("GOLEM_CORE_TEXTURES albedo=", source_material.albedo_texture != null,
					" normal=", source_material.normal_texture != null, " orm=", source_material.orm_texture != null,
					" emission=", source_material.emission_texture != null)
		var imported_scene: Node3D = load("res://assets/golem/golem.glb").instantiate()
		var unmounted_core: Node3D = imported_scene.find_child("CoreGlow", true, false)
		print("GOLEM_CORE_AUTHORED_SCALE ", unmounted_core.scale if unmounted_core != null else "missing")
		imported_scene.free()
	# Runtime is loaded dynamically by ActorAnimation; type the returned values
	# explicitly so Godot does not attempt to infer a Variant call result.
	var ordinary: float = runtime.filter_hit(enemy, 20.0, null, "physical", enemy.to_global(Vector3(0, 1.2, -0.4)))
	_check(ordinary < 20.0, "intact stone armour reduces an ordinary hit")
	var pick_hand := Node3D.new()
	fixture.add_child(pick_hand)
	var pick := Node3D.new()
	fixture.add_child(pick)
	pick.set_meta("id", "quarry_pick")
	fixture.held[str(pick_hand.get_instance_id())] = pick
	var core_point := enemy.to_global(Vector3(0, 1.27, 0.43))
	var core: float = runtime.filter_hit(enemy, 20.0, pick_hand, "physical", core_point)
	_check(core >= 50.0, "pick deals pronounced core weakpoint damage")
	_check(enemy.get_meta("golem_core_exposed", false), "core exposure is recorded")
	if FileAccess.file_exists("res://assets/golem/golem.glb"):
		var upper_core: float = runtime.filter_hit(enemy, 20.0, pick_hand, "physical", enemy.to_global(Vector3(0, 1.57, 0.43)))
		_check(upper_core >= 50.0, "weakpoint follows the authored core's upper mesh")
		var core_mesh: MeshInstance3D = runtime.entries[enemy.get_instance_id()].core
		var imported: StandardMaterial3D = core_mesh.mesh.surface_get_material(0)
		var exposed: StandardMaterial3D = core_mesh.material_override
		_check(exposed != null and exposed.albedo_texture == imported.albedo_texture, "exposed core keeps authored albedo")
		_check(exposed != null and exposed.normal_texture == imported.normal_texture, "exposed core keeps authored normal map")
		_check(exposed != null and exposed.emission_texture == imported.emission_texture, "exposed core keeps authored glow texture")
	_check(float(enemy.get_meta("golem_stagger_until", 0.0)) > fixture.elapsed, "core strike staggers")
	fixture.elapsed += 2.0
	var before_aimed_break: int = fixture.impact_feedback.contacts
	for i in 3: runtime.filter_hit(enemy, 18.0, pick_hand, "physical", enemy.to_global(Vector3(0.7, 1.35, 0.15)))
	_check(enemy.get_meta("golem_broken_arm_r", false), "localized armour can chip away")
	_check(fixture.impact_feedback.contacts == before_aimed_break, "aimed armour break did not preempt exact pick contact")
	if FileAccess.file_exists("res://assets/golem/golem.glb"):
		_check(runtime.armor_chips.size() == 2, "shoulder and forearm become physical art chunks")
		_check(not runtime.entries[enemy.get_instance_id()].armor_nodes.ShoulderR.visible, "damaged shoulder source closes")
		_check(not runtime.entries[enemy.get_instance_id()].armor_nodes.ForearmR.visible, "damaged forearm source closes")
	_check(absf(float(enemy.get_meta("golem_slam_scale", 0.0)) - 0.8) < 0.001, "broken arm weakens slam")
	runtime.filter_hit(enemy, 18.0, pick_hand, "physical", enemy.to_global(Vector3(-0.2, 0.52, 0.18)))
	_check(enemy.get_meta("golem_broken_leg_l", false), "pick chips leg armour")
	_check(absf(float(enemy.get_meta("golem_move_scale", 0.0)) - 0.75) < 0.001, "broken leg slows pursuit")
	fixture.camera.global_position = Vector3(0, 1.6, 0)
	runtime.begin_slam(enemy, Vector3.ZERO)
	_check(is_instance_valid(runtime.entries[enemy.get_instance_id()].marker), "slam has a ground warning")
	runtime.slam(enemy)
	_check(fixture.adventure.damage_events == 1, "slam lands once inside warning")
	_check(absf(fixture.adventure.last_damage - 12.0) < 0.001, "arm damage reduces slam strength")
	fixture.camera.global_position = Vector3(4, 1.6, 0)
	runtime.begin_slam(enemy, Vector3.ZERO)
	runtime.slam(enemy)
	_check(fixture.adventure.damage_events == 1, "sidestep avoids slam")
	runtime.restore(enemy)
	_check(not enemy.get_meta("golem_broken_arm_r", false), "respawn restores armour")
	_check(not enemy.get_meta("golem_core_exposed", false), "respawn resets weakpoint state")
	if FileAccess.file_exists("res://assets/golem/golem.glb"):
		_check(runtime.entries[enemy.get_instance_id()].armor_nodes.ShoulderR.visible, "respawn restores shoulder plate")
		_check(runtime.entries[enemy.get_instance_id()].armor_nodes.ForearmR.visible, "respawn restores forearm plate")
		_check(runtime.entries[enemy.get_instance_id()].core.material_override == null, "respawn returns authored core material")
	_check(absf(float(enemy.get_meta("golem_slam_scale", 0.0)) - 1.0) < 0.001, "respawn restores arm strength")
	_check(absf(float(enemy.get_meta("golem_move_scale", 0.0)) - 1.0) < 0.001, "respawn restores leg speed")
	fixture.remains = Remains.new()
	fixture.add_child(fixture.remains)
	fixture.remains.setup(fixture)
	var part_count: int = fixture.animation.actors[enemy.get_instance_id()].homes.size()
	if FileAccess.file_exists("res://assets/golem/golem.glb"):
		runtime.filter_hit(enemy, 18.0, pick_hand, "physical", enemy.to_global(Vector3(0.7, 1.35, 0.15)))
	enemy.set_meta("alive", false)
	var before_direct_death: int = fixture.impact_feedback.contacts
	runtime.defeated(enemy, enemy.to_global(Vector3(0.7, 1.35, 0.15)))
	_check(fixture.impact_feedback.contacts == before_direct_death, "direct-contact defeat did not preempt exact pick contact")
	fixture.remains.shatter(enemy, Vector3.UP)
	_check(fixture.remains.bodies.size() >= 6, "death makes modular physical rock fragments")
	if FileAccess.file_exists("res://assets/golem/golem.glb"):
		_check(fixture.remains.bodies.size() == part_count - 2, "death skips already detached armour sources")
	enemy.set_meta("alive", true)
	fixture.animation.restore(enemy)
	_check(fixture.animation.actors[enemy.get_instance_id()].pieces.size() == part_count, "respawn rebuilds modular parts")
	var adventure := Adventure.new()
	fixture.add_child(adventure)
	adventure.game = fixture
	var summoned: Node3D = WorldZones.enemy(fixture, fixture.scene, "sandstone_quarry", Vector3(3, 0, 0), "golem")
	adventure.register_enemy(summoned)
	_check(float(summoned.get_meta("hp", 0)) == 110.0, "dynamic spawn receives standard golem HP")
	_check(fixture.animation.actors.has(summoned.get_instance_id()), "dynamic spawn has animation")
	var before_ambient: int = fixture.impact_feedback.contacts
	runtime.filter_hit(summoned, 99.0, null, "blast", null)
	_check(fixture.impact_feedback.contacts == before_ambient + 1, "unlocated armour break keeps stone feedback")
	runtime.defeated(summoned)
	_check(fixture.impact_feedback.contacts == before_ambient + 1, "same-frame ambient defeat has one stone response")
	var unlocated_death: Node3D = WorldZones.enemy(fixture, fixture.scene, "sandstone_quarry", Vector3(6, 0, 0), "golem")
	adventure.register_enemy(unlocated_death)
	var before_unlocated_death: int = fixture.impact_feedback.contacts
	runtime.defeated(unlocated_death)
	_check(fixture.impact_feedback.contacts == before_unlocated_death + 1, "unlocated defeat without armour break keeps stone feedback")
	if failures.is_empty():
		print("GOLEM_CHECKS_PASS art=", runtime.entries[enemy.get_instance_id()].art, " stone_contacts=", fixture.impact_feedback.contacts)
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)

func _check(condition: bool, message: String) -> void:
	if not condition: failures.append(message)

class Fixture extends Node3D:
	var scene := {"enemies":[], "rats":[]}
	var elapsed := 10.0
	var held := {}
	var hands := []
	var animation
	var remains
	var guardian_authored = null
	var diagnostic_offline := true
	var camera := Node3D.new()
	var rig := Node3D.new()
	var adventure := DamageSink.new()
	var impact_feedback := FeedbackSink.new()
	var fairy = null
	var tuning := Tuning.new()
	var effects := 0
	func _ready() -> void:
		add_child(camera)
		add_child(rig)
		add_child(adventure)
		add_child(impact_feedback)
		add_child(tuning)
	func _effect(_point: Vector3, _color: Color, _duration: float, _size: float) -> void:
		effects += 1
	func _notice(_message: String, _duration: float = 2.0) -> void:
		pass

class DamageSink extends Node:
	var zone := "sandstone_quarry"
	var zone_groups := {}
	var damage_events := 0
	var last_damage := 0.0
	func take_damage(amount: float, _source: String) -> void:
		damage_events += 1
		last_damage = amount
	func haptic(_hand, _event: String) -> void:
		pass

class Tuning extends Node:
	func value(_key: String) -> float:
		return 1.0

class FeedbackSink extends Node:
	var contacts := 0
	func contact(_target, _point: Vector3, _normal: Vector3, _speed: float, _tool: String, material: String) -> bool:
		if material == "stone": contacts += 1
		return true
