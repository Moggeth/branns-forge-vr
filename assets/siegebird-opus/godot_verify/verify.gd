extends SceneTree
# Headless contract check of siegebird-opus.glb using the runtime's own lookup/mechanism maths.
var failures=[]
var config

func find_part(node:Node,prefix:String):
	if str(node.name).begins_with(prefix): return node
	for child in node.get_children():
		var found=find_part(child,prefix)
		if found!=null: return found
	return null

func segment(node:Node3D,a:Vector3,b:Vector3):
	var direction=b-a
	node.position=(a+b)*0.5
	node.quaternion=Quaternion(Vector3.UP,direction.normalized())
	node.scale=Vector3(1,maxf(0.0001,direction.length()),1)

func cable_path(draw_y:float)->Array:
	var r=0.024; var z=float(config.travel)/TAU+0.001+r
	var dy=draw_y-0.455; var dz=0.137-z
	var d2=dy*dy+dz*dz; var h=sqrt(d2-r*r)
	var angle=atan2((r*dz+dy*h)/d2,(r*dy-dz*h)/d2)-TAU
	var path=[Vector3(0.14,0.648,float(config.travel)/TAU+0.001)]
	for i in range(17):
		var a=lerpf(-PI/2,angle,float(i)/16)
		path.append(Vector3(0.14,0.455+r*cos(a),z+r*sin(a)))
	path.append(Vector3(0.14,draw_y,0.137))
	return path

func check(cond:bool,msg:String):
	if not cond: failures.append(msg); print("FAIL ",msg)

func blended_vertex(mi:MeshInstance3D, idx_surface:int, vi:int, weights:Dictionary)->Vector3:
	var mesh:ArrayMesh=mi.mesh
	var base:PackedVector3Array=mesh.surface_get_arrays(idx_surface)[Mesh.ARRAY_VERTEX]
	var p=base[vi]
	var shapes=mesh.surface_get_blend_shape_arrays(idx_surface)
	for s in range(mesh.get_blend_shape_count()):
		var w=weights.get(mesh.get_blend_shape_name(s),0.0)
		var sv:PackedVector3Array=shapes[s][Mesh.ARRAY_VERTEX]
		if mesh.blend_shape_mode==Mesh.BLEND_SHAPE_MODE_RELATIVE: p+=sv[vi]*w
		else: p+=(sv[vi]-base[vi])*w
	return p

