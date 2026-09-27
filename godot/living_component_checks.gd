extends RefCounted

static func run(game,failures:Array):
	var engine=preload("res://living_components.gd").new(); game.add_child(engine); engine.setup(game)
	var stage=Node3D.new(); game.add_child(stage)
	var demos=JSON.parse_string(FileAccess.get_file_as_string("res://living_demo_packages.json"))
	for package in demos:
		var built=engine.build(package,stage)
		if not built.errors.is_empty(): failures.append("Demo construction failed: "+str(package.id)+" "+str(built.errors))
		for e in built.entities.values():
			if e.node.collision_layer!=0: failures.append("Staged object has live collision")
		built.root.free()
	var package={"schema":1,"id":"mechanics-test","version":1,"kind":"region","region":{"origin":[450,20,450]},"entities":[
		entity("floor",[0,-.2,0],[20,.4,20],[]),
		entity("wood",[-2,.5,0],[.3,1,.3],[component("material",{"ignition":30,"absorption":1,"conductivity":1})]),
		entity("water",[-3,1,0],[.3,.5,.3],[component("reservoir",{"capacity":10,"amount":10})]),
		entity("bowl",[-4,1,0],[.4,.4,.4],[component("reservoir",{"capacity":1,"amount":0}),component("material",{"absorption":1})]),
		entity("battery",[2,1,0],[.3,.3,.3],[component("emitter",{"kind":"energy","strength":2,"interval":1})]),
		entity("lamp",[3,1,0],[.3,.3,.3],[component("receiver",{"kind":"light"}),component("material",{"conductivity":1})]),
		entity("objective",[0,1,2],[.3,.3,.3],[component("objective",{"event":"ignited","target":"wood","count":1})]),
		entity("loose",[0,2,0],[.2,.2,.2],[component("grabbable",{"mass":.2})]),
		entity("gravity",[0,1,0],[.2,.2,.2],[component("field",{"kind":"gravity","radius":3,"strength":.2})]),
		entity("seer",[4,1,0],[.3,.3,.3],[component("sensor",{"kind":"light","radius":5,"threshold":.1}),component("creature",{"mode":"investigate","speed":.5})]),
		entity("beacon",[5,1,0],[.2,.2,.2],[component("emitter",{"kind":"light","strength":2,"interval":1})]),
		entity("maker",[0,1,-3],[.2,.2,.2],[component("maker",{"mode":"record"}),component("grabbable",{})]),
		entity("climb",[0,1,-5],[2,2,.3],[component("climbable",{})]),
		entity("hook",[0,1,-2],[.2,.2,.2],[component("grapple",{"range":10,"reelSpeed":2}),component("grabbable",{})])
	],"links":[{"id":"water-flow","from":"water","to":"bowl","type":"fluid","config":{"rate":2}},{"id":"wire","from":"battery","to":"lamp","type":"energy","config":{"conductance":1}}],"rules":[{"event":"triggered","target":"battery","actions":[{"op":"heat","target":"wood","value":90}]}]}
	var built=engine.build(package,stage)
	if not engine.activate(built): failures.append("Mechanics package rejected")
	await game.get_tree().physics_frame
	var e=built.entities; var hand=Node3D.new(); game.add_child(hand); hand.global_position=e.battery.node.global_position
	engine.trigger(hand,e.battery.node); engine.tick(.05); engine.tick(.05)
	if not e.wood.state.burning: failures.append("Heat did not ignite wood")
	if not e.objective.state.complete: failures.append("Ignition objective did not complete")
	engine._action(built,"wood",{"op":"wet","value":35}); engine.tick(.05)
	if e.wood.state.burning: failures.append("Water did not extinguish flame")
	for i in range(25): engine.tick(.05)
	if absf(float(e.water.state.amount)+float(e.bowl.state.amount)-10)>.001: failures.append("Fluid is not conserved")
	if e.bowl.state.amount<.99: failures.append("Fluid did not fill bowl")
	if e.lamp.state.power<1.5: failures.append("Energy did not reach receiver")
	if e.loose.node.gravity_scale>.21: failures.append("Local gravity did not apply")
	if e.seer.state.memory.is_empty(): failures.append("Light perception did not retain a memory")
	e.seer.state.memory.position=[457,21,450]
	var creature_before=e.seer.node.global_position; engine.tick(.05)
	if creature_before.distance_to(e.seer.node.global_position)<.001: failures.append("Investigating creature did not move toward its remembered source")
	engine._action(built,"battery",{"op":"emit","signal":"sound","value":20})
	e.seer.components.sensor.kind="sound"; engine._sense(e.seer)
	if e.seer.state.memory.get("kind")!="sound": failures.append("Emitted sound did not update sensory memory")
	engine._transform(e.wood,"cut",1)
	if e.wood.state.integrity>=100 or engine.debris.is_empty(): failures.append("Cut did not produce persistent physical offcut")
	engine._transform(e.wood,"repair",1)
	if e.wood.state.integrity!=100: failures.append("Repair did not restore integrity")
	engine._transform(e.wood,"grow",1)
	if e.wood.node.scale.x<1.19: failures.append("Growth did not alter physical shape")
	e.wood.components["weakpoint"]={"multiplier":2}; engine._transform(e.wood,"cut",1)
	if e.wood.state.integrity!=30: failures.append("Weak point did not multiply tool damage")
	engine._transform(e.wood,"repair",1)
	var saved=engine.serialize(built); e.wood.state.integrity=12; engine.restore(built,saved)
	if e.wood.state.integrity!=100: failures.append("Mechanism state failed roundtrip")
	# Grip, item-version deferral, actual hand release velocity, recording persistence.
	hand.global_position=e.maker.node.global_position
	if not engine.try_grab(hand): failures.append("Maker could not be gripped")
	if not engine.is_busy(built): failures.append("Held package is not marked busy")
	engine.trigger(hand,null)
	for i in range(5): hand.position.x+=.05; engine.tick(.016)
	engine.trigger(hand,null); engine.release(hand)
	if e.maker.samples.size()<3: failures.append("Gesture recorder did not retain hand movement")
	if e.maker.node.linear_velocity.length()<.1: failures.append("Release did not inherit hand velocity")
	if engine.busy(hand): failures.append("Released hand remains occupied")
	var recording=engine.serialize(built)
	if recording.entities.maker.samples.size()<3: failures.append("Recorded gesture missing from persistent state")
	# Real ray attachment and direct controller movement against a physics world.
	hand.global_position=e.hook.node.global_position
	engine.try_grab(hand)
	await game.get_tree().physics_frame
	engine._grapple(e.hook,hand)
	if not e.hook.has("tether"): failures.append("Grapple did not attach to climb wall")
	engine.release(hand)
	# Physical climbing follows controller displacement exactly once, without rig feedback.
	var rig_before=game.rig.global_position
	hand.global_position=e.climb.node.global_position+Vector3(0,0,.16)
	engine.try_grab(hand); hand.position.y-=.1; engine.tick(.016)
	if game.rig.global_position.y<=rig_before.y+.05: failures.append("Climbing hand did not lift the rig")
	engine.release(hand); game.rig.global_position=rig_before
	# Hinge assembly is an actual native joint, not merely a line drawing.
	var link={"spec":{"id":"test-hinge","type":"hinge","config":{}},"from":e.water,"to":e.loose,"joint":null}
	engine._hinge(link,built)
	if not link.joint is HingeJoint3D or link.joint.node_a.is_empty() or link.joint.node_b.is_empty(): failures.append("Physical hinge is not connected")
	# Declared signal feedback is bounded to this frame.
	built.package.rules.append({"event":"signal:loop","target":"battery","actions":[{"op":"emit","target":"battery","signal":"loop","value":1}]})
	engine._action(built,"battery",{"op":"emit","signal":"loop","value":1}); engine._events()
	if not engine.event_queue.is_empty(): failures.append("Signal cycle escaped event budget")
	# Native boundary rejects executable/unsupported or malformed data before construction.
	var invalid=package.duplicate(true); invalid.entities[0].components=[{"type":"material","config":{"unknown":1}}]
	var rejected=engine.build(invalid,stage)
	if rejected.errors.is_empty() or engine.activate(rejected): failures.append("Unknown native config was silently accepted")
	rejected.root.free()
	invalid=package.duplicate(true); invalid.rules[0].actions[0].value=NAN; rejected=engine.build(invalid,stage)
	if rejected.errors.is_empty(): failures.append("NaN rule action accepted")
	rejected.root.free()
	# Deactivation restores collisions and halts links, even when items were held.
	engine.deactivate(built)
	if engine.active.size()!=0 or not engine.entries.is_empty(): failures.append("Deactivation leaked registered entities")
	for part in built.entities.values():
		if part.node.collision_layer!=0: failures.append("Deactivated body still collides")
	engine.tick(.05); hand.free(); stage.free(); engine.free()

static func component(type:String,config:Dictionary)->Dictionary: return {"type":type,"config":config}
static func entity(id:String,position:Array,size:Array,components:Array)->Dictionary:
	return {"id":id,"name":id,"shape":"box","position":position,"size":size,"material":"wood","static":true,"color":"b39468","components":components}
