extends SceneTree
var checks=0
var failures=[]
func check(ok,message):
	checks+=1
	if not ok: failures.append(message)
func _initialize(): run.call_deferred()
func run():
	var game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game.adventure.travel("forge_yard"); game._start_fairy()
	var f=game.fairy; f.test_mode=true; f.window.hide(); var trails=game.fairy_trails; var bond=f.bond
	check(trails.rooms.size()==3 and trails.rings.size()==8 and trails.moths.size()==18,"Three spaces and bounded effect pools built")
	check(trails.rooms.values().all(func(r):return not r.visible),"Night rooms hidden in forge")
	bond.update_shoulder(); f.avatar.global_position=bond.shoulder.global_position+Vector3.RIGHT*.3; game.elapsed+=1
	bond.perch_on_shoulder(); check(f.perch==bond.shoulder,"Nearby fairy can voluntarily ride shoulder")
	var camera_rotation=game.camera.rotation; game.camera.rotation.z=.7; bond.update_shoulder()
	check(bond.shoulder.global_basis.is_equal_approx(Basis.IDENTITY),"Head roll does not roll shoulder passenger"); game.camera.rotation=camera_rotation
	for i in range(21): game.elapsed+=.1; bond.tick(.1)
	check(bond.light_until>game.elapsed+19 and bond.borrowed.light_energy>0,"Two-second perch gives borrowed light")
	f.health=10; game.adventure.hp=80
	check(bond.duet() and f.health==14 and game.adventure.hp==86,"Perched duet gently heals both players")
	check(not bond.duet() and game.adventure.hp==86,"Duet cooldown prevents repeat healing")
	f.detach(Vector3.ZERO); game.elapsed+=21; bond.tick(.1)
	check(bond.borrowed.light_energy==0,"Borrowed light expires after departing")
	f.avatar.global_position=bond.shoulder.global_position+Vector3.RIGHT*5; bond.perch_on_shoulder()
	check(f.perch==null,"Shoulder perch cannot teleport distant fairy")
	trails.act("visit:glowroot_grotto"); check(game.adventure.zone=="glowroot_grotto" and trails.rooms.glowroot_grotto.visible,"Night-walk action travels through shared zone system")
	var flower=trails.flowers[0]; f.avatar.global_position=flower.node.global_position+Vector3.UP*.6
	await physics_frame; await physics_frame
	trails.tick(.2); check(flower.until>game.elapsed and flower.glow>0,"Fairy proximity wakes nearby glowroot")
	f.avatar.global_position=flower.node.global_position+Vector3.UP*8; game.elapsed+=9
	for i in range(15): trails.tick(.1)
	check(flower.glow==0,"Abandoned glowroot falls asleep")
	trails.act("next"); check(game.adventure.zone=="starlace_archive","Night walks cycle to archive")
	await physics_frame; await physics_frame
	f.avatar.global_position=trails.rooms.starlace_archive.global_position+Vector3(0,1.5,8); trails.pulse(f)
	check(trails.seals.all(func(s):return not s.awake),"Remote pulse cannot unlock seals")
	for seal in trails.seals:
		f.avatar.global_position=seal.node.global_position+Vector3(0,0,1); trails.pulse(f)
	check(trails.archive_open and trails.seals.all(func(s):return s.awake),"Three nearby fairy pulses awaken vault")
	for i in range(30): trails.tick(.1)
	check(trails.archive_gate.position.y>5 and trails.gate_body.collision_layer==1,"Physical gate lifts clear instead of becoming pass-through")
	trails.act("next"); check(game.adventure.zone=="moonwater_causeway","Causeway accessible")
	await physics_frame; await physics_frame
	var stone=trails.steps[0]; f.avatar.global_position=stone.node.global_position+Vector3.UP*.5; trails.tick(.2)
	check(stone.until>game.elapsed+11,"Moonwater remembers nearby fairy light")
	trails.act("comfort"); check(game.scene.zones.moonwater_causeway.environment.ambient_energy>.2,"Comfort setting brightens dark zone")
	trails.act("comfort"); check(game.scene.zones.moonwater_causeway.environment.ambient_energy<.2,"Moody lighting restores")
	for i in range(30): trails.ripple(stone.node.global_position,Color.CYAN)
	check(trails.rings.size()==8,"Repeated magic stays within ring pool")
	trails.tick(2); check(trails.rings.all(func(r):return not r.node.visible),"Effect rings expire")
	trails.act("leave"); check(game.adventure.zone=="forge_yard","Every walk has return action")
	f.stop(); bond.tick(.1); check(bond.borrowed.light_energy==0 and not bond.shoulder.visible,"Stopping companion clears borrowed light")
	print("FAIRY_TRAILS_RESULT ",JSON.stringify({"checks":checks,"failures":failures})); quit(0 if failures.is_empty() else 1)
