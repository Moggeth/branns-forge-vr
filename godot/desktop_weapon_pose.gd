extends RefCounted
## Camera-space animation; the calibrated item grip remains untouched.
## The authored handle/working-face plane guides the slash, including picks.
##
## Structure (authored base pose + procedural detail, separate idle / action):
##   idle()    restrained breathing + walk sway only; owns the rest transform.
##   profile() per-tool timing. Contact is ALWAYS progress 0.5 so the runtime's
##             authoritative strike lines up with the visible tip-at-target pose.
##   swing()   one continuous spline of the tool tip (anticipation -> accelerating
##             diagonal strike -> through-contact follow -> slow recovery) plus a
##             wrist-rotation spline that lags the position (overlap). Progress 0
##             and 1 reproduce `rest` exactly; progress 0.5 puts the tip exactly at
##             Vector3(0, 0, -reach). No camera motion, no contact reaction: a miss
##             carries straight through contact, a confirmed hit is handled by the
##             runtime's own contact pose.

const CONTACT := 0.5
const DEFAULT_TIP := Vector3.UP * 0.65

static func idle(time:float, phase:float, strength:float)->Transform3D:
	var breath=Vector3(sin(time*1.07)*.0025,sin(time*1.65)*.0035,cos(time*1.3)*.0018)
	var walking=Vector3(sin(phase)*.008,absf(cos(phase))*.012,0)*strength
	var roll=.018*sin(phase)*strength+.003*sin(time*1.19)
	return Transform3D(Basis.from_euler(Vector3(.002*sin(time*1.2),.002*cos(time*.93),roll)),Vector3(.35,-.35,-.55)+breath+walking)

## {duration, contact, cooldown} are the keys the runtime reads. "style"/"id" are
## diagnostics only. Cooldown >= duration; runtime waits max(duration, cooldown).
static func profile(item:Node3D)->Dictionary:
	var id:String=_item_id(item)
	var s:Dictionary=_style(id)
	return {"id":id,"style":s.style,"duration":s.duration,"contact":CONTACT,"cooldown":s.cooldown}

static func _item_id(item:Node3D)->String:
	if item == null or not is_instance_valid(item): return ""
	for key in ["id","tool_id","weapon_id","catalogue_id"]:
		var value:String=str(item.get_meta(key,""))
		if value != "": return value
	return ""

## Per-family art direction. wind/follow x,y are camera-space metres relative to
## the contact point. wind.z is unused: anticipation stays at the rest tip's own
## depth ("pre" metres further out), so the tool never shrinks away from the
## player before the strike. follow.z is added to -reach (+z pulls toward player).
## "lead" (1.2-1.8) is the strike's z end-tangent in units of total z travel:
## higher extends the arm later but carries further past contact on a miss.
## a: end of anticipation; f: follow-through low point (both in progress units).
## wrist rows are (pitch, yaw, roll) at [rest, cocked, contact+lag, follow, rest].
static func _style(id:String)->Dictionary:
	match id:
		"quarry_pick":
			# Stonewhisper: tight vertical peck, point drives in, wrist extracts.
			return {"style":"peck","duration":.40,"cooldown":.48,"a":.12,"f":.64,
				"wind":Vector3(.27,.40,.10),"follow":Vector3(-.15,-.22,.27),
				"push":1.3,"through":.22,"bulge":.03,"lag":.025,"cant":.42,"pre":.04,"lead":1.8,
				"wrist":[Vector3.ZERO,Vector3(.09,-.02,.15),Vector3(-.13,.04,-.02),Vector3(.10,.03,-.12),Vector3.ZERO]}
		"woodland_axe":
			# Orchard's Edge: wider diagonal, blade draws across and pulls back.
			return {"style":"drawcut","duration":.38,"cooldown":.46,"a":.13,"f":.76,
				"wind":Vector3(.40,.34,.14),"follow":Vector3(-.45,-.36,.20),
				"push":1.15,"through":.85,"bulge":.05,"lag":.04,"cant":.32,"pre":.06,"lead":1.6,
				"wrist":[Vector3.ZERO,Vector3(.04,-.03,.26),Vector3(-.09,.06,-.03),Vector3(-.06,.05,-.24),Vector3.ZERO]}
		"apprentice_hammer":
			return _hammer(.48,.58,.19,.70,Vector3(.36,.46,.18),Vector3(-.20,-.30,.07),1.0,.06)
		"ember_hammer":
			return _hammer(.50,.60,.19,.70,Vector3(.37,.47,.19),Vector3(-.21,-.31,.07),1.0,.07)
		"sunfall_sledge":
			# Heaviest: longest lift, latest contact weight, deepest settle.
			return _hammer(.54,.65,.21,.72,Vector3(.38,.52,.22),Vector3(-.19,-.34,.08),.95,.08)
	if id.contains("pick"): return _style("quarry_pick")
	if id.contains("axe") or id.contains("hatchet"): return _style("woodland_axe")
	if id.contains("sledge"): return _style("sunfall_sledge")
	if id.contains("hammer") or id.contains("mallet"): return _style("apprentice_hammer")
	# Generic fallback: between axe and hammer, neutral wrist.
	return {"style":"generic","duration":.42,"cooldown":.50,"a":.14,"f":.72,
		"wind":Vector3(.38,.38,.14),"follow":Vector3(-.40,-.34,.14),
		"push":1.1,"through":.5,"bulge":.04,"lag":.04,"cant":.32,"pre":.05,"lead":1.6,
		"wrist":[Vector3.ZERO,Vector3(.05,-.03,.22),Vector3(-.08,.05,-.02),Vector3(-.07,.05,-.20),Vector3.ZERO]}

