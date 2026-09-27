extends "res://hero_axe.gd"
## Standalone visual replacement for Orchard's Edge. All points stay in the
## original hero_axe coordinate frame so its grip, collider and combat tip fit.

var OUTLINE := PackedVector2Array([
	Vector2(-0.075,0.72), Vector2(0.075,0.72), Vector2(0.19,0.81),
	Vector2(0.34,0.86), Vector2(0.43,0.82), Vector2(0.47,0.70),
	Vector2(0.45,0.53), Vector2(0.37,0.44), Vector2(0.23,0.43),
	Vector2(0.18,0.51), Vector2(0.08,0.56), Vector2(-0.075,0.56)
])
const CENTER := Vector2(0.23,0.64)

func _finish_surfaces(parent: Node3D):
	for key in surfaces:
		var mesh_instance := MeshInstance3D.new()
		mesh_instance.name = "OrchidEdge_" + key
		var surface: SurfaceTool = surfaces[key]
		surface.generate_normals()
		mesh_instance.mesh = surface.commit()
		mesh_instance.material_override = materials[key]
		parent.add_child(mesh_instance)

func _blade_triangle(key,a,b,c,flat=false):
	triangle(key,a,c,b,flat)

func _blade_cheeks():
	var inner := PackedVector2Array()
	for p in OUTLINE:
		inner.append(p.lerp(CENTER,0.125))
	for side in [-1,1]:
		for i in range(OUTLINE.size()):
			var k := (i+1)%OUTLINE.size()
			var a := OUTLINE[i]
			var b := OUTLINE[k]
			var face_a := inner[i]
			var face_b := inner[k]
			# The inside point is safely within the crescent, so a fan gives a
			# continuous face without relying on concave polygon triangulation.
			var face_center := Vector3(CENTER.x,CENTER.y,side*0.029)
			var face_start := Vector3(face_a.x,face_a.y,side*0.029)
			var face_end := Vector3(face_b.x,face_b.y,side*0.029)
			if side > 0:
				_blade_triangle("steel",face_center,face_end,face_start,true)
			else:
				_blade_triangle("steel",face_center,face_start,face_end,true)
			var c := inner[k]
			var d := inner[i]
			# Thick convex shell with a broad hand-polished bevel and fine cutting lip.
			var outer_a := Vector3(a.x,a.y,0); var outer_b := Vector3(b.x,b.y,0)
			var inset_c := Vector3(c.x,c.y,side*0.029); var inset_d := Vector3(d.x,d.y,side*0.029)
			if side > 0:
				_blade_triangle("edge",outer_a,inset_c,outer_b,true)
				_blade_triangle("edge",outer_a,inset_d,inset_c,true)
			else:
				_blade_triangle("edge",outer_a,outer_b,inset_c,true)
				_blade_triangle("edge",outer_a,inset_c,inset_d,true)
			# A recessed gilt hairline follows the shoulder just inside the bevel.
			var rail_a := inner[i].lerp(CENTER,0.025)
			var rail_b := inner[k].lerp(CENTER,0.025)
			var rail := [Vector3(rail_a.x,rail_a.y,side*0.0292),Vector3(rail_b.x,rail_b.y,side*0.0292)]
			tube("gold",rail,0.00135,5)

func _leaf(parent_z: float, side: float, base: Vector2, tip: Vector2, width: float):
	var axis := tip-base
	var normal := Vector2(-axis.y,axis.x).normalized()
	var outline := PackedVector2Array([base,base+axis*0.28+normal*width*0.55,base+axis*0.63+normal*width,tip,base+axis*0.63-normal*width,base+axis*0.28-normal*width*0.55])
	var center := Vector2.ZERO
	for p in outline: center += p
	center /= float(outline.size())
	for i in range(outline.size()):
		var p := center
		var q := outline[i]
		var r := outline[(i+1)%outline.size()]
		var a := Vector3(p.x,p.y,parent_z); var b := Vector3(q.x,q.y,parent_z); var c := Vector3(r.x,r.y,parent_z)
		if side > 0: triangle("leaf",a,b,c,true)
		else: triangle("leaf",a,c,b,true)
	var vein := [Vector3(base.x,base.y,parent_z+side*0.001),Vector3((base+tip).x*0.5,(base+tip).y*0.5,parent_z+side*0.001),Vector3(tip.x,tip.y,parent_z+side*0.001)]
	tube("gold",vein,0.0011,5,true)

