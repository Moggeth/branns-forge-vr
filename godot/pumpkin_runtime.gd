extends Node
## Small, physical Forge Yard targets. All three outcomes share one contact path.
const MIN_BREAK_SPEED=1.7
const RESPAWN_SECONDS=50.0
const SUNFALL_ID="74a031c1-7001-4518-8ae8-ace3dce4d027"
var game
var pumpkins:Array=[]
var scraps:Array=[]
var rind:StandardMaterial3D
var groove:StandardMaterial3D
var flesh:StandardMaterial3D
var lantern:StandardMaterial3D

func setup(owner_game):
	game=owner_game
	rind=WorkshopScene.material("d97726",0.05,0.76)
	groove=WorkshopScene.material("9c421e",0.0,0.84)
	flesh=WorkshopScene.material("f4ad4c",0.0,0.83)
	flesh.cull_mode=BaseMaterial3D.CULL_DISABLED
	lantern=WorkshopScene.material("ffb63d",0.0,0.45,2.8)
	var positions=[Vector3(-9.3,0,3.6),Vector3(-8.6,0,4.6),Vector3(-9.7,0,5.3),Vector3(9.3,0,4.1)]
	for i in positions.size(): _spawn(i,positions[i])
	var sign=Node3D.new(); game.adventure.zone_groups.forge_yard.add_child(sign); sign.position=Vector3(-10.55,0,3.2)
	WorldZones.box(sign,Vector3(0,0.55,0),Vector3(0.08,1.1,0.08),"694427")
	WorldZones.box(sign,Vector3(0,1.08,0),Vector3(1.48,0.56,0.09),"694427")
	var caption=WorldZones.label(sign,"PUMPKINS\nSlice · bonk · stab ×3",Vector3(0,1.08,0.058),10,"ffe1a2")
	caption.pixel_size=0.004
	print("PUMPKINS ready=",pumpkins.size()," slice=blade smash=blunt carve=three stabs")

func _spawn(index:int,position:Vector3):
	var body=RigidBody3D.new()
	body.name="PracticePumpkin%02d"%index
	body.collision_layer=1
	body.collision_mask=9
	body.mass=1.4
	body.continuous_cd=true
	body.linear_damp=0.65
	body.angular_damp=1.8
	body.physics_material_override=PhysicsMaterial.new()
	body.physics_material_override.friction=0.8
	body.physics_material_override.bounce=0.22
	game.adventure.zone_groups.forge_yard.add_child(body)
	body.position=position+Vector3.UP*0.31
	body.set_meta("kind","pumpkin")
	body.set_meta("pumpkin_index",index)
	var shape=CollisionShape3D.new(); body.add_child(shape)
	var sphere=SphereShape3D.new(); sphere.radius=0.29; shape.shape=sphere
	var skin=Node3D.new(); body.add_child(skin); skin.name="Rind"
	var face_cuts=Node3D.new(); skin.add_child(face_cuts); face_cuts.name="FaceCuts"
	var core=MeshInstance3D.new(); skin.add_child(core)
	var mesh=SphereMesh.new(); mesh.radius=0.31; mesh.height=0.56; mesh.radial_segments=18; mesh.rings=8
	core.mesh=mesh; core.material_override=rind
	for i in 10:
		var a=float(i)*TAU/10
		var rib=MeshInstance3D.new(); skin.add_child(rib)
		var tube=SphereMesh.new(); tube.radius=0.11; tube.height=0.52; tube.radial_segments=8; tube.rings=5
		rib.mesh=tube; rib.material_override=rind if i%2==0 else groove
		rib.position=Vector3(cos(a)*0.23,-0.005,sin(a)*0.23)
	var stem=MeshInstance3D.new(); skin.add_child(stem)
	var stem_mesh=CylinderMesh.new(); stem_mesh.top_radius=0.035; stem_mesh.bottom_radius=0.065; stem_mesh.height=0.14
	stem.mesh=stem_mesh; stem.material_override=WorkshopScene.material("58733a",0.0,0.8); stem.position.y=0.32; stem.rotation.z=0.22
	pumpkins.append({"body":body,"home":position,"state":"whole","stabs":0,"next_hit":0.0,"reset_at":0.0,"face":face_cuts})

func _entry(target:Node)->Dictionary:
	if target==null or not target.has_meta("pumpkin_index"): return {}
	var index=int(target.get_meta("pumpkin_index"))
	return pumpkins[index] if index>=0 and index<pumpkins.size() else {}

