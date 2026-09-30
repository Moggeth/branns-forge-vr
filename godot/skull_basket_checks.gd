extends SceneTree
## Offline native physics and basket identity check; uses an OS-temp save only.
class FakeAnimation extends Node:
	var actors={}

class FakeAdventure extends Node:
	var zone="forge_yard"
	var zone_groups={}

class FakeGrips extends Node:
	func is_stowed(_body)->bool: return false

class FakeTuning extends Node:
	func value(_key)->float: return 1.0

class FakeQuests extends Node:
	var deliveries=[]
	func delivery_instance_id(): return "accepted-instance"
	func skull_delivered(skull_id:String,instance_id)->bool:
		deliveries.append([skull_id,instance_id])
		return true

class FakeScene extends Node3D:
	var brann:Node3D

class FakeGame extends Node3D:
	var animation:FakeAnimation
	var adventure:FakeAdventure
	var grips:FakeGrips
	var tuning:FakeTuning
	var quests:FakeQuests
	var scene:FakeScene
	var remains
	var guardian_authored=null
	var held={}
	var elapsed=1.0
	var diagnostic_offline=false
	var smoke=false
	func _set_collisions(node:Node,enabled:bool):
		if node is CollisionShape3D: node.disabled=not enabled
		for child in node.get_children(): _set_collisions(child,enabled)
	func _notice(_message,_seconds=4): pass

func _initialize():
	_run.call_deferred()

func _actor(game:FakeGame,at:Vector3)->Node3D:
	var actor=Node3D.new()
	game.add_child(actor)
	actor.global_position=at
	actor.set_meta("enemy_type","skeleton")
	actor.set_meta("alive",true)
	actor.set_meta("zone","forge_yard")
	var head_joint=Node3D.new()
	head_joint.name="head"
	actor.add_child(head_joint)
	head_joint.position=Vector3(0,1.5,0)
	var piece=Node3D.new()
	piece.name="Skull"
	head_joint.add_child(piece)
	var mesh=MeshInstance3D.new()
	mesh.mesh=BoxMesh.new()
	mesh.mesh.size=Vector3(.18,.2,.2)
	piece.add_child(mesh)
	var home={"piece":piece,"parent":head_joint,"transform":piece.transform}
	game.animation.actors[actor.get_instance_id()]={"homes":[home],"pieces":[piece],"joints":{"head":head_joint},"type":"skeleton"}
	return actor

func _run():
	var failures=[]
	var game=FakeGame.new()
	root.add_child(game)
	game.animation=FakeAnimation.new(); game.add_child(game.animation)
	game.adventure=FakeAdventure.new(); game.add_child(game.adventure)
	game.adventure.zone_groups.forge_yard=game
	game.grips=FakeGrips.new(); game.add_child(game.grips)
	game.tuning=FakeTuning.new(); game.add_child(game.tuning)
	game.quests=FakeQuests.new(); game.add_child(game.quests)
	game.scene=FakeScene.new(); game.add_child(game.scene)
	game.scene.brann=Node3D.new(); game.scene.add_child(game.scene.brann)
	game.remains=preload("res://physical_remains.gd").new(); game.add_child(game.remains); game.remains.setup(game)
	var structure=preload("res://skeleton_structure.gd").new(); game.add_child(structure); structure.setup(game)
	for i in range(2): game.remains.shatter(_actor(game,Vector3(i*2,1,0)))
	var living=_actor(game,Vector3(5,1,0))
	var hit=structure.hit(living,living.to_global(Vector3(0,1.5,0)),Vector3.UP,9.0,"blunt")
	if not hit.detached or not hit.item is RigidBody3D: failures.append("Real head hit must detach a rigid skull")
	var skulls=[]
	var identities={}
	for body in game.remains.bodies:
		if not is_instance_valid(body) or not body.get_meta("skeleton_skull",false): continue
		skulls.append(body)
		identities[str(body.get_meta("skull_id",""))]=true
		if not body.is_in_group("pickup") or not body.get_meta("remains",false) or body.get_child_count()<2: failures.append("Tagged skull is not actual grabbable physics remains")
	if skulls.size()!=3 or identities.size()!=3: failures.append("Three actual heads need distinct persistent IDs")
	var path=OS.get_environment("TEMP").path_join("brann-skull-basket-check-%d.json"%Time.get_ticks_usec())
	var basket=preload("res://skull_basket.gd").new(); game.add_child(basket); basket.save_path=path; basket.setup(game,Vector3(0,1,0))
	for skull in skulls:
		skull.freeze=true
		skull.global_position=basket.basket.to_global(Vector3(0,0,0))
		basket.tick()
	if basket.contents.size()!=3 or game.quests.deliveries.size()!=3: failures.append("World insertion must deliver three distinct skulls")
	for call in game.quests.deliveries:
		if call[1]!="accepted-instance": failures.append("Delivery lost accepted instance identity")
	var first=basket.retrieve()
	if first==null or first.get_meta("basket_stored",false): failures.append("Stored skull cannot be retrieved")
	else:
		first.freeze=true
		first.global_position=basket.basket.to_global(Vector3.ZERO)
		basket.tick()
		if game.quests.deliveries.size()!=3: failures.append("Removal and reinsertion duplicated credit")
	var saved_ids=basket._stored_ids()
	basket.free()
	var restored=preload("res://skull_basket.gd").new(); game.add_child(restored); restored.save_path=path; restored.setup(game,Vector3(8,1,0))
	if restored._stored_ids()!=saved_ids or restored.contents.size()!=3: failures.append("Basket contents did not survive restart")
	if restored.basket.global_position.distance_to(Vector3(0,1,0))>.01: failures.append("Basket location did not survive restart")
	var replay=restored.retrieve()
	if replay!=null: restored.deposit(replay)
	if game.quests.deliveries.size()!=3: failures.append("Restart and reinsertion duplicated credit")
	print("SKULL_BASKET_RESULT ",JSON.stringify(failures))
	game.free()
	DirAccess.remove_absolute(path)
	quit(0 if failures.is_empty() else 1)
