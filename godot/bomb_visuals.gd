extends Node
## Pocket Thunder visuals only. Physics, damage and fuse authority stay in adventure.
var game
var audio_volume = 0.65
var trails_enabled = true
var clock = 0.0
var models: Array = []
var bursts: Array = []
var trails: Dictionary = {}
var stage: Node3D
var metal: StandardMaterial3D
var brass: StandardMaterial3D
var seam: StandardMaterial3D
var spark_material: StandardMaterial3D
var shard_mesh: ArrayMesh
var boom: AudioStreamWAV
var panel_cache: Dictionary = {}

func setup(owner_game):
	game=owner_game
	stage=Node3D.new()
	stage.name="PocketThunderEffects"
	game.add_child(stage)
	metal=_material(Color("263849"),0.82,0.28)
	brass=_material(Color("b88b43"),0.72,0.3)
	seam=_material(Color("8df1d0"),0.15,0.35,1.4)
	spark_material=_material(Color.WHITE,0,0.8,0.7)
	spark_material.vertex_color_use_as_albedo=true
	spark_material.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
	shard_mesh=_octahedron()

func _material(color:Color,metallic=0.0,roughness=0.6,glow=0.0) -> StandardMaterial3D:
	var mat=StandardMaterial3D.new()
	mat.albedo_color=color
	mat.metallic=metallic
	mat.roughness=roughness
	if glow>0:
		mat.emission_enabled=true
		mat.emission=color
		mat.emission_energy_multiplier=glow
	return mat

func _mesh(parent:Node3D,mesh:Mesh,material:Material,position=Vector3.ZERO) -> MeshInstance3D:
	var node=MeshInstance3D.new()
	node.mesh=mesh
	node.material_override=material
	parent.add_child(node)
	node.position=position
	return node

func _sphere(radius:float) -> SphereMesh:
	var mesh=SphereMesh.new()
	mesh.radius=radius
	mesh.height=radius*2
	mesh.radial_segments=12
	mesh.rings=6
	return mesh

func _cylinder(radius:float,height:float) -> CylinderMesh:
	var mesh=CylinderMesh.new()
	mesh.top_radius=radius
	mesh.bottom_radius=radius
	mesh.height=height
	mesh.radial_segments=12
	return mesh

func _octahedron() -> ArrayMesh:
	var surface=SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var ring=[Vector3.RIGHT,Vector3.FORWARD,Vector3.LEFT,Vector3.BACK]
	for i in range(4):
		for p in [Vector3.UP,ring[i],ring[(i+1)%4],Vector3.DOWN,ring[(i+1)%4],ring[i]]: surface.add_vertex(p)
	surface.generate_normals()
	return surface.commit()

func _point(latitude:float,longitude:float,radius:float) -> Vector3:
	return Vector3(cos(latitude)*cos(longitude),sin(latitude),cos(latitude)*sin(longitude))*radius

func _panel(radius:float,lo:float,hi:float,a:float,b:float) -> ArrayMesh:
	var key="%.5f/%.5f/%.5f/%.5f/%.5f"%[radius,lo,hi,a,b]
	if panel_cache.has(key): return panel_cache[key]
	# Raised center and inset bevels give every shell segment a distinct metal facet.
	var corners=[_point(lo,a,radius),_point(lo,b,radius),_point(hi,b,radius),_point(hi,a,radius)]
	var center=_point((lo+hi)*0.5,(a+b)*0.5,radius*1.035)
	var surface=SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(4):
		var j=(i+1)%4
		for point in [center,corners[i],corners[j]]: surface.add_vertex(point)
		for point in [corners[i],corners[j]*0.88,corners[j],corners[i],corners[i]*0.88,corners[j]*0.88]: surface.add_vertex(point)
	surface.generate_normals()
	var result=surface.commit()
	panel_cache[key]=result
	return result

