extends SceneTree
## Godot --headless --xr-mode off --audio-driver Dummy --path godot
##   --script res://skeleton_attack_contact_checks.gd

const Adapter = preload("res://guardian_authored_animation.gd")
const Contact = preload("res://skeleton_attack_contact.gd")
var failures := []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var game := Fixture.new()
	root.add_child(game)
	var adapter = Adapter.new()
	game.add_child(adapter)
	game.guardian_authored = adapter
	adapter.setup(game)
	var contact = Contact.new()
	contact.setup(game)
	var actor := Node3D.new()
	game.add_child(actor)
	actor.set_meta("alive", true)
	actor.set_meta("enemy_type", "skeleton")
	var legacy := Node3D.new()
	actor.add_child(legacy)
	var old_shield := MeshInstance3D.new()
	actor.add_child(old_shield)
	game.animation.actors[actor.get_instance_id()] = {"pieces": [legacy]}
	game.guardians.guardians[actor.get_instance_id()] = {"state": "loose", "shield": old_shield, "variant": "mossward"}
	if not adapter.attach(actor, "mossward"):
		_fail("authored Mossward GLB missing")
	else:
		var entry: Dictionary = adapter.entries[actor.get_instance_id()]
		adapter._seek(entry, "attack", 0.725)
		var weapon: Dictionary = contact._weapon_segment(entry)
		if weapon.is_empty():
			_fail("no visible weapon segment")
		else:
			var point: Vector3 = weapon.a.lerp(weapon.b, 0.5)
			var far := point + Vector3(0.0, 0.0, 1.2)
			_check(contact._segments_close(weapon.a, weapon.b, point, point + Vector3.UP * 0.1, 0.2), "visible weapon segment contacts target")
			_check(not contact._segments_close(weapon.a, weapon.b, far, far + Vector3.UP * 0.1, 0.2), "nearby target outside weapon misses")
			_check(not contact._segments_close(weapon.a, weapon.b, point - actor.global_basis.z * 2.5, point - actor.global_basis.z * 2.5 + Vector3.UP, 0.2), "target behind skeleton misses")
			actor.set_meta("attack_started", 1.0)
			actor.set_meta("combat_progress", 0.5)
			_check(not contact.contact(actor, point, point + Vector3.UP * 0.1, 0.12), "windup does not hurt")
			actor.set_meta("combat_progress", 0.8)
			# Imitate authored personality/flinch and foot-plant offsets applied
			# after the animation clip was sought for the rendered frame.
			var head_index: int = int(entry.bones.Head)
			entry.skeleton.set_bone_pose_rotation(head_index,
				entry.skeleton.get_bone_pose_rotation(head_index) * Quaternion.from_euler(Vector3(0.12, -0.08, 0.06)))
			entry.visual.position = Vector3(0.03, -0.04, 0.02)
			entry.pose_delta = 0.033
			entry.blend_age = 0.04
			entry.blend_from = entry.base_pose.duplicate(true)
			var saved_base: Array = entry.base_pose.duplicate(true)
			var saved_blend: Array = entry.blend_from.duplicate(true)
			var saved_bones := []
			for index in range(entry.skeleton.get_bone_count()): saved_bones.append(entry.skeleton.get_bone_pose(index))
			var saved_time: float = entry.player.current_animation_position
			var saved_visual: Transform3D = entry.visual.transform
			_check(contact.contact(actor, point, point + Vector3.UP * 0.1, 0.12), "coarse strike crosses visible target")
			for index in range(entry.skeleton.get_bone_count()):
				_check(entry.skeleton.get_bone_pose(index).is_equal_approx(saved_bones[index]), "sample changed rendered bone pose " + str(index))
			_check(is_equal_approx(entry.player.current_animation_position, saved_time), "sample changed animation time")
			_check(entry.visual.transform.is_equal_approx(saved_visual), "sample changed visual flinch/plant")
			_check(entry.base_pose == saved_base and entry.blend_from == saved_blend, "sample changed transition poses")
			_check(is_equal_approx(float(entry.blend_age), 0.04) and is_equal_approx(float(entry.pose_delta), 0.033), "sample advanced transition")
			_check(not contact.contact(actor, point, point + Vector3.UP * 0.1, 0.12), "one hit per attack")
			actor.set_meta("combat_progress", 0.95)
			_check(not contact.contact(actor, point, point + Vector3.UP * 0.1, 0.12), "recovery does not hurt")
			actor.set_meta("attack_started", 2.0)
			actor.set_meta("combat_progress", 0.8)
			_check(not contact.contact(actor, far, far + Vector3.UP * 0.1, 0.1), "full strike misses adjacent target")
			actor.set_meta("attack_started", 3.0)
			actor.set_meta("skeleton_missing_arm_r", true)
			_check(not contact.contact(actor, point, point + Vector3.UP * 0.1, 0.12), "severed right arm cannot attack")
			_check(is_equal_approx(contact.engagement_distance(actor), 0.75), "severed right arm does not retain attack range")
			actor.set_meta("skeleton_missing_arm_r", false)
			actor.set_meta("attack_started", 4.0)
			_check(contact.contact(actor, point, point + Vector3.UP * 0.1, 0.12), "new attack resets hit latch")
			var engagement := contact.engagement_distance(actor)
			var measured: Dictionary = contact.reach_cache[actor.get_instance_id()]
			print("SKELETON_REACH ", JSON.stringify({"variant": "mossward", "reach": measured.reach, "engagement": engagement}))
			_check(engagement >= 0.75 and engagement <= 1.60 and measured.reach > engagement, "Mossward engagement measures a visible reach")
			actor.set_meta("attack_started", 4.1)
			var hero_center := actor.global_position + actor.global_basis.z * engagement
			_check(contact.contact(actor, hero_center + Vector3.UP * 0.30, hero_center + Vector3.UP * 1.70, 0.25), "Mossward reaches centered Hero at engagement distance")
			actor.set_meta("attack_started", 4.2)
			hero_center = actor.global_position + actor.global_basis.z * (engagement + 0.55)
			_check(not contact.contact(actor, hero_center + Vector3.UP * 0.30, hero_center + Vector3.UP * 1.70, 0.25), "Mossward misses centered Hero beyond reach")
			var wall := StaticBody3D.new()
			game.add_child(wall)
			wall.global_position = (actor.global_position + Vector3.UP * 1.12).lerp(point, 0.5)
			var shape := CollisionShape3D.new()
			var sphere := SphereShape3D.new()
			sphere.radius = 0.09
			shape.shape = sphere
			wall.add_child(shape)
			await physics_frame
			actor.set_meta("attack_started", 4.5)
			_check(not contact.contact(actor, point, point + Vector3.UP * 0.1, 0.12), "solid wall blocks apparent weapon contact")
			wall.queue_free()
			await physics_frame
			actor.set_meta("attack_started", 5.0)
			actor.set_meta("combat_progress", 0.65)
			contact.contact(actor, point + Vector3(3, 0, 0), point + Vector3(3, 0.1, 0), 0.12)
			actor.set_meta("combat_progress", 0.8)
			_check(contact.contact(actor, point - Vector3(3, 0, 0), point - Vector3(3, -0.1, 0), 0.12), "moving target crossing strike is hit")
			entry.part_meshes.arm_r.visible = false
			actor.set_meta("attack_started", 6.0)
			_check(not contact.contact(actor, point, point + Vector3.UP * 0.1, 0.12), "hidden right arm has no weapon")
	for variant in ["prismwatch", "cinderkeep"]:
		var other := Node3D.new()
		game.add_child(other)
		other.set_meta("alive", true)
		other.set_meta("enemy_type", "skeleton")
		var part := Node3D.new()
		other.add_child(part)
		var shield := MeshInstance3D.new()
		other.add_child(shield)
		game.animation.actors[other.get_instance_id()] = {"pieces": [part]}
		game.guardians.guardians[other.get_instance_id()] = {"state": "loose", "shield": shield, "variant": variant}
		if not adapter.attach(other, variant):
			_fail("authored rig unavailable: " + variant)
			continue
		var other_entry: Dictionary = adapter.entries[other.get_instance_id()]
		adapter._seek(other_entry, "attack", 0.725)
		var other_weapon: Dictionary = contact._weapon_segment(other_entry)
		if not other_weapon.is_empty(): print("SKELETON_SEGMENT ", variant, " ", other_weapon.a.distance_to(other_weapon.b))
		_check(not other_weapon.is_empty() and other_weapon.a.distance_to(other_weapon.b) > 0.04, "animated weapon segment: " + variant)
		if not other_weapon.is_empty():
			other.set_meta("attack_started", 1.0)
			other.set_meta("combat_progress", 0.8)
			var target: Vector3 = other_weapon.a.lerp(other_weapon.b, 0.5)
			_check(contact.contact(other, target, target + Vector3.UP * 0.1, 0.12), "authored strike contacts: " + variant)
			var engagement := contact.engagement_distance(other)
			var measured: Dictionary = contact.reach_cache[other.get_instance_id()]
			print("SKELETON_REACH ", JSON.stringify({"variant": variant, "reach": measured.reach, "engagement": engagement}))
			_check(measured.reach > engagement and engagement >= 0.75 and engagement <= 1.60, "measured reach: " + variant)
			other.set_meta("attack_started", 2.0)
			var hero := other.global_position + other.global_basis.z * engagement
			_check(contact.contact(other, hero + Vector3.UP * 0.30, hero + Vector3.UP * 1.70, 0.25), "centered Hero within authored strike: " + variant)
			other.set_meta("attack_started", 3.0)
			hero = other.global_position + other.global_basis.z * (engagement + 0.55)
			_check(not contact.contact(other, hero + Vector3.UP * 0.30, hero + Vector3.UP * 1.70, 0.25), "centered Hero beyond authored strike: " + variant)
	var duplicate_actor := Node3D.new()
	game.add_child(duplicate_actor)
	duplicate_actor.set_meta("alive", true)
	duplicate_actor.set_meta("enemy_type", "skeleton")
	var duplicate_part := Node3D.new()
	duplicate_actor.add_child(duplicate_part)
	var duplicate_shield := MeshInstance3D.new()
	duplicate_actor.add_child(duplicate_shield)
	game.animation.actors[duplicate_actor.get_instance_id()] = {"pieces": [duplicate_part]}
	game.guardians.guardians[duplicate_actor.get_instance_id()] = {"state": "loose", "shield": duplicate_shield, "variant": "mossward"}
	if adapter.attach(duplicate_actor, "mossward"):
		var before_profiles: int = contact.profile_reach_cache.size()
		var shared_distance := contact.engagement_distance(duplicate_actor)
		_check(contact.profile_reach_cache.size() == before_profiles and is_equal_approx(shared_distance, contact.reach_cache[actor.get_instance_id()].distance),
			"same imported rig reuses measured reach")
		duplicate_actor.scale = Vector3.ONE * 1.2
		contact.engagement_distance(duplicate_actor)
		_check(contact.profile_reach_cache.size() == before_profiles + 1, "scale change invalidates measured reach")
	else: _fail("duplicate Mossward fixture unavailable")
	if failures.is_empty(): print("SKELETON_ATTACK_CONTACT_PASS")
	else:
		for failure in failures: push_error(failure)
	quit(0 if failures.is_empty() else 1)

func _check(ok: bool, label: String) -> void:
	if not ok: _fail(label)

func _fail(label: String) -> void:
	failures.append(label)

class Fixture extends Node3D:
	var animation = AnimationState.new()
	var guardians = GuardianState.new()
	var guardian_authored
	var elapsed := 1.0
	func _ready() -> void:
		add_child(animation)
		add_child(guardians)

class AnimationState extends Node:
	var actors := {}

class GuardianState extends Node:
	var guardians := {}
