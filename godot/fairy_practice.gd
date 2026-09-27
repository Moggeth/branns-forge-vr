extends Node
## Optional, observable practice using existing objects. Never awards or edits progression.
var fairy
var board:Label3D
var stage=-1
var clock=0.0
var completed=false
const TITLES=["A place to land","A little launch","Find your brakes","One tiny match","Strike a light","Share the flame","Leave a little light","Clear the trail"]
const HINTS=["F3 / Start+A offers a hand. Fly close and press F / A to perch.","Press F4 / Start+B to let the practice hand fling you.","Hold Alt / right stick click to brake until nearly still.","Closed box? X: lift · RT: open · X: set down.\nThen X near the open drawer takes ONE match.","Carry a fresh match beside the box. Left click / RT swings it.\nIf spent, drop it and take another. Fly gently!","Touch or swing the lit match across a bottle wick.\nA spent match? Drop it, take another and strike again.","Right click / LT casts glowing dust onto a surface.","Press Delete / Start+LB to clear your dust marks."]
func setup(owner):
	fairy=owner; board=preload("res://world_zones.gd").label(fairy.game.adventure.zone_groups.forge_yard,"",Vector3.ZERO,32,"bdeeff")
	board.name="LittleWingPractice"
	board.font_size=32; board.pixel_size=.0009; board.outline_size=3; board.modulate=Color("bdeeff")
	board.global_position=fairy.game.firecraft.stand.global_position+Vector3(-2.35,1.35,.8); board.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	refresh()
func start():
	if fairy.game.vr or fairy.game.adventure.zone!="forge_yard": fairy.note("Guided solo practice starts at the Forge Yard matchbox."); return
	stage=0; completed=false; fairy.practice_toss=0; fairy.launch_coast=0; fairy.drop(); fairy.detach(Vector3.ZERO); fairy.recall=false; fairy.offer_practice_hand(); refresh()
	print("FAIRY_PRACTICE started")
func stop():
	stage=-1; refresh()
func toggle(retry=false):
	if retry or stage<0: start()
	else: stop(); fairy.note("Practice paused. F2 starts again whenever you like.")
func record(action:String):
	var expected=["perch","launch","brake","match","lit","ignite","ping","clear"]
	if stage<0 or stage>=expected.size() or action!=expected[stage]: return
	stage+=1
	if stage==expected.size(): stage=-1; completed=true; fairy.note("Lovely flying. Your wings, your adventure. F2 to practise again."); print("FAIRY_PRACTICE completed")
	refresh()
func tick(dt,control):
	clock-=dt
	if clock>0: return
	clock=.1
	if stage<0: return
	if fairy.game.adventure.zone!="forge_yard": stop(); return
	if stage==0 and fairy.perch==fairy.practice_hand and is_instance_valid(fairy.perch): record("perch")
	elif stage==2 and control.brake and fairy.avatar.velocity.length()<.5: record("brake")
	elif stage in [3,4] and is_instance_valid(fairy.carry) and fairy.carry.get_meta("fire_kind","")=="match":
		if stage==3: record("match")
		elif fairy.game.firecraft._burning(fairy.carry): record("lit")
func refresh():
	if not is_instance_valid(board): return
	board.text=("LITTLE WING · FLIGHT & FLAME\n"+("Nicely done! " if completed else "")+"F2 / Start+Y: hands-on practice\nV: camera · C: hover/acro · [ / ]: sensitivity") if stage<0 else ("%d / 8 · %s\n%s\nF2 / Start+Y: pause · Shift+F2 / Start+X: retry"%[stage+1,TITLES[stage],HINTS[stage]])