func create_bomb(parent:Node3D,radius:float=0.095) -> Node3D:
	radius=clampf(radius,0.035,0.3)
	var root=Node3D.new()
	root.name="PocketThunder"
	parent.add_child(root)
	root.set_meta("ready",false)
	root.set_meta("bomb_visual",true)
	root.set_meta("radius",radius)
	var core=_mesh(root,_sphere(radius*0.88),seam)
	core.name="LuminousHeart"
	var parts=[]
	for row in range(3):
		var low=deg_to_rad(-66+row*44+2.5)
		var high=deg_to_rad(-66+(row+1)*44-2.5)
		for column in range(8):
			var angle=float(column)*TAU/8+float(row%2)*0.07
			var panel=_mesh(root,_panel(radius,low,high,angle+0.035,angle+TAU/8-0.035),brass if row==1 and column%4==0 else metal)
			var direction=_point((low+high)*0.5,angle+TAU/16,1)
			parts.append({"node":panel,"direction":direction,"phase":float(column%4)*0.035+float(row)*0.025})
	var cap=_mesh(root,_cylinder(radius*0.37,radius*0.2),brass,Vector3.UP*radius*0.94)
	cap.name="BrassCrown"
	var rune=_mesh(root,shard_mesh,seam,Vector3.UP*radius*1.1)
	rune.scale=Vector3(radius*0.12,radius*0.2,radius*0.12)
	var band_mesh=TorusMesh.new()
	band_mesh.inner_radius=radius*0.39
	band_mesh.outer_radius=radius*0.43
	band_mesh.rings=16
	band_mesh.ring_segments=4
	var bottom=_mesh(root,band_mesh,brass,Vector3.DOWN*radius*0.86)
	# A continuous equatorial binding makes the fractured shell read as one
	# crafted object without taking away its pleasing assembly animation.
	var collar_mesh=TorusMesh.new()
	collar_mesh.inner_radius=radius*0.965
	collar_mesh.outer_radius=radius*1.025
	collar_mesh.rings=24
	collar_mesh.ring_segments=5
	var collar=_mesh(root,collar_mesh,brass)
	collar.name="EquatorialBinding"
	for angle in [0.0,PI*0.5,PI,PI*1.5]:
		var stud=_mesh(root,shard_mesh,seam,Vector3(cos(angle)*radius*1.04,0,sin(angle)*radius*1.04))
		stud.scale=Vector3.ONE*radius*0.065
	var motes=[]
	for i in range(5):
		var mote=_mesh(root,shard_mesh,seam)
		mote.scale=Vector3.ONE*radius*0.038
		mote.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		motes.append(mote)
	root.set_meta("parts",parts)
	root.set_meta("core",core)
	root.set_meta("crown",cap)
	root.set_meta("rune",rune)
	root.set_meta("bottom",bottom)
	root.set_meta("collar",collar)
	root.set_meta("motes",motes)
	root.set_meta("formation_progress",1.0)
	models.append(root)
	update_forming(root,1.0)
	return root

func update_forming(model:Node3D,progress:float):
	if not is_instance_valid(model) or not model.get_meta("bomb_visual",false): return
	progress=clampf(progress,0,1)
	model.set_meta("formation_progress",progress)
	var radius=float(model.get_meta("radius",0.095))
	var core:Node3D=model.get_meta("core")
	core.scale=Vector3.ONE*maxf(0.025,smoothstep(0,0.65,progress))
	for part in model.get_meta("parts",[]):
		var amount=smoothstep(float(part.phase),0.92,progress)
		part.node.position=part.direction*radius*(1-amount)*2.8
		part.node.scale=Vector3.ONE*maxf(0.015,amount)
		part.node.rotation=Vector3((1-amount)*0.7,0,(1-amount)*0.4)
		part.node.visible=progress>float(part.phase)
	var crown:Node3D=model.get_meta("crown")
	crown.scale=Vector3.ONE*maxf(0.02,smoothstep(0.6,1,progress))
	var rune:Node3D=model.get_meta("rune")
	rune.visible=progress>0.75
	var bottom:Node3D=model.get_meta("bottom")
	bottom.visible=progress>0.55
	var collar:Node3D=model.get_meta("collar")
	collar.visible=progress>0.82
	collar.scale=Vector3.ONE*maxf(0.01,smoothstep(0.82,1.0,progress))

func tick(delta:float):
	clock+=delta
	seam.emission_energy_multiplier=1.1+0.34*sin(clock*6.2)
	for i in range(models.size()-1,-1,-1):
		var model=models[i]
		if not is_instance_valid(model):
			models.remove_at(i)
			continue
		var radius=float(model.get_meta("radius",0.095))
		var progress=float(model.get_meta("formation_progress",1.0))
		var motes=model.get_meta("motes",[])
		for j in range(motes.size()):
			var angle=clock*1.8+float(j)*TAU/float(motes.size())
			motes[j].position=Vector3(cos(angle),sin(angle*1.3)*0.35,sin(angle))*radius*(1.24+(1-progress)*1.6)
			motes[j].rotation=Vector3(clock,float(j),clock*0.6)
	for i in range(bursts.size()-1,-1,-1):
		var burst=bursts[i]
		var age=clock-float(burst.born)
		if age>float(burst.life):
			if is_instance_valid(burst.root): burst.root.queue_free()
			bursts.remove_at(i)
			continue
		_update_burst(burst,age)
	_update_trails()

