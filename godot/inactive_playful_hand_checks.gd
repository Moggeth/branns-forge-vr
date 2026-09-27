extends SceneTree
const Review=preload("res://arcade_input_ownership_checks.gd")
var checks=0
var failures=[]
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func run():
	var began=Time.get_ticks_usec()
	var game=Review.Harness.new(); root.add_child(game); game.diagnostic_offline=true
	var stub=Review.Stub.new(); game.add_child(stub); stub.extras=stub; stub.rope=stub
	for key in ["qol","adventure","living","firecraft","workshop","enchantments","siegebird","zone_details","button_feedback","item_actions","tuning"]: game.set(key,stub)
	game.rig=Node3D.new(); game.add_child(game.rig); game.camera=Camera3D.new(); game.rig.add_child(game.camera)
	game.desktop_hand=Node3D.new(); game.rig.add_child(game.desktop_hand)
	var zone=Node3D.new(); game.add_child(zone); stub.zone_groups.forge_yard=zone
	var ring=Review.QuietRing.new(); game.add_child(ring); game.playful_tools=ring; ring.setup(game)
	var wand=preload("res://magnetic_wand.gd").new(); game.add_child(wand); game.magnetic_wand=wand; wand.setup(game)
	var cargo=preload("res://cargo_playground.gd").new(); game.add_child(cargo); game.cargo_playground=cargo; cargo.setup(game)
	var echo=preload("res://echo_bells.gd").new(); game.add_child(echo); game.echo_bells=echo; echo.setup(game)
	var lost=XRController3D.new(); game.add_child(lost)
	var other=Node3D.new(); game.add_child(other)
	check(not lost.get_is_active(),"Synthetic XR controller represents lost tracking")
	echo.mode="answering"; echo.sequence=[0,1]; lost.global_position=echo.clappers[0].global_position
	check(echo.try_grab(lost),"Retained clapper ownership fixture establishes grip")
	lost.position+=Vector3.DOWN*.12; echo.tick(.016)
	check(echo.pull_armed,"Clapper is armed before tracking loss cancellation")
	game._cancel_inactive_playful_hand(lost)
	check(not echo.busy(lost) and echo.answer_index==0 and echo.mode=="answering","Lost controller cancels armed clapper without ringing")
	other.global_position=echo.clappers[1].global_position
	check(echo.try_grab(other),"Other hand can immediately take another clapper")
	game._cancel_inactive_playful_hand(lost)
	check(echo.busy(other),"Inactive-hand cleanup preserves other hand's active clapper")
	echo._cancel_grip()
	lost.global_position=cargo.lever_handle.global_position; cargo.can_launch=true
	check(cargo.try_grab(lost),"Cargo lever retained-owner fixture established")
	lost.position+=Vector3(0,0,.3); var rounds=cargo.state.rounds
	game._cancel_inactive_playful_hand(lost)
	check(not cargo.busy(lost) and cargo.state.rounds==rounds and not cargo.launched,"Lost lever grip cancels without launching ready cargo")
	other.global_position=cargo.lever_handle.global_position
	check(cargo.try_grab(other),"Other hand can take released cargo lever"); cargo.release(other)
	check(ring.retrieve(lost),"Ring retained-owner fixture established")
	var throw_id=ring.throw_id
	game._cancel_inactive_playful_hand(lost)
	check(ring.state=="home" and ring.holder==null and ring.throw_id==throw_id,"Tracking loss returns ring without throwing or incrementing throw ID")
	check(ring.retrieve(other),"Other hand can retrieve returned ring")
	game._cancel_inactive_playful_hand(lost)
	check(ring.busy(other),"Inactive-hand cleanup preserves another hand's ring"); ring._home()
	lost.global_position=wand.HOME
	check(wand.try_grab(lost),"Wand retained-owner fixture established")
	wand.target=cargo.bodies[0]
	game._cancel_inactive_playful_hand(lost)
	check(wand.holder==null and wand.target==null and not cargo.bodies[0].freeze,"Tracking loss releases magnetic target without freezing cargo")
	other.global_position=wand.HOME
	check(wand.try_grab(other),"Other hand can take returned wand")
	game._cancel_inactive_playful_hand(lost)
	check(wand.busy(other),"Inactive-hand cleanup preserves another hand's wand")
	game._cancel_inactive_playful_hand(other)
	check(wand.busy(other),"Non-XR desktop/synthetic hands are never cancelled by inactivity helper")
	game.free(); await process_frame
	print("INACTIVE_PLAYFUL_HAND_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
