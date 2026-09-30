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
	var system:=Siegebird.new()
	game.add_child(system)
	system.game=game
	var failures:=[]
	await system.projectile_checks(failures)
	_authored_head_check(game,failures)
	_envelope_checks(game,failures)
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