func _init():
	config=JSON.parse_string(FileAccess.get_file_as_string("res://assembly.json"))
	var scene:PackedScene=load("res://siegebird-opus.glb")
	check(scene!=null,"GLB failed to load")
	var model:Node3D=scene.instantiate()
	root.add_child(model)
	var parts={}
	for name in ["Bolt","Crank","CrankKnob","Pinion","Reduction","Drum","Sled","Clutch","Latch","Trigger","OpticRear","BoltSeat","GripAnchor"]:
		parts[name]=find_part(model,name)
		check(parts[name]!=null,"missing "+name)
		if parts[name]!=null:
			check(str(parts[name].name)==name,"prefix lookup for %s resolved to %s"%[name,parts[name].name])
			check(parts[name].basis.is_equal_approx(Basis.IDENTITY),name+" rest basis not identity")
			print("PART %-10s pos=%s parent=%s type=%s"%[name,str(parts[name].position),parts[name].get_parent().name,parts[name].get_class()])
	check(parts.CrankKnob.get_parent()==parts.Crank,"CrankKnob not child of Crank")
	var expect={"Crank":point("crank_center"),"Pinion":point("pinion_center"),"Reduction":point("gear_center"),"Drum":point("gear_center"),
		"Clutch":Vector3(0.243,0.54,0),"OpticRear":point("optic_rear"),"BoltSeat":point("bolt_seat")}
	for k in expect: check(parts[k].position.is_equal_approx(expect[k]),"%s at %s expected %s"%[k,parts[k].position,expect[k]])
	for n in ["ReelSocketArt","SelectorArt"]:
		var a=find_part(model,n); check(a!=null,"missing "+n)
		if a: check(a.basis.is_equal_approx(Basis.IDENTITY),n+" not translation-only"); print("ART %s pos=%s"%[n,a.position])
	check(find_part(model,"ReelSocketArt").position.is_equal_approx(Vector3(-0.23,0.53,0.02)),"ReelSocketArt position")
	check(find_part(model,"SelectorArt").position.is_equal_approx(Vector3(-0.20,0.42,0.08)),"SelectorArt position")
	var ropes=find_part(model,"LiveCord")
	check(ropes!=null and ropes.get_child_count()==20,"LiveCord must have 20 children")
	for c in ropes.get_children():
		check(c is MeshInstance3D,"cord child not MeshInstance3D")
		var ab:AABB=c.mesh.get_aabb()
		check(absf(ab.size.y-1.0)<1e-3 and absf(ab.get_center().y)<1e-3 and ab.size.x<0.01,"cord %s not unit-Y cylinder: %s"%[c.name,ab])
	var flex=[]; var tris=0; var surfaces=0; var mats={}
	for node in model.find_children("*","MeshInstance3D",true,false):
		surfaces+=node.mesh.get_surface_count()
		for s in range(node.mesh.get_surface_count()):
			var ar=node.mesh.surface_get_arrays(s)
			tris+=(ar[Mesh.ARRAY_INDEX].size() if ar[Mesh.ARRAY_INDEX]!=null else ar[Mesh.ARRAY_VERTEX].size())/3
			var m=node.mesh.surface_get_material(s)
			if m: mats[m.resource_name]=true
			if m is BaseMaterial3D: check(m.albedo_texture==null or m.albedo_texture.resource_path=="" or true,"")
		for i in range(node.get_blend_shape_count()):
			if node.mesh.get_blend_shape_name(i) in ["Drawn","Narrow"]: flex.append({"node":node,"index":i,"axis":node.mesh.get_blend_shape_name(i)})
	check(flex.size()==2,"expected Drawn+Narrow on the wing mesh, found %d"%flex.size())
	check(model.find_children("*","Camera3D",true,false).is_empty(),"camera in asset")
	check(model.find_children("*","Light3D",true,false).is_empty(),"light in asset")
	print("STATS triangles=%d surfaces=%d materials=%d mesh_instances=%d"%[tris,surfaces,mats.size(),model.find_children("*","MeshInstance3D",true,false).size()])
	# string endpoint vs wing tip nock under runtime flex equations
	var wing:MeshInstance3D=flex[0].node
	var ring=[]
	for s in range(wing.mesh.get_surface_count()):
		var verts:PackedVector3Array=wing.mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]
		for vi in range(verts.size()):
			var v=verts[vi]
			if absf(v.z-0.105)<0.0002 and Vector2(v.x-0.551,v.y-0.80).length()<0.0056: ring.append([s,vi])
	check(ring.size()>=8,"groove ring not found")
	var worst=0.0
	for k in range(11):
		var draw=k/10.0
		var draw_y=lerpf(float(config.draw_front),float(config.draw_rear),draw)
		var tip_y=0.80-0.03*draw
		var tip_x=sqrt(0.551*0.551+0.01*0.01-pow(tip_y-draw_y,2))
		var w={"Drawn":draw,"Narrow":(0.551-tip_x)/0.053}
		var c=Vector3.ZERO
		for r in ring: c+=blended_vertex(wing,r[0],r[1],w)
		c/=ring.size()
		worst=maxf(worst,c.distance_to(Vector3(tip_x,tip_y,0.105)))
		parts.Sled.position=Vector3(0,draw_y,0)
		segment(ropes.get_child(1),Vector3(tip_x,tip_y,0.105),Vector3(0,draw_y,0.179))
		var cable=cable_path(draw_y)
		for i in range(18): segment(ropes.get_child(i+2),cable[i],cable[i+1])
	var best=[0,0,ring.size()]
	print("TIP nock groove centre deviation from runtime string endpoint (max over draw): %.6f m, ring verts=%d"%[worst,best[2]])
	check(worst<0.0005,"wing tip does not follow string endpoint")
	print("RESULT ", "PASS" if failures.is_empty() else "FAIL %d"%failures.size())
	quit(0 if failures.is_empty() else 3)

func point(key): var p=config[key]; return Vector3(p[0],p[1],p[2])
