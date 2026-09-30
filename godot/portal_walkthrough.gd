extends RefCounted
## A walk-through gateway is a swept player crossing, never a proximity check.
## Main calls tick after locomotion updates the rig and HMD/camera transform.
const HALF_WIDTH=0.55
const BODY_MARGIN=0.12
const HEIGHT_MIN=0.10
const HEIGHT_MAX=2.0
const MAX_STEP=2.5
const MAX_VERTICAL_STEP=1.25
const NEAR_PLANE=0.45
const EXIT_DEPTH=0.65
const COOLDOWN=1.0
const VR_BODY_BACK_OFFSET=0.095 # Matches player_avatar.gd's tracked torso placement.
const VR_COMMIT_DEPTH=0.40 # Head must move well beyond the plane before travel.
const VR_MAX_FRAME_STEP=0.65 # Tracking recenter/teleport is not room-scale walking.
const VR_PENDING_SECONDS=2.0

var previous_head:=Vector3.INF
var previous_torso:=Vector3.INF
var tracked_zone:=""
var cooldown_remaining:=0.0
var latched_portal_id:=0
var pending_portal_id:=0
var pending_direction:=0.0
var pending_seconds:=0.0

func reset(game) -> void:
	if not is_instance_valid(game.camera) or not is_instance_valid(game.rig): return
	previous_head=game.camera.global_position
	previous_torso=_torso(game)
	tracked_zone=str(game.adventure.zone)
	pending_portal_id=0
	pending_direction=0.0
	pending_seconds=0.0

func tick(game, delta: float) -> void:
	if not is_instance_valid(game.camera) or not is_instance_valid(game.rig): return
	cooldown_remaining=maxf(0.0,cooldown_remaining-maxf(delta,0.0))
	var head:Vector3=game.camera.global_position
	var torso:Vector3=_torso(game)
	var zone:=str(game.adventure.zone)
	if previous_head==Vector3.INF or zone!=tracked_zone:
		if previous_head!=Vector3.INF and zone!=tracked_zone: cooldown_remaining=maxf(cooldown_remaining,COOLDOWN)
		reset(game)
		return
	if _too_far(previous_head,head) or _too_far(previous_torso,torso):
		reset(game)
		return
	if game.vr and head.distance_to(previous_head)>VR_MAX_FRAME_STEP:
		reset(game)
		return
	var old_head:=previous_head
	var old_torso:=previous_torso
	previous_head=head
	previous_torso=torso
	if pending_portal_id!=0: pending_seconds+=maxf(delta,0.0)
	if cooldown_remaining>0.0: return
	for portal in game.scene.get("portals",[]):
		if not is_instance_valid(portal) or not portal.is_visible_in_tree(): continue
		if str(portal.get_meta("zone",""))!=zone: continue
		var target:=str(portal.get_meta("target_zone",""))
		if target.is_empty() or target==zone or str(portal.get_meta("action",""))!="travel:"+target: continue
		var id:int=portal.get_instance_id()
		if latched_portal_id==id:
			var local_head:Vector3=portal.to_local(head)
			var local_torso:Vector3=portal.to_local(torso)
			if absf(local_head.z)>EXIT_DEPTH and absf(local_torso.z)>EXIT_DEPTH: latched_portal_id=0
			else: continue
		if game.vr and pending_portal_id==id:
			if _vr_committed(portal,head,torso,pending_direction):
				_travel(game,id,target)
				return
			if pending_seconds>VR_PENDING_SECONDS or portal.to_local(head).z*pending_direction < -NEAR_PLANE:
				pending_portal_id=0
			else: continue
		if not crossed_aperture(portal,old_head,head,old_torso,torso): continue
		if game.vr:
			pending_portal_id=id
			pending_direction=signf(portal.to_local(torso).z)
			pending_seconds=0.0
			if not _vr_committed(portal,head,torso,pending_direction): continue
		_travel(game,id,target)
		return

func _travel(game, id: int, target: String) -> void:
	latched_portal_id=id
	cooldown_remaining=COOLDOWN
	game.adventure.travel(target)
	reset(game)

static func _vr_committed(portal: Node3D, head: Vector3, torso: Vector3, direction: float) -> bool:
	var h:Vector3=portal.to_local(head)
	var body:Vector3=portal.to_local(torso)
	return h.z*direction>=VR_COMMIT_DEPTH and body.z*direction>0.0 and absf(h.x)<=HALF_WIDTH and absf(body.x)<=HALF_WIDTH-BODY_MARGIN and h.y>=HEIGHT_MIN and h.y<=HEIGHT_MAX and body.y>=HEIGHT_MIN and body.y<=HEIGHT_MAX

static func crossed_aperture(portal: Node3D, old_head: Vector3, head: Vector3, old_torso: Vector3, torso: Vector3) -> bool:
	var head_a:Vector3=portal.to_local(old_head)
	var head_b:Vector3=portal.to_local(head)
	var torso_a:Vector3=portal.to_local(old_torso)
	var torso_b:Vector3=portal.to_local(torso)
	# The torso must cross. A head-only lean can put the HMD through the
	# visual plane while the player is still standing in front of the frame.
	if torso_a.z*torso_b.z>=0.0 or absf(torso_a.z-torso_b.z)<0.0001: return false
	var t:float=torso_a.z/(torso_a.z-torso_b.z)
	if t<0.0 or t>1.0: return false
	var h:Vector3=head_a.lerp(head_b,t)
	var body:Vector3=torso_a.lerp(torso_b,t)
	if absf(h.z)>NEAR_PLANE or absf(body.z)>NEAR_PLANE: return false
	if absf(h.x)>HALF_WIDTH or absf(body.x)>HALF_WIDTH-BODY_MARGIN: return false
	if h.y<HEIGHT_MIN or h.y>HEIGHT_MAX: return false
	if body.y<HEIGHT_MIN or body.y>HEIGHT_MAX: return false
	return true

static func _too_far(before: Vector3, after: Vector3) -> bool:
	return Vector2(after.x-before.x,after.z-before.z).length()>MAX_STEP or absf(after.y-before.y)>MAX_VERTICAL_STEP

static func _torso(game) -> Vector3:
	if game.vr:
		# Room-scale walking changes tracked head position without moving XROrigin.
		# This mirrors the avatar chest; a deep crossing threshold above rejects
		# ordinary short leans. Head tracking alone cannot prove feet stepped.
		var eye:Vector3=game.camera.global_position
		var facing:Vector3=-game.camera.global_basis.z
		facing.y=0.0
		if facing.length_squared()<0.01: facing=-game.rig.global_basis.z
		facing=facing.normalized()
		return Vector3(eye.x,game.rig.global_position.y+1.0,eye.z)-facing*VR_BODY_BACK_OFFSET
	# FPS feet/capsule provides an independent body location, so looking or
	# leaning over the plane cannot cross without walking through it.
	return game.rig.global_position+Vector3.UP
