extends SceneTree
const Flight=preload("res://chakram_flight.gd")
var failures=[]
var count=0
func check(ok,message):
	count+=1
	if not ok: failures.append(message)
func _initialize(): run.call_deferred()
func simulate(bank:float,dt:float)->Vector3:
	var p=Vector3.ZERO; var v=Vector3(0,.32,-9)
	for i in range(roundi(2.0/dt)):
		v=Flight.glide(v,bank,dt); p+=v*dt
	return p
func run():
	var start=Time.get_ticks_usec()
	var flat=simulate(0,1.0/120); var right=simulate(deg_to_rad(40),1.0/120); var left=simulate(deg_to_rad(-40),1.0/120)
	check(absf(flat.x)<.0001 and flat.z < -17,"Flat release glides straight with restrained drop")
	check(flat.y<0 and flat.y> -2,"Flat release has gentle gravity")
	check(right.x>4 and left.x< -4,"Wrist roll carves substantial controllable mirrored curves")
	check(absf(right.x+left.x)<.0001 and absf(right.z-left.z)<.0001,"Left and right banking are symmetric")
	check(simulate(deg_to_rad(40),1.0/60).distance_to(right)<.08,"Bank integration stable at60/120Hz")
	check(absf(Flight.bank_angle(Vector3.UP,Vector3.FORWARD))<.001,"Level ring samples zero bank")
	check(Flight.bank_angle(Vector3(1,1,0).normalized(),Vector3.FORWARD)>0,"Right-leaning ring samples right curve")
	check(absf(Flight.bank_angle(Vector3.DOWN,Vector3.FORWARD))<.001,"Flipped flat ring remains flat")
	var outbound=Vector3(0,0,-14)
	var recalled=Flight.recall(outbound,Vector3(0,0,5),1.0/90)
	check(recalled.z<0,"Recall first decelerates outward travel instead of reversing instantly")
	check(recalled.distance_to(outbound)<=28.0/90+.0001,"Recall acceleration stays bounded")
	var p=Vector3(0,1.8,-5); var home=Vector3(0,1.8,0); var v=outbound; var furthest=5.0; var caught=false
	for i in range(720):
		v=Flight.recall(v,home-p,1.0/120); p+=v/120; furthest=maxf(furthest,home.distance_to(p))
		if p.distance_to(home)<.35: caught=true; break
	check(furthest>7,"Elastic recall includes a visible outward overshoot")
	check(caught,"Momentum-preserving recall ultimately reaches the hand")
	var incoming=Vector3(6,0,-8); var reflected=Flight.ricochet(incoming,Vector3.BACK)
	check(reflected.x>0 and reflected.z>0 and absf(reflected.x/reflected.z-.75)<.001,"Wall ricochet preserves equal reflection angle")
	check(absf(reflected.length()-incoming.length()*.84)<.001,"Bounce loses only configured energy")
	check(Flight.glide(Vector3(0,0,-9),.6,.02).length()<=9.01,"Banking does not create speed")
	# Real GLB is shared with the phone viewer, no substitute preview mesh.
	var asset=load("res://assets/sunskipper-chakram.glb")
	check(asset is PackedScene,"Crafted model loads through native resource remapping")
	var model=asset.instantiate();root.add_child(model)
	check(model.find_children("*","MeshInstance3D",true,false).size()==5,"Detailed asset remains five material batches")
	model.free()
	print("CHAKRAM_CHECK_RESULT ",JSON.stringify({"checks":count,"failures":failures,"seconds":(Time.get_ticks_usec()-start)/1000000.0}))
	quit(0 if failures.is_empty() else 1)
