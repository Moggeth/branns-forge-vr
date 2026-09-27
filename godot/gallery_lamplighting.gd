extends Node
## Bounded, session-persistent reservoirs. No extra simulation grids or shadow maps.
const A=preload("res://world_zones.gd")
const CAPACITY=4.0
const CELL_CAPACITY=.24
var gallery
var lamps=[]
var channels=[]
var inlet:Vector3
var reveal:Node3D
var channel_light:OmniLight3D
var clock=0.0
func setup(owner):
	gallery=owner
	for p in [Vector3(-2.5,0,3),Vector3(5.7,0,-3.5),Vector3(8.0,0,-5.8)]: make_lamp(p)
	var root=Node3D.new(); gallery.court.add_child(root)
	inlet=gallery.CENTER+Vector3(5.7,.35,3.8)
	A.cyl(root,Vector3(5.7,.23,3.8),.35,.25,"548d98")
	A.body(root,Vector3(5.7,.23,3.8),Vector3(.7,.25,.7),"metal")
	A.label(root,"MOONWATER INLET\nPour blue can · follow the light",Vector3(5.7,1.05,3.8),18,"a7e8ff")
	var points=[]
	for i in range(22): points.append(Vector3(5.7,.07,3.8-i*.375))
	for i in range(1,8): points.append(Vector3(5.7+i*.375,.07,-4.075))
	for p in points:
		A.box(root,p-Vector3.UP*.035,Vector3(.40,.05,.40),"4b666c")
		for side in [-1,1]:
			var edge=Vector3(side*.19,.025,0) if p.x<5.8 else Vector3(0,.025,side*.19)
			A.box(root,p+edge,Vector3(.035,.055,.375) if p.x<5.8 else Vector3(.375,.055,.035),"a77e55")
		var mesh=A.box(root,p,Vector3(.30,.018,.30),"72ddff",.7)
		mesh.hide(); channels.append({"fuel":0.0,"mesh":mesh})
	channel_light=OmniLight3D.new(); root.add_child(channel_light); channel_light.position=Vector3(8,1.7,-4.2); channel_light.light_color=Color("70cfff"); channel_light.omni_range=3.2; channel_light.shadow_enabled=false; channel_light.light_energy=0
	reveal=Node3D.new(); root.add_child(reveal); reveal.position=Vector3(8.3,1.65,-4.7)
	A.label(reveal,"THE MOONMOTH\nLight finds a way.",Vector3.ZERO,23,"b7edff")
	reveal.hide()
	A.label(gallery.court,"LAMPLIGHTER'S WALK\nOil in bowls · flame to wick\nWater quenches; oil remains\nBlue moonwater fills the copper path",Vector3(-1,2,4),22,"ffe0a4")
func make_lamp(p):
	var root=Node3D.new(); gallery.court.add_child(root); root.position=p
	A.cyl(root,Vector3(0,.42,0),.12,.84,"576571")
	A.cyl(root,Vector3(0,.06,0),.3,.12,"b28b55")
	A.cyl(root,Vector3(0,.92,0),.28,.13,"be9458")
	A.body(root,Vector3(0,.48,0),Vector3(.55,.96,.55),"metal")
	var oil=A.cyl(root,Vector3(0,.991,0),.23,.012,"705130")
	A.cyl(root,Vector3(0,1.035,0),.023,.08,"d1bd88")
	var flame=A.rock(root,Vector3(0,1.17,0),Vector3(.13,.3,.13),"ffb75f"); flame.material_override=A.mat("ffb75f",1.5)
	var light=OmniLight3D.new(); root.add_child(light); light.position=Vector3(0,1.35,0); light.light_color=Color("ffc789"); light.omni_range=4.5; light.shadow_enabled=false
	var label=A.label(root,"",Vector3(0,.72,.3),16,"ffe4b9")
	lamps.append({"root":root,"oil":oil,"flame":flame,"light":light,"label":label,"fuel":0.0,"lit":false,"wet":0.0})
	refresh()
