extends SceneTree

const Ring=preload("res://playful_tools.gd")
const Apple=preload("res://apple_runtime.gd")
const Firecraft=preload("res://firecraft.gd")
const Torch=preload("res://hearth_torch.gd")
const Living=preload("res://living_components.gd")

class FakeAdventure:
	extends RefCounted
	var motion={}
	func haptic(_hand,_kind): pass

class FakeTuning:
	extends RefCounted
	func value(_key): return 1.0

class FakeGame:
	extends Node3D
	var camera:Camera3D
	var desktop_hand:Node3D
	var desktop_release_mode="drop"
	var playful_feedback=null
	var adventure=FakeAdventure.new()
	var tuning=FakeTuning.new()

var failures=[]
var count=0

func check(ok:bool,message:String):
	count+=1
	if not ok: failures.append(message)

func _initialize(): run.call_deferred()

func run():
	var start=Time.get_ticks_usec()
	var game=FakeGame.new(); root.add_child(game)
	game.camera=Camera3D.new(); game.add_child(game.camera)
	game.desktop_hand=Node3D.new(); game.add_child(game.desktop_hand)
	var ring=Ring.new(); game.add_child(ring); ring.game=game
	ring.ring=Node3D.new(); game.desktop_hand.add_child(ring.ring)
	ring.held_label=Label3D.new(); ring.add_child(ring.held_label)
	ring.sound=AudioStreamPlayer3D.new(); ring.add_child(ring.sound)
	for i in range(3): ring.sounds.append(AudioStreamWAV.new())
	ring.holder=game.desktop_hand; ring.state="held"
	check(ring.release(game.desktop_hand),"Desktop E releases held ring")
	check(ring.state=="dropped" and ring.velocity==Vector3.ZERO and ring.throw_id==0,"E has zero launch speed and creates no scoring throw")
	check(ring.ring.get_parent()==game,"Dropped ring is world anchored")
	ring._flight_step(.02)
	check(ring.velocity.y<0 and ring.velocity.z==0,"Dropped ring falls without forward drift")
	ring.ring.reparent(game.desktop_hand); ring.holder=game.desktop_hand; ring.state="held"
	game.desktop_release_mode="throw"
	check(ring.release(game.desktop_hand),"Desktop X releases held ring")
	check(ring.state=="flying" and ring.velocity.length()>4 and ring.throw_id==1,"X retains deliberate ring flight")
	check(Apple!=null and Firecraft!=null and Torch!=null and Living!=null,"Managed release scripts load in native engine")
	print("DESKTOP_MANAGED_RELEASE_CHECK_RESULT ",JSON.stringify({"checks":count,"failures":failures,"seconds":(Time.get_ticks_usec()-start)/1000000.0}))
	quit(0 if failures.is_empty() else 1)
