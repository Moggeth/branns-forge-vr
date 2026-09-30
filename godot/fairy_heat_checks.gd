extends SceneTree
var failures=[]
var checks=0
var game
var fairy
var hand
var flame
func check(ok,message):
	checks+=1
	if not ok: failures.append(message); print("HEAT_ASSERT ",message)
func _initialize():
	create_timer(45.0).timeout.connect(func():
		printerr("FAIRY_HEAT_RESULT timeout=45")
		quit(2))
	run.call_deferred()
func vial_at(wick:Vector3):
	var n=game.firecraft._prop("vial",wick-Vector3.UP*.215)
	return n
func sweep(wick:Vector3): hand.heat_sweep(wick-Vector3.RIGHT*.25,wick+Vector3.RIGHT*.25)
func run():
	game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	if game.firecraft.fluid == null:
		printerr("FAIRY_HEAT_RESULT missing fluid: add --experimental-fuel-combat to the offline diagnostic arguments")
		quit(2)
		return
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true
	game.adventure.travel("forge_yard"); game._start_fairy()
	fairy=game.fairy; fairy.test_mode=true; fairy.window.hide(); hand=fairy.handheld
	fairy.avatar.global_position=Vector3(400,100,400)
	flame=game.firecraft._prop("match",fairy.avatar.global_position)
	fairy.pick_up(flame); hand.item=flame
	var wick=Vector3(400,100,400)
	var vial=vial_at(wick)
	sweep(wick); check(vial.get_meta("state")=="fresh","Fresh match cannot ignite a swept wick")
	flame.set_meta("state","spent"); sweep(wick)
	check(vial.get_meta("state")=="fresh","Spent match cannot ignite a swept wick")
	flame.set_meta("state","lit"); flame.set_meta("until",game.elapsed-1); sweep(wick)
	check(vial.get_meta("state")=="fresh","Expired flame cannot ignite a swept wick")
	flame.set_meta("until",game.elapsed+10)
	var changes=hand.heat_sweep(wick-Vector3.RIGHT*.25,wick+Vector3.RIGHT*.25)
	check(vial.get_meta("state")=="lit" and changes==1,"Lit match sweep lights a wick between frames and reports one transition")
	check(hand.heat_sweep(wick-Vector3.RIGHT*.25,wick+Vector3.RIGHT*.25)==0,"Already burning wick does not report another ignition")
	vial.set_meta("state","fresh"); vial.hide(); sweep(wick)
	check(vial.get_meta("state")=="fresh","Invisible vial is not heated")
	vial.show(); vial.set_meta("zone","crystal_hollow"); sweep(wick)
	check(vial.get_meta("state")=="fresh","Inactive-zone vial is not heated even if visible")
	vial.set_meta("zone","forge_yard")
	hand.heat_sweep(wick-Vector3.RIGHT,wick+Vector3.RIGHT)
	check(vial.get_meta("state")=="fresh","Teleport-length sweep never lights a target")
	var wall=StaticBody3D.new(); game.add_child(wall); wall.position=wick-Vector3.RIGHT*.1
	var collider=CollisionShape3D.new(); var shape=BoxShape3D.new(); shape.size=Vector3(.03,1,1); collider.shape=shape; wall.add_child(collider)
	await physics_frame; await physics_frame
	sweep(wick); check(vial.get_meta("state")=="fresh","Wall clips heat before a wick behind it")
	hand.heat_sweep(wall.global_position,wick)
	check(vial.get_meta("state")=="fresh","Match starting inside a wall cannot ignite outside it")
	wall.global_position=wick
	await physics_frame; await physics_frame
	hand.heat_sweep(wick,wick)
	check(vial.get_meta("state")=="fresh","Stationary match inside a wall cannot ignite co-located wick")
	wall.position.x-=5
	await physics_frame; await physics_frame
	flame.hide(); sweep(wick)
	check(vial.get_meta("state")=="fresh","Hidden source cannot ignite")
	flame.show(); flame.set_meta("zone","crystal_hollow"); sweep(wick)
	check(vial.get_meta("state")=="fresh","Inactive-zone source cannot ignite")
	flame.set_meta("zone","forge_yard"); fairy.carry=null; sweep(wick)
	check(vial.get_meta("state")=="fresh","Stale action item no longer held cannot ignite")
	fairy.carry=flame; fairy.active=false; sweep(wick)
	check(vial.get_meta("state")=="fresh","Stopped fairy cannot ignite")
	fairy.active=true
	vial.position+=Vector3(0,5,0)
	await physics_frame; await physics_frame
	var field=preload("res://weather_lab.gd").new(); game.add_child(field); field.setup(null,true,true)
	field.ORIGIN=Vector2(388,388); field.heights.fill(100)
	var old_entry=game.firecraft.fluid.fields.get("forge_yard",{})
	game.firecraft.fluid.fields["forge_yard"]={"field":field,"ready":true}
	var index=field.cell_index(wick); var surface=field.point(index); field.fuel[index]=1
	hand.heat_sweep(surface+Vector3(-.25,.04,0),surface+Vector3(.25,.04,0))
	check(field.burning[index]==1,"Swept tip ignites real shared-grid fuel")
	check(hand.heat_cells_checked<=16,"Local sweep scans at most sixteen cells rather than all 4096")
	field.burning.fill(0); wall.global_position=surface+Vector3(-.1,.04,0)
	await physics_frame; await physics_frame
	hand.heat_sweep(surface+Vector3(-.25,.04,0),surface+Vector3(.25,.04,0))
	check(field.burning[index]==0,"Wall blocks swept shared-grid fuel ignition")
	wall.position.x-=5
	await physics_frame; await physics_frame
	var start=Time.get_ticks_usec()
	for i in range(1000):
		field.burning[index]=0
		hand.heat_sweep(surface+Vector3(-.25,.04,0),surface+Vector3(.25,.04,0))
	print("HEAT_SCAN_BENCH calls=1000 elapsed_ms=",(Time.get_ticks_usec()-start)/1000.0," cells_per_call=",hand.heat_cells_checked)
	if old_entry.is_empty(): game.firecraft.fluid.fields.erase("forge_yard")
	else: game.firecraft.fluid.fields["forge_yard"]=old_entry
	field.queue_free(); wall.queue_free(); hand.item=null; fairy.stop()
	await process_frame
	print("FAIRY_HEAT_RESULT ",JSON.stringify({"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
