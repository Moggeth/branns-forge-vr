extends SceneTree
## Offline regression: tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://projectile_attachment_checks.gd
## Exercises embedded projectile poses and both real remains handoff paths, without a save or service.

const Attachments = preload("res://projectile_attachment.gd")
const Guardians = preload("res://guardians/skeleton_guardians.gd")
const Authored = preload("res://guardian_authored_animation.gd")
const Remains = preload("res://physical_remains.gd")
const Structure = preload("res://skeleton_structure.gd")

class FakeAnimation extends Node:
	var actors := {}

class FakeAdventure extends Node:
	var zone := "test"
	var zone_groups := {}

class FakeTuning extends Node:
	func value(_key: String) -> float: return 1.0

class FakeGame extends Node3D:
	var animation: FakeAnimation
	var adventure: FakeAdventure
	var tuning: FakeTuning
	var guardians = null
	var guardian_authored = null
	var skeleton_pose_handoff = null
	var remains = null
	var projectile_attachments = null
	var elapsed := 1.0
	func _owner(node: Node):
		while node != null and node != self:
			if node.has_meta("kind"): return node
			node = node.get_parent()
		return null

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var started := Time.get_ticks_usec()
	var failures := []
	var game := FakeGame.new()
	root.add_child(game)
	game.animation = FakeAnimation.new()
	game.add_child(game.animation)
	game.adventure = FakeAdventure.new()
	game.add_child(game.adventure)
	game.adventure.zone_groups.test = game
	game.tuning = FakeTuning.new()
	game.add_child(game.tuning)
	game.projectile_attachments = Attachments.new()
	game.projectile_attachments.setup(game)
	game.remains = Remains.new()
	game.add_child(game.remains)
	game.remains.setup(game)
	_rigid_surface(game, failures)
	_imported_bones(game, failures)
	_shatter_handoff(game, failures)
	_detach_handoff(game, failures)
	await process_frame
	print("PROJECTILE_ATTACHMENT_RESULT ", JSON.stringify({"failures":failures,"duration_ms":snappedf((Time.get_ticks_usec()-started)*0.001,0.001)}))
	quit(0 if failures.is_empty() else 5)

func _rigid_surface(game: FakeGame, failures: Array) -> void:
	var surface := Node3D.new()
	game.add_child(surface)
	surface.global_transform = Transform3D(Basis(Vector3.UP,0.41),Vector3(1.2,1.4,-0.8))
	var bolt := Node3D.new()
	game.add_child(bolt)
	bolt.global_transform = Transform3D(Basis(Vector3.RIGHT,0.34)*Basis(Vector3.UP,-0.2),surface.to_global(Vector3(0.08,-0.02,0.03)))
	var original: Transform3D = bolt.global_transform
	var entry: Dictionary = game.projectile_attachments.bind(bolt,surface)
	if entry.is_empty() or entry.get("surface") != surface or not entry.has("local"):
		failures.append("rigid binding omitted its surface/local pose")
		return
	if not _near_pose(bolt.global_transform,original): failures.append("rigid bolt snapped while embedding")
	surface.global_transform = Transform3D(Basis(Vector3.UP,-0.7)*Basis(Vector3.FORWARD,0.23),Vector3(-2.1,1.8,0.7))
	if not game.projectile_attachments.update(entry): failures.append("moving rigid surface lost its bolt")
	if not _near_pose(bolt.global_transform,surface.global_transform*entry.local): failures.append("rigid bolt failed translation/rotation follow")
	if _near_pose(bolt.global_transform,original): failures.append("rigid bolt did not move with its target")
	game.projectile_attachments.release(bolt)
	if game.projectile_attachments.entries.has(entry): failures.append("recovered bolt retained an attachment entry")
	var recovered := Transform3D(Basis(Vector3.UP,0.82),Vector3(2.2,0.4,1.3))
	bolt.global_transform = recovered
	surface.position += Vector3(0.4,0.3,-0.2)
	game.projectile_attachments.tick()
	if not _near_pose(bolt.global_transform,recovered): failures.append("recovered bolt was dragged by its old target")
	surface.queue_free()
	bolt.queue_free()