func _engraving(side: float):
	var z := side*0.030
	# Central stem, fine branches and six raised leaves create the paired orchid crest.
	var stem := []
	for i in range(45):
		var t := float(i)/44.0
		stem.append(Vector3(0.075+0.285*t,0.585+0.205*t+0.012*sin(t*TAU),z))
	tube("gold",stem,0.0020,7)
	for i in range(6):
		var t := 0.17+float(i)*0.115
		var center := Vector2(0.075+0.285*t,0.585+0.205*t+0.012*sin(t*TAU))
		var direction := Vector2(0.72,0.69) if i%2==0 else Vector2(-0.72,0.69)
		var tip := center+direction*0.058
		var base := center+direction*0.009
		_leaf(z+side*0.001,side,base,tip,0.012)
		var branch := [Vector3(center.x,center.y,z+side*0.001),Vector3(tip.x,tip.y,z+side*0.001)]
		tube("gold",branch,0.0010,5)
	for petal in range(5):
		var direction=Vector2(cos(TAU*petal/5),sin(TAU*petal/5))
		_leaf(z+side*.001,side,Vector2(.23,.635)+direction*.007,Vector2(.23,.635)+direction*.023,.008)
	# Fine double-score arcs frame the crest like a smith's chased cartouche.
	for radius in [0.031,0.025]:
		var arc := []
		for i in range(37):
			var a := TAU*float(i)/36.0
			arc.append(Vector3(0.23+cos(a)*radius,0.635+sin(a)*radius,z+side*0.0015))
		tube("gold",arc,0.0012 if radius>0.03 else 0.0008,5)

func _grip(parent: Node3D):
	# Match the original turned haft and seven ferrule positions exactly.
	lathe("wood",[Vector2(0,-0.06),Vector2(0.036,-0.04),Vector2(0.033,0.05),Vector2(0.026,0.3),Vector2(0.029,0.55),Vector2(0.039,0.73),Vector2(0,0.75)])
	lathe("leather",[Vector2(0.033,0.018),Vector2(0.035,0.025),Vector2(0.034,0.28),Vector2(0.030,0.292),Vector2(0.029,0.30)])
	for y in [-0.035,-0.018,0.29,0.32,0.52,0.70,0.727]:
		var radius := 0.037 if y<0 else 0.041
		lathe("gold",[Vector2(radius-0.005,y-0.010),Vector2(radius,y-0.005),Vector2(radius,y+0.005),Vector2(radius-0.005,y+0.010)])
	# Continuous oxblood wrap with a raised edge and alternating brass stitch points.
	var wrap := []; var seam := []; var stitches := []
	for i in range(265):
		var t := float(i)/264.0
		var angle := t*TAU*11.0
		var radius := lerpf(0.0352,0.0350,t)
		var y := 0.028+t*0.244
		wrap.append(Vector3(cos(angle)*radius,y,sin(angle)*radius))
		seam.append(Vector3(cos(angle)*(radius+0.0015),y+0.002,sin(angle)*(radius+0.0015)))
		if i%5==0:
			stitches.append(Vector3(cos(angle)*(radius+0.0022),y+0.003,sin(angle)*(radius+0.0022)))
	tube("dark",wrap,0.0021,7)
	tube("gold",seam,0.00065,5)
	for p in stitches:
		var stitch := [p-Vector3(0,0.0018,0),p+Vector3(0,0.0018,0)]
		tube("gold",stitch,0.00075,5)
	# Grip end caps and the signature leaf-shaped pommel medallion.
	var rosette := []
	for i in range(49):
		var a := TAU*float(i)/48.0
		rosette.append(Vector3(cos(a)*0.027,0.735+sin(a)*0.027,0.001))
	tube("gold",rosette,0.002,7)
	var leaf := [Vector3(0,0.713,0.004),Vector3(0.009,0.733,0.004),Vector3(0,0.755,0.004),Vector3(-0.009,0.733,0.004),Vector3(0,0.713,0.004)]
	tube("leaf",leaf,0.002,6)

func build(parent: Node3D):
	materials={
		"wood":metal("493126",0.62), "leather":metal("4c2523",0.82),
		"steel":metal("648782",0.29),
		"dark_steel":metal("53645f",0.38), "edge":metal("dce5d9",0.18),
		"gold":metal("c99d5c",0.29), "dark":metal("263b37",0.65),
		"leaf":metal("5f9a78",0.42)
	}
	for key in materials:
		var surface := SurfaceTool.new()
		surface.begin(Mesh.PRIMITIVE_TRIANGLES)
		surfaces[key]=surface
	_grip(parent)
	_blade_cheeks()
	for side in [-1.0,1.0]: _engraving(side)
	# Refined steel collar, kept inside the source head silhouette.
	lathe("gold",[Vector2(0.034,0.708),Vector2(0.041,0.713),Vector2(0.043,0.724),Vector2(0.039,0.733),Vector2(0.032,0.737)],24)
	_finish_surfaces(parent)
	# Preserve the original inset jewel's center and size as the local head anchor.
	var gem := WorldZones.rock(parent,Vector3(0,0.635,0.043),Vector3(0.035,0.05,0.025),"75d5a5")
	# Jewel setting shares the gold material; separate mesh avoids rebuilding blade surfaces.
	var ring=MeshInstance3D.new(); var torus=TorusMesh.new(); torus.inner_radius=.031; torus.outer_radius=.037; torus.rings=32; torus.ring_segments=8; ring.mesh=torus; ring.rotation.x=PI/2; ring.scale.z=1.35; ring.position=Vector3(0,.635,.046); ring.material_override=materials.gold; parent.add_child(ring)
	gem.name="OrchidEdge_Heartstone"
	gem.material_override=WorldZones.mat("75d5a5",0.35)

