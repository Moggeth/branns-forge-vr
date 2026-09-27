extends SceneTree
var game
var fairy
var checks=0
var failures=[]
var idle={"stick":Vector3.ZERO,"boost":false,"brake":false}
func check(ok,message):
	checks+=1
	if not ok: failures.append(message); print("GUIDE_ASSERT ",message)
func _initialize(): run.call_deferred()
func button(code,down=true):
	var e=InputEventJoypadButton.new(); e.button_index=code; e.device=0; e.pressed=down; fairy.input_event(e)
func tap(code): button(code); button(code,false)
func chord(code): button(JOY_BUTTON_START); tap(code); button(JOY_BUTTON_START,false)
func step(count,control=idle):
	for i in range(count):
		game.elapsed+=.02; fairy.tick(.02,control); game.firecraft.tick(.02)
func run():
	game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game.adventure.travel("forge_yard"); game._start_fairy()
	fairy=game.fairy; fairy.test_mode=true; fairy.window.hide(); fairy.focused=true
	var practice=fairy.practice; var help_before=fairy.help_visible; var view_before=fairy.third_person
	chord(JOY_BUTTON_Y); check(practice.stage==0 and fairy.help_visible==help_before,"Controller chord enters guide without toggling help")
	chord(JOY_BUTTON_A); game.elapsed+=.5; fairy.avatar.global_position=fairy.practice_hand.global_position+Vector3.UP*.12; tap(JOY_BUTTON_A); step(7)
	check(practice.stage==1 and fairy.perch==fairy.practice_hand,"A lands on offered hand and advances guide")
	chord(JOY_BUTTON_B); check(practice.stage==2 and fairy.third_person==view_before,"Controller fling advances guide without changing camera")
	var brake=idle.duplicate(); brake.brake=true; step(80,brake)
	check(practice.stage==3,"Actual deceleration advances braking lesson")
	var box=game.firecraft.box; game.firecraft.opening=0; game.firecraft.target_open=0
	fairy.avatar.global_position=box.global_position+Vector3.UP*.18; tap(JOY_BUTTON_X)
	check(fairy.carry==box,"X picks up closed box")
	fairy.shoot(false); step(30); check(game.firecraft.opening>.65,"Primary trigger action opens carried box")
	tap(JOY_BUTTON_X); if box.has_meta("body"): box.get_meta("body").freeze=true
	await physics_frame; await physics_frame
	fairy.avatar.global_position=game.firecraft.tray.global_position+Vector3.UP*.1; tap(JOY_BUTTON_X); step(7)
	check(is_instance_valid(fairy.carry) and fairy.carry.get_meta("fire_kind","")=="match" and practice.stage==4,"X takes one match and guide observes actual carry")
	if not is_instance_valid(fairy.carry): finish(); return
	var match_item=fairy.carry
	fairy.avatar.global_position=box.global_position+Vector3(.28,.08,.12); step(1); fairy.shoot(false); step(50)
	check(game.firecraft._burning(match_item) and practice.stage==5,"Real swept striker sequence lights match and advances guide")
	var vial=null
	for prop in game.firecraft.props:
		if is_instance_valid(prop) and prop.get_meta("fire_kind","")=="vial" and prop.get_meta("state","")=="fresh" and prop.is_visible_in_tree(): vial=prop; break
	check(is_instance_valid(vial),"Existing common-goods vial is available")
	if vial!=null:
		fairy.orientation=Basis.IDENTITY
		var tip_offset=Vector3(0,-.045,-.07)+match_item.transform*Vector3(0,.115,0)
		fairy.avatar.global_position=game.firecraft._tip(vial)-tip_offset+Vector3.RIGHT*.08
		fairy.held_heat_tip=Vector3.INF; step(8)
		check(game.firecraft._burning(vial) and practice.stage==6,"Carried match naturally lights actual supply vial wick")
	# Aim down at real workshop ground, cast the same projectile as LT, and let collision place the mark.
	fairy.avatar.global_position=game.firecraft.stand.global_position+Vector3(1,2,2); fairy.orientation=Basis(Vector3.RIGHT,-1.2); fairy.next_ping=0; fairy.shoot(true); step(100)
	check(not fairy.marks.is_empty() and practice.stage==7,"Dust projectile hits actual surface and advances marker lesson")
	chord(JOY_BUTTON_LEFT_SHOULDER)
	check(practice.completed and practice.stage==-1 and fairy.marks.is_empty(),"Controller clear completes all eight steps without direct stage events")
	chord(JOY_BUTTON_X); check(practice.stage==0 and fairy.carry==null,"Controller retry drops carried match and starts fresh")
	var before=practice.stage; button(JOY_BUTTON_START); fairy._focus_lost(); button(JOY_BUTTON_X)
	check(practice.stage==before and fairy.pad_buttons.is_empty(),"Focus loss clears held menu chord and rejects background input")
	fairy.focused=true; help_before=fairy.help_visible; tap(JOY_BUTTON_START); check(fairy.help_visible!=help_before,"Unmodified Start still toggles help on release")
	finish()
func finish():
	fairy.stop(); print("FAIRY_GUIDE_PLAYTHROUGH_RESULT ",JSON.stringify({"checks":checks,"failures":failures})); quit(0 if failures.is_empty() else 1)
