extends SceneTree
var failures=[]
var checks=0
func check(ok,message):
	checks+=1
	if not ok: failures.append(message)
func _initialize(): run.call_deferred()
func press(fairy,code):
	var event=InputEventKey.new(); event.physical_keycode=code; event.pressed=true; fairy.input_event(event)
func run():
	var game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game.adventure.travel("forge_yard"); game._start_fairy()
	var fairy=game.fairy; fairy.test_mode=true; fairy.window.hide()
	var idle={"stick":Vector3.ZERO,"boost":false,"brake":false}
	var practice=fairy.practice
	check(practice.stage==-1,"Practice is optional by default")
	press(fairy,KEY_F2); check(practice.stage==0 and fairy.practice_hand.visible,"F2 begins and visibly offers perch")
	game.elapsed+=1; fairy.attach(fairy.practice_hand); practice.tick(.2,idle)
	check(practice.stage==1,"Real perch advances practice")
	press(fairy,KEY_F4); check(practice.stage==2 and fairy.launch_coast>0,"F4 launches and teaches brakes")
	var brake=idle.duplicate(); brake.brake=true
	for i in range(80): fairy.tick(.02,brake)
	check(practice.stage==3 and fairy.avatar.velocity.length()<.5,"Braking completes launch recovery")
	practice.record("ping"); check(practice.stage==3,"Out-of-order events cannot skip practice")
	fairy.keys[KEY_SHIFT]=true; press(fairy,KEY_F2); fairy.keys.clear()
	check(practice.stage==0 and fairy.launch_coast==0 and fairy.carry==null,"Retry safely resets practice flight without retaining cargo")
	press(fairy,KEY_F2); check(practice.stage==-1,"F2 pauses without altering world")
	practice.start()
	for event in ["perch","launch","brake","match","lit","ignite","ping","clear"]: practice.record(event)
	check(practice.completed and practice.stage==-1,"All eight observed interactions complete optional sequence")
	fairy.next_ping=0; fairy.shoot(true); fairy.next_shot=0; fairy.shoot(false)
	check(fairy.shots.any(func(s): return s.ping),"Pending ping exists for clear lifecycle test")
	fairy.clear_marks(); check(fairy.shots.all(func(s):return not s.ping) and fairy.shots.size()==1,"Clear removes in-flight pings but preserves darts")
	fairy.leave_mark(Vector3(0,7,0),Vector3.UP,0); fairy.launch_coast=.8; fairy.practice_toss=.2; fairy.stop(); fairy._capture_mouse()
	check(not fairy.mouse_look and not fairy.owns_input_policy,"Late focus callback cannot capture mouse after stop")
	check(fairy.marks.is_empty() and fairy.shots.is_empty() and fairy.launch_coast==0,"Stop clears transient projectiles, markers and launch state")
	fairy.reopen(); fairy.window.hide(); fairy.test_mode=true; fairy._focus_lost()
	check(fairy.active and fairy.health==18 and fairy.perch==null,"Reopening returns to safe flight")
	var joy=InputEventJoypadButton.new(); joy.button_index=JOY_BUTTON_B; joy.pressed=true
	var was_third=fairy.third_person; fairy.input_event(joy)
	check(fairy.third_person==was_third,"Background controller button cannot change companion view")
	fairy.launch_coast=.8; fairy.practice_toss=.2; game.adventure.travel("pinewood_ruins"); fairy.tick(.02,idle)
	check(fairy.launch_coast==0 and fairy.practice_toss==0 and not fairy.practice_hand.visible,"Travel clears launch and hides old practice hand")
	fairy.launch_coast=.8; fairy.respawn(); check(fairy.launch_coast==0,"Respawn clears inherited fling momentum")
	var prefs=load("res://fairy_preferences.gd")
	var path="user://fairy_preferences_test_"+str(OS.get_process_id())+".cfg"
	check(prefs.write({"sensitivity_scale":1.7,"third_person":true,"help_visible":false},path)==OK,"Control preferences save independently of world saves")
	var values=prefs.read(path); check(is_equal_approx(values.sensitivity_scale,1.7) and values.third_person and not values.help_visible,"Control preferences round trip")
	check(prefs.write({"sensitivity_scale":.8,"third_person":false},path)==OK and is_equal_approx(prefs.read(path).sensitivity_scale,.8),"Atomic settings update replaces existing preferences")
	var bad=prefs.sanitize({"sensitivity_scale":INF,"third_person":"yes","help_visible":22}); check(bad.sensitivity_scale==1 and not bad.third_person and bad.help_visible,"Malformed settings use safe defaults")
	DirAccess.remove_absolute(path)
	fairy.stop(); await process_frame
	print("FAIRY_PRACTICE_CHECK_RESULT ",JSON.stringify({"checks":checks,"failures":failures})); quit(0 if failures.is_empty() else 1)
