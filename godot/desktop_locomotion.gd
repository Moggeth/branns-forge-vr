extends RefCounted
## Feet-based FPS motion. The existing game capsule and floor tags remain authoritative.
const GRAVITY=18.0
const JUMP_SPEED=5.85 # 0.95 m above takeoff with this gravity.
const FALL_SPEED=22.0
const COYOTE_SECONDS=.10
const FEET_OFFSET=.02
const MAX_FRAME=.25
const MAX_HORIZONTAL=1.92
var vertical_speed=0.0
var grounded=false
var coyote_left=0.0
# Keep this lock through takeoff: a floor ray still hits on the jump frame.
# Without it, a second Space request re-arms from that same floor contact.
var jump_locked=false

func reset():
	vertical_speed=0.0
	grounded=false
	coyote_left=0.0
	jump_locked=false

func _floor(game,feet:Vector3,above:float,below:float)->Dictionary:
	var start=feet+Vector3.UP*above
	var end=feet+Vector3.DOWN*below
	var query=PhysicsRayQueryParameters3D.create(start,end,1)
	var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty() or hit.normal.y<.8: return {}
	var owner=game._owner(hit.collider)
	if owner==null or owner.get_meta("kind","") not in ["floor","solid"]: return {}
	return hit

func request_jump(game)->bool:
	if game.vr: return false
	if jump_locked: return false
	if not grounded:
		var feet:Vector3=game.rig.global_position
		var support=_floor(game,feet,.25,.16)
		if not support.is_empty() and absf(float(support.position.y)+FEET_OFFSET-feet.y)<.10: grounded=true
	if not grounded and coyote_left<=0.0: return false
	vertical_speed=JUMP_SPEED
	grounded=false
	coyote_left=0.0
	jump_locked=true
	return true

func step(game,horizontal_step:Vector3,delta:float)->void:
	if game.vr or delta<=0.0: return
	var duration=minf(delta,MAX_FRAME)
	var motion=Vector3(horizontal_step.x,0,horizontal_step.z).limit_length(MAX_HORIZONTAL)
	var count=clampi(ceili(maxf(duration/(1.0/90.0),motion.length()/.08)),1,24)
	for i in range(count): _substep(game,motion/count,duration/count)

func _substep(game,horizontal:Vector3,dt:float)->void:
	var feet:Vector3=game.rig.global_position
	if grounded:
		var old_support=_floor(game,feet,.28,.18)
		if old_support.is_empty() or absf(float(old_support.position.y)+FEET_OFFSET-feet.y)>.12:
			grounded=false
			coyote_left=COYOTE_SECONDS
	if horizontal.length_squared()>0.0:
		var destination=feet+horizontal
		if game._player_capsule_clear(destination): feet=destination
		else:
			# A low obstacle can be stepped onto, while a wall remains solid.
			var upper=_floor(game,destination,.36,.5)
			if grounded and not upper.is_empty():
				var rise=float(upper.position.y)+FEET_OFFSET-feet.y
				if rise>0.0 and rise<=.30:
					var stepped=Vector3(destination.x,float(upper.position.y)+FEET_OFFSET,destination.z)
					if game._player_capsule_clear(stepped): feet=stepped
			if feet.x==game.rig.global_position.x and feet.z==game.rig.global_position.z:
				var along_x=feet+Vector3(horizontal.x,0,0)
				if horizontal.x!=0.0 and game._player_capsule_clear(along_x): feet=along_x
				var along_z=feet+Vector3(0,0,horizontal.z)
				if horizontal.z!=0.0 and game._player_capsule_clear(along_z): feet=along_z
	if grounded:
		var support=_floor(game,feet,.34,.42)
		if not support.is_empty():
			var ground_y=float(support.position.y)+FEET_OFFSET
			var difference=ground_y-feet.y
			if difference>=-.34 and difference<=.30:
				var snapped=Vector3(feet.x,ground_y,feet.z)
				if game._player_capsule_clear(snapped):
					game.rig.global_position=snapped
					vertical_speed=0.0
					coyote_left=COYOTE_SECONDS
					jump_locked=false
					return
		grounded=false
		coyote_left=COYOTE_SECONDS
	game.rig.global_position=feet
	coyote_left=maxf(0.0,coyote_left-dt)
	vertical_speed=maxf(-FALL_SPEED,vertical_speed-GRAVITY*dt)
	var wanted_y=feet.y+vertical_speed*dt
	if vertical_speed<=0.0:
		var landing=_floor(game,feet,.16,maxf(.4,feet.y-wanted_y+.3))
		if not landing.is_empty():
			var land_y=float(landing.position.y)+FEET_OFFSET
			if land_y>=wanted_y and land_y<=feet.y+.06:
				var landed=Vector3(feet.x,land_y,feet.z)
				if game._player_capsule_clear(landed):
					game.rig.global_position=landed
					grounded=true
					vertical_speed=0.0
					coyote_left=COYOTE_SECONDS
					jump_locked=false
					return
	var desired=Vector3(feet.x,wanted_y,feet.z)
	if game._player_capsule_clear(desired):
		game.rig.global_position=desired
		return
	# The capsule reached a ceiling or overhang during this small substep.
	# Binary search keeps the head close to the obstacle without entering it.
	var safe=feet.y
	var blocked=wanted_y
	for i in range(5):
		var middle=(safe+blocked)*.5
		if game._player_capsule_clear(Vector3(feet.x,middle,feet.z)): safe=middle
		else: blocked=middle
	game.rig.global_position=Vector3(feet.x,safe,feet.z)
	vertical_speed=0.0
