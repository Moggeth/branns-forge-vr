extends RefCounted
## The trajectory preview and flying arrow use exactly the same bounded solver.
const CURVE_SECONDS = 0.85
const GRAVITY = 5.8
const DRAG = 0.045

static func gesture(basis:Basis, origin:Vector3, current_basis:Basis, current_origin:Vector3)->Vector3:
	var initial=-basis.z.normalized()
	var forward=-current_basis.z.normalized()
	var offset=current_origin-origin
	var bank=atan2(current_basis.y.dot(basis.x),current_basis.y.dot(basis.y))
	var desired=(initial+basis.x*(forward.dot(basis.x)*1.6+offset.dot(basis.x)*1.9+bank*0.65)+basis.y*(forward.dot(basis.y)*1.6+offset.dot(basis.y)*1.9)).normalized()
	var axis=initial.cross(desired)
	if axis.length_squared()<0.000001: return Vector3.ZERO
	return axis.normalized()*minf(acos(clampf(initial.dot(desired),-1,1)),deg_to_rad(75))

static func turn_fraction(age:float)->float:
	# Front-loaded turning, easing cleanly to an ordinary ballistic arrow.
	var t=clampf(age/CURVE_SECONDS,0,1)
	return 1.0-pow(1.0-t,3)

static func step(position:Vector3, velocity:Vector3, curve:Vector3, age:float, delta:float)->Dictionary:
	var turn=turn_fraction(age+delta)-turn_fraction(age)
	var rotated=velocity
	if curve.length_squared()>0.000001: rotated=Basis(curve.normalized(),curve.length()*turn)*velocity
	var next_velocity=rotated*exp(-DRAG*delta)+Vector3.DOWN*GRAVITY*delta
	return {"position":position+(velocity+next_velocity)*0.5*delta,"velocity":next_velocity,"age":age+delta}

static func wing_basis(velocity:Vector3, curve:Vector3, age:float)->Basis:
	var direction=velocity.normalized()
	var up=Vector3.RIGHT if absf(direction.dot(Vector3.UP))>0.98 else Vector3.UP
	var frame=Basis.looking_at(direction,up)
	var active=clampf(1.0-age/CURVE_SECONDS,0,1)
	# A left-turning arrow banks left; wings always stay perpendicular to flight.
	var lateral=(curve.cross(direction)).dot(frame.x)
	return frame*Basis(Vector3.BACK,clampf(lateral,-1,1)*-0.8*active)