func _mode(item:Node3D)->String:
	if not is_instance_valid(item): return "blunt"
	if item.get_meta("pointed",false): return "stab"
	var declared=str(item.get_meta("impact_class","")).to_lower()
	if declared in ["stab","slice","blunt"]: return declared
	var id=(str(item.get_meta("id",""))+" "+str(item.get_meta("display_name",""))).to_lower()
	if id=="quarry_pick" or id.contains("dagger") or id.contains("spear") or id.contains("bolt") or id.contains("pick"): return "stab"
	if id=="woodland_axe" or id.contains("axe") or id.contains("sword") or id.contains("blade") or id.contains("knife") or id.contains("edge"): return "slice"
	return "blunt"

func impact(target:Node3D,item:Node3D,point:Vector3,normal:Vector3,velocity:Vector3)->bool:
	var entry=_entry(target)
	if entry.is_empty() or entry.state!="whole" or game.adventure.zone!="forge_yard": return false
	if game.elapsed<float(entry.next_hit): return true
	entry.next_hit=game.elapsed+0.19
	var speed=velocity.length()
	var mode=_mode(item)
	if speed<MIN_BREAK_SPEED:
		entry.body.apply_central_impulse(-normal*minf(0.8,speed*0.3))
		return true
	if mode=="stab":
		if entry.stabs<3:
			entry.stabs+=1
			_carve(entry)
		game._notice("Pumpkin face · %d / 3 stabs"%mini(entry.stabs,3),2)
		game._effect(point,Color("ffc56d"),0.2,0.16)
		entry.body.apply_central_impulse(velocity.normalized()*0.35)
		return true
	if mode=="slice":
		# Broadside of the blade determines the plane. Keep it perpendicular to
		# travel so rolling the wrist visibly rotates the split.
		var axis=item.global_basis.z if is_instance_valid(item) else normal
		axis=(axis-velocity.normalized()*axis.dot(velocity.normalized())).normalized()
		if axis.length()<0.1: axis=normal
		_slice(entry,axis,point,velocity)
	else: _shatter(entry,velocity)
	return true

func _carve(entry:Dictionary):
	var index=int(entry.stabs)
	var face:Node3D=entry.face
	if index<=2:
		var eye=MeshInstance3D.new(); face.add_child(eye)
		var eye_mesh=PrismMesh.new(); eye_mesh.size=Vector3(0.11,0.11,0.012)
		eye.mesh=eye_mesh; eye.material_override=lantern
		eye.position=Vector3(-0.11 if index==1 else 0.11,0.07,0.355)
		eye.rotation.z=PI if index==1 else 0.0
	else:
		for i in range(5):
			var tooth=MeshInstance3D.new(); face.add_child(tooth)
			var box=BoxMesh.new(); box.size=Vector3(0.055,0.035,0.012)
			tooth.mesh=box; tooth.material_override=lantern
			tooth.position=Vector3((i-2)*0.061,-0.12+abs(i-2)*0.018,0.355)
		var glow=OmniLight3D.new(); face.add_child(glow)
		glow.position=Vector3(0,0,0.24); glow.omni_range=1.1; glow.light_energy=0.45; glow.shadow_enabled=false

func _finish(entry:Dictionary):
	entry.state="broken"
	entry.reset_at=game.elapsed+RESPAWN_SECONDS
	entry.body.visible=false
	entry.body.freeze=true
	entry.body.collision_layer=0
	game._effect(entry.body.global_position,Color("ffa644"),0.36,0.52)

func _piece(entry:Dictionary,position:Vector3,mesh:Mesh,material:Material,velocity:Vector3,weight:float,rotation:Basis=Basis.IDENTITY):
	var fragment=RigidBody3D.new(); game.adventure.zone_groups.forge_yard.add_child(fragment)
	fragment.global_transform=Transform3D(rotation,position)
	fragment.collision_layer=8; fragment.collision_mask=9; fragment.mass=weight
	fragment.continuous_cd=true; fragment.linear_damp=0.7; fragment.angular_damp=1.3
	var physical=PhysicsMaterial.new(); physical.friction=0.8; physical.bounce=0.18; fragment.physics_material_override=physical
	var art=MeshInstance3D.new(); fragment.add_child(art); art.mesh=mesh
	if material!=null: art.material_override=material
	var col=CollisionShape3D.new(); fragment.add_child(col)
	var shape=SphereShape3D.new(); shape.radius=0.17 if weight>0.3 else 0.09; col.shape=shape
	fragment.linear_velocity=velocity.limit_length(9)
	fragment.angular_velocity=Vector3(velocity.z,velocity.x,velocity.y)*0.5
	scraps.append({"body":fragment,"until":game.elapsed+32.0})