static func _hammer(duration:float, cooldown:float, a:float, f:float, wind:Vector3, follow:Vector3, push:float, lag:float)->Dictionary:
	# Heavy settle: slow lift, mass carries through contact, head sags then eases home.
	return {"style":"settle","duration":duration,"cooldown":cooldown,"a":a,"f":f,
		"wind":wind,"follow":follow,"push":push,"through":.12,"bulge":.06,"lag":lag,"cant":.22,"pre":.05,"lead":1.2,
		"wrist":[Vector3.ZERO,Vector3(.10,-.02,.16),Vector3(-.08,.04,-.02),Vector3(-.13,.04,-.12),Vector3.ZERO]}

static func swing(item:Node3D,progress:float,rest:Transform3D,reach:float)->Transform3D:
	var s:Dictionary=_style(_item_id(item))
	var tip:Vector3=item.get_meta("tip",DEFAULT_TIP)
	var rest_tip:Vector3=rest*(item.transform*tip)
	var p:float=clampf(progress,0.0,1.0)
	var a:float=s.a
	var f:float=s.f
	var contact:=Vector3(0,0,-reach)
	# Anticipation happens at the rest tip's depth (hand barely moves forward);
	# the reach to -reach is spent inside the committed strike (see z tangents).
	var windup:=Vector3(contact.x+s.wind.x,contact.y+s.wind.y,rest_tip.z-float(s.pre))
	var follow:Vector3=contact+s.follow
	# Strike direction in the screen plane: windup->contact chord bent toward the
	# follow point so velocity at contact is non-zero and the path is curved.
	var chord_xy:=Vector3(contact.x-windup.x,contact.y-windup.y,0.0)
	var follow_xy:=Vector3(s.follow.x,s.follow.y,0.0)
	var strike_dir:Vector3=(chord_xy.normalized()*.6+follow_xy.normalized()*.4).normalized()
	var v_wind:Vector3=chord_xy/(CONTACT-a)*.2   # z = 0: no forward drift entering the strike
	var v_start:Vector3=(windup-rest_tip)/a*2.0   # fast, decelerating start: instant response
	var v_contact:Vector3=strike_dir*chord_xy.length()/(CONTACT-a)*float(s.push)*1.6
	# z(u)/dz = (3-k)u^2 + (k-2)u^3 for tangent k*dz: zero start, late acceleration.
	# k < 2 here, so the tip is still mostly at depth by mid-strike and
	# the reach is spent at the end; dz<0 (forward) so v_contact.z stays continuous.
	v_contact.z=float(s.lead)*(contact.z-windup.z)/(CONTACT-a)
	var v_follow:Vector3=(follow-contact)/(f-CONTACT)*float(s.through)
	var desired:Vector3
	if p<a:
		desired=_herm(rest_tip,v_start,windup,v_wind,0.0,a,p)
		# Hand-pivot arc (pivot low right): bow the lift away from the pivot.
		# 16u^2(1-u)^2 has zero value and slope at both ends, so joins stay smooth.
		var ua:float=p/a
		var lift:=Vector3(windup.x-rest_tip.x,windup.y-rest_tip.y,0.0)
		var arc:=Vector3(-lift.y,lift.x,0.0).normalized()
		var from_pivot:=Vector3(rest_tip.x+windup.x,rest_tip.y+windup.y,0.0)*.5-Vector3(.45,-.6,0.0)
		if arc.dot(from_pivot)<0.0: arc=-arc
		desired+=arc*.03*16.0*ua*ua*(1.0-ua)*(1.0-ua)
	elif p<CONTACT:
		desired=_herm(windup,v_wind,contact,v_contact,a,CONTACT,p)
		# Shoulder-pivot arc: bow the path away from the pivot (up-left), zero at both ends.
		var u:float=(p-a)/(CONTACT-a)
		var bow:Vector3=Vector3(-chord_xy.y,chord_xy.x,0.0).normalized()
		if bow.dot(Vector3(-1,1,0))<0.0: bow=-bow
		desired+=bow*float(s.bulge)*16.0*u*u*(1.0-u)*(1.0-u)
	elif p<f:
		desired=_herm(contact,v_contact,follow,v_follow,CONTACT,f,p)
	else:
		desired=_herm(follow,v_follow,rest_tip,Vector3.ZERO,f,1.0,p)
	# Haft +Y and working face +X are independent of their held transform.
	# Some generated tools explicitly author different axes.
	var handle:Vector3=item.get_meta("handle_axis",Vector3.UP)
	var edge:Vector3=item.get_meta("working_axis",Vector3.RIGHT)
	var grip:=item.transform.basis.orthonormalized()
	var normal:=(grip*handle).cross(grip*edge).normalized()
	# A slight cant keeps the blade/head readable instead of edge-on to the
	# camera, while remaining close to the diagonal stroke's working plane.
	var desired_normal:=Vector3(-1,1,float(s.cant)).normalized()
	if normal.dot(desired_normal)<0: desired_normal=-desired_normal
	var aligned:=rest.basis
	if normal.length_squared()>.5:
		aligned=Basis(Quaternion(rest.basis*normal,desired_normal))*rest.basis
	# Face alignment eases in over the first part of the strike, finishing before
	# contact, so the silhouette stays rest-like through the lift (no sudden twist).
	var activity:=smoothstep(0.0,a+(CONTACT-a)*.55,p)*(1.0-smoothstep(f,1.0,p))
	# Wrist rotation lags the tip (overlap): its contact key sits slightly after .5.
	var lag:float=s.lag
	var times:Array=[0.0,a,CONTACT+lag,f,1.0]
	var euler:Vector3=_catmull(times,s.wrist,p)
	var natural:=Basis.from_euler(euler)
	var basis:=Basis(rest.basis.get_rotation_quaternion().slerp(aligned.get_rotation_quaternion(),activity))
	basis=natural*basis
	return Transform3D(basis,desired-basis*(item.transform*tip))

