extends RefCounted
## Hollow's Song: authored surfaces with shared materials, not primitive blocks.
## Meshes are baked into six material surfaces; all dimensions are in metres.
var surfaces={}
var materials={}

func metal(color: String, roughness: float) -> StandardMaterial3D:
	var m=StandardMaterial3D.new()
	m.albedo_color=Color(color)
	m.metallic=0.82
	m.roughness=roughness
	return m

func triangle(key: String,a: Vector3,b: Vector3,c: Vector3,flat=false):
	var s=surfaces[key]
	s.set_smooth_group(4294967295 if flat else 0)
	for v in [a,b,c]: s.add_vertex(v)

func lathe(key: String, profile: Array, segments=40):
	for j in range(profile.size()-1):
		for i in range(segments):
			var a=TAU*i/segments
			var b=TAU*(i+1)/segments
			var p=profile[j]
			var q=profile[j+1]
			var v0=Vector3(cos(a)*p.x,p.y,sin(a)*p.x)
			var v1=Vector3(cos(b)*p.x,p.y,sin(b)*p.x)
			var v2=Vector3(cos(b)*q.x,q.y,sin(b)*q.x)
			var v3=Vector3(cos(a)*q.x,q.y,sin(a)*q.x)
			triangle(key,v0,v2,v3)
			triangle(key,v0,v1,v2)

func tube(key: String, points: Array, radius: float, segments=8, taper_tip=false):
	var rings=[]
	var previous_right=Vector3.ZERO
	for j in range(points.size()):
		var axis=(points[min(j+1,points.size()-1)]-points[max(0,j-1)]).normalized()
		var right=axis.cross(Vector3.UP if abs(axis.y)<0.95 else Vector3.RIGHT).normalized() if j==0 else (previous_right-axis*previous_right.dot(axis)).normalized()
		previous_right=right
		var forward=axis.cross(right).normalized()
		var ring=[]
		var r=radius*(1.0-0.95*smoothstep(0.72,1.0,float(j)/(points.size()-1))) if taper_tip else radius
		for i in range(segments): ring.append(points[j]+r*(right*cos(TAU*i/segments)+forward*sin(TAU*i/segments)))
		rings.append(ring)
	for j in range(rings.size()-1):
		for i in range(segments):
			var k=(i+1)%segments
			triangle(key,rings[j][i],rings[j+1][i],rings[j+1][k])
			triangle(key,rings[j][i],rings[j+1][k],rings[j][k])

func crystal(center: Vector3, length: float, radius: float, key: String, angle=0.0):
	# Bevel shoulders and alternating narrow bevel faces preserve broad reflective planes.
	var rings=[]
	for level in [Vector2(-0.5,0.08),Vector2(-0.43,0.7),Vector2(-0.34,1),Vector2(0.31,0.95),Vector2(0.43,0.68),Vector2(0.5,0.07)]:
		var ring=[]
		for i in range(16):
			var a=TAU*(floorf(i/2.0)/8.0)+(-0.035 if i%2==0 else 0.035)+angle
			ring.append(center+Vector3(level.x*length,cos(a)*radius*level.y,sin(a)*radius*level.y))
		rings.append(ring)
	for j in range(rings.size()-1):
		for i in range(16):
			var k=(i+1)%16
			triangle(key,rings[j][i],rings[j+1][i],rings[j+1][k],true)
			triangle(key,rings[j][i],rings[j+1][k],rings[j][k],true)
	for i in range(1,15):
		triangle(key,rings[0][0],rings[0][i],rings[0][i+1],true)
		triangle(key,rings[5][0],rings[5][i+1],rings[5][i],true)

