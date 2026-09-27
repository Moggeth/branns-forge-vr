extends SceneTree
const Components=preload("res://living_components.gd")
class FakeActions:
	extends RefCounted
	var falling=false
	func move_rig(_motion): return 1.0
class FakeGame:
	extends Node3D
	var camera:Camera3D
	var rig:Node3D
	var item_actions=FakeActions.new()
	var living=null
	var notices=[]
	func _notice(message): notices.append(message)
	func aim_source(hand): return hand
var checks=0
var failures=[]
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func step(engine,seconds):
	for i in range(ceili(seconds/.05)): engine.tick(.05)
func _initialize(): run.call_deferred()
func run():
	var began=Time.get_ticks_usec()
	var package=JSON.parse_string(FileAccess.get_file_as_string("res://living_unfinished_lullaby.json"))
	var game=FakeGame.new(); root.add_child(game)
	game.rig=Node3D.new(); game.add_child(game.rig); game.rig.position=Vector3(120,0,-84)
	game.camera=Camera3D.new(); game.rig.add_child(game.camera); game.camera.position.y=1.7
	var stage=Node3D.new(); game.add_child(stage)
	var engine=Components.new(); game.add_child(engine); engine.setup(game)
	var built=engine.build(package,stage)
	check(built.errors.is_empty(),"Data-only garden passes pinned native component validation")
	check(built.entities.size()==26,"Garden uses a bounded 26 entities")
	check(built.entities.values().filter(func(e):return e.node is RigidBody3D).size()==3,"Only the three starter sources are dynamic")
	check(built.entities.values().all(func(e):return e.node.collision_layer==0),"Staging creates no live collision")
	check(engine.activate(built),"Valid package activates through standard component lifecycle")
	step(engine,2)
	var e=built.entities
	check(e.chorus.state.count==0 and not e.chorus.state.complete,"Discovery and idle simulation cannot solve any wonder")
	var hand=Node3D.new(); game.add_child(hand)
	engine.trigger(hand,e.welcome.node); engine.trigger(hand,e.chorus.node); step(engine,.2)
	check(e.chorus.state.count==0,"Pointing at instructions or final trophy cannot bypass outcomes")
	e["glow-pebble"].node.global_position=e["sun-bud"].node.global_position+Vector3.UP*.5
	step(engine,.2)
	check(e["sun-bud"].state.complete and e.chorus.state.count==1,"A brought light source awakens exactly its light bud")
	check(not e["hearth-bud"].state.complete and not e["song-bud"].state.complete,"Light does not substitute for heat or sound")
	for i in range(3):
		e["glow-pebble"].node.position=Vector3(-1.8,1.04,2.6); step(engine,2)
		e["glow-pebble"].node.global_position=e["sun-bud"].node.global_position+Vector3.UP*.5; step(engine,.2)
	check(e.chorus.state.count==1,"Repeated sensing of the same completed bud cannot farm the three-wonder goal")
	e["warm-pebble"].node.global_position=e["hearth-bud"].node.global_position+Vector3.UP*.5; step(engine,.2)
	check(e["hearth-bud"].state.complete and e.chorus.state.count==2,"Warmth supplies a separate second outcome")
	e.handbell.node.global_position=e["song-bud"].node.global_position+Vector3.UP*.5; step(engine,.2)
	check(not e["song-bud"].state.complete,"Carrying the silent handbell does not fake a sounded note")
	hand.global_position=e.handbell.node.global_position
	check(engine.try_grab(hand),"Starter handbell supports the ordinary physical grip path")
	check(engine.trigger(hand,null),"Triggering a held bell activates the held source rather than a distant prop")
	engine.release(hand); step(engine,.2)
	check(e["song-bud"].state.complete and e.chorus.state.complete and e.chorus.state.count==3,"Ringing the bell completes the third different wonder")
	check(e["crown-light"].state.power==2 and e.crown.state.power==1.4,"Chorus powers the earned light and kinetic receiver through data rules")
	step(engine,.1) # Rules set power after entity ticks; the motor responds next tick.
	check(absf(e.crown.node.position.y-2.6)<.001 and e.crown.mesh.rotation.y>0,"Completion lifts and rotates the physical copper crown")
	var snapshot=JSON.parse_string(JSON.stringify(engine.serialize(built)))
	engine.deactivate(built); built.root.free()
	built=engine.build(package,stage); engine.restore(built,snapshot); engine.activate(built); step(engine,.2)
	check(built.entities.chorus.state.complete and built.entities.chorus.state.count==3,"Earned objective survives JSON state round trip without duplicate counts")
	check(built.entities["crown-light"].state.power==2 and absf(built.entities.crown.node.position.y-2.6)<.001,"Reward pose and receiver state restore through existing Living persistence")
	engine.deactivate(built); built.root.free()
	# A second run uses three source objects from another active package with
	# unrelated IDs. This proves cross-package stimulus semantics, not IDs.
	built=engine.build(package,stage); engine.activate(built); e=built.entities
	var foreign={"schema":1,"id":"unrelated-inventions","version":1,"kind":"item","entities":[],"links":[],"rules":[]}
	for kind in ["light","heat","sound"]:
		foreign.entities.append({"id":"different-"+kind,"name":"Unrelated "+kind+" invention","shape":"sphere","position":[0,1,0],"size":[.2,.2,.2],"color":"#e7bf87","material":"stone","static":true,"components":[{"type":"emitter","config":{"kind":kind,"strength":6,"interval":.4}}]})
	var outsider=engine.build(foreign,stage); engine.activate(outsider)
	step(engine,.2)
	check(e.chorus.state.count==0,"Far-away foreign emitters cannot solve local objectives")
	outsider.entities["different-light"].node.global_position=e["sun-bud"].node.global_position+Vector3.UP*.4
	step(engine,.5)
	check(e["sun-bud"].state.complete,"A light stimulus from a different active package satisfies the local light outcome")
	outsider.entities["different-heat"].node.global_position=e["hearth-bud"].node.global_position+Vector3.UP*.4
	step(engine,.5)
	check(e["hearth-bud"].state.complete,"A heat stimulus from an unrelated source satisfies warmth without a starter ID")
	outsider.entities["different-sound"].node.global_position=e["song-bud"].node.global_position+Vector3.UP*.4
	step(engine,.5)
	check(e.chorus.state.complete,"A foreign sound source can finish the complete creative alternative solution")
	var source_count=outsider.entities.size()
	check(outsider.entities.values().all(func(entry):return entry.state.count==0),"Garden rules do not mutate foreign source objectives")
	check(source_count==3 and engine.event_queue.is_empty(),"Cross-package sensing creates no objects or lingering event feedback")
	await physics_frame
	var floor=game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(120,2,-84),Vector3(120,-1,-84),1))
	check(not floor.is_empty() and floor.normal.y>.9,"Declared garden spawn has an actual walkable floor")
	var capsule=CapsuleShape3D.new(); capsule.radius=.22; capsule.height=1.65
	var query=PhysicsShapeQueryParameters3D.new(); query.shape=capsule; query.collision_mask=1; query.transform=Transform3D(Basis.IDENTITY,Vector3(120,.92,-84))
	check(game.get_world_3d().direct_space_state.intersect_shape(query,1).is_empty(),"Declared garden spawn has clear standing capsule space")
	engine.deactivate(outsider); outsider.root.free(); engine.deactivate(built); built.root.free()
	check(engine.active.is_empty() and engine.entries.is_empty(),"Removing optional packages cleans all owned live entries")
	engine.free(); stage.free(); hand.free(); game.free()
	print("LULLABY_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
