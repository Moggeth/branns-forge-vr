extends Node
var failures=[]
func check(ok,message):
	if not ok: failures.append(message)

func bottle(game,pos,lit):
	var vial=game.firecraft._prop("vial",pos)
	if lit: game.firecraft._light(vial)
	vial.set_meta("impact_speed",3.0)
	game.firecraft._impact(vial)

func run(game):
	game.set_process(false); game.smoke=true
	var combat=game.firecraft.fluid
	check(combat!=null,"Opt-in adapter available")
	await get_tree().physics_frame
	await get_tree().physics_frame
	var pos=Vector3(0,.15,8)
	bottle(game,pos,false)
	check(is_equal_approx(combat.remaining_fuel(),8.0),"Pending impact reserves capacity during scan")
	check(game.firecraft.pools.is_empty(),"Opt-in impact bypasses legacy fire pools")
	var entry=combat.fields.forge_yard
	for i in range(32): combat.scan(entry)
	var f=entry.field
	check(entry.ready,"Bounded surface scan completes")
	check(is_equal_approx(f.total_fuel(),8.0),"Actual unlit bottle creates eight units of persistent fuel")
	check(f.flames.multimesh.visible_instance_count==0,"Unlit bottle cannot ignite itself")
	bottle(game,pos,true)
	check(f.flames.multimesh.visible_instance_count>0,"Lit bottle ignites existing spill")
	for i in range(38): bottle(game,pos,false)
	check(absf(combat.remaining_fuel()-320)<.001,"Forty real impact events admitted")
	bottle(game,pos,true)
	check(combat.rejected==1 and absf(combat.remaining_fuel()-320)<.001,"Forty-first impact preserves existing fuel")
	# An isolated straight fuel trail tests stationary contact ignition and remote damage.
	f.fuel.fill(0); f.burning.fill(0); f.heights.fill(1000); f.wet.fill(0)
	var start=32*f.N+24
	for i in range(12): f.heights[start+i]=.04; f.fuel[start+i]=1.0
	var target=f.point(start+11)
	var ghost=game.firecraft._ghost("forge_yard",target)
	game.camera.global_position=Vector3(100,2,100)
	combat.apply_damage(f,.1)
	check(ghost.get_meta("hp")==36.0,"Unlit fuel does not damage ghost")
	game.firecraft.hurt_ghost(ghost,999,"physical")
	check(ghost.get_meta("hp")==36.0,"Ghost remains immune to non-fire damage")
	f.burning[start]=1
	for i in range(14): f.simulation(.1)
	check(f.burning[start+11]>0,"Fire reaches far end without another bottle")
	for i in range(3): combat.apply_damage(f,.1)
	check(not ghost.get_meta("alive"),"Chain-ignited fuel kills ghost through fire damage route")
	# Player safety: floor-level fire damages once per cooldown, not once per burning cell.
	game.camera.global_position=target+Vector3.UP*1.5
	game.shield_until=0; game.hurts_until=0; game.elapsed=10; game.adventure.hp=100
	combat.apply_damage(f,.1); combat.apply_damage(f,.1)
	check(game.adventure.hp==95,"Player fire damage respects cooldown")
	var volume=f.total_fuel(); var origin=f.ORIGIN
	game.adventure.travel("crystal_hollow"); combat.tick(.1)
	check(not f.visible and is_equal_approx(f.total_fuel(),volume),"Inactive zone fuel retained and paused")
	game.adventure.travel("forge_yard"); combat.tick(0)
	check(f.visible and f.ORIGIN==origin,"Returning restores original anchored patch")
	for i in range(230): f.simulation(.5)
	check(f.total_fuel()<.0001 and f.flames.multimesh.visible_instance_count==0,"Chain burns out completely")
	f.fuel[start]=1; f.burning[start]=1; f.wet.fill(1); f.simulation(.1)
	check(f.burning[start]==0,"Soaked fuel extinguishes")
	# Exercise the actual RigidBody contact signal, not just the impact helper.
	var falling=game.firecraft._prop("vial",pos+Vector3.UP*2)
	game.firecraft._attach(game.desktop_hand,falling)
	falling.set_meta("velocity",Vector3(0,-4,0)); game.firecraft.release(game.desktop_hand)
	falling.get_meta("body").global_position=pos+Vector3.UP*2
	for i in range(60): await get_tree().physics_frame
	check(not is_instance_valid(falling) or falling.get_meta("shattered",false),"Physical bottle contact reaches impact route")
	game.adventure.travel("crystal_hollow")
	await get_tree().physics_frame
	await get_tree().physics_frame
	var cave_ghost=game.firecraft.ghosts.filter(func(g):return g.get_meta("zone")=="crystal_hollow")[0]
	var cave_pos=cave_ghost.global_position+Vector3.UP*.2
	bottle(game,cave_pos,false)
	var cave=combat.fields.crystal_hollow
	for i in range(32): combat.scan(cave)
	check(cave.field.total_fuel()>7.99,"Cave spill lands beneath ceiling, not on roof")
	check(f.total_fuel()>0,"Creating cave field retains forge fuel")
	print("FUEL_COMBAT_CHECK_RESULT ",JSON.stringify(failures))
	get_tree().quit(0 if failures.is_empty() else 1)
