extends SceneTree
const Field=preload("res://weather_lab.gd")
const Combat=preload("res://fuel_combat.gd")
var failures=[]
var checks=0

class FuelOnlyField extends "res://weather_lab.gd":
	func set_weather(value:String): weather=value

class SoundStub extends Node:
	var ghosts=[]
	func _sound(_kind,_pos): pass

class GameStub extends Node3D:
	var adventure={"zone":"test"}
	var camera:Node3D
	var firecraft:Node
	func _notice(_message,_seconds): pass

func check(ok:bool,message:String):
	checks+=1
	if not ok: failures.append(message)

func _initialize():
	call_deferred("run")

func run():
	var start=Time.get_ticks_usec()
	var lab=FuelOnlyField.new(); root.add_child(lab); lab.setup(null,true,true)
	var legacy=preload("res://fuel_checks.gd").new().run(lab)
	check(legacy.is_empty(),"Existing 40-potion throughput, conservation, contact ignition, ledge and row-edge checks: "+str(legacy))
	lab.heights.fill(.04); lab.fuel.fill(0); lab.burning.fill(0); lab.wet.fill(0)
	lab.poured=0; lab.burned=0; lab.evaporated=0
	var pos=Vector3(0,.08,3)
	for i in range(160): check(absf(lab.pour(pos,.05)-.05)<.00001,"Measured stream accepts exact 0.05-unit sample")
	check(absf(lab.total_fuel()-8)<.001,"Continuous pouring conserves one bottle")
	check(lab.ignite_near(pos,.8)>0,"Torch-sized contact lights oil")
	lab.update_fluid_visuals(); lab.tick_fire_lights(.1)
	check(lab.fire_lights.size()==3 and lab.fire_light.light_energy>0,"Bounded pooled lights actually illuminate")
	check(lab.fire_lights.all(func(l):return not l.shadow_enabled),"Fluid lights have no shadow-map cost")
	for other in [Vector3(-7,.08,-5),Vector3(7,.08,6),Vector3(5,.08,-5)]: lab.pour(other,8,true)
	lab.update_fluid_visuals(); lab.tick_fire_lights(.1)
	check(lab.light_targets.size()==3 and lab.fire_lights.filter(func(l):return l.light_energy>0).size()==3,"Separated fire regions use only three real lights")
	var oil_before=lab.total_fuel()
	check(lab.extinguish_near(pos,1.2)>0,"Water extinguishes burning cells")
	check(absf(lab.total_fuel()-oil_before)<.0001,"Water does not delete fuel")
	check(lab.ignite_near(pos,1.2)==0,"Soaked oil cannot immediately reignite")
	check(lab.pour(Vector3(99,0,99),1)==0,"Out-of-field pouring leaves container fuel untouched")
	check(lab.pour(pos,-1)==0 and lab.pour(pos,NAN)==0,"Invalid quantities rejected")
	lab.fuel.fill(0); lab.fuel[0]=319.95
	check(absf(lab.pour(pos,1)-.05)<.001 and absf(lab.total_fuel()-320)<.001,"Near capacity returns only accepted remainder")

	var game=GameStub.new(); root.add_child(game)
	game.camera=Node3D.new(); game.add_child(game.camera)
	game.firecraft=SoundStub.new(); game.add_child(game.firecraft)
	var floor_body=StaticBody3D.new(); game.add_child(floor_body)
	var collision=CollisionShape3D.new(); var shape=BoxShape3D.new(); shape.size=Vector3(30,.2,30); collision.shape=shape; floor_body.add_child(collision); floor_body.position.y=-.1
	var adapter=Combat.new(); game.add_child(adapter); adapter.setup(game)
	await physics_frame
	await physics_frame
	check(adapter.pour(Vector3(50,.1,50),"test",1)==0,"Unsupported terrain rejects before reservation")
	check(adapter.fields.is_empty(),"Unsupported terrain creates no stranded field")
	var origin=Vector3(0,.1,0)
	check(adapter.prewarm_region("test",origin,2.5),"Prefab reserves centred region")
	var anchored_origin=adapter.fields.test.field.ORIGIN
	check(adapter.remaining_fuel()==0 and not adapter.fields.test.ready,"Prewarm invents no fuel or completed scan")
	check(adapter.prewarm_region("test",Vector3(100,0,100),4) and adapter.fields.test.field.ORIGIN==anchored_origin,"Repeated prewarm preserves anchored origin")
	check(adapter.pour(Vector3(14,.1,0),"test",1)==0 and adapter.fields.test.field.ORIGIN==anchored_origin,"Outside pour cannot relocate fixed prefab patch even while empty")
	check(absf(adapter.pour(origin,"test",.35)-.35)<.00001,"Adapter admits measured pending quantity")
	check(absf(adapter.remaining_fuel()-.35)<.00001,"Pending reservations use actual amounts, not bottle multiples")
	check(absf(adapter.active_counts().pending_units-.35)<.00001,"Debug pending units are observable")
	adapter.ignite_near(origin,.8)
	var entry=adapter.fields.test
	for i in range(32): adapter.scan(entry)
	check(entry.ready and absf(entry.field.total_fuel()-.35)<.0001,"Surface scan delivers all reserved volume")
	check(entry.field.flames.multimesh.visible_instance_count>0,"Pending torch contact survives scan")
	check(adapter.active_counts().pending_units==0,"Reservations drain on delivery")
	var remaining=320-adapter.remaining_fuel()
	check(absf(adapter.pour(origin,"test",400)-remaining)<.001,"Adapter capacity admits exact remainder")
	check(absf(adapter.remaining_fuel()-320)<.001,"Global 40-potion capacity preserved")
	check(adapter.pour(origin,"test",1)==0,"Full field rejects continuous pour without losing existing fuel")
	check(adapter.extinguish_near(origin,1)>0,"Public water API reaches ready field")
	check(adapter.ignite_near(origin,1)==0,"Public wet barrier blocks instant re-ignition")
	game.adventure.zone="elsewhere"
	check(adapter.pour(origin,"test",1)==0,"Inactive zone cannot consume pour")
	adapter.tick(0)
	check(not entry.field.visible and absf(adapter.remaining_fuel()-320)<.001,"Session retains fuel across travel")
	game.adventure.zone="test"; adapter.tick(0)
	check(entry.field.visible,"Returning restores field visibility")
	entry.field.fuel.fill(0); entry.field.burning.fill(0)
	game.adventure.zone="water_test"
	check(adapter.pour(origin,"water_test",1,true)==1,"Second field receives pending lit oil")
	adapter.extinguish_near(origin,1)
	var water_entry=adapter.fields.water_test
	for i in range(32): adapter.scan(water_entry)
	check(water_entry.field.flames.multimesh.visible_instance_count==0,"Water touch during surface scan remains extinguished")
	check(adapter.ignite_near(origin,1)==0,"Pending water preserves wet barrier after scan")
	for i in range(6): check(adapter.prewarm_region("reserved"+str(i),origin,2.5),"Remaining bounded region reserved")
	check(not adapter.prewarm_region("ninth",origin,2.5) and adapter.fields.size()==8,"Prewarm respects eight-field cap")
	print("FLUID_FOUNDATION_RESULT ",JSON.stringify({"checks":checks,"failures":failures,"seconds":(Time.get_ticks_usec()-start)/1000000.0,"capacity":320,"light_pool":3}))
	lab.queue_free(); game.queue_free()
	await process_frame
	quit(0 if failures.is_empty() else 1)