func _imported_bones(game: FakeGame, failures: Array) -> void:
	var guardians := Guardians.new()
	game.add_child(guardians)
	guardians.setup(game)
	game.guardians = guardians
	var authored := Authored.new()
	game.add_child(authored)
	authored.setup(game)
	game.guardian_authored = authored
	var actor := Node3D.new()
	game.add_child(actor)
	actor.set_meta("kind","enemy")
	actor.set_meta("enemy_type","skeleton")
	actor.set_meta("zone","test")
	var scene := load("res://guardians/rigged/mossward_rig.glb") as PackedScene
	if scene == null:
		failures.append("imported Mossward fixture unavailable")
		return
	var visual := scene.instantiate()
	actor.add_child(visual)
	var skeleton: Skeleton3D = authored._find_skeleton(visual)
	var head: MeshInstance3D = authored._find_mesh(visual,"Head")
	if skeleton == null or head == null:
		failures.append("imported Mossward skull or skeleton unavailable")
		return
	var bones := {}
	for bone_name in ["Head","LeftArm","RightArm","LeftLeg","LeftKnee","LeftFoot"]:
		bones[bone_name] = authored._bone_index(skeleton,bone_name)
	var entry := {"visual":visual,"skeleton":skeleton,"shattered":false,"guardian":{"state":"dropped"},
		"part_meshes":{"head":head,"arm_l":authored._find_mesh(visual,"LeftArm"),"leg_l":authored._find_mesh(visual,"LeftLeg")},
		"bones":bones,"shield":null}
	authored.entries[actor.get_instance_id()] = entry
	var bone: int = int(bones.Head)
	var skin: Transform3D = skeleton.global_transform*skeleton.get_bone_global_pose(bone)*skeleton.get_bone_global_rest(bone).affine_inverse()*skeleton.global_transform.affine_inverse()
	var center: Vector3 = (skin*head.global_transform*head.mesh.get_aabb()).get_center()
	var contact: Dictionary = guardians.projectile_contact(actor,center+Vector3(0,0,1),center+Vector3(0,0,-1))
	if contact.get("part","") != "head" or not contact.get("surface") is BoneAttachment3D:
		failures.append("weighted imported skull ray missed its bone attachment")
		return
	var bolt := Node3D.new()
	game.add_child(bolt)
	bolt.global_transform = Transform3D(Basis(Vector3.RIGHT,0.35),contact.position-contact.normal*0.025)
	var before: Transform3D = bolt.global_transform
	var incoming := Vector3(0,0,-1)
	var depth := 0.025
	var bound: Dictionary = game.projectile_attachments.bind(bolt,contact.surface,{"collider":actor,"part":"head","position":contact.position,"normal":contact.normal,"direction":incoming,"penetration_depth":depth})
	if not _near_pose(bolt.global_transform,before): failures.append("skull bolt lost its penetration pose")
	if bound.get("actor") != actor or bound.get("part","") != "head" or str(bound.get("bone_name","")) == "":
		failures.append("weighted skull binding lost actor/part/bone identity")
	if not bound.has("impact_local") or not bound.has("entry_direction_local") or not bound.has("penetration_depth"):
		failures.append("skull bolt lost contact and penetration metadata")
	else:
		var first_pose: Transform3D = skeleton.global_transform*skeleton.get_bone_global_pose(skeleton.find_bone(str(bound.bone_name)))
		if (first_pose*bound.impact_local).distance_to(contact.position)>0.002 or (first_pose.basis*bound.entry_direction_local).normalized().distance_to(incoming)>0.002 or absf(float(bound.penetration_depth)-depth)>0.0001:
			failures.append("skull bolt contact metadata disagreed with impact geometry")
	var old: Transform3D = bolt.global_transform
	skeleton.set_bone_pose_rotation(bone,Quaternion(Vector3.UP,0.44))
	skeleton.force_update_all_bone_transforms()
	game.projectile_attachments.update(bound)
	if _near_pose(bolt.global_transform,old): failures.append("weighted skull bolt did not follow a bone turn")
	var live_head_pose: Transform3D = skeleton.global_transform*skeleton.get_bone_global_pose(skeleton.find_bone(str(bound.bone_name)))
	if not _near_pose(bolt.global_transform,live_head_pose*bound.local): failures.append("weighted skull bolt lost local penetration/orientation")
	# A skinned forearm should select an actual bone, not a fixed actor-space point.
	var arm: MeshInstance3D = entry.part_meshes.arm_l
	if arm != null and arm.skin != null:
		var arm_bone: int = int(bones.LeftArm)
		var triangle: Dictionary = _weighted_triangle(arm,skeleton,"LeftArm")
		if triangle.is_empty():
			failures.append("weighted imported forearm triangles unavailable")
			return
		guardians._authored_query_frame = -1
		var arm_hit: Dictionary = guardians.projectile_contact(actor,triangle.center+triangle.normal*0.035,triangle.center-triangle.normal*0.035)
		if arm_hit.get("part","") == "arm_l" and arm_hit.get("surface") is BoneAttachment3D:
			var forearm := Node3D.new()
			game.add_child(forearm)
			forearm.global_position = arm_hit.position-arm_hit.normal*0.02
			var forearm_entry: Dictionary = game.projectile_attachments.bind(forearm,arm_hit.surface,{"collider":actor,"part":"arm_l"})
			var forearm_before: Transform3D = forearm.global_transform
			skeleton.set_bone_pose_rotation(arm_bone,Quaternion(Vector3.FORWARD,0.32))
			skeleton.force_update_all_bone_transforms()
			game.projectile_attachments.update(forearm_entry)
			if _near_pose(forearm.global_transform,forearm_before): failures.append("weighted forearm bolt did not follow arm bone")
		else:
			failures.append("weighted imported forearm ray missed limb")
	# Death replaces skinned art with a baked head mesh. The bolt must leave its
	# BoneAttachment3D and travel with that physical skull at the latest pose.
	var joint := Node3D.new()
	joint.name = "head"
	actor.add_child(joint)
	joint.position = Vector3(0,1.5,0)
	var piece := Node3D.new()
	joint.add_child(piece)
	var display := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.14,0.4,0.13)
	_visual_mesh(box,display,piece)
	var rig := {"homes":[{"piece":piece,"parent":joint,"transform":piece.transform}],"pieces":[piece],"joints":{"head":joint},"type":"skeleton"}
	game.animation.actors[actor.get_instance_id()] = rig
	entry.rig = rig
	game.skeleton_pose_handoff = preload("res://skeleton_pose_handoff.gd").new()
	game.add_child(game.skeleton_pose_handoff)
	game.skeleton_pose_handoff.setup(game)
	skeleton.set_bone_pose_rotation(bone,Quaternion(Vector3.UP,0.66))
	skeleton.force_update_all_bone_transforms()
	var last_bone_pose: Transform3D = skeleton.global_transform*skeleton.get_bone_global_pose(skeleton.find_bone(str(bound.bone_name)))
	var expected_skull: Transform3D = last_bone_pose*bound.local
	var expected_impact: Vector3 = last_bone_pose*bound.impact_local
	var expected_direction: Vector3 = (last_bone_pose.basis*bound.entry_direction_local).normalized()
	game.remains.shatter(actor)
	var skull: RigidBody3D = _find_remain(game,actor,"head")
	if skull == null or skull.get_node_or_null("AuthoredDetached_head") == null:
		failures.append("authored death did not bake a physical skull")
	else:
		if bound.get("surface") != skull or not _near_pose(bolt.global_transform,expected_skull):
			failures.append("authored skull bolt snapped or stayed on hidden living rig")
		if (skull.global_transform*bound.impact_local).distance_to(expected_impact)>0.002 or (skull.global_basis*bound.entry_direction_local).normalized().distance_to(expected_direction)>0.002 or absf(float(bound.penetration_depth)-depth)>0.0001:
			failures.append("authored skull handoff lost impact point, entry direction or depth")
		skull.freeze = true
		skull.global_transform = Transform3D(Basis(Vector3.UP,-0.27),Vector3(-0.35,0.1,0.7))*skull.global_transform
		game.projectile_attachments.update(bound)
		if not _near_pose(bolt.global_transform,skull.global_transform*bound.local): failures.append("authored skull bolt did not follow baked remain")
	actor.queue_free()

