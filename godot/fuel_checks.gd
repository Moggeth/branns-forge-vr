extends RefCounted
func run(lab)->Array:
	var failures=[]
	var old_heights=lab.heights.duplicate(); var old_weather=lab.weather
	lab.heights.fill(.04); lab.wet.fill(0); lab.snow.fill(0); lab.fuel.fill(0); lab.burning.fill(0); lab.poured=0; lab.burned=0; lab.evaporated=0; lab.set_weather("clear")
	for i in range(40): lab.spill(Vector3(-9+(i%8)*2.5,.065,-6+floorf(i/8.0)*3),i%2==0)
	if absf(lab.total_fuel()-320)>.01: failures.append("40 full potions admitted")
	var before=lab.total_fuel(); lab.spill(Vector3(0,.065,3),true)
	if absf(lab.total_fuel()-before)>.001: failures.append("41st spill must not exceed budget or erase existing fuel")
	var samples=[]; var peak_puddles=0; var peak_flames=0
	for i in range(100):
		var start=Time.get_ticks_usec(); lab.simulation(.1); samples.append((Time.get_ticks_usec()-start)/1000.0)
		peak_puddles=maxi(peak_puddles,lab.liquid.multimesh.visible_instance_count); peak_flames=maxi(peak_flames,lab.flames.multimesh.visible_instance_count)
	samples.sort()
	print("FUEL_STRESS forty_potions=true steps=100 step_ms_median=",samples[50]," step_ms_p95=",samples[95]," peak_puddles=",peak_puddles," peak_flames=",peak_flames)
	if peak_puddles<=384 or peak_flames<=128: failures.append("stress must exercise old render limits")
	if absf(lab.total_fuel()+lab.burned+lab.evaporated-lab.poured)>.03: failures.append("forty-potion conservation")
	if lab.liquid.multimesh.instance_count!=4096 or lab.flames.multimesh.instance_count!=4096: failures.append("render capacity covers all simulation cells")
	# A narrow ledge still receives a full bottle; blocked neighbours cannot lose liquid.
	lab.heights.fill(3); lab.fuel.fill(0); lab.burning.fill(0); lab.poured=0
	var ledge=lab.cell_index(Vector3(0,0,3)); lab.heights[ledge]=.04
	lab.spill(Vector3(0,.065,3),false)
	if absf(lab.total_fuel()-8)>.001: failures.append("ledge spill lost fuel")
	# Equal-level pools have no pressure gradient: heat must ignite independently of flow.
	lab.heights.fill(3); lab.fuel.fill(0); lab.burning.fill(0); lab.wet.fill(0)
	var start_cell=20*64+20
	for i in range(12): lab.heights[start_cell+i]=.04; lab.fuel[start_cell+i]=1.0
	lab.burning[start_cell]=1; lab.poured=12; lab.burned=0; lab.evaporated=0
	for i in range(13): lab.simulation(.1)
	if lab.burning[start_cell+11]!=1: failures.append("stationary contiguous fuel chain ignition")
	for i in range(220): lab.simulation(.1)
	if lab.total_fuel()>.001: failures.append("chain consumes remaining fuel")
	if absf(lab.burned+lab.evaporated-12)>.01: failures.append("burned fuel accounted")
	# Neither dry gaps nor grid-row seams transmit ignition.
	lab.fuel.fill(0); lab.burning.fill(0); lab.heights.fill(.04)
	lab.fuel[63]=1; lab.burning[63]=1; lab.fuel[64]=1
	lab.fuel[start_cell]=1; lab.burning[start_cell]=1; lab.fuel[start_cell+2]=1
	lab.simulation(.01)
	if lab.burning[64]>0: failures.append("row boundary ignition wrap")
	if lab.burning[start_cell+2]>0: failures.append("ignition jumped dry gap")
	lab.fuel.fill(0); lab.burning.fill(0)
	lab.spill(Vector3(0,.065,3),true); lab.spill(Vector3(0,.065,3),false)
	if lab.burning[lab.cell_index(Vector3(0,0,3))]!=1: failures.append("unlit refill extinguished existing flame")
	lab.heights=old_heights; lab.fuel.fill(0); lab.burning.fill(0); lab.poured=0; lab.burned=0; lab.evaporated=0; lab.spill_notice_until=0; lab.set_weather(old_weather); lab.update_fluid_visuals()
	return failures
