extends SceneTree
const Torch=preload("res://hearth_torch.gd")
var failures=[]
var checks=0

class Adventure extends Node:
	var zone="forge_yard"
	var zone_groups={}
	func haptic(_hand,_kind): pass

class Fluid extends Node:
	var ignitions=0
	var last_tip=Vector3.ZERO
	func ignite_near(pos,_radius): ignitions+=1; last_tip=pos; return 1

class Firecraft extends Node:
	var fluid=Fluid.new()
	var props=[]
	func _tip(prop): return prop.global_position
	func _light(prop): prop.set_meta("state","lit")

class Game extends Node3D:
	var adventure=Adventure.new()
	var firecraft=Firecraft.new()
	var held={}
	var camera=Node3D.new()
	var diagnostic_offline=true
	var smoke=true
	var hit={}
	func initialize():
		add_child(adventure); add_child(firecraft); firecraft.add_child(firecraft.fluid); add_child(camera)
		var zone=Node3D.new(); add_child(zone); adventure.zone_groups.forge_yard=zone
		var second=Node3D.new(); add_child(second); second.position.x=30; adventure.zone_groups.ember_gallery=second
	func hand_socket(hand): return hand
	func _notice(_text,_duration=0): pass
	func _ray(_source,_distance): return hit

func _initialize(): call_deferred("run")
func check(condition:bool,message:String):
	checks+=1
	if not condition: failures.append(message)

func run():
	var start=Time.get_ticks_usec()
	var game=Game.new(); root.add_child(game); game.initialize()
	var torch=Torch.new(); game.add_child(torch); torch.setup(game)
	var hand=Node3D.new(); game.add_child(hand); hand.position=Torch.HOME
	var other=Node3D.new(); game.add_child(other); other.position=Torch.HOME
	check(torch.lit and torch.light is OmniLight3D and torch.light.omni_range==8,"Real warm 8m light starts lit")
	check(torch.light.shadow_enabled,"Exactly one torch shadow light enabled")
	check(torch.try_grab(hand),"Grab at home stand")
	check(game.held.get(str(hand.get_instance_id()))==torch.torch and torch.busy(hand),"Claims hand occupancy and blocks bombs")
	check(not torch.try_grab(other),"Cannot duplicate or steal held torch")
	check(not torch.trigger(other),"Only holding trigger toggles torch")
	check(torch.trigger(hand) and not torch.lit and not torch.light.visible,"Trigger snuffs actual light")
	check(torch.trigger(hand) and torch.lit,"Trigger relights")
	torch.set_shadows(false); torch.tick(.02); check(not torch.light.shadow_enabled,"Shadow budget override remains off")
	torch.set_shadows(true)
	var low=10.0; var high=0.0; var max_ember_size=0.0; var max_flame_size=0.0
	for i in range(600):
		torch.tick(.02); low=minf(low,torch.light.light_energy); high=maxf(high,torch.light.light_energy)
		for ember in torch.embers: max_ember_size=maxf(max_ember_size,ember.global_basis.get_scale().length())
		for child in torch.flame.get_children():
			if child is MeshInstance3D and child not in torch.embers: max_flame_size=maxf(max_flame_size,child.global_basis.get_scale().length())
	check(low>=2.7*.95-.0001 and high<=2.7*1.05+.0001,"Light flicker stays within 5 percent")
	check(max_ember_size<.015 and max_ember_size>.005,"Animated embers preserve authored millimetre scale")
	check(max_flame_size<.2 and max_flame_size>.1,"Animated flame stays below 20cm, including its root scale")
	check(game.firecraft.fluid.ignitions>10,"Torch transfers heat to shared fuel field")
	check(game.firecraft.fluid.last_tip.distance_to(torch.tip_position())<.001,"Fuel ignition comes from real torch tip")
	var vial=Node3D.new(); game.add_child(vial); vial.set_meta("fire_kind","vial"); vial.set_meta("state","fresh"); vial.global_position=torch.tip_position(); game.firecraft.props.append(vial)
	for i in range(10): torch.tick(.02)
	check(vial.get_meta("state")=="fresh","Wick requires deliberate dwell")
	for i in range(10): torch.tick(.02)
	check(vial.get_meta("state")=="lit","Gentle torch contact ignites wick after dwell")
	check(torch.release(hand) and not torch.busy(hand) and not game.held.has(str(hand.get_instance_id())),"Release clears ownership")
	check(torch.body.collision_layer==8 and torch.body.collision_mask==9 and torch.body.continuous_cd,"Dropped torch collides with world but does not block player")
	var floor=WorldZones.body(game,Vector3(5.8,.45,2.9),Vector3(5,.1,5))
	torch.body.global_position=Vector3(5.8,2,2.9)
	for i in range(100): await physics_frame
	check(torch.body.global_position.y>.48 and torch.body.global_position.y<1.5,"Actual rigid torch lands on tabletop collider")
	hand.global_position=torch.torch.global_position
	check(torch.try_grab(hand) and not is_instance_valid(torch.body),"Dropped torch can be gripped again")
	game.adventure.zone="ember_gallery"; game.adventure.zone_groups.forge_yard.visible=false
	torch.tick(.02); check(torch.light.visible and torch.busy(hand),"Carried torch stays lit across zone visibility changes")
	var station=torch.create_stand(game.adventure.zone_groups.ember_gallery,Vector3(0,1,0))
	torch.home(); check(torch.resting==station and game.held.is_empty(),"Home chooses visible zone stand and clears hand")
	game.adventure.zone_groups.ember_gallery.visible=false; torch.tick(.02)
	check(not torch.light.visible and not torch.crackle.playing,"Hidden zone has no active light or audio")
	game.adventure.zone_groups.ember_gallery.visible=true
	hand.global_position=station.global_position; check(torch.try_grab(hand),"Gallery stand retrieves same torch")
	torch.release(hand); torch.body.global_position.y=-15; torch.tick(.02)
	check(not is_instance_valid(torch.body) and torch.torch.get_parent()==station,"Offworld rescue returns to stand")
	game.held[str(hand.get_instance_id())]=vial
	check(not torch.try_grab(hand),"Never replaces another held item")
	game.held.clear()
	# Desktop ray can select the torch or stand from comfortable reach.
	hand.position=Vector3(50,2,50)
	var area:Area3D
	for child in station.get_children():
		if child is Area3D: area=child
	game.hit={"collider":area}
	check(torch.try_grab(hand,true),"Desktop aim ray selects a station")
	torch.home(); floor.queue_free(); game.queue_free(); await process_frame
	print("HEARTH_TORCH_CHECK ",JSON.stringify({"ok":failures.is_empty(),"checks":checks,"failures":failures,"seconds":(Time.get_ticks_usec()-start)/1000000.0}))
	quit(0 if failures.is_empty() else 1)