## Cubic Hermite with velocities in units-per-progress; exact at both ends.
static func _herm(p0:Vector3,v0:Vector3,p1:Vector3,v1:Vector3,t0:float,t1:float,t:float)->Vector3:
	var span:float=maxf(t1-t0,0.0001)
	var u:float=clampf((t-t0)/span,0.0,1.0)
	var u2:float=u*u
	var u3:float=u2*u
	return p0*(2.0*u3-3.0*u2+1.0)+v0*span*(u3-2.0*u2+u)+p1*(-2.0*u3+3.0*u2)+v1*span*(u3-u2)

## Non-uniform Catmull-Rom through the knots (zero tangents at both ends).
static func _catmull(times:Array,points:Array,t:float)->Vector3:
	var last:int=times.size()-1
	var i:int=0
	while i<last-1 and t>=float(times[i+1]): i+=1
	var tangent_a:Vector3=Vector3.ZERO if i==0 else (points[i+1]-points[i-1])/(float(times[i+1])-float(times[i-1]))
	var tangent_b:Vector3=Vector3.ZERO if i+1==last else (points[i+2]-points[i])/(float(times[i+2])-float(times[i]))
	return _herm(points[i],tangent_a,points[i+1],tangent_b,float(times[i]),float(times[i+1]),t)
