extends RefCounted
## Independent, bounded flight math. World velocity survives perches and throws.
static func load_factor(mass:float)->float:
	return clampf(1.0-mass/0.8,0.0,1.0)

static func step(velocity:Vector3,basis:Basis,stick:Vector3,dt:float,acro:bool,boost:bool,mass:float,brake:bool,cfg:Dictionary)->Vector3:
	if not velocity.is_finite() or not stick.is_finite(): return Vector3.ZERO
	var lift=load_factor(mass)
	if lift<=0: return velocity.move_toward(Vector3.ZERO,32*dt)
	var speed=float(cfg.speed)*(float(cfg.boost) if boost else 1.0)*lift
	var direction=basis*stick.limit_length(1.0)
	if acro:
		velocity+=direction*float(cfg.acceleration)*lift*dt
		velocity*=exp(-(float(cfg.drag)+ (8.0 if brake else 0.0))*dt)
		return velocity.limit_length(speed)
	var response=float(cfg.get("deceleration",cfg.acceleration)) if stick.length()<.05 else float(cfg.acceleration)
	return velocity.move_toward(direction*speed,(response if not brake else 40.0)*lift*dt)

static func return_velocity(velocity:Vector3,difference:Vector3,dt:float)->Vector3:
	return velocity.move_toward(difference.normalized()*minf(12,sqrt(24*difference.length())),24*dt)
