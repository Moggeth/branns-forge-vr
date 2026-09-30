extends RefCounted
## Camera-space animation; the calibrated item grip remains untouched.
## The authored handle/working-face plane guides the slash, including picks.

static func idle(time:float, phase:float, strength:float)->Transform3D:
	var breath=Vector3(sin(time*1.07)*.0025,sin(time*1.65)*.0035,cos(time*1.3)*.0018)
	var walking=Vector3(sin(phase)*.008,absf(cos(phase))*.012,0)*strength
	var roll=.018*sin(phase)*strength+.003*sin(time*1.19)
	return Transform3D(Basis.from_euler(Vector3(.002*sin(time*1.2),.002*cos(time*.93),roll)),Vector3(.35,-.35,-.55)+breath+walking)

static func swing(item:Node3D,progress:float,rest:Transform3D,reach:float)->Transform3D:
	var tip:Vector3=item.get_meta("tip",Vector3.UP*.65)
	var rest_tip=rest*(item.transform*tip)
	var windup=Vector3(.42,.36,-reach+.14)
	var contact=Vector3(0,0,-reach)
	var follow=Vector3(-.46,-.40,-reach+.14)
	var desired:Vector3
	var roll:float
	if progress<.2:
		var blend=smoothstep(0.0,.2,progress)
		desired=rest_tip.lerp(windup,blend); roll=lerpf(0,.24,blend)
	elif progress<.5:
		var blend=smoothstep(.2,.5,progress)
		desired=windup.lerp(contact,blend); roll=lerpf(.24,0,blend)
	elif progress<.8:
		var blend=smoothstep(.5,.8,progress)
		desired=contact.lerp(follow,blend); roll=lerpf(0,-.24,blend)
	else:
		var blend=smoothstep(.8,1.0,progress)
		desired=follow.lerp(rest_tip,blend); roll=lerpf(-.24,0,blend)
	# Haft +Y and working face +X are independent of their held transform.
	# Some generated tools explicitly author different axes.
	var handle:Vector3=item.get_meta("handle_axis",Vector3.UP)
	var edge:Vector3=item.get_meta("working_axis",Vector3.RIGHT)
	var grip=item.transform.basis.orthonormalized()
	var normal=(grip*handle).cross(grip*edge).normalized()
	# A slight cant keeps the blade/head readable instead of edge-on to the
	# camera, while remaining close to the diagonal stroke's working plane.
	var desired_normal=Vector3(-1,1,.32).normalized()
	if normal.dot(desired_normal)<0: desired_normal=-desired_normal
	var aligned=rest.basis
	if normal.length_squared()>.5:
		aligned=Basis(Quaternion(rest.basis*normal,desired_normal))*rest.basis
	# A small wrist variation avoids a mechanically perfect flat stroke.
	var activity=smoothstep(0.0,.2,progress)*(1.0-smoothstep(.8,1.0,progress))
	var natural=Basis.from_euler(Vector3(-.07*sin(progress*PI),.055*sin(progress*PI),roll))
	var basis=Basis(rest.basis.get_rotation_quaternion().slerp(aligned.get_rotation_quaternion(),activity))
	basis=natural*basis
	return Transform3D(basis,desired-basis*(item.transform*tip))