func explosion(position:Vector3,radius:float,intensity:float=1.0,duration:float=0.75,spark_count:int=24):
	if stage==null: return
	radius=clampf(radius,0.3,10)
	intensity=clampf(intensity,0,2)
	if intensity<=0:
		_sound(position,1.0)
		return
	duration=clampf(duration,0.2,2)
	spark_count=clampi(spark_count,0,64)
	var root=Node3D.new()
	stage.add_child(root)
	root.global_position=position
	var flash_mat=_material(Color(1,0.79,0.43,0.68),0,1,1.5*intensity)
	flash_mat.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
	flash_mat.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	var flash=_mesh(root,_sphere(minf(radius*0.13,0.4)),flash_mat)
	flash.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var burst_light:OmniLight3D=null
	if bursts.size()<4:
		burst_light=OmniLight3D.new()
		root.add_child(burst_light)
		burst_light.light_color=Color("ffc17a")
		burst_light.omni_range=minf(radius*2.4,8.0)
		burst_light.shadow_enabled=false
	var ring_mat=_material(Color(1.0,0.59,0.24,0.56),0,1,0.95*intensity)
	ring_mat.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
	ring_mat.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	var ring_mesh=TorusMesh.new()
	ring_mesh.inner_radius=0.965
	ring_mesh.outer_radius=1.0
	ring_mesh.rings=40
	ring_mesh.ring_segments=5
	var rings=[]
	for i in range(2):
		var ring=_mesh(root,ring_mesh,ring_mat)
		ring.position.y=0.04+i*0.12
		ring.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		rings.append(ring)
	var multimesh=MultiMesh.new()
	multimesh.transform_format=MultiMesh.TRANSFORM_3D
	multimesh.use_colors=true
	multimesh.mesh=shard_mesh
	multimesh.instance_count=spark_count
	var sparks=MultiMeshInstance3D.new()
	sparks.multimesh=multimesh
	sparks.material_override=spark_material
	sparks.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(sparks)
	var velocities=[]
	for i in range(spark_count):
		var angle=float(i)*2.399963
		var height=lerpf(-0.15,0.85,float(i%7)/6)
		var direction=Vector3(cos(angle),height,sin(angle)).normalized()
		velocities.append(direction*radius*lerpf(0.9,1.8,float(i%5)/4)/duration)
	var smoke=[]
	var fragments=[]
	for i in range(8):
		var fragment=_mesh(root,shard_mesh,seam if i%3==0 else brass)
		fragment.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fragments.append(fragment)
	var echo_mat=_material(Color(0.48,0.94,0.81,0.4),0,1,1.1*intensity)
	echo_mat.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
	echo_mat.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	var echo=_mesh(root,ring_mesh,echo_mat)
	echo.rotation=Vector3(0.25,0,0.18)
	echo.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for i in range(4):
		var smoke_mat=_material(Color(0.31,0.35,0.38,0.0),0,1)
		smoke_mat.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
		var puff=_mesh(root,_sphere(radius*0.12),smoke_mat)
		puff.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		smoke.append(puff)
	var burst={"root":root,"born":clock,"life":duration*1.8,"duration":duration,"radius":radius,"intensity":intensity,"flash":flash,"flash_mat":flash_mat,"burst_light":burst_light,"rings":rings,"ring_mat":ring_mat,"sparks":multimesh,"velocities":velocities,"smoke":smoke}
	burst["fragments"]=fragments
	burst["echo"]=echo
	burst["echo_mat"]=echo_mat
	_update_burst(burst,0.0)
	bursts.append(burst)
	_sound(position,intensity)