func pour(point:Vector3,kind:String,amount:float)->float:
	if gallery.game.adventure.zone!=gallery.ZONE or not point.is_finite() or not is_finite(amount) or amount<=0: return 0
	if point.distance_to(inlet)<.65 and kind=="glimmer":
		var accepted=minf(amount,CELL_CAPACITY-channels[0].fuel)
		channels[0].fuel+=accepted; return accepted
	for lamp in lamps:
		if point.distance_to(lamp.root.global_position+Vector3.UP)<.48:
			if kind=="oil":
				var accepted=minf(amount,CAPACITY-lamp.fuel); lamp.fuel+=accepted; refresh(); return accepted
			if kind=="water": lamp.lit=false; lamp.wet=8.0; refresh(); return amount
	if kind=="water":
		var remaining=amount
		var nearest=channels.duplicate()
		nearest.sort_custom(func(a,b):return point.distance_squared_to(a.mesh.global_position)<point.distance_squared_to(b.mesh.global_position))
		for cell in nearest:
			if point.distance_to(cell.mesh.global_position)<.7:
				var used=minf(cell.fuel,remaining); cell.fuel-=used; remaining-=used
		return amount-remaining
	return 0
func touch(point:Vector3,radius:float,water:bool)->int:
	if gallery.game.adventure.zone!=gallery.ZONE: return 0
	var changed=0
	for lamp in lamps:
		if point.distance_to(lamp.root.global_position+Vector3.UP*1.1)>radius+.08: continue
		if water:
			if lamp.lit: changed+=1
			lamp.lit=false; lamp.wet=8
		elif not lamp.lit and lamp.fuel>.01 and lamp.wet<=0:
			lamp.lit=true; changed+=1; gallery.game.firecraft._sound("strike",point)
	if changed>0: refresh()
	return changed
func tick(dt:float):
	if gallery.game.adventure.zone!=gallery.ZONE: return
	clock+=dt
	for prop in gallery.game.firecraft.props:
		if is_instance_valid(prop) and prop.is_visible_in_tree() and prop.get_meta("fire_kind","") in ["match","vial"] and gallery.game.firecraft._burning(prop):
			touch(gallery.game.firecraft._tip(prop),.15,false)
	for lamp in lamps:
		lamp.wet=maxf(0,lamp.wet-dt)
		if lamp.lit:
			lamp.fuel=maxf(0,lamp.fuel-dt*.015)
			if lamp.fuel<=0: lamp.lit=false
	# Iterate backwards: one cell cannot cross the whole channel in one frame.
	for i in range(channels.size()-2,-1,-1):
		var transfer=minf(channels[i].fuel,minf(CELL_CAPACITY-channels[i+1].fuel,dt*.7))
		channels[i].fuel-=transfer; channels[i+1].fuel+=transfer
	for cell in channels:
		cell.mesh.visible=cell.fuel>.002
		cell.mesh.scale.y=.018*maxf(.05,cell.fuel/CELL_CAPACITY)
	var end_fill=channels.back().fuel/CELL_CAPACITY
	channel_light.light_energy=end_fill*1.3
	reveal.visible=end_fill>.2
	if reveal.visible and gallery.game.camera.global_position.distance_to(reveal.global_position)<3: gallery._earn("discovery")
	refresh()
func refresh():
	for lamp in lamps:
		lamp.flame.visible=lamp.lit; lamp.oil.visible=lamp.fuel>0
		lamp.flame.scale.y=.3*(1+.05*sin(clock*3.7))
		lamp.light.light_energy=(1.5*(1+.025*sin(clock*2.3))) if lamp.lit else 0
		lamp.label.text="%d%% OIL · %s"%[roundi(lamp.fuel/CAPACITY*100),"LIT" if lamp.lit else ("DAMP" if lamp.wet>0 else "TOUCH WICK WITH FIRE")]
func reset():
	for lamp in lamps: lamp.fuel=0.0; lamp.lit=false; lamp.wet=0.0
	for cell in channels: cell.fuel=0.0; cell.mesh.hide()
	channel_light.light_energy=0; reveal.hide(); refresh()
