extends SceneTree
var failures=[]
var checks=0
func check(ok:bool,message:String):
	checks+=1
	if not ok: failures.append(message); print("DIRECTOR_ASSERT ",message)
func _initialize(): run.call_deferred()
func run():
	var game=load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var director=game.director
	check(director!=null and director.test_mode,"Director check starts without a live service")
	check(game.adventure.zone=="pinewood_ruins","Director match uses Pinewood")
	check(director.beacons.size()==3,"Three physical waystones exist")
	check(director.original_enemies.size()>0 and not director.original_enemies[0].visible,"Ordinary Pinewood enemies stand down during the match")
	director.apply_command({"type":"start"})
	check(director.phase=="running","Start order begins the round")
	game.camera.global_position=director.beacons[0].root.global_position+Vector3(0,1.7,0)
	director.tick(1.85)
	check(director.beacons[0].claimed,"Adventurer awakens a waystone by holding position")
	director.apply_command({"type":"skeletons","lane":"west"})
	check(director.warnings.size()==1 and director.summons.is_empty(),"Enemy call telegraphs before spawning")
	game.elapsed+=2.3
	director.tick(.02)
	check(director.summons.size()==2 and director.summons[0].get_meta("director_spawned",false),"Telegraph creates two real Godot skeletons")
	var before=game.scene.enemies.size()
	game.adventure.hurt_enemy(director.summons[0],999)
	director.tick(.02)
	check(director.defeated==1 and game.scene.enemies.size()==before,"Director enemies die without creating RPG drops or XP")
	director.apply_command({"type":"gloom","lane":"north"})
	check(director.gloom_until>game.elapsed,"Dusk veil darkens the world")
	game.camera.global_position=director.beacons[1].root.global_position+Vector3(0,1.7,0)
	director.tick(1.85)
	game.camera.global_position=director.beacons[2].root.global_position+Vector3(0,1.7,0)
	director.tick(1.85)
	check(director.phase=="adventurer_win","Three waystones end the round for the adventurer")
	var snapshot=director._snapshot()
	check(snapshot.beacons.size()==3 and snapshot.enemies.size()==2 and snapshot.phase=="adventurer_win","Tabletop snapshot follows authoritative Godot state")
	director.apply_command({"type":"rematch"})
	check(director.phase=="waiting" and director.summons.is_empty() and director._claimed()==0,"Rematch clears summons and waystones")
	print("DIRECTOR_RESULT ",JSON.stringify({"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
