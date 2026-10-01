extends SceneTree
## Fast offline regression: Godot --headless --path godot --script res://skeleton_projectile_contact_checks.gd
## Runs the actual Siegebird ray/attachment fixture without loading a player save.
const Siegebird=preload("res://siegebird_runtime.gd")
const Guardians=preload("res://guardians/skeleton_guardians.gd")
const Authored=preload("res://guardian_authored_animation.gd")
const BoneContact=preload("res://skeleton_projectile_contact.gd")

class Zone:
	var zone:="test"
	var zone_groups:={}

class AnimationStore:
	var actors:={}

class Tuning:
	func value(key: String) -> float:
		return 120.0 if key=="crossbow.bolt_lifetime" else 20.0

class Game extends Node3D:
	var scene:={"enemies":[]}
	var adventure:=Zone.new()
	var animation:=AnimationStore.new()
	var tuning:=Tuning.new()
	var guardians=null
	var guardian_authored=null
	var enemy_contacts
	var elapsed:=0.0
	func _owner(node: Node):
		while node!=null and node!=self:
			if node.has_meta("kind"): return node
			node=node.get_parent()
		return null

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var game:=Game.new()
	root.add_child(game)
	game.adventure.zone_groups[game.adventure.zone]=game
	game.enemy_contacts=preload("res://enemy_projectile_contact.gd").new()
	game.enemy_contacts.setup(game)
	var system:=Siegebird.new()
	game.add_child(system)
	system.game=game
	var failures:=[]
	await system.projectile_checks(failures)
	_authored_head_check(game,failures)
	for variant in ["mossward","prismwatch","cinderkeep"]:
		await _bent_leg_check(game,failures,variant)
	_envelope_checks(game,failures)
	await process_frame
	print("SKELETON_PROJECTILE_RESULT ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 5)

func _authored_head_check(game: Game, failures: Array) -> void:
	var guardians:=Guardians.new()
	game.add_child(guardians)
	guardians.setup(game)
	game.guardians=guardians
	var authored:=Authored.new()
	game.add_child(authored)
	authored.setup(game)
	game.guardian_authored=authored
	var actor:=Node3D.new()
	game.add_child(actor)
	var visual=(load("res://guardians/rigged/mossward_rig.glb") as PackedScene).instantiate()
	actor.add_child(visual)
	var skeleton:Skeleton3D=authored._find_skeleton(visual)
	var head:MeshInstance3D=authored._find_mesh(visual,"Head")
	var bone:int=authored._bone_index(skeleton,"Head")
	if skeleton==null or head==null or bone<0:
		failures.append("authored guardian head fixture unavailable")
		return
	var entry:={"visual":visual,"skeleton":skeleton,"shattered":false,"guardian":{"state":"dropped"},"part_meshes":{"head":head},"bones":{"Head":bone},"shield":null}
	authored.entries[actor.get_instance_id()]=entry
	var pose:Transform3D=skeleton.get_bone_global_pose(bone)
	var rest:Transform3D=skeleton.get_bone_global_rest(bone)
	var skin:Transform3D=skeleton.global_transform*pose*rest.affine_inverse()*skeleton.global_transform.affine_inverse()
	var bounds:AABB=skin*head.global_transform*head.mesh.get_aabb()
	var center:Vector3=bounds.get_center()
	var hit:Dictionary=guardians.projectile_contact(actor,center+Vector3(0,0,1),center+Vector3(0,0,-1))
	if hit.get("part","")!="head" or not hit.get("surface") is BoneAttachment3D:
		failures.append("authored guardian skull missed posed bone triangles")
	actor.queue_free()

func _bent_leg_check(game: Game, failures: Array, variant: String) -> void:
	var actor:=Node3D.new()
	game.add_child(actor)
	var authored:Node=game.guardian_authored
	var guardians:Node=game.guardians
	var visual=(load("res://guardians/rigged/"+variant+"_rig.glb") as PackedScene).instantiate()
	actor.add_child(visual)
	var skeleton:Skeleton3D=authored._find_skeleton(visual)
	var leg:MeshInstance3D=authored._find_mesh(visual,"LeftLeg")
	var hip:int=authored._bone_index(skeleton,"LeftLeg")
	var knee:int=authored._bone_index(skeleton,"LeftKnee")
	var foot:int=authored._bone_index(skeleton,"LeftFoot")
	if leg==null or hip<0 or knee<0 or foot<0:
		failures.append(variant+" weighted lower-leg fixture unavailable")
		return
	var entry:={"visual":visual,"skeleton":skeleton,"shattered":false,"guardian":{"state":"dropped"},
		"part_meshes":{"leg_l":leg},"bones":{"LeftLeg":hip,"LeftKnee":knee,"LeftFoot":foot},"shield":null}
	authored.entries[actor.get_instance_id()]=entry
	skeleton.set_bone_pose_rotation(knee,Quaternion(Vector3.RIGHT,0.72))
	skeleton.force_update_all_bone_transforms()
	var baker:Node=preload("res://skeleton_pose_handoff.gd").new()
	var posed: ArrayMesh=baker._bake(leg,skeleton,Transform3D.IDENTITY)
	baker.free()
	var triangle:=_lower_leg_triangle(leg,posed,skeleton)
	if triangle.is_empty():
		failures.append(variant+" weighted lower-leg triangles unavailable")
		actor.queue_free()
		return
	var center:Vector3=triangle.center
	var normal:Vector3=triangle.normal
	guardians._authored_query_frame=-1
	var first_started:=Time.get_ticks_usec()
	var hit:Dictionary=guardians.projectile_contact(actor,center+normal*0.035,center-normal*0.035)
	var first_ms:float=(Time.get_ticks_usec()-first_started)*0.001
	var cached_started:=Time.get_ticks_usec()
	for repetition in range(10): guardians.projectile_contact(actor,center+normal*0.035,center-normal*0.035)
	var cached_ms:float=(Time.get_ticks_usec()-cached_started)*0.0001
	print("SKELETON_PROJECTILE_COST variant=",variant," first_ms=",snappedf(first_ms,0.001)," cached_ms_each=",snappedf(cached_ms,0.001))
	if hit.get("part","")!="leg_l": failures.append(variant+" bent lower leg missed actual weighted triangles")
	if guardians.projectile_contact(actor,center+Vector3.LEFT*0.45+normal*0.035,center+Vector3.LEFT*0.45-normal*0.035).get("part","")=="leg_l":
		failures.append(variant+" empty space beside bent lower leg accepted a hit")
	var attachment:BoneAttachment3D=hit.get("surface")
	if attachment==null or not attachment.bone_name.begins_with("LeftKnee") and not attachment.bone_name.begins_with("LeftFoot"):
		failures.append(variant+" embedded lower-leg bolt attached to hip instead of knee/foot")
	else:
		var embedded_local:Vector3=attachment.to_local(hit.position)
		var before:Vector3=attachment.to_global(embedded_local)
		skeleton.set_bone_pose_rotation(knee,Quaternion(Vector3.RIGHT,1.04))
		skeleton.force_update_all_bone_transforms()
		await process_frame
		if attachment.to_global(embedded_local).distance_to(before)<0.01:
			failures.append(variant+" embedded lower-leg attachment did not follow knee bend")
	actor.set_meta("skeleton_missing_leg_l",true)
	guardians._authored_query_frame=-1
	if guardians.projectile_contact(actor,center+normal*0.035,center-normal*0.035).get("part","")=="leg_l":
		failures.append(variant+" missing authored leg still accepted projectile")
	actor.queue_free()

func _lower_leg_triangle(source: MeshInstance3D, posed: ArrayMesh, skeleton: Skeleton3D) -> Dictionary:
	var skin:Skin=source.skin
	if skin==null: return {}
	var lower_binds:=[]
	for bind in range(skin.get_bind_count()):
		var name:=skin.get_bind_name(bind)
		if name=="": name=skeleton.get_bone_name(skin.get_bind_bone(bind))
		if name.begins_with("LeftKnee") or name.begins_with("LeftFoot"): lower_binds.append(bind)
	var choice:={}
	var best_score:=0.0
	for surface in range(posed.get_surface_count()):
		var rest:Array=source.mesh.surface_get_arrays(surface)
		var vertices:PackedVector3Array=posed.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]
		var indices:PackedInt32Array=rest[Mesh.ARRAY_INDEX]
		var bones:PackedInt32Array=rest[Mesh.ARRAY_BONES]
		var weights:PackedFloat32Array=rest[Mesh.ARRAY_WEIGHTS]
		var influences:=8 if source.mesh.surface_get_format(surface) & Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS else 4
		for offset in range(0,indices.size()-2,3):
			var ids:=[int(indices[offset]),int(indices[offset+1]),int(indices[offset+2])]
			var score:=0.0
			for vertex in ids:
				for influence in range(influences):
					var slot:int=vertex*influences+influence
					if slot<bones.size() and bones[slot] in lower_binds: score+=weights[slot]/3.0
			if score<=best_score: continue
			var v0:Vector3=vertices[ids[0]]
			var v1:Vector3=vertices[ids[1]]
			var v2:Vector3=vertices[ids[2]]
			var normal:Vector3=(v1-v0).cross(v2-v0).normalized()
			if normal.length_squared()<0.5: continue
			best_score=score
			choice={"center":(v0+v1+v2)/3.0,"normal":normal}
	return choice if best_score>0.80 else {}

