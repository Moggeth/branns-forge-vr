extends SceneTree
var failures:Array=[]
var checks=0
var game

func check(ok:bool,label:String):
	checks+=1
	if not ok: failures.append(label); print("PUMPKIN_ASSERT ",label)

func _initialize(): run.call_deferred()

func run():
	game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true
	game.adventure.travel("forge_yard")
	check(game.pumpkins.pumpkins.size()==4,"four physical pumpkin targets")
	var blunt=Node3D.new(); blunt.set_meta("id",game.sunfall.ITEM_ID); game.add_child(blunt)
	var axe=Node3D.new(); axe.set_meta("id","woodland_axe"); game.add_child(axe)
	var pick=Node3D.new(); pick.set_meta("id","quarry_pick"); game.add_child(pick)
	var first=game.pumpkins.pumpkins[0]
	game.pumpkins.impact(first.body,blunt,first.body.global_position,Vector3.RIGHT,Vector3.LEFT)
	check(first.state=="whole","gentle nudge leaves pumpkin whole")
	game.elapsed+=0.25
	for stab in 3:
		game.pumpkins.impact(first.body,pick,first.body.global_position,Vector3.FORWARD,Vector3.BACK*3)
		game.elapsed+=0.25
	check(first.state=="whole" and first.stabs==3 and first.face.get_child_count()>=8,"three stabs carve glowing jack-o-lantern")
	var finished_face_parts=first.face.get_child_count()
	game.melee.strike(first.body,first.body.global_position,Vector3.FORWARD,3,null,pick)
	check(first.stabs==3 and first.face.get_child_count()==finished_face_parts,"later stabs retain one finished face")
	game.elapsed+=0.25
	game.melee.strike(first.body,first.body.global_position,Vector3.FORWARD,3,null,axe)
	check(first.state=="broken","real melee contact slices carved pumpkin")
	for scrap in game.pumpkins.scraps: scrap.body.queue_free()
	game.pumpkins.scraps.clear()
	var second=game.pumpkins.pumpkins[1]
	game.pumpkins.impact(second.body,axe,second.body.global_position,Vector3.RIGHT,Vector3.UP*4)
	check(second.state=="broken" and game.pumpkins.scraps.size()==2,"blade divides pumpkin into two physical halves")
	var first_axis:Vector3=game.pumpkins.scraps[0].body.global_basis.x
	var third=game.pumpkins.pumpkins[2]
	axe.rotation.y=0.85
	game.pumpkins.impact(third.body,axe,third.body.global_position,Vector3.RIGHT,Vector3.UP*4)
	var second_axis:Vector3=game.pumpkins.scraps[2].body.global_basis.x
	check(absf(first_axis.dot(second_axis))<0.85,"wrist roll changes slice orientation")
	var fourth=game.pumpkins.pumpkins[3]
	game.pumpkins.impact(fourth.body,blunt,fourth.body.global_position,Vector3.RIGHT,Vector3.LEFT*4)
	check(fourth.state=="broken" and game.pumpkins.scraps.size()==12,"blunt strike makes eight colliding chunks")
	check(game.sunfall.sounds.size()==8,"Sunfall has eight distinct boom-bonk recordings")
	var floor=StaticBody3D.new(); floor.set_meta("kind","floor"); game.add_child(floor)
	game.elapsed+=0.25
	check(game.sunfall.impact(blunt,floor,Vector3(0,0,4),Vector3.UP,3,null,Vector3.DOWN*3),"Sunfall strikes solid ground")
	check(game.sunfall.waves.size()==1 and game.sunfall.waves[0].spikes.size()==12,"ground strike spreads fiery earth spikes")
	game.adventure.travel("pinewood_ruins")
	var enemy=null
	for candidate in game.scene.enemies:
		if str(candidate.get_meta("zone",""))=="pinewood_ruins" and str(candidate.get_meta("enemy_type",""))=="skeleton": enemy=candidate; break
	check(enemy!=null,"Pinewood skeleton fixture exists")
	if enemy!=null:
		var before=game.remains.bodies.size()
		game.elapsed+=0.25
		game.sunfall.impact(blunt,enemy,enemy.global_position+Vector3.UP,Vector3.FORWARD,4,null,Vector3.FORWARD*4)
		check(not enemy.get_meta("alive",true),"Sunfall explosive smack kills skeleton in one hit")
		check(game.remains.bodies.size()>before,"same hit launches physical bones")
		var fast=false
		for bone in game.remains.bodies.slice(before):
			if bone.linear_velocity.length()>5: fast=true; break
		check(fast,"bones scatter harder than ordinary melee")
	print("PUMPKIN_SUNFALL_RESULT ",JSON.stringify({"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