func _shatter_handoff(game: FakeGame, failures: Array) -> void:
	var fixture: Dictionary = _piece_actor(game,"head",Vector3(0,1.55,0))
	var actor: Node3D = fixture.actor
	var source: Node3D = fixture.piece
	var bolt := Node3D.new()
	game.add_child(bolt)
	bolt.global_transform = Transform3D(Basis(Vector3.RIGHT,0.3),source.to_global(Vector3(0.025,0.06,-0.04)))
	var entry: Dictionary = game.projectile_attachments.bind(bolt,source,{"collider":actor,"part":"head"})
	# Let the living part turn after impact. Death must use its current pose even
	# when the projectile manager has not ticked since that turn.
	source.rotation.y = 0.42
	source.position.x = 0.08
	var before: Transform3D = source.global_transform*entry.local
	game.remains.shatter(actor)
	var skull: RigidBody3D = _find_remain(game,actor,"head")
	if skull == null:
		failures.append("shatter produced no tagged skull")
		return
	if not (entry.get("surface") == skull or skull.is_ancestor_of(entry.get("surface"))) or not _near_pose(bolt.global_transform,before): failures.append("shatter failed to transfer skull bolt without a snap")
	skull.freeze = true
	skull.global_transform = Transform3D(Basis(Vector3.UP,0.38),Vector3(0.8,1.4,-0.5))*skull.global_transform
	game.projectile_attachments.update(entry)
	if not _near_pose(bolt.global_transform,entry.surface.global_transform*entry.local): failures.append("skull bolt did not follow loose skull")

