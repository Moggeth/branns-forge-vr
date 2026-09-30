extends SceneTree
## Fast offline regression: Godot --headless --path godot --script res://skeleton_projectile_contact_checks.gd
## Runs the actual Siegebird ray/attachment fixture without loading a player save.
const Siegebird=preload("res://siegebird_runtime.gd")
const Guardians=preload("res://guardians/skeleton_guardians.gd")
const Authored=preload("res://guardian_authored_animation.gd")

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