func _update_burst(burst:Dictionary,age:float):
	var duration=float(burst.duration)
	var progress=clampf(age/duration,0,1)
	var flash=clampf(1-age/0.22,0,1)
	burst.flash.visible=flash>0
	burst.flash.scale=Vector3.ONE*(0.6+(1-flash)*0.65)
	burst.flash_mat.albedo_color.a=flash*0.68*minf(burst.intensity,1)
	if burst.burst_light!=null: burst.burst_light.light_energy=flash*1.7*burst.intensity
	for i in range(burst.rings.size()):
		var expansion=clampf((progress-float(i)*0.10)/0.82,0,1)
		var radius=maxf(0.03,float(burst.radius)*sin(expansion*PI/2))
		burst.rings[i].scale=Vector3(radius,0.35,radius)
		burst.rings[i].visible=progress>float(i)*0.1 and progress<0.95
	burst.ring_mat.albedo_color.a=(1-progress)*0.56*minf(burst.intensity,1)
	var echo_progress=clampf((progress-0.12)/0.88,0,1)
	burst.echo.visible=progress>0.12 and progress<1
	burst.echo.scale=Vector3.ONE*maxf(0.01,burst.radius*0.72*sin(echo_progress*PI/2))
	burst.echo_mat.albedo_color.a=sin(echo_progress*PI)*0.32*minf(burst.intensity,1)
	for i in range(burst.fragments.size()):
		var fragment=burst.fragments[i]
		var angle=float(i)*TAU/8
		var speed=burst.radius*0.75/duration
		fragment.position=Vector3(cos(angle)*speed*age,sin(progress*PI)*0.55,sin(angle)*speed*age)
		fragment.rotation=Vector3(age*5+i,angle+age*4,age*3)
		fragment.scale=Vector3(0.08,0.13,0.045)*burst.intensity*maxf(0.001,1-progress)
		fragment.visible=progress<1
	for i in range(burst.velocities.size()):
		var point:Vector3=burst.velocities[i]*age+Vector3.DOWN*2.8*age*age
		var size=0.043*float(burst.intensity)*maxf(0.001,1-progress)
		var basis=Basis.from_euler(Vector3(age*4,float(i),age*3)).scaled(Vector3(size,size*2.8,size))
		burst.sparks.set_instance_transform(i,Transform3D(basis,point))
		burst.sparks.set_instance_color(i,Color(0.5,0.95,0.82,maxf(0,1-progress)) if i%4==0 else Color(1,lerpf(0.77,0.35,progress),0.24,maxf(0,1-progress)))
	for i in range(burst.smoke.size()):
		var smoke_progress=clampf((age-duration*0.15)/(duration*1.65),0,1)
		var angle=float(i)*TAU/4+0.4
		var puff:MeshInstance3D=burst.smoke[i]
		puff.position=Vector3(cos(angle)*float(burst.radius)*0.18,age*0.65,sin(angle)*float(burst.radius)*0.18)
		puff.scale=Vector3.ONE*(0.35+smoke_progress*1.7)
		puff.material_override.albedo_color.a=sin(smoke_progress*PI)*0.15

func _update_trails():
	var live={}
	if trails_enabled:
		for body in game.get_tree().get_nodes_in_group("magic_bomb"):
			if not is_instance_valid(body) or body.get_meta("exploded",false): continue
			var key=body.get_instance_id()
			live[key]=true
			if not trails.has(key):
				var node=MeshInstance3D.new()
				node.mesh=ImmediateMesh.new()
				node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				stage.add_child(node)
				trails[key]={"node":node,"points":[],"at":clock}
			var trail=trails[key]
			if clock<float(trail.at): continue
			trail.at=clock+0.035
			trail.points.push_front(body.global_position)
			if trail.points.size()>6: trail.points.pop_back()
			var mesh:ImmediateMesh=trail.node.mesh
			mesh.clear_surfaces()
			if trail.points.size()<2: continue
			mesh.surface_begin(Mesh.PRIMITIVE_LINES,seam)
			for i in range(trail.points.size()-1):
				mesh.surface_add_vertex(trail.points[i])
				mesh.surface_add_vertex(trail.points[i+1])
			mesh.surface_end()
	for key in trails.keys():
		if not live.has(key):
			trails[key].node.queue_free()
			trails.erase(key)

func _sound(position:Vector3,intensity:float):
	if audio_volume<=0 or DisplayServer.get_name()=="headless": return
	if boom==null: boom=_synthesize_boom()
	var player=AudioStreamPlayer3D.new()
	stage.add_child(player)
	player.global_position=position
	player.stream=boom
	player.max_distance=22
	player.unit_size=3
	player.volume_db=linear_to_db(clampf(audio_volume,0.001,1)*minf(intensity,1.1))-5
	player.finished.connect(player.queue_free)
	player.play()

func _synthesize_boom() -> AudioStreamWAV:
	# Short deterministic bass/thunder noise. Generated locally; no external assets.
	var sample_rate=22050
	var samples=int(sample_rate*0.48)
	var data=PackedByteArray()
	data.resize(samples*2)
	var random=RandomNumberGenerator.new()
	random.seed=709
	var noise=0.0
	for i in range(samples):
		var time=float(i)/sample_rate
		noise=lerpf(noise,random.randf_range(-1,1),0.4)
		var bass=sin(TAU*(92*time-50*time*time))*exp(-time*10)
		var crack=noise*exp(-time*16)
		var attack=minf(1,time/0.003)
		var value=clampf((bass*0.6+crack*0.45)*attack,-0.86,0.86)
		data.encode_s16(i*2,int(value*32767))
	var stream=AudioStreamWAV.new()
	stream.format=AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate=sample_rate
	stream.stereo=false
	stream.data=data
	return stream