func _envelope_checks(game: Node3D, failures: Array) -> void:
	var actor:=Node3D.new()
	actor.set_meta("alive",true)
	game.add_child(actor)
	var arm_joint:=Node3D.new()
	arm_joint.position=Vector3(.3,1.2,0)
	actor.add_child(arm_joint)
	var arm:=Node3D.new()
	arm_joint.add_child(arm)
	var arm_mesh:=MeshInstance3D.new()
	var arm_box:=BoxMesh.new()
	arm_box.size=Vector3(.16,.3,.12)
	arm_mesh.mesh=arm_box
	arm_mesh.position.x=.6
	arm.add_child(arm_mesh)
	var skull:=Node3D.new()
	skull.name="Skull"
	skull.position.y=1.65
	actor.add_child(skull)
	var head_mesh:=MeshInstance3D.new()
	var head_box:=BoxMesh.new()
	head_box.size=Vector3(.25,.25,.22)
	head_mesh.mesh=head_box
	skull.add_child(head_mesh)
	var rig:={"homes":[{"piece":arm},{"piece":skull}],"joints":{"arm_r":arm_joint}}
	var outside:=BoneContact.contact(actor,rig,Vector3(.9,1.2,.6),Vector3(.9,1.2,-.6))
	if outside.get("part","")!="arm_r": failures.append("visible arm beyond interaction box rejected by bone envelope")
	if not BoneContact.contact(actor,rig,Vector3(.4,1.0,.6),Vector3(.4,1.0,-.6)).is_empty():
		failures.append("empty gap acquired bone contact")
	if BoneContact.contact(actor,rig,Vector3(0,1.65,.6),Vector3(0,1.65,-.6)).get("part","")!="head":
		failures.append("skull lost head classification after envelope")
	# A cached envelope remains conservative as the joint rotates in place.
	arm_joint.rotation.y=PI/2.0
	var moved:=arm_mesh.global_position
	if BoneContact.contact(actor,rig,moved+Vector3(0,0,.6),moved+Vector3(0,0,-.6)).is_empty():
		failures.append("animated arm missed cached envelope")
	actor.queue_free()
