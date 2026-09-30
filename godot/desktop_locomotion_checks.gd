extends SceneTree
## Run with Godot --headless --xr-mode off --path godot --script res://desktop_locomotion_checks.gd
class FakeGame extends Node3D:
	var rig:Node3D
	var vr=false
	func _owner(node):
		while node!=null and node!=self:
			if node.has_meta("kind"): return node
			node=node.get_parent()
		return null
	func _player_capsule_clear(feet:Vector3)->bool:
		var query=PhysicsShapeQueryParameters3D.new()
		var capsule=CapsuleShape3D.new()
		capsule.radius=.2
		capsule.height=1.5
		query.shape=capsule
		query.collision_mask=1
		query.transform=Transform3D(Basis.IDENTITY,feet+Vector3.UP*.95)
		return get_world_3d().direct_space_state.intersect_shape(query,1).is_empty()

func _initialize():
	_run.call_deferred()

func _solid(game:Node3D,label:String,at:Vector3,size:Vector3,kind:String)->StaticBody3D:
	var body=StaticBody3D.new()
	body.name=label
	body.collision_layer=1
	body.collision_mask=1
	body.set_meta("kind",kind)
	game.add_child(body)
	body.position=at
	var collider=CollisionShape3D.new()
	var box=BoxShape3D.new()
	box.size=size
	collider.shape=box
	body.add_child(collider)
	return body

func _run():
	var failures=[]
	var game=FakeGame.new()
	root.add_child(game)
	game.rig=Node3D.new()
	game.add_child(game.rig)
	_solid(game,"Platform",Vector3(0,-.1,0),Vector3(4,.2,4),"floor")
	_solid(game,"Wall",Vector3(1.4,1.0,0),Vector3(.2,2,.9),"solid")
	_solid(game,"Step",Vector3(-.7,.1,1),Vector3(.8,.2,.8),"solid")
	_solid(game,"Ceiling",Vector3(-1.35,2.05,-.8),Vector3(1.2,.12,1.2),"solid")
	await physics_frame
	var mover=preload("res://desktop_locomotion.gd").new()
	game.rig.global_position=Vector3(0,3,0)
	for i in range(120): mover.step(game,Vector3.ZERO,1.0/60.0)
	if absf(game.rig.global_position.y-.02)>.02 or not mover.grounded: failures.append("Gravity must land at supported feet height")
	if not mover.request_jump(game): failures.append("Grounded Space jump rejected")
	if mover.request_jump(game): failures.append("Repeated midair jump accepted")
	var peak=game.rig.global_position.y
	for i in range(120):
		mover.step(game,Vector3.ZERO,1.0/60.0)
		peak=maxf(peak,game.rig.global_position.y)
	if peak<.82 or peak>1.12: failures.append("Jump apex outside generous 0.8–1.1 m band: "+str(peak))
	if not mover.grounded or absf(game.rig.global_position.y-.02)>.02: failures.append("Jump must land without hovering")
	game.rig.global_position=Vector3(0,.02,0)
	mover.reset()
	for i in range(60): mover.step(game,Vector3(.04,0,0),1.0/60.0)
	if game.rig.global_position.x>1.16: failures.append("Horizontal capsule crossed a wall")
	game.rig.global_position=Vector3(-1.35,.02,-.8)
	mover.reset(); mover.step(game,Vector3.ZERO,1.0/60.0)
	if not mover.request_jump(game): failures.append("Low-ceiling jump did not start")
	var ceiling_peak=game.rig.global_position.y
	for i in range(70):
		mover.step(game,Vector3.ZERO,1.0/60.0)
		ceiling_peak=maxf(ceiling_peak,game.rig.global_position.y)
	if ceiling_peak>.43: failures.append("Jump passed through low ceiling")
	game.rig.global_position=Vector3(-1.35,.02,1)
	mover.reset()
	for i in range(35): mover.step(game,Vector3(.026,0,0),1.0/60.0)
	if game.rig.global_position.y<.19 or game.rig.global_position.y>.24: failures.append("Low solid step did not adjust supported height")
	game.rig.global_position=Vector3(1.2,.02,1.5)
	mover.reset()
	for i in range(75): mover.step(game,Vector3(.025,0,0),1.0/60.0)
	if mover.grounded or game.rig.global_position.y>-.5: failures.append("Walking off a ledge must fall instead of hover")
	game.vr=true
	var before=game.rig.global_position
	if mover.request_jump(game): failures.append("VR jump request was accepted")
	mover.step(game,Vector3(1,0,0),.1)
	if game.rig.global_position!=before: failures.append("Desktop helper moved the VR rig")
	print("DESKTOP_LOCOMOTION_RESULT ",JSON.stringify(failures))
	game.free()
	quit(0 if failures.is_empty() else 1)
