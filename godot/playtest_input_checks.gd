extends SceneTree
## Save-free Main input fixture. Use --headless --xr-mode off --path godot --script res://playtest_input_checks.gd.
const Main=preload("res://main.gd")
const Pose=preload("res://desktop_weapon_pose.gd")
const BoneContact=preload("res://skeleton_projectile_contact.gd")

class AdventureStub:
	var game
	var dying=false
	var motion={}
	var keyboard_calls=0
	var release_modes=[]
	func keyboard(_event)->bool:
		keyboard_calls+=1
		return false
	func release(hand,_desktop=false)->void:
		release_modes.append(game.desktop_release_mode)
		game.held.erase(str(hand.get_instance_id()))

class BusyStub:
	func busy(_hand)->bool: return false

class TuningStub:
	var history={}
	func release_velocity(_hand,_throwing=false)->Vector3: return Vector3(3,0,0)

class QolStub:
	var opened=false
	func keyboard(_event)->bool: return false

class BasketStub:
	var actions=0
	var basket=null
	func desktop_action(_key,_hand)->bool:
		actions+=1
		return true

class MagneticStub:
	var consume=false
	var actions=0
	func busy(_hand)->bool: return false
	func secondary(_hand)->bool:
		actions+=1
		return consume

class ExtrasStub:
	var toggles=0
	func desktop_toggle_reel(_hand)->void: toggles+=1
	func tethered(_weapon)->bool: return false

class SiegebirdStub:
	var extras:=ExtrasStub.new()
	var weapons=[]
	func busy(_hand)->bool: return false
	func desktop_weapon(_hand): return null

class MeleeStub:
	var alternate_calls=0
	func handles(item)->bool: return str(item.get_meta("id",""))=="woodland_axe"
	func alternate(_item,_hand)->void: alternate_calls+=1

class ArcheryStub:
	var bow=null
	func busy(_hand)->bool: return false
	func cancel_draw()->void: pass

func _initialize()->void: call_deferred("_run")

func _key(code:int)->InputEventKey:
	var event:=InputEventKey.new()
	event.physical_keycode=code
	event.pressed=true
	return event

