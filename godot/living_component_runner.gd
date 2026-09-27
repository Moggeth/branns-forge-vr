extends SceneTree
class FakeActions:
	extends RefCounted
	var falling=false
	var game
	func move_rig(displacement:Vector3)->float:
		var query=PhysicsShapeQueryParameters3D.new(); var capsule=CapsuleShape3D.new(); capsule.radius=.2; capsule.height=1.6; query.shape=capsule; query.collision_mask=1; query.transform=Transform3D(Basis.IDENTITY,game.rig.global_position+Vector3.UP*.87); query.motion=displacement
		var travel=game.get_world_3d().direct_space_state.cast_motion(query); game.rig.position+=displacement*maxf(0,float(travel[0])-.005); return float(travel[0])
class FakeGame:
	extends Node3D
	var camera:Camera3D
	var rig:Node3D
	var item_actions
	var living=null
	func _notice(_message): pass
	func aim_source(hand): return hand
func _initialize(): call_deferred("run")
func run():
	var game=FakeGame.new(); root.add_child(game); game.rig=Node3D.new(); game.add_child(game.rig); game.camera=Camera3D.new(); game.rig.add_child(game.camera); game.camera.position.y=1.7; game.item_actions=FakeActions.new(); game.item_actions.game=game
	var failures=[]; await preload("res://living_component_checks.gd").run(game,failures); print("LIVING_COMPONENT_RESULT "+JSON.stringify(failures)); game.free(); quit(0 if failures.is_empty() else 1)
