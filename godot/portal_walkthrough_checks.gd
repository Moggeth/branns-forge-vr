extends SceneTree
## Fast save-free check: Godot --headless --xr-mode off --path godot --script res://portal_walkthrough_checks.gd
const Walkthrough=preload("res://portal_walkthrough.gd")

class Adventure:
	var game
	var zone:="a"
	var calls:=[]
	func travel(target: String) -> void:
		calls.append(target)
		zone=target
		game.rig.global_position=Vector3(20,0,0.8) if target=="b" else Vector3(0,0,0.8)

class Game extends Node3D:
	var vr:=false
	var rig:=Node3D.new()
	var camera:=Camera3D.new()
	var scene:={"portals":[]}
	var adventure:=Adventure.new()
	func setup() -> void:
		add_child(rig)
		rig.add_child(camera)
		camera.position.y=1.65
		adventure.game=self

func _initialize() -> void:
	call_deferred("_run")

func _portal(game: Game, position: Vector3, source: String, target: String, angle: float=0.0) -> Node3D:
	var portal:=Node3D.new()
	game.add_child(portal)
	portal.global_position=position
	portal.rotation.y=angle
	portal.set_meta("zone",source)
	portal.set_meta("target_zone",target)
	portal.set_meta("action","travel:"+target)
	game.scene.portals.append(portal)
	return portal

func _run() -> void:
	var failures:=[]
	var game:=Game.new()
	root.add_child(game)
	game.setup()
	var a:=_portal(game,Vector3.ZERO,"a","b")
	var b:=_portal(game,Vector3(20,0,0),"b","a")
	var walker:=Walkthrough.new()
	game.rig.global_position=Vector3(0,0,0.8)
	walker.reset(game)
	game.rig.global_position=Vector3(0,0,0.15)
	walker.tick(game,0.016)
	if not game.adventure.calls.is_empty(): failures.append("standing near portal travelled")
	game.rig.global_position=Vector3(0,0,-0.2)
	walker.tick(game,0.016)
	if game.adventure.calls!=["b"]: failures.append("forward crossing missed travel")
	if walker.tracked_zone!="b" or walker.previous_torso.distance_to(game.rig.global_position+Vector3.UP)>0.001:
		failures.append("travel did not reset sweep origin")
	# A crossing at the arrival portal in the next frame cannot bounce home.
	game.rig.global_position=Vector3(20,0,-0.2)
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=1: failures.append("arrival bounced through return portal")
	for i in range(65): walker.tick(game,0.016)
	game.rig.global_position=Vector3(20,0,0.8)
	walker.tick(game,0.016)
	game.rig.global_position=Vector3(20,0,-0.2)
	walker.tick(game,0.016)
	if game.adventure.calls!=["b","a"]: failures.append("return crossing stayed locked after cooldown")
	# Backward entry works independently of portal facing.
	game.adventure.zone="a"
	game.rig.global_position=Vector3(0,0,-0.8)
	walker.reset(game)
	for i in range(65): walker.tick(game,0.016)
	game.rig.global_position=Vector3(0,0,0.2)
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=3: failures.append("backward crossing missed travel")
	# Crossing the plane outside the opening or with the HMD past a post fails.
	game.adventure.zone="a"
	game.rig.global_position=Vector3(0.51,0,0.7)
	walker.reset(game)
	for i in range(65): walker.tick(game,0.016)
	game.rig.global_position=Vector3(0.51,0,-0.5)
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=3: failures.append("outside-post crossing travelled")
	game.rig.global_position=Vector3(0.15,0,0.7)
	game.camera.position.x=0.5
	walker.reset(game)
	game.rig.global_position=Vector3(0.15,0,-0.5)
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=3: failures.append("HMD outside aperture travelled")
	game.camera.position.x=0.0
	# A head-only lean through the membrane is not walking through it.
	game.rig.global_position=Vector3(0,0,0.25)
	game.camera.position.z=0.35
	walker.reset(game)
	game.camera.position.z=-0.35
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=3: failures.append("head lean without torso crossing travelled")
	game.camera.position.z=0.0
	# A full 2 metre step is swept; a discontinuous 4 metre teleport is reset.
	game.rig.global_position=Vector3(0,0,1.1)
	walker.reset(game)
	game.rig.global_position=Vector3(0,0,-0.9)
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=4: failures.append("fast walked crossing missed")
	game.adventure.zone="a"
	game.rig.global_position=Vector3(0,0,2.0)
	walker.reset(game)
	game.rig.global_position=Vector3(0,0,-2.0)
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=4: failures.append("teleport-sized displacement triggered crossing")
	# The local plane test also works after a 90 degree gateway rotation.
	var rotated:=_portal(game,Vector3(40,0,0),"a","b",PI/2.0)
	game.rig.global_position=rotated.to_global(Vector3(0,0,0.8))
	walker.reset(game)
	for i in range(65): walker.tick(game,0.016)
	game.rig.global_position=rotated.to_global(Vector3(0,0,-0.3))
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=5: failures.append("rotated portal crossing missed")
	# In room-scale VR the XROrigin can stay fixed while the HMD walks through.
	game.vr=true
	game.adventure.zone="a"
	game.rig.global_position=Vector3(0,0,1.0)
	game.camera.position=Vector3(0,1.65,-0.2)
	walker.reset(game)
	for i in range(65): walker.tick(game,0.016)
	for i in range(1,8):
		game.camera.position.z=-0.2-float(i)*0.2
		walker.tick(game,0.016)
	if game.adventure.calls.size()!=6: failures.append("tracked VR walk with stationary origin missed portal")
	# A shallow head lean can cross the membrane, but is not a committed walk.
	game.adventure.zone="a"
	game.rig.global_position=Vector3(0,0,0.25)
	game.camera.position=Vector3(0,1.65,0.35)
	walker.reset(game)
	for i in range(65): walker.tick(game,0.016)
	for i in range(1,6):
		game.camera.position.z=0.35-float(i)*0.19
		walker.tick(game,0.016)
	for i in range(130): walker.tick(game,0.016)
	if game.adventure.calls.size()!=6: failures.append("shallow VR head lean caused travel")
	# The same tracked crossing works from the back face of the gateway.
	game.rig.global_position=Vector3(0,0,-1.0)
	game.camera.position.z=0.2
	walker.reset(game)
	for i in range(65): walker.tick(game,0.016)
	for i in range(1,8):
		game.camera.position.z=0.2+float(i)*0.2
		walker.tick(game,0.016)
	if game.adventure.calls.size()!=7: failures.append("reverse tracked VR walk missed portal")
	# A one-frame tracked jump is treated as a recenter, not a walk.
	game.adventure.zone="a"
	game.rig.global_position=Vector3(0,0,1.0)
	game.camera.position.z=0.0
	walker.reset(game)
	game.camera.position.z=-1.5
	walker.tick(game,0.016)
	if game.adventure.calls.size()!=7: failures.append("VR recenter caused portal travel")
	print("PORTAL_WALKTHROUGH_RESULT ",JSON.stringify(failures))
	game.free()
	quit(0 if failures.is_empty() else 5)
