extends "res://hero_hammer.gd"
## Orchard's Edge uses the shared surface-authoring helpers and its original grip axis.
func build(parent:Node3D):
	materials={"silver":metal("a4babe",0.29),"gold":metal("bd985c",0.35),"dark":metal("34534c",0.45),"leather":metal("44322b",0.9)}
	materials.leather.metallic=0
	for key in materials:
		var surface=SurfaceTool.new()
		surface.begin(Mesh.PRIMITIVE_TRIANGLES)
		surfaces[key]=surface
	lathe("leather",[Vector2(0,-0.06),Vector2(0.036,-0.04),Vector2(0.033,0.05),Vector2(0.026,0.3),Vector2(0.029,0.55),Vector2(0.039,0.73),Vector2(0,0.75)])
	for y in [-0.035,-0.018,0.29,0.32,0.52,0.70,0.727]:
		var r=0.037 if y<0 else 0.041
		lathe("gold",[Vector2(r-0.005,y-0.01),Vector2(r,y-0.005),Vector2(r,y+0.005),Vector2(r-0.005,y+0.01)])
	var winding=[]
	for i in range(321):
		var t=i/320.0
		var a=t*TAU*9
		winding.append(Vector3(cos(a)*lerpf(0.034,0.029,t),0.01+t*0.27,sin(a)*lerpf(0.034,0.029,t)))
	tube("dark",winding,0.0025,6)
	var outline=PackedVector2Array([Vector2(-0.075,0.72),Vector2(0.075,0.72),Vector2(0.19,0.81),Vector2(0.34,0.86),Vector2(0.43,0.82),Vector2(0.47,0.70),Vector2(0.45,0.53),Vector2(0.37,0.44),Vector2(0.23,0.43),Vector2(0.18,0.51),Vector2(0.08,0.56),Vector2(-0.075,0.56)])
	var center=Vector2(0.23,0.64)
	var inset=PackedVector2Array()
	for point in outline: inset.append(point.lerp(center,0.10))
	var indices=Geometry2D.triangulate_polygon(inset)
	for side in [-1,1]:
		for i in range(0,indices.size(),3):
			var a=inset[indices[i]]
			var b=inset[indices[i+1 if side>0 else i+2]]
			var c=inset[indices[i+2 if side>0 else i+1]]
			triangle("dark",Vector3(a.x,a.y,side*0.038),Vector3(b.x,b.y,side*0.038),Vector3(c.x,c.y,side*0.038),true)
		for i in range(outline.size()):
			var k=(i+1)%outline.size()
			var a=Vector3(outline[i].x,outline[i].y,0)
			var b=Vector3(outline[k].x,outline[k].y,0)
			var c=Vector3(inset[k].x,inset[k].y,side*0.038)
			var d=Vector3(inset[i].x,inset[i].y,side*0.038)
			triangle("silver",a,c,b if side>0 else d,true)
			triangle("silver",a,d if side>0 else b,c,true)
		# Fine botanical inlay: a sweeping stem and paired leaves on each cheek.
		var vine=[]
		for i in range(41):
			var t=i/40.0
			vine.append(Vector3(0.10+t*0.24,0.60+sin(t*PI)*0.10,side*0.041))
		tube("gold",vine,0.0025,6)
		for j in range(3):
			var leaf=[]
			for i in range(33):
				var a=TAU*i/32
				leaf.append(Vector3(0.17+j*0.065+sin(a)*0.019,0.70+cos(a)*0.034,side*0.042))
			tube("gold",leaf,0.0017,5)
		var ring=[]
		for i in range(41):
			var a=TAU*i/40
			ring.append(Vector3(cos(a)*0.030,0.635+sin(a)*0.030,side*0.045))
		tube("gold",ring,0.005,8)
	for key in surfaces:
		var surface=surfaces[key]
		surface.generate_normals()
		var mesh=MeshInstance3D.new()
		mesh.mesh=surface.commit()
		mesh.material_override=materials[key]
		parent.add_child(mesh)
	var gem=WorldZones.rock(parent,Vector3(0,0.635,0.043),Vector3(0.035,0.05,0.025),"75d5a5")
	gem.material_override=WorldZones.mat("75d5a5",0.35)