func _slice_mesh(cut:float)->ArrayMesh:
	# A closed spherical segment in local +X. Cut is measured from the centre
	# towards this half, so both sides share exactly the same exposed plane.
	var radius=0.32
	var rings=9; var sectors=20
	var surface=SurfaceTool.new(); surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for ring in range(rings):
		var x0=lerpf(cut,radius,float(ring)/rings)
		var x1=lerpf(cut,radius,float(ring+1)/rings)
		for sector in range(sectors):
			var a=float(sector)*TAU/sectors; var b=float(sector+1)*TAU/sectors
			var radial0=sqrt(maxf(0.0,1.0-x0*x0/(radius*radius)))
			var radial1=sqrt(maxf(0.0,1.0-x1*x1/(radius*radius)))
			var p0=Vector3(x0-cut,cos(a)*0.29*radial0,sin(a)*radius*radial0)
			var p1=Vector3(x1-cut,cos(a)*0.29*radial1,sin(a)*radius*radial1)
			var p2=Vector3(x1-cut,cos(b)*0.29*radial1,sin(b)*radius*radial1)
			var p3=Vector3(x0-cut,cos(b)*0.29*radial0,sin(b)*radius*radial0)
			for v in [p0,p2,p1,p0,p3,p2]: surface.add_vertex(v)
	surface.generate_normals(); surface.set_material(rind)
	var result=surface.commit()
	surface=SurfaceTool.new(); surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var cut_radius=sqrt(maxf(0.0,1.0-cut*cut/(radius*radius)))
	for i in range(sectors):
		var a=float(i)*TAU/sectors; var b=float(i+1)*TAU/sectors
		# Face the normal outwards (local -X), with two-sided material as a
		# fallback when a piece tumbles and is viewed from inside.
		for v in [Vector3.ZERO,Vector3(0,cos(b)*0.29*cut_radius,sin(b)*radius*cut_radius),Vector3(0,cos(a)*0.29*cut_radius,sin(a)*radius*cut_radius)]: surface.add_vertex(v)
	surface.generate_normals(); surface.set_material(flesh)
	surface.commit(result)
	return result

func _slice(entry:Dictionary,axis:Vector3,point:Vector3,velocity:Vector3):
	var center:Vector3=entry.body.global_position
	var cut_offset=clampf((point-center).dot(axis),-0.24,0.24)
	_finish(entry)
	var up=(Vector3.UP-axis*axis.dot(Vector3.UP)).normalized()
	if up.length()<0.1: up=Vector3.FORWARD
	for direction in [-1.0,1.0]:
		var side=axis*direction
		var basis=Basis(side,up,side.cross(up)).orthonormalized()
		var cut=cut_offset*direction
		var fraction=clampf((0.32-cut)/0.64,0.12,0.88)
		_piece(entry,center+axis*cut_offset+side*0.025,_slice_mesh(cut),null,velocity*0.28+side*1.9+Vector3.UP*0.75,1.2*fraction,basis)
	game._notice("A clean pumpkin slice!",2)

func _shatter(entry:Dictionary,velocity:Vector3):
	var center:Vector3=entry.body.global_position
	_finish(entry)
	for i in 8:
		var a=float(i)*TAU/8
		var dir=Vector3(cos(a),0.3+float(i%3)*0.12,sin(a)).normalized()
		var mesh=SphereMesh.new(); mesh.radius=0.10+float(i%3)*0.018; mesh.height=0.16; mesh.radial_segments=6; mesh.rings=3
		_piece(entry,center+dir*0.12,mesh,rind if i%3 else flesh,velocity*0.25+dir*2.4,0.13)
	game._notice("Pumpkin: bonk!",2)

func tick(_delta:float):
	for entry in pumpkins:
		if entry.state=="broken" and game.elapsed>=entry.reset_at:
			entry.state="whole"; entry.stabs=0; entry.next_hit=0.0
			for child in entry.face.get_children(): child.queue_free()
			entry.body.global_position=entry.home+Vector3.UP*0.31
			entry.body.linear_velocity=Vector3.ZERO; entry.body.angular_velocity=Vector3.ZERO
			entry.body.freeze=false; entry.body.visible=true; entry.body.collision_layer=1
	for piece in scraps.duplicate():
		if not is_instance_valid(piece.body) or game.elapsed>=piece.until:
			if is_instance_valid(piece.body): piece.body.queue_free()
			scraps.erase(piece)
