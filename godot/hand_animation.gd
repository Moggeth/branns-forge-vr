extends RefCounted
## Controller pose remains authoritative. Joint data supplies bounded finger flex only.
const RESPONSE=24.0
const MAX_BEND=1.45
const CHAINS=[[6,7,8,9,10],[11,12,13,14,15],[16,17,18,19,20],[21,22,23,24,25],[2,3,4,5]]

static func bends(tracker:XRHandTracker,chain:Array)->Array:
	if tracker==null or not tracker.has_tracking_data: return []
	var points=[]
	for index in chain:
		if not (tracker.get_hand_joint_flags(index)&XRHandTracker.HAND_JOINT_FLAG_POSITION_VALID): return []
		var point=tracker.get_hand_joint_transform(index).origin
		if not point.is_finite(): return []
		points.append(point)
	var result=[]
	for i in range(1,points.size()-1):
		var a:Vector3=points[i]-points[i-1]
		var b:Vector3=points[i+1]-points[i]
		if a.length()<0.003 or b.length()<0.003 or a.length()>0.15 or b.length()>0.15: return []
		result.append(clampf(a.angle_to(b),0,MAX_BEND))
	return result

static func tick(hand:Node3D,holding:bool,delta:float):
	if not hand.has_meta("finger_joints"): return
	holding=holding or hand.get_meta("anchored_grip",false)
	var left=hand is XRController3D and str(hand.tracker).begins_with("left")
	var tracker:XRHandTracker=XRServer.get_tracker("/user/hand_tracker/left" if left else "/user/hand_tracker/right") if hand is XRController3D else null
	var grip=clampf(hand.get_float("grip"),0,1) if hand is XRController3D else 0.0
	var trigger=clampf(hand.get_float("trigger"),0,1) if hand is XRController3D else 0.0
	var joints:Array=hand.get_meta("finger_joints",[])
	var valid=0
	for finger in range(5):
		var values=bends(tracker,CHAINS[finger])
		if not values.is_empty(): valid+=1
		var finger_nodes:Array=joints.slice(finger*3,finger*3+3) if finger<4 else hand.get_meta("thumb_joints",[])
		for segment in range(finger_nodes.size()):
			var fallback=(trigger if finger==0 else grip)*1.05
			var angle=float(values[segment]) if segment<values.size() else fallback
			# Held tools need a stable wrapped silhouette, but lifted fingers can still articulate.
			if holding: angle=clampf(angle,0.35,1.15) if not values.is_empty() else 0.95
			if hand.get_meta("archery_arrow",false):
				angle=clampf(angle,0.15,1.2) if not values.is_empty() else (0.9 if finger in [0,4] else (0.55 if finger==1 else 0.22))
			if finger==0 and hand.get_meta("siege_trigger",-1.0)>=0:
				angle=lerpf(0.35,1.08,float(hand.get_meta("siege_trigger")))
			angle=clampf(angle*float(hand.get_meta("living_curl",1.0)),0,MAX_BEND)
			var node:Node3D=finger_nodes[segment]
			node.rotation=node.rotation.lerp(Vector3(-angle,0,0),1.0-exp(-RESPONSE*delta))
	if hand.has_meta("siege_finger_target") and joints.size()>=3:
		seat_index(joints.slice(0,3),hand.get_meta("siege_finger_target"),delta,hand.get_meta("index_tip",null))
	var mode="joints:%d/5"%valid if valid>0 else "controller fallback"
	if hand.get_meta("finger_tracking_mode","")!=mode:
		hand.set_meta("finger_tracking_mode",mode)
		print("HAND_TRACKING hand=", "left" if left else "right", " mode=",mode," tracker=",tracker!=null," active=",tracker.has_tracking_data if tracker!=null else false," source=",tracker.hand_tracking_source if tracker!=null else -1," controller_active=",hand.get_is_active() if hand is XRController3D else false)

# Three short finger links seat the fingertip on the moving trigger shoe.
# The real controller and remaining tracked fingers remain authoritative.
static func seat_index(joints:Array,target:Vector3,delta:float,tip:Node3D=null):
	var root:Vector3=joints[0].global_position
	var points=[root,joints[1].global_position,joints[2].global_position,tip.global_position if is_instance_valid(tip) else joints[2].to_global(Vector3(0,0,-0.025))]
	var lengths=[]
	for i in range(3): lengths.append(points[i].distance_to(points[i+1]))
	var reach=float(lengths[0])+float(lengths[1])+float(lengths[2])
	if root.distance_to(target)>reach*1.6: return
	target=root+(target-root).limit_length(reach*0.98)
	for iteration in range(8):
		points[3]=target
		for i in range(2,-1,-1): points[i]=points[i+1]+(points[i]-points[i+1]).normalized()*float(lengths[i])
		points[0]=root
		for i in range(3): points[i+1]=points[i]+(points[i+1]-points[i]).normalized()*float(lengths[i])
	var palm_basis:Basis=joints[0].get_parent().global_basis.orthonormalized()
	for i in range(3):
		var direction:Vector3=(points[i+1]-points[i]).normalized()
		var up=palm_basis.y if absf(direction.dot(palm_basis.y))<0.95 else palm_basis.x
		var desired=Basis.looking_at(direction,up)
		joints[i].global_basis=desired.scaled(joints[i].global_basis.get_scale())
