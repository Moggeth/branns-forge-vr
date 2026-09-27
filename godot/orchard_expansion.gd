extends RefCounted
## Deterministic, reusable orchard layout. Gameplay trees stay separate from the
## batched scenery so fruit, chopping and enemy collisions retain their contracts.
const TreeKit = preload("res://tree_kit.gd")
const TreeAdapter = preload("res://tree_adapter.gd")
const Art = preload("res://orchard_art.gd")
const EXTENT := 160.0
const SEED := 277091
const TRAIL := [
	Vector3(0,0,20), Vector3(-42,0,43), Vector3(-78,0,83),
	Vector3(-118,0,43), Vector3(-112,0,-40), Vector3(-25,0,-109),
	Vector3(82,0,-83), Vector3(104,0,20), Vector3(73,0,93),
	Vector3(0,0,103), Vector3(0,0,20)]
const PLOTS := [
	{"name":"CIDER ROWS", "at":Vector3(-78,0,83), "tree_count":6, "kind":"orchard"},
	{"name":"MOSSY TERRACE", "at":Vector3(-112,0,-40), "tree_count":4, "kind":"stone"},
	{"name":"FALLEN WALLS", "at":Vector3(-25,0,-109), "tree_count":4, "kind":"ruin"},
	{"name":"PINE WINDBREAK", "at":Vector3(82,0,-83), "tree_count":4, "kind":"pine"},
	{"name":"SUNWARD GROVE", "at":Vector3(73,0,93), "tree_count":6, "kind":"orchard"},
	{"name":"OLD OVERLOOK", "at":Vector3(0,0,103), "tree_count":4, "kind":"stone"}]

static func _distance_to_path(point:Vector3)->float:
	var nearest := 999.0
	for i in range(TRAIL.size()-1):
		var a:Vector3=TRAIL[i]
		var b:Vector3=TRAIL[i+1]
		var segment:Vector3=b-a
		var t:float=clampf((point-a).dot(segment)/segment.length_squared(),0.0,1.0)
		nearest=minf(nearest,point.distance_to(a+segment*t))
	return nearest

static func _clear(point:Vector3)->bool:
	if point.length()<48.0 or absf(point.x)>147.0 or absf(point.z)>147.0: return false
	if _distance_to_path(point)<4.6: return false
	for plot in PLOTS:
		if point.distance_to(plot.at)<13.0: return false
	return true

static func populate(root:Node3D,data:Dictionary,w:Script)->void:
	var zone:Dictionary=data.zones.orchard_highlands
	var p:Node3D=zone.root
	var center:Vector3=zone.center
	var rng:=RandomNumberGenerator.new()
	rng.seed=SEED
	Art.trail(p,TRAIL,w)
	for plot_index in range(PLOTS.size()):
		var plot:Dictionary=PLOTS[plot_index]
		var place:=Node3D.new()
		place.name="OrchardPlot_%02d"%plot_index
		place.position=plot.at
		p.add_child(place)
		var count:int=plot.tree_count
		for j in range(count):
			var side:float=-1.0 if j%2==0 else 1.0
			var row:int=j/2
			var local:=Vector3(side*(5.8+float(row%2)*3.0),0,-7.0+float(row)*7.2)
			var is_pine:bool=plot.kind=="pine" and j%2==0
			var has_apple:bool=not is_pine and j<2
			var tree:Node3D=w.tree(place,local,4.7+float(j%3)*0.38,is_pine,has_apple,1 if has_apple else 0)
			if not is_pine: Art.upgrade_tree_visual(tree)
			if has_apple: TreeAdapter.hanging_apple(w,root,data,"orchard_highlands",tree)
		if plot.kind in ["stone","ruin"]:
			w.arch(place,Vector3(0,0,-1.0),2.1,"a6a99a",true)
			for k in range(5):
				w.rock(place,Vector3(-9.0+float(k)*4.2,0.43,4.0+float(k%2)*3.2),Vector3(1.9,0.9,1.4),"9b9c8a")
		if plot.kind=="orchard":
			w.crate(place,Vector3(1.4,0,2.5),0.9)
			w.flowers(place,Vector3(-3.0,0,3.0),24,3.2,"f5e9bb")
		var timber=w.resource(root,data,"orchard_highlands",center+plot.at+Vector3(11,0,3),"lumber","axe",2)
		w.tree(timber,Vector3.ZERO,5.2,plot.kind=="pine",false)
		if plot_index in [2,3,4]:
			w.enemy(root,data,"orchard_highlands",center+plot.at+Vector3(-3,0,-10),"skeleton","mossward")
		w.label(p,plot.name,plot.at+Vector3(0,3.1,-11),24,"f7ebd2")
	# A single grove source can use three deterministic silhouettes. The art
	# adapter replaces it with authored Opus meshes when the reviewed kit exists.
	var placements:Array=[]
	var trunks:=StaticBody3D.new()
	trunks.name="OrchardGroveTrunks"
	p.add_child(trunks)
	for i in range(480):
		var point:=Vector3(rng.randf_range(-146,146),0,rng.randf_range(-146,146))
		if not _clear(point): continue
		var pine:bool=i%9==0
		var scale:float=rng.randf_range(0.88,1.19)
		placements.append({"species":"pine" if pine else "apple","position":point,"seed":rng.randi()%100000,"scale":scale})
		var collision:=CollisionShape3D.new()
		var shape:=CylinderShape3D.new()
		shape.radius=0.31*scale
		shape.height=2.5*scale
		collision.shape=shape
		collision.position=point+Vector3.UP*shape.height*0.5
		trunks.add_child(collision)
	Art.grove(p,placements,TRAIL)
	Art.place_features(p,TRAIL,PLOTS,SEED)
	w.anchor(root,data,"orchard_highlands",center+Vector3(-112,3.8,-40),center+Vector3(-108,0,-38))
	w.anchor(root,data,"orchard_highlands",center+Vector3(73,4.2,93),center+Vector3(69,0,88))
	p.set_meta("orchard_expansion",{"seed":SEED,"extent_m":EXTENT,"area_m2":102400,"plots":PLOTS.size(),"grove_trees":placements.size()})
	p.set_meta("orchard_trail",TRAIL)
	print("ORCHARD_EXPANSION area_m2=102400 plots=",PLOTS.size()," grove_trees=",placements.size())
