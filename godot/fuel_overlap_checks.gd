extends SceneTree
var failures=[]
var checks=0
var lab
var center=32*64+32
func check(ok,message):
	checks+=1
	if not ok: failures.append(message)
func reset():
	lab.heights.fill(0); lab.fuel.fill(0); lab.burning.fill(0); lab.burn_age.fill(0); lab.wet.fill(0)
	lab.burned=0; lab.evaporated=0; lab.poured=0; lab.weather="clear"
func step(seconds):
	for i in range(roundi(seconds/.1)): lab.simulation(.1)
func conserved(label): check(absf(lab.total_fuel()+lab.burned+lab.evaporated-lab.poured)<.02,label+" conserves fuel")
func _initialize(): run.call_deferred()
func run():
	lab=load("res://weather_lab.gd").new(); root.add_child(lab); lab.setup(null,true,true)
	var spot=lab.point(center)
	for lit in [false,true]:
		reset(); lab.pour(spot,8,true); step(4)
		var age=lab.burn_age[center]
		lab.pour(spot,8,lit)
		check(lab.burn_age[center]>=age,"Overlapping dose does not reset existing flame clock")
		step(6)
		check(lab.total_fuel()<.01,"Overlapping dose exhausts by ten seconds from first ignition")
		conserved("Overlapping dose")
	reset(); lab.pour(spot,8,true); step(3)
	lab.extinguish_near(spot,8)
	check(lab.burning.count(1)==0,"Water immediately quenches entire pool")
	var remaining=lab.total_fuel(); step(1)
	check(lab.burned<8-remaining+.01,"Quenched pool does not continue burning")
	check(lab.ignite_near(spot,8)==0,"Damp fuel cannot immediately reignite")
	lab.wet.fill(0); lab.ignite_near(spot,8); step(5)
	check(lab.total_fuel()>.01,"Dry relit fuel receives fresh burn interval")
	step(4); check(lab.total_fuel()<.01,"Relit fuel exhausts within nine seconds"); conserved("Reignition")
	reset(); lab.pour(spot,8,true); step(10)
	lab.pour(spot,8,true); step(5)
	check(lab.total_fuel()>.01,"New bottle on spent surface receives fresh burn interval")
	step(4); check(lab.total_fuel()<.01,"Fresh bottle on spent surface exhausts normally"); conserved("Spent surface")
	# Different simulation rates must not extend the flame indefinitely.
	var burn_lifetimes=[]
	for dt in [.05,.1,.2]:
		reset(); lab.pour(spot,8,true)
		var seconds=0.0
		while lab.total_fuel()>.01 and seconds<12:
			lab.simulation(dt); seconds+=dt
		burn_lifetimes.append(seconds)
		check(seconds>=5 and seconds<=10,"Burn interval stays bounded at step "+str(dt)); conserved("Step size")
	reset(); lab.pour(spot,8,true); step(4)
	lab.pour(spot+Vector3(1.5,0,0),8,false)
	step(1)
	check(lab.burning[center+4]>0,"Old flame ignites touching fresh neighboring spill")
	step(6)
	check(lab.total_fuel()<.01,"Propagated flame cannot keep aging into an indefinite tail"); conserved("Neighbor spill")
	var lifetimes=[]
	for rate in [.002,.002/2.25]:
		reset(); lab.unlit_evaporation_rate=rate; lab.pour(spot,8,false)
		var t=0.0
		while lab.total_fuel()>.01 and t<100: step(.2); t+=.2
		lifetimes.append(t); conserved("Evaporation")
	check(lifetimes[1]/lifetimes[0]>1.35 and lifetimes[1]/lifetimes[0]<1.65,"Evaporation lifetime approximately 50 percent longer")
	print("FUEL_OVERLAP_RESULT ",JSON.stringify({"checks":checks,"lifetimes":lifetimes,"burn_lifetimes":burn_lifetimes,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