func _run()->void:
	var failures:=[]
	# Attaching Main after the plain Node3D entered the tree avoids its live _ready.
	var game:=Node3D.new()
	root.add_child(game)
	game.set_script(Main)
	game.set_process(false)
	game.set_process_input(false)
	game.set_process_unhandled_input(false)
	game.rig=Node3D.new(); game.add_child(game.rig)
	game.camera=Camera3D.new(); game.rig.add_child(game.camera); game.camera.position.y=1.65
	game.desktop_hand=Node3D.new(); game.camera.add_child(game.desktop_hand)
	game.adventure=AdventureStub.new(); game.adventure.game=game
	game.tuning=TuningStub.new()
	game.qol=QolStub.new()
	game.firecraft=BusyStub.new()
	game.workshop=BusyStub.new()
	game.enchantments=BusyStub.new()
	game.living=BusyStub.new()
	game.siegebird=SiegebirdStub.new()
	game.magnetic_wand=MagneticStub.new()
	game.skull_basket=BasketStub.new()
	game.melee=MeleeStub.new()
	game.archery=ArcheryStub.new()
	var hand_key:=str(game.desktop_hand.get_instance_id())
	var axe:=Node3D.new(); axe.set_meta("id","woodland_axe"); axe.set_meta("tip",Vector3.UP*.65)
	game.desktop_hand.add_child(axe)
	game.held[hand_key]=axe
	game._unhandled_input(_key(KEY_E))
	if game.adventure.release_modes!=["drop"] or game.held.has(hand_key): failures.append("E did not gently drop held item")
	game.held[hand_key]=axe
	game._unhandled_input(_key(KEY_X))
	if game.adventure.release_modes!=["drop","throw"] or game.held.has(hand_key): failures.append("X did not explicitly throw held item")
	game.held[hand_key]=axe
	game.magnetic_wand.consume=true
	game._unhandled_input(_key(KEY_X))
	if not game.held.has(hand_key) or game.magnetic_wand.actions!=2: failures.append("magnetic X action lost priority over item throw")
	game.skull_basket.actions=0
	var old_keyboard:int=game.adventure.keyboard_calls
	game._unhandled_input(_key(KEY_F))
	if game.skull_basket.actions!=1 or game.adventure.keyboard_calls!=old_keyboard: failures.append("basket F lost priority over destination F")
	game._unhandled_input(_key(KEY_C))
	if game.siegebird.extras.toggles!=1: failures.append("C did not dispatch reel fitting")
	game.desktop_locomotion.grounded=true
	game._unhandled_input(_key(KEY_SPACE))
	if game.desktop_locomotion.vertical_speed<=0: failures.append("Space did not request FPS jump")
	game._unhandled_input(_key(KEY_9))
	# Axe RMB dispatch and the visible swing trajectory use the actual Main callbacks.
	var right:=InputEventMouseButton.new(); right.button_index=MOUSE_BUTTON_RIGHT; right.pressed=true
	game._unhandled_input(right)
	if game.melee.alternate_calls!=1: failures.append("axe RMB did not arm Power Cleave")
	game.desktop_swing_ready=0
	var left:=InputEventMouseButton.new(); left.button_index=MOUSE_BUTTON_LEFT; left.pressed=true
	game._unhandled_input(left)
	if game.desktop_swing_started<0 or game.desktop_swing_ready<=game.elapsed: failures.append("axe LMB did not start visible swing")
	var rest:=Pose.idle(0,0,0)
	for progress in [0.2,0.5,0.8]:
		game.desktop_hand.transform=Pose.swing(axe,progress,rest,1.4)
		var tip:Vector3=game.camera.to_local(axe.to_global(Vector3.UP*.65))
		var expected:=Vector3(.42,.36,-1.26) if progress==.2 else (Vector3(0,0,-1.4) if progress==.5 else Vector3(-.46,-.40,-1.26))
		if tip.distance_to(expected)>.025: failures.append("swing tip missed aim at %.1f"%progress)
	var idle:=Pose.idle(1.0,0.0,0.0)
	if idle.origin.distance_to(Vector3(.35,-.35,-.55))>.01: failures.append("idle pose drifted out of view")
	if not game._desktop_hint().contains("Power Cleave") or not game._desktop_hint().contains("E drop · X throw"):
		failures.append("axe hint omitted actual input bindings")
	var sun:=Node3D.new(); sun.set_meta("id","sunskipper")
	game.add_child(sun); game.held[hand_key]=sun
	if not game._desktop_hint().contains("E drop · X throw"): failures.append("Sunskipper hint still claims E throw")
	# Desktop key events must not alter the independent headset path.
	game.vr=true
	game.desktop_locomotion.reset()
	game._unhandled_input(_key(KEY_E))
	game._unhandled_input(_key(KEY_SPACE))
	if not game.held.has(hand_key) or game.desktop_locomotion.vertical_speed!=0: failures.append("FPS E/Space leaked into VR")
	var benchmark:=_bone_query_benchmark(game)
	print("BONE_CONTACT_BENCHMARK ",JSON.stringify(benchmark))
	print("PLAYTEST_INPUT_RESULT ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 5)

func _bone_query_benchmark(game: Node3D)->Dictionary:
	# Co-locate the actors so every bolt tests every mesh; this is a worst-case
	# bone-query measurement, separate from the live broad-phase and physics ray.
	var actors:=[]
	var rigs:=[]
	var cube:=BoxMesh.new()
	cube.size=Vector3(.16,.30,.12)
	for actor_index in range(20):
		var actor:=Node3D.new()
		actor.set_meta("alive",true)
		game.add_child(actor)
		var homes:=[]
		for part_index in range(7):
			var piece:=Node3D.new()
			piece.name="Skull" if part_index==0 else "Bone_%d"%part_index
			piece.position=Vector3((part_index%3-1)*.22,1.0+part_index*.12,0)
			actor.add_child(piece)
			var mesh:=MeshInstance3D.new()
			mesh.mesh=cube
			piece.add_child(mesh)
			homes.append({"piece":piece})
		actors.append(actor)
		rigs.append({"homes":homes,"joints":{}})
	var scenarios:=[]
	for spread in [false,true]:
		for actor_index in range(20): actors[actor_index].position.x=actor_index*3.0 if spread else 0.0
		var started:=Time.get_ticks_usec()
		var hits:=0
		for bolt_index in range(20):
			var x:float=bolt_index*3.0+.18 if spread else (0.0 if bolt_index%2==0 else .18)
			var start:=Vector3(x,1.72,.7)
			var finish:=Vector3(x,1.72,-.7)
			for actor_index in range(20):
				if not BoneContact.contact(actors[actor_index],rigs[actor_index],start,finish).is_empty(): hits+=1
		var elapsed_ms:=float(Time.get_ticks_usec()-started)/1000.0
		scenarios.append({"layout":"spread" if spread else "overlap","actors":20,"bolts":20,"queries":400,"hits":hits,"total_ms":snappedf(elapsed_ms,.01),"per_bolt_ms":snappedf(elapsed_ms/20.0,.01)})
	return {"scenarios":scenarios}