func _detach_handoff(game: FakeGame, failures: Array) -> void:
	var fixture: Dictionary = _piece_actor(game,"leg_l",Vector3(-0.18,0.48,0))
	var actor: Node3D = fixture.actor
	var source: Node3D = fixture.piece
	var foot_source := Node3D.new()
	foot_source.name = "LeftFoot"
	source.add_child(foot_source)
	foot_source.position.y = -0.18
	var bolt := Node3D.new()
	game.add_child(bolt)
	bolt.global_transform = Transform3D(Basis(Vector3.FORWARD,0.19),source.to_global(Vector3(0.02,-0.12,0.01)))
	var entry: Dictionary = game.projectile_attachments.bind(bolt,source,{"collider":actor,"part":"leg_l"})
	var foot_bolt := Node3D.new()
	game.add_child(foot_bolt)
	foot_bolt.global_transform = Transform3D(Basis(Vector3.LEFT,0.16),foot_source.to_global(Vector3(0.01,-0.025,0)))
	var foot_entry: Dictionary = game.projectile_attachments.bind(foot_bolt,foot_source,{"collider":actor,"part":"leg_l"})
	source.rotation.x = -0.33
	var before: Transform3D = source.global_transform*entry.local
	var foot_before: Transform3D = foot_source.global_transform*foot_entry.local
	var structure := Structure.new()
	game.add_child(structure)
	structure.setup(game)
	var result: Dictionary = structure.hit(actor,actor.to_global(Vector3(-0.18,0.48,0)),Vector3.LEFT,5.2,"blunt")
	var leg: RigidBody3D = result.get("item")
	if not result.get("detached",false) or leg == null:
		failures.append("heavy leg hit produced no detached body")
		return
	if not (entry.get("surface") == leg or leg.is_ancestor_of(entry.get("surface"))) or not _near_pose(bolt.global_transform,before): failures.append("detachment failed to transfer leg bolt without a snap")
	if not _near_pose(foot_bolt.global_transform,foot_before): failures.append("detachment snapped foot bolt")
	if not leg.get_meta("articulated_leg",false): failures.append("detached leg lost its articulation")
	if entry.get("surface") != leg.get_node_or_null("SpringKnee"):
		failures.append("lower leg bolt did not transfer onto the spring knee")
	if foot_entry.get("surface") != leg.get_node_or_null("SpringKnee/SpringAnkle"):
		failures.append("foot bolt did not transfer onto the spring ankle")
	leg.freeze = true
	leg.global_transform = Transform3D(Basis(Vector3.UP,-0.28),Vector3(-0.4,0.4,0.7))*leg.global_transform
	game.projectile_attachments.update(entry)
	if not _near_pose(bolt.global_transform,entry.surface.global_transform*entry.local): failures.append("leg bolt did not follow detached articulated body")
	var knee_before: Transform3D = bolt.global_transform
	var ankle_before: Transform3D = foot_bolt.global_transform
	leg.angular_velocity = Vector3(8,0,0)
	game.remains._tick_leg_joints(0.1)
	game.projectile_attachments.update(entry)
	game.projectile_attachments.update(foot_entry)
	if absf(leg.get_node("SpringKnee").rotation.x) < 0.01 or _near_pose(bolt.global_transform,knee_before):
		failures.append("leg bolt did not follow a real spring knee update")
	if absf(leg.get_node("SpringKnee/SpringAnkle").rotation.x) < 0.005 or _near_pose(foot_bolt.global_transform,ankle_before):
		failures.append("foot bolt did not follow a real spring ankle update")