func build(parent: Node3D):
	materials={"silver":metal("7e94a8",0.28),"gold":metal("bf8e4d",0.3),"dark":metal("252536",0.44)}
	var leather=StandardMaterial3D.new()
	leather.albedo_color=Color("302138")
	leather.roughness=0.88
	materials.leather=leather
	var gem=ShaderMaterial.new()
	gem.shader=preload("res://hero_crystal.gdshader")
	gem.set_shader_parameter("crystal_texture",preload("res://assets/hero/hollows_song_crystal.png"))
	materials.crystal=gem
	var core=StandardMaterial3D.new()
	core.albedo_color=Color("6724ab")
	core.emission_enabled=true
	core.emission=Color("9430e3")
	core.emission_energy_multiplier=0.45
	materials.core=core
	for key in materials:
		var s=SurfaceTool.new()
		s.begin(Mesh.PRIMITIVE_TRIANGLES)
		surfaces[key]=s
	# Continuous tapered handle, turned pommel and stepped socket.
	lathe("dark",[Vector2(0,-0.06),Vector2(0.027,-0.055),Vector2(0.032,0),Vector2(0.026,0.3),Vector2(0.038,0.45),Vector2(0.056,0.49),Vector2(0,0.5)])
	lathe("silver",[Vector2(0,-0.07),Vector2(0.026,-0.066),Vector2(0.044,-0.047),Vector2(0.049,-0.03),Vector2(0.043,-0.014),Vector2(0.034,-0.008),Vector2(0.032,0.005)])
	lathe("silver",[Vector2(0.031,0.29),Vector2(0.037,0.30),Vector2(0.036,0.32),Vector2(0.029,0.33),Vector2(0.039,0.40),Vector2(0.07,0.44),Vector2(0.078,0.465),Vector2(0.067,0.49),Vector2(0.04,0.51)])
	for y in [-0.039,-0.015,0.006,0.287,0.305,0.434,0.477]:
		var r=0.046 if y<0 else (0.036 if y<0.32 else 0.073)
		lathe("gold",[Vector2(r-0.003,y-0.004),Vector2(r,y-0.002),Vector2(r,y+0.002),Vector2(r-0.003,y+0.004)])
	# Continuous leather sleeve with narrow winding seams and fine brass stitching.
	lathe("leather",[Vector2(0.031,0.008),Vector2(0.036,0.016),Vector2(0.036,0.04),Vector2(0.030,0.265),Vector2(0.029,0.285)])
	var wrap=[]
	var stitch=[]
	for i in range(361):
		var t=i/360.0
		var a=t*TAU*11
		var r=lerpf(0.036,0.030,t)
		wrap.append(Vector3(cos(a)*r,0.015+t*0.265,sin(a)*r))
		stitch.append(Vector3(cos(a)*(r+0.001),0.020+t*0.265,sin(a)*(r+0.001)))
	tube("dark",wrap,0.0018,6)
	tube("gold",stitch,0.00065,5)
	# Four curved claws cradle the head, with gold filigree following each spine.
	for side in [-1,1]:
		for face in [-1,1]:
			var claw=[]
			var inlay=[]
			for i in range(25):
				var t=i/24.0
				var point=Vector3(side*(0.038+0.15*sin(t*PI*0.64)),0.435+t*0.29,face*(0.025+0.125*sin(t*PI*0.8)))
				claw.append(point)
				inlay.append(point+Vector3(side*0.008,0,face*0.018))
			tube("silver",claw,0.019,12,true)
			tube("gold",inlay,0.003,6,true)
	# Crystal head and internal inclusions. No white opaque bulb hiding the material.
	crystal(Vector3(0,0.645,0),0.61,0.148,"crystal",PI/8)
	crystal(Vector3(0,0.645,0),0.48,0.044,"core",PI/8)
	for side in [-1,1]:
		crystal(Vector3(side*0.105,0.676,0.039),0.15,0.018,"core",0.4)
		# Inlaid diamond seal on each face of the socket.
		var seal=[]
		for i in range(49):
			var a=TAU*i/48
			seal.append(Vector3(sin(a)*0.038,0.43+cos(a)*0.044,side*0.073))
		tube("gold",seal,0.0035,6)
	# Six surfaces total, shared shader/material state; no independent node per rivet.
	for key in surfaces:
		var surface=surfaces[key]
		surface.generate_normals()
		var mesh=MeshInstance3D.new()
		mesh.name="HollowsSong_"+key
		mesh.mesh=surface.commit()
		mesh.material_override=materials[key]
		parent.add_child(mesh)
	preload("res://crystal_art.gd").illuminate(parent,Vector3(0,0.645,0),Color("b260f0"))
