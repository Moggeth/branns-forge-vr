extends Node
var game
var failures=[]

func package(id="check-lantern",version=1)->Dictionary:
	return {"schema":1,"id":id,"name":"Test lantern","version":version,"kind":"device","scope":{"kind":"instance","targetId":id},"provenance":{"prompt":"A held light whose story survives changes","origin":"demo","interpretation":"Native regression fixture","parentIds":[]},"dependencies":[],"entities":[{"id":"lamp","name":"Lamp","shape":"box","position":[100,2,0],"size":[0.2,0.3,0.2],"color":"edbb67","material":"iron","static":false,"components":[{"type":"grabbable","config":{"mass":1}},{"type":"trigger","config":{"event":"triggered"}}]}],"links":[],"rules":[]}

func wait_for(predicate,frames=30)->bool:
	for i in range(frames):
		game.elapsed+=0.016; game.living.tick(0.016)
		await get_tree().process_frame
		if predicate.call(): return true
	return false

func expect(condition,message):
	if not condition: failures.append(message)

func run(g):
	game=g; game.set_process(false)
	var runtime=game.living
	var one=package(); runtime.wanted[one.id]=one
	expect(await wait_for(func():return runtime.active.has(one.id)),"initial package activates")
	if not runtime.active.has(one.id): finish(); return
	var original=runtime.active[one.id]; var node=original.entities.lamp.node
	var test_hand=Node3D.new(); game.add_child(test_hand); test_hand.global_position=node.global_position
	expect(runtime.try_grab(test_hand),"physical package grip succeeds")
	expect(game._trigger_allowed(test_hand,true),"XR trigger reaches held living tool")
	runtime.release(test_hand); test_hand.free()

	game.held["living-check"]=node
	var two=package("check-lantern",2); two.entities[0].color="6fdeec"; runtime.wanted[two.id]=two
	await wait_for(func():return false,4)
	expect(runtime.active[one.id]==original,"held exact revision persists during update")
	expect(runtime.ack_queue.any(func(a):return a.status=="deferred"),"held update reports deferred")
	game.held.erase("living-check")
	expect(await wait_for(func():return runtime.active[one.id].manifest.version==2),"release permits version 2")
	runtime.active[one.id].entities.lamp.state.count=42
	runtime.wanted[one.id]=one
	expect(await wait_for(func():return runtime.active[one.id].manifest.version==1),"historical version restores")
	runtime.wanted[one.id]=two
	expect(await wait_for(func():return runtime.active[one.id].manifest.version==2),"return to revised version")
	expect(is_equal_approx(float(runtime.active[one.id].entities.lamp.state.count),42.0),"version-specific state preserved")
	var broken=package("check-lantern",3); broken.entities[0].size=[-1,0.3,0.2]; runtime.wanted[broken.id]=broken
	await wait_for(func():return not runtime.failures.is_empty())
	expect(runtime.active[one.id].manifest.version==2,"invalid update keeps working revision")
	runtime.wanted[one.id]=two
	# Two exact dependency revisions replace as one transaction.
	var provider=package("check-provider"); provider.entities[0].position=[102,2,0]
	var consumer=package("check-consumer"); consumer.entities[0].position=[104,2,0]; consumer.dependencies=[{"id":provider.id,"version":1}]
	runtime.wanted[provider.id]=provider; runtime.wanted[consumer.id]=consumer
	expect(await wait_for(func():return runtime.active.has(consumer.id)),"dependency installs before consumer")
	var provider2=provider.duplicate(true); provider2.version=2
	var consumer2=consumer.duplicate(true); consumer2.version=2; consumer2.dependencies[0].version=2
	runtime.snapshot.deployments={provider.id:{"transactionId":"atomic-test"},consumer.id:{"transactionId":"atomic-test"}}
	runtime.wanted[provider.id]=provider2; runtime.wanted[consumer.id]=consumer2
	game.held["living-check"]=runtime.active[consumer.id].entities.lamp.node
	await wait_for(func():return false,4)
	expect(runtime.active[provider.id].manifest.version==1,"held consumer defers entire dependency transaction")
	game.held.erase("living-check")
	expect(await wait_for(func():return runtime.active[consumer.id].manifest.version==2),"dependency batch activates")
	expect(runtime.active[provider.id].manifest.version==2,"provider and consumer commit together")
	var provider3=provider2.duplicate(true); provider3.version=3
	var consumer3=consumer2.duplicate(true); consumer3.version=3; consumer3.dependencies[0].version=3; consumer3.entities[0].components.append({"type":"unknown_native_code","config":{}})
	runtime.wanted[provider.id]=provider3; runtime.wanted[consumer.id]=consumer3
	await wait_for(func():return runtime.failures.has(runtime._token(consumer3)))
	expect(runtime.active[provider.id].manifest.version==2 and runtime.active[consumer.id].manifest.version==2,"bad companion rolls back whole transaction")
	# Player profile is reversible and never persists over personal tuning.
	runtime.wanted[provider.id]=provider2; runtime.wanted[consumer.id]=consumer2
	var embodiment=package("check-profile"); embodiment.scope={"kind":"instance","targetId":"player"}; embodiment.entities[0].components=[{"type":"embodiment","config":{"moveSpeed":1.2,"handScale":1.05,"fingerCurl":0.9,"handColor":"abceef"}}]
	runtime.wanted[embodiment.id]=embodiment
	expect(await wait_for(func():return runtime.active.has(embodiment.id)),"player profile activates")
	runtime._apply_embodiment(); expect(is_equal_approx(game.tuning.value("locomotion.speed"),1.2),"player speed applies without rewriting preferences")
	runtime.wanted.erase(embodiment.id)
	await wait_for(func():return not runtime.active.has(embodiment.id)); runtime._apply_embodiment()
	expect(not game.tuning.runtime_overrides.has("locomotion.speed"),"retirement restores personal movement settings")
	var before=runtime.active[one.id]; runtime._preserve_state(before)
	var good_state=runtime.cached_states[one.id].duplicate(true)
	runtime._preserve_state({"manifest":before.manifest,"entities":{}})
	expect(runtime.cached_states[one.id]==good_state,"scene teardown cannot erase last saved entity state")
	var oversized=package("check-size"); oversized.entities[0].size=[0,1,1]
	expect(not runtime.validate(oversized).is_empty(),"zero geometry rejected")
	runtime.museum.checks(failures)
	await preload("res://living_component_checks.gd").run(game,failures)
	# Demonstrations must all stage before publication; each remains inert until activated.
	var demos=JSON.parse_string(FileAccess.get_file_as_string("res://living_demo_packages.json"))
	if demos is Dictionary: demos=demos.get("packages",[])
	var arena=demos.filter(func(d):return d.id=="living-climb-arena")[0]
	runtime.wanted[arena.id]=arena
	expect(await wait_for(func():return runtime.active.has(arena.id)),"large region activates")
	await get_tree().physics_frame
	expect(runtime.safe_travel(Vector3(120,0,0)),"region has a safe physical landing")
	var arena2=arena.duplicate(true); arena2.version=2; runtime.wanted[arena.id]=arena2
	await wait_for(func():return false,4)
	expect(runtime.active[arena.id].manifest.version==1,"occupied region floor cannot disappear during update")
	expect(runtime.safe_travel(Vector3(-120,0,0)),"museum entrance has clear floor")
	expect(await wait_for(func():return runtime.active[arena.id].manifest.version==2),"region update commits after leaving")
	expect(runtime.safe_travel(Vector3(-9,0,2)),"forge return has clear floor")
	for demo in demos:
		var errors=runtime.validate(demo)
		expect(errors.is_empty(),"demo native manifest: "+str(demo.get("id"))+" "+str(errors))
		var holder=Node3D.new(); game.add_child(holder)
		var staged=runtime.components.build(demo,holder)
		expect(staged.errors.is_empty(),"demo component build: "+str(demo.id)+" "+str(staged.errors))
		for entry in staged.entities.values(): expect(entry.node.collision_layer==0,"staged collider remains inert")
		holder.queue_free()
	finish()

func finish():
	print("LIVING_CHECK ","PASS" if failures.is_empty() else "FAIL", " ",JSON.stringify(failures))
	game.get_tree().quit(0 if failures.is_empty() else 1)