func _piece_actor(game: FakeGame, part: String, joint_position: Vector3) -> Dictionary:
	var actor := Node3D.new()
	game.add_child(actor)
	actor.set_meta("enemy_type","skeleton")
	actor.set_meta("kind","enemy")
	actor.set_meta("alive",true)
	actor.set_meta("zone","test")
	var joint := Node3D.new()
	joint.name = part
	actor.add_child(joint)
	joint.position = joint_position
	var piece := Node3D.new()
	joint.add_child(piece)
	var display := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.14,0.42,0.13)
	_visual_mesh(box,display,piece)
	var homes := [{"piece":piece,"parent":joint,"transform":piece.transform}]
	var joints := {}
	joints[part] = joint
	game.animation.actors[actor.get_instance_id()] = {"homes":homes,"pieces":[piece],"joints":joints,"type":"skeleton"}
	return {"actor":actor,"piece":piece}

func _visual_mesh(box: BoxMesh, display: MeshInstance3D, piece: Node3D) -> void:
	display.mesh = box
	piece.add_child(display)

func _weighted_triangle(mesh: MeshInstance3D, skeleton: Skeleton3D, prefix: String) -> Dictionary:
	var baker := preload("res://skeleton_pose_handoff.gd").new()
	var posed: ArrayMesh = baker._bake(mesh,skeleton,Transform3D.IDENTITY)
	baker.free()
	var binds := []
	for bind in range(mesh.skin.get_bind_count()):
		var name: String = mesh.skin.get_bind_name(bind)
		if name == "": name = skeleton.get_bone_name(mesh.skin.get_bind_bone(bind))
		if name.begins_with(prefix): binds.append(bind)
	var choice := {}
	var best_score := 0.0
	for surface in range(posed.get_surface_count()):
		var rest: Array = mesh.mesh.surface_get_arrays(surface)
		var vertices: PackedVector3Array = posed.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]
		var indices: PackedInt32Array = rest[Mesh.ARRAY_INDEX]
		var bone_ids: PackedInt32Array = rest[Mesh.ARRAY_BONES]
		var weights: PackedFloat32Array = rest[Mesh.ARRAY_WEIGHTS]
		var influences := 8 if mesh.mesh.surface_get_format(surface) & Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS else 4
		for offset in range(0,indices.size()-2,3):
			var ids := [int(indices[offset]),int(indices[offset+1]),int(indices[offset+2])]
			var score := 0.0
			for vertex in ids:
				for influence in range(influences):
					var slot: int = vertex*influences+influence
					if slot < bone_ids.size() and bone_ids[slot] in binds: score += weights[slot]/3.0
			if score <= best_score: continue
			var a: Vector3 = vertices[ids[0]]
			var b: Vector3 = vertices[ids[1]]
			var c: Vector3 = vertices[ids[2]]
			var normal: Vector3 = (b-a).cross(c-a).normalized()
			if normal.length_squared() < 0.5: continue
			best_score = score
			choice = {"center":(a+b+c)/3.0,"normal":normal}
	return choice if best_score > 0.8 else {}

func _find_remain(game: FakeGame, actor: Node3D, part: String) -> RigidBody3D:
	for candidate in game.remains.bodies:
		if is_instance_valid(candidate) and candidate.get_meta("source_actor",-1) == actor.get_instance_id() and candidate.get_meta("skeleton_part","") == part:
			return candidate
	return null

func _near_pose(a: Transform3D, b: Transform3D) -> bool:
	return a.origin.distance_to(b.origin)<0.002 and a.basis.x.distance_to(b.basis.x)<0.002 and a.basis.y.distance_to(b.basis.y)<0.002 and a.basis.z.distance_to(b.basis.z)<0.002
