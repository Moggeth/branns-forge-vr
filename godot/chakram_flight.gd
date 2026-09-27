extends RefCounted
## Game-feel integrator. All accelerations are bounded; recall never rewrites momentum.
static func bank_angle(normal:Vector3,forward:Vector3)->float:
	var heading=Vector3(forward.x,0,forward.z).normalized()
	if heading.length_squared()<.01 or not normal.is_finite(): return 0.0
	if normal.y<0: normal=-normal
	return clampf(atan2(normal.dot(heading.cross(Vector3.UP)),maxf(.01,normal.y)),deg_to_rad(-65),deg_to_rad(65))

static func glide(velocity:Vector3,bank:float,delta:float,gravity=1.1,curve=4.2,drag=.025)->Vector3:
	if not velocity.is_finite(): return Vector3.ZERO
	var horizontal=Vector3(velocity.x,0,velocity.z)
	var speed=horizontal.length()
	if speed>.1:
		# Rotate horizontal momentum: banking bends its path without inventing speed.
		horizontal=horizontal.rotated(Vector3.UP,-sin(bank)*curve/maxf(speed,2.0)*delta)*exp(-drag*delta)
	return Vector3(horizontal.x,velocity.y-gravity*delta,horizontal.z)

static func recall(velocity:Vector3,difference:Vector3,delta:float,speed=18.0,acceleration=28.0)->Vector3:
	if not velocity.is_finite() or not difference.is_finite(): return Vector3.ZERO
	var distance=difference.length()
	var desired=difference.normalized()*minf(speed,sqrt(maxf(0,2.0*acceleration*distance))*.8)
	return velocity.move_toward(desired,acceleration*delta)

static func ricochet(velocity:Vector3,normal:Vector3,retention=.84)->Vector3:
	return velocity.bounce(normal.normalized())*clampf(retention,.4,1.0)
