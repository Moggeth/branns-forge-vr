extends SceneTree
## Real main dispatch and real ring ownership, without main startup or saves.
class Stub:
	extends Node
	var extras
	var rope
	var formation={}
	var motion={}
	var history={}
	var zone_groups={}
	var zone="forge_yard"
	var falling=false
	var environment_changes=0
	func busy(_hand): return false
	func trigger(_hand,_target=null): return false
	func menu_trigger(_source): return false
	func interact(_target,_hand): return false
	func press(_target,_hand): return true
	func haptic(_hand,_event): pass
	func detach(_flag=false): pass
	func value(_key): return 1.0
	func _apply_zone_environment(id):
		environment_changes+=1
		for key in zone_groups: zone_groups[key].visible=key==id
class QuietRing:
	extends "res://playful_tools.gd"
	func _sound(_index:int): pass
class TrackedWand:
	extends "res://magnetic_wand.gd"
	var trigger_calls=0
	func trigger(hand)->bool:
		trigger_calls+=1
		return super.trigger(hand)
class Harness:
	extends "res://main.gd"
	var clicked=[]
	var ray_target:Node3D
	var ray_distance=2.0
	func _ready(): set_process(false); set_process_input(false)
	func _notice(_message:String,_seconds=7.0): pass
	func _button(action:String): clicked.append(action)
	func _ray(_source:Node3D,distance:float)->Dictionary:
		if not is_instance_valid(ray_target) or ray_distance>distance: return {}
		return {"collider":ray_target,"position":ray_target.global_position}
	func hand_socket(hand:Node3D)->Node3D: return hand
	func aim_source(hand:Node3D)->Node3D: return hand
var failures=[]
var checks=0
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func run():
	var began=Time.get_ticks_usec()
	var game=Harness.new(); root.add_child(game); game.diagnostic_offline=true
	var stub=Stub.new(); game.add_child(stub); stub.extras=stub; stub.rope=stub
	for key in ["qol","adventure","living","firecraft","workshop","enchantments","siegebird","zone_details","button_feedback","item_actions","tuning"]: game.set(key,stub)
	game.rig=Node3D.new(); game.add_child(game.rig)
	game.camera=Camera3D.new(); game.rig.add_child(game.camera); game.camera.position.y=1.7
	game.desktop_hand=Node3D.new(); game.rig.add_child(game.desktop_hand); game.desktop_hand.position.y=1.7
	var zone=Node3D.new(); game.add_child(zone); stub.zone_groups.forge_yard=zone
	var ring=QuietRing.new(); game.add_child(ring); game.playful_tools=ring; ring.setup(game)
	var button=Node3D.new(); game.add_child(button); button.set_meta("kind","button"); button.set_meta("action","lantern_gallery:retry")
	game.ray_target=button
	game._trigger(game.desktop_hand,true)
	check(game.clicked==["lantern_gallery:retry"],"Empty-hand click reaches nearby world button")
	game.clicked.clear(); ring.retrieve(game.desktop_hand); var initial_power=ring.mode
	game._trigger(game.desktop_hand,true)
	check(game.clicked==["lantern_gallery:retry"] and ring.mode==initial_power,"Held-ring desktop click activates visible PLAY AGAIN without changing toss power")
	game.clicked.clear(); ring.release(game.desktop_hand)
	game._trigger(game.desktop_hand,true)
	check(game.clicked==["lantern_gallery:retry"] and ring.state=="flying","In-flight desktop click activates visible button without stealing it for recall")
	game.clicked.clear(); ring._home(); ring.retrieve(game.desktop_hand); game.ray_target=null; initial_power=ring.mode
	game._trigger(game.desktop_hand,true)
	check(ring.mode==(initial_power+1)%3 and game.clicked.is_empty(),"Empty-space held-ring click still changes power")
	ring.release(game.desktop_hand); game._trigger(game.desktop_hand,true)
	check(ring.state=="returning" and game.clicked.is_empty(),"Empty-space flying-ring click still recalls")
	ring._home(); ring.retrieve(game.desktop_hand); game.ray_target=button; game.ray_distance=20; initial_power=ring.mode
	game._trigger(game.desktop_hand,true)
	check(game.clicked.is_empty() and ring.mode==(initial_power+1)%3,"Out-of-range button cannot steal ordinary tool input")
	game.ray_distance=2; initial_power=ring.mode; game._trigger(game.desktop_hand,false)
	check(game.clicked.is_empty() and ring.mode==(initial_power+1)%3,"VR trigger retains original tool priority")
	button.set_meta("action","upgrade"); initial_power=ring.mode; game._trigger(game.desktop_hand,true)
	check(game.clicked.is_empty() and ring.mode==(initial_power+1)%3,"Unrelated non-activity action retains tool priority")
	button.set_meta("action","lantern_gallery:retry")
	ring._home(); game.ray_distance=2
	var wand=TrackedWand.new(); game.add_child(wand); game.magnetic_wand=wand; wand.setup(game)
	game.desktop_hand.global_position=wand.HOME
	check(wand.try_grab(game.desktop_hand,true),"Actual magnetic wand acquires desktop hand")
	game._trigger(game.desktop_hand,true)
	check(game.clicked==["lantern_gallery:retry"] and wand.trigger_calls==0,"Held-wand desktop click reaches activity button without pulling cargo")
	game.clicked.clear(); game.ray_target=null; game._trigger(game.desktop_hand,true)
	check(game.clicked.is_empty() and wand.trigger_calls==1,"Empty-space wand click still reaches magnetic trigger")
	wand.release(game.desktop_hand); game.ray_target=button
	var echo=preload("res://echo_bells.gd").new(); game.add_child(echo); game.echo_bells=echo; echo.setup(game)
	var hand=game.desktop_hand; hand.global_position=echo.clappers[0].global_position
	check(echo.try_grab(hand,false),"Synthetic VR hand acquires actual clapper")
	game._trigger(hand,true)
	check(game.clicked.is_empty() and echo.busy(hand),"Held clapper blocks desktop button priority and cannot ring on trigger")
	check(not ring.retrieve(hand),"Returning ring cannot steal clapper hand")
	# Cross-court safe travel moves the rig; old physical grip cancels on next tick.
	hand.global_position+=Vector3(50,0,0); echo.tick(.01)
	check(not echo.busy(hand) and echo.answer_index==0,"External travel cancels held clapper without ringing")
	# Real physics travel must restore the zone owning the destination floor.
	var travel=preload("res://living_runtime.gd").new(); game.add_child(travel); travel.game=game; travel.components=stub; game.living=travel
	stub.zone="pinewood_ruins"; zone.visible=false
	await physics_frame
	var old_position=game.rig.global_position
	check(not travel.safe_travel(Vector3(485,0,400)),"Destination without a floor is rejected")
	check(stub.zone=="pinewood_ruins" and not zone.visible and stub.environment_changes==0 and game.rig.global_position==old_position,"Failed landing preserves prior zone visibility and rig position")
	echo.act("visit")
	check(game.camera.global_position.distance_to(EchoLanding())<2 and stub.zone=="forge_yard" and echo.court.is_visible_in_tree(),"Successful pocket visit activates destination floor's real owning zone")
	game.free(); await process_frame
	print("ARCADE_INPUT_OWNERSHIP_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
func EchoLanding()->Vector3: return Vector3(185,1.7,70)
